const { db, getActiveCompanyProfile, getRawSettings } = require('./database');
const { effectiveEmployeeStatus } = require('./status');

const DEFAULT_WORK_START = process.env.WORK_DAY_START || '07:30';
const DEFAULT_WORK_END = process.env.WORK_DAY_END || '16:00';
const DEFAULT_LATEST_ARRIVAL = process.env.LATEST_ARRIVAL_TIME || '08:30';

function pad(value) {
  return String(value).padStart(2, '0');
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : todayString();
}

function localDateTime(date, time) {
  return new Date(`${date}T${time || '00:00'}:00`);
}

function minutesOfDay(time) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function datePlusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}

function overlaps(start, end, windowStart, windowEnd) {
  return Math.max(0, Math.min(end.getTime(), windowEnd.getTime()) - Math.max(start.getTime(), windowStart.getTime()));
}

function punchDirection(log, index) {
  const raw = String(log.punch_type || '').toLowerCase();
  if (/check.?in|\bin\b|^0$/.test(raw)) return 'in';
  if (/check.?out|\bout\b|^1$/.test(raw)) return 'out';
  return index % 2 === 0 ? 'in' : 'out';
}

function buildSegments(logs, dayEnd = new Date()) {
  const segments = [];
  let openStart = null;
  logs.forEach((log, index) => {
    const at = new Date(log.punch_time);
    if (Number.isNaN(at.getTime())) return;
    const direction = punchDirection(log, index);
    if (direction === 'in') {
      if (!openStart) openStart = at;
      return;
    }
    if (openStart && at > openStart) {
      segments.push({ start: openStart, end: at });
      openStart = null;
    }
  });
  if (openStart) segments.push({ start: openStart, end: dayEnd, open: true });
  return segments;
}

function officeTiming() {
  const settings = getRawSettings({});
  const profile = getActiveCompanyProfile(false) || {};
  return {
    workStart: profile.officeStartTime || settings.office?.startTime || DEFAULT_WORK_START,
    workEnd: profile.officeEndTime || settings.office?.endTime || DEFAULT_WORK_END,
    latestArrivalTime: profile.latestArrivalTime || settings.office?.latestArrivalTime || DEFAULT_LATEST_ARRIVAL,
    offDays: Array.isArray(profile.offDays) ? profile.offDays : (Array.isArray(settings.office?.offDays) ? settings.office.offDays : [])
  };
}

function dailyTimesheet({ date, workStart, workEnd, latestArrivalTime, offDays } = {}) {
  const timing = officeTiming();
  const day = parseDateInput(date);
  workStart = workStart || timing.workStart;
  workEnd = workEnd || timing.workEnd;
  latestArrivalTime = latestArrivalTime || timing.latestArrivalTime;
  offDays = Array.isArray(offDays) ? offDays : timing.offDays;
  const dayStart = localDateTime(day, '00:00');
  const dayEnd = localDateTime(day, '23:59');
  const workStartAt = localDateTime(day, workStart);
  const workEndAt = localDateTime(day, workEnd);
  const latestArrivalAt = localDateTime(day, latestArrivalTime);
  const baseWorkMinutes = Math.max(0, minutesOfDay(workEnd) - minutesOfDay(workStart));
  const isOffDay = offDays.includes(String(dayStart.getDay()));
  const employees = db.prepare(`
    SELECT id, employee_number, name, department, designation, status
    FROM employees
    WHERE status != 'Inactive'
    ORDER BY name COLLATE NOCASE
  `).all();
  const logs = db.prepare(`
    SELECT employee_number, device_id, punch_time, punch_type
    FROM attendance_logs
    WHERE punch_time >= ? AND punch_time <= ?
    ORDER BY employee_number COLLATE NOCASE, punch_time ASC
  `).all(dayStart.toISOString(), dayEnd.toISOString());
  const byEmployee = new Map();
  logs.forEach(log => {
    if (!byEmployee.has(log.employee_number)) byEmployee.set(log.employee_number, []);
    byEmployee.get(log.employee_number).push(log);
  });

  const openSegmentEnd = new Date(Math.min(Date.now(), dayEnd.getTime()));
  const rows = employees.map(employee => {
    const employeeLogs = byEmployee.get(employee.employee_number || '') || [];
    const segments = buildSegments(employeeLogs, openSegmentEnd);
    const insideMs = segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
    const firstIn = employeeLogs.find((log, index) => punchDirection(log, index) === 'in');
    const lastOut = [...employeeLogs].reverse().find((log, index) => {
      const originalIndex = employeeLogs.length - 1 - index;
      return punchDirection(log, originalIndex) === 'out';
    });
    const hasOpenSegment = segments.some(segment => segment.open);
    const firstInAt = firstIn ? new Date(firstIn.punch_time) : null;
    const arrivalForSchedule = firstInAt && firstInAt > workStartAt ? new Date(Math.min(firstInAt.getTime(), latestArrivalAt.getTime())) : workStartAt;
    const expectedOutAt = isOffDay ? null : datePlusMinutes(arrivalForSchedule, baseWorkMinutes);
    const scheduledEndAt = expectedOutAt && expectedOutAt > workEndAt ? expectedOutAt : workEndAt;
    const scheduledWorkMs = isOffDay ? 0 : Math.max(0, scheduledEndAt - workStartAt);
    const scheduledInsideMs = isOffDay ? 0 : segments.reduce((sum, segment) => sum + overlaps(segment.start, segment.end, workStartAt, scheduledEndAt), 0);
    const scheduledOutsideMs = Math.max(0, scheduledWorkMs - scheduledInsideMs);
    return {
      employeeId: employee.id,
      employeeNumber: employee.employee_number || '',
      name: employee.name || '',
      department: employee.department || '',
      designation: employee.designation || '',
      firstIn: firstIn?.punch_time || '',
      lastOut: lastOut?.punch_time || '',
      expectedOut: expectedOutAt ? expectedOutAt.toISOString() : '',
      punchCount: employeeLogs.length,
      insideMinutes: Math.round(insideMs / 60000),
      inside: formatDuration(insideMs),
      insideDuringWorkMinutes: Math.round(scheduledInsideMs / 60000),
      insideDuringWork: formatDuration(scheduledInsideMs),
      outsideDuringWorkMinutes: Math.round(scheduledOutsideMs / 60000),
      outsideDuringWork: formatDuration(scheduledOutsideMs),
      status: hasOpenSegment ? 'Inside now' : (employeeLogs.length ? 'Checked out' : 'No punches'),
      liveStatus: effectiveEmployeeStatus({ ...employee, employeeNumber: employee.employee_number }).status
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.insideMinutes += row.insideMinutes;
    acc.insideDuringWorkMinutes += row.insideDuringWorkMinutes;
    acc.outsideDuringWorkMinutes += row.outsideDuringWorkMinutes;
    if (row.status === 'Inside now') acc.insideNow += 1;
    if (row.punchCount) acc.withPunches += 1;
    return acc;
  }, { insideMinutes: 0, insideDuringWorkMinutes: 0, outsideDuringWorkMinutes: 0, insideNow: 0, withPunches: 0 });

  return {
    date: day,
    workStart,
    workEnd,
    latestArrivalTime,
    offDays,
    isOffDay,
    totals: {
      ...totals,
      inside: formatDuration(totals.insideMinutes * 60000),
      insideDuringWork: formatDuration(totals.insideDuringWorkMinutes * 60000),
      outsideDuringWork: formatDuration(totals.outsideDuringWorkMinutes * 60000)
    },
    rows
  };
}

module.exports = { dailyTimesheet, todayString };
