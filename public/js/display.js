const displayId = location.pathname.split('/').filter(Boolean).pop();
const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
const $ = id => document.getElementById(id);
let settings = {};
let weather = null;
let currentPayload = null;
let prayerState = null;
let prayerOverlayTimer = null;
let overviewRotationTimer = null;
let overviewRotationIndex = 0;
let orgState = {
  payload: null,
  focusId: '',
  stack: [],
  timer: null,
  autoTimer: null,
  resumeTimer: null,
  presentation: false,
  phase: 'home',
  managerIndex: 0,
  employeeIndex: 0,
  layout: null
};

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function safeText(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function hexToRgb(hex) {
  const value = String(hex || '').trim().replace('#', '');
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function mixRgb(a, b, amount) {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount)
  };
}

function rgbCss(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function rgbaCss(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function applyCompanyTheme(company = {}) {
  const primary = company.primaryColor || '#22d3ee';
  const secondary = company.secondaryColor || '#60a5fa';
  const accent = company.accentColor || secondary || primary;
  const fontColor = '#F8FBFF';
  document.documentElement.style.setProperty('--primary', primary);
  document.documentElement.style.setProperty('--secondary', secondary);
  document.documentElement.style.setProperty('--company-primary', primary);
  document.documentElement.style.setProperty('--company-secondary', secondary);
  document.documentElement.style.setProperty('--company-accent', accent);
  document.documentElement.style.setProperty('--company-font', fontColor);

  const primaryRgb = hexToRgb(primary) || hexToRgb('#22d3ee');
  const secondaryRgb = hexToRgb(secondary) || hexToRgb('#60a5fa');
  const accentRgb = hexToRgb(accent) || secondaryRgb || primaryRgb;
  const fontRgb = hexToRgb(fontColor) || hexToRgb('#FFFFFF');
  const navy = { r: 4, g: 16, b: 31 };
  const deep = { r: 8, g: 14, b: 34 };
  document.documentElement.style.setProperty('--company-font-rgb', `${fontRgb.r}, ${fontRgb.g}, ${fontRgb.b}`);
  document.documentElement.style.setProperty('--company-font-muted', rgbaCss(fontRgb, 0.74));
  document.documentElement.style.setProperty('--company-font-soft', rgbaCss(fontRgb, 0.58));
  document.documentElement.style.setProperty('--display-bg-start', rgbCss(mixRgb(navy, primaryRgb, 0.16)));
  document.documentElement.style.setProperty('--display-bg-mid', rgbCss(mixRgb(deep, primaryRgb, 0.28)));
  document.documentElement.style.setProperty('--display-bg-end', rgbCss(mixRgb(deep, secondaryRgb, 0.32)));
  document.documentElement.style.setProperty('--display-glow-primary', rgbaCss(primaryRgb, 0.24));
  document.documentElement.style.setProperty('--display-glow-secondary', rgbaCss(accentRgb, 0.2));
}

function displayName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return name || '';
  const midpoint = Math.ceil(parts.length / 2);
  return `${parts.slice(0, midpoint).join(' ')}\n${parts.slice(midpoint).join(' ')}`;
}

function displayLocation(display = {}) {
  const parts = [];
  if (display.showRoomNumber && display.roomNumber) parts.push(`Room ${display.roomNumber}`);
  if (display.name) parts.push(display.name);
  if (display.showCubicleNumber && display.cubicleNumber) parts.push(`Cubicle ${display.cubicleNumber}`);
  return parts.join(' · ');
}

function displayLocationStack(display = {}) {
  const rows = [];
  if (display.showRoomNumber && display.roomNumber) rows.push(['room', `Room ${display.roomNumber}`]);
  if (display.name) rows.push(['office', display.name]);
  if (display.showCubicleNumber && display.cubicleNumber) rows.push(['cubicle', `Cubicle ${display.cubicleNumber}`]);
  return rows.map(([type, label]) => `<span class="display-location-${type}">${safeText(label)}</span>`).join('');
}

function register() {
  socket.emit('register-display', { displayId, resolution: `${screen.width}x${screen.height}` });
}

async function loadData() {
  const res = await fetch(`/api/display-public/${displayId}/data`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Display not found');
  render(await res.json());
}

socket.on('connect', () => {
  $('offline').classList.remove('show');
  register();
});
socket.on('disconnect', () => $('offline').classList.add('show'));
socket.io.on('reconnect_attempt', () => $('offline').classList.add('show'));
socket.io.on('reconnect', () => loadData().catch(() => $('offline').classList.add('show')));
socket.on('display-data', render);
socket.on('weather-update', data => { weather = data; renderWeather(); });
socket.on('company-profile-changed', () => loadData().catch(() => $('offline').classList.add('show')));
socket.on('prayer-event', showPrayerEvent);

function render(payload) {
  if (!payload) return;
  currentPayload = payload;
  document.body.classList.toggle('prayer-display-mode', payload.display?.displayMode === 'prayer');
  settings = payload.settings || settings;
  weather = payload.weather || (settings.weather && settings.weather.data) || weather;
  const company = settings.company || {};
  applyCompanyTheme(company);
  document.body.style.fontFamily = company.displayFont || company.defaultFont || 'Inter, Arial, sans-serif';
  document.body.dataset.backgroundStyle = company.backgroundStyle || 'default';
  $('displayId').className = 'display-id display-location-stack';
  $('displayId').innerHTML = displayLocationStack(payload.display) || `<span class="display-location-office">${safeText(displayId)}</span>`;
  $('company').textContent = '';
  if (company.logo) {
    $('logo').src = company.logo;
    $('logo').hidden = false;
  } else {
    $('logo').hidden = true;
  }

  if (payload.display && payload.display.displayMode === 'overview') {
    $('shell').classList.add('overview-mode');
    $('shell').classList.remove('org-chart-mode');
    $('shell').classList.remove('prayer-mode');
    $('prayerBlock').hidden = true;
    $('orgChartBlock').hidden = true;
    renderOverview(payload);
    renderWeather();
    tick();
    return;
  }

  if (payload.display && payload.display.displayMode === 'orgchart') {
    $('shell').classList.add('org-chart-mode');
    $('shell').classList.remove('overview-mode');
    $('shell').classList.remove('prayer-mode');
    if (overviewRotationTimer) clearInterval(overviewRotationTimer);
    overviewRotationTimer = null;
    $('overviewBlock').hidden = true;
    $('employeeBlock').hidden = true;
    $('prayerBlock').hidden = true;
    $('empty').hidden = true;
    renderOrgChart(payload);
    renderWeather();
    tick();
    return;
  }

  if (payload.display && payload.display.displayMode === 'prayer') {
    $('shell').classList.add('prayer-mode');
    $('shell').classList.remove('overview-mode');
    $('shell').classList.remove('org-chart-mode');
    if (overviewRotationTimer) clearInterval(overviewRotationTimer);
    overviewRotationTimer = null;
    $('overviewBlock').hidden = true;
    $('orgChartBlock').hidden = true;
    $('employeeBlock').hidden = true;
    $('empty').hidden = true;
    renderPrayerBoard(payload);
    renderWeather();
    tick();
    return;
  }

  $('shell').classList.remove('overview-mode');
  $('shell').classList.remove('org-chart-mode');
  $('shell').classList.remove('prayer-mode');
  if (overviewRotationTimer) clearInterval(overviewRotationTimer);
  overviewRotationTimer = null;
  if (orgState.timer) clearTimeout(orgState.timer);
  if (orgState.autoTimer) clearTimeout(orgState.autoTimer);
  if (orgState.resumeTimer) clearTimeout(orgState.resumeTimer);
  orgState.timer = null;
  orgState.autoTimer = null;
  orgState.resumeTimer = null;
  orgState.presentation = false;
  const employee = payload.employee;
  $('overviewBlock').hidden = true;
  $('orgChartBlock').hidden = true;
  $('prayerBlock').hidden = true;
  $('employeeBlock').hidden = !employee;
  $('empty').hidden = !!employee;
  if (employee) {
    $('empName').textContent = displayName(employee.name);
    $('empDesignation').textContent = employee.designation || '';
    $('empDepartment').textContent = employee.department || '';
    $('empExtension').textContent = employee.extension ? `Ext. ${employee.extension}` : '';
    const showPhoneNumber = !!(payload.display && payload.display.showPhoneNumber);
    $('empPhone').textContent = showPhoneNumber ? employee.phone || '' : '';
    $('empEmail').textContent = employee.displayEmail || employee.email || '';
    $('empExtension').hidden = !employee.extension;
    $('empPhone').hidden = !(showPhoneNumber && employee.phone);
    $('empEmail').hidden = !(employee.displayEmail || employee.email);
    const status = (employee.effectiveStatus && employee.effectiveStatus.status) || employee.availabilityStatus || 'Not Available';
    $('statusBadge').textContent = status;
    $('statusBadge').className = `display-status status-${status.toLowerCase().replace(/\s+/g, '-')}`;
    $('statusNote').textContent = '';
    if (employee.photo) {
      $('empPhoto').src = employee.photo;
      $('empPhoto').hidden = false;
      $('empInitials').hidden = true;
    } else {
      $('empInitials').textContent = initials(employee.name);
      $('empInitials').hidden = false;
      $('empPhoto').hidden = true;
    }
    if (payload.qr) {
      $('qrImg').src = payload.qr;
      $('qrBox').hidden = false;
      $('employeeBlock').classList.remove('no-qr');
    } else {
      $('qrBox').hidden = true;
      $('employeeBlock').classList.add('no-qr');
    }
  }
  renderWeather();
  tick();
}

function orgEmployees(payload = orgState.payload) {
  return (payload && payload.orgChart && Array.isArray(payload.orgChart.employees)) ? payload.orgChart.employees : [];
}

function orgEmployeeMap(payload = orgState.payload) {
  return new Map(orgEmployees(payload).map(employee => [employee.id, employee]));
}

function orgDepartments(payload = orgState.payload) {
  return (payload && payload.orgChart && Array.isArray(payload.orgChart.departments)) ? payload.orgChart.departments : [];
}

function orgChildrenOf(employeeId, payload = orgState.payload) {
  return orgEmployees(payload)
    .filter(employee => (employee.managerId || employee.reportsToEmployeeId || '') === employeeId)
    .sort((a, b) => {
      const aOrder = Number(a.orgChartOrder || 0);
      const bOrder = Number(b.orgChartOrder || 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.name || '').localeCompare(b.name || '');
    });
}

function orgInitialIds(payload = orgState.payload) {
  const employees = orgEmployees(payload);
  const map = orgEmployeeMap(payload);
  const configured = (payload?.orgChart?.rootIds || []).filter(id => map.has(id));
  if (configured.length) return configured;
  const managers = employees.filter(employee => employee.isDepartmentManager);
  if (managers.length) return managers.map(employee => employee.id);
  return employees.slice(0, 8).map(employee => employee.id);
}

function renderOrgChart(payload) {
  orgState.payload = payload;
  $('orgChartBlock').hidden = false;
  const employees = orgEmployees(payload);
  const company = settings.company || {};
  $('orgTitle').textContent = payload.display?.name || 'Organization Chart';
  $('orgCount').textContent = `${employees.length} ${employees.length === 1 ? 'Employee' : 'Employees'}`;
  $('orgCompany').textContent = company.name || '';
  $('orgCompany').hidden = true;
  $('orgTitle').hidden = true;
  $('orgCount').hidden = true;
  if (company.logo) {
    $('orgLogo').src = company.logo;
    $('orgLogo').hidden = false;
  } else {
    $('orgLogo').hidden = true;
  }
  $('orgChartBlock').classList.toggle('org-no-animation', payload.display?.orgChartAnimationEnabled === false);
  if (!employees.length) {
    $('orgChartCanvas').innerHTML = '<div class="org-empty">No organization chart data configured.</div>';
    $('orgDetail').hidden = true;
    $('orgBack').disabled = true;
    $('orgHome').disabled = true;
    return;
  }
  if (orgState.focusId && !orgEmployeeMap(payload).has(orgState.focusId)) {
    orgState.focusId = '';
    orgState.stack = [];
  }
  bindOrgControls();
  if (orgState.autoTimer) clearTimeout(orgState.autoTimer);
  if (orgState.resumeTimer) clearTimeout(orgState.resumeTimer);
  orgState.focusId = '';
  orgState.stack = [];
  orgState.managerIndex = 0;
  orgState.employeeIndex = 0;
  orgState.phase = 'full';
  orgState.presentation = true;
  renderOrgView();
}

function orgAutoEnabled(payload = orgState.payload) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !reduced && payload?.display?.orgChartAnimationEnabled !== false;
}

function renderOrgView() {
  const payload = orgState.payload;
  if (orgState.presentation) {
    renderOrgPresentationView();
    return;
  }
  const map = orgEmployeeMap(payload);
  const focus = orgState.focusId ? map.get(orgState.focusId) : null;
  const rootIds = focus ? [focus.id] : orgInitialIds(payload);
  const children = focus ? orgChildrenOf(focus.id, payload) : [];
  const rootEmployees = rootIds.map(id => map.get(id)).filter(Boolean);
  $('orgBack').disabled = !orgState.stack.length;
  $('orgHome').disabled = !orgState.focusId;
  $('orgBreadcrumb').textContent = focus ? focus.name : 'Home';
  $('orgDetail').hidden = true;
  $('orgChartCanvas').innerHTML = focus
    ? renderOrgFocused(focus, children, payload.display || {})
    : renderOrgHome(rootEmployees, payload.display || {});
  document.querySelectorAll('.org-node').forEach(node => {
    node.onclick = () => selectOrgEmployee(node.dataset.id);
  });
}

function isOrgCeo(employee = {}) {
  return /\bceo\b/i.test(employee.designation || '') || /^ceo$/i.test((employee.department || '').trim());
}

function orgTopEmployee(payload = orgState.payload) {
  const employees = orgEmployees(payload);
  const map = orgEmployeeMap(payload);
  const topEmployees = (payload?.orgChart?.topEmployees || []).filter(Boolean);
  if (topEmployees.length) return topEmployees[0];
  const configured = (payload?.orgChart?.rootIds || []).map(id => map.get(id)).filter(Boolean);
  return configured.find(isOrgCeo) || employees.find(isOrgCeo) || configured[0] || employees[0] || null;
}

function orgPresentationManagers(top, payload = orgState.payload) {
  const departments = orgDepartments(payload).filter(department => department.manager);
  if (departments.length) return departments;
  const employees = orgEmployees(payload);
  const childManagers = top ? orgChildrenOf(top.id, payload).filter(employee => orgChildrenOf(employee.id, payload).length || employee.isDepartmentManager) : [];
  const markedManagers = employees.filter(employee => employee.id !== top?.id && (employee.isDepartmentManager || orgChildrenOf(employee.id, payload).length));
  const roots = orgInitialIds(payload).map(id => orgEmployeeMap(payload).get(id)).filter(employee => employee && employee.id !== top?.id);
  const merged = [...childManagers, ...markedManagers, ...roots];
  return [...new Map(merged.map(employee => [employee.id, employee])).values()]
    .sort((a, b) => {
      const aOrder = Number(a.orgChartOrder || 0);
      const bOrder = Number(b.orgChartOrder || 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.name || '').localeCompare(b.name || '');
    });
}

function orgPresentationDepartments(top, payload = orgState.payload) {
  return orgPresentationManagers(top, payload)
    .map(item => {
      if (item && Object.prototype.hasOwnProperty.call(item, 'manager')) {
        const fallbackChildren = item.manager ? orgChildrenOf(item.manager.id, payload) : [];
        const members = Array.isArray(item.employees) && item.employees.length ? item.employees : fallbackChildren;
        return { ...item, employees: members.filter(employee => employee.id !== item.manager?.id) };
      }
      return {
        id: item.id,
        name: item.department || item.name || 'Department',
        shortName: '',
        manager: item,
        employees: orgChildrenOf(item.id, payload)
      };
    })
    .filter(department => department.manager)
    .filter(department => department.manager.id !== top?.id && !/^ceo$/i.test(String(department.name || '').trim()));
}

function buildOrgLayout(top, departments = []) {
  const positions = new Map();
  const deptCount = Math.max(1, departments.length);
  const columns = Math.min(5, deptCount);
  const rows = Math.ceil(deptCount / columns);
  const rowGap = rows > 1 ? 38 : 0;
  positions.set(top.id, { x: 50, y: 6, type: 'ceo' });
  departments.forEach((department, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const rowItems = Math.min(columns, deptCount - row * columns);
    const spread = rowItems === 1 ? 0 : Math.min(72, (rowItems - 1) * 18);
    const startX = 50 - (spread / 2);
    const x = rowItems === 1 ? 50 : startX + (col * (spread / (rowItems - 1)));
    const deptY = 23 + row * rowGap;
    positions.set(`dept:${department.id || department.name}`, { x, y: deptY, type: 'department' });
    if (department.manager) positions.set(department.manager.id, { x, y: deptY + 15, type: 'manager' });
    (department.employees || []).forEach((employee, employeeIndex) => {
      const localCol = employeeIndex % 2;
      const localRow = Math.floor(employeeIndex / 2);
      const offset = department.employees.length === 1 ? 0 : (localCol === 0 ? -5.8 : 5.8);
      positions.set(employee.id, {
        x: Math.max(7, Math.min(93, x + offset)),
        y: deptY + 28 + localRow * 8,
        type: 'employee'
      });
    });
  });
  return { positions, departments, top };
}

function orgNodePosition(id) {
  return orgState.layout?.positions?.get(id) || { x: 50, y: 50 };
}

function orgPath(from, to) {
  const midY = (from.y + to.y) / 2;
  const pull = Math.max(-12, Math.min(12, (to.x - from.x) * 0.35));
  if (Math.abs(to.x - from.x) < 2) {
    return `M ${from.x} ${from.y} C ${from.x} ${midY - 4}, ${to.x} ${midY + 4}, ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} C ${from.x + pull} ${midY - 8}, ${to.x - pull} ${midY + 8}, ${to.x} ${to.y}`;
}

function renderOrgSvg(connectors = []) {
  return `<svg class="org-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    ${connectors.map((connector, index) => `<path class="org-svg-path org-svg-${safeText(connector.type || 'branch')}" pathLength="1" style="animation-delay:${Math.min(index * 0.12, 1.1)}s" d="${orgPath(connector.from, connector.to)}"></path>`).join('')}
  </svg>`;
}

function renderOrgAbsNode(employee, display = {}, className = '') {
  const position = orgNodePosition(employee.id);
  return `<div class="org-abs-node ${className}" style="left:${position.x}%;top:${position.y}%">${renderOrgNode(employee, display, className.includes('manager') || className.includes('ceo'), className.includes('employee') ? 'org-node-small' : '')}</div>`;
}

function renderOrgDepartmentLabel(department, className = '') {
  const position = orgNodePosition(`dept:${department.id || department.name}`);
  return `<div class="org-dept-node ${className}" style="left:${position.x}%;top:${position.y}%">${safeText(department.name || 'Department')}</div>`;
}

function orgVisibleModel(top, departments, phase, managerIndex, employeeIndex) {
  const visibleDepartments = [];
  const connectors = [];
  departments.forEach((department, index) => {
    if (index > managerIndex && phase !== 'full') return;
    const isPast = index < managerIndex || phase === 'full';
    const isCurrent = index === managerIndex && phase !== 'full';
    const revealDepartment = isPast || isCurrent;
    if (!revealDepartment) return;
    const revealManager = isPast || ['managerSettle', 'employeeFocus', 'employeeSettle'].includes(phase) || phase === 'full';
    const revealEmployees = isPast || phase === 'full'
      ? department.employees?.length || 0
      : (['employeeFocus', 'employeeSettle'].includes(phase) ? employeeIndex + (phase === 'employeeSettle' ? 1 : 0) : 0);
    visibleDepartments.push({ ...department, revealManager, revealCount: revealEmployees, complete: isPast || phase === 'full' });
    connectors.push({ type: 'department', from: orgNodePosition(top.id), to: orgNodePosition(`dept:${department.id || department.name}`) });
    if (revealManager && department.manager) {
      connectors.push({ type: 'manager', from: orgNodePosition(`dept:${department.id || department.name}`), to: orgNodePosition(department.manager.id) });
    }
    (department.employees || []).slice(0, revealEmployees).forEach(employee => {
      connectors.push({
        type: 'employee',
        from: department.manager ? orgNodePosition(department.manager.id) : orgNodePosition(`dept:${department.id || department.name}`),
        to: orgNodePosition(employee.id)
      });
    });
  });
  return { visibleDepartments, connectors };
}

function renderOrgPresentationView() {
  const payload = orgState.payload;
  const display = payload?.display || {};
  const top = orgTopEmployee(payload);
  if (!top) {
    orgState.presentation = false;
    renderOrgView();
    return;
  }
  const departments = orgPresentationDepartments(top, payload);
  orgState.layout = buildOrgLayout(top, departments);
  const department = departments[orgState.managerIndex] || null;
  const manager = department?.manager || null;
  const employeeIndex = Number(orgState.employeeIndex || 0);
  $('orgBack').disabled = true;
  $('orgHome').disabled = false;
  $('orgBreadcrumb').textContent = '';
  $('orgDetail').hidden = true;
  if (orgState.phase === 'intro') {
    $('orgChartCanvas').innerHTML = `<div class="org-presentation org-phase-intro">
      <div class="org-detail-focus org-ceo-intro">${renderOrgDetailCard(top, display, 'CEO')}</div>
    </div>`;
  } else if (orgState.phase === 'full') {
    $('orgChartCanvas').innerHTML = renderOrgFinalChart(top, departments, display);
  } else {
    const focusPerson = orgState.phase === 'managerFocus'
      ? manager
      : (orgState.phase === 'employeeFocus' ? department?.employees?.[employeeIndex] : null);
    const model = orgVisibleModel(top, departments, orgState.phase, orgState.managerIndex, employeeIndex);
    const focusClass = orgState.phase === 'employeeFocus' ? 'org-employee-focus' : 'org-manager-focus';
    const focusStyle = focusPerson ? orgFocusStyle(focusPerson, orgState.phase, department) : '';
    $('orgChartCanvas').innerHTML = `<div class="org-presentation org-phase-${safeText(orgState.phase)}">
      ${renderOrgAbsoluteTree(top, model.visibleDepartments, model.connectors, display, '', null, {
        settlingManagerId: orgState.phase === 'managerSettle' ? manager?.id : '',
        settlingEmployeeId: orgState.phase === 'employeeSettle' ? department?.employees?.[employeeIndex]?.id : ''
      })}
      ${focusPerson ? `<div class="org-detail-focus ${focusClass}" style="${focusStyle}">${renderOrgDetailCard(focusPerson, display, department?.name || '')}</div>` : ''}
    </div>`;
  }
  document.querySelectorAll('.org-node').forEach(node => {
    node.onclick = () => selectOrgEmployee(node.dataset.id);
  });
}

function orgColorClass(index) {
  return `org-color-${(index % 5) + 1}`;
}

function renderOrgFinalChart(top, departments, display = {}) {
  const visibleDepartments = departments.filter(department => !/^ceo$/i.test(String(department.name || '').trim()));
  const departmentCount = Math.max(1, visibleDepartments.length);
  return `<div class="org-final-chart org-presentation org-phase-full" style="--org-dept-count:${departmentCount}">
    <div class="org-final-root">${renderOrgNode(top, display, true, 'org-final-ceo-node')}</div>
    <div class="org-final-trunk"></div>
    <div class="org-final-departments">
      ${visibleDepartments.map((department, index) => {
        const colorClass = orgColorClass(index);
        const members = department.employees || [];
        return `<section class="org-final-department ${colorClass}">
          <div class="org-final-branch"></div>
          <div class="org-final-dept-title">${safeText(department.name || 'Department')}</div>
          <div class="org-final-team">
            ${department.manager ? `<div class="org-final-manager">${renderOrgNode(department.manager, display, false, 'org-node-small org-final-person')}</div>` : ''}
            ${members.length ? `<div class="org-final-members ${members.length > 1 ? 'org-final-members-side' : 'org-final-members-single'}">
              ${members.map(employee => renderOrgNode(employee, display, false, 'org-node-small org-final-person')).join('')}
            </div>` : ''}
          </div>
        </section>`;
      }).join('')}
    </div>
  </div>`;
}

function orgFocusStyle(employee, phase, department) {
  const target = phase === 'employeeFocus'
    ? orgNodePosition(employee.id)
    : orgNodePosition(department?.manager?.id || employee.id);
  const left = phase === 'employeeFocus'
    ? Math.max(18, Math.min(82, target.x + (target.x < 50 ? 20 : -20)))
    : Math.max(18, Math.min(82, target.x));
  const top = phase === 'employeeFocus'
    ? Math.max(42, Math.min(72, target.y - 2))
    : Math.max(43, Math.min(68, target.y + 13));
  return `left:${left}%;top:${top}%`;
}

function renderOrgAbsoluteTree(top, departments, connectors, display = {}, extraClass = '', highlightedDepartment = null, options = {}) {
  return `<div class="org-stage ${extraClass}">
    ${renderOrgSvg(connectors)}
    ${renderOrgAbsNode(top, display, 'org-abs-ceo')}
    ${highlightedDepartment ? renderOrgDepartmentLabel(highlightedDepartment, 'org-dept-current') : ''}
    ${departments.map(department => `${renderOrgDepartmentLabel(department, department.complete ? 'org-dept-complete' : 'org-dept-active')}
      ${department.revealManager && department.manager ? renderOrgAbsNode(department.manager, display, `org-abs-manager ${options.settlingManagerId === department.manager.id ? 'org-node-settling' : ''}`) : ''}
      ${(department.employees || []).slice(0, department.revealCount || 0).map(employee => renderOrgAbsNode(employee, display, `org-abs-employee ${options.settlingEmployeeId === employee.id ? 'org-node-settling' : ''}`)).join('')}`).join('')}
  </div>`;
}

function renderOrgBranches(departments, display = {}) {
  if (!departments.length) return '';
  return `<div class="org-full-tree org-progress-tree">${departments.map(department => `<section class="org-department-tree ${department.complete ? 'org-branch-complete' : 'org-branch-active'}">
    <h3>${safeText(department.name || 'Department')}</h3>
    ${department.manager ? renderOrgNode(department.manager, display, true) : ''}
    ${department.employees?.length ? `<div class="org-mini-grid">${department.employees.slice(0, department.revealCount || 0).map(employee => renderOrgNode(employee, display, false, 'org-node-small')).join('')}</div>` : ''}
  </section>`).join('')}</div>`;
}

function renderOrgDetailCard(employee, display = {}, label = '') {
  const status = (employee.effectiveStatus && employee.effectiveStatus.status) || employee.availabilityStatus || 'Not Available';
  const showPhotos = display.orgChartShowPhotos !== false;
  const avatar = showPhotos && employee.photo
    ? `<img src="${safeText(employee.photo)}" alt="">`
    : `<span>${safeText(initials(employee.name))}</span>`;
  return `<article class="org-focus-card" data-id="${safeText(employee.id)}">
    <div class="org-focus-label">${safeText(label)}</div>
    <div class="org-detail-avatar">${avatar}</div>
    <h2>${safeText(employee.name)}</h2>
    <p>${safeText(employee.designation || '')}</p>
    ${employee.shortDescription ? `<div class="org-detail-description">${safeText(employee.shortDescription)}</div>` : ''}
    <strong>${safeText(status)}</strong>
  </article>`;
}

function renderOrgFullTree(top, departments, display = {}) {
  const departmentHtml = departments.map(department => `<section class="org-department-tree">
    <h3>${safeText(department.name || 'Department')}</h3>
    ${department.manager ? renderOrgNode(department.manager, display, true) : ''}
    ${department.employees?.length ? `<div class="org-mini-grid">${department.employees.map(employee => renderOrgNode(employee, display, false, 'org-node-small')).join('')}</div>` : ''}
  </section>`).join('');
  return `<div class="org-presentation org-phase-full">
    <div class="org-level org-root-level">${top ? renderOrgNode(top, display, true) : ''}</div>
    <div class="org-connector"></div>
    <div class="org-full-tree">${departmentHtml}</div>
  </div>`;
}

function startOrgAutoPresentation(reset = false) {
  if (!orgAutoEnabled()) return;
  if (orgState.autoTimer) clearTimeout(orgState.autoTimer);
  if (orgState.resumeTimer) clearTimeout(orgState.resumeTimer);
  if (reset) {
    orgState.focusId = '';
    orgState.stack = [];
    orgState.managerIndex = 0;
    orgState.employeeIndex = 0;
    orgState.phase = 'intro';
  }
  orgState.presentation = true;
  renderOrgView();
  const departments = orgPresentationDepartments(orgTopEmployee());
  const focusSeconds = Math.max(1, Number(orgState.payload?.display?.orgChartManagerFocusSeconds || 10) || 10);
  const delayByPhase = {
    intro: 5000,
    deptTitle: 2200,
    managerFocus: focusSeconds * 1000,
    managerSettle: 1500,
    employeeFocus: 5000,
    employeeSettle: 1400,
    full: 30000
  };
  const nextDelay = delayByPhase[orgState.phase] || 1200;
  orgState.autoTimer = setTimeout(() => {
    if (orgState.phase === 'intro') {
      orgState.phase = departments.length ? 'deptTitle' : 'full';
    } else if (orgState.phase === 'deptTitle') {
      orgState.phase = 'managerFocus';
    } else if (orgState.phase === 'managerFocus') {
      orgState.phase = 'managerSettle';
    } else if (orgState.phase === 'managerSettle') {
      orgState.employeeIndex = 0;
      orgState.phase = departments[orgState.managerIndex]?.employees?.length ? 'employeeFocus' : 'employeeSettle';
    } else if (orgState.phase === 'employeeFocus') {
      orgState.phase = 'employeeSettle';
    } else if (orgState.phase === 'employeeSettle') {
      const current = departments[orgState.managerIndex];
      if (current && orgState.employeeIndex < (current.employees?.length || 0) - 1) {
        orgState.employeeIndex += 1;
        orgState.phase = 'employeeFocus';
      } else if (orgState.managerIndex < departments.length - 1) {
        orgState.managerIndex += 1;
        orgState.employeeIndex = 0;
        orgState.phase = 'deptTitle';
      } else {
        orgState.phase = 'full';
      }
    } else if (orgState.phase === 'full') {
      orgState.managerIndex = 0;
      orgState.employeeIndex = 0;
      orgState.phase = 'intro';
    }
    startOrgAutoPresentation(false);
  }, nextDelay);
}

function renderOrgHome(items, display = {}) {
  return `<div class="org-level org-root-level">
    ${items.map(employee => renderOrgNode(employee, display)).join('')}
  </div>`;
}

function renderOrgFocused(employee, children, display = {}) {
  const childHtml = children.length
    ? `<div class="org-connector"></div><div class="org-level org-child-level">${children.map(child => renderOrgNode(child, display)).join('')}</div>`
    : '';
  return `<div class="org-focus-wrap">
    <div class="org-level org-root-level">${renderOrgNode(employee, display, true)}</div>
    ${childHtml || '<div class="org-leaf-hint">Tap again or use details to view this profile.</div>'}
  </div>`;
}

function renderOrgNode(employee, display = {}, focused = false, extraClass = '') {
  const status = (employee.effectiveStatus && employee.effectiveStatus.status) || employee.availabilityStatus || 'Not Available';
  const cls = status.toLowerCase().replace(/\s+/g, '-');
  const showPhotos = display.orgChartShowPhotos !== false;
  const avatar = showPhotos && employee.photo
    ? `<img src="${safeText(employee.photo)}" alt="">`
    : `<span>${safeText(initials(employee.name))}</span>`;
  return `<article class="org-node ${focused ? 'org-node-focused' : ''} ${extraClass}" data-id="${safeText(employee.id)}">
    <div class="org-avatar">${avatar}</div>
    <div class="org-node-copy">
      <h2>${safeText(employee.name)}</h2>
      <p>${safeText(employee.designation || employee.department || 'Team Member')}</p>
      <small>${safeText(employee.department || '')}</small>
      <strong class="org-status status-${safeText(cls)}">${safeText(status)}</strong>
    </div>
  </article>`;
}

function selectOrgEmployee(id) {
  const map = orgEmployeeMap();
  const employee = map.get(id);
  if (!employee) return;
  const children = orgChildrenOf(id);
  pauseOrgAutoForInteraction();
  if (!children.length && orgState.focusId === id) {
    showOrgDetail(employee);
    return;
  }
  if (!children.length) {
    showOrgDetail(employee);
    return;
  }
  if (orgState.focusId) orgState.stack.push(orgState.focusId);
  orgState.focusId = id;
  renderOrgView();
}

function showOrgDetail(employee) {
  const status = (employee.effectiveStatus && employee.effectiveStatus.status) || employee.availabilityStatus || 'Not Available';
  const avatar = employee.photo
    ? `<img src="${safeText(employee.photo)}" alt="">`
    : `<span>${safeText(initials(employee.name))}</span>`;
  $('orgDetail').innerHTML = `<button type="button" class="org-detail-close" aria-label="Close">×</button>
    <div class="org-detail-avatar">${avatar}</div>
    <h2>${safeText(employee.name)}</h2>
    <p>${safeText(employee.designation || '')}</p>
    <small>${safeText(employee.department || '')}</small>
    <strong>${safeText(status)}</strong>
    ${employee.shortDescription ? `<div class="org-detail-description">${safeText(employee.shortDescription)}</div>` : ''}`;
  $('orgDetail').hidden = false;
  $('orgDetail').querySelector('.org-detail-close').onclick = () => { $('orgDetail').hidden = true; pauseOrgAutoForInteraction(); };
}

function bindOrgControls() {
  $('orgBack').onclick = () => {
    pauseOrgAutoForInteraction();
    orgState.focusId = orgState.stack.pop() || '';
    $('orgDetail').hidden = true;
    renderOrgView();
  };
  $('orgHome').onclick = () => {
    orgState.focusId = '';
    orgState.stack = [];
    $('orgDetail').hidden = true;
    if (orgAutoEnabled()) startOrgAutoPresentation(true);
    else renderOrgView();
  };
}

function pauseOrgAutoForInteraction() {
  if (orgState.autoTimer) clearTimeout(orgState.autoTimer);
  if (orgState.resumeTimer) clearTimeout(orgState.resumeTimer);
  orgState.autoTimer = null;
  orgState.presentation = false;
  resetOrgAutoTimer();
}

function resetOrgAutoTimer() {
  if (orgState.timer) clearTimeout(orgState.timer);
  const seconds = Number(orgState.payload?.display?.orgChartAutoResetSeconds || 0);
  if (!seconds) return;
  orgState.timer = setTimeout(() => {
    orgState.focusId = '';
    orgState.stack = [];
    if ($('orgChartBlock') && !$('orgChartBlock').hidden) {
      $('orgDetail').hidden = true;
      if (orgAutoEnabled()) startOrgAutoPresentation(true);
      else renderOrgView();
    }
  }, seconds * 1000);
}

function renderOverview(payload) {
  const employees = payload.employees || [];
  const company = settings.company || {};
  const showCompanyName = payload.display?.overviewShowCompanyName !== false;
  const rotationCompanies = payload.display?.rotateCompanyProfiles && Array.isArray(payload.rotationCompanies) && payload.rotationCompanies.length
    ? payload.rotationCompanies
    : [];
  $('employeeBlock').hidden = true;
  $('empty').hidden = employees.length > 0;
  $('overviewBlock').hidden = false;
  $('overviewTitle').textContent = displayLocation(payload.display) || payload.display.name || 'Employee Status';
  $('overviewCount').textContent = `${employees.length} ${employees.length === 1 ? 'Employee' : 'Employees'}`;
  applyOverviewBrand(rotationCompanies[0] || company, showCompanyName);
  if (overviewRotationTimer) clearInterval(overviewRotationTimer);
  overviewRotationTimer = null;
  overviewRotationIndex = 0;
  if (rotationCompanies.length > 1) {
    const intervalMs = Math.max(5, Number(payload.display?.rotationIntervalSeconds || 30)) * 1000;
    overviewRotationTimer = setInterval(() => {
      overviewRotationIndex = (overviewRotationIndex + 1) % rotationCompanies.length;
      applyOverviewBrand(rotationCompanies[overviewRotationIndex], showCompanyName);
    }, intervalMs);
  }
  $('overviewGrid').className = `overview-grid overview-size-${sizeClass(employees.length)}`;
  $('overviewGrid').innerHTML = renderOverviewBoard(employees, payload.display || {});
  if (payload.companyQr) {
    $('overviewCompanyQrImg').src = payload.companyQr;
    $('overviewCompanyQr').hidden = false;
    $('overviewNotice').textContent = 'Scan to view employee directory';
    $('overviewNotice').hidden = false;
  } else {
    $('overviewCompanyQr').hidden = true;
    $('overviewNotice').textContent = 'All employees · Live status';
    $('overviewNotice').hidden = false;
  }
}

function applyOverviewBrand(company = {}, showCompanyName = true) {
  applyCompanyTheme(company);
  $('overviewCompany').textContent = company.name || '';
  $('overviewCompany').hidden = !showCompanyName;
  if (company.logo) {
    $('overviewLogo').src = company.logo;
    $('overviewLogo').hidden = false;
  } else {
    $('overviewLogo').hidden = true;
  }
}

function sizeClass(count) {
  if (count > 18) return 'dense';
  if (count > 10) return 'compact';
  return 'roomy';
}

function employeeDepartment(employee) {
  return (employee.department || 'Unassigned Department').trim() || 'Unassigned Department';
}

function isCeo(employee) {
  return /\bceo\b/i.test(employee.designation || '') || /^ceo$/i.test((employee.department || '').trim());
}

function renderOverviewBoard(employees, display = {}) {
  const sourceIndex = new Map(employees.map((employee, index) => [employee.id, index]));
  const globalOrder = new Map((Array.isArray(display.overviewEmployeeOrder) ? display.overviewEmployeeOrder : []).map((id, index) => [id, index]));
  const orderByDepartment = display.overviewEmployeeOrderByDepartment && typeof display.overviewEmployeeOrderByDepartment === 'object'
    ? display.overviewEmployeeOrderByDepartment
    : {};
  const orderedEmployees = [...employees].sort((a, b) => {
    const aDept = employeeDepartment(a);
    const bDept = employeeDepartment(b);
    if (aDept === bDept) {
      const deptOrder = new Map((orderByDepartment[aDept] || []).map((id, index) => [id, index]));
      const aDeptOrder = deptOrder.has(a.id) ? deptOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bDeptOrder = deptOrder.has(b.id) ? deptOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aDeptOrder !== bDeptOrder) return aDeptOrder - bDeptOrder;
    }
    const aGlobal = globalOrder.has(a.id) ? globalOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bGlobal = globalOrder.has(b.id) ? globalOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aGlobal !== bGlobal) return aGlobal - bGlobal;
    return (sourceIndex.get(a.id) || 0) - (sourceIndex.get(b.id) || 0);
  });
  const leaders = orderedEmployees.filter(isCeo);
  const departments = new Map();
  orderedEmployees.filter(employee => !isCeo(employee)).forEach(employee => {
    const department = employeeDepartment(employee);
    if (!departments.has(department)) departments.set(department, []);
    departments.get(department).push(employee);
  });
  const departmentIndex = new Map([...departments.keys()].map((department, index) => [department, index]));
  const departmentOrder = new Map((Array.isArray(display.overviewDepartmentOrder) ? display.overviewDepartmentOrder : []).map((department, index) => [department, index]));
  const departmentLayout = new Map((Array.isArray(display.overviewDepartmentLayout) ? display.overviewDepartmentLayout : [])
    .map(item => [item.departmentName, {
      displayOrder: Number(item.displayOrder || 0) || 0
    }]));
  const orderedDepartments = [...departments.entries()]
    .sort(([a], [b]) => {
      const aLayout = departmentLayout.get(a) || {};
      const bLayout = departmentLayout.get(b) || {};
      const aOrder = aLayout.displayOrder || (departmentOrder.has(a) ? departmentOrder.get(a) + 1 : Number.MAX_SAFE_INTEGER);
      const bOrder = bLayout.displayOrder || (departmentOrder.has(b) ? departmentOrder.get(b) + 1 : Number.MAX_SAFE_INTEGER);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (departmentIndex.get(a) || 0) - (departmentIndex.get(b) || 0);
    });
  const departmentSection = ([department, items]) => `<section class="overview-department-section">
      <h3>${safeText(department)}</h3>
      <div class="overview-department-list">
        ${items.map(employee => renderOverviewEmployee(employee)).join('')}
      </div>
    </section>`;
  const departmentHtml = orderedDepartments.map(departmentSection).join('');
  const leaderHtml = leaders.length ? `<section class="overview-leadership">
    <div class="overview-leadership-label">CEO</div>
    <div class="overview-leadership-list">${leaders.map(employee => renderOverviewEmployee(employee, true)).join('')}</div>
  </section>` : '';
  return `${leaderHtml}<div class="overview-departments">${departmentHtml}</div>`;
}

