const express = require('express');
const { randomUUID } = require('crypto');
const { readJson, writeJson } = require('../utils/dataStore');
const { db, nowIso } = require('../utils/database');
const { effectiveEmployeeStatus } = require('../utils/status');
const { emitDisplayUpdate, emitAdminStats } = require('../socket');
const router = express.Router();
const checked = value => value === true || value === 'true' || value === 'on';
const rotationIds = value => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
};
const rotationInterval = value => Math.max(5, Number(value || 30) || 30);
const jsonList = value => {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
    } catch {}
    return value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  }
  return [];
};
const departmentLayout = value => {
  const input = typeof value === 'string' && value.trim() ? (() => {
    try { return JSON.parse(value); } catch { return []; }
  })() : value;
  if (!Array.isArray(input)) return [];
  return input
    .map(item => ({
      departmentName: String(item.departmentName || item.name || '').trim(),
      displayOrder: Math.max(0, Number(item.displayOrder || item.order || 0) || 0)
    }))
    .filter(item => item.departmentName);
};
const employeeOrderByDepartment = value => {
  const input = typeof value === 'string' && value.trim() ? (() => {
    try { return JSON.parse(value); } catch { return {}; }
  })() : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).map(([department, ids]) => [
    String(department || '').trim(),
    Array.isArray(ids) ? ids.map(id => String(id || '').trim()).filter(Boolean) : []
  ]).filter(([department]) => department));
};
const displayModeValue = value => ['overview', 'orgchart'].includes(value) ? value : 'single';
const rootModeValue = value => ['ceo', 'department_managers', 'custom'].includes(value) ? value : 'department_managers';

router.get('/', async (req, res) => res.json(await readJson('displays.json', [])));
router.get('/available', async (req, res) => res.json((await readJson('displays.json', [])).map(d => ({ id: d.id, name: d.name }))));

router.get('/:id/employees', async (req, res) => {
  const displays = await readJson('displays.json', []);
  if (!displays.some(d => d.id === req.params.id)) return res.status(404).json({ error: 'Display not found' });
  const employees = await readJson('employees.json', []);
  const assignedRows = db.prepare('SELECT employee_id, sort_order FROM display_employee_assignments WHERE display_id = ?').all(req.params.id);
  const assignedOrder = new Map(assignedRows.map(row => [row.employee_id, row.sort_order]));
  res.json(employees.map(employee => ({
    ...employee,
    assigned: assignedOrder.has(employee.id),
    assignedSortOrder: assignedOrder.has(employee.id) ? assignedOrder.get(employee.id) : '',
    effectiveStatus: effectiveEmployeeStatus(employee)
  })).sort((a, b) => {
    const aAssigned = assignedOrder.has(a.id);
    const bAssigned = assignedOrder.has(b.id);
    if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
    if (aAssigned && bAssigned) return Number(a.assignedSortOrder) - Number(b.assignedSortOrder);
    return (a.name || '').localeCompare(b.name || '');
  }));
});

router.put('/:id/employees', async (req, res) => {
  const displays = await readJson('displays.json', []);
  if (!displays.some(d => d.id === req.params.id)) return res.status(404).json({ error: 'Display not found' });
  const employeeIds = Array.isArray(req.body.employeeIds) ? req.body.employeeIds.filter(Boolean) : [];
  const valid = new Set((await readJson('employees.json', [])).map(e => e.id));
  const tx = db.transaction(ids => {
    db.prepare('DELETE FROM display_employee_assignments WHERE display_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT INTO display_employee_assignments (display_id, employee_id, sort_order, created_at) VALUES (?, ?, ?, ?)');
    ids.filter(id => valid.has(id)).forEach((employeeId, index) => stmt.run(req.params.id, employeeId, index, nowIso()));
  });
  tx(employeeIds);
  const display = displays.find(d => d.id === req.params.id);
  if (display) {
    const nextDisplays = displays.map(item => item.id === req.params.id ? { ...item, overviewEmployeeOrder: employeeIds, updatedAt: new Date().toISOString() } : item);
    await writeJson('displays.json', nextDisplays);
  }
  await emitDisplayUpdate(req.params.id);
  await emitAdminStats();
  res.json({ ok: true, count: employeeIds.filter(id => valid.has(id)).length });
});

