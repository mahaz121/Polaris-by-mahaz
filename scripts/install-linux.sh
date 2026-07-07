#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "Installing Polaris-by-mahaz production app..."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

mkdir -p data/sessions data/backups public/uploads

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

if grep -q '^PORT=' .env; then
  sed -i 's/^PORT=.*/PORT=3004/' .env
else
  printf '\nPORT=3004\n' >> .env
fi

if grep -q '^SERVER_PUBLIC_URL=' .env; then
  sed -i 's#^SERVER_PUBLIC_URL=.*#SERVER_PUBLIC_URL=http://your-server-ip:3004#' .env
fi

if grep -Eq '^SESSION_SECRET=(replace-with-a-generated-strong-secret|change-this.*|)$' .env; then
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SECRET/" .env
  echo "Generated a strong SESSION_SECRET in .env."
fi

if grep -Eq '^POLARIS_BOOTSTRAP_ADMIN_PASSWORD=(replace-with-a-temporary-strong-admin-password|)$' .env; then
  ADMIN_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
  sed -i "s/^POLARIS_BOOTSTRAP_ADMIN_PASSWORD=.*/POLARIS_BOOTSTRAP_ADMIN_PASSWORD=$ADMIN_PASSWORD/" .env
  echo "Generated bootstrap admin password for first install: $ADMIN_PASSWORD"
  echo "Change it immediately after first login."
fi

npm ci --omit=dev
npm run migrate

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

pm2 start ecosystem.config.cjs --env production
pm2 save

echo "Polaris-by-mahaz is running on http://localhost:3004"
echo "Review .env before exposing the server publicly."
