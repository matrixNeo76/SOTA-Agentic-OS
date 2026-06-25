/**
 * API: /api/patchboard
 * GET  - stato globale corrente + transazioni recenti
 * POST - applica una transazione JSON Patch
 */
import { NextRequest, NextResponse } from 'next/server'
import { applyTransaction, loadGlobalState, type PatchOp } from '@/lib/kernel/patchboard'
import { db } from '@/lib/db'
import { publishStateDiff, publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const [state, recent] = await Promise.all([
    loadGlobalState(),
    db.patchTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
  ])
  return NextResponse.json({
    state,
    transactions: recent.map((t) => ({
      id: t.id,
      path: t.path,
      op: t.op,
      actor: t.actor,
      authorized: t.authorized,
      status: t.status,
      reason: t.reason,
      value: t.value,
      timestamp: t.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { actor, ops } = body as { actor: string; ops: PatchOp[] }
  if (!actor || !Array.isArray(ops) || ops.length === 0) {
    return NextResponse.json({ ok: false, error: 'actor e ops[] obbligatori' }, { status: 400 })
  }
  const result = await applyTransaction(actor, ops)
  await db.agentLog.create({
    data: {
      agentId: actor,
      phase: '1',
      event: 'patchboard_tx',
      payload: JSON.stringify({ ops, result }),
      level: result.accepted ? 'info' : 'warn',
    },
  })
  // Broadcast live
  await publishStateDiff({ actor, ops, accepted: result.accepted, reason: result.reason })
  await publishAgentEvent({
    agentId: actor, phase: '1',
    event: 'patchboard_tx',
    level: result.accepted ? 'info' : 'warn',
    payload: { ops: ops.length, accepted: result.accepted },
  })
  return NextResponse.json(result)
}
