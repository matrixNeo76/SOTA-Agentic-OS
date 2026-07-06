/**
 * API: /api/steering
 * ACTS Controller: decide strategia e applica steering phrase.
 */
import { NextRequest, NextResponse } from 'next/server'
import { steer, STEERING_VOCABULARY, steeringHistory } from '@/lib/kernel/acts'
import { db } from '@/lib/db'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get('agentId') || 'controller'
    const [history, strategies] = await Promise.all([
      steeringHistory(agentId, 30),
      db.steeringStrategy.findMany(),
    ])
    return NextResponse.json({
      vocabulary: STEERING_VOCABULARY,
      history,
      strategies: strategies.length ? strategies : Object.entries(STEERING_VOCABULARY).map(([name, info]) => ({
        name, triggerPhrase: info.phrase, description: info.description, budgetCost: info.budgetCost, active: true,
      })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load steering state', detail: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  let body
  try {
    body = await req.json()
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body', detail: err.message }, { status: 400 })
  }

  try {
    const {
      agentId = 'controller',
      budgetTotal = 1000,
      budgetUsed = 0,
      step = 0,
      lastStrategy = 'PLAN',
      lastCheckPassed = null,
      errorsConsecutive = 0,
    } = body
    const result = await steer(
      agentId, budgetTotal, budgetUsed, step,
      lastStrategy, lastCheckPassed, errorsConsecutive
    )
    await db.agentLog.create({
      data: {
        agentId,
        phase: '3',
        event: 'steer',
        payload: JSON.stringify(result),
      },
    })
    await publishAgentEvent({
      agentId, phase: '3',
      event: 'steer',
      payload: { strategy: result.strategy, tokenUsed: result.tokenUsed },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Steer failed', detail: err.message }, { status: 500 })
  }
}
