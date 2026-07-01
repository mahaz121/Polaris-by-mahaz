const express = require('express');
const { randomUUID } = require('crypto');
const { db, nowIso, mapDepartment } = require('../utils/database');
const { emitAllDisplays, emitAdminStats } = require('../socket');

const router = express.Router();

function normalize(body = {}, existing = {}) {
  return {
    name: String(body.name || existing.name || '').trim(),
    shortName: String(body.shortName || '').trim(),
    managerEmployeeId: String(body.managerEmployeeId || '').trim(),
    active: body.active === undefined ? existing.active !== false : body.active === true || body.active === 'true' || body.active === 'on'
  };
}

function departmentInUse(name) {
  return !!db.prepare('SELECT 1 FROM employees WHERE department = ? LIMIT 1').get(name);
}

function serializeDepartment(row, employeeCount = 0) {
  const department = mapDepartment(row);
  if (!department) return department;
  delete department.displayOrder;
  return { ...department, employeeCount };
}

router.get('/', (req, res) => {
  const counts = new Map(db.prepare(`
    SELECT department, COUNT(*) AS count
    FROM employees
    WHERE TRIM(COALESCE(department, '')) <> ''
    GROUP BY department
  `).all().map(row => [row.department, row.count]));
  res.json(db.prepare('SELECT * FROM departments ORDER BY name COLLATE NOCASE').all().map(row => serializeDepartment(row, counts.get(row.name) || 0)));
});

router.post('/', async (req, res) => {
  const data = normalize(req.body);
  if (!data.name) return res.status(400).json({ error: 'Department name is required' });
  const id = randomUUID();
  const stamp = nowIso();
  try {
    db.prepare(`
      INSERT INTO departments (id, name, short_name, manager_employee_id, display_order, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.shortName, data.managerEmployeeId, 0, data.active ? 1 : 0, stamp, stamp);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Department already exists' });
    throw err;
  }
  await emitAllDisplays();
  await emitAdminStats();
  res.status(201).json(serializeDepartment(db.prepare('SELECT * FROM departments WHERE id = ?').get(id)));
});

router.put('/:id', async (req, res) => {
  const existing = mapDepartment(db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  const data = normalize(req.body, existing);
  if (!data.name) return res.status(400).json({ error: 'Department name is required' });
  const stamp = nowIso();
  try {
    db.prepare(`
      UPDATE departments
      SET name = ?, short_name = ?, manager_employee_id = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(data.name, data.shortName, data.managerEmployeeId, data.active ? 1 : 0, stamp, req.params.id);
    if (existing.name !== data.name) {
      db.prepare('UPDATE employees SET department = ?, updated_at = ? WHERE department = ?').run(data.name, stamp, existing.name);
    }
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Department already exists' });
    throw err;
  }
  await emitAllDisplays();
  await emitAdminStats();
  const count = db.prepare('SELECT COUNT(*) AS count FROM employees WHERE department = ?').get(data.name).count || 0;
  res.json(serializeDepartment(db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id), count));
});

router.delete('/:id', async (req, res) => {
  const existing = mapDepartment(db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  if (departmentInUse(existing.name)) {
    db.prepare('UPDATE departments SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
    await emitAllDisplays();
    await emitAdminStats();
    return res.json({ ok: true, archived: true });
  }
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  await emitAllDisplays();
  await emitAdminStats();
  res.json({ ok: true, deleted: true });
});

module.exports = router;
