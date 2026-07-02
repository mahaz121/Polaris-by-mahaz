const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
require('dotenv').config();

const root = path.join(__dirname, '..', '..');
const dataDir = path.join(root, 'data');
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'polaris.sqlite');

const defaults = {
  settings: {
    company: {
      name: '',
      logo: '',
      primaryColor: '#132644',
      secondaryColor: '#8b8792',
      defaultFont: 'Inter, Arial, sans-serif',
      clockFormat: '24',
      language: 'English',
      phone: '',
      email: '',
      website: '',
      address: '',
      notice: ''
    },
    weather: {
      apiKey: process.env.OPENWEATHER_API_KEY || '',
      city: process.env.OPENWEATHER_CITY || 'Riyadh',
      units: 'metric',
      lang: 'en',
      lastFetched: null,
      data: null
    },
    ui: { theme: 'dark' }
  }
};

fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function json(value, fallback = null) {
  if (value === undefined) return JSON.stringify(fallback);
  return JSON.stringify(value);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function simpleOverviewDepartmentLayout(value) {
  const items = parseJson(value, []);
  if (!Array.isArray(items)) return [];
  return items.map(item => ({
    departmentName: String(item.departmentName || item.name || '').trim(),
    displayOrder: Number(item.displayOrder || item.order || 0) || 0
  })).filter(item => item.departmentName);
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(name, fallback) {
  const file = path.join(dataDir, name);
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Administrator',
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      employee_number TEXT,
      name TEXT NOT NULL,
      department TEXT,
      designation TEXT,
      phone TEXT,
      email TEXT,
      company_email_local_part TEXT,
      manager_id TEXT,
      is_department_manager INTEGER NOT NULL DEFAULT 0,
      org_chart_order INTEGER NOT NULL DEFAULT 0,
      short_description TEXT,
      room_number TEXT,
      photo TEXT,
      qr_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Active',
      availability_status TEXT NOT NULL DEFAULT 'Not Available',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      short_name TEXT,
      manager_employee_id TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS displays (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      employee_id TEXT,
      status TEXT NOT NULL DEFAULT 'Offline',
      last_seen TEXT,
      ip_address TEXT,
      resolution TEXT,
      show_room_number INTEGER NOT NULL DEFAULT 0,
      show_phone_number INTEGER NOT NULL DEFAULT 0,
      org_chart_root_mode TEXT NOT NULL DEFAULT 'department_managers',
      org_chart_show_photos INTEGER NOT NULL DEFAULT 1,
      org_chart_animation_enabled INTEGER NOT NULL DEFAULT 1,
      org_chart_auto_reset_seconds INTEGER NOT NULL DEFAULT 60,
      org_chart_selected_employee_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      slug TEXT NOT NULL UNIQUE,
      logo TEXT,
      primary_color TEXT,
      secondary_color TEXT,
      accent_color TEXT,
      font_color TEXT DEFAULT '#FFFFFF',
      background_style TEXT,
      display_font TEXT,
      clock_format TEXT,
      language TEXT,
      company_phone TEXT,
      company_email TEXT,
      company_website TEXT,
      company_address TEXT,
      company_notice TEXT,
      weather_city TEXT,
      open_weather_api_key TEXT,
      weather_lang TEXT,
      weather_units TEXT,
      email_domain TEXT,
      weather_data TEXT,
      weather_last_fetched TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_number TEXT NOT NULL,
      device_id TEXT,
      punch_time TEXT NOT NULL,
      punch_type TEXT,
      raw_data TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(employee_number, device_id, punch_time)
    );

    CREATE TABLE IF NOT EXISTS employee_status_overrides (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      status TEXT NOT NULL,
      start_at TEXT,
      end_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS zkteco_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 4370,
      enabled INTEGER NOT NULL DEFAULT 0,
      polling_interval INTEGER NOT NULL DEFAULT 300,
      punch_logic TEXT NOT NULL DEFAULT 'latest_available',
      last_sync_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS display_employee_assignments (
      display_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (display_id, employee_id),
      FOREIGN KEY(display_id) REFERENCES displays(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
  `);

  ensureColumn('employees', 'extension', 'TEXT');
  ensureColumn('employees', 'room_number', 'TEXT');
  ensureColumn('employees', 'display_group', 'TEXT');
  ensureColumn('employees', 'company_email_local_part', 'TEXT');
  ensureColumn('employees', 'manager_id', 'TEXT');
  ensureColumn('employees', 'is_department_manager', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('employees', 'org_chart_order', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('employees', 'short_description', 'TEXT');
  ensureColumn('departments', 'manager_employee_id', 'TEXT');
  ensureColumn('displays', 'display_mode', "TEXT NOT NULL DEFAULT 'single'");
  ensureColumn('displays', 'display_group', 'TEXT');
  ensureColumn('displays', 'room_number', 'TEXT');
  ensureColumn('displays', 'show_room_number', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('displays', 'show_phone_number', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('displays', 'org_chart_root_mode', "TEXT NOT NULL DEFAULT 'department_managers'");
  ensureColumn('displays', 'org_chart_show_photos', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('displays', 'org_chart_animation_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('displays', 'org_chart_auto_reset_seconds', 'INTEGER NOT NULL DEFAULT 60');
  ensureColumn('displays', 'org_chart_manager_focus_seconds', 'INTEGER NOT NULL DEFAULT 10');
  ensureColumn('displays', 'org_chart_selected_employee_ids', 'TEXT');
  ensureColumn('displays', 'org_chart_included_department_ids', 'TEXT');
  ensureColumn('displays', 'cubicle_number', 'TEXT');
  ensureColumn('displays', 'show_cubicle_number', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('displays', 'rotate_company_profiles', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('displays', 'rotation_interval_seconds', 'INTEGER NOT NULL DEFAULT 30');
  ensureColumn('displays', 'rotation_company_profile_ids', 'TEXT');
  ensureColumn('displays', 'overview_show_company_name', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('displays', 'overview_department_order', 'TEXT');
  ensureColumn('displays', 'overview_department_layout', 'TEXT');
  ensureColumn('displays', 'overview_employee_order', 'TEXT');
  ensureColumn('displays', 'overview_employee_order_by_department', 'TEXT');
  ensureColumn('company_profiles', 'font_color', "TEXT DEFAULT '#FFFFFF'");
  migrateJsonOnce();
  ensureDepartmentsFromEmployees();
  removeDefaultCompanyName();
  ensureCompanyProfiles();
  ensureDefaultAdmin();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(col => col.name);
  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function ensureDepartmentsFromEmployees() {
  const departments = db.prepare("SELECT DISTINCT TRIM(department) AS name FROM employees WHERE TRIM(COALESCE(department, '')) <> ''").all();
  const insert = db.prepare(`
      INSERT OR IGNORE INTO departments (id, name, short_name, display_order, active, created_at, updated_at)
      VALUES (?, ?, '', ?, 1, ?, ?)
  `);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM departments').get().maxOrder || 0;
  departments.forEach((department, index) => {
    const stamp = nowIso();
    insert.run(crypto.randomUUID(), department.name, maxOrder + index + 1, stamp, stamp);
  });
}

function migrateJsonOnce() {
  const migrated = db.prepare("SELECT value FROM settings WHERE key = 'json_migrated_at'").get();
  if (migrated) return;

  const tx = db.transaction(() => {
    const employees = readJsonFile('employees.json', []);
    const displays = readJsonFile('displays.json', []);
    const settings = readJsonFile('settings.json', defaults.settings);
    const users = readJsonFile('users.json', []);

    const insertEmployee = db.prepare(`
      INSERT OR IGNORE INTO employees
      (id, employee_number, name, department, designation, phone, email, company_email_local_part, manager_id, is_department_manager, org_chart_order, short_description, extension, room_number, display_group, photo, qr_enabled, status, availability_status, created_at, updated_at)
      VALUES (@id, @employeeNumber, @name, @department, @designation, @phone, @email, @companyEmailLocalPart, @managerId, @isDepartmentManager, @orgChartOrder, @shortDescription, @extension, @roomNumber, @displayGroup, @photo, @qrEnabled, @status, @availabilityStatus, @createdAt, @updatedAt)
    `);
    employees.forEach(e => insertEmployee.run({
      id: e.id,
      employeeNumber: e.employeeNumber || '',
      name: e.name || 'Unnamed Employee',
      department: e.department || '',
      designation: e.designation || '',
      phone: e.phone || '',
      email: e.email || '',
      companyEmailLocalPart: e.companyEmailLocalPart || '',
      managerId: e.managerId || e.reportsToEmployeeId || '',
      isDepartmentManager: e.isDepartmentManager ? 1 : 0,
      orgChartOrder: Number(e.orgChartOrder || 0) || 0,
      shortDescription: e.shortDescription || '',
      extension: e.extension || e.telephoneExtension || '',
      roomNumber: e.roomNumber || e.room || '',
      displayGroup: e.displayGroup || '',
      photo: e.photo || '',
      qrEnabled: e.qrEnabled ? 1 : 0,
      status: e.status || 'Active',
      availabilityStatus: e.availabilityStatus || e.displayStatus || 'Not Available',
      createdAt: e.createdAt || nowIso(),
      updatedAt: e.updatedAt || nowIso()
    }));

    const insertDisplay = db.prepare(`
      INSERT OR IGNORE INTO displays
      (id, name, employee_id, display_mode, display_group, room_number, show_room_number, show_phone_number, cubicle_number, show_cubicle_number, rotate_company_profiles, rotation_interval_seconds, rotation_company_profile_ids, overview_show_company_name, overview_department_order, overview_department_layout, overview_employee_order, overview_employee_order_by_department, org_chart_root_mode, org_chart_show_photos, org_chart_animation_enabled, org_chart_auto_reset_seconds, org_chart_manager_focus_seconds, org_chart_selected_employee_ids, org_chart_included_department_ids, status, last_seen, ip_address, resolution, created_at, updated_at)
      VALUES (@id, @name, @employeeId, @displayMode, @displayGroup, @roomNumber, @showRoomNumber, @showPhoneNumber, @cubicleNumber, @showCubicleNumber, @rotateCompanyProfiles, @rotationIntervalSeconds, @rotationCompanyProfileIds, @overviewShowCompanyName, @overviewDepartmentOrder, @overviewDepartmentLayout, @overviewEmployeeOrder, @overviewEmployeeOrderByDepartment, @orgChartRootMode, @orgChartShowPhotos, @orgChartAnimationEnabled, @orgChartAutoResetSeconds, @orgChartManagerFocusSeconds, @orgChartSelectedEmployeeIds, @orgChartIncludedDepartmentIds, @status, @lastSeen, @ipAddress, @resolution, @createdAt, @updatedAt)
    `);
    displays.forEach(d => insertDisplay.run({
      id: d.id,
      name: d.name || d.id,
      employeeId: d.employeeId || null,
      displayMode: d.displayMode || 'single',
      displayGroup: d.displayGroup || '',
      roomNumber: d.roomNumber || '',
      showRoomNumber: d.showRoomNumber ? 1 : 0,
      showPhoneNumber: d.showPhoneNumber ? 1 : 0,
      cubicleNumber: d.cubicleNumber || '',
      showCubicleNumber: d.showCubicleNumber ? 1 : 0,
      rotateCompanyProfiles: d.rotateCompanyProfiles ? 1 : 0,
      rotationIntervalSeconds: Number(d.rotationIntervalSeconds || 30),
      rotationCompanyProfileIds: JSON.stringify(Array.isArray(d.rotationCompanyProfileIds) ? d.rotationCompanyProfileIds : []),
      overviewShowCompanyName: d.overviewShowCompanyName === false ? 0 : 1,
      overviewDepartmentOrder: JSON.stringify(Array.isArray(d.overviewDepartmentOrder) ? d.overviewDepartmentOrder : []),
      overviewDepartmentLayout: JSON.stringify(Array.isArray(d.overviewDepartmentLayout) ? d.overviewDepartmentLayout : []),
      overviewEmployeeOrder: JSON.stringify(Array.isArray(d.overviewEmployeeOrder) ? d.overviewEmployeeOrder : []),
      overviewEmployeeOrderByDepartment: JSON.stringify(d.overviewEmployeeOrderByDepartment && typeof d.overviewEmployeeOrderByDepartment === 'object' ? d.overviewEmployeeOrderByDepartment : {}),
      orgChartRootMode: d.orgChartRootMode || 'department_managers',
      orgChartShowPhotos: d.orgChartShowPhotos === false ? 0 : 1,
      orgChartAnimationEnabled: d.orgChartAnimationEnabled === false ? 0 : 1,
      orgChartAutoResetSeconds: Number(d.orgChartAutoResetSeconds || 60) || 60,
      orgChartManagerFocusSeconds: Number(d.orgChartManagerFocusSeconds || 10) || 10,
      orgChartSelectedEmployeeIds: JSON.stringify(Array.isArray(d.orgChartSelectedEmployeeIds) ? d.orgChartSelectedEmployeeIds : []),
      orgChartIncludedDepartmentIds: JSON.stringify(Array.isArray(d.orgChartIncludedDepartmentIds) ? d.orgChartIncludedDepartmentIds : []),
      status: d.status || 'Offline',
      lastSeen: d.lastSeen || null,
      ipAddress: d.ipAddress || '',
      resolution: d.resolution || '',
      createdAt: d.createdAt || nowIso(),
      updatedAt: d.updatedAt || nowIso()
    }));

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users
      (id, username, password_hash, role, active, must_change_password, created_at, updated_at)
      VALUES (@id, @username, @passwordHash, @role, @active, @mustChangePassword, @createdAt, @updatedAt)
    `);
    users.forEach(u => {
      const passwordHash = u.passwordHash || bcrypt.hashSync(u.password || 'admin123', 10);
      insertUser.run({
        id: u.id,
        username: u.username,
        passwordHash,
        role: u.role || 'Administrator',
        active: u.active === false ? 0 : 1,
        mustChangePassword: u.mustChangePassword ? 1 : 0,
        createdAt: u.createdAt || nowIso(),
        updatedAt: u.updatedAt || nowIso()
      });
    });

    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('app', json(settings), nowIso());
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('json_migrated_at', json({ at: nowIso() }), nowIso());
  });

  tx();
}

function ensureDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count) return;
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, active, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
  `).run('user001', 'admin', bcrypt.hashSync('admin123', 10), 'Administrator', nowIso(), nowIso());
}

function removeDefaultCompanyName() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get();
  const settings = parseJson(row?.value, null);
  if (settings?.company?.name === 'Digital Office') {
    settings.company.name = '';
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('app', json(settings), nowIso());
  }
}

function getRawSettings(fallback = defaults.settings) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get();
  return parseJson(row?.value, fallback);
}

function saveRawSettings(settings) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('app', json(settings || defaults.settings), nowIso());
  return settings;
}

function slugify(value, fallback = 'company-profile') {
  const base = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || fallback;
  let slug = base;
  let index = 2;
  while (db.prepare('SELECT id FROM company_profiles WHERE slug = ?').get(slug)) {
    slug = `${base}-${index++}`;
  }
  return slug;
}

function profileFromSettings(settings, overrides = {}) {
  const company = settings?.company || {};
  const weather = settings?.weather || {};
  const stamp = nowIso();
  return {
    id: overrides.id || crypto.randomUUID(),
    name: overrides.name ?? company.name ?? '',
    slug: overrides.slug || slugify(company.name || 'company-profile'),
    logo: company.logo || '',
    primaryColor: company.primaryColor || '#132644',
    secondaryColor: company.secondaryColor || '#8b8792',
    accentColor: company.accentColor || company.secondaryColor || company.primaryColor || '#8b8792',
    fontColor: company.fontColor || '#FFFFFF',
    backgroundStyle: company.backgroundStyle || 'default',
    displayFont: company.displayFont || company.defaultFont || 'Inter, Arial, sans-serif',
    clockFormat: company.clockFormat || '24',
    language: company.language || 'English',
    companyPhone: company.companyPhone || company.phone || '',
    companyEmail: company.companyEmail || company.email || '',
    companyWebsite: company.companyWebsite || company.website || '',
    companyAddress: company.companyAddress || company.address || '',
    companyNotice: '',
    weatherCity: '',
    openWeatherApiKey: '',
    weatherLang: '',
    weatherUnits: '',
    emailDomain: company.emailDomain || '',
    weatherData: null,
    weatherLastFetched: '',
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt || stamp,
    updatedAt: overrides.updatedAt || stamp
  };
}

function mapCompanyProfile(row, includeSecret = true) {
  return row && {
    id: row.id,
    name: row.name || '',
    slug: row.slug || '',
    logo: row.logo || '',
    primaryColor: row.primary_color || '#132644',
    secondaryColor: row.secondary_color || '#8b8792',
    accentColor: row.accent_color || row.secondary_color || row.primary_color || '#8b8792',
    backgroundStyle: row.background_style || 'default',
    displayFont: row.display_font || 'Inter, Arial, sans-serif',
    defaultFont: row.display_font || 'Inter, Arial, sans-serif',
    clockFormat: row.clock_format || '24',
    language: row.language || 'English',
    companyPhone: row.company_phone || '',
    companyEmail: row.company_email || '',
    companyWebsite: row.company_website || '',
    companyAddress: row.company_address || '',
    phone: row.company_phone || '',
    email: row.company_email || '',
    website: row.company_website || '',
    address: row.company_address || '',
    emailDomain: String(row.email_domain || '').trim().replace(/^@+/, '').toLowerCase(),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const insertCompanyProfileStmt = () => db.prepare(`
  INSERT INTO company_profiles
  (id, name, slug, logo, primary_color, secondary_color, accent_color, font_color, background_style, display_font, clock_format, language,
   company_phone, company_email, company_website, company_address, company_notice, weather_city, open_weather_api_key,
   weather_lang, weather_units, email_domain, weather_data, weather_last_fetched, is_active, created_at, updated_at)
  VALUES
  (@id, @name, @slug, @logo, @primaryColor, @secondaryColor, @accentColor, @fontColor, @backgroundStyle, @displayFont, @clockFormat, @language,
   @companyPhone, @companyEmail, @companyWebsite, @companyAddress, @companyNotice, @weatherCity, @openWeatherApiKey,
   @weatherLang, @weatherUnits, @emailDomain, @weatherDataJson, @weatherLastFetched, @isActiveInt, @createdAt, @updatedAt)
`);

function profileDbParams(profile) {
  return {
    ...profile,
    fontColor: profile.fontColor || '#FFFFFF',
    companyNotice: profile.companyNotice || '',
    weatherCity: '',
    openWeatherApiKey: '',
    weatherLang: '',
    weatherUnits: '',
    weatherDataJson: json(profile.weatherData || null),
    weatherLastFetched: '',
    isActiveInt: profile.isActive ? 1 : 0
  };
}

function ensureCompanyProfiles() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM company_profiles').get().count;
  const settings = getRawSettings(defaults.settings);
  if (!count) {
    const profile = profileFromSettings(settings, { isActive: true });
    insertCompanyProfileStmt().run(profileDbParams(profile));
    settings.activeCompanyProfileId = profile.id;
    saveRawSettings(settings);
    return;
  }
  const active = db.prepare('SELECT * FROM company_profiles WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').get();
  if (!active) {
    const first = db.prepare('SELECT * FROM company_profiles ORDER BY created_at ASC LIMIT 1').get();
    if (first) db.prepare('UPDATE company_profiles SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?').run(first.id, nowIso());
  }
  const activeProfile = getActiveCompanyProfile(true);
  if (activeProfile && settings.activeCompanyProfileId !== activeProfile.id) {
    settings.activeCompanyProfileId = activeProfile.id;
    saveRawSettings(settings);
  }
  migrateProfileWeatherToGlobal(settings);
}

function migrateProfileWeatherToGlobal(settings) {
  settings.weather = settings.weather || {};
  if (settings.weather.apiKey && settings.weather.city) return;
  const row = db.prepare(`
    SELECT open_weather_api_key, weather_city, weather_lang, weather_units, weather_data, weather_last_fetched
    FROM company_profiles
    WHERE COALESCE(open_weather_api_key, '') <> '' OR COALESCE(weather_city, '') <> ''
    ORDER BY is_active DESC, updated_at DESC
    LIMIT 1
  `).get();
  if (!row) return;
  let changed = false;
  if (!settings.weather.apiKey && row.open_weather_api_key) {
    settings.weather.apiKey = row.open_weather_api_key;
    changed = true;
  }
  if (!settings.weather.city && row.weather_city) {
    settings.weather.city = row.weather_city;
    changed = true;
  }
  if (!settings.weather.lang && row.weather_lang) {
    settings.weather.lang = row.weather_lang;
    changed = true;
  }
  if (!settings.weather.units && row.weather_units) {
    settings.weather.units = row.weather_units;
    changed = true;
  }
  if (!settings.weather.data && row.weather_data) {
    settings.weather.data = parseJson(row.weather_data, null);
    settings.weather.lastFetched = row.weather_last_fetched || settings.weather.lastFetched || null;
    changed = true;
  }
  if (changed) saveRawSettings(settings);
}

function companyProfileToSettings(profile, settings = getRawSettings(defaults.settings)) {
  const next = JSON.parse(JSON.stringify(settings || defaults.settings));
  next.company = {
    ...(next.company || {}),
    name: profile.name || '',
    logo: profile.logo || '',
    primaryColor: profile.primaryColor || '#132644',
    secondaryColor: profile.secondaryColor || '#8b8792',
    accentColor: profile.accentColor || profile.secondaryColor || profile.primaryColor || '#8b8792',
    backgroundStyle: profile.backgroundStyle || 'default',
    displayFont: profile.displayFont || 'Inter, Arial, sans-serif',
    defaultFont: profile.displayFont || 'Inter, Arial, sans-serif',
    clockFormat: profile.clockFormat || '24',
    language: profile.language || 'English',
    phone: profile.companyPhone || '',
    email: profile.companyEmail || '',
    website: profile.companyWebsite || '',
    address: profile.companyAddress || '',
    notice: '',
    emailDomain: profile.emailDomain || ''
  };
  next.weather = next.weather || defaults.settings.weather;
  next.activeCompanyProfileId = profile.id;
  return next;
}

function updateActiveProfileFromSettings(settings) {
  const active = getActiveCompanyProfile(true);
  if (!active) return;
  const next = profileFromSettings(settings, {
    id: active.id,
    slug: active.slug,
    name: settings?.company?.name ?? active.name,
    isActive: true,
    createdAt: active.createdAt
  });
  next.updatedAt = nowIso();
  db.prepare(`
    UPDATE company_profiles SET
      name=@name, logo=@logo, primary_color=@primaryColor, secondary_color=@secondaryColor, accent_color=@accentColor, font_color=@fontColor,
      background_style=@backgroundStyle, display_font=@displayFont, clock_format=@clockFormat, language=@language,
      company_phone=@companyPhone, company_email=@companyEmail, company_website=@companyWebsite, company_address=@companyAddress,
      company_notice=@companyNotice, weather_city=@weatherCity, open_weather_api_key=@openWeatherApiKey, weather_lang=@weatherLang,
      weather_units=@weatherUnits, email_domain=@emailDomain, weather_data=@weatherDataJson, weather_last_fetched=@weatherLastFetched,
      updated_at=@updatedAt
    WHERE id=@id
  `).run(profileDbParams(next));
}

function listCompanyProfiles(includeSecret = true) {
  ensureCompanyProfiles();
  return db.prepare('SELECT * FROM company_profiles ORDER BY is_active DESC, name COLLATE NOCASE, created_at ASC').all().map(row => mapCompanyProfile(row, includeSecret));
}

function getActiveCompanyProfile(includeSecret = true) {
  const row = db.prepare('SELECT * FROM company_profiles WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').get()
    || db.prepare('SELECT * FROM company_profiles ORDER BY created_at ASC LIMIT 1').get();
  return mapCompanyProfile(row, includeSecret);
}

function createCompanyProfile(input = {}) {
  const stamp = nowIso();
  const profile = {
    ...profileFromSettings(defaults.settings, { isActive: false }),
    id: crypto.randomUUID(),
    name: input.name || '',
    slug: slugify(input.slug || input.name || 'company-profile'),
    logo: input.logo || '',
    primaryColor: input.primaryColor || '#132644',
    secondaryColor: input.secondaryColor || '#8b8792',
    accentColor: input.accentColor || input.secondaryColor || input.primaryColor || '#8b8792',
    backgroundStyle: input.backgroundStyle || 'default',
    displayFont: input.displayFont || input.defaultFont || 'Inter, Arial, sans-serif',
    clockFormat: input.clockFormat || '24',
    language: input.language || 'English',
    companyPhone: input.companyPhone || input.phone || '',
    companyEmail: input.companyEmail || input.email || '',
    companyWebsite: input.companyWebsite || input.website || '',
    companyAddress: input.companyAddress || input.address || '',
    companyNotice: '',
    weatherCity: '',
    openWeatherApiKey: '',
    weatherLang: '',
    weatherUnits: '',
    emailDomain: input.emailDomain || '',
    weatherData: null,
    weatherLastFetched: '',
    createdAt: stamp,
    updatedAt: stamp
  };
  insertCompanyProfileStmt().run(profileDbParams(profile));
  return getCompanyProfile(profile.id);
}

function getCompanyProfile(id, includeSecret = true) {
  return mapCompanyProfile(db.prepare('SELECT * FROM company_profiles WHERE id = ?').get(id), includeSecret);
}

function updateCompanyProfile(id, input = {}) {
  const current = getCompanyProfile(id);
  if (!current) return null;
  const next = {
    ...current,
    name: input.name ?? current.name,
    logo: input.logo ?? current.logo,
    primaryColor: input.primaryColor ?? current.primaryColor,
    secondaryColor: input.secondaryColor ?? current.secondaryColor,
    accentColor: input.accentColor ?? current.accentColor,
    backgroundStyle: input.backgroundStyle ?? current.backgroundStyle,
    displayFont: input.displayFont ?? input.defaultFont ?? current.displayFont,
    clockFormat: input.clockFormat ?? current.clockFormat,
    language: input.language ?? current.language,
    companyPhone: input.companyPhone ?? input.phone ?? current.companyPhone,
    companyEmail: input.companyEmail ?? input.email ?? current.companyEmail,
    companyWebsite: input.companyWebsite ?? input.website ?? current.companyWebsite,
    companyAddress: input.companyAddress ?? input.address ?? current.companyAddress,
    companyNotice: '',
    weatherCity: '',
    openWeatherApiKey: '',
    weatherLang: '',
    weatherUnits: '',
    emailDomain: input.emailDomain ?? current.emailDomain,
    updatedAt: nowIso()
  };
  db.prepare(`
    UPDATE company_profiles SET
      name=@name, logo=@logo, primary_color=@primaryColor, secondary_color=@secondaryColor, accent_color=@accentColor, font_color=@fontColor,
      background_style=@backgroundStyle, display_font=@displayFont, clock_format=@clockFormat, language=@language,
      company_phone=@companyPhone, company_email=@companyEmail, company_website=@companyWebsite, company_address=@companyAddress,
      company_notice=@companyNotice, weather_city=@weatherCity, open_weather_api_key=@openWeatherApiKey, weather_lang=@weatherLang,
      weather_units=@weatherUnits, email_domain=@emailDomain, updated_at=@updatedAt
    WHERE id=@id
  `).run(profileDbParams(next));
  if (next.isActive) saveRawSettings(companyProfileToSettings(getCompanyProfile(id), getRawSettings(defaults.settings)));
  return getCompanyProfile(id);
}

function deleteCompanyProfile(id) {
  const profile = getCompanyProfile(id);
  if (!profile || profile.isActive) return false;
  db.prepare('DELETE FROM company_profiles WHERE id = ?').run(id);
  return true;
}

function activateCompanyProfile(id) {
  const profile = getCompanyProfile(id);
  if (!profile) return null;
  const stamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare('UPDATE company_profiles SET is_active = 0, updated_at = ?').run(stamp);
    db.prepare('UPDATE company_profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(stamp, id);
    saveRawSettings(companyProfileToSettings(getCompanyProfile(id), getRawSettings(defaults.settings)));
  });
  tx();
  return getCompanyProfile(id);
}

function setCompanyProfileWeather(id, data, fetchedAt) {
  db.prepare('UPDATE company_profiles SET weather_data = ?, weather_last_fetched = ?, updated_at = ? WHERE id = ?')
    .run(json(data || null), fetchedAt || nowIso(), nowIso(), id);
  const active = getActiveCompanyProfile(true);
  if (active && active.id === id) saveRawSettings(companyProfileToSettings(active, getRawSettings(defaults.settings)));
}

function mapEmployee(row) {
  return row && {
    id: row.id,
    employeeNumber: row.employee_number || '',
    name: row.name || '',
    department: row.department || '',
    designation: row.designation || '',
    phone: row.phone || '',
    email: row.email || '',
    companyEmailLocalPart: row.company_email_local_part || '',
    managerId: row.manager_id || '',
    reportsToEmployeeId: row.manager_id || '',
    isDepartmentManager: !!row.is_department_manager,
    orgChartOrder: Number(row.org_chart_order || 0),
    shortDescription: row.short_description || '',
    extension: row.extension || '',
    roomNumber: row.room_number || '',
    displayGroup: row.display_group || '',
    photo: row.photo || '',
    qrEnabled: !!row.qr_enabled,
    status: row.status || 'Active',
    availabilityStatus: row.availability_status || 'Not Available',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDepartment(row) {
  return row && {
    id: row.id,
    name: row.name || '',
    shortName: row.short_name || '',
    managerEmployeeId: row.manager_employee_id || '',
    displayOrder: Number(row.display_order || 0),
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDisplay(row) {
  return row && {
    id: row.id,
    name: row.name || '',
    employeeId: row.employee_id || '',
    displayMode: row.display_mode || 'single',
    displayGroup: row.display_group || '',
    roomNumber: row.room_number || '',
    showRoomNumber: !!row.show_room_number,
    showPhoneNumber: !!row.show_phone_number,
    cubicleNumber: row.cubicle_number || '',
    showCubicleNumber: !!row.show_cubicle_number,
    orgChartRootMode: row.org_chart_root_mode || 'department_managers',
    orgChartShowPhotos: row.org_chart_show_photos === undefined ? true : !!row.org_chart_show_photos,
    orgChartAnimationEnabled: row.org_chart_animation_enabled === undefined ? true : !!row.org_chart_animation_enabled,
    orgChartAutoResetSeconds: Number(row.org_chart_auto_reset_seconds || 60),
    orgChartManagerFocusSeconds: Number(row.org_chart_manager_focus_seconds || 10),
    orgChartSelectedEmployeeIds: parseJson(row.org_chart_selected_employee_ids, []),
    orgChartIncludedDepartmentIds: parseJson(row.org_chart_included_department_ids, []),
    rotateCompanyProfiles: !!row.rotate_company_profiles,
    rotationIntervalSeconds: Number(row.rotation_interval_seconds || 30),
    rotationCompanyProfileIds: parseJson(row.rotation_company_profile_ids, []),
    overviewShowCompanyName: row.overview_show_company_name === undefined ? true : !!row.overview_show_company_name,
    overviewDepartmentOrder: parseJson(row.overview_department_order, []),
    overviewDepartmentLayout: simpleOverviewDepartmentLayout(row.overview_department_layout),
    overviewEmployeeOrder: parseJson(row.overview_employee_order, []),
    overviewEmployeeOrderByDepartment: parseJson(row.overview_employee_order_by_department, {}),
    status: row.status || 'Offline',
    lastSeen: row.last_seen || '',
    ipAddress: row.ip_address || '',
    resolution: row.resolution || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUser(row) {
  return row && {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    active: !!row.active,
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDevice(row) {
  return row && {
    id: row.id,
    name: row.name,
    ip: row.ip,
    port: row.port,
    enabled: !!row.enabled,
    pollingInterval: row.polling_interval,
    punchLogic: row.punch_logic,
    lastSyncAt: row.last_sync_at || '',
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function readJson(name, fallback) {
  if (name === 'employees.json') return db.prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE').all().map(mapEmployee);
  if (name === 'displays.json') return db.prepare('SELECT * FROM displays ORDER BY name COLLATE NOCASE').all().map(mapDisplay);
  if (name === 'departments.json') return db.prepare('SELECT * FROM departments ORDER BY display_order ASC, name COLLATE NOCASE').all().map(mapDepartment);
  if (name === 'users.json') return db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all().map(mapUser);
  if (name === 'settings.json') {
    ensureCompanyProfiles();
    const settings = getRawSettings(fallback || defaults.settings);
    const active = getActiveCompanyProfile(true);
    return active ? companyProfileToSettings(active, settings) : settings;
  }
  if (name === 'zkteco_devices.json') return db.prepare('SELECT * FROM zkteco_devices ORDER BY name COLLATE NOCASE').all().map(mapDevice);
  return fallback;
}

async function writeJson(name, value) {
  const stamp = nowIso();
  if (name === 'employees.json') {
    const tx = db.transaction(items => {
      const stmt = db.prepare(`
        INSERT INTO employees (id, employee_number, name, department, designation, phone, email, company_email_local_part, manager_id, is_department_manager, org_chart_order, short_description, extension, room_number, display_group, photo, qr_enabled, status, availability_status, created_at, updated_at)
        VALUES (@id, @employeeNumber, @name, @department, @designation, @phone, @email, @companyEmailLocalPart, @managerId, @isDepartmentManager, @orgChartOrder, @shortDescription, @extension, @roomNumber, @displayGroup, @photo, @qrEnabled, @status, @availabilityStatus, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          employee_number = excluded.employee_number,
          name = excluded.name,
          department = excluded.department,
          designation = excluded.designation,
          phone = excluded.phone,
          email = excluded.email,
          company_email_local_part = excluded.company_email_local_part,
          manager_id = excluded.manager_id,
          is_department_manager = excluded.is_department_manager,
          org_chart_order = excluded.org_chart_order,
          short_description = excluded.short_description,
          extension = excluded.extension,
          room_number = excluded.room_number,
          display_group = excluded.display_group,
          photo = excluded.photo,
          qr_enabled = excluded.qr_enabled,
          status = excluded.status,
          availability_status = excluded.availability_status,
          updated_at = excluded.updated_at
      `);
      items.forEach(e => stmt.run({
        id: e.id,
        employeeNumber: e.employeeNumber || '',
        name: e.name || 'Unnamed Employee',
        department: e.department || '',
        designation: e.designation || '',
        phone: e.phone || '',
        email: e.email || '',
        companyEmailLocalPart: e.companyEmailLocalPart || '',
        managerId: e.managerId || e.reportsToEmployeeId || '',
        isDepartmentManager: e.isDepartmentManager ? 1 : 0,
        orgChartOrder: Number(e.orgChartOrder || 0) || 0,
        shortDescription: e.shortDescription || '',
        extension: e.extension || '',
        roomNumber: e.roomNumber || '',
        displayGroup: e.displayGroup || '',
        photo: e.photo || '',
        qrEnabled: e.qrEnabled ? 1 : 0,
        status: e.status || 'Active',
        availabilityStatus: e.availabilityStatus || 'Not Available',
        createdAt: e.createdAt || stamp,
        updatedAt: e.updatedAt || stamp
      }));
      const ids = items.map(e => e.id).filter(Boolean);
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM employees WHERE id NOT IN (${placeholders})`).run(...ids);
      } else {
        db.prepare('DELETE FROM employees').run();
      }
    });
    tx(value || []);
    return value;
  }
  if (name === 'displays.json') {
    const tx = db.transaction(items => {
      const stmt = db.prepare(`
        INSERT INTO displays (id, name, employee_id, display_mode, display_group, room_number, show_room_number, show_phone_number, cubicle_number, show_cubicle_number, rotate_company_profiles, rotation_interval_seconds, rotation_company_profile_ids, overview_show_company_name, overview_department_order, overview_department_layout, overview_employee_order, overview_employee_order_by_department, org_chart_root_mode, org_chart_show_photos, org_chart_animation_enabled, org_chart_auto_reset_seconds, org_chart_manager_focus_seconds, org_chart_selected_employee_ids, org_chart_included_department_ids, status, last_seen, ip_address, resolution, created_at, updated_at)
        VALUES (@id, @name, @employeeId, @displayMode, @displayGroup, @roomNumber, @showRoomNumber, @showPhoneNumber, @cubicleNumber, @showCubicleNumber, @rotateCompanyProfiles, @rotationIntervalSeconds, @rotationCompanyProfileIds, @overviewShowCompanyName, @overviewDepartmentOrder, @overviewDepartmentLayout, @overviewEmployeeOrder, @overviewEmployeeOrderByDepartment, @orgChartRootMode, @orgChartShowPhotos, @orgChartAnimationEnabled, @orgChartAutoResetSeconds, @orgChartManagerFocusSeconds, @orgChartSelectedEmployeeIds, @orgChartIncludedDepartmentIds, @status, @lastSeen, @ipAddress, @resolution, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          employee_id = excluded.employee_id,
          display_mode = excluded.display_mode,
          display_group = excluded.display_group,
          room_number = excluded.room_number,
          show_room_number = excluded.show_room_number,
          show_phone_number = excluded.show_phone_number,
          cubicle_number = excluded.cubicle_number,
          show_cubicle_number = excluded.show_cubicle_number,
          rotate_company_profiles = excluded.rotate_company_profiles,
          rotation_interval_seconds = excluded.rotation_interval_seconds,
          rotation_company_profile_ids = excluded.rotation_company_profile_ids,
          overview_show_company_name = excluded.overview_show_company_name,
          overview_department_order = excluded.overview_department_order,
          overview_department_layout = excluded.overview_department_layout,
          overview_employee_order = excluded.overview_employee_order,
          overview_employee_order_by_department = excluded.overview_employee_order_by_department,
          org_chart_root_mode = excluded.org_chart_root_mode,
          org_chart_show_photos = excluded.org_chart_show_photos,
          org_chart_animation_enabled = excluded.org_chart_animation_enabled,
          org_chart_auto_reset_seconds = excluded.org_chart_auto_reset_seconds,
          org_chart_manager_focus_seconds = excluded.org_chart_manager_focus_seconds,
          org_chart_selected_employee_ids = excluded.org_chart_selected_employee_ids,
          org_chart_included_department_ids = excluded.org_chart_included_department_ids,
          status = excluded.status,
          last_seen = excluded.last_seen,
          ip_address = excluded.ip_address,
          resolution = excluded.resolution,
          updated_at = excluded.updated_at
      `);
      items.forEach(d => stmt.run({
        id: d.id,
        name: d.name || d.id,
        employeeId: d.employeeId || null,
        displayMode: d.displayMode || 'single',
        displayGroup: d.displayGroup || '',
        roomNumber: d.roomNumber || '',
        showRoomNumber: d.showRoomNumber ? 1 : 0,
        showPhoneNumber: d.showPhoneNumber ? 1 : 0,
        cubicleNumber: d.cubicleNumber || '',
        showCubicleNumber: d.showCubicleNumber ? 1 : 0,
        rotateCompanyProfiles: d.rotateCompanyProfiles ? 1 : 0,
        rotationIntervalSeconds: Number(d.rotationIntervalSeconds || 30),
        rotationCompanyProfileIds: JSON.stringify(Array.isArray(d.rotationCompanyProfileIds) ? d.rotationCompanyProfileIds : []),
        overviewShowCompanyName: d.overviewShowCompanyName === false ? 0 : 1,
        overviewDepartmentOrder: JSON.stringify(Array.isArray(d.overviewDepartmentOrder) ? d.overviewDepartmentOrder : []),
        overviewDepartmentLayout: JSON.stringify(Array.isArray(d.overviewDepartmentLayout) ? d.overviewDepartmentLayout : []),
        overviewEmployeeOrder: JSON.stringify(Array.isArray(d.overviewEmployeeOrder) ? d.overviewEmployeeOrder : []),
        overviewEmployeeOrderByDepartment: JSON.stringify(d.overviewEmployeeOrderByDepartment && typeof d.overviewEmployeeOrderByDepartment === 'object' ? d.overviewEmployeeOrderByDepartment : {}),
        orgChartRootMode: d.orgChartRootMode || 'department_managers',
        orgChartShowPhotos: d.orgChartShowPhotos === false ? 0 : 1,
        orgChartAnimationEnabled: d.orgChartAnimationEnabled === false ? 0 : 1,
        orgChartAutoResetSeconds: Number(d.orgChartAutoResetSeconds || 60) || 60,
        orgChartManagerFocusSeconds: Number(d.orgChartManagerFocusSeconds || 10) || 10,
        orgChartSelectedEmployeeIds: JSON.stringify(Array.isArray(d.orgChartSelectedEmployeeIds) ? d.orgChartSelectedEmployeeIds : []),
        orgChartIncludedDepartmentIds: JSON.stringify(Array.isArray(d.orgChartIncludedDepartmentIds) ? d.orgChartIncludedDepartmentIds : []),
        status: d.status || 'Offline',
        lastSeen: d.lastSeen || null,
        ipAddress: d.ipAddress || '',
        resolution: d.resolution || '',
        createdAt: d.createdAt || stamp,
        updatedAt: d.updatedAt || stamp
      }));
      const ids = items.map(d => d.id).filter(Boolean);
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM displays WHERE id NOT IN (${placeholders})`).run(...ids);
      } else {
        db.prepare('DELETE FROM displays').run();
      }
    });
    tx(value || []);
    return value;
  }
  if (name === 'users.json') {
    const tx = db.transaction(items => {
      db.prepare('DELETE FROM users').run();
      const stmt = db.prepare(`
        INSERT INTO users (id, username, password_hash, role, active, must_change_password, created_at, updated_at)
        VALUES (@id, @username, @passwordHash, @role, @active, @mustChangePassword, @createdAt, @updatedAt)
      `);
      items.forEach(u => stmt.run({
        id: u.id,
        username: u.username,
        passwordHash: u.passwordHash || bcrypt.hashSync(u.password || 'admin123', 10),
        role: u.role || 'Administrator',
        active: u.active === false ? 0 : 1,
        mustChangePassword: u.mustChangePassword ? 1 : 0,
        createdAt: u.createdAt || stamp,
        updatedAt: u.updatedAt || stamp
      }));
    });
    tx(value || []);
    return value;
  }
  if (name === 'settings.json') {
    saveRawSettings(value || defaults.settings);
    return value;
  }
  if (name === 'zkteco_devices.json') {
    const tx = db.transaction(items => {
      db.prepare('DELETE FROM zkteco_devices').run();
      const stmt = db.prepare(`
        INSERT INTO zkteco_devices (id, name, ip, port, enabled, polling_interval, punch_logic, last_sync_at, last_error, created_at, updated_at)
        VALUES (@id, @name, @ip, @port, @enabled, @pollingInterval, @punchLogic, @lastSyncAt, @lastError, @createdAt, @updatedAt)
      `);
      items.forEach(d => stmt.run({
        id: d.id,
        name: d.name || d.ip || 'ZKTeco Device',
        ip: d.ip || '',
        port: Number(d.port || 4370),
        enabled: d.enabled ? 1 : 0,
        pollingInterval: Number(d.pollingInterval || 300),
        punchLogic: d.punchLogic || 'odd_even',
        lastSyncAt: d.lastSyncAt || null,
        lastError: d.lastError || '',
        createdAt: d.createdAt || stamp,
        updatedAt: d.updatedAt || stamp
      }));
    });
    tx(value || []);
    return value;
  }
  return value;
}

async function updateJson(name, fallback, updater) {
  const current = await readJson(name, fallback);
  const updated = await updater(current);
  return writeJson(name, updated);
}

async function ensureFile() {
  await fsp.mkdir(dataDir, { recursive: true });
}

initDatabase();

module.exports = {
  db,
  dbPath,
  root,
  dataDir,
  defaults,
  initDatabase,
  readJson,
  writeJson,
  updateJson,
  ensureFile,
  nowIso,
  mapEmployee,
  mapDepartment,
  mapDisplay,
  mapUser,
  mapDevice,
  mapCompanyProfile,
  listCompanyProfiles,
  getCompanyProfile,
  getActiveCompanyProfile,
  createCompanyProfile,
  updateCompanyProfile,
  deleteCompanyProfile,
  activateCompanyProfile,
  setCompanyProfileWeather,
  companyProfileToSettings
};
