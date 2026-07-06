#!/usr/bin/env node
require('dotenv').config();
const ZKLib = require('zklib-js');

const deviceHost = process.env.ZKTECO_BRIDGE_DEVICE_IP || process.env.ZKTECO_DEVICE_IP || '192.168.1.201';
const devicePort = Number(process.env.ZKTECO_BRIDGE_DEVICE_PORT || process.env.ZKTECO_DEVICE_PORT || 4370);
const deviceName = process.env.ZKTECO_BRIDGE_DEVICE_NAME || 'HO';
const polarisUrl = String(process.env.POLARIS_PUSH_URL || process.env.SERVER_PUBLIC_URL || '').replace(/\/+$/, '');
const token = process.env.ZKTECO_PUSH_TOKEN || process.env.POLARIS_BRIDGE_TOKEN || '';
const intervalSeconds = Number(process.env.ZKTECO_BRIDGE_INTERVAL_SECONDS || 60);
const connectTimeout = Number(process.env.ZKTECO_CONNECT_TIMEOUT_MS || 20000);
const commandTimeout = Number(process.env.ZKTECO_COMMAND_TIMEOUT_MS || 10000);

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
  const map = {};
  users.forEach(user => {
    const userId = compactId(user.userId || user.userid || user.userID || user.deviceUserId || user.pin);
    if (!userId) return;
    [user.uid, user.userSn, user.userSN, user.sn].forEach(key => {
      const normalized = compactId(key);
      if (normalized) map[normalized] = userId;
    });
  });
  return map;
}

function assertConfig() {
  if (!polarisUrl) throw new Error('Set POLARIS_PUSH_URL or SERVER_PUBLIC_URL in .env');
  if (!token) throw new Error('Set ZKTECO_PUSH_TOKEN in both bridge and Polaris server .env');
}

async function pullLocalDevice() {
  const zk = new ZKLib(deviceHost, devicePort, connectTimeout, commandTimeout);
  try {
    await zk.createSocket();
    let userIdMap = {};
    try {
      userIdMap = buildUserIdMap(await zk.getUsers());
    } catch (err) {
      console.warn(`Unable to read users from device: ${err.message}`);
    }
    const logs = rowsFromResult(await zk.getAttendances());
    return { logs, userIdMap };
  } finally {
    if (typeof zk.disconnect === 'function') await zk.disconnect().catch(() => {});
  }
}

async function pushToPolaris(payload) {
  const response = await fetch(`${polarisUrl}/api/zkteco/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Polaris-Bridge-Token': token
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Polaris push failed: ${response.status}`);
  return body;
}

async function syncOnce() {
  assertConfig();
  const { logs, userIdMap } = await pullLocalDevice();
  const result = await pushToPolaris({
    deviceName,
    ip: deviceHost,
    port: devicePort,
    logs,
    userIdMap
  });
  console.log(new Date().toLocaleString(), `read=${logs.length}`, `imported=${result.imported}`, `duplicates=${result.duplicates}`, `latest=${result.latestPunchTime || 'none'}`);
}

async function main() {
  const once = process.argv.includes('--once');
  await syncOnce();
  if (once) return;
  setInterval(() => syncOnce().catch(err => console.error(new Date().toLocaleString(), err.message)), intervalSeconds * 1000);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
