const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { importEmployeeRows, parseEmployeeRows } = require('../server/utils/employeeImport');

function testDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE employees (
      id TEXT PRIMARY KEY,
      employee_number TEXT,
      name TEXT NOT NULL,
      department TEXT,
      designation TEXT,
      manager_id TEXT,
      qr_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Active',
      availability_status TEXT NOT NULL DEFAULT 'Not Available',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      short_name TEXT,
      manager_employee_id TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

test('parses the four required columns and ignores Company and Manager', () => {
  const data = [
    ['Company', 'Department', 'Employee Name', 'Designation', 'Manager', 'Employee ID'],
    ['Ignored Co', 'Operations', 'Jane Doe', 'Engineer', 'Ignored Manager', 1001]
  ];
  const parsed = parseEmployeeRows(data, { department: 1, name: 2, designation: 3, employeeNumber: 5 });
  assert.deepEqual(parsed.rows, [{
    rowNumber: 2,
    employeeNumber: '1001',
    name: 'Jane Doe',
    department: 'Operations',
    designation: 'Engineer'
  }]);
});

test('creates and updates by Employee ID while preserving manager links', () => {
  const db = testDatabase();
  const stamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO employees (id, employee_number, name, department, designation, manager_id, created_at, updated_at)
    VALUES ('existing-id', '1001', 'Old Name', 'Old Department', 'Old Role', 'manager-id', ?, ?)
  `).run(stamp, stamp);

  const result = importEmployeeRows(db, [
    { employeeNumber: '1001', name: 'Jane Doe', department: 'Operations', designation: 'Engineer' },
    { employeeNumber: '1002', name: 'John Doe', department: 'Operations', designation: 'Analyst' }
  ]);

  assert.deepEqual(result, { created: 1, updated: 1, unchanged: 0, departmentsCreated: 1, total: 2 });
  assert.equal(db.prepare("SELECT manager_id FROM employees WHERE employee_number = '1001'").get().manager_id, 'manager-id');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM employees').get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM departments WHERE name = 'Operations'").get().count, 1);

  const repeat = importEmployeeRows(db, [
    { employeeNumber: '1001', name: 'Jane Doe', department: 'Operations', designation: 'Engineer' },
    { employeeNumber: '1002', name: 'John Doe', department: 'Operations', designation: 'Analyst' }
  ]);
  assert.deepEqual(repeat, { created: 0, updated: 0, unchanged: 2, departmentsCreated: 0, total: 2 });
  db.close();
});

test('rejects duplicate Employee IDs before import', () => {
  const data = [
    ['Department', 'Employee Name', 'Designation', 'Employee ID'],
    ['Operations', 'Jane Doe', 'Engineer', '1001'],
    ['Finance', 'Janet Doe', 'Accountant', '1001']
  ];
  assert.throws(() => parseEmployeeRows(data, { department: 0, name: 1, designation: 2, employeeNumber: 3 }), /same Employee ID 1001/);
});
