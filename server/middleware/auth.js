const { readJson } = require('../utils/dataStore');
const { sessionLifetimeMs } = require('../utils/sessionPolicy');

const ALL_PERMISSIONS = [
  'dashboard.view',
  'employees.view',
  'employeeStatus.view',
  'employees.manage',
  'displays.manage',
  'companyProfiles.manage',
  'weather.manage',
  'zkteco.manage',
  'users.manage',
  'display.access'
];

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if ((req.originalUrl || req.path).startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
  return res.redirect(`/admin/login.html?next=${encodeURIComponent(req.originalUrl || req.url || '/admin/')}`);
}

function isDisplayRole(user = {}) {
  return ['display', 'kiosk', 'viewer'].includes(String(user.role || '').trim().toLowerCase());
}

function rolePermissions(role = '') {
  const normalized = String(role || '').trim().toLowerCase();
  if (['administrator', 'admin', 'super admin', 'superadmin'].includes(normalized)) return ALL_PERMISSIONS;
  if (normalized === 'employee viewer') return ['employees.view'];
  if (normalized === 'availability viewer') return ['employees.view', 'employeeStatus.view'];
  if (normalized === 'employee editor') return ['employees.view', 'employeeStatus.view', 'employees.manage'];
  if (['display', 'kiosk', 'viewer'].includes(normalized)) return ['display.access'];
  return [];
}

function userPermissions(user = {}) {
  const explicit = Array.isArray(user.permissions) ? user.permissions.filter(Boolean) : [];
  return [...new Set([...rolePermissions(user.role), ...explicit])];
}

async function refreshUserSession(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.id) return next();
  try {
    const users = await readJson('users.json', []);
    const user = users.find(item => item.id === req.session.user.id);
    if (!user || user.active === false) {
      return req.session.destroy(() => next());
    }
    req.session.user = {
      ...req.session.user,
      username: user.username,
      role: user.role,
      permissions: userPermissions(user),
      mustChangePassword: !!user.mustChangePassword
    };
    req.session.cookie.maxAge = sessionLifetimeMs(req.session.user, req.session.user.permissions);
    return next();
  } catch (err) {
    return next(err);
  }
}

function hasPermission(user = {}, permission) {
  return userPermissions(user).includes(permission);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some(permission => hasPermission(user, permission));
}

function hasAnyAdminPermission(user = {}) {
  return userPermissions(user).some(permission => permission !== 'display.access');
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return requireAuth(req, res, next);
  if (!hasAnyAdminPermission(req.session.user)) {
    if ((req.originalUrl || req.path).startsWith('/api/')) return res.status(403).json({ error: 'Administrator access required' });
    return res.status(403).send('Administrator access required');
  }
  return next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return requireAuth(req, res, next);
    if (!hasPermission(req.session.user, permission)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return next();
  };
}

function requireAnyPermission(permissions) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return requireAuth(req, res, next);
    if (!hasAnyPermission(req.session.user, permissions)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return next();
  };
}

function requireGuest(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/admin/');
  return next();
}
module.exports = {
  ALL_PERMISSIONS,
  refreshUserSession,
  requireAuth,
  requireAdmin,
  requireGuest,
  requirePermission,
  requireAnyPermission,
  isDisplayRole,
  userPermissions,
  hasPermission,
  hasAnyPermission,
  hasAnyAdminPermission
};
