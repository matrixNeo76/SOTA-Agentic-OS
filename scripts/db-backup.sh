#!/bin/bash
# Backup manuale del database SQLite con timestamp
# Usage: bun run db:backup

set -e

DB_PATH="db/custom.db"
BACKUP_DIR="db/backups"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_FILE="$BACKUP_DIR/custom-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ Database non trovato: $DB_PATH"
  exit 1
fi

echo "📦 Backup in corso..."
cp "$DB_PATH" "$BACKUP_FILE"

# Calcola checksum per verifica integrità
CHECKSUM=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
echo "$CHECKSUM" > "$BACKUP_FILE.sha256"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✓ Backup creato: $BACKUP_FILE ($SIZE)"
echo "✓ Checksum: $CHECKSUM"

# Retention: mantieni solo gli ultimi 7 backup
ls -t "$BACKUP_DIR"/custom-*.db 2>/dev/null | tail -n +8 | while read old; do
  echo "🗑 Rimozione backup vecchio: $old"
  rm -f "$old" "$old.sha256"
done

echo ""
echo "Backup disponibili:"
ls -lh "$BACKUP_DIR"/custom-*.db 2>/dev/null | awk '{print "  "$NF" ("$5")"}'
