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
const { requireAuth } = require('./middleware/auth');
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
const { router: zktecoRoutes, syncEnabledDevices } = require('./routes/zkteco');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new FileStore({ path: path.join(root, 'data', 'sessions') }),
  secret: process.env.SESSION_SECRET || 'replace-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/css', express.static(path.join(root, 'public', 'css')));
app.use('/js', express.static(path.join(root, 'public', 'js')));
app.use('/images', express.static(path.join(root, 'public', 'images')));
app.use('/Logo', express.static(path.join(root, 'public', 'Logo')));
app.use('/uploads', express.static(path.join(root, 'public', 'uploads')));
app.get('/', requireAuth, (req, res) => res.redirect('/admin/'));
function sendAdminIndex(req, res) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'public', 'admin', 'index.html'));
}

app.get('/admin/', requireAuth, sendAdminIndex);
app.get('/admin', requireAuth, (req, res) => res.redirect('/admin/'));
app.get('/admin/index.html', requireAuth, sendAdminIndex);
app.get('/admin/login.html', (req, res) => res.sendFile(path.join(root, 'public', 'admin', 'login.html')));
app.get('/display/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(root, 'public', 'display', 'index.html'));
});
app.get('/setup', (req, res) => res.sendFile(path.join(root, 'public', 'setup', 'index.html')));

app.use('/api/auth', authRoutes);
app.use('/api/company-profiles', companyProfileRoutes);
app.use('/api/display-public', displayPublicRoutes);
app.use('/api/display', displayPublicRoutes);
app.get('/api/setup/displays', async (req, res) => {
  const { readJson } = require('./utils/dataStore');
  const displays = await readJson('displays.json', []);
  res.json(displays.map(d => ({ id: d.id, name: d.name })));
});
app.use('/api/employees', requireAuth, employeeRoutes);
app.use('/api/departments', requireAuth, departmentRoutes);
app.use('/api/displays', requireAuth, displayRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/weather', requireAuth, weatherRoutes);
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/zkteco', requireAuth, zktecoRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

initSocket(io);
setInterval(() => fetchWeather(false).catch(console.error), 15 * 60 * 1000);
fetchWeather(false).catch(console.error);
syncEnabledDevices([], true).catch(console.error);
setInterval(() => syncEnabledDevices().catch(console.error), 60 * 1000);

const port = Number(process.env.PORT || 3004);
server.listen(port, () => console.log(`Polaris server running on port ${port}`));
