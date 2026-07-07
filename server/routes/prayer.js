const express = require('express');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const { readJson, writeJson, root } = require('../utils/dataStore');
const { nowIso } = require('../utils/database');
const { PRAYERS, defaultPrayers, profilePrayerState } = require('../utils/prayer');
const { emitAllDisplays } = require('../socket');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(root, 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`)
  })
});

function checked(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function listValue(value, fallback = []) {
  if (Array.isArray(value)) return value.map(Number).filter(value => Number.isInteger(value));
  if (typeof value === 'string' && value.trim()) return value.split(',').map(item => Number(item.trim())).filter(value => Number.isInteger(value));
  return fallback;
}

function normalizeProfile(body = {}, existing = {}) {
  const prayers = existing.prayers || defaultPrayers();
  PRAYERS.forEach(name => {
    const has = key => Object.prototype.hasOwnProperty.call(body, key);
    prayers[name] = {
      enabled: has(`${name}Enabled`) ? checked(body[`${name}Enabled`]) : false,
      adhan: has(`${name}Adhan`) ? checked(body[`${name}Adhan`]) : false,
      iqama: has(`${name}Iqama`) ? checked(body[`${name}Iqama`]) : false,
      iqamaMinutes: Math.max(0, Number(body[`${name}IqamaMinutes`] ?? prayers[name]?.iqamaMinutes ?? 20) || 0),
      audio: body[`${name}Audio`] || prayers[name]?.audio || '',
      iqamaAudio: body[`${name}IqamaAudio`] || prayers[name]?.iqamaAudio || ''
    };
  });
  return {
    id: existing.id || body.id || randomUUID(),
    name: body.name || existing.name || 'Prayer Profile',
    city: body.city || existing.city || 'Riyadh',
    country: body.country || existing.country || 'Saudi Arabia',
    state: body.state || existing.state || '',
    latitude: body.latitude || existing.latitude || '',
    longitude: body.longitude || existing.longitude || '',
    timezone: body.timezone || existing.timezone || 'Asia/Riyadh',
    method: Number(body.method ?? existing.method ?? 4),
    school: Number(body.school ?? existing.school ?? 0),
    enabledDays: listValue(body.enabledDays, []),
    prayers,
    weatherCity: body.weatherCity || existing.weatherCity || body.city || existing.city || 'Riyadh',
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

router.get('/profiles', async (req, res) => res.json(await readJson('prayer_profiles.json', [])));

router.post('/profiles', upload.any(), async (req, res) => {
  const profiles = await readJson('prayer_profiles.json', []);
  const profile = normalizeProfile(req.body);
  (req.files || []).forEach(file => {
    const prayer = String(file.fieldname || '').replace(/AudioFile$/, '');
    if (profile.prayers[prayer]) profile.prayers[prayer].audio = `/uploads/${file.filename}`;
    const iqamaPrayer = String(file.fieldname || '').replace(/IqamaAudioFile$/, '');
    if (profile.prayers[iqamaPrayer]) profile.prayers[iqamaPrayer].iqamaAudio = `/uploads/${file.filename}`;
  });
  profiles.push(profile);
  await writeJson('prayer_profiles.json', profiles);
  await emitAllDisplays();
  res.status(201).json(profile);
});

router.put('/profiles/:id', upload.any(), async (req, res) => {
  const profiles = await readJson('prayer_profiles.json', []);
  const idx = profiles.findIndex(profile => profile.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Prayer profile not found' });
  const profile = normalizeProfile(req.body, profiles[idx]);
  (req.files || []).forEach(file => {
    const prayer = String(file.fieldname || '').replace(/AudioFile$/, '');
    if (profile.prayers[prayer]) profile.prayers[prayer].audio = `/uploads/${file.filename}`;
    const iqamaPrayer = String(file.fieldname || '').replace(/IqamaAudioFile$/, '');
    if (profile.prayers[iqamaPrayer]) profile.prayers[iqamaPrayer].iqamaAudio = `/uploads/${file.filename}`;
  });
  profiles[idx] = profile;
  await writeJson('prayer_profiles.json', profiles);
  await emitAllDisplays();
  res.json(profile);
});

router.delete('/profiles/:id', async (req, res) => {
  await writeJson('prayer_profiles.json', (await readJson('prayer_profiles.json', [])).filter(profile => profile.id !== req.params.id));
  await emitAllDisplays();
  res.json({ ok: true });
});

router.get('/profiles/:id/today', async (req, res) => {
  const profile = (await readJson('prayer_profiles.json', [])).find(item => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Prayer profile not found' });
  try {
    res.json(await profilePrayerState(profile));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

async function buildPrayerEventSnapshot(at = new Date()) {
  const profiles = await readJson('prayer_profiles.json', []);
  const weekday = at.getDay();
  const snapshots = [];
  for (const profile of profiles.filter(profile => (profile.enabledDays || []).includes(weekday))) {
    try {
      snapshots.push({ profile, state: await profilePrayerState(profile, at) });
    } catch {}
  }
  return snapshots;
}

module.exports = { router, buildPrayerEventSnapshot };
