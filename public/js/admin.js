const $ = s => document.querySelector(s);
const content = $('#content');
const modalEl = $('#modal');
const modal = new bootstrap.Modal(modalEl);
const socket = io();

const statuses = ['Available', 'Not Available'];
let state = { employees: [], displays: [], departments: [], settings: {}, users: [], devices: [], timesheet: null, companyProfiles: [], dashboard: null, me: null };

const permissionOptions = [
  ['dashboard.view', 'Dashboard'],
  ['employees.view', 'View Employee Names'],
  ['employeeStatus.view', 'View Availability Status'],
  ['employees.manage', 'Edit Employees'],
  ['displays.manage', 'Add/Edit Displays'],
  ['companyProfiles.manage', 'Edit Company Profiles'],
  ['weather.manage', 'Edit Weather'],
  ['zkteco.manage', 'Manage Fingerprint Devices'],
  ['users.manage', 'Create Users & Access Rights'],
  ['display.access', 'Open Displays / Setup']
];
const allPermissionKeys = permissionOptions.map(([key]) => key);
const roleDefaults = {
  administrator: allPermissionKeys,
  admin: allPermissionKeys,
  'super admin': allPermissionKeys,
  superadmin: allPermissionKeys,
  'employee viewer': ['employees.view'],
  'availability viewer': ['employees.view', 'employeeStatus.view'],
  'employee editor': ['employees.view', 'employeeStatus.view', 'employees.manage'],
  display: ['display.access'],
  kiosk: ['display.access']
};
const pagePermissions = {
  dashboard: ['dashboard.view'],
  employees: ['employees.view', 'employeeStatus.view', 'employees.manage'],
  displays: 'displays.manage',
  'company-profiles': 'companyProfiles.manage',
  'company-profile': 'companyProfiles.manage',
  weather: 'weather.manage',
  zkteco: 'zkteco.manage',
  users: 'users.manage',
  'about-developer': null
};
const navPageKeys = ['dashboard', 'employees', 'displays', 'company-profiles', 'weather', 'zkteco', 'users', 'about-developer'];

const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function permissionsFor(user = {}) {
  const role = String(user.role || '').trim().toLowerCase();
  const explicit = Array.isArray(user.permissions) ? user.permissions.filter(Boolean) : [];
  return [...new Set([...(roleDefaults[role] || []), ...explicit])];
}
function hasPermission(permission) {
  if (!permission) return !!state.me;
  return permissionsFor(state.me).includes(permission);
}
function hasAnyPermission(permissions) {
  return permissions.some(hasPermission);
}
function canOpenPage(page) {
  if (page === 'about-developer') return hasPermission('users.manage');
  const permission = pagePermissions[page];
  return Array.isArray(permission) ? hasAnyPermission(permission) : hasPermission(permission);
}
function firstAllowedPage() {
  return navPageKeys.find(canOpenPage) || '';
}
function applyNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    const page = (link.hash || '').replace('#', '');
    const allowed = canOpenPage(page);
    link.hidden = !allowed;
    link.style.display = allowed ? '' : 'none';
    if (!allowed) link.classList.remove('active');
  });
}
const linkFor = id => {
  const configuredBase = state.settings.publicBaseUrl || state.settings.baseUrl || state.settings.ui?.publicBaseUrl || state.settings.ui?.baseUrl || '';
  const base = String(configuredBase || location.origin).replace(/\/+$/, '');
  return `${base}/display/${encodeURIComponent(id)}`;
};
const displayTableColumnKey = 'polaris_display_table_columns';
const displayTableColumnOptions = [
  ['lastSeen', 'Last Seen'],
  ['ipAddress', 'IP Address'],
  ['resolution', 'Resolution']
];
const activeCompanyEmailDomain = () => String((state.companyProfiles.find(profile => profile.isActive) || {}).emailDomain || '').trim().replace(/^@+/, '').toLowerCase();
const normalizeEmailLocalPart = value => String(value || '').trim().split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
const computedCompanyEmail = employee => {
  const localPart = normalizeEmailLocalPart(employee.companyEmailLocalPart || '');
  const domain = activeCompanyEmailDomain();
  if (localPart && domain) return `${localPart}@${domain}`;
  if (localPart) return localPart;
  return employee.email || '';
};
const activeDepartments = () => state.departments.filter(department => department.active).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

function displayTableColumns() {
  const defaults = { lastSeen: false, ipAddress: false, resolution: false };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(displayTableColumnKey)) || {}) };
  } catch {
    return defaults;
  }
}

function displayColumnSelector() {
  const columns = displayTableColumns();
  return `<div class="dropdown display-column-menu">
    <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"><i class="bi bi-sliders"></i> Columns</button>
    <div class="dropdown-menu dropdown-menu-end p-2">
      ${displayTableColumnOptions.map(([key, label]) => `<label class="dropdown-item display-column-option">
        <input class="form-check-input display-column-toggle" type="checkbox" data-display-column="${esc(key)}" ${columns[key] ? 'checked' : ''}>
        <span>${esc(label)}</span>
      </label>`).join('')}
    </div>
  </div>`;
}

function bindDisplayColumnControls() {
  document.querySelectorAll('.display-column-toggle').forEach(input => {
    input.onchange = event => {
      event.stopPropagation();
      const columns = displayTableColumns();
      columns[input.dataset.displayColumn] = input.checked;
      localStorage.setItem(displayTableColumnKey, JSON.stringify(columns));
      route();
    };
  });
}

socket.emit('admin-watch');
socket.on('admin-stats', () => route());
socket.on('data-updated', () => route());

async function api(url, opt = {}) {
  const res = await fetch(url, opt);
  if (res.status === 401) {
    location.href = '/admin/login.html';
    return null;
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || `Request failed: ${res.status}`);
  return data;
}

function toast(message, type = 'success') {
  $('#toastArea').innerHTML = `<div class="alert alert-${type} shadow-sm py-2 px-3 mb-2">${esc(message)}</div>`;
  setTimeout(() => { $('#toastArea').innerHTML = ''; }, 3500);
}

function confirmDelete(title, message = 'This action cannot be undone.') {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'modal fade confirm-modal';
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-body">
            <div class="confirm-icon"><i class="bi bi-trash3"></i></div>
            <h5>${esc(title)}</h5>
            <p>${esc(message)}</p>
            <div class="confirm-actions">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-danger" id="confirmDeleteBtn">Delete</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    const confirmModal = new bootstrap.Modal(el, { backdrop: true, keyboard: true, focus: true });
    let accepted = false;
    el.querySelector('#confirmDeleteBtn').onclick = () => {
      accepted = true;
      confirmModal.hide();
    };
    el.addEventListener('shown.bs.modal', () => el.querySelector('#confirmDeleteBtn').focus());
    el.addEventListener('hidden.bs.modal', () => {
      confirmModal.dispose();
      el.remove();
      resolve(accepted);
    }, { once: true });
    confirmModal.show();
  });
}

function formObject(form) {
  const data = {};
  const fd = new FormData(form);
  fd.forEach((value, key) => { data[key] = value; });
  return data;
}

function localDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function load() {
  const me = await api('/api/auth/me');
  const currentUser = (me && me.user) || null;
  state.me = currentUser;
  const currentPermissions = permissionsFor(currentUser);
  const can = permission => currentPermissions.includes(permission);
  const timesheetDate = sessionStorage.getItem('polaris_timesheet_date') || new Date().toISOString().slice(0, 10);
  const [dashboardData, employees, displays, departments, settings, users, devices, timesheet, companyProfiles] = await Promise.all([
    can('dashboard.view') ? api('/api/dashboard') : Promise.resolve(null),
    can('employees.view') || can('employeeStatus.view') || can('employees.manage') || can('displays.manage') ? api('/api/employees') : Promise.resolve([]),
    can('displays.manage') ? api('/api/displays') : Promise.resolve([]),
    can('employees.manage') || can('displays.manage') ? api('/api/departments') : Promise.resolve([]),
    can('weather.manage') ? api('/api/settings') : Promise.resolve({}),
    can('users.manage') ? api('/api/users') : Promise.resolve([]),
    can('zkteco.manage') ? api('/api/zkteco/devices') : Promise.resolve([]),
    can('employees.manage') || can('employeeStatus.view') ? api(`/api/timesheet?date=${encodeURIComponent(timesheetDate)}`) : Promise.resolve(null),
    can('companyProfiles.manage') ? api('/api/company-profiles') : Promise.resolve([])
  ]);
  state = {
    employees: Array.isArray(employees) ? employees : [],
    displays: Array.isArray(displays) ? displays : [],
    departments: Array.isArray(departments) ? departments : [],
    settings: settings || {},
    users: Array.isArray(users) ? users : [],
    devices: Array.isArray(devices) ? devices : [],
    timesheet: timesheet || null,
    companyProfiles: Array.isArray(companyProfiles) ? companyProfiles : [],
    dashboard: dashboardData || null,
    me: currentUser
  };
  state.settings.company = state.settings.company || {};
  state.settings.weather = state.settings.weather || {};
  state.settings.ui = state.settings.ui || {};
}

function setTitle(title) {
  $('#pageTitle').textContent = title;
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.hash === location.hash));
}

async function route() {
  try {
    await load();
    applyNavigation();
    if (state.me && state.me.mustChangePassword) passwordChangeForm(true);
    let page = (location.hash || '#dashboard').slice(1);
    if (!canOpenPage(page)) {
      const fallback = firstAllowedPage();
      if (!fallback) {
        content.innerHTML = '<div class="alert alert-warning">No admin access rights assigned to this user.</div>';
        return;
      }
      location.hash = fallback;
      page = fallback;
    }
    document.body.dataset.adminPage = page;
    ({ dashboard, employees, displays, 'company-profiles': renderCompanyProfiles, 'company-profile': renderCompanyProfiles, weather, zkteco, users, 'about-developer': aboutDeveloper }[page] || dashboard)();
  } catch (err) {
    content.innerHTML = `<div class="alert alert-danger"><h5>Admin Error</h5><p>${esc(err.message)}</p></div>`;
  }
}

function avatar(e) {
  if (e.photo) return `<img class="avatar" src="${esc(e.photo)}" alt="">`;
  return `<span class="avatar avatar-initials">${esc((e.name || '?').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase())}</span>`;
}

