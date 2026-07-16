const readExcelFile = require('read-excel-file/node');
const { randomUUID } = require('crypto');

const REQUIRED_HEADERS = {
  department: ['department'],
  name: ['employeename'],
  designation: ['designation'],
  employeeNumber: ['employeeid', 'employeenumber']
};

class EmployeeImportValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'EmployeeImportValidationError';
    this.details = details;
  }
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function headerKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function employeeNumberValue(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return '';
    return String(value);
  }
  return cleanText(value);
}

function headerIndexes(row) {
  const available = new Map();
  row.forEach((value, columnIndex) => {
    const key = headerKey(value);
    if (key && !available.has(key)) available.set(key, columnIndex);
  });
  const indexes = {};
  for (const [field, aliases] of Object.entries(REQUIRED_HEADERS)) {
    const alias = aliases.find(item => available.has(item));
    if (!alias) return null;
    indexes[field] = available.get(alias);
  }
  return indexes;
}

function validationMessage(details) {
  const preview = details.slice(0, 5).join('; ');
  const remaining = details.length > 5 ? `; plus ${details.length - 5} more` : '';
  return `Import validation failed: ${preview}${remaining}`;
}

async function parseEmployeeWorkbook(buffer) {
  let sheets;
  try {
    sheets = await readExcelFile(buffer);
  } catch {
    throw new EmployeeImportValidationError('The selected file is not a valid .xlsx workbook.');
  }

  let selectedSheet = null;
  let headerRowNumber = 0;
  let indexes = null;
  for (const candidate of sheets) {
    const lastHeaderCandidate = Math.min(candidate.data.length, 10);
    for (let rowIndex = 0; rowIndex < lastHeaderCandidate; rowIndex += 1) {
      const found = headerIndexes(candidate.data[rowIndex] || []);
      if (found) {
        selectedSheet = candidate;
        headerRowNumber = rowIndex + 1;
        indexes = found;
        break;
      }
    }
    if (selectedSheet) break;
  }

  if (!selectedSheet) {
    throw new EmployeeImportValidationError('Required columns were not found. Use Department, Employee Name, Designation, and Employee ID.');
  }

  return parseEmployeeRows(selectedSheet.data, indexes, headerRowNumber, selectedSheet.sheet);
}

function parseEmployeeRows(data, indexes, headerRowNumber = 1, sheetName = 'Sheet1') {
  const rows = [];
  const errors = [];
  const seenEmployeeNumbers = new Map();
  const lastRow = data.length;
  if (lastRow - headerRowNumber > 10000) {
    throw new EmployeeImportValidationError('A maximum of 10,000 employee rows can be imported at once.');
  }

  for (let rowIndex = headerRowNumber; rowIndex < lastRow; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const row = data[rowIndex] || [];
    const department = cleanText(row[indexes.department]);
    const name = cleanText(row[indexes.name]);
    const designation = cleanText(row[indexes.designation]);
    const employeeNumber = employeeNumberValue(row[indexes.employeeNumber]);
    if (!department && !name && !designation && !employeeNumber) continue;

    if (!employeeNumber) errors.push(`row ${rowNumber} has no valid Employee ID`);
    if (!name) errors.push(`row ${rowNumber} has no Employee Name`);
    if (employeeNumber.length > 100) errors.push(`row ${rowNumber} Employee ID is too long`);
    if (name.length > 300) errors.push(`row ${rowNumber} Employee Name is too long`);
    if (department.length > 200) errors.push(`row ${rowNumber} Department is too long`);
    if (designation.length > 300) errors.push(`row ${rowNumber} Designation is too long`);
    if (employeeNumber) {
      if (seenEmployeeNumbers.has(employeeNumber)) {
        errors.push(`rows ${seenEmployeeNumbers.get(employeeNumber)} and ${rowNumber} use the same Employee ID ${employeeNumber}`);
      } else {
        seenEmployeeNumbers.set(employeeNumber, rowNumber);
      }
    }
    rows.push({ rowNumber, employeeNumber, name, department, designation });
  }

  if (!rows.length) errors.push('the workbook has no employee rows');
  if (errors.length) throw new EmployeeImportValidationError(validationMessage(errors), errors);
  return { sheetName, rows };
}

function importEmployeeRows(db, rows) {
  const existingByNumber = new Map();
  for (const employee of db.prepare(`
    SELECT id, employee_number, name, department, designation
    FROM employees
    WHERE TRIM(COALESCE(employee_number, '')) <> ''
  `).all()) {
    const employeeNumber = cleanText(employee.employee_number);
    if (!existingByNumber.has(employeeNumber)) existingByNumber.set(employeeNumber, []);
    existingByNumber.get(employeeNumber).push(employee);
  }

  const conflicts = rows
    .filter(row => (existingByNumber.get(row.employeeNumber) || []).length > 1)
    .map(row => `Employee ID ${row.employeeNumber} matches multiple existing employees`);
  if (conflicts.length) throw new EmployeeImportValidationError(validationMessage(conflicts), conflicts);

  const existingDepartments = new Set(db.prepare('SELECT name FROM departments').all().map(row => cleanText(row.name).toLowerCase()));
  let nextDepartmentOrder = Number(db.prepare('SELECT COALESCE(MAX(display_order), 0) AS value FROM departments').get().value || 0);
  const stamp = new Date().toISOString();
  const result = { created: 0, updated: 0, unchanged: 0, departmentsCreated: 0, total: rows.length };

  const insertDepartment = db.prepare(`
    INSERT OR IGNORE INTO departments (id, name, short_name, manager_employee_id, display_order, active, created_at, updated_at)
    VALUES (?, ?, '', '', ?, 1, ?, ?)
  `);
  const activateDepartment = db.prepare('UPDATE departments SET active = 1, updated_at = ? WHERE name = ? AND active = 0');
  const insertEmployee = db.prepare(`
    INSERT INTO employees
      (id, employee_number, name, department, designation, qr_enabled, status, availability_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 'Active', 'Not Available', ?, ?)
  `);
  const updateEmployee = db.prepare(`
    UPDATE employees
    SET name = ?, department = ?, designation = ?, updated_at = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    for (const row of rows) {
      if (row.department) {
        const departmentKey = row.department.toLowerCase();
        if (!existingDepartments.has(departmentKey)) {
          nextDepartmentOrder += 1;
          const change = insertDepartment.run(randomUUID(), row.department, nextDepartmentOrder, stamp, stamp);
          if (change.changes) {
            result.departmentsCreated += 1;
            existingDepartments.add(departmentKey);
          }
        } else {
          activateDepartment.run(stamp, row.department);
        }
      }

      const existing = (existingByNumber.get(row.employeeNumber) || [])[0];
      if (!existing) {
        insertEmployee.run(randomUUID(), row.employeeNumber, row.name, row.department, row.designation, stamp, stamp);
        result.created += 1;
        continue;
      }
      if (
        cleanText(existing.name) === row.name &&
        cleanText(existing.department) === row.department &&
        cleanText(existing.designation) === row.designation
      ) {
        result.unchanged += 1;
        continue;
      }
      updateEmployee.run(row.name, row.department, row.designation, stamp, existing.id);
      result.updated += 1;
    }
  });
  transaction();
  return result;
}

module.exports = {
  EmployeeImportValidationError,
  importEmployeeRows,
  parseEmployeeWorkbook,
  parseEmployeeRows
};
