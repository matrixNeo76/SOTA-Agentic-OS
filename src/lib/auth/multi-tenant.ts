/**
 * Multi-Tenant Middleware — IO-6
 *
 * Isolamento per tenant/chiave, audit ledger, rate limiting, quota enforcement.
 *
 * Funzioni:
 *   1. Tenant scoping: ogni query esterna è filtrata per tenantId dell'API key
 *   2. Audit ledger: ogni accesso esterno è tracciato su AgentLog
 *   3. Rate limiting: per-key request count con sliding window
 *   4. Quota enforcement: limiti configurabili per tenant
 *
 * Usage nelle API routes:
 *   const auth = await requireApiAuth(req)
 *   if (!auth.ok) return auth.response
 *   const tenantCtx = createTenantContext(auth.apiKey)
 *   // Ora tutte le query usano tenantCtx.tenantId come filtro
 */

import { db } from '@/lib/db'
import type { ApiKeyInfo } from './api-key'
import { createHash } from 'crypto'

// === Tipi ============================================================

export interface TenantContext {
  tenantId: string
  apiKeyId: string
  scopes: string[]
  rateLimitPerMin: number
}

export interface AuditEntry {
  timestamp: string
  apiKeyId: string
  tenantId: string
  method: string
  path: string
  statusCode: number
  durationMs: number
  userAgent?: string
  ip?: string
}

// === Tenant context ==================================================

export function createTenantContext(apiKey: ApiKeyInfo): TenantContext {
  return {
    tenantId: apiKey.tenantId,
    apiKeyId: apiKey.keyId,
    scopes: apiKey.scopes,
    rateLimitPerMin: 60, // default; in produzione caricare da ApiKey record
  }
}

/**
 * Filtro Prisma da applicare a tutte le query esterne per isolamento tenant.
 * Usage:
 *   const tasks = await db.agentPlan.findMany({ where: { ...tenantFilter(ctx) } })
 */
export function tenantFilter(ctx: TenantContext): Record<string, unknown> {
  // Per ora l'isolamento è sul tenantId del record.
  // I modelli che hanno tenantId: User, ApiKey.
  // Per gli altri modelli (AgentPlan, GraphNode, etc.) il tenantId è implicito
  // nei dati creati dall'API key di quel tenant.
  // In produzione: aggiungere colonna tenantId a tutti i modelli principali.
  return { tenantId: ctx.tenantId }
}

// === Audit Ledger ====================================================

/**
 * Registra un accesso esterno nell'audit ledger (AgentLog).
 */
export async function auditAccess(entry: AuditEntry): Promise<void> {
  try {
    await db.agentLog.create({
      data: {
        agentId: `api-key:${entry.apiKeyId}`,
        phase: 'audit',
        event: 'external_access',
        payload: JSON.stringify({
          ...entry,
          hash: hashEntry(entry), // dedup fingerprint
        }),
        level: entry.statusCode >= 400 ? 'warn' : 'info',
      },
    })
  } catch {
    // Non bloccante
  }
}

/**
 * Recupera l'audit trail per un tenant o API key specifica.
 */
export async function getAuditTrail(options: {
  tenantId?: string
  apiKeyId?: string
  limit?: number
  sinceHours?: number
}): Promise<Array<{
  timestamp: string
  apiKeyId: string
  method: string
  path: string
  statusCode: number
  durationMs: number
}>> {
  const cutoff = options.sinceHours
    ? new Date(Date.now() - options.sinceHours * 60 * 60 * 1000)
    : new Date(0)

  const logs = await db.agentLog.findMany({
    where: {
      phase: 'audit',
      event: 'external_access',
      timestamp: { gte: cutoff },
      ...(options.tenantId && { tenantId: options.tenantId }),
    },
    take: options.limit || 100,
    orderBy: { timestamp: 'desc' },
  })

  return logs.map((log) => {
    const payload = JSON.parse(log.payload) as AuditEntry & { hash: string }
    return {
      timestamp: payload.timestamp,
      apiKeyId: payload.apiKeyId,
      method: payload.method,
      path: payload.path,
      statusCode: payload.statusCode,
      durationMs: payload.durationMs,
    }
  })
}