function dashboard() {
  setTitle('Dashboard');
  const canSeeEmployees = hasAnyPermission(['employees.view', 'employeeStatus.view', 'employees.manage']);
  const canSeeDisplays = hasPermission('displays.manage');
  const canSeeWeather = hasPermission('weather.manage');
  const summary = state.dashboard || {};
  const employeeSummary = summary.employees || {};
  const displaySummary = summary.displays || {};
  const weatherSummary = summary.weather || {};
  const online = canSeeDisplays ? state.displays.filter(d => d.status === 'Online').length : Number(displaySummary.online || 0);
  const offline = canSeeDisplays ? state.displays.length - online : Number(displaySummary.offline || 0);
  const employeeTotal = canSeeEmployees ? state.employees.length : Number(employeeSummary.total || 0);
  const inactiveEmployees = canSeeEmployees ? state.employees.filter(e => e.status !== 'Active').length : Number(employeeSummary.inactive || 0);
  const available = canSeeEmployees ? state.employees.filter(e => e.effectiveStatus && e.effectiveStatus.status === 'Available').length : Number(employeeSummary.available || 0);
  const unavailable = canSeeEmployees ? state.employees.length - available : Number(employeeSummary.unavailable || 0);
  const weather = canSeeWeather ? state.settings.weather?.data || {} : weatherSummary;
  const cards = [
    ['Employees', employeeTotal, 'bi-people', `${inactiveEmployees} inactive`],
    ['Displays Online', online, 'bi-broadcast-pin', `${offline} offline`],
    ['Available Now', available, 'bi-check2-circle', `${unavailable} not available`],
    ['Weather', weather.temperature == null ? '--' : `${weather.temperature}°`, 'bi-cloud-sun', weather.city || state.settings.weather?.city || 'Not configured']
  ];
  content.innerHTML = `
    <div class="admin-dashboard">
      <section class="dashboard-hero">
        <div>
          <div class="dashboard-kicker">Digital Office Command Center</div>
          <h2>Dashboard</h2>
          <p>Live overview for employees, displays, company branding, and operational signals.</p>
        </div>
      </section>

      <section class="dashboard-kpis">
        ${cards.map(c => `<article class="dashboard-kpi">
          <div class="dashboard-kpi-icon"><i class="bi ${c[2]}"></i></div>
          <div>
            <span>${esc(c[0])}</span>
            <strong>${esc(c[1])}</strong>
            <small>${esc(c[3])}</small>
          </div>
        </article>`).join('')}
      </section>

      ${canSeeDisplays ? `<section class="dashboard-grid">
        <article class="dashboard-panel dashboard-panel-wide">
          <div class="dashboard-panel-head"><div><span>Network</span><h3>Display Status</h3></div>${displayColumnSelector()}</div>
          <div class="dashboard-table-wrap">${displayTable()}</div>
        </article>
      </section>` : ''}
    </div>`;
  if (canSeeDisplays) {
    bindDisplayColumnControls();
    bindDisplayActions();
  }
}

function aboutDeveloper() {
  setTitle('About Developer');
  content.innerHTML = `
    <div class="about-dev">
      <section class="about-dev-hero">
        <div class="about-dev-copy">
          <div class="about-dev-kicker"><span></span>// ABOUT THE DEVELOPER</div>
          <h2> Let the code be <span>Free.</span></h2>
          <p>Committed to the open-source ecosystem, reliable, secure, and efficient cloud infrastructure is engineered to optimize business operations. Expertise is focused on automation, system design, and cloud-native solutions, leveraging open technologies to simplify complex workflows and eliminate friction</p>
        </div>
        <div class="about-dev-terminal" aria-label="Developer information">
          <div class="about-dev-terminal-top">
            <div class="about-dev-dots"><span></span><span></span><span></span></div>
            <span>~/developer_info.txt</span>
          </div>
          <div class="about-dev-command">$ cat about_developer.txt</div>
          <dl class="about-dev-info">
            <div><dt>Name</dt><dd>Riaz Rahman Bhuyan</dd></div>
            <div><dt>Focus</dt><dd>Building useful systems and automating repetitive work</dd></div>
            <div><dt>Experience</dt><dd>5+ years of hands-on experience</dd></div>
            <div><dt>Interests</dt><dd>Automation, Cloud Technologies, System Design, Open Source Software, Business Applications</dd></div>
            <div><dt>Mission</dt><dd>Create technology that makes work simpler and more efficient</dd></div>
            <div><dt>Motto</dt><dd>Keep it simple. Keep it open. Make it reliable.</dd></div>
          </dl>
          <div class="about-dev-cursor">$ <span></span></div>
        </div>
      </section>

      <section class="about-dev-contact-grid" aria-label="Developer contact cards">
        ${aboutContactCard('code-slash', 'Developer', 'Riaz Rahman Bhuyan', 'Riaz Rahman Bhuyan')}
        ${aboutContactCard('globe2', 'Website', 'mahaz.uk', 'https://mahaz.uk', 'https://mahaz.uk/')}
        ${aboutContactCard('envelope', 'Support Email', 'mahaz_abdullah@hotmail.com', 'mahaz_abdullah@hotmail.com', 'mailto:mahaz_abdullah@hotmail.com')}
        ${aboutContactCard('github', 'GitHub', 'github.com/mahaz121', 'https://github.com/mahaz121/', 'https://github.com/mahaz121/')}
      </section>

      <section class="about-dev-work">
        <div class="about-dev-section-title">// PASSION & INTERESTS</div>
        <div class="about-dev-interest-grid">
          <div class="about-dev-panel">
            <i class="bi bi-lightning-charge"></i>
            <div>
              <h3>Automation & Innovation</h3>
              <p>Building solutions that reduce manual work and improve operational efficiency.</p>
            </div>
          </div>
          <div class="about-dev-panel">
            <i class="bi bi-window-desktop"></i>
            <div>
              <h3>Digital Workplace Systems</h3>
              <p>Creating tools that improve communication, visibility and productivity.</p>
            </div>
          </div>
          <div class="about-dev-panel">
            <i class="bi bi-kanban"></i>
            <div>
              <h3>Business Applications</h3>
              <p>Designing practical systems that help organizations operate more effectively.</p>
            </div>
          </div>
          <div class="about-dev-panel">
            <i class="bi bi-infinity"></i>
            <div>
              <h3>Continuous Learning</h3>
              <p>Exploring new technologies and constantly improving skills and knowledge.</p>
            </div>
          </div>
        </div>
      </section>

      <footer class="about-dev-footer">
        <div><strong>&gt; Thanks for visiting.</strong><span>Let's build something amazing.</span></div>
        <div><span>Designed and maintained by</span><strong>Riaz Rahman Bhuyan</strong></div>
      </footer>
    </div>`;
  bindAboutDeveloperActions();
}

function aboutContactCard(icon, label, value, copyValue, url = '') {
  return `
    <article class="about-dev-card" ${url ? `data-url="${esc(url)}"` : ''}>
      <div class="about-dev-card-icon"><i class="bi bi-${esc(icon)}"></i></div>
      <div class="about-dev-card-copy">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
      <button type="button" class="about-dev-copy-btn" data-copy="${esc(copyValue)}" aria-label="Copy ${esc(label)}">
        <i class="bi bi-clipboard"></i>
      </button>
    </article>`;
}

function bindAboutDeveloperActions() {
  document.querySelectorAll('.about-dev-card[data-url]').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      const url = card.dataset.url;
      if (url.startsWith('mailto:')) location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    });
  });
  document.querySelectorAll('.about-dev-copy-btn').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      await copyText(button.dataset.copy || '');
      const icon = button.querySelector('i');
      icon.className = 'bi bi-check2';
      setTimeout(() => { icon.className = 'bi bi-clipboard'; }, 1200);
      toast('Copied to clipboard');
    });
  });
}

function employees() {
  setTitle('Employees');
  const canEditEmployees = hasPermission('employees.manage');
  const canViewNames = canEditEmployees || hasPermission('employees.view');
  const canViewStatus = canEditEmployees || hasPermission('employeeStatus.view');
  const canViewTimesheet = canEditEmployees || hasPermission('employeeStatus.view');
  const statusHead = canViewStatus ? '<th>Status</th>' : '';
  const actionHead = canEditEmployees ? '<th></th>' : '';
  const controls = canEditEmployees ? `
      <button class="btn btn-outline-primary btn-rounded" id="employeeSettingsBtn"><i class="bi bi-gear"></i> Employee Settings</button>
      <button class="btn btn-primary btn-rounded" id="addEmployeeBtn"><i class="bi bi-plus-lg"></i> Add</button>` : '';
  content.innerHTML = `
    <div class="d-flex gap-2 mb-3">
      <input id="searchEmp" class="form-control" placeholder="Search employees">
      ${canViewStatus ? `<select id="statusFilter" class="form-select w-auto"><option value="">All status</option>${statuses.map(s => `<option>${s}</option>`).join('')}</select>` : ''}
      ${canViewTimesheet ? '<button class="btn btn-outline-primary btn-rounded" id="timesheetBtn"><i class="bi bi-calendar-week"></i> Timesheet</button>' : ''}
      ${controls}
    </div>
    <div class="card table-card"><table class="table table-hover align-middle mb-0"><thead><tr><th>Employee</th><th>Designation</th><th>Department</th>${canEditEmployees ? '<th>Company Email</th><th>Ext.</th>' : ''}<th>Group</th>${statusHead}<th>Display</th>${actionHead}</tr></thead><tbody>
      ${state.employees.map(e => `<tr data-status="${esc((e.effectiveStatus && e.effectiveStatus.status) || '')}">
        <td><div class="d-flex align-items-center gap-2">${canViewNames ? avatar(e) : ''}<div><div class="fw-semibold">${esc(canViewNames ? e.name : 'Employee')}</div>${canViewNames ? `<small class="text-muted">${esc(e.employeeNumber)}</small>` : ''}</div></div></td>
        <td>${esc(canViewNames ? e.designation : '')}</td>
        <td>${esc(canViewNames ? e.department : '')}</td>
        ${canEditEmployees ? `<td>${esc(computedCompanyEmail(e))}</td><td>${esc(e.extension)}</td>` : ''}
        <td>${esc(e.displayGroup)}</td>
        ${canViewStatus ? `<td><span class="badge status-${esc(((e.effectiveStatus && e.effectiveStatus.status) || '').toLowerCase().replace(/\s+/g, '-'))}">${esc((e.effectiveStatus && e.effectiveStatus.status) || 'Not Available')}</span><br><small class="text-muted">${esc((e.effectiveStatus && e.effectiveStatus.source) || '')}</small></td>` : ''}
        <td>${esc((state.displays.find(d => d.employeeId === e.id) || {}).name || '-')}</td>
        ${canEditEmployees ? `<td class="text-end"><button class="btn btn-sm btn-outline-primary edit-emp" data-id="${e.id}"><i class="bi bi-pencil"></i></button> <button class="btn btn-sm btn-outline-danger del-emp" data-id="${e.id}"><i class="bi bi-trash"></i></button></td>` : ''}
      </tr>`).join('')}
    </tbody></table></div>`;
  if (canEditEmployees) {
    $('#addEmployeeBtn').onclick = () => employeeForm();
    $('#employeeSettingsBtn').onclick = () => employeeSettingsModal();
    document.querySelectorAll('.edit-emp').forEach(b => b.onclick = () => employeeForm(b.dataset.id));
    document.querySelectorAll('.del-emp').forEach(b => b.onclick = () => deleteEmployee(b.dataset.id));
  }
  if (canViewTimesheet) $('#timesheetBtn').onclick = () => timesheetView();
  const filter = () => {
    const q = $('#searchEmp').value.toLowerCase();
    const s = $('#statusFilter') ? $('#statusFilter').value : '';
    document.querySelectorAll('tbody tr').forEach(r => r.style.display = r.textContent.toLowerCase().includes(q) && (!s || r.dataset.status === s) ? '' : 'none');
  };
  $('#searchEmp').oninput = filter;
  if ($('#statusFilter')) $('#statusFilter').onchange = filter;
}

