/**
 * API: /api/affect (Fase 11 - Affect Subsystem)
 */
import { NextRequest, NextResponse } from 'next/server'
import { computeAffect, updateThreshold, affectHistory, affectStats } from '@/lib/kernel/affect-subsystem'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'
  const agentId = searchParams.get('agentId') || ''

  if (action === 'history') {
    const history = await affectHistory(agentId, 30)
    return NextResponse.json({ history })
  }

  if (action === 'stats') {
    const stats = await affectStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'compute') {
    const { agentId, toolFailures, toolCalls, gateRejects, gateAttempts, repeatedToolCalls } = body
    const result = await computeAffect({
      agentId,
      toolFailures: toolFailures || 0,
      toolCalls: toolCalls || 0,
      gateRejects: gateRejects || 0,
      gateAttempts: gateAttempts || 0,
      repeatedToolCalls: repeatedToolCalls || 0,
    })
    if (result.intervention) {
      await publishAgentEvent({
        agentId, phase: '11',
        event: 'affect_intervention',
        level: 'warn',
        payload: { desperation: result.desperation, frustration: result.frustration, intervention: result.intervention },
      })
    }
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'update_threshold') {
    const { agentId, ...updates } = body
    const threshold = await updateThreshold(agentId, updates)
    return NextResponse.json({ ok: true, threshold })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
