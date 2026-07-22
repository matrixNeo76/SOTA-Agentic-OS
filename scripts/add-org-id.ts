/**
 * Script: add-org-id.ts
 *
 * Aggiunge `organizationId String @default("default")` a tutti i modelli Prisma
 * che non lo hanno già. Salta i modelli strutturali (Organization, Workspace, UserWorkspace, User).
 *
 * Default "default" assicura backward compatibility con dati esistenti.
 *
 * Usage: bun run scripts/add-org-id.ts
 */
import { readFileSync, writeFileSync } from 'fs'

const SCHEMA_PATH = '/home/z/my-project/prisma/schema.prisma'

// Modelli che NON ricevono organizationId
const SKIP_MODELS = new Set([
  'Organization',
  'Workspace',
  'UserWorkspace',
  'User',         // ha già organizationId
  'Session',      // user-scoped via userId
])

function main() {
  let schema = readFileSync(SCHEMA_PATH, 'utf-8')
  let modifiedCount = 0

  // Match each model block
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
  let match

  const models: Array<{ name: string; content: string; fullMatch: string }> = []
  while ((match = modelRegex.exec(schema)) !== null) {
    models.push({
      name: match[1],
      content: match[2],
      fullMatch: match[0],
    })
  }

  console.log(`[add-org-id] Found ${models.length} models`)

  for (const model of models) {
    if (SKIP_MODELS.has(model.name)) {
      console.log(`  ⏭️  Skipping ${model.name} (structural)`)
      continue
    }

    // Check if already has organizationId
    if (model.content.includes('organizationId')) {
      console.log(`  ⏭️  Skipping ${model.name} (already has organizationId)`)
      continue
    }

    // Add organizationId field + index
    // Insert before the last @@index or before the closing brace
    let newContent = model.content

    // Add the field after the last field line (before @@index or closing })
    const fieldLine = '\n  organizationId String   @default("default") // Track 2.2 multi-tenant'

    // Find where to insert: before @@index lines or before closing }
    if (newContent.includes('@@')) {
      // Insert before first @@ line
      newContent = newContent.replace(/(\n  @@)/, `${fieldLine}$1`)
    } else {
      // Insert before closing brace (trim trailing whitespace)
      newContent = newContent.replace(/(\n\})$/, `${fieldLine}$1`)
    }

    // Add @@index([organizationId]) if not present
    if (!newContent.includes('@@index([organizationId])')) {
      // Add after last @@index or before closing }
      if (newContent.includes('@@index')) {
        // Add after last @@index line
        newContent = newContent.replace(/(@@index\([^)]+\)\s*\n)(?!\s*@@)/, `$1  @@index([organizationId])\n`)
      } else if (newContent.includes('@@')) {
        newContent = newContent.replace(/(@@[^n][^\n]+\n)(?!\s*@@)/, `$1  @@index([organizationId])\n`)
      } else {
        // No @@ lines, add before closing }
        newContent = newContent.replace(/(\n\})$/, `\n  @@index([organizationId])$1`)
      }
    }

    schema = schema.replace(model.fullMatch, `model ${model.name} {${newContent}}`)
    modifiedCount++
    console.log(`  ✅ Added organizationId to ${model.name}`)
  }

  writeFileSync(SCHEMA_PATH, schema)
  console.log(`\n[add-org-id] Modified ${modifiedCount} models`)
  console.log(`[add-org-id] Schema written to ${SCHEMA_PATH}`)
  console.log(`[add-org-id] Run: bunx prisma db push --accept-data-loss`)
}

main()
