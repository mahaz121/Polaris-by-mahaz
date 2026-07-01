const { db, nowIso } = require('./database');

const STATUSES = [
  'Available',
  'Not Available',
  'Sick Leave',
  'Annual Vacation',
  'Business Trip',
  'Meeting',
  'Remote Work'
];

function normalizeStatus(status, fallback = 'Not Available') {
  return STATUSES.includes(status) ? status : fallback;
}

function activeOverride(employeeId, at = new Date()) {
  const iso = at.toISOString();
  return db.prepare(`
    SELECT * FROM employee_status_overrides
    WHERE employee_id = ?
      AND (start_at IS NULL OR start_at = '' OR start_at <= ?)
      AND (end_at IS NULL OR end_at = '' OR end_at >= ?)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(employeeId, iso, iso);
}

function presenceLogic() {
  const device = db.prepare('SELECT punch_logic FROM zkteco_devices WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1').get();
  return device?.punch_logic || process.env.ZKTECO_PRESENCE_LOGIC || 'latest_available';
}

function attendanceStatus(employeeNumber, at = new Date(), logic = presenceLogic()) {
  if (!employeeNumber) return 'Not Available';
  const windowHours = Number(process.env.PRESENCE_WINDOW_HOURS || 18);
  const start = new Date(at.getTime() - windowHours * 60 * 60 * 1000);
  const logs = db.prepare(`
    SELECT punch_time, punch_type FROM attendance_logs
    WHERE employee_number = ? AND punch_time >= ?
    ORDER BY punch_time ASC
  `).all(employeeNumber, start.toISOString());
  if (!logs.length) return 'Not Available';

  const explicit = logs.filter(l => l.punch_type);
  if (explicit.length) {
    const ins = explicit.filter(l => /in|checkin|check-in/i.test(l.punch_type));
    const outs = explicit.filter(l => /out|checkout|check-out/i.test(l.punch_type));
    if (!ins.length && !outs.length && logic === 'latest_available') return 'Available';
    const latestIn = ins.length ? ins[ins.length - 1] : null;
    const latestOut = outs.length ? outs[outs.length - 1] : null;
    if (!latestIn) return 'Not Available';
    if (latestOut && new Date(latestOut.punch_time) > new Date(latestIn.punch_time)) return 'Not Available';
    return 'Available';
  }

  if (logic === 'latest_available') return 'Available';
  return logs.length % 2 === 1 ? 'Available' : 'Not Available';
}

function effectiveEmployeeStatus(employee) {
  if (!employee) return { status: 'Not Available', source: 'none', note: '' };
  return {
    status: attendanceStatus(employee.employeeNumber),
    source: 'zkteco',
    note: employee.employeeNumber ? `Matched to ZKTeco User ID ${employee.employeeNumber}` : 'Missing ZKTeco User ID'
  };
}

function insertAttendanceLog({ employeeNumber, deviceId, punchTime, punchType = '', rawData = {} }) {
  db.prepare(`
    INSERT OR IGNORE INTO attendance_logs (employee_number, device_id, punch_time, punch_type, raw_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(employeeNumber, deviceId || '', punchTime, punchType || '', JSON.stringify(rawData || {}), nowIso());
}

module.exports = {
  STATUSES,
  normalizeStatus,
  activeOverride,
  attendanceStatus,
  effectiveEmployeeStatus,
  insertAttendanceLog
};
