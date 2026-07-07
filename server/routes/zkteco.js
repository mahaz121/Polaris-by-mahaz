const express = require('express');
const { randomBytes, randomUUID, timingSafeEqual } = require('crypto');
const ZKLib = require('zklib-js');
const { readJson, writeJson } = require('../utils/dataStore');
const { db, nowIso } = require('../utils/database');
const { insertAttendanceLog } = require('../utils/status');
const { dailyTimesheet, todayString } = require('../utils/timesheet');
const { emitAllDisplays, emitAdminStats } = require('../socket');

const router = express.Router();
const pushRouter = express.Router();
const pushToken = () => process.env.ZKTECO_PUSH_TOKEN || '';

function generateBridgeSecret() {
  return randomBytes(32).toString('hex');
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeDeviceEndpoint(inputHost, inputPort) {
  let host = String(inputHost || '').trim();
  let port = Number(inputPort || 4370);
  if (!host) return { host: '', port };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      const parsed = new URL(host);
      host = parsed.hostname || host;
      if (parsed.port) port = Number(parsed.port);
    } catch {}
  } else {
    const hostPort = host.match(/^\[?([^\]]+)\]?:(\d+)$/);
    if (hostPort) {
      host = hostPort[1];
      port = Number(hostPort[2]);
    }
  }

  host = host.replace(/^https?:\/\//i, '').replace(/^tcp:\/\//i, '').split('/')[0].trim();
  return { host, port: Number(port || 4370) };
}

function normalizeDevice(body, existing = {}) {
  const endpoint = normalizeDeviceEndpoint(body.ip || existing.ip || '', body.port || existing.port || 4370);
  return {
    id: existing.id || body.id || randomUUID(),
    name: body.name || existing.name || 'ZKTeco Device',
    location: body.location || existing.location || '',
    secret: body.secret || body.bridgeSecret || existing.secret || existing.bridgeSecret || generateBridgeSecret(),
    ip: endpoint.host,
    port: endpoint.port,
    enabled: body.enabled === true || body.enabled === 'true' || body.enabled === 'on',
    pollingInterval: Number(body.pollingInterval || existing.pollingInterval || 300),
    punchLogic: body.punchLogic || existing.punchLogic || 'odd_even',
    userIdMap: existing.userIdMap || {},
    lastSyncAt: existing.lastSyncAt || '',
    lastError: existing.lastError || '',
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function compactId(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function rowsFromResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.records)) return result.records;
  if (Array.isArray(result?.data?.records)) return result.data.records;
  return [];
}

function buildUserIdMap(usersResult) {
  const users = rowsFromResult(usersResult);
  const map = new Map();
  users.forEach(user => {
    const userId = compactId(user.userId || user.userid || user.userID || user.deviceUserId || user.pin);
    if (!userId) return;
    [user.uid, user.userSn, user.userSN, user.sn].forEach(key => {
      const normalized = compactId(key);
      if (normalized) map.set(normalized, userId);
    });
  });
  return map;
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()]);
}

function objectToMap(value) {
  return new Map(Object.entries(value || {}).filter(([, userId]) => userId));
}

