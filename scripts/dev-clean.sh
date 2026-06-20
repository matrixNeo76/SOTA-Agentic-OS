#!/bin/bash
# Dev clean: reset completo cache e rigenerazione client Prisma
# Risolve i problemi di "Prisma client cached" e "schema mismatch"

set -e

echo "🧹 Pulizia cache..."
rm -rf .next
echo "✓ Cache .next rimossa"

echo "🔄 Rigenerazione Prisma client..."
bun run db:generate
echo "✓ Prisma client rigenerato"

echo "🚀 Avvio dev server..."
exec bun run dev
