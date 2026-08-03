/**
 * Tenant Context — Track 2.2 Multi-tenant scoping
 *
 * Usa AsyncLocalStorage per propagare organizationId + workspaceId
 * attraverso tutta la catena di chiamate async senza passarlo esplicitamente.
 *
 * Il Prisma middleware legge dal context e auto-scope tutte le query.
 *
 * Usage nelle API routes:
 *   import { runWithTenant } from '@/lib/tenant-context'
 *
 *   export async function GET(req) {
 *     const user = await getUser(req) // estrae orgId dall'auth
 *     return runWithTenant({ organizationId: user.organizationId, workspaceId: 'ws_xxx' }, async () => {
 *       const plans = await db.agentPlan.findMany() // auto-scoped!
 *       return Response.json({ plans })
 *     })
 *   }
 */
import { AsyncLocalStorage } from 'async_hooks'

export type TenantContext = {
  organizationId: string
  workspaceId?: string | null
  userId?: string
}

const tenantStorage = new AsyncLocalStorage<TenantContext>()

// === Get current tenant context (called by Prisma middleware) ===
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore()
}

// === Run a function with a specific tenant context ===
export function runWithTenant<T>(
  ctx: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return tenantStorage.run(ctx, fn)
}

// === Run a function with a specific tenant context (sync) ===
export function runWithTenantSync<T>(
  ctx: TenantContext,
  fn: () => T
): T {
  return tenantStorage.run(ctx, fn)
}

// === Get organizationId from context or return 'default' (for backward compat) ===
export function getOrganizationId(): string {
  return tenantStorage.getStore()?.organizationId ?? 'default'
}

// === Get workspaceId from context or return null ===
export function getWorkspaceId(): string | null {
  return tenantStorage.getStore()?.workspaceId ?? null
}

// === Get userId from context ===
export function getUserId(): string | null {
  return tenantStorage.getStore()?.userId ?? null
}
