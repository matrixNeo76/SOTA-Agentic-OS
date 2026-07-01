/**
 * GET /api/admin/quotas — Tenant quota usage and limits
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { checkQuota, createTenantContext, type TenantQuota } from '@/lib/auth/multi-tenant'
import type { ApiKeyInfo } from '@/lib/auth/api-key'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  // Check quotas for default tenant
  const dummyCtx: ReturnType<typeof createTenantContext> = createTenantContext({
    keyId: 'admin',
    name: 'admin',
    scopes: ['admin'],
    tenantId: auth.tenantId,
    userId: auth.userId,
  } as ApiKeyInfo)

  const resources: Array<keyof TenantQuota> = ['maxApiKeys', 'maxRunsPerDay', 'maxMemoryEntries', 'maxGraphNodes']
  const quotas = await Promise.all(
    resources.map(async (resource) => ({
      resource,
      ...(await checkQuota(dummyCtx, resource)),
    }))
  )

  return NextResponse.json({
    tenantId: auth.tenantId,
    quotas: quotas.map((q) => ({
      resource: q.resource,
      current: q.current,
      limit: q.limit,
      usage: `${((q.current / q.limit) * 100).toFixed(1)}%`,
      exceeded: q.exceeded,
    })),
  })
}