function employeeSettingsModal() {
  $('#modalTitle').textContent = 'Employee Settings';
  $('#modalBody').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h6 class="mb-1">Departments</h6>
        <div class="text-muted small">Manage department names used in employee forms.</div>
      </div>
      <button type="button" class="btn btn-sm btn-primary" id="addDepartmentRow"><i class="bi bi-plus-lg"></i> Add Department</button>
    </div>
    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead><tr><th>Name</th><th>Short Name</th><th>Department Manager</th><th>Employees</th><th>Active</th><th></th></tr></thead>
        <tbody id="departmentSettingsRows">
          ${state.departments.map(departmentSettingsRow).join('')}
        </tbody>
      </table>
    </div>`;
  modal.show();
  bindDepartmentSettingsActions();
  $('#addDepartmentRow').onclick = () => {
    $('#departmentSettingsRows').insertAdjacentHTML('beforeend', departmentSettingsRow({ active: true, employeeCount: 0 }, true));
    bindDepartmentSettingsActions();
  };
}

function departmentSettingsRow(department = {}, isNew = false) {
  const managerOptions = state.employees
    .filter(employee => employee.status !== 'Inactive')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(employee => `<option value="${esc(employee.id)}" ${department.managerEmployeeId === employee.id ? 'selected' : ''}>${esc(employee.name)}</option>`)
    .join('');
  return `<tr class="department-settings-row" data-id="${esc(department.id || '')}">
    <td><input class="form-control form-control-sm department-name" value="${esc(department.name || '')}" placeholder="Department name"></td>
    <td><input class="form-control form-control-sm department-short-name" value="${esc(department.shortName || '')}" placeholder="Optional"></td>
    <td><select class="form-select form-select-sm department-manager"><option value="">No manager</option>${managerOptions}</select></td>
    <td><span class="text-muted small">${esc(Number(department.employeeCount || 0))} ${Number(department.employeeCount || 0) === 1 ? 'employee' : 'employees'}</span></td>
    <td><span class="badge ${department.active === false ? 'bg-secondary' : 'bg-success'}">${department.active === false ? 'Inactive' : 'Active'}</span><input class="form-check-input department-active ms-2" type="checkbox" ${department.active === false ? '' : 'checked'} aria-label="Active"></td>
    <td class="text-end text-nowrap">
      <button type="button" class="btn btn-sm btn-outline-primary save-department"><i class="bi bi-check2"></i></button>
      ${isNew ? '<button type="button" class="btn btn-sm btn-outline-secondary remove-department-row"><i class="bi bi-x-lg"></i></button>' : `<button type="button" class="btn btn-sm btn-outline-danger delete-department"><i class="bi bi-trash"></i></button>`}
    </td>
  </tr>`;
}

function departmentPayload(row) {
  return {
    name: row.querySelector('.department-name').value.trim(),
    shortName: row.querySelector('.department-short-name').value.trim(),
    managerEmployeeId: row.querySelector('.department-manager').value,
    active: row.querySelector('.department-active').checked
  };
}

function bindDepartmentSettingsActions() {
  document.querySelectorAll('.remove-department-row').forEach(button => button.onclick = () => button.closest('tr').remove());
  document.querySelectorAll('.save-department').forEach(button => button.onclick = async () => {
    const row = button.closest('tr');
    const id = row.dataset.id;
    const payload = departmentPayload(row);
    if (!payload.name) return toast('Department name is required', 'danger');
    await api(id ? `/api/departments/${id}` : '/api/departments', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    toast('Department saved');
    await load();
    employeeSettingsModal();
  });
  document.querySelectorAll('.delete-department').forEach(button => button.onclick = async () => {
    const row = button.closest('tr');
    if (!await confirmDelete('Delete Department?', 'If employees use this department, it will be archived instead.')) return;
    const result = await api(`/api/departments/${row.dataset.id}`, { method: 'DELETE' });
    toast(result.archived ? 'Department archived' : 'Department deleted');
    await load();
    employeeSettingsModal();
  });
}

function employeeForm(id = '') {
  const e = state.employees.find(x => x.id === id) || { qrEnabled: true, status: 'Active', availabilityStatus: 'Not Available' };
  const activeDomain = activeCompanyEmailDomain();
  const previewLocalPart = normalizeEmailLocalPart(e.companyEmailLocalPart || '');
  const previewEmail = previewLocalPart && activeDomain ? `${previewLocalPart}@${activeDomain}` : previewLocalPart;
  const departments = activeDepartments();
  const managerOptions = state.employees
    .filter(employee => employee.id !== id && employee.status !== 'Inactive')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  $('#modalTitle').textContent = id ? 'Edit Employee' : 'Add Employee';
  $('#modalBody').innerHTML = `<form id="empForm"><div class="row g-3">
    <div class="col-md-4"><label class="form-label">ZKTeco User ID / Employee ID</label><input name="employeeNumber" class="form-control" value="${esc(e.employeeNumber)}"></div>
    <div class="col-md-8"><label class="form-label">Name</label><input name="name" class="form-control" required value="${esc(e.name)}"></div>
    <div class="col-md-6"><label class="form-label">Department</label><select name="department" class="form-select"><option value="">Select Department</option>${departments.map(department => `<option value="${esc(department.name)}" ${e.department === department.name ? 'selected' : ''}>${esc(department.name)}</option>`).join('')}</select></div>
    <div class="col-md-6"><label class="form-label">Designation</label><input name="designation" class="form-control" value="${esc(e.designation)}"></div>
    <div class="col-md-6"><label class="form-label">Phone</label><input name="phone" class="form-control" value="${esc(e.phone)}"></div>
    <div class="col-md-6"><label class="form-label">Email</label><input name="email" type="email" class="form-control" value="${esc(e.email)}"></div>
    <div class="col-md-6"><label class="form-label">Company Email Name</label><input name="companyEmailLocalPart" id="companyEmailLocalPart" class="form-control" placeholder="example: mahaz" value="${esc(e.companyEmailLocalPart)}"><div class="form-text">Only write the first part. The active company domain will be added automatically.</div></div>
    <div class="col-md-6"><label class="form-label">Company Email Preview</label><div id="companyEmailPreview" class="form-control bg-light">${esc(previewEmail)}</div></div>
    <div class="col-md-6"><label class="form-label">Telephone Extension</label><input name="extension" class="form-control" value="${esc(e.extension)}"></div>
    <div class="col-md-6"><label class="form-label">Display Group</label><input name="displayGroup" class="form-control" placeholder="Open Area, Women Section" value="${esc(e.displayGroup)}"></div>
    <div class="col-md-6"><label class="form-label">Manager / Reports To</label><select name="managerId" class="form-select"><option value="">No manager</option>${managerOptions.map(manager => `<option value="${esc(manager.id)}" ${e.managerId === manager.id ? 'selected' : ''}>${esc(manager.name)}</option>`).join('')}</select></div>
    <div class="col-md-3"><label class="form-label">Org Chart Order</label><input name="orgChartOrder" type="number" min="0" class="form-control" value="${esc(e.orgChartOrder || 0)}"></div>
    <div class="col-md-3 d-flex align-items-end"><div class="form-check mb-2"><input name="isDepartmentManager" id="isDepartmentManager" class="form-check-input" type="checkbox" ${e.isDepartmentManager ? 'checked' : ''}><label for="isDepartmentManager" class="form-check-label">Department Manager</label></div></div>
    <div class="col-12"><label class="form-label">Short Description</label><textarea name="shortDescription" class="form-control" rows="2" placeholder="Responsible for project coordination and team operations.">${esc(e.shortDescription)}</textarea></div>
    <div class="col-md-6"><label class="form-label">Photo</label><input name="photo" type="file" accept="image/*" class="form-control"></div>
    <div class="col-md-3"><label class="form-label">Record</label><select name="status" class="form-select"><option ${e.status === 'Active' ? 'selected' : ''}>Active</option><option ${e.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></div>
    <input name="availabilityStatus" type="hidden" value="Not Available">
    <div class="col-12"><div class="form-check"><input name="qrEnabled" class="form-check-input" type="checkbox" ${e.qrEnabled ? 'checked' : ''}><label class="form-check-label">QR Enabled</label></div></div>
  </div><button class="btn btn-primary mt-4">Save</button></form>`;
  modal.show();
  const updateCompanyEmailPreview = () => {
    const localPart = normalizeEmailLocalPart($('#companyEmailLocalPart').value);
    const email = localPart && activeDomain ? `${localPart}@${activeDomain}` : localPart;
    $('#companyEmailPreview').textContent = email || '';
  };
  $('#companyEmailLocalPart').oninput = updateCompanyEmailPreview;
  $('#empForm').onsubmit = async ev => {
    ev.preventDefault();
    await api(id ? `/api/employees/${id}` : '/api/employees/', { method: id ? 'PUT' : 'POST', body: new FormData(ev.target) });
    modal.hide(); toast('Employee saved'); route();
  };
}

function timesheetCsv(timesheet) {
  const header = ['Employee', 'Employee Number', 'Department', 'First In', 'Last Out', 'Expected Out', 'Inside', 'Inside Work Hours', 'Outside Work Hours', 'Punches', 'Status', 'Live Status'];
  const rows = (timesheet.rows || []).map(row => [
    row.name,
    row.employeeNumber,
    row.department,
    localDateTime(row.firstIn),
    localDateTime(row.lastOut),
    localDateTime(row.expectedOut),
    row.inside,
    row.insideDuringWork,
    row.outsideDuringWork,
    row.punchCount,
    row.status,
    row.liveStatus
  ]);
  return [header, ...rows].map(row => row.map(value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function exportTimesheet(timesheet) {
  const blob = new Blob([timesheetCsv(timesheet)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `polaris-timesheet-${timesheet.date || todayInputValue()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadTimesheet(date, sync = false) {
  const url = `/api/timesheet?date=${encodeURIComponent(date || todayInputValue())}${sync ? '&sync=1' : ''}`;
  state.timesheet = await api(url);
}

async function timesheetView(sync = false) {
  setTitle('Timesheet');
  const selectedDate = sessionStorage.getItem('polaris_timesheet_date') || todayInputValue();
  await loadTimesheet(selectedDate, sync);
  const timesheet = state.timesheet || { rows: [], totals: {}, date: selectedDate, workStart: '07:30', workEnd: '16:00', latestArrivalTime: '08:30', offDays: [] };
  content.innerHTML = `
    <div class="d-flex align-items-end justify-content-between gap-3 flex-wrap mb-3">
      <div>
        <h3 class="h5 mb-1">Daily Timesheet</h3>
        <div class="text-muted small">Office timing ${esc(timesheet.workStart)} - ${esc(timesheet.workEnd)}. Latest arrival ${esc(timesheet.latestArrivalTime)}. Expected checkout adjusts by arrival time.</div>
      </div>
      <div class="d-flex gap-2 align-items-end flex-wrap">
        <div><label class="form-label small">Date</label><input id="timesheetDate" class="form-control" type="date" value="${esc(timesheet.date || todayInputValue())}"></div>
        <button class="btn btn-outline-primary" id="timesheetRefresh"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
        <button class="btn btn-outline-secondary" id="timesheetSync"><i class="bi bi-arrow-repeat"></i> Sync Device</button>
        <button class="btn btn-primary" id="timesheetExport"><i class="bi bi-file-earmark-spreadsheet"></i> Export Excel</button>
        <button class="btn btn-outline-secondary" id="timesheetBack"><i class="bi bi-arrow-left"></i> Employees</button>
      </div>
    </div>
    ${timesheet.isOffDay ? '<div class="alert alert-warning">This date is configured as an off day.</div>' : ''}
    <section class="dashboard-kpis mb-3">
      <article class="dashboard-kpi"><div class="dashboard-kpi-icon"><i class="bi bi-person-check"></i></div><div><span>Inside Now</span><strong>${esc(timesheet.totals.insideNow || 0)}</strong><small>${esc(timesheet.totals.withPunches || 0)} employees with punches</small></div></article>
      <article class="dashboard-kpi"><div class="dashboard-kpi-icon"><i class="bi bi-clock-history"></i></div><div><span>Total Inside</span><strong>${esc(timesheet.totals.inside || '0h 0m')}</strong><small>All employees</small></div></article>
      <article class="dashboard-kpi"><div class="dashboard-kpi-icon"><i class="bi bi-building-check"></i></div><div><span>Inside Work Hours</span><strong>${esc(timesheet.totals.insideDuringWork || '0h 0m')}</strong><small>Adjusted schedule</small></div></article>
      <article class="dashboard-kpi"><div class="dashboard-kpi-icon"><i class="bi bi-door-open"></i></div><div><span>Outside Work Hours</span><strong>${esc(timesheet.totals.outsideDuringWork || '0h 0m')}</strong><small>Adjusted schedule</small></div></article>
    </section>
    <div class="card table-card"><table class="table table-hover align-middle mb-0"><thead><tr><th>Employee</th><th>Department</th><th>First In</th><th>Last Out</th><th>Expected Out</th><th>Inside</th><th>Outside Work Hours</th><th>Punches</th><th>Status</th></tr></thead><tbody>
      ${(timesheet.rows || []).map(row => `<tr><td><strong>${esc(row.name)}</strong><br><small class="text-muted">${esc(row.employeeNumber)}</small></td><td>${esc(row.department || '-')}</td><td>${esc(localDateTime(row.firstIn))}</td><td>${esc(localDateTime(row.lastOut))}</td><td>${esc(localDateTime(row.expectedOut))}</td><td>${esc(row.inside || '0h 0m')}</td><td>${esc(row.outsideDuringWork || '0h 0m')}</td><td>${esc(row.punchCount || 0)}</td><td><span class="badge ${row.status === 'Inside now' ? 'bg-success' : row.status === 'No punches' ? 'bg-secondary' : 'bg-primary'}">${esc(row.status)}</span><br><small class="text-muted">${esc(row.liveStatus || '')}</small></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#timesheetRefresh').onclick = () => {
    sessionStorage.setItem('polaris_timesheet_date', $('#timesheetDate').value || todayInputValue());
    timesheetView(false);
  };
  $('#timesheetDate').onchange = $('#timesheetRefresh').onclick;
  $('#timesheetSync').onclick = () => {
    sessionStorage.setItem('polaris_timesheet_date', $('#timesheetDate').value || todayInputValue());
    timesheetView(true);
  };
  $('#timesheetExport').onclick = () => exportTimesheet(timesheet);
  $('#timesheetBack').onclick = () => employees();
}

function overrideForm(id) {
  const e = state.employees.find(x => x.id === id);
  $('#modalTitle').textContent = `Status Override - ${e.name}`;
  $('#modalBody').innerHTML = `<form id="overrideForm"><div class="row g-3">
    <div class="col-md-6"><label class="form-label">Status</label><select name="status" class="form-select">${statuses.map(s => `<option>${s}</option>`).join('')}</select></div>
    <div class="col-md-6"><label class="form-label">Start</label><input name="startAt" type="datetime-local" class="form-control"></div>
    <div class="col-md-6"><label class="form-label">End</label><input name="endAt" type="datetime-local" class="form-control"></div>
    <div class="col-md-6"><label class="form-label">Note</label><input name="note" class="form-control"></div>
  </div><div class="d-flex gap-2 mt-4"><button class="btn btn-primary">Save Override</button><button type="button" id="clearOverride" class="btn btn-outline-danger">Clear Override</button></div></form>`;
  modal.show();
  $('#overrideForm').onsubmit = async ev => {
    ev.preventDefault();
    const data = formObject(ev.target);
    if (data.startAt) data.startAt = new Date(data.startAt).toISOString();
    if (data.endAt) data.endAt = new Date(data.endAt).toISOString();
    await api(`/api/employees/${id}/override`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    modal.hide(); toast('Status override saved'); route();
  };
  $('#clearOverride').onclick = async () => {
    await api(`/api/employees/${id}/override`, { method: 'DELETE' });
    modal.hide(); toast('Override cleared'); route();
  };
}

async function deleteEmployee(id) {
  if (!await confirmDelete('Delete Employee?')) return;
  await api('/api/employees/' + id, { method: 'DELETE' });
  toast('Employee deleted'); route();
}

function displayTable() {
  const columns = displayTableColumns();
  const optionalHead = [
    columns.lastSeen ? '<th class="col-last-seen">Last Seen</th>' : '',
    columns.ipAddress ? '<th class="col-ip">IP Address</th>' : '',
    columns.resolution ? '<th class="col-resolution">Resolution</th>' : ''
  ].join('');
  const optionalCount = ['lastSeen', 'ipAddress', 'resolution'].filter(key => columns[key]).length;
  const tableClass = `table table-hover align-middle mb-0 display-admin-table${optionalCount ? ' has-optional-columns' : ''}${optionalCount === 3 ? ' has-all-optional-columns' : ''}`;
  return `<table class="${tableClass}"><thead><tr><th class="col-display-name">Name</th><th class="col-mode">Mode</th><th class="col-group">Group</th><th class="col-link">Link</th><th class="col-employee">Employee</th><th class="col-status">Status</th>${optionalHead}<th class="col-actions">Actions</th></tr></thead><tbody>
    ${state.displays.map(d => {
      const optionalCells = [
        columns.lastSeen ? `<td class="col-last-seen">${d.lastSeen ? new Date(d.lastSeen).toLocaleString() : ''}</td>` : '',
        columns.ipAddress ? `<td class="col-ip">${esc(d.ipAddress)}</td>` : '',
        columns.resolution ? `<td class="col-resolution">${esc(d.resolution)}</td>` : ''
      ].join('');
      return `<tr>
        <td class="col-display-name"><div class="display-table-name">${esc(d.name)}</div><small class="text-muted">${esc(displayLocationText(d))}</small></td>
        <td class="col-mode"><span class="display-mode-badge">${esc(d.displayMode || 'single')}</span></td>
        <td class="col-group">${esc(d.displayGroup)}</td>
        <td class="col-link"><code>${esc(d.id)}</code><small>${esc(linkFor(d.id))}</small></td>
        <td class="col-employee"><span>${d.displayMode === 'overview' ? 'Selected employees' : esc((state.employees.find(e => e.id === d.employeeId) || {}).name || '-')}</span></td>
        <td class="col-status"><span class="badge bg-${d.status === 'Online' ? 'success' : 'secondary'}">${esc(d.status || 'Offline')}</span></td>
        ${optionalCells}
        <td class="col-actions"><div class="display-action-row">${d.displayMode === 'overview' ? `<button class="btn btn-sm btn-outline-success assign-display" data-id="${d.id}" title="Assign employees"><i class="bi bi-people"></i></button>` : ''}<button class="btn btn-sm btn-outline-primary edit-display" data-id="${d.id}" title="Edit"><i class="bi bi-pencil"></i></button><a class="btn btn-sm btn-outline-secondary open-display" target="_blank" href="/display/${esc(d.id)}">Open</a><button class="btn btn-sm btn-outline-secondary copy-display" data-id="${d.id}" title="Copy link"><i class="bi bi-clipboard"></i></button><button class="btn btn-sm btn-outline-danger del-display" data-id="${d.id}" title="Delete"><i class="bi bi-trash"></i></button></div></td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

function displayLocationText(display) {
  const parts = [];
  if (display.showRoomNumber && display.roomNumber) parts.push(`Room ${display.roomNumber}`);
  if (display.name) parts.push(display.name);
  if (display.showCubicleNumber && display.cubicleNumber) parts.push(`Cubicle ${display.cubicleNumber}`);
  return parts.join(' · ');
}

function bindDisplayActions() {
  document.querySelectorAll('.edit-display').forEach(b => b.onclick = () => displayForm(b.dataset.id));
  document.querySelectorAll('.del-display').forEach(b => b.onclick = () => deleteDisplay(b.dataset.id));
  document.querySelectorAll('.assign-display').forEach(b => b.onclick = () => assignmentForm(b.dataset.id));
  document.querySelectorAll('.copy-display').forEach(b => b.onclick = async () => {
    const originalHtml = b.innerHTML;
    try {
      await copyText(linkFor(b.dataset.id));
      b.innerHTML = '<i class="bi bi-check2"></i>';
      toast('Copied');
      setTimeout(() => { b.innerHTML = originalHtml; }, 1200);
    } catch (err) {
      toast('Unable to copy display link', 'danger');
    }
  });
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {}
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.top = '0';
  document.body.appendChild(input);
  input.focus();
  input.select();
  const ok = document.execCommand('copy');
  input.remove();
  if (!ok) throw new Error('Copy failed');
}

function displays() {
  setTitle('Displays');
  content.innerHTML = `<div class="d-flex gap-2 mb-3 display-table-toolbar"><input id="searchDisplay" class="form-control" placeholder="Search displays">${displayColumnSelector()}<button class="btn btn-primary btn-rounded" id="addDisplayBtn"><i class="bi bi-plus-lg"></i> Add</button></div><div class="card table-card display-table-card">${displayTable()}</div>`;
  $('#addDisplayBtn').onclick = () => displayForm();
  bindDisplayColumnControls();
  bindDisplayActions();
  $('#searchDisplay').oninput = e => document.querySelectorAll('tbody tr').forEach(r => r.style.display = r.textContent.toLowerCase().includes(e.target.value.toLowerCase()) ? '' : 'none');
}

async function assignmentForm(id) {
  const display = state.displays.find(d => d.id === id);
  const rows = await api(`/api/displays/${id}/employees`) || [];
  const isOverview = display && display.displayMode === 'overview';
  const overviewOrderRows = overviewDepartmentOrderRows(display || {});
  const orderByDepartment = display?.overviewEmployeeOrderByDepartment && typeof display.overviewEmployeeOrderByDepartment === 'object' ? display.overviewEmployeeOrderByDepartment : {};
  const employeeOrderIndex = employee => {
    const deptOrder = Array.isArray(orderByDepartment[employee.department]) ? orderByDepartment[employee.department] : [];
    const deptIndex = deptOrder.indexOf(employee.id);
    if (deptIndex !== -1) return deptIndex + 1;
    return employee.assigned ? Number(employee.assignedSortOrder || 0) + 1 : '';
  };
  $('#modalTitle').textContent = `Assign Employees - ${display ? display.name : id}`;
  $('#modalBody').innerHTML = `<form id="assignForm">
    <div class="d-flex gap-2 mb-3">
      <select id="assignDepartmentFilter" class="form-select w-auto">
        <option value="">All Departments</option>
        ${activeDepartments().map(department => `<option value="${esc(department.name)}">${esc(department.name)}</option>`).join('')}
      </select>
      <input id="assignSearch" class="form-control" placeholder="Search employees">
      <button type="button" id="selectAllVisible" class="btn btn-outline-secondary">Select Visible</button>
      <button type="button" id="clearAllVisible" class="btn btn-outline-secondary">Clear Visible</button>
    </div>
    <div class="table-responsive assignment-table">
      <table class="table table-hover align-middle">
        <thead><tr><th></th><th>Order</th><th>Name</th><th>Department</th><th>Designation</th><th>Extension</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((employee, index) => `<tr draggable="true" data-department="${esc(employee.department || '')}">
            <td><input class="form-check-input assign-check" type="checkbox" value="${esc(employee.id)}" ${employee.assigned ? 'checked' : ''}></td>
            <td><input class="form-control form-control-sm assign-order" type="number" min="1" value="${esc(employeeOrderIndex(employee))}" aria-label="Display order for ${esc(employee.name)}"></td>
            <td>${esc(employee.name)}</td>
            <td>${esc(employee.department)}</td>
            <td>${esc(employee.designation)}</td>
            <td>${esc(employee.extension)}</td>
            <td><span class="badge status-${esc(((employee.effectiveStatus && employee.effectiveStatus.status) || '').toLowerCase().replace(/\s+/g, '-'))}">${esc((employee.effectiveStatus && employee.effectiveStatus.status) || 'Not Available')}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${isOverview ? `<div class="table-card p-3 mt-3">
      <h6 class="mb-2">Overview Layout Settings</h6>
      <label class="form-label">Department Order</label>
      ${departmentOrderEditor(overviewOrderRows, 'assign-overview-department-row', 'assign-overview-department-name', 'assign-overview-department-order')}
      <div class="form-text">This order applies only to this overview display.</div>
    </div>` : ''}
    <button class="btn btn-primary mt-3">Save Assignments</button>
  </form>`;
  modal.show();
  const departmentOrderMap = () => new Map(Array.from(document.querySelectorAll('.assign-overview-department-row')).map(row => [
    row.querySelector('.assign-overview-department-name').value.trim(),
    Number(row.querySelector('.assign-overview-department-order').value || 0)
  ]));
  const applyAssignmentOrdering = () => {
    const tbody = document.querySelector('#assignForm tbody');
    const orderMap = departmentOrderMap();
    const rowsToSort = Array.from(tbody.querySelectorAll('tr')).map((row, index) => ({
      row,
      index,
      departmentOrder: orderMap.get(row.dataset.department) || Number.MAX_SAFE_INTEGER,
      employeeOrder: Number(row.querySelector('.assign-order')?.value || 0) || Number.MAX_SAFE_INTEGER
    }));
    rowsToSort.sort((a, b) => {
      if (a.departmentOrder !== b.departmentOrder) return a.departmentOrder - b.departmentOrder;
      if ((a.row.dataset.department || '') !== (b.row.dataset.department || '')) return (a.row.dataset.department || '').localeCompare(b.row.dataset.department || '');
      if (a.employeeOrder !== b.employeeOrder) return a.employeeOrder - b.employeeOrder;
      return a.index - b.index;
    }).forEach(item => tbody.appendChild(item.row));
  };
  const filter = () => {
    applyAssignmentOrdering();
    const q = $('#assignSearch').value.toLowerCase();
    const department = $('#assignDepartmentFilter').value;
    document.querySelectorAll('#assignForm tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) && (!department || row.dataset.department === department) ? '' : 'none';
    });
  };
  $('#assignSearch').oninput = filter;
  $('#assignDepartmentFilter').onchange = filter;
  document.querySelectorAll('.assign-overview-department-order,.assign-order').forEach(input => input.oninput = filter);
  filter();
  $('#selectAllVisible').onclick = () => document.querySelectorAll('#assignForm tbody tr').forEach(row => { if (row.style.display !== 'none') row.querySelector('.assign-check').checked = true; });
  $('#clearAllVisible').onclick = () => document.querySelectorAll('#assignForm tbody tr').forEach(row => { if (row.style.display !== 'none') row.querySelector('.assign-check').checked = false; });
  bindDragRows(document.querySelector('#assignForm tbody'));
  $('#assignForm').onsubmit = async event => {
    event.preventDefault();
    const employeeIds = Array.from(document.querySelectorAll('#assignForm tbody tr'))
      .map((row, index) => ({
        row,
        index,
        input: row.querySelector('.assign-check'),
        order: Number(row.querySelector('.assign-order')?.value || 0)
      }))
      .filter(item => item.input && item.input.checked)
      .sort((a, b) => {
        const aOrder = a.order > 0 ? a.order : Number.MAX_SAFE_INTEGER;
        const bOrder = b.order > 0 ? b.order : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.index - b.index;
      })
      .map(item => item.input.value);
    await api(`/api/displays/${id}/employees`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeIds })
    });
    if (isOverview && display) {
      const overviewDepartmentLayout = Array.from(document.querySelectorAll('.assign-overview-department-row')).map(row => ({
        departmentName: row.querySelector('.assign-overview-department-name').value.trim(),
        displayOrder: Number(row.querySelector('.assign-overview-department-order').value || 0)
      })).filter(item => item.departmentName);
      const overviewDepartmentOrder = overviewDepartmentLayout
        .slice()
        .sort((a, b) => (a.displayOrder || Number.MAX_SAFE_INTEGER) - (b.displayOrder || Number.MAX_SAFE_INTEGER))
        .map(item => item.departmentName);
      const overviewEmployeeOrderByDepartment = {};
      Array.from(document.querySelectorAll('#assignForm tbody tr'))
        .map((row, index) => ({
          id: row.querySelector('.assign-check')?.value || '',
          checked: row.querySelector('.assign-check')?.checked,
          department: row.dataset.department || '',
          order: Number(row.querySelector('.assign-order')?.value || 0),
          index
        }))
        .filter(item => item.checked && item.id && item.department)
        .sort((a, b) => {
          const aOrder = a.order > 0 ? a.order : Number.MAX_SAFE_INTEGER;
          const bOrder = b.order > 0 ? b.order : Number.MAX_SAFE_INTEGER;
          if (a.department !== b.department) return a.department.localeCompare(b.department);
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.index - b.index;
        })
        .forEach(item => {
          if (!overviewEmployeeOrderByDepartment[item.department]) overviewEmployeeOrderByDepartment[item.department] = [];
          overviewEmployeeOrderByDepartment[item.department].push(item.id);
        });
      await api(`/api/displays/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: display.name,
          displayMode: display.displayMode,
          displayGroup: display.displayGroup || '',
          roomNumber: display.roomNumber || '',
          showRoomNumber: !!display.showRoomNumber,
          cubicleNumber: display.cubicleNumber || '',
          showCubicleNumber: !!display.showCubicleNumber,
          rotateCompanyProfiles: !!display.rotateCompanyProfiles,
          rotationIntervalSeconds: display.rotationIntervalSeconds || 30,
          rotationCompanyProfileIds: display.rotationCompanyProfileIds || [],
          overviewShowCompanyName: display.overviewShowCompanyName !== false,
          overviewDepartmentOrder,
          overviewDepartmentLayout,
          overviewEmployeeOrderByDepartment,
          overviewEmployeeOrder: employeeIds
        })
      });
    }
    modal.hide();
    toast('Display assignments saved');
    route();
  };
}

