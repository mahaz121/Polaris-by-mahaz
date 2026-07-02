#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: ./scripts/restore-db.sh <backup.tar.gz|database.sqlite|database.db>"
  echo "Set RESTORE_ENV=1 to restore .env from a compatible backup archive."
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$1"
DB_PATH="$APP_DIR/data/nameplate.sqlite"

if [ ! -f "$SOURCE" ]; then
  echo "Backup file not found: $SOURCE"
  exit 1
fi

mkdir -p "$APP_DIR/data" "$APP_DIR/public/uploads"

if command -v pm2 >/dev/null 2>&1; then
  pm2 stop digital-nameplate >/dev/null 2>&1 || true
fi

restore_database_file() {
  local source_db="$1"
  cp "$source_db" "$DB_PATH"
  rm -f "$DB_PATH-wal" "$DB_PATH-shm"
}

case "$SOURCE" in
  *.sqlite|*.db)
    restore_database_file "$SOURCE"
    ;;
  *.tar.gz|*.tgz)
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    tar -xzf "$SOURCE" -C "$TMP_DIR"

    FOUND_DB="$(find "$TMP_DIR" -type f \( -name 'nameplate.sqlite' -o -name '*.sqlite' -o -name '*.db' \) | head -n 1)"
    if [ -z "$FOUND_DB" ]; then
      echo "No SQLite database file found inside archive."
      exit 1
    fi
    restore_database_file "$FOUND_DB"

    FOUND_UPLOADS="$(find "$TMP_DIR" -type d -path '*/public/uploads' | head -n 1)"
    if [ -n "$FOUND_UPLOADS" ]; then
      mkdir -p "$APP_DIR/public/uploads"
      cp -R "$FOUND_UPLOADS"/. "$APP_DIR/public/uploads"/
    fi

    if [ "${RESTORE_ENV:-0}" = "1" ] && [ -f "$TMP_DIR/.env" ]; then
      cp "$TMP_DIR/.env" "$APP_DIR/.env"
    fi
    ;;
  *)
    echo "Unsupported restore source. Use .tar.gz, .tgz, .sqlite, or .db."
    exit 1
    ;;
esac

echo "Restore complete: $DB_PATH"
echo "Restart Polaris-by-mahaz before opening the app."
