/**
 * Fase 20: Auth helpers — session management, password hashing
 */
import { db } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'
import type { Role } from './rbac'

/**
 * Hash password usando SHA-256 + salt.
 * In produzione: usare bcrypt/argon2, ma per alpha usiamo crypto nativo.
 */
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || randomBytes(16).toString('hex')
  const hash = createHash('sha256').update(password + s).digest('hex')
  return { hash, salt: s }
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt)
  return hash === expectedHash
}

/**
 * Crea una sessione per un utente.
 */
export async function createSession(userId: string, ipAddress?: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 giorni
  await db.session.create({
    data: { userId, token, expiresAt, ipAddress, userAgent },
  })
  return token
}

/**
 * Verifica una sessione e ritorna l'utente.
 */
export async function verifySession(token: string): Promise<{
  userId: string
  email: string
  name: string | null
  role: Role
  tenantId: string
} | null> {
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } })
    return null
  }
  if (!session.user.active) return null
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role as Role,
    tenantId: session.user.tenantId,
  }
}

/**
 * Revoca una sessione (logout).
 */
export async function revokeSession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { token } })
}

/**
 * Cleanup sessioni scadute (chiamare periodicamente).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}

/**
 * Crea utente admin di default se non esiste.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  const existing = await db.user.findUnique({ where: { email: 'admin@sota-os.local' } })
  if (existing) return
  const { hash, salt } = hashPassword('admin123')
  await db.user.create({
    data: {
      email: 'admin@sota-os.local',
      name: 'Default Admin',
      passwordHash: `${salt}:${hash}`,
      role: 'admin',
      tenantId: 'default',
      active: true,
    },
  })
  console.log('[auth] Default admin created: admin@sota-os.local / admin123')
}

/**
 * Autentica utente con email + password.
 */
export async function authenticateUser(email: string, password: string): Promise<{
  userId: string
  email: string
  name: string | null
  role: Role
  tenantId: string
} | null> {
  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.active || !user.passwordHash) return null
  const [salt, expectedHash] = user.passwordHash.split(':')
  if (!verifyPassword(password, salt, expectedHash)) return null
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    tenantId: user.tenantId,
  }
}
