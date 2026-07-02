#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$APP_DIR/data/backups"
STAMP="$(date +%Y-%m-%d-%H-%M)"
ARCHIVE="$BACKUP_DIR/polaris-by-mahaz-backup-$STAMP.tar.gz"
TMP_DIR="$(mktemp -d)"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ ! -f data/polaris.sqlite ]; then
  echo "No SQLite database found at data/polaris.sqlite"
  exit 1
fi

mkdir -p "$TMP_DIR/data" "$TMP_DIR/public"
export POLARIS_BACKUP_DB="$TMP_DIR/data/polaris.sqlite"
node - <<'NODE'
const path = require('path');
const Database = require('better-sqlite3');

const source = path.join(process.cwd(), 'data', 'polaris.sqlite');
const target = process.env.POLARIS_BACKUP_DB;
const db = new Database(source);
db.pragma('wal_checkpoint(FULL)');
db.backup(target)
  .then(() => db.close())
  .catch(error => {
    db.close();
    console.error(error);
    process.exit(1);
  });
NODE

cp -R public/uploads "$TMP_DIR/public/uploads"
if [ -f .env ]; then
  cp .env "$TMP_DIR/.env"
fi

(
  cd "$TMP_DIR"
  tar -czf "$ARCHIVE" data/polaris.sqlite public/uploads .env 2>/dev/null || tar -czf "$ARCHIVE" data/polaris.sqlite public/uploads
)
echo "$ARCHIVE"
