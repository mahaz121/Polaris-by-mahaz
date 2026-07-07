const QRCode = require('qrcode');
const { readJson } = require('./dataStore');
const { db, listCompanyProfiles } = require('./database');
const { employeeVCard, companyVCard, hasCompanyContact } = require('./vcard');
const { effectiveEmployeeStatus } = require('./status');
const { profilePrayerState } = require('./prayer');

function publicSettings(settings) {
  const clean = JSON.parse(JSON.stringify(settings || {}));
  if (clean.weather) delete clean.weather.apiKey;
  if (clean.company) delete clean.company.notice;
  return clean;
}

function computedCompanyEmail(employee, company = {}) {
  if (!employee) return employee;
  const domain = String(company.emailDomain || '').trim().replace(/^@+/, '');
  const localPart = String(employee.companyEmailLocalPart || '').trim().replace(/@.*$/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (localPart && domain) return `${localPart}@${domain}`;
  if (localPart) return localPart;
  return employee.email || '';
}

function withDisplayEmail(employee, company = {}) {
  if (!employee) return employee;
  const computedEmail = computedCompanyEmail(employee, company);
  return {
    ...employee,
    computedCompanyEmail: computedEmail,
    displayEmail: computedEmail
  };
}

function displayLocationForOverview(display = {}) {
  const rows = [];
  if (display.name) rows.push(display.name);
  if (display.showCubicleNumber && display.cubicleNumber) rows.push(`Cubicle ${display.cubicleNumber}`);
  return rows.join('\n');
}

function orderEmployeesForOverview(employees = [], display = {}) {
  const sourceIndex = new Map(employees.map((employee, index) => [employee.id, index]));
  const order = new Map((Array.isArray(display.overviewEmployeeOrder) ? display.overviewEmployeeOrder : []).map((id, index) => [id, index]));
  return [...employees].sort((a, b) => {
    const aOrder = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (sourceIndex.get(a.id) || 0) - (sourceIndex.get(b.id) || 0);
  });
}

function publicCompanyProfile(profile = {}) {
  return {
    id: profile.id,
    name: profile.name || '',
    logo: profile.logo || '',
    primaryColor: profile.primaryColor || '',
    secondaryColor: profile.secondaryColor || '',
    accentColor: profile.accentColor || profile.secondaryColor || profile.primaryColor || '',
    displayFont: profile.displayFont || profile.defaultFont || '',
    defaultFont: profile.defaultFont || profile.displayFont || ''
  };
}

function isOrgLeader(employee = {}) {
  return /\bceo\b/i.test(employee.designation || '') || /^ceo$/i.test((employee.department || '').trim());
}

function publicOrgEmployee(employee = {}) {
  const effective = effectiveEmployeeStatus(employee);
  return {
    id: employee.id,
    name: employee.name || '',
    department: employee.department || '',
    designation: employee.designation || '',
    photo: employee.photo || '',
    managerId: employee.managerId || employee.reportsToEmployeeId || '',
    reportsToEmployeeId: employee.managerId || employee.reportsToEmployeeId || '',
    isDepartmentManager: !!employee.isDepartmentManager,
    orgChartOrder: Number(employee.orgChartOrder || 0),
    shortDescription: employee.shortDescription || '',
    effectiveStatus: effective,
    availabilityStatus: effective.status || employee.availabilityStatus || 'Not Available'
  };
}

function orgChartRootIds(employees = [], display = {}) {
  const active = employees.filter(employee => employee.status === 'Active');
  const selected = Array.isArray(display.orgChartSelectedEmployeeIds) ? display.orgChartSelectedEmployeeIds.filter(Boolean) : [];
  if (display.orgChartRootMode === 'custom' && selected.length) return selected;
  const leaders = active.filter(isOrgLeader);
  if (display.orgChartRootMode === 'ceo' && leaders.length) return leaders.map(employee => employee.id);
  const managers = active.filter(employee => employee.isDepartmentManager);
  if (leaders.length && managers.length) return [...new Set([...leaders.map(employee => employee.id), ...managers.map(employee => employee.id)])];
  if (leaders.length) return leaders.map(employee => employee.id);
  if (managers.length) return managers.map(employee => employee.id);
  const seenDepartments = new Set();
  return active.filter(employee => {
    const department = employee.department || 'Unassigned Department';
    if (seenDepartments.has(department)) return false;
    seenDepartments.add(department);
    return true;
  }).map(employee => employee.id);
}

function orgChartDepartments(employees = [], departments = [], display = {}) {
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  const includedDepartmentIds = new Set(Array.isArray(display.orgChartIncludedDepartmentIds) ? display.orgChartIncludedDepartmentIds.filter(Boolean) : []);
  const activeDepartments = (departments || [])
    .filter(department => department.active !== false)
    .filter(department => !includedDepartmentIds.size || includedDepartmentIds.has(department.id));
  const knownNames = new Set(activeDepartments.map(department => department.name));
  const fallbackDepartments = includedDepartmentIds.size ? [] : [...new Set(employees.map(employee => employee.department || 'Unassigned Department').filter(name => !knownNames.has(name)))]
    .map(name => ({ id: name, name, shortName: '', managerEmployeeId: '' }));
  return [...activeDepartments, ...fallbackDepartments].map(department => {
    const departmentEmployees = employees.filter(employee => (employee.department || 'Unassigned Department') === department.name);
    const configuredManager = byId.get(department.managerEmployeeId || '');
    const markedManager = departmentEmployees.find(employee => employee.isDepartmentManager);
    const manager = configuredManager || markedManager || departmentEmployees[0] || null;
    const members = departmentEmployees.filter(employee => employee.id !== manager?.id);
    return {
      id: department.id || department.name,
      name: department.name || 'Unassigned Department',
      shortName: department.shortName || '',
      manager: manager ? publicOrgEmployee(manager) : null,
      employees: members.map(publicOrgEmployee)
    };
  }).filter(department => department.manager || department.employees.length);
}

function overviewRotationProfiles(display = {}) {
  if (!display.rotateCompanyProfiles) return [];
  const selected = new Set(Array.isArray(display.rotationCompanyProfileIds) ? display.rotationCompanyProfileIds : []);
  if (!selected.size) return [];
  return listCompanyProfiles(false)
    .filter(profile => selected.has(profile.id))
    .map(publicCompanyProfile);
}

async function buildDisplayPayload(displayId, includeQr = true) {
  const [employees, displays, departments, settings] = await Promise.all([
    readJson('employees.json', []),
    readJson('displays.json', []),
    readJson('departments.json', []),
    readJson('settings.json', {})
  ]);
  const display = displays.find(d => d.id === displayId);
  if (!display) return null;
  if (display.displayMode === 'orgchart') {
    const selectedIds = new Set(Array.isArray(display.orgChartSelectedEmployeeIds) ? display.orgChartSelectedEmployeeIds.filter(Boolean) : []);
    const employeesForChart = employees
      .filter(employee => employee.status === 'Active')
      .filter(employee => !selectedIds.size || selectedIds.has(employee.id))
      .sort((a, b) => {
        const aOrder = Number(a.orgChartOrder || 0);
        const bOrder = Number(b.orgChartOrder || 0);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.name || '').localeCompare(b.name || '');
      });
    return {
      display,
      employees: [],
      employee: null,
      settings: publicSettings(settings),
      weather: settings.weather?.data || null,
      qr: '',
      orgChart: {
        employees: employeesForChart.map(publicOrgEmployee),
        rootIds: orgChartRootIds(employeesForChart, display),
        topEmployees: employeesForChart.filter(isOrgLeader).map(publicOrgEmployee),
        departments: orgChartDepartments(employeesForChart, departments, display)
      },
      rotationCompanies: overviewRotationProfiles(display)
    };
  }
  if (display.displayMode === 'prayer') {
    const profiles = await readJson('prayer_profiles.json', []);
    const profile = profiles.find(item => item.id === display.prayerProfileId) || profiles[0] || null;
    let prayer = null;
    if (profile) {
      try {
        prayer = await profilePrayerState(profile);
      } catch (err) {
        prayer = { error: err.message, timings: {}, events: [], next: null };
      }
    }
    return {
      display,
      employees: [],
      employee: null,
      settings: publicSettings(settings),
      weather: settings.weather?.data || null,
      qr: '',
      prayer: profile ? { profile, ...prayer } : null,
      rotationCompanies: overviewRotationProfiles(display)
    };
  }
  if (display.displayMode === 'overview') {
    const assignedRows = db.prepare('SELECT employee_id FROM display_employee_assignments WHERE display_id = ? ORDER BY sort_order ASC').all(display.id);
    const assignedIds = assignedRows.map(row => row.employee_id);
    const group = (display.displayGroup || '').trim().toLowerCase();
    const employeeSource = assignedIds.length
      ? assignedIds.map(id => employees.find(e => e.id === id)).filter(Boolean)
      : employees.filter(e => !group || (e.displayGroup || '').trim().toLowerCase() === group);
    const displayEmployees = orderEmployeesForOverview(employeeSource, display)
      .filter(e => e.status === 'Active')
      .map(e => ({ ...e, effectiveStatus: effectiveEmployeeStatus(e) }));
    const departments = [];
    displayEmployees.forEach(employee => {
      const departmentName = employee.department || 'Unassigned Department';
      let department = departments.find(item => item.name === departmentName);
      if (!department) {
        department = { name: departmentName, employees: [] };
        departments.push(department);
      }
      department.employees.push(employee);
    });
    const company = settings.company || {};
    const companyQr = hasCompanyContact(company) ? await QRCode.toDataURL(companyVCard(company)) : '';
    const displayEmployeesWithEmail = displayEmployees.map(employee => {
      const assignedDisplay = displays.find(item => item.displayMode !== 'overview' && item.employeeId === employee.id);
      return {
        ...withDisplayEmail(employee, company),
        overviewLocation: displayLocationForOverview(assignedDisplay)
      };
    });
    return {
      display,
      employees: displayEmployeesWithEmail,
      departments,
      employee: null,
      settings: publicSettings(settings),
      weather: settings.weather?.data || null,
      qr: '',
      companyQr,
      rotationCompanies: overviewRotationProfiles(display)
    };
  }
  const employee = employees.find(e => e.id === display.employeeId && e.status === 'Active') || null;
  const effectiveStatus = effectiveEmployeeStatus(employee);
  let qr = '';
  if (includeQr && employee?.qrEnabled) {
    qr = await QRCode.toDataURL(employeeVCard(withDisplayEmail(employee, settings.company || {}), settings.company || {}));
  }
  const company = settings.company || {};
  return {
    display,
    employee: employee ? withDisplayEmail({ ...employee, effectiveStatus }, company) : null,
    settings: publicSettings(settings),
    weather: settings.weather?.data || null,
    qr
  };
}

module.exports = { buildDisplayPayload, publicSettings, computedCompanyEmail };
