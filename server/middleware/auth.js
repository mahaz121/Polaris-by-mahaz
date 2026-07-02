function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if ((req.originalUrl || req.path).startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
  return res.redirect(`/admin/login.html?next=${encodeURIComponent(req.originalUrl || req.url || '/admin/')}`);
}

function isDisplayRole(user = {}) {
  return ['display', 'kiosk', 'viewer'].includes(String(user.role || '').trim().toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return requireAuth(req, res, next);
  if (isDisplayRole(req.session.user)) {
    if ((req.originalUrl || req.path).startsWith('/api/')) return res.status(403).json({ error: 'Administrator access required' });
    return res.status(403).send('Administrator access required');
  }
  return next();
}

function requireGuest(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/admin/');
  return next();
}
module.exports = { requireAuth, requireAdmin, requireGuest, isDisplayRole };