function bindDragRows(tbody) {
  if (!tbody) return;
  let dragging = null;
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('dragstart', () => {
      dragging = row;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragging = null;
    });
  });
  tbody.addEventListener('dragover', event => {
    event.preventDefault();
    if (!dragging) return;
    const rows = [...tbody.querySelectorAll('tr:not(.dragging)')].filter(row => row.style.display !== 'none');
    const next = rows.find(row => event.clientY <= row.getBoundingClientRect().top + row.offsetHeight / 2);
    tbody.insertBefore(dragging, next || null);
  });
}

function overviewDepartmentNames(display = {}) {
  const names = new Set(Array.isArray(display.overviewDepartmentOrder) ? display.overviewDepartmentOrder.filter(Boolean) : []);
  state.employees.forEach(employee => {
    const department = String(employee.department || '').trim();
    if (department) names.add(department);
  });
  return [...names];
}

function overviewDepartmentOrderRows(display = {}) {
  const layout = new Map((Array.isArray(display.overviewDepartmentLayout) ? display.overviewDepartmentLayout : [])
    .map(item => [item.departmentName, Number(item.displayOrder || 0) || 0]));
  return overviewDepartmentNames(display).map((departmentName, index) => {
    return {
      departmentName,
      displayOrder: layout.get(departmentName) || index + 1
    };
  });
}

