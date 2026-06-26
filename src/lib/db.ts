import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const globalForPrisma = globalThis as unknown as {
  __prismaClient: PrismaClient | undefined
  __prismaInode: number | undefined
}

// WS0.2 — DB path configurabile.
// Default retro-compatibile: il path z-ai attuale (zero config in dev).
// Override: impostare DATABASE_URL in .env (sqlite o postgres).
// C0 — Derive default from process.cwd() instead of hardcoded path.
// Works zero-config on any machine: clone → bun install → bun run dev.
const DEFAULT_SQLITE_PATH = require('path').join(process.cwd(), 'db', 'custom.db')

// C6.1 — Prisma requires DATABASE_URL to be set in process.env at client
// init time. The .env file shipped with this repo has DATABASE_URL commented
// out (so users can pick SQLite vs Postgres), which means a fresh clone
// with no .env edits would crash Prisma with "Environment variable not
// found: DATABASE_URL". Inject the default SQLite URL into process.env
// here if the user hasn't set one, so the zero-config path actually works.
//
// We do this BEFORE the first PrismaClient construction (in createClient)
// so the env var is always present when Prisma reads it.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${DEFAULT_SQLITE_PATH}`
}

/**
 * Estrae il path del file SQLite da DATABASE_URL.
 * Supporta i formati:
 *   - file:/absolute/path/to/db.sqlite
 *   - file:./relative/path/to/db.sqlite
 *   - postgresql://... (ritorna null — inode check non applicabile)
 * Se DATABASE_URL non è impostata, usa il default z-ai.
 */
function getSqlitePath(): string | null {
  const url = process.env.DATABASE_URL

  if (!url) {
    // Default retro-compatibile
    return DEFAULT_SQLITE_PATH
  }

  if (url.startsWith('file:')) {
    const rawPath = url.slice(5) // rimuove 'file:'
    // Risolve path relativi rispetto alla cwd
    if (rawPath.startsWith('.')) {
      return path.resolve(process.cwd(), rawPath)
    }
    return rawPath
  }

  // PostgreSQL o altro — inode check non applicabile
  return null
}

const SQLITE_PATH = getSqlitePath()

/**
 * Fail-fast validation all'avvio: verifica che la configurazione DB sia valida.
 */
function validateDbConfig(): void {
  const url = process.env.DATABASE_URL

  if (url && !url.startsWith('file:') && !url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    console.warn(`[db] DATABASE_URL format not recognized: ${url.slice(0, 50)}...`)
    console.warn('[db] Supported formats: file:/path/to/db.sqlite | postgresql://user:pass@host:port/db')
  }

  if (SQLITE_PATH) {
    // Assicura che la directory esista
    const dir = path.dirname(SQLITE_PATH)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      // Directory may already exist or not writable — non bloccante
    }
  }
}

// Esegui validazione una sola volta all'import
validateDbConfig()

function readInode(): number {
  if (!SQLITE_PATH) return 0 // PostgreSQL — no inode check
  try {
    const stat = fs.statSync(SQLITE_PATH)
    return stat.ino
  } catch {
    return 0
  }
}

function createClient() {
  return new PrismaClient({ log: ['query'] })
}

/**
 * Verifica se il DB file è stato rimosso/ricreato (inode cambiato).
 * In tal caso, disconnette e ricrea il client Prisma cached.
 * Solo per SQLite; per PostgreSQL l'inode è sempre 0 (skip check).
 */
function refreshIfStale(): PrismaClient {
  const currentInode = readInode()
  if (
    !globalForPrisma.__prismaClient ||
    (currentInode !== 0 && currentInode !== (globalForPrisma.__prismaInode ?? 0))
  ) {
    if (globalForPrisma.__prismaClient) {
      try { globalForPrisma.__prismaClient.$disconnect() } catch {}
    }
    globalForPrisma.__prismaClient = createClient()
    globalForPrisma.__prismaInode = currentInode
  }
  return globalForPrisma.__prismaClient!
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = refreshIfStale()
    const value = Reflect.get(client, prop)
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