router.post('/', async (req, res) => {
  const displays = await readJson('displays.json', []);
  const id = (req.body.id || randomUUID()).trim().replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const displayMode = displayModeValue(req.body.displayMode);
  if (!id) return res.status(400).json({ error: 'Display ID is required' });
  if (displays.some(d => d.id === id)) return res.status(409).json({ error: 'Display ID already exists' });
  const display = {
    id,
    name: req.body.name || id,
    employeeId: displayMode === 'single' ? req.body.employeeId || '' : '',
    displayMode,
    displayGroup: req.body.displayGroup || '',
    roomNumber: req.body.roomNumber || '',
    showRoomNumber: checked(req.body.showRoomNumber),
    showPhoneNumber: displayMode === 'single' ? checked(req.body.showPhoneNumber) : false,
    cubicleNumber: req.body.cubicleNumber || '',
    showCubicleNumber: checked(req.body.showCubicleNumber),
    rotateCompanyProfiles: checked(req.body.rotateCompanyProfiles),
    rotationIntervalSeconds: rotationInterval(req.body.rotationIntervalSeconds),
    rotationCompanyProfileIds: rotationIds(req.body.rotationCompanyProfileIds),
    overviewShowCompanyName: req.body.overviewShowCompanyName === undefined ? true : checked(req.body.overviewShowCompanyName),
    overviewDepartmentOrder: jsonList(req.body.overviewDepartmentOrder),
    overviewDepartmentLayout: departmentLayout(req.body.overviewDepartmentLayout),
    overviewEmployeeOrder: jsonList(req.body.overviewEmployeeOrder),
    overviewEmployeeOrderByDepartment: employeeOrderByDepartment(req.body.overviewEmployeeOrderByDepartment),
    orgChartRootMode: rootModeValue(req.body.orgChartRootMode),
    orgChartShowPhotos: req.body.orgChartShowPhotos === undefined ? true : checked(req.body.orgChartShowPhotos),
    orgChartAnimationEnabled: req.body.orgChartAnimationEnabled === undefined ? true : checked(req.body.orgChartAnimationEnabled),
    orgChartAutoResetSeconds: Math.max(0, Number(req.body.orgChartAutoResetSeconds || 60) || 60),
    orgChartManagerFocusSeconds: Math.max(1, Number(req.body.orgChartManagerFocusSeconds || 10) || 10),
    orgChartSelectedEmployeeIds: jsonList(req.body.orgChartSelectedEmployeeIds),
    orgChartIncludedDepartmentIds: jsonList(req.body.orgChartIncludedDepartmentIds),
    status: 'Offline',
    lastSeen: '',
    ipAddress: '',
    resolution: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  displays.push(display);
  await writeJson('displays.json', displays);
  await emitAdminStats();
  res.status(201).json(display);
});

router.put('/:id', async (req, res) => {
  const displays = await readJson('displays.json', []);
  const idx = displays.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Display not found' });
  const displayMode = displayModeValue(req.body.displayMode);
  displays[idx] = {
    ...displays[idx],
    name: req.body.name || displays[idx].name,
    employeeId: displayMode === 'single' ? req.body.employeeId || '' : '',
    displayMode,
    displayGroup: req.body.displayGroup || '',
    roomNumber: req.body.roomNumber || '',
    showRoomNumber: checked(req.body.showRoomNumber),
    showPhoneNumber: displayMode === 'single' ? checked(req.body.showPhoneNumber) : false,
    cubicleNumber: req.body.cubicleNumber || '',
    showCubicleNumber: checked(req.body.showCubicleNumber),
    rotateCompanyProfiles: checked(req.body.rotateCompanyProfiles),
    rotationIntervalSeconds: rotationInterval(req.body.rotationIntervalSeconds),
    rotationCompanyProfileIds: rotationIds(req.body.rotationCompanyProfileIds),
    overviewShowCompanyName: req.body.overviewShowCompanyName === undefined ? displays[idx].overviewShowCompanyName !== false : checked(req.body.overviewShowCompanyName),
    overviewDepartmentOrder: req.body.overviewDepartmentOrder === undefined ? displays[idx].overviewDepartmentOrder || [] : jsonList(req.body.overviewDepartmentOrder),
    overviewDepartmentLayout: req.body.overviewDepartmentLayout === undefined ? displays[idx].overviewDepartmentLayout || [] : departmentLayout(req.body.overviewDepartmentLayout),
    overviewEmployeeOrder: req.body.overviewEmployeeOrder === undefined ? displays[idx].overviewEmployeeOrder || [] : jsonList(req.body.overviewEmployeeOrder),
    overviewEmployeeOrderByDepartment: req.body.overviewEmployeeOrderByDepartment === undefined ? displays[idx].overviewEmployeeOrderByDepartment || {} : employeeOrderByDepartment(req.body.overviewEmployeeOrderByDepartment),
    orgChartRootMode: req.body.orgChartRootMode === undefined ? displays[idx].orgChartRootMode || 'department_managers' : rootModeValue(req.body.orgChartRootMode),
    orgChartShowPhotos: req.body.orgChartShowPhotos === undefined ? displays[idx].orgChartShowPhotos !== false : checked(req.body.orgChartShowPhotos),
    orgChartAnimationEnabled: req.body.orgChartAnimationEnabled === undefined ? displays[idx].orgChartAnimationEnabled !== false : checked(req.body.orgChartAnimationEnabled),
    orgChartAutoResetSeconds: req.body.orgChartAutoResetSeconds === undefined ? Number(displays[idx].orgChartAutoResetSeconds || 60) : Math.max(0, Number(req.body.orgChartAutoResetSeconds || 60) || 60),
    orgChartManagerFocusSeconds: req.body.orgChartManagerFocusSeconds === undefined ? Number(displays[idx].orgChartManagerFocusSeconds || 10) : Math.max(1, Number(req.body.orgChartManagerFocusSeconds || 10) || 10),
    orgChartSelectedEmployeeIds: req.body.orgChartSelectedEmployeeIds === undefined ? displays[idx].orgChartSelectedEmployeeIds || [] : jsonList(req.body.orgChartSelectedEmployeeIds),
    orgChartIncludedDepartmentIds: req.body.orgChartIncludedDepartmentIds === undefined ? displays[idx].orgChartIncludedDepartmentIds || [] : jsonList(req.body.orgChartIncludedDepartmentIds),
    updatedAt: new Date().toISOString()
  };
  await writeJson('displays.json', displays);
  await emitDisplayUpdate(req.params.id);
  await emitAdminStats();
  res.json(displays[idx]);
});

router.delete('/:id', async (req, res) => {
  const displays = (await readJson('displays.json', [])).filter(d => d.id !== req.params.id);
  await writeJson('displays.json', displays);
  await emitAdminStats();
  res.json({ ok: true });
});
module.exports = router;
