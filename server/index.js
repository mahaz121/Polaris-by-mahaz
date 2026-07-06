require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');
const { root } = require('./utils/dataStore');
const { refreshUserSession, requireAuth, requireAdmin, requirePermission, requireAnyPermission } = require('./middleware/auth');
const { initSocket } = require('./socket');
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const departmentRoutes = require('./routes/departments');
const displayRoutes = require('./routes/displays');
const settingsRoutes = require('./routes/settings');
const companyProfileRoutes = require('./routes/companyProfiles');
const { router: weatherRoutes, fetchWeather } = require('./routes/weather');
const userRoutes = require('./routes/users');
const displayPublicRoutes = require('./routes/displayPublic');
const { router: zktecoRoutes, pushRouter: zktecoPushRoutes, syncEnabledDevices } = require('./routes/zkteco');
const { effectiveEmployeeStatus } = require('./utils/status');
const { dailyTimesheet, todayString } = require('./utils/timesheet');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
const sessionMiddleware = session({
  store: new FileStore({ path: path.join(root, 'data', 'sessions') }),
  secret: process.env.SESSION_SECRET || 'replace-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(refreshUserSession);

app.use('/css', express.static(path.join(root, 'public', 'css')));
app.use('/js', express.static(path.join(root, 'public', 'js')));
app.use('/images', express.static(path.join(root, 'public', 'images')));
app.use('/Logo', express.static(path.join(root, 'public', 'Logo')));
app.use('/uploads', express.static(path.join(root, 'public', 'uploads')));
app.get('/', requireAdmin, (req, res) => res.redirect('/admin/'));
function sendAdminIndex(req, res) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'public', 'admin', 'index.html'));
}

app.get('/admin/', requireAdmin, sendAdminIndex);
app.get('/admin', requireAdmin, (req, res) => res.redirect('/admin/'));
app.get('/admin/index.html', requireAdmin, sendAdminIndex);
app.get('/admin/login.html', (req, res) => res.sendFile(path.join(root, 'public', 'admin', 'login.html')));
app.get('/display/:id', requirePermission('display.access'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'public', 'display', 'index.html'));
});
app.get('/setup', requirePermission('display.access'), (req, res) => res.sendFile(path.join(root, 'public', 'setup', 'index.html')));

app.use('/api/auth', authRoutes);
app.use('/api/zkteco', zktecoPushRoutes);
app.get('/api/dashboard', requirePermission('dashboard.view'), async (req, res) => {
  const { readJson } = require('./utils/dataStore');
  const employees = await readJson('employees.json', []);
  const displays = await readJson('displays.json', []);
  const settings = await readJson('settings.json', {});
  const available = employees.filter(employee => effectiveEmployeeStatus(employee).status === 'Available').length;
  const online = displays.filter(display => display.status === 'Online').length;
  res.json({
    employees: {
      total: employees.length,
      inactive: employees.filter(employee => employee.status !== 'Active').length,
      available,
      unavailable: Math.max(0, employees.length - available)
    },
    displays: {
      total: displays.length,
      online,
      offline: Math.max(0, displays.length - online)
    },
    weather: {
      temperature: settings.weather?.data?.temperature ?? null,
      city: settings.weather?.data?.city || settings.weather?.city || '',
      description: settings.weather?.data?.description || '',
      fetchedAt: settings.weather?.data?.fetchedAt || settings.weather?.lastFetched || ''
    }
  });
});
app.use('/api/company-profiles', requirePermission('companyProfiles.manage'), companyProfileRoutes);
app.use('/api/display-public', requirePermission('display.access'), displayPublicRoutes);
app.use('/api/display', requirePermission('display.access'), displayPublicRoutes);
app.get('/api/timesheet', requireAnyPermission(['employees.manage', 'employeeStatus.view', 'zkteco.manage']), async (req, res) => {
  if (req.query.sync === '1') await syncEnabledDevices([], true);
  res.json(dailyTimesheet({ date: req.query.date || todayString() }));
});
app.get('/api/setup/displays', requirePermission('display.access'), async (req, res) => {
  const { readJson } = require('./utils/dataStore');
  const displays = await readJson('displays.json', []);
  res.json(displays.map(d => ({ id: d.id, name: d.name })));
});
app.use('/api/employees', requireAnyPermission(['employees.view', 'employeeStatus.view', 'employees.manage', 'displays.manage']), employeeRoutes);
app.use('/api/departments', requirePermission('employees.manage'), departmentRoutes);
app.use('/api/displays', requirePermission('displays.manage'), displayRoutes);
app.use('/api/settings', requirePermission('weather.manage'), settingsRoutes);
app.use('/api/weather', requirePermission('weather.manage'), weatherRoutes);
app.use('/api/users', requirePermission('users.manage'), userRoutes);
app.use('/api/zkteco', requirePermission('zkteco.manage'), zktecoRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

initSocket(io, sessionMiddleware);
setInterval(() => fetchWeather(false).catch(console.error), 15 * 60 * 1000);
fetchWeather(false).catch(console.error);
syncEnabledDevices([], true).catch(console.error);
setInterval(() => syncEnabledDevices([], true).catch(console.error), Number(process.env.ZKTECO_SYNC_INTERVAL_SECONDS || 60) * 1000);

const port = Number(process.env.PORT || 3004);
server.listen(port, () => console.log(`Polaris server running on port ${port}`));
