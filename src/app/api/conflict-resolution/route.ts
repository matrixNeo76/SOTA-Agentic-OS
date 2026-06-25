/**
 * GET /api/conflict-resolution — pending conflicts + stats
 * POST /api/conflict-resolution — create claim or resolve conflict
 */

import { NextResponse } from 'next/server'
import {
  listPendingConflicts, resolveConflict, autoResolveConflicts,
  createClaimAndDetectConflicts, conflictResolutionStats,
} from '@/lib/conflict-resolution/engine'
import { createProvenance } from '@/lib/governance'

export async function GET() {
  const [pending, stats] = await Promise.all([
    listPendingConflicts(),
    conflictResolutionStats(),
  ])
  return NextResponse.json({ pending, stats })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || createProvenance({
      agent: 'agent://api',
      source: 'system-event',
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
