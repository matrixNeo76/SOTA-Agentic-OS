/**
 * GET /api/conflict-resolution — pending conflicts + stats (requireAuth)
 * POST /api/conflict-resolution — create claim or resolve conflict (requireAdmin)
 *
 * C1 fix: prima questa route era completamente senza auth → chiunque poteva
 * leggere conflitti, creare claim malevoli, risolvere conflitti bypassando
 * la gerarchia normative. Ora GET richiede sessione valida, POST richiede
 * ruolo admin/operator.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  listPendingConflicts, resolveConflict, autoResolveConflicts,
  createClaimAndDetectConflicts, conflictResolutionStats,
} from '@/lib/conflict-resolution/engine'
import { createProvenance } from '@/lib/governance'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const [pending, stats] = await Promise.all([
    listPendingConflicts(),
    conflictResolutionStats(),
  ])
  return NextResponse.json({ pending, stats })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || createProvenance({
      agent: `user://${auth.email}`,
      source: 'human-approval',
      confidence: 1.0,
    })

    if (action === 'create-claim') {
      const { identifier, statement, confidence, domain, evidence } = body
      if (!identifier || !statement || confidence === undefined) {
        return NextResponse.json({ error: 'Missing identifier, statement, or confidence' }, { status: 400 })
      }
      const result = await createClaimAndDetectConflicts({
        identifier, statement, confidence, domain, evidence, provenance,
      })
      return NextResponse.json(result)
    }

    if (action === 'resolve') {
      const { conflictUri, strategy, resolvedBy, reason, manualWinnerUri } = body
      if (!conflictUri || !strategy || !resolvedBy) {
        return NextResponse.json({ error: 'Missing conflictUri, strategy, or resolvedBy' }, { status: 400 })
      }
      const result = await resolveConflict({
        conflictUri, strategy, resolvedBy, reason, manualWinnerUri, provenance,
      })
      return NextResponse.json(result)
    }

    if (action === 'auto-resolve') {
      const { strategy, maxIterations } = body
      const result = await autoResolveConflicts({ strategy, maxIterations })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
