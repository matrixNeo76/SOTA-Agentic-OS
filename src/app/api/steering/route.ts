/**
 * API: /api/steering
 * ACTS Controller: decide strategia e applica steering phrase.
 */
import { NextRequest, NextResponse } from 'next/server'
import { steer, STEERING_VOCABULARY, steeringHistory } from '@/lib/kernel/acts'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
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
}

export async function POST(req: NextRequest) {
  const body = await req.json()
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
  return NextResponse.json({ ok: true, ...result })
}
