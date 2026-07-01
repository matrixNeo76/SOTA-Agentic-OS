#!/usr/bin/env node
/**
 * check-schema-sync.ts — C7a
 *
 * Verifies that prisma/schema.prisma (SQLite) and prisma/schema.postgres.prisma
 * are aligned: same set of models, same set of fields per model, same types
 * (with the documented exceptions for pgvector embedding fields).
 *
 * Exit codes:
 *   0 — schemas are aligned
 *   1 — schemas diverge (prints a diff to stderr)
 *   2 — unexpected error (file not found, parse error)
 *
 * Run: bun run scripts/check-schema-sync.ts
 *
 * This script does NOT require a DATABASE_URL — it parses the schema files
 * directly with a lightweight regex-based parser (good enough for the
 * structural check we need; full Prisma AST parsing would require loading
 * the Prisma CLI which is heavyweight and needs network access).
 */

import * as fs from 'fs'
import * as path from 'path'

const SQLITE_SCHEMA = path.resolve(__dirname, '..', 'prisma', 'schema.prisma')
const PG_SCHEMA = path.resolve(__dirname, '..', 'prisma', 'schema.postgres.prisma')

// Models whose `embedding` field is intentionally different between schemas.
// In SQLite it's `String` (JSON array), in Postgres it's `Unsupported("vector(256)")`.
const EMBEDDING_EXCEPTIONS = new Set([
  'EpisodicMemory',
  'SemanticEntity',
  'Heuristic',
  'Belief',
  'EmbeddingVector',
  'MemoryEntry',
])

interface ModelSpec {
  name: string
  fields: Map<string, string> // fieldName -> raw type string (trimmed)
}

function parseModels(filePath: string): Map<string, ModelSpec> {
  const content = fs.readFileSync(filePath, 'utf8')
  const models = new Map<string, ModelSpec>()

  // Match: model Name { ... } — non-greedy, handles nested braces minimally
  // by stopping at the first `}` at column 0.
  const modelRegex = /^model\s+(\w+)\s*\{([^}]*)\}/gm
  let match: RegExpExecArray | null

  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1]!
    const body = match[2]!
    const fields = new Map<string, string>()

    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('//')) continue
      if (trimmed.startsWith('@@')) continue // block-level attributes
      if (trimmed.startsWith('@')) continue // field-level attribute on its own line

      // Field line: `name Type @attrs...`
      // We capture the name and the type (up to the first space after the type).
      const fieldMatch = trimmed.match(/^(\w+)\s+([^\s]+)/)
      if (!fieldMatch) continue
      const fieldName = fieldMatch[1]!
      const fieldType = fieldMatch[2]!
      fields.set(fieldName, fieldType)
    }

    models.set(name, { name, fields })
  }

  return models
}

function normalizeType(modelName: string, fieldName: string, type: string): string {
  // Treat the documented pgvector exception as equivalent.
  if (fieldName === 'embedding' && EMBEDDING_EXCEPTIONS.has(modelName)) {
    return '__EMBEDDING__' // canonical, same for both schemas
  }
  return type
}

function main(): void {
  if (!fs.existsSync(SQLITE_SCHEMA)) {
    console.error(`Missing: ${SQLITE_SCHEMA}`)
    process.exit(2)
  }
  if (!fs.existsSync(PG_SCHEMA)) {
    console.error(`Missing: ${PG_SCHEMA}`)
    process.exit(2)
  }

  const sqlite = parseModels(SQLITE_SCHEMA)
  const pg = parseModels(PG_SCHEMA)

  const sqliteNames = new Set(sqlite.keys())
  const pgNames = new Set(pg.keys())

  const onlyInSqlite = [...sqliteNames].filter((n) => !pgNames.has(n))
  const onlyInPg = [...pgNames].filter((n) => !sqliteNames.has(n))

  let divergences = 0

  if (onlyInSqlite.length > 0) {
    console.error(`Models only in SQLite schema: ${onlyInSqlite.join(', ')}`)
    divergences += onlyInSqlite.length
  }
  if (onlyInPg.length > 0) {
    console.error(`Models only in Postgres schema: ${onlyInPg.join(', ')}`)
    divergences += onlyInPg.length
  }

  // Compare field sets for models present in both
  for (const name of [...sqliteNames].filter((n) => pgNames.has(n))) {
    const sFields = sqlite.get(name)!.fields
    const pFields = pg.get(name)!.fields

    const onlyInS = [...sFields.keys()].filter((f) => !pFields.has(f))
    const onlyInP = [...pFields.keys()].filter((f) => !sFields.has(f))

    if (onlyInS.length > 0) {
      console.error(`[${name}] Fields only in SQLite: ${onlyInS.join(', ')}`)
      divergences += onlyInS.length
    }
    if (onlyInP.length > 0) {
      console.error(`[${name}] Fields only in Postgres: ${onlyInP.join(', ')}`)
      divergences += onlyInP.length
    }

    // Compare types for fields present in both
    for (const f of sFields.keys()) {
      if (!pFields.has(f)) continue
      const sType = normalizeType(name, f, sFields.get(f)!)
      const pType = normalizeType(name, f, pFields.get(f)!)
      if (sType !== pType) {
        console.error(`[${name}.${f}] Type mismatch: SQLite=${sFields.get(f)!} vs Postgres=${pFields.get(f)!}`)
        divergences++
      }
    }
  }

  if (divergences === 0) {
    console.log(`✓ Schemas aligned: ${sqliteNames.size} models, ${pgNames.size} models.`)
    console.log(`  pgvector exceptions documented for: ${[...EMBEDDING_EXCEPTIONS].join(', ')}`)
    process.exit(0)
  } else {
    console.error(`\n✗ ${divergences} divergence(s) found.`)
    process.exit(1)
  }
}

main()
