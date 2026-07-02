# Polaris-by-mahaz

Author: Riaz Rahman  
GitHub: https://github.com/mahaz121/

Polaris-by-mahaz is a centralized digital office system for browser and Raspberry Pi kiosk displays. It uses Node.js, Express, Socket.IO, static HTML/CSS/JavaScript, and SQLite.

## Features

- Admin dashboard for employees, departments, displays, company profiles, settings, weather, users, and ZKTeco devices.
- Public setup page for assigning a browser display.
- Public display pages with live Socket.IO updates.
- SQLite storage for production data.
- QR vCard generation when enabled for an employee.
- OpenWeather integration through server-side configuration.
- Session-based admin authentication with bcrypt password hashes.

## Requirements

- Node.js 18 or newer
- npm
- SQLite support through `better-sqlite3`
- PM2 for the included production management scripts

## Project Structure

```text
Polaris-by-mahaz/
  data/
    backups/
    sessions/
    displays.json
    employees.json
    settings.json
    users.json
  deploy/
    polaris.service
  public/
    admin/
    css/
    display/
    js/
    Logo/
    setup/
    uploads/
  scripts/
    install-linux.sh
    install-windows.ps1
    start.sh
    restart.sh
    stop.sh
    status.sh
    logs.sh
    update.sh
    backup-db.sh
    restore-db.sh
  server/
  .env.example
  ecosystem.config.cjs
  package.json
  server.js
```

## Environment

Copy `.env.example` to `.env` and update values before production use.

```env
PORT=3004
SESSION_SECRET=replace-with-a-generated-strong-secret
SQLITE_PATH=./data/polaris.sqlite
SERVER_PUBLIC_URL=http://your-server-ip:3004
OPENWEATHER_API_KEY=
OPENWEATHER_CITY=YourCity
OPENWEATHER_UNITS=metric
OPENWEATHER_LANG=en
```

The install scripts create `.env` when it is missing, force `PORT=3004`, and generate a strong `SESSION_SECRET` when the placeholder is still present.

## Fresh Installation

Ubuntu/Linux:

```bash
chmod +x scripts/*.sh
./scripts/install-linux.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1
```

Open:

```text
http://SERVER-IP:3004/admin/
```

Default first login:

```text
Username: admin
Password: admin123
```

The default admin is created only when the users table is empty and is marked for password change. Change the password immediately after first login.

## Manual Commands

Install dependencies:

```bash
npm ci --omit=dev
```

Initialize or migrate SQLite:

```bash
npm run migrate
```

Run directly:

```bash
npm start
```

Development mode:

```bash
npm install
npm run dev
```

## Production Management

Start:

```bash
npm run pm2:start
```

Restart:

```bash
npm run pm2:restart
```

Stop:

```bash
npm run pm2:stop
```

Status:

```bash
npm run pm2:status
```

Logs:

```bash
npm run pm2:logs
```

Update from GitHub:

```bash
npm run update
```

The update script runs `git pull --ff-only` when the project is a Git repository, installs locked production dependencies, runs migrations, and reloads PM2.

## systemd

Copy the included service file and adjust paths if needed:

```bash
sudo cp deploy/polaris.service /etc/systemd/system/polaris.service
sudo systemctl daemon-reload
sudo systemctl enable polaris
sudo systemctl start polaris
sudo systemctl status polaris
```

The service uses port `3004` and reads `/opt/Polaris-by-mahaz/.env` when present.

## Nginx Example

```nginx
server {
  listen 80;
  server_name polaris.example.com;

  location / {
    proxy_pass http://127.0.0.1:3004;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Backup And Restore

Create a backup:

```bash
./scripts/backup-db.sh
```

Restore a backup:

```bash
./scripts/restore-db.sh data/backups/polaris-by-mahaz-backup-YYYY-MM-DD-HH-mm.tar.gz
npm run pm2:restart
```

Restore a raw SQLite database copied from another server:

```bash
./scripts/restore-db.sh /path/to/polaris.sqlite
npm run pm2:restart
```

On Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore-db.ps1 C:\path\to\polaris.sqlite
```

Backups include `data/polaris.sqlite`, `public/uploads`, and `.env` when available. The restore scripts do not restore `.env` by default because server-specific paths and secrets are usually different. Backup archives are ignored by Git.

## Display Setup

First boot URL:

```text
http://SERVER-IP:3004/setup
```

Display URL:

```text
http://SERVER-IP:3004/display/display-id
```

The browser stores only `display_id` in localStorage.

Display and setup URLs require login. For Android FreeKiosk devices, create a normal active user with role `Display` or `Kiosk`, open the display URL once, sign in, and let the kiosk browser keep the session cookie. A display/kiosk user can open setup and display pages, but cannot open the admin dashboard or admin APIs.

## User Access Rights

Users can be assigned a role preset or one or more access rights:

- `Super Admin`: all access.
- `Employee Viewer`: can open the Employees page and read employee names/basic details.
- `Availability Viewer`: can read employee names/basic details and see who is available or not available.
- `Employee Editor`: can add, edit, and delete employees and departments.
- `Display` / `Kiosk`: open display and setup pages only.
- `Custom`: assign one or several rights manually.

Available rights:

- Dashboard
- View Employee Names
- View Availability Status
- Edit Employees
- Add/Edit Displays
- Edit Company Profiles
- Edit Weather
- Manage Fingerprint Devices
- Create Users & Access Rights
- Open Displays / Setup

## ZKTeco Sync

Enabled ZKTeco devices are synced automatically every `ZKTECO_SYNC_INTERVAL_SECONDS` seconds. The default is `60`.

```env
ZKTECO_SYNC_INTERVAL_SECONDS=60
PRESENCE_WINDOW_HOURS=18
```

Device host values may be entered as an IP address, hostname, `host:port`, or TCP-style endpoint. ZKTeco uses a raw TCP connection, so HTTP/HTTPS ngrok URLs do not work. For ngrok, use a TCP tunnel host and port, for example `0.tcp.ngrok.io` with the assigned TCP port.

Employee availability depends on attendance punch logs inside the presence window. Fingerprint enrollment alone does not mark an employee as `Available`; the employee number in Polaris must match the ZKTeco user ID/PIN that appears in attendance logs.

## GitHub Readiness

Do not commit:

- `.env`
- SQLite files under `data/*.sqlite`, `data/*.sqlite-wal`, or `data/*.sqlite-shm`
- session files under `data/sessions`
- backup archives under `data/backups`
- uploaded production files under `public/uploads`
- logs, cache files, dependency folders, or build output

The included `.gitignore` already excludes these runtime files.

## Security Checklist

- Replace or generate a strong `SESSION_SECRET`.
- Change the default admin password immediately after first login.
- Keep `.env` off GitHub.
- Restrict `/admin` access to trusted networks or VPN when possible.
- Put the app behind Nginx for public deployments.
- Back up `data/polaris.sqlite` and `public/uploads` before updates.
- Keep Node.js and npm dependencies patched.
- Add an OpenWeather API key only in `.env` or the admin settings screen.

## Troubleshooting

- If port `3004` is busy, stop the conflicting process or update all deployment config consistently.
- If login fails on a fresh install, remove `data/polaris.sqlite`, rerun `npm run migrate`, and use the default first-login credentials.
- If uploads fail, verify `public/uploads` exists and is writable.
- If PM2 does not start, run `pm2 logs polaris`.
- If Socket.IO does not connect behind Nginx, verify the `Upgrade` and `Connection` proxy headers.
