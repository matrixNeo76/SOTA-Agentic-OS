#!/bin/bash
# Restore del database SQLite da backup specifico
# Usage: bun run db:restore [backup-file]
# Se nessun file specificato, mostra i backup disponibili

set -e

DB_PATH="db/custom.db"
BACKUP_DIR="db/backups"

if [ -z "$1" ]; then
  echo "📦 Backup disponibili in $BACKUP_DIR:"
  echo ""
  ls -lht "$BACKUP_DIR"/custom-*.db 2>/dev/null | head -10 | awk '{print "  "$NF" ("$5") "$6" "$7" "$8}'
  echo ""
  echo "Usage: bun run db:restore <backup-file>"
  echo "Esempio: bun run db:restore db/backups/custom-20260620-120000.db"
  exit 0
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Backup non trovato: $BACKUP_FILE"
  exit 1
fi

# Verifica checksum se disponibile
if [ -f "$BACKUP_FILE.sha256" ]; then
  EXPECTED=$(cat "$BACKUP_FILE.sha256")
  ACTUAL=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "❌ Checksum non valido! Backup corrotto."
    exit 1
  fi
  echo "✓ Checksum verificato"
fi

# Backup del DB corrente prima del restore
if [ -f "$DB_PATH" ]; then
  TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
  PRE_RESTORE="db/backups/pre-restore-$TIMESTAMP.db"
  mkdir -p db/backups
  cp "$DB_PATH" "$PRE_RESTORE"
  echo "📦 Backup pre-restore: $PRE_RESTORE"
fi

echo "🔄 Restore in corso..."
cp "$BACKUP_FILE" "$DB_PATH"
echo "✓ Database ripristinato da: $BACKUP_FILE"
echo ""
echo "⚠ Riavvia il dev server per applicare le modifiche:"
echo "  bun run dev:clean"
