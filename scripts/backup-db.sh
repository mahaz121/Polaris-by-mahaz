#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$APP_DIR/data/backups"
STAMP="$(date +%Y-%m-%d-%H-%M)"
ARCHIVE="$BACKUP_DIR/polaris-by-mahaz-backup-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

if [ ! -f data/nameplate.sqlite ]; then
  echo "No SQLite database found at data/nameplate.sqlite"
  exit 1
fi

tar -czf "$ARCHIVE" data/nameplate.sqlite public/uploads .env 2>/dev/null || tar -czf "$ARCHIVE" data/nameplate.sqlite public/uploads
echo "$ARCHIVE"
