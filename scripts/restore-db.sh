#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: ./scripts/restore-db.sh data/backups/polaris-by-mahaz-backup-file.tar.gz"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$1"

if [ ! -f "$ARCHIVE" ]; then
  echo "Backup file not found: $ARCHIVE"
  exit 1
fi

mkdir -p "$APP_DIR/data" "$APP_DIR/public/uploads"
tar -xzf "$ARCHIVE" -C "$APP_DIR"
echo "Restore complete. Restart Polaris-by-mahaz after restoring."
