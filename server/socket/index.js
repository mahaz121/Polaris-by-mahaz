const { readJson, writeJson } = require('../utils/dataStore');
const { buildDisplayPayload } = require('../utils/publicPayload');
const { effectiveEmployeeStatus } = require('../utils/status');

const displaySockets = new Map();
let ioRef;

function isDisplayRole(user = {}) {
  return ['display', 'kiosk', 'viewer'].includes(String(user.role || '').trim().toLowerCase());
}

async function buildPayload(displayId) {
  return buildDisplayPayload(displayId);
}

async function markDisplay(displayId, socket, status) {
  const displays = await readJson('displays.json', []);
  const idx = displays.findIndex(d => d.id === displayId);
  if (idx !== -1) {
    displays[idx] = {
      ...displays[idx],
      status,
      lastSeen: new Date().toISOString(),
      ipAddress: socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '',
      resolution: socket.handshake.query.resolution || displays[idx].resolution || '',
      updatedAt: new Date().toISOString()
    };
    await writeJson('displays.json', displays);
    emitAdminStats();
  }
}

function initSocket(io, sessionMiddleware) {
  ioRef = io;
  if (sessionMiddleware) {
    io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
  }
  io.on('connection', socket => {
    socket.on('register-display', async ({ displayId, resolution }) => {
      if (!socket.request.session || !socket.request.session.user) {
        socket.emit('auth-required');
        return;
      }
      if (!displayId) return;
      socket.displayId = displayId;
      socket.join(`display:${displayId}`);
      socket.handshake.query.resolution = resolution || '';
      displaySockets.set(socket.id, displayId);
      await markDisplay(displayId, socket, 'Online');
      socket.emit('display-data', await buildPayload(displayId));
    });

    socket.on('admin-watch', () => {
      const user = socket.request.session && socket.request.session.user;
      if (user && !isDisplayRole(user)) socket.join('admins');
    });

    socket.on('disconnect', async () => {
      const displayId = displaySockets.get(socket.id);
      displaySockets.delete(socket.id);
      if (!displayId) return;
      const stillOnline = [...displaySockets.values()].includes(displayId);
      if (!stillOnline) await markDisplay(displayId, socket, 'Offline');
    });
  });
}

async function emitDisplayUpdate(displayId) {
  if (!ioRef) return;
  ioRef.to(`display:${displayId}`).emit('display-data', await buildPayload(displayId));
}

async function emitAllDisplays() {
  if (!ioRef) return;
  const displays = await readJson('displays.json', []);
  await Promise.all(displays.map(d => emitDisplayUpdate(d.id)));
}

async function emitWeather(weather) {
  if (ioRef) ioRef.emit('weather-update', weather);
}

async function emitCompanyProfileChanged(profile) {
  if (!ioRef) return;
  ioRef.emit('company-profile-changed', profile || {});
  ioRef.to('admins').emit('data-updated');
  await emitAllDisplays();
}

async function emitAdminStats() {
  if (!ioRef) return;
  const [employees, displays] = await Promise.all([readJson('employees.json', []), readJson('displays.json', [])]);
  const activeEmployees = employees.filter(e => e.status === 'Active');
  const statuses = activeEmployees.map(e => effectiveEmployeeStatus(e).status);
  ioRef.to('admins').emit('admin-stats', {
    employees: employees.length,
    displays: displays.length,
    online: displays.filter(d => d.status === 'Online').length,
    offline: displays.filter(d => d.status !== 'Online').length,
    availableEmployees: statuses.filter(s => s === 'Available').length,
    notAvailableEmployees: statuses.filter(s => s !== 'Available').length
  });
}

module.exports = { initSocket, emitDisplayUpdate, emitAllDisplays, emitWeather, emitCompanyProfileChanged, emitAdminStats };
