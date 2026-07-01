function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if ((req.originalUrl || req.path).startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
  return res.redirect('/admin/login.html');
}
function requireGuest(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/admin/');
  return next();
}
module.exports = { requireAuth, requireGuest };
