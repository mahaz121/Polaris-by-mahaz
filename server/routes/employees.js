const express = require('express');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const { readJson, writeJson, root } = require('../utils/dataStore');
const { emitAllDisplays, emitAdminStats } = require('../socket');
const { db, nowIso } = require('../utils/database');
const { STATUSES, normalizeStatus, effectiveEmployeeStatus } = require('../utils/status');
const router = express.Router();

const upload = multer({ storage: multer.diskStorage({
  destination: path.join(root, 'public', 'uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '')}`)
}) });

function normalizeCompanyEmailLocalPart(value = '') {
  return String(value || '')
    .trim()
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

function normalize(body, file, existing = {}) {
  const managerId = body.managerId || body.reportsToEmployeeId || '';
  return {
    employeeNumber: body.employeeNumber || '',
    name: body.name || '',
    department: body.department || '',
    designation: body.designation || '',
    phone: body.phone || '',
    email: body.email || '',
    companyEmailLocalPart: Object.prototype.hasOwnProperty.call(body, 'companyEmailLocalPart')
      ? normalizeCompanyEmailLocalPart(body.companyEmailLocalPart)
      : existing.companyEmailLocalPart || '',
    managerId: managerId === existing.id ? '' : managerId,
    reportsToEmployeeId: managerId === existing.id ? '' : managerId,
    isDepartmentManager: body.isDepartmentManager === true || body.isDepartmentManager === 'true' || body.isDepartmentManager === 'on',
    orgChartOrder: Math.max(0, Number(body.orgChartOrder || 0) || 0),
    shortDescription: body.shortDescription || '',
    extension: body.extension || '',
    displayGroup: body.displayGroup || '',
    photo: file ? `/uploads/${file.filename}` : existing.photo || '',
    qrEnabled: body.qrEnabled === true || body.qrEnabled === 'true' || body.qrEnabled === 'on',
    status: body.status === 'Inactive' ? 'Inactive' : 'Active',
    availabilityStatus: normalizeStatus(body.availabilityStatus, existing.availabilityStatus || 'Not Available')
  };
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const employees = (await readJson('employees.json', [])).map(e => ({ ...e, effectiveStatus: effectiveEmployeeStatus(e) }));
  res.json(q ? employees.filter(e => JSON.stringify(e).toLowerCase().includes(q)) : employees);
});

router.get('/statuses', (req, res) => res.json(STATUSES));

router.post('/', upload.single('photo'), async (req, res) => {
  const employees = await readJson('employees.json', []);
  const employee = { id: randomUUID(), ...normalize(req.body, req.file), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  employees.push(employee);
  await writeJson('employees.json', employees);
  await emitAllDisplays();
  await emitAdminStats();
  res.status(201).json(employee);
});

router.put('/:id', upload.single('photo'), async (req, res) => {
  const employees = await readJson('employees.json', []);
  const idx = employees.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  employees[idx] = { ...employees[idx], ...normalize(req.body, req.file, employees[idx]), updatedAt: new Date().toISOString() };
  await writeJson('employees.json', employees);
  await emitAllDisplays();
  await emitAdminStats();
  res.json(employees[idx]);
});

router.delete('/:id', async (req, res) => {
  let employees = await readJson('employees.json', []);
  employees = employees.filter(e => e.id !== req.params.id);
  let displays = await readJson('displays.json', []);
  displays = displays.map(d => d.employeeId === req.params.id ? { ...d, employeeId: '', updatedAt: new Date().toISOString() } : d);
  await writeJson('employees.json', employees);
  await writeJson('displays.json', displays);
  await emitAllDisplays();
  await emitAdminStats();
  res.json({ ok: true });
});

router.post('/:id/override', async (req, res) => {
  const employees = await readJson('employees.json', []);
  const employee = employees.find(e => e.id === req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const status = normalizeStatus(req.body.status, '');
  if (!status) return res.status(400).json({ error: 'Valid status is required' });
  const id = randomUUID();
  db.prepare(`
    INSERT INTO employee_status_overrides (id, employee_id, status, start_at, end_at, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    employee.id,
    status,
    req.body.startAt || nowIso(),
    req.body.endAt || '',
    req.body.note || '',
    nowIso(),
    nowIso()
  );
  await emitAllDisplays();
  await emitAdminStats();
  res.status(201).json({ id, employeeId: employee.id, status, startAt: req.body.startAt || nowIso(), endAt: req.body.endAt || '', note: req.body.note || '' });
});

router.delete('/:id/override', async (req, res) => {
  db.prepare('DELETE FROM employee_status_overrides WHERE employee_id = ?').run(req.params.id);
  await emitAllDisplays();
  await emitAdminStats();
  res.json({ ok: true });
});
module.exports = router;
