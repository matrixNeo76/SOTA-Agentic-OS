/**
 * GET /api/admin/audit/ledger — Audit Ledger entries con filtri + pagination
 *
 * G5: endpoint pubblico (per integrazioni esterne SIEM/compliance) che
 * espone AuditLedgerEntry con filtri avanzati.
 *
 * Query params:
 *   ?agentId=        Filter by agentId (exact match)
 *   ?gate=           Filter by decision.gate (delegation|hitl|normative|ltl|redline|sovereign)
 *   ?outcome=        Filter by decision.outcome (granted|revoked|approved|rejected|block|modify|...)
 *   ?reversible=     true|false
 *   ?sinceHours=     Default 24
 *   ?limit=          Default 50, max 500
 *   ?offset=         Default 0 (for pagination)
 *   ?q=              Full-text search on action + readableNarrative
 *
 * Response:
 *   {
 *     entries: AuditLedgerEntry[],
 *     total: number,
 *     hasMore: boolean,
 *     filters: { agentId, gate, outcome, reversible, sinceHours, q }
 *   }
 *
 * Auth: requireAdmin (audit contiene dati sensibili su decisioni governance).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId') || undefined
  const gate = url.searchParams.get('gate') || undefined
  const outcome = url.searchParams.get('outcome') || undefined
  const reversibleParam = url.searchParams.get('reversible')
  const reversible = reversibleParam === 'true' ? true : reversibleParam === 'false' ? false : undefined
  const sinceHours = Math.min(Math.max(parseInt(url.searchParams.get('sinceHours') || '24', 10) || 24, 1), 24 * 365) // 1h to 1y
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 500)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)
  const q = url.searchParams.get('q') || undefined

  // Build where clause
  const where: Prisma.AuditLedgerEntryWhereInput = {}
  if (agentId) where.agentId = agentId
  if (reversible !== undefined) where.reversible = reversible

  // sinceHours filter
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000)
  where.timestamp = { gte: since }

  // gate / outcome filter: stored as JSON string in `decision` column.
  // SQLite non supporta query JSON native, quindi facciamo fetch + filter
  // in memoria quando gate/outcome sono specificati. Per piccoli volumi
  // (< 500 entries) è accettabile.
  if (gate || outcome || q) {
    // Per gate/outcome/q dobbiamo leggere più righe e filtrare in memoria
    const candidates = await db.auditLedgerEntry.findMany({
      where: { ...where, timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      take: limit * 10, // over-fetch per compensare il filter in-memory
    })

    let filtered = candidates
    if (gate) {
      filtered = filtered.filter((e) => {
        try {
          const d = JSON.parse(e.decision)
          return d.gate === gate
        } catch {
          return false
        }
      })
    }
    if (outcome) {
      filtered = filtered.filter((e) => {
        try {
          const d = JSON.parse(e.decision)
          return d.outcome === outcome
        } catch {
          return false
        }
      })
    }
    if (q) {
      const ql = q.toLowerCase()
      filtered = filtered.filter((e) =>
        e.action.toLowerCase().includes(ql) ||
        e.readableNarrative.toLowerCase().includes(ql)
      )
    }

    const total = filtered.length
    const paged = filtered.slice(offset, offset + limit)
    return NextResponse.json({
      entries: paged,
      total,
      hasMore: offset + limit < total,
      filters: { agentId, gate, outcome, reversible, sinceHours, q },
    })
  }

  // No gate/outcome/q filter: usa pagination DB nativa
  const [entries, total] = await Promise.all([
    db.auditLedgerEntry.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.auditLedgerEntry.count({ where }),
  ])

  return NextResponse.json({
    entries,
    total,
    hasMore: offset + limit < total,
    filters: { agentId, gate, outcome, reversible, sinceHours, q },
  })
}
