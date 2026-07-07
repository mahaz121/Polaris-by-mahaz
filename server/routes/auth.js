const express = require('express');
const bcrypt = require('bcryptjs');
const { readJson, writeJson } = require('../utils/dataStore');
const { requireAuth, userPermissions } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await readJson('users.json', []);
  const user = users.find(u => u.username === username && u.active);
  if (!user) {
    audit(req, 'auth.login_failed', { username });
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  let ok = false;
  if (user.passwordHash) ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok && user.password && user.password === password) {
    ok = true;
    user.passwordHash = await bcrypt.hash(password, 10);
    delete user.password;
    await writeJson('users.json', users);
  }
  if (!ok) {
    audit(req, 'auth.login_failed', { username });
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: userPermissions(user),
      mustChangePassword: !!user.mustChangePassword
    };
    audit(req, 'auth.login_success', { userId: user.id, username: user.username });
    res.json({ ok: true, user: req.session.user, mustChangePassword: !!user.mustChangePassword });
  });
});

router.post('/logout', requireAuth, (req, res) => {
  audit(req, 'auth.logout');
  req.session.destroy(() => res.json({ ok: true }));
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  }
  const users = await readJson('users.json', []);
  const idx = users.findIndex(u => u.id === req.session.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(currentPassword || '', users[idx].passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
  users[idx].mustChangePassword = false;
  users[idx].updatedAt = new Date().toISOString();
  await writeJson('users.json', users);
  audit(req, 'auth.change_password', { userId: users[idx].id });
  req.session.user.mustChangePassword = false;
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json({ user: req.session.user || null }));
module.exports = router;
