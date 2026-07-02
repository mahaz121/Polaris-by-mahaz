const ALL_PERMISSIONS = [
  'dashboard.view',
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
  if (['display', 'kiosk', 'viewer'].includes(normalized)) return ['display.access'];
  return [];
}

function userPermissions(user = {}) {
  const explicit = Array.isArray(user.permissions) ? user.permissions.filter(Boolean) : [];
  return [...new Set([...rolePermissions(user.role), ...explicit])];
}

function hasPermission(user = {}, permission) {
  return userPermissions(user).includes(permission);
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

function requireGuest(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/admin/');
  return next();
}
module.exports = {
  ALL_PERMISSIONS,
  requireAuth,
  requireAdmin,
  requireGuest,
  requirePermission,
  isDisplayRole,
  userPermissions,
  hasPermission,
  hasAnyAdminPermission
};
