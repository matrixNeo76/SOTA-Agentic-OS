/**
 * GET /api/admin/audit — Audit trail for external API access
 * Query params: ?tenantId=&apiKeyId=&limit=&sinceHours=
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getAuditTrail, tenantStats } from '@/lib/auth/multi-tenant'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') || undefined
  const apiKeyId = url.searchParams.get('apiKeyId') || undefined
  const limit = parseInt(url.searchParams.get('limit') || '100', 10)
  const sinceHours = parseInt(url.searchParams.get('sinceHours') || '24', 10)

  const [trail, stats] = await Promise.all([
    getAuditTrail({ tenantId, apiKeyId, limit, sinceHours }),
    tenantStats(tenantId),
  ])

  return NextResponse.json({
    auditTrail: trail,
    total: trail.length,
    stats,
  })
}
