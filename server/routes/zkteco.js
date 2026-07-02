const express = require('express');
const { randomUUID } = require('crypto');
const ZKLib = require('zklib-js');
const { readJson, writeJson } = require('../utils/dataStore');
const { db, nowIso } = require('../utils/database');
const { insertAttendanceLog } = require('../utils/status');
const { emitAllDisplays, emitAdminStats } = require('../socket');

const router = express.Router();

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
    ip: endpoint.host,
    port: endpoint.port,
    enabled: body.enabled === true || body.enabled === 'true' || body.enabled === 'on',
    pollingInterval: Number(body.pollingInterval || existing.pollingInterval || 300),
    punchLogic: body.punchLogic || existing.punchLogic || 'latest_available',
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

async function pullDeviceLogs(device) {
  const zk = new ZKLib(device.ip, device.port, 8000, 5000);
  try {
    await zk.createSocket();
    let userIdMap = new Map();
    try {
      userIdMap = buildUserIdMap(await zk.getUsers());
    } catch {
      userIdMap = new Map();
    }
    const result = await zk.getAttendances();
    const rows = rowsFromResult(result);
    let imported = 0;
    const sample = [];
    rows.forEach(raw => {
      const punch = normalizePunch(raw, userIdMap);
      if (!punch.employeeNumber || !punch.punchTime) return;
      insertAttendanceLog({
        employeeNumber: punch.employeeNumber,
        deviceId: device.id,
        punchTime: punch.punchTime,
        punchType: punch.punchType,
        rawData: raw
      });
      imported += 1;
      if (sample.length < 5) sample.push({ employeeNumber: punch.employeeNumber, punchTime: punch.punchTime });
    });
    return { imported, total: rows.length, mappedUsers: userIdMap.size, sample };
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
  if (!device.ip) return res.status(400).json({ error: 'Device IP is required' });
  devices.push(device);
  await writeJson('zkteco_devices.json', devices);
  res.status(201).json(device);
});

router.put('/devices/:id', async (req, res) => {
  const devices = await readJson('zkteco_devices.json', []);
  const idx = devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Device not found' });
  devices[idx] = normalizeDevice(req.body, devices[idx]);
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

async function syncEnabledDevices(extraLogs = [], force = false) {
  const devices = await readJson('zkteco_devices.json', []);
  const enabled = devices.filter(d => d.enabled);
  const results = [];

  for (const device of enabled) {
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
      device.lastError = '';
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

module.exports = { router, syncEnabledDevices };
