import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'

const globalForPrisma = globalThis as unknown as {
  __prismaClient: PrismaClient | undefined
  __prismaInode: number | undefined
}

const DB_PATH = '/home/z/my-project/db/custom.db'

function readInode(): number {
  try {
    const stat = fs.statSync(DB_PATH)
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
