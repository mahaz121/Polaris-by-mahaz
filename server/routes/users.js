const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { readJson, writeJson } = require('../utils/dataStore');
const router = express.Router();

router.get('/', async (req, res) => res.json((await readJson('users.json', [])).map(({ passwordHash, ...u }) => u)));
router.post('/', async (req, res) => {
  const users = await readJson('users.json', []);
  if (!req.body.username || !req.body.password) return res.status(400).json({ error: 'Username and password are required' });
  if (users.some(u => u.username === req.body.username)) return res.status(409).json({ error: 'Username already exists' });
  const user = { id: randomUUID(), username: req.body.username, passwordHash: await bcrypt.hash(req.body.password, 10), role: req.body.role || 'Administrator', active: req.body.active !== false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  users.push(user);
  await writeJson('users.json', users);
  const { passwordHash, ...safe } = user;
  res.status(201).json(safe);
});
router.put('/:id', async (req, res) => {
  const users = await readJson('users.json', []);
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].username = req.body.username || users[idx].username;
  users[idx].role = req.body.role || users[idx].role;
  users[idx].active = req.body.active === undefined ? users[idx].active : !!req.body.active;
  if (req.body.password) users[idx].passwordHash = await bcrypt.hash(req.body.password, 10);
  users[idx].updatedAt = new Date().toISOString();
  await writeJson('users.json', users);
  const { passwordHash, ...safe } = users[idx];
  res.json(safe);
});
router.delete('/:id', async (req, res) => {
  const users = (await readJson('users.json', [])).filter(u => u.id !== req.params.id);
  await writeJson('users.json', users);
  res.json({ ok: true });
});
module.exports = router;
