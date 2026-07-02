#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

pm2 reload digital-nameplate || pm2 start ecosystem.config.cjs --env production