function departmentOrderEditor(rows, rowClass, departmentClass, orderClass) {
  return `<div class="table-responsive">
    <table class="table table-sm align-middle mb-2">
      <thead><tr><th>Department</th><th>Order</th></tr></thead>
      <tbody>
        ${rows.map(row => `<tr class="${rowClass}">
          <td><input class="form-control form-control-sm ${departmentClass}" value="${esc(row.departmentName)}" readonly></td>
          <td><input class="form-control form-control-sm ${orderClass}" type="number" min="1" value="${esc(row.displayOrder)}"></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function displayForm(id = '') {
  const d = state.displays.find(x => x.id === id) || {};
  const selectedRotationProfiles = new Set(Array.isArray(d.rotationCompanyProfileIds) ? d.rotationCompanyProfileIds : []);
  const selectedOrgEmployees = new Set(Array.isArray(d.orgChartSelectedEmployeeIds) ? d.orgChartSelectedEmployeeIds : []);
  const selectedOrgDepartments = new Set(Array.isArray(d.orgChartIncludedDepartmentIds) ? d.orgChartIncludedDepartmentIds : []);
  const overviewOrderRows = overviewDepartmentOrderRows(d);
  $('#modalTitle').textContent = id ? 'Edit Display' : 'Add Display';
  $('#modalBody').innerHTML = `<form id="displayForm">
    <label class="form-label">Display Name</label><input name="name" class="form-control mb-3" required value="${esc(d.name)}">
    <label class="form-label">Display ID</label><input name="id" class="form-control mb-3" ${id ? 'readonly' : ''} required value="${esc(d.id)}">
    <label class="form-label">Display Mode</label><select name="displayMode" id="displayMode" class="form-select mb-3"><option value="single" ${!['overview', 'orgchart'].includes(d.displayMode) ? 'selected' : ''}>Single Employee Sign</option><option value="overview" ${d.displayMode === 'overview' ? 'selected' : ''}>Large Screen Employee Board</option><option value="orgchart" ${d.displayMode === 'orgchart' ? 'selected' : ''}>Organization Chart</option></select>
    <label class="form-label">Display Group</label><input name="displayGroup" class="form-control mb-3" placeholder="Open Area, Women Section" value="${esc(d.displayGroup)}">
    <div class="row g-3 mb-3">
      <div class="col-md-6"><label class="form-label">Room Number</label><input name="roomNumber" class="form-control" placeholder="example: 102" value="${esc(d.roomNumber)}"></div>
      <div class="col-md-6 d-flex align-items-end"><div class="form-check mb-2"><input name="showRoomNumber" id="showRoomNumber" type="checkbox" class="form-check-input" ${d.showRoomNumber ? 'checked' : ''}><label for="showRoomNumber" class="form-check-label">Show Room Number</label></div></div>
      <div class="col-md-6 single-display-option d-flex align-items-end"><div class="form-check mb-2"><input name="showPhoneNumber" id="showPhoneNumber" type="checkbox" class="form-check-input" ${d.showPhoneNumber ? 'checked' : ''}><label for="showPhoneNumber" class="form-check-label">Show Phone Number</label></div></div>
      <div class="col-md-6"><label class="form-label">Cubicle Number</label><input name="cubicleNumber" class="form-control" placeholder="example: C-14" value="${esc(d.cubicleNumber)}"></div>
      <div class="col-md-6 d-flex align-items-end"><div class="form-check mb-2"><input name="showCubicleNumber" id="showCubicleNumber" type="checkbox" class="form-check-input" ${d.showCubicleNumber ? 'checked' : ''}><label for="showCubicleNumber" class="form-check-label">Show Cubicle Number</label></div></div>
    </div>
    <div id="overviewRotationFields" class="table-card p-3 mb-3">
      <div class="form-check mb-3"><input name="overviewShowCompanyName" id="overviewShowCompanyName" type="checkbox" class="form-check-input" ${d.overviewShowCompanyName === false ? '' : 'checked'}><label for="overviewShowCompanyName" class="form-check-label">Show company name in overview header</label></div>
      <div class="overview-layout-settings mb-3">
        <label class="form-label">Department Order</label>
        ${departmentOrderEditor(overviewOrderRows, 'overview-department-row', 'overview-department-name', 'overview-department-order')}
        <div class="form-text">This order applies only to this overview display.</div>
      </div>
      <div class="form-check mb-3"><input name="rotateCompanyProfiles" id="rotateCompanyProfiles" type="checkbox" class="form-check-input" ${d.rotateCompanyProfiles ? 'checked' : ''}><label for="rotateCompanyProfiles" class="form-check-label">Brand rotation enabled</label></div>
      <label class="form-label">Brand rotation interval seconds</label><input name="rotationIntervalSeconds" type="number" min="5" class="form-control mb-3" value="${esc(d.rotationIntervalSeconds || 30)}">
      <label class="form-label">Company profiles to rotate</label>
      <div class="rotation-profile-list">
        ${state.companyProfiles.map(profile => `<label class="rotation-profile-option">
          ${profile.logo ? `<img src="${esc(profile.logo)}" alt="">` : '<span class="rotation-profile-empty"><i class="bi bi-building"></i></span>'}
          <input type="checkbox" class="form-check-input rotation-profile-check" value="${esc(profile.id)}" ${selectedRotationProfiles.has(profile.id) ? 'checked' : ''}>
          <span>${esc(profile.name || 'Unnamed profile')}</span>
        </label>`).join('') || '<div class="text-muted small">No company profiles available.</div>'}
      </div>
      <div class="form-text mt-2">If no profiles are selected, the active company profile will be used.</div>
    </div>
    <div id="orgChartFields" class="table-card p-3 mb-3">
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">Default Root Level</label><select name="orgChartRootMode" class="form-select"><option value="department_managers" ${d.orgChartRootMode !== 'ceo' && d.orgChartRootMode !== 'custom' ? 'selected' : ''}>Department Managers</option><option value="ceo" ${d.orgChartRootMode === 'ceo' ? 'selected' : ''}>CEO</option><option value="custom" ${d.orgChartRootMode === 'custom' ? 'selected' : ''}>Custom selected employees</option></select></div>
        <div class="col-md-3"><label class="form-label">Manager Focus Seconds</label><input name="orgChartManagerFocusSeconds" type="number" min="1" class="form-control" value="${esc(d.orgChartManagerFocusSeconds || 10)}"></div>
        <div class="col-md-3"><label class="form-label">Auto Reset Seconds</label><input name="orgChartAutoResetSeconds" type="number" min="0" class="form-control" value="${esc(d.orgChartAutoResetSeconds || 60)}"></div>
        <div class="col-md-3 d-flex align-items-end"><div class="form-check mb-2"><input name="orgChartShowPhotos" id="orgChartShowPhotos" type="checkbox" class="form-check-input" ${d.orgChartShowPhotos === false ? '' : 'checked'}><label for="orgChartShowPhotos" class="form-check-label">Show Photos</label></div></div>
        <div class="col-md-6 d-flex align-items-end"><div class="form-check mb-2"><input name="orgChartAnimationEnabled" id="orgChartAnimationEnabled" type="checkbox" class="form-check-input" ${d.orgChartAnimationEnabled === false ? '' : 'checked'}><label for="orgChartAnimationEnabled" class="form-check-label">Auto Animate Org Chart</label></div></div>
        <div class="col-md-6 d-flex align-items-end"><div class="form-check mb-2"><input name="overviewShowCompanyNameOrg" id="overviewShowCompanyNameOrg" type="checkbox" class="form-check-input" ${d.overviewShowCompanyName === false ? '' : 'checked'}><label for="overviewShowCompanyNameOrg" class="form-check-label">Show Company Name</label></div></div>
      </div>
      <label class="form-label mt-3">Include Departments</label>
      <div class="org-employee-picker">
        ${state.departments.filter(department => department.active).map(department => `<label class="org-employee-option">
          <input type="checkbox" class="form-check-input org-department-check" value="${esc(department.id)}" ${selectedOrgDepartments.size ? (selectedOrgDepartments.has(department.id) ? 'checked' : '') : 'checked'}>
          <span><strong>${esc(department.name)}</strong><small>${esc(department.shortName || 'Department')}</small></span>
        </label>`).join('') || '<div class="text-muted small">No active departments available.</div>'}
      </div>
      <label class="form-label mt-3">Employees in Organization Chart</label>
      <div class="org-employee-picker">
        ${state.employees.filter(employee => employee.status !== 'Inactive').map(employee => `<label class="org-employee-option">
          <input type="checkbox" class="form-check-input org-employee-check" value="${esc(employee.id)}" ${selectedOrgEmployees.size ? (selectedOrgEmployees.has(employee.id) ? 'checked' : '') : 'checked'}>
          <span><strong>${esc(employee.name)}</strong><small>${esc(employee.department || 'No department')} · ${esc(employee.designation || 'No designation')}</small></span>
        </label>`).join('') || '<div class="text-muted small">No active employees available.</div>'}
      </div>
      <div class="form-text mt-2">Reporting relationships are managed in each employee profile through Manager / Reports To.</div>
    </div>
    <div id="singleEmployeeFields"><label class="form-label">Assigned Employee</label><select name="employeeId" class="form-select mb-3"><option value="">None</option>${state.employees.map(e => `<option value="${e.id}" ${d.employeeId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
    <button class="btn btn-primary">Save</button></form>`;
  modal.show();
  const syncOverviewRotationFields = () => {
    const mode = $('#displayMode').value;
    const isOverview = mode === 'overview';
    const isOrgChart = mode === 'orgchart';
    $('#overviewRotationFields').hidden = !isOverview;
    $('#orgChartFields').hidden = !isOrgChart;
    $('#singleEmployeeFields').hidden = mode !== 'single';
    document.querySelectorAll('.single-display-option').forEach(item => { item.hidden = mode !== 'single'; });
  };
  $('#displayMode').onchange = syncOverviewRotationFields;
  syncOverviewRotationFields();
  $('#displayForm').onsubmit = async ev => {
    ev.preventDefault();
    const data = formObject(ev.target);
    data.showRoomNumber = !!data.showRoomNumber;
    data.showPhoneNumber = !!data.showPhoneNumber;
    data.showCubicleNumber = !!data.showCubicleNumber;
    data.overviewShowCompanyName = !!data.overviewShowCompanyName;
    data.rotateCompanyProfiles = !!data.rotateCompanyProfiles;
    data.rotationCompanyProfileIds = Array.from(document.querySelectorAll('.rotation-profile-check:checked')).map(input => input.value);
    data.orgChartShowPhotos = !!data.orgChartShowPhotos;
    data.orgChartAnimationEnabled = !!data.orgChartAnimationEnabled;
    data.orgChartSelectedEmployeeIds = Array.from(document.querySelectorAll('.org-employee-check:checked')).map(input => input.value);
    data.orgChartIncludedDepartmentIds = Array.from(document.querySelectorAll('.org-department-check:checked')).map(input => input.value);
    if (data.displayMode === 'orgchart') data.overviewShowCompanyName = !!data.overviewShowCompanyNameOrg;
    data.overviewDepartmentLayout = Array.from(document.querySelectorAll('.overview-department-row')).map(row => ({
      departmentName: row.querySelector('.overview-department-name').value.trim(),
      displayOrder: Number(row.querySelector('.overview-department-order').value || 0)
    })).filter(item => item.departmentName);
    data.overviewDepartmentOrder = data.overviewDepartmentLayout
      .slice()
      .sort((a, b) => (a.displayOrder || Number.MAX_SAFE_INTEGER) - (b.displayOrder || Number.MAX_SAFE_INTEGER))
      .map(item => item.departmentName);
    if (data.displayMode !== 'overview') {
      data.rotateCompanyProfiles = false;
      data.rotationCompanyProfileIds = [];
      if (data.displayMode !== 'orgchart') data.overviewShowCompanyName = true;
      data.overviewDepartmentOrder = [];
      data.overviewDepartmentLayout = [];
    }
    if (data.displayMode !== 'orgchart') {
      data.orgChartRootMode = 'department_managers';
      data.orgChartShowPhotos = true;
      data.orgChartAnimationEnabled = true;
      data.orgChartAutoResetSeconds = 60;
      data.orgChartManagerFocusSeconds = 10;
      data.orgChartSelectedEmployeeIds = [];
      data.orgChartIncludedDepartmentIds = [];
    } else {
      data.showPhoneNumber = false;
    }
    await api(id ? `/api/displays/${id}` : '/api/displays/', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    modal.hide(); toast('Display saved'); route();
  };
}

async function deleteDisplay(id) {
  if (!await confirmDelete('Delete Display?')) return;
  await api('/api/displays/' + id, { method: 'DELETE' });
  toast('Display deleted'); route();
}

function renderCompanyProfiles() {
  setTitle('Company Profiles');
  const profiles = state.companyProfiles;
  content.innerHTML = `
    <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
      <div class="text-muted">Switch display branding, contact QR, colors, and company contact details without changing employees.</div>
      <button class="btn btn-primary btn-rounded" id="addProfileBtn"><i class="bi bi-plus-lg"></i> Add Profile</button>
    </div>
    <div class="row g-3">
      ${profiles.map(profile => profileCard(profile)).join('') || '<div class="col-12"><div class="alert alert-warning">No company profiles found.</div></div>'}
    </div>`;
  $('#addProfileBtn').onclick = () => companyProfileForm();
  document.querySelectorAll('.edit-profile').forEach(btn => btn.onclick = () => companyProfileForm(btn.dataset.id));
  document.querySelectorAll('.activate-profile').forEach(btn => btn.onclick = () => activateCompanyProfile(btn.dataset.id));
  document.querySelectorAll('.delete-profile').forEach(btn => btn.onclick = () => deleteCompanyProfile(btn.dataset.id));
}

function profileCard(profile) {
  const active = profile.isActive;
  const logo = profile.logo ? `<img src="${esc(profile.logo)}" alt="" class="profile-preview-logo">` : '<div class="profile-preview-logo profile-preview-empty"><i class="bi bi-building"></i></div>';
  return `<div class="col-xl-4 col-md-6">
    <article class="card table-card profile-card h-100">
      <div class="profile-preview" style="--preview-primary:${esc(profile.primaryColor || '#132644')};--preview-secondary:${esc(profile.secondaryColor || '#8b8792')};--preview-accent:${esc(profile.accentColor || profile.secondaryColor || '#38bdf8')}">
        ${logo}
        <div class="profile-preview-copy">
          <span>${active ? 'Active profile' : 'Company profile'}</span>
          <strong>${esc(profile.name || 'Unnamed profile')}</strong>
          <small>${esc(profile.companyWebsite || profile.companyEmail || 'Branding profile')}</small>
        </div>
      </div>
      <div class="p-3">
        <div class="d-flex gap-2 flex-wrap mb-3">
          <span class="profile-swatch" style="background:${esc(profile.primaryColor || '#132644')}"></span>
          <span class="profile-swatch" style="background:${esc(profile.secondaryColor || '#8b8792')}"></span>
          <span class="profile-swatch" style="background:${esc(profile.accentColor || profile.secondaryColor || '#38bdf8')}"></span>
        </div>
        <div class="small text-muted mb-2">${esc(profile.companyEmail || '')}</div>
        <div class="small text-muted mb-3">${esc(profile.companyWebsite || '')}</div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-primary activate-profile" data-id="${esc(profile.id)}" ${active ? 'disabled' : ''}><i class="bi bi-check2-circle"></i> ${active ? 'Active' : 'Activate'}</button>
          <button class="btn btn-sm btn-outline-primary edit-profile" data-id="${esc(profile.id)}"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-sm btn-outline-danger delete-profile" data-id="${esc(profile.id)}" ${active ? 'disabled' : ''}><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </article>
  </div>`;
}

function companyProfileForm(id = '') {
  const weekDays = [['0', 'Sunday'], ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday']];
  const profile = state.companyProfiles.find(item => item.id === id) || {
    primaryColor: '#132644',
    secondaryColor: '#8b8792',
    accentColor: '#38bdf8',
    backgroundStyle: 'default',
    displayFont: 'Inter, Arial, sans-serif',
    clockFormat: '24',
    language: 'English',
    officeStartTime: '07:30',
    officeEndTime: '16:00',
    latestArrivalTime: '08:30',
    offDays: ['5', '6']
  };
  const offDays = new Set(Array.isArray(profile.offDays) ? profile.offDays.map(String) : []);
  $('#modalTitle').textContent = id ? 'Edit Company Profile' : 'Add Company Profile';
  $('#modalBody').innerHTML = `<form id="profileForm" enctype="multipart/form-data">
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label">Company Name</label><input name="name" class="form-control" value="${esc(profile.name)}"></div>
      <div class="col-md-6"><label class="form-label">Logo Upload</label><input name="logo" type="file" accept="image/*" class="form-control"></div>
      <div class="col-md-4"><label class="form-label">Primary Color</label><input name="primaryColor" type="color" class="form-control form-control-color" value="${esc(profile.primaryColor || '#132644')}"></div>
      <div class="col-md-4"><label class="form-label">Secondary Color</label><input name="secondaryColor" type="color" class="form-control form-control-color" value="${esc(profile.secondaryColor || '#8b8792')}"></div>
      <div class="col-md-4"><label class="form-label">Accent Color</label><input name="accentColor" type="color" class="form-control form-control-color" value="${esc(profile.accentColor || profile.secondaryColor || '#38bdf8')}"></div>
      <div class="col-md-4"><label class="form-label">Background Style</label><select name="backgroundStyle" class="form-select"><option value="default" ${profile.backgroundStyle !== 'soft' ? 'selected' : ''}>default</option><option value="soft" ${profile.backgroundStyle === 'soft' ? 'selected' : ''}>soft</option></select></div>
      <div class="col-md-4"><label class="form-label">Display Font</label><input name="displayFont" class="form-control" value="${esc(profile.displayFont || profile.defaultFont || 'Inter, Arial, sans-serif')}"></div>
      <div class="col-md-4"><label class="form-label">Clock Format</label><select name="clockFormat" class="form-select"><option value="24" ${profile.clockFormat !== '12' ? 'selected' : ''}>24 Hour</option><option value="12" ${profile.clockFormat === '12' ? 'selected' : ''}>12 Hour</option></select></div>
      <div class="col-md-4"><label class="form-label">Company Phone</label><input name="companyPhone" class="form-control" value="${esc(profile.companyPhone)}"></div>
      <div class="col-md-4"><label class="form-label">Company Email</label><input name="companyEmail" type="email" class="form-control" value="${esc(profile.companyEmail)}"></div>
      <div class="col-md-4"><label class="form-label">Website</label><input name="companyWebsite" class="form-control" value="${esc(profile.companyWebsite)}"></div>
      <div class="col-md-6"><label class="form-label">Address</label><input name="companyAddress" class="form-control" value="${esc(profile.companyAddress)}"></div>
      <div class="col-md-6"><label class="form-label">Company Email Domain</label><input name="emailDomain" class="form-control" placeholder="example: mahaz.uk" value="${esc(profile.emailDomain)}"></div>
      <div class="col-md-4"><label class="form-label">Office Start Time</label><input name="officeStartTime" type="time" class="form-control" value="${esc(profile.officeStartTime || '07:30')}"></div>
      <div class="col-md-4"><label class="form-label">Office End Time</label><input name="officeEndTime" type="time" class="form-control" value="${esc(profile.officeEndTime || '16:00')}"></div>
      <div class="col-md-4"><label class="form-label">Latest Arrival Time</label><input name="latestArrivalTime" type="time" class="form-control" value="${esc(profile.latestArrivalTime || '08:30')}"></div>
      <div class="col-12">
        <label class="form-label">Off Days</label>
        <div class="row g-2">
          ${weekDays.map(([value, label]) => `<div class="col-md-3 col-sm-4"><label class="form-check border rounded px-3 py-2 h-100"><input class="form-check-input me-2" name="offDays" type="checkbox" value="${esc(value)}" ${offDays.has(value) ? 'checked' : ''}>${esc(label)}</label></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="profile-preview mt-4" id="profileLivePreview" style="--preview-primary:${esc(profile.primaryColor || '#132644')};--preview-secondary:${esc(profile.secondaryColor || '#8b8792')};--preview-accent:${esc(profile.accentColor || profile.secondaryColor || '#38bdf8')}">
      <div class="profile-preview-logo profile-preview-empty"><i class="bi bi-display"></i></div>
      <div class="profile-preview-copy"><span>Preview</span><strong id="profilePreviewName">${esc(profile.name || 'Company profile')}</strong><small>Branding will apply to all connected displays</small></div>
    </div>
    <button class="btn btn-primary mt-4">Save Profile</button>
  </form>`;
  modal.show();
  bindCompanyProfilePreview();
  $('#profileForm').onsubmit = async event => {
    event.preventDefault();
    await api(id ? `/api/company-profiles/${id}` : '/api/company-profiles', { method: id ? 'PUT' : 'POST', body: new FormData(event.target) });
    modal.hide();
    toast('Company profile saved');
    route();
  };
}

function bindCompanyProfilePreview() {
  const form = $('#profileForm');
  const preview = $('#profileLivePreview');
  if (!form || !preview) return;
  const update = () => {
    const primary = form.elements.primaryColor?.value || '#132644';
    const secondary = form.elements.secondaryColor?.value || '#8b8792';
    const accent = form.elements.accentColor?.value || secondary || '#38bdf8';
    preview.style.setProperty('--preview-primary', primary);
    preview.style.setProperty('--preview-secondary', secondary);
    preview.style.setProperty('--preview-accent', accent);
    const name = (form.elements.name?.value || '').trim() || 'Company profile';
    const previewName = $('#profilePreviewName');
    if (previewName) previewName.textContent = name;
  };
  ['name', 'primaryColor', 'secondaryColor', 'accentColor'].forEach(name => {
    const field = form.elements[name];
    if (field) field.addEventListener('input', update);
  });
  update();
}

async function activateCompanyProfile(id) {
  if (!id) return;
  await api(`/api/company-profiles/${id}/activate`, { method: 'POST' });
  toast('Company profile activated');
  route();
}

async function deleteCompanyProfile(id) {
  if (!await confirmDelete('Delete Company Profile?')) return;
  await api(`/api/company-profiles/${id}`, { method: 'DELETE' });
  toast('Company profile deleted');
  route();
}

async function weather() {
  setTitle('Weather');
  const current = await api('/api/weather') || {};
  const settings = await api('/api/settings') || {};
  const w = settings.weather || {};
  content.innerHTML = `<div class="card table-card p-4">
    <form id="weatherSettingsForm" class="row g-3">
      <div class="col-md-5"><label class="form-label">OpenWeather API Key</label><input name="apiKey" class="form-control" value="${esc(w.apiKey)}"></div>
      <div class="col-md-3"><label class="form-label">Weather City</label><input name="city" class="form-control" value="${esc(w.city || current.city)}"></div>
      <div class="col-md-2"><label class="form-label">Units</label><select name="units" class="form-select"><option value="metric" ${w.units !== 'imperial' ? 'selected' : ''}>metric</option><option value="imperial" ${w.units === 'imperial' ? 'selected' : ''}>imperial</option></select></div>
      <div class="col-md-2"><label class="form-label">Language</label><input name="lang" class="form-control" value="${esc(w.lang || 'en')}"></div>
      <div class="col-12"><button class="btn btn-primary">Save Weather Settings</button> <button type="button" class="btn btn-outline-secondary" id="refreshWeather">Refresh Now</button></div>
    </form>
    <hr>
    <h3>${esc(current.city || w.city || '')}</h3>
    <div class="display-3">${esc(current.temperature == null ? '-' : current.temperature)}°</div>
    <p>${esc(current.description || '')}</p>
    ${current.icon ? `<img src="${esc(current.icon)}" width="100" alt="">` : ''}
    <p class="text-muted">Fetched: ${esc(current.fetchedAt || w.lastFetched || '')}</p>
  </div>`;
  $('#weatherSettingsForm').onsubmit = async ev => {
    ev.preventDefault();
    await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formObject(ev.target)) });
    toast('Weather settings saved');
    weather();
  };
  $('#refreshWeather').onclick = async () => {
    const result = await api('/api/weather/refresh', { method: 'POST' });
    toast(result.warning || 'Weather refreshed', result.warning ? 'warning' : 'success');
    weather();
  };
}
function zkteco() {
  setTitle('ZKTeco');
  content.innerHTML = `<button class="btn btn-primary btn-rounded mb-3" id="addDeviceBtn"><i class="bi bi-plus-lg"></i> Add Device</button> <button class="btn btn-outline-secondary btn-rounded mb-3" id="syncBtn"><i class="bi bi-arrow-repeat"></i> Sync Now</button><div class="card table-card"><table class="table mb-0"><thead><tr><th>Name</th><th>IP</th><th>Port</th><th>Enabled</th><th>Interval</th><th>Last Sync</th><th>Error</th><th></th></tr></thead><tbody>${state.devices.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.ip)}</td><td>${esc(d.port)}</td><td>${d.enabled ? 'Yes' : 'No'}</td><td>${esc(d.pollingInterval)}s</td><td>${esc(localDateTime(d.lastSyncAt))}</td><td>${esc(d.lastError || '')}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary edit-device" data-id="${d.id}"><i class="bi bi-pencil"></i></button> <button class="btn btn-sm btn-outline-danger del-device" data-id="${d.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div>`;
  $('#addDeviceBtn').onclick = () => deviceForm();
  $('#syncBtn').onclick = async () => {
    const r = await api('/api/zkteco/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const results = r.results || [];
    const hasErrors = results.some(x => !x.ok);
    const imported = results.reduce((sum, item) => sum + Number(item.imported || 0), 0);
    const total = results.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const message = hasErrors ? 'Sync completed with device errors' : imported ? `Sync imported ${imported} new punch${imported === 1 ? '' : 'es'}` : `Sync read ${total} row${total === 1 ? '' : 's'} but imported 0 new punches`;
    toast(message, hasErrors || !imported ? 'warning' : 'success');
    route();
  };
  document.querySelectorAll('.edit-device').forEach(b => b.onclick = () => deviceForm(b.dataset.id));
  document.querySelectorAll('.del-device').forEach(b => b.onclick = async () => { await api(`/api/zkteco/devices/${b.dataset.id}`, { method: 'DELETE' }); toast('Device deleted'); route(); });
}

function deviceForm(id = '') {
  const d = state.devices.find(x => x.id === id) || { port: 4370, pollingInterval: 300, enabled: false, punchLogic: 'latest_available' };
  $('#modalTitle').textContent = id ? 'Edit ZKTeco Device' : 'Add ZKTeco Device';
  $('#modalBody').innerHTML = `<form id="deviceForm"><div class="row g-3"><div class="col-md-6"><label class="form-label">Device Name</label><input name="name" class="form-control" value="${esc(d.name)}" required></div><div class="col-md-6"><label class="form-label">Device IP</label><input name="ip" class="form-control" value="${esc(d.ip)}" required></div><div class="col-md-4"><label class="form-label">Port</label><input name="port" type="number" class="form-control" value="${esc(d.port)}"></div><div class="col-md-4"><label class="form-label">Polling Interval</label><input name="pollingInterval" type="number" class="form-control" value="${esc(d.pollingInterval)}"></div><div class="col-md-4"><label class="form-label">Logic</label><select name="punchLogic" class="form-select"><option value="latest_available" ${d.punchLogic !== 'odd_even' ? 'selected' : ''}>Latest recent punch = Available</option><option value="odd_even" ${d.punchLogic === 'odd_even' ? 'selected' : ''}>Odd punch count = Available</option></select></div><div class="col-12"><div class="form-check"><input name="enabled" type="checkbox" class="form-check-input" ${d.enabled ? 'checked' : ''}><label class="form-check-label">Enabled</label></div></div></div><button class="btn btn-primary mt-4">Save</button></form>`;
  modal.show();
  $('#deviceForm').onsubmit = async ev => { ev.preventDefault(); const data = formObject(ev.target); data.enabled = !!data.enabled; await api(id ? `/api/zkteco/devices/${id}` : '/api/zkteco/devices', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); modal.hide(); toast('Device saved'); route(); };
}

function users() {
  setTitle('Users');
  content.innerHTML = `<button class="btn btn-primary btn-rounded mb-3" id="addUserBtn"><i class="bi bi-plus-lg"></i> Add</button><div class="card table-card"><table class="table mb-0"><thead><tr><th>Username</th><th>Role</th><th>Access Rights</th><th>Active</th><th></th></tr></thead><tbody>${state.users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(permissionSummary(u))}</td><td>${u.active ? 'Yes' : 'No'}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary edit-user" data-id="${u.id}"><i class="bi bi-pencil"></i></button> <button class="btn btn-sm btn-outline-danger del-user" data-id="${u.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div>`;
  $('#addUserBtn').onclick = () => userForm();
  document.querySelectorAll('.edit-user').forEach(b => b.onclick = () => userForm(b.dataset.id));
  document.querySelectorAll('.del-user').forEach(b => b.onclick = () => deleteUser(b.dataset.id));
}

function permissionSummary(user = {}) {
  const role = String(user.role || '').trim().toLowerCase();
  if (['administrator', 'admin', 'super admin', 'superadmin'].includes(role)) return 'All access';
  const permissions = permissionsFor(user);
  if (!permissions.length) return 'No access';
  return permissionOptions.filter(([key]) => permissions.includes(key)).map(([, label]) => label).join(', ');
}

function userForm(id = '') {
  const u = state.users.find(x => x.id === id) || { active: true, role: 'Custom', permissions: [] };
  const selected = new Set(Array.isArray(u.permissions) ? u.permissions : []);
  $('#modalTitle').textContent = id ? 'Edit User' : 'Add User';
  $('#modalBody').innerHTML = `<form id="userForm">
    <label class="form-label">Username</label>
    <input name="username" class="form-control mb-3" required value="${esc(u.username)}">
    <label class="form-label">Password ${id ? '(leave blank to keep current)' : ''}</label>
    <input name="password" type="password" class="form-control mb-3" ${id ? '' : 'required'}>
    <label class="form-label">Role</label>
    <select name="role" class="form-select mb-3">
      ${['Super Admin', 'Employee Viewer', 'Availability Viewer', 'Employee Editor', 'Display', 'Kiosk', 'Custom'].map(role => `<option value="${esc(role)}" ${String(u.role || '').toLowerCase() === role.toLowerCase() ? 'selected' : ''}>${esc(role)}</option>`).join('')}
    </select>
    <div class="mb-3">
      <label class="form-label">Access Rights</label>
      <div class="row g-2">
        ${permissionOptions.map(([key, label]) => `<div class="col-md-6"><label class="form-check border rounded px-3 py-2 h-100"><input class="form-check-input user-permission me-2" type="checkbox" value="${esc(key)}" ${selected.has(key) ? 'checked' : ''}>${esc(label)}</label></div>`).join('')}
      </div>
      <div class="form-text">Choose a role as a shortcut, then tick one or many access rights as needed.</div>
    </div>
    <div class="form-check mb-3"><input class="form-check-input" name="active" type="checkbox" ${u.active ? 'checked' : ''}><label class="form-check-label">Active</label></div>
    <button class="btn btn-primary">Save</button>
  </form>`;
  modal.show();
  const roleField = $('#userForm select[name="role"]');
  const syncRolePermissions = () => {
    const defaults = roleDefaults[String(roleField.value || '').toLowerCase()];
    if (!defaults) return;
    document.querySelectorAll('.user-permission').forEach(input => { input.checked = defaults.includes(input.value); });
  };
  roleField.onchange = syncRolePermissions;
  $('#userForm').onsubmit = async ev => {
    ev.preventDefault();
    const data = formObject(ev.target);
    data.active = !!data.active;
    data.permissions = [...document.querySelectorAll('.user-permission:checked')].map(input => input.value);
    await api('/api/users/' + id, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    modal.hide(); toast('User saved'); route();
  };
}

async function deleteUser(id) {
  if (!await confirmDelete('Delete User?')) return;
  await api('/api/users/' + id, { method: 'DELETE' });
  toast('User deleted'); route();
}

function passwordChangeForm(force = false) {
  $('#modalTitle').textContent = 'Change Password';
  $('#modalBody').innerHTML = `<form id="passwordForm"><label class="form-label">Current Password</label><input name="currentPassword" type="password" class="form-control mb-3" required><label class="form-label">New Password</label><input name="newPassword" type="password" minlength="8" class="form-control mb-3" required><button class="btn btn-primary">Update Password</button></form>`;
  modal.show();
  if (force) modalEl.querySelector('.btn-close').style.display = 'none';
  $('#passwordForm').onsubmit = async ev => { ev.preventDefault(); await api('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formObject(ev.target)) }); modal.hide(); modalEl.querySelector('.btn-close').style.display = ''; toast('Password updated'); route(); };
}

$('#logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/admin/login.html'; };
$('#themeBtn').onclick = () => document.body.classList.toggle('dark-mode');
window.addEventListener('hashchange', route);
route();
