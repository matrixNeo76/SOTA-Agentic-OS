/**
 * Seed SystemSetting table with defaults for writable settings.
 *
 * Run with:  npx tsx prisma/seed-settings.ts
 *
 * Idempotent: only inserts rows that don't yet exist; never overwrites
 * values that an admin has already customised via /api/admin/settings.
 *
 * Why seeding (when the store already falls back to defaults)?
 *   - Makes the set of "known" settings visible in the DB / admin UI.
 *   - Lets ops diff `SELECT * FROM SystemSetting` against expected baseline.
 *   - Keeps updatedAt as an audit trail of when each setting was first set.
 */

import { PrismaClient } from '@prisma/client'
import { SETTING_DEFS } from '../src/lib/settings/store'

const prisma = new PrismaClient()

async function main() {
  let inserted = 0
  let skipped = 0

  for (const def of SETTING_DEFS) {
    const existing = await prisma.systemSetting.findUnique({ where: { key: def.key } })
    if (existing) {
      skipped++
      continue
    }
    await prisma.systemSetting.create({
      data: {
        key: def.key,
        value: def.defaultValue,
        category: def.category,
        readOnly: def.readOnly,
        updatedBy: 'system-seed',
      },
    })
    inserted++
  }

  console.log(`[seed-settings] inserted=${inserted} skipped=${skipped} total=${SETTING_DEFS.length}`)
}

main()
  .catch((err) => {
    console.error('[seed-settings] FAILED:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
