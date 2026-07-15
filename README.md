# Polaris-by-mahaz

Author: Riaz Rahman Bhuyan Mahaz
GitHub: https://github.com/mahaz121/

Polaris-by-mahaz is a centralized digital office system for browser and Raspberry Pi kiosk displays. It uses Node.js, Express, Socket.IO, static HTML/CSS/JavaScript, and SQLite.

## Features

- Admin dashboard for employees, departments, displays, company profiles, settings, weather, users, access rights, and ZKTeco devices.
- Role-based access control for super admins, employee viewers, availability viewers, employee editors, display/kiosk users, and custom users.
- Browser display pages for tablets, Android TV screens, Raspberry Pi displays, and normal desktop browsers.
- Setup page for assigning a display screen to a saved display profile.
- Live Socket.IO updates for display content and admin status.
- Employee availability based on ZKTeco attendance punches.
- Company profile switching for branding, logos, contact details, colors, QR behavior, and display styling.
- Display modes for single employee signs, overview boards, and organization charts.
- SQLite storage for production data.
- QR vCard generation when enabled for an employee.
- OpenWeather integration through server-side configuration.
- Session-based admin authentication with bcrypt password hashes.
- Rolling remembered sessions (365 days by default) and a kiosk-safe on-screen login keyboard.

## Who Uses Polaris

- IT administrators use the admin dashboard to configure users, displays, company profiles, weather, ZKTeco devices, backups, and updates.
- HR or reception staff can be given employee-only rights to view names, view availability, or edit employee records without receiving full system access.
- Office display operators can be given display rights only, so a tablet or TV can open a display page without exposing the admin dashboard.
- Employees and visitors only see the final display screens, such as room nameplates, availability boards, office overview screens, and organization charts.

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

Use display users for any unattended tablet, Android TV, Raspberry Pi browser, or reception screen. Do not log in as a super admin on kiosk devices.

Create the display user:

1. Sign in as a super admin.
2. Open `Users`.
3. Add a user with role `Display` or `Kiosk`, or use `Custom` with only `Open Displays / Setup`.
4. Use a strong password and keep the account active.

Create the display profile:

1. Open `Displays`.
2. Add a display and choose the display mode.
3. Use the generated display ID in the display URL.

Setup URL:

```text
http://SERVER-IP:3004/setup
```

Display URL:

```text
http://SERVER-IP:3004/display/display-id
```

The browser stores only `display_id` in localStorage.

Display and setup URLs require login. For Android FreeKiosk devices, create a normal active user with role `Display` or `Kiosk`, open the display URL once, sign in, and let the kiosk browser keep the session cookie. A display/kiosk user can open setup and display pages, but cannot open the admin dashboard or admin APIs.

### Android Tablet With FreeKiosk

Recommended for wall-mounted employee nameplates, reception tablets, meeting-room tablets, and small office display screens.

App link:

- FreeKiosk official site: https://freekiosk.app/
- FreeKiosk GitHub: https://github.com/RushB-fr/freekiosk

Basic setup:

1. Install FreeKiosk on the Android tablet.
2. Set the kiosk URL to the Polaris display URL:

   ```text
   http://SERVER-IP:3004/display/display-id
   ```

3. Open the URL once and log in using the `Display` or `Kiosk` user.
4. Allow FreeKiosk to keep the browser session/cookies.
5. Enable fullscreen/kiosk mode.
6. Keep the tablet on the same network as the Polaris server, or use a stable domain/VPN/reverse proxy.

For first assignment, you can use:

```text
http://SERVER-IP:3004/setup
```

After the display is assigned, use the direct `/display/display-id` URL for daily operation.

### Android TV With Fully Kiosk

Recommended for large office TVs, overview boards, organization charts, reception TVs, and unattended lobby screens.

App links:

- Fully Kiosk Browser on Google Play: https://play.google.com/store/apps/details?id=de.ozerov.fully
- Fully Kiosk official site: https://www.fully-kiosk.com/

Basic setup:

1. Install Fully Kiosk Browser on the Android TV or Android TV box.
2. Set the Start URL to the Polaris display URL:

   ```text
   http://SERVER-IP:3004/display/display-id
   ```

3. Open the URL once and log in using the `Display` or `Kiosk` user.
4. Enable fullscreen mode and keep-screen-on settings.
5. Enable autostart on boot if the TV should return to Polaris after power loss.
6. Set a kiosk/admin PIN so users cannot exit the display accidentally.

Android TV devices can be more restricted than normal Android tablets. If Google Play does not allow install on a TV model, use Fully Kiosk's official APK option from the Fully Kiosk website.

### Display Network Notes

- Use `http://SERVER-IP:3004` on the same LAN.
- Use a domain with Nginx/HTTPS for production or remote access.
- Use a VPN or secure tunnel when screens are outside the office network.
- Keep the server timezone correct because employee availability depends on attendance punch times.
- If the kiosk app shows the login page again, the session cookie was cleared or expired; log in again with the display/kiosk user.

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

Common examples:

- System owner: `Super Admin`.
- HR viewer: `Employee Viewer` plus `View Availability Status` if they need live presence.
- HR editor: `Employee Editor`.
- Reception display tablet: `Display` or `Kiosk`.
- TV overview board: `Display` or `Kiosk`.
- User manager: `Create Users & Access Rights`, plus any other rights they also need.

## ZKTeco Sync

Enabled ZKTeco devices are synced automatically every `ZKTECO_SYNC_INTERVAL_SECONDS` seconds. The default is `60`.

```env
ZKTECO_SYNC_INTERVAL_SECONDS=60
PRESENCE_WINDOW_HOURS=18
WORK_DAY_START=07:30
WORK_DAY_END=16:00
LATEST_ARRIVAL_TIME=08:30
```

Device host values may be entered as an IP address, hostname, `host:port`, or TCP-style endpoint. ZKTeco uses a raw TCP connection, so HTTP/HTTPS ngrok URLs do not work. For ngrok, use a TCP tunnel host and port, for example `0.tcp.ngrok.io` with the assigned TCP port.

Employee availability depends on attendance punch logs inside the presence window. Fingerprint enrollment alone does not mark an employee as `Available`; the employee number in Polaris must match the ZKTeco user ID/PIN that appears in attendance logs.

For remote ZKTeco sync, Polaris exposes a token-protected bridge receiver:

```text
POST /api/zkteco/push
Header: X-Polaris-Bridge-Token: <ZKTECO_PUSH_TOKEN>
```

Set `ZKTECO_PUSH_TOKEN` in the Polaris server `.env`. The local office bridge is a separate project and should run outside the Polaris cloud server.

The Employees page includes a `Timesheet` option. Polaris treats check-in punches as inside/available and check-out punches as outside/not available. When the device sends no explicit punch type, Polaris pairs punches in order as in/out/in/out. The daily report shows first in, last out, expected out, total inside time, outside time during working hours, current inside status, punch count, and Excel-compatible export.

Office timing, latest arrival time, and off days are configured in the active Company Profile. For example, an office schedule of `07:30` to `16:00` with latest arrival `08:30` keeps the same required work duration: if an employee arrives at `08:00`, the expected checkout becomes `16:30`; if they arrive at `08:30`, the expected checkout becomes `17:00`.

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