function renderOverviewEmployee(employee, leader = false) {
  const status = (employee.effectiveStatus && employee.effectiveStatus.status) || 'Not Available';
  const cls = status.toLowerCase().replace(/\s+/g, '-');
  const location = employee.overviewLocation || '';
  if (leader) {
    return `<article class="overview-ceo-person">
      <h2>${safeText(employee.name)}</h2>
      <div class="overview-role">${safeText(employee.designation || '-')}</div>
      ${location ? `<div class="overview-location">${safeText(location).replace(/\n/g, '<br>')}</div>` : ''}
      <span class="overview-ceo-rule"></span>
    </article>`;
  }
  return `<article class="overview-person">
    <span class="overview-person-marker"></span>
    <div class="overview-person-copy">
      <h2>${safeText(employee.name)}</h2>
      <div class="overview-role">${safeText(employee.designation || '-')}</div>
      ${location ? `<div class="overview-location">${safeText(location).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="overview-status-text status-${safeText(cls)}">${safeText(status)}</div>
    </div>
  </article>`;
}

function renderWeather() {
  if (!weather || weather.temperature === undefined || weather.temperature === null) {
    $('weatherText').textContent = '';
    $('overviewWeatherText').textContent = '';
    $('orgWeatherText').textContent = '';
    $('prayerWeatherText').textContent = '';
    $('weatherIcon').hidden = true;
    $('overviewWeatherIcon').hidden = true;
    $('orgWeatherIcon').hidden = true;
    $('prayerWeatherIcon').hidden = true;
    return;
  }
  const unit = weather.units === 'imperial' ? '°F' : '°C';
  $('weatherText').textContent = `${weather.temperature}${unit}`;
  $('overviewWeatherText').textContent = `${weather.temperature}${unit}`;
  $('orgWeatherText').textContent = `${weather.temperature}${unit}`;
  $('prayerWeatherText').textContent = `${weather.temperature}${unit}`;
  if (weather.icon) {
    $('weatherIcon').src = weather.icon;
    $('overviewWeatherIcon').src = weather.icon;
    $('orgWeatherIcon').src = weather.icon;
    $('prayerWeatherIcon').src = weather.icon;
    $('weatherIcon').hidden = false;
    $('overviewWeatherIcon').hidden = false;
    $('orgWeatherIcon').hidden = false;
    $('prayerWeatherIcon').hidden = false;
  } else {
    $('weatherIcon').hidden = true;
    $('overviewWeatherIcon').hidden = true;
    $('orgWeatherIcon').hidden = true;
    $('prayerWeatherIcon').hidden = true;
  }
}

function renderPrayerBoard(payload) {
  prayerState = payload.prayer || null;
  const profile = prayerState?.profile || {};
  $('prayerBlock').hidden = false;
  $('prayerCity').textContent = [profile.city, profile.country].filter(Boolean).join(', ');
  $('prayerTitle').textContent = profile.name || 'Prayer Times';
  const timings = prayerState?.timings || {};
  const names = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  $('prayerTimesGrid').innerHTML = names.map(name => `<article class="prayer-time-card"><span>${safeText(name)}</span><strong>${safeText(timings[name] || '--:--')}</strong></article>`).join('');
  updatePrayerCountdowns();
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updatePrayerCountdowns() {
  if (!prayerState) return;
  const now = Date.now();
  const events = Array.isArray(prayerState.events) ? prayerState.events : [];
  const next = events.find(event => new Date(event.at).getTime() >= now);
  $('nextPrayerName').textContent = next ? `${next.prayer} ${next.type === 'iqama' ? 'Iqama' : 'Adhan'}` : '--';
  $('nextPrayerCountdown').textContent = next ? formatDuration(new Date(next.at).getTime() - now) : '--:--:--';
  const recentAdhan = [...events].reverse().find(event => event.type === 'adhan' && now >= new Date(event.at).getTime());
  const nextIqama = recentAdhan ? events.find(event => event.type === 'iqama' && event.prayer === recentAdhan.prayer && new Date(event.at).getTime() >= now) : null;
  $('iqamaCountdown').textContent = nextIqama ? `${nextIqama.prayer} Iqama in ${formatDuration(new Date(nextIqama.at).getTime() - now)}` : '';
  document.body.classList.toggle('prayer-between', !!nextIqama);
}

function showPrayerEvent(event = {}) {
  $('prayerOverlayType').textContent = event.type === 'iqama' ? 'Iqama Time' : 'Prayer Time';
  $('prayerOverlayName').textContent = event.prayer || '';
  $('prayerOverlayMessage').textContent = event.type === 'iqama' ? 'Please proceed for Iqama' : `${event.profileName || ''} ${event.city || ''}`.trim();
  $('prayerOverlay').hidden = false;
  if (prayerOverlayTimer) clearTimeout(prayerOverlayTimer);
  prayerOverlayTimer = setTimeout(() => { $('prayerOverlay').hidden = true; }, event.type === 'iqama' ? 90000 : 120000);
  if (currentPayload?.display?.displayMode === 'prayer' && event.audio && (!prayerState?.profile?.id || prayerState.profile.id === event.profileId)) {
    const audio = $('prayerAudio');
    audio.src = event.audio;
    audio.play().catch(() => {});
  }
  loadData().catch(() => {});
}

function tick() {
  const now = new Date();
  const hour12 = settings.company && settings.company.clockFormat === '12';
  $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12 });
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  $('overviewClock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 });
  $('overviewDate').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  $('orgClock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 });
  $('orgDate').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  $('prayerClock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12 });
  $('prayerDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  updatePrayerCountdowns();
}

setInterval(tick, 1000);
loadData().catch(() => $('offline').classList.add('show'));