function parsePunchTime(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizePunch(raw, userIdMap) {
  const directId = compactId(raw.deviceUserId || raw.device_user_id || raw.userId || raw.userID || raw.userid || raw.user_id || raw.pin || raw.employeeNumber);
  const internalId = compactId(raw.userSn || raw.userSN || raw.uid || raw.sn);
  const mappedId = internalId ? userIdMap.get(internalId) : '';
  const employeeNumber = directId || mappedId || internalId;
  const punchTime = raw.recordTime || raw.record_time || raw.timestamp || raw.punchTime || raw.time || raw.checkTime;
  return {
    employeeNumber: compactId(employeeNumber),
    punchTime: parsePunchTime(punchTime),
    punchType: raw.type || raw.punchType || raw.state || ''
  };
}

function importAttendanceRows(rows, device, userIdMap) {
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  const sample = [];
  let latestPunchTime = '';
  rows.forEach(raw => {
    const punch = normalizePunch(raw, userIdMap);
    if (!punch.employeeNumber || !punch.punchTime) {
      skipped += 1;
      return;
    }
    const inserted = insertAttendanceLog({
      employeeNumber: punch.employeeNumber,
      deviceId: device.id,
      punchTime: punch.punchTime,
      punchType: punch.punchType,
      rawData: raw
    });
    imported += inserted;
    if (!inserted) duplicates += 1;
    if (!latestPunchTime || new Date(punch.punchTime) > new Date(latestPunchTime)) latestPunchTime = punch.punchTime;
    if (sample.length < 5) sample.push({ employeeNumber: punch.employeeNumber, punchTime: punch.punchTime });
  });
  return { imported, duplicates, skipped, total: rows.length, latestPunchTime, sample };
}

async function pullDeviceLogs(device) {
  const connectTimeout = Number(process.env.ZKTECO_CONNECT_TIMEOUT_MS || 20000);
  const commandTimeout = Number(process.env.ZKTECO_COMMAND_TIMEOUT_MS || 10000);
  const zk = new ZKLib(device.ip, device.port, connectTimeout, commandTimeout);
  try {
    await zk.createSocket();
    let userIdMap = objectToMap(device.userIdMap);
    let userMapSource = userIdMap.size ? 'cache' : 'none';
    try {
      const freshUserIdMap = buildUserIdMap(await zk.getUsers());
      if (freshUserIdMap.size) {
        userIdMap = freshUserIdMap;
        userMapSource = 'device';
      }
    } catch {
      userMapSource = userIdMap.size ? 'cache' : 'none';
    }
    const result = await zk.getAttendances();
    const rows = rowsFromResult(result);
    const importedRows = importAttendanceRows(rows, device, userIdMap);
    return {
      ...importedRows,
      mappedUsers: userIdMap.size,
      userMapSource,
      userIdMap: mapToObject(userIdMap)
    };
  } finally {
    if (typeof zk.disconnect === 'function') {
      await zk.disconnect().catch(() => {});
    }
  }
}

router.get('/devices', async (req, res) => {
  res.json(await readJson('zkteco_devices.json', []));
});

router.post('/devices', async (req, res) => {
  const devices = await readJson('zkteco_devices.json', []);
  const device = normalizeDevice(req.body);
  if (!device.name) return res.status(400).json({ error: 'Device name is required' });
  if (devices.some(d => String(d.name).trim().toLowerCase() === String(device.name).trim().toLowerCase())) {
    return res.status(409).json({ error: 'Device name already exists' });
  }
  devices.push(device);
  await writeJson('zkteco_devices.json', devices);
  res.status(201).json(device);
});

router.put('/devices/:id', async (req, res) => {
  const devices = await readJson('zkteco_devices.json', []);
  const idx = devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Device not found' });
  devices[idx] = normalizeDevice(req.body, devices[idx]);
  if (devices.some((d, i) => i !== idx && String(d.name).trim().toLowerCase() === String(devices[idx].name).trim().toLowerCase())) {
    return res.status(409).json({ error: 'Device name already exists' });
  }
  await writeJson('zkteco_devices.json', devices);
  res.json(devices[idx]);
});

router.delete('/devices/:id', async (req, res) => {
  const devices = (await readJson('zkteco_devices.json', [])).filter(d => d.id !== req.params.id);
  await writeJson('zkteco_devices.json', devices);
  res.json({ ok: true });
});

router.get('/logs', (req, res) => {
  const rows = db.prepare(`
    SELECT employee_number AS employeeNumber, device_id AS deviceId, punch_time AS punchTime, punch_type AS punchType, created_at AS createdAt
    FROM attendance_logs
    ORDER BY punch_time DESC
    LIMIT 200
  `).all();
  res.json(rows);
});

pushRouter.post('/push', async (req, res) => {
  const configuredToken = pushToken();
  const body = req.body || {};
  const providedToken = String(req.get('x-polaris-bridge-token') || req.get('authorization') || body.secret || body.deviceSecret || '').replace(/^Bearer\s+/i, '').trim();
  const rows = rowsFromResult(body.logs || body.attendance || body.rows || []);
  const endpoint = normalizeDeviceEndpoint(body.ip || body.host || '', body.port || 4370);
  const devices = await readJson('zkteco_devices.json', []);
  let device = devices.find(item => item.id === body.deviceId)
    || devices.find(item => item.name === body.deviceName)
    || devices.find(item => item.ip === endpoint.host && Number(item.port || 4370) === Number(endpoint.port || 4370));

  if (!device) {
    return res.status(404).json({
      error: 'ZKTeco device is not registered in Polaris. Add the device manually first, then set ZKTECO_DEVICE_NAME in the bridge .env to exactly the same name.'
    });
  }

  const expectedSecret = device.secret || device.bridgeSecret || configuredToken;
  if (!expectedSecret || !secureEqual(providedToken, expectedSecret)) {
    return res.status(401).json({ error: 'Invalid ZKTeco device secret' });
  }

  const userIdMap = body.userIdMap ? objectToMap(body.userIdMap) : objectToMap(device.userIdMap);
  const syncInfo = importAttendanceRows(rows, device, userIdMap);
  if (body.userIdMap && Object.keys(body.userIdMap).length) device.userIdMap = body.userIdMap;
  device.lastSyncAt = nowIso();
  device.lastError = syncInfo.imported
    ? ''
    : `Bridge warning: ${syncInfo.total} attendance rows received, but 0 new punches imported. Latest received: ${syncInfo.latestPunchTime || 'none'}.`;
  device.updatedAt = nowIso();
  await writeJson('zkteco_devices.json', devices);
  await emitAllDisplays();
  await emitAdminStats();
  res.json({ ok: true, ...syncInfo, deviceId: device.id, deviceName: device.name });
});

router.get('/timesheet', (req, res) => {
  res.json(dailyTimesheet({
    date: req.query.date || todayString(),
    workStart: req.query.workStart || process.env.WORK_DAY_START || '08:00',
    workEnd: req.query.workEnd || process.env.WORK_DAY_END || '17:00'
  }));
});

async function syncEnabledDevices(extraLogs = [], force = false) {
  const devices = await readJson('zkteco_devices.json', []);
  const enabled = devices.filter(d => d.enabled);
  const results = [];

  for (const device of enabled) {
    if (!device.ip) {
      results.push({ deviceId: device.id, ok: true, skipped: true, reason: 'Bridge-managed device' });
      continue;
    }
    const dueAt = device.lastSyncAt ? new Date(device.lastSyncAt).getTime() + Number(device.pollingInterval || 300) * 1000 : 0;
    if (!force && dueAt && Date.now() < dueAt) continue;
    try {
      const syncInfo = await pullDeviceLogs(device);
      if (Array.isArray(extraLogs)) {
        extraLogs.forEach(log => insertAttendanceLog({
          employeeNumber: String(log.employeeNumber || ''),
          deviceId: device.id,
          punchTime: log.punchTime || nowIso(),
          punchType: log.punchType || '',
          rawData: log
        }));
      }
      device.lastSyncAt = nowIso();
      if (syncInfo.userIdMap && Object.keys(syncInfo.userIdMap).length) device.userIdMap = syncInfo.userIdMap;
      if (!syncInfo.total) {
        device.lastError = 'Warning: connected, but device returned 0 attendance rows.';
      } else if (!syncInfo.imported) {
        device.lastError = `Warning: ${syncInfo.total} attendance rows read, but 0 new punches imported. Latest returned: ${syncInfo.latestPunchTime || 'none'}.`;
      } else if (!syncInfo.mappedUsers) {
        device.lastError = 'Warning: attendance imported without ZKTeco user mapping; employee numbers may not match.';
      } else {
        device.lastError = '';
      }
      results.push({ deviceId: device.id, ok: true, ...syncInfo });
    } catch (err) {
      device.lastError = err.message;
      results.push({ deviceId: device.id, ok: false, error: err.message });
    }
    device.updatedAt = nowIso();
  }

  await writeJson('zkteco_devices.json', devices);
  await emitAllDisplays();
  await emitAdminStats();
  return results;
}

router.post('/sync', async (req, res) => {
  const results = await syncEnabledDevices(req.body?.logs || [], true);
  res.json({ ok: true, results });
});

module.exports = { router, pushRouter, syncEnabledDevices };