// === Rate Limiting ===================================================

// In-memory sliding window rate limiter (per-key)
// In produzione: Redis con INCR + EXPIRE
const rateLimitWindows = new Map<string, { count: number; windowStart: number }>()

/**
 * Verifica se l'API key ha superato il rate limit.
 * Ritorna { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(apiKeyId: string, limitPerMin: number): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const now = Date.now()
  const windowMs = 60_000 // 1 minuto

  let window = rateLimitWindows.get(apiKeyId)
  if (!window || now - window.windowStart > windowMs) {
    window = { count: 0, windowStart: now }
    rateLimitWindows.set(apiKeyId, window)
  }

  window.count++
  const allowed = window.count <= limitPerMin
  const remaining = Math.max(0, limitPerMin - window.count)
  const resetAt = window.windowStart + windowMs

  return { allowed, remaining, resetAt }
}

/**
 * Middleware helper: applica rate limiting e ritorna 429 se superato.
 * Da usare prima del handler principale.
 */
export function enforceRateLimit(ctx: TenantContext): {
  allowed: boolean
  headers: Record<string, string>
} {
  const rl = checkRateLimit(ctx.apiKeyId, ctx.rateLimitPerMin)

  const headers = {
    'X-RateLimit-Limit': String(ctx.rateLimitPerMin),
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(rl.resetAt),
  }

  return { allowed: rl.allowed, headers }
}

// === Quota Enforcement ===============================================

export interface TenantQuota {
  maxApiKeys: number
  maxRunsPerDay: number
  maxMemoryEntries: number
  maxGraphNodes: number
}

const DEFAULT_QUOTA: TenantQuota = {
  maxApiKeys: 10,
  maxRunsPerDay: 100,
  maxMemoryEntries: 10000,
  maxGraphNodes: 50000,
}

/**
 * Verifica se il tenant ha superato la quota per una risorsa.
 */
export async function checkQuota(ctx: TenantContext, resource: keyof TenantQuota): Promise<{
  exceeded: boolean
  current: number
  limit: number
}> {
  const limit = DEFAULT_QUOTA[resource]
  let current = 0

  try {
    switch (resource) {
      case 'maxApiKeys':
        current = await db.apiKey.count({ where: { tenantId: ctx.tenantId, active: true } })
        break
      case 'maxRunsPerDay': {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
        current = await db.agentPlan.count({
          where: { createdAt: { gte: cutoff } },
        })
        break
      }
      case 'maxMemoryEntries':
        current = await db.memoryEntry.count()
        break
      case 'maxGraphNodes':
        current = await db.graphNode.count()
        break
    }
  } catch {
    // Non bloccante se il conteggio fallisce
  }

  return { exceeded: current >= limit, current, limit }
}

// === Stats ===========================================================

export async function tenantStats(tenantId?: string): Promise<{
  apiKeys: number
  auditEntries: number
  topEndpoints: Array<{ path: string; count: number }>
}> {
  const [apiKeys, auditLogs] = await Promise.all([
    db.apiKey.count({ where: { ...(tenantId && { tenantId }) } }),
    db.agentLog.findMany({
      where: { phase: 'audit', event: 'external_access', ...(tenantId && { tenantId }) },
      take: 1000,
      orderBy: { timestamp: 'desc' },
      select: { payload: true },
    }),
  ])

  // Aggregate top endpoints
  const endpointCounts = new Map<string, number>()
  for (const log of auditLogs) {
    try {
      const payload = JSON.parse(log.payload) as AuditEntry
      const key = `${payload.method} ${payload.path}`
      endpointCounts.set(key, (endpointCounts.get(key) || 0) + 1)
    } catch {}
  }

  const topEndpoints = Array.from(endpointCounts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    apiKeys,
    auditEntries: auditLogs.length,
    topEndpoints,
  }
}

// === Helpers =========================================================

function hashEntry(entry: AuditEntry): string {
  return createHash('sha256')
    .update(`${entry.apiKeyId}:${entry.method}:${entry.path}:${entry.timestamp}`)
    .digest('hex')
    .slice(0, 16)
}
