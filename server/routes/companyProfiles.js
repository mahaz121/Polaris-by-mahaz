const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  root,
  listCompanyProfiles,
  getActiveCompanyProfile,
  createCompanyProfile,
  updateCompanyProfile,
  deleteCompanyProfile,
  activateCompanyProfile
} = require('../utils/dataStore');
const { requireAuth } = require('../middleware/auth');
const { emitCompanyProfileChanged } = require('../socket');

const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(root, 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '')}`)
  })
});

function bodyProfile(req) {
  const emailDomain = String(req.body.emailDomain || '').trim().replace(/^@+/, '').toLowerCase();
  const offDays = Array.isArray(req.body.offDays)
    ? req.body.offDays
    : String(req.body.offDays || '').split(',').map(item => item.trim()).filter(Boolean);
  return {
    name: req.body.name || '',
    logo: req.file ? `/uploads/${req.file.filename}` : undefined,
    primaryColor: req.body.primaryColor || '',
    secondaryColor: req.body.secondaryColor || '',
    accentColor: req.body.accentColor || '',
    backgroundStyle: req.body.backgroundStyle || 'default',
    displayFont: req.body.displayFont || req.body.defaultFont || '',
    clockFormat: req.body.clockFormat || '24',
    language: req.body.language || 'English',
    companyPhone: req.body.companyPhone ?? req.body.phone,
    companyEmail: req.body.companyEmail ?? req.body.email,
    companyWebsite: req.body.companyWebsite ?? req.body.website,
    companyAddress: req.body.companyAddress ?? req.body.address,
    officeStartTime: req.body.officeStartTime || '07:30',
    officeEndTime: req.body.officeEndTime || '16:00',
    latestArrivalTime: req.body.latestArrivalTime || '08:30',
    offDays,
    emailDomain
  };
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

router.get('/active', (req, res) => {
  const profile = getActiveCompanyProfile(false);
  if (!profile) return res.status(404).json({ error: 'No active company profile' });
  res.json(profile);
});

router.get('/', requireAuth, (req, res) => res.json(listCompanyProfiles(true)));

router.post('/', requireAuth, upload.single('logo'), async (req, res) => {
  const profile = createCompanyProfile(cleanUndefined(bodyProfile(req)));
  await emitCompanyProfileChanged(getActiveCompanyProfile(false));
  res.status(201).json(profile);
});

router.put('/:id', requireAuth, upload.single('logo'), async (req, res) => {
  const profile = updateCompanyProfile(req.params.id, cleanUndefined(bodyProfile(req)));
  if (!profile) return res.status(404).json({ error: 'Company profile not found' });
  await emitCompanyProfileChanged(getActiveCompanyProfile(false));
  res.json(profile);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const ok = deleteCompanyProfile(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Active company profile cannot be deleted' });
  await emitCompanyProfileChanged(getActiveCompanyProfile(false));
  res.json({ ok: true });
});

router.post('/:id/activate', requireAuth, async (req, res) => {
  const profile = activateCompanyProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Company profile not found' });
  await emitCompanyProfileChanged(getActiveCompanyProfile(false));
  res.json(profile);
});

module.exports = router;
