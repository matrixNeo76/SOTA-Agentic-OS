/**
 * API Key Auth — IO-0
 *
 * Autenticazione machine-to-machine via API key con scopes.
 *
 * Format: `sak_<keyId>_<secret>` (es. `sak_abc123_xyz789`)
 * - keyId: pubblico, usato per lookup
 * - secret: privato, hashato con SHA-256
 *
 * Scopes:
 *   - read: accesso in lettura a tutte le superfici
 *   - exec: esecuzione workflow (Runs, tool call)
 *   - admin: gestione sistema (settings, users, tools)
 *
 * Usage nelle API routes:
 *   import { requireApiAuth } from '@/lib/auth/api-key'
 *   const auth = await requireApiAuth(req)
 *   if (!auth.ok) return auth.response
 *   // auth.apiKey contiene { keyId, scopes, tenantId, userId }
 *
 * L'header può essere:
 *   - Authorization: Bearer sak_abc123_xyz789
 *   - X-API-Key: sak_abc123_xyz789
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'
import { requireAuth, type AuthResult } from './require-auth'

// === Tipi ============================================================

export type ApiScope = 'read' | 'exec' | 'admin'

export interface ApiKeyInfo {
  keyId: string
  name: string
  scopes: ApiScope[]
  tenantId: string
  userId: string | null
}

export type ApiAuthResult =
  | { ok: true; apiKey: ApiKeyInfo; source: 'api-key' | 'session' }
  | { ok: false; response: NextResponse }

// === Key generation ==================================================

/**
 * Genera una nuova API key.
 * Ritorna la key completa (da mostrare una sola volta) + il record DB.
 */
export async function createApiKey(params: {
  name: string
  scopes: ApiScope[]
  userId?: string
  tenantId?: string
  createdBy: string
  expiresAt?: Date
  rateLimitPerMin?: number
}): Promise<{ fullKey: string; keyId: string }> {
  const keyId = `sak_${randomBytes(6).toString('hex')}`
  const secret = randomBytes(24).toString('hex')
  const keyHash = hashSecret(secret)

  await db.apiKey.create({
    data: {
      keyId,
      keyHash,
      name: params.name,
      scopes: JSON.stringify(params.scopes),
      userId: params.userId || null,
      tenantId: params.tenantId || 'default',
      rateLimitPerMin: params.rateLimitPerMin || 60,
      expiresAt: params.expiresAt || null,
      createdBy: params.createdBy,
    },
  })

  // fullKey = keyId + '_' + secret (da mostrare una sola volta)
  const fullKey = `${keyId}_${secret}`
  return { fullKey, keyId }
}

/**
 * Revoca un'API key.
 */
export async function revokeApiKey(keyId: string, reason: string): Promise<void> {
  await db.apiKey.update({
    where: { keyId },
    data: {
      active: false,
      revokedAt: new Date(),
      revokeReason: reason,
    },
  })
}

/**
 * Lista tutte le API key (senza il secret).
 */
export async function listApiKeys(tenantId?: string): Promise<Array<{
  keyId: string
  name: string
  scopes: ApiScope[]
  active: boolean
  tenantId: string
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  createdBy: string
}>> {
  const keys = await db.apiKey.findMany({
    where: tenantId ? { tenantId } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      keyId: true,
      name: true,
      scopes: true,
      active: true,
      tenantId: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      createdBy: true,
    },
  })

  return keys.map((k) => ({
    ...k,
    scopes: JSON.parse(k.scopes) as ApiScope[],
  }))
}

// === Auth verification ===============================================

/**
 * Verifica auth da API key O sessione cookie.
 *
 * Prima prova l'API key (header Authorization: Bearer o X-API-Key).
 * Se non presente, fallback al cookie di sessione (per browser).
 *
 * Da usare in tutte le route che devono essere accessibili sia da browser che da agenti esterni.
 */
export async function requireApiAuth(req: NextRequest, requiredScope?: ApiScope): Promise<ApiAuthResult> {
  // 1. Try API key from header
  const apiKeyHeader = req.headers.get('authorization')?.replace('Bearer ', '') || req.headers.get('x-api-key')

  if (apiKeyHeader && apiKeyHeader.startsWith('sak_')) {
    const keyInfo = await verifyApiKey(apiKeyHeader)
    if (!keyInfo) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid or expired API key' }, { status: 401 }),
      }
    }

    // Scope check
    if (requiredScope && !keyInfo.scopes.includes(requiredScope) && !keyInfo.scopes.includes('admin')) {
      return {
        ok: false,
        response: NextResponse.json({ error: `Insufficient scope: required '${requiredScope}'` }, { status: 403 }),
      }
    }

    return { ok: true, apiKey: keyInfo, source: 'api-key' }
  }

  // 2. Fallback to session cookie
  const sessionAuth = await requireAuth(req)
  if (sessionAuth.ok) {
    // Session users have full access (their role determines permissions)
    return {
      ok: true,
      apiKey: {
        keyId: `session:${sessionAuth.userId}`,
        name: sessionAuth.email,
        scopes: ['admin'] as ApiScope[], // session users get admin scope
        tenantId: sessionAuth.tenantId,
        userId: sessionAuth.userId,
      },
      source: 'session',
    }
  }

  // 3. No auth provided
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Authentication required. Use Authorization: Bearer <api-key> or X-API-Key header.' },
      { status: 401 },
    ),
  }
}

/**
 * Verifica una API key completa (keyId + secret).
 * Aggiorna lastUsedAt.
 */
async function verifyApiKey(fullKey: string): Promise<ApiKeyInfo | null> {
  // Parse: sak_<keyId>_<secret>
  const parts = fullKey.split('_')
  if (parts.length < 3) return null

  const keyId = `${parts[0]}_${parts[1]}`
  const secret = parts.slice(2).join('_')
  const keyHash = hashSecret(secret)

  const record = await db.apiKey.findUnique({
    where: { keyId },
  })

  if (!record || !record.active) return null
  if (record.keyHash !== keyHash) return null
  if (record.expiresAt && record.expiresAt < new Date()) return null

  // Update lastUsedAt (fire-and-forget)
  db.apiKey.update({
    where: { keyId },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return {
    keyId: record.keyId,
    name: record.name,
    scopes: JSON.parse(record.scopes) as ApiScope[],
    tenantId: record.tenantId,
    userId: record.userId,
  }
}

// === Helpers =========================================================

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Check if a scope is granted.
 */
export function hasScope(apiKey: ApiKeyInfo, scope: ApiScope): boolean {
  return apiKey.scopes.includes(scope) || apiKey.scopes.includes('admin')
}
