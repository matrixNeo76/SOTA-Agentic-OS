/**
 * API: /api/affect (Fase 11 - Affect Subsystem)
 *
 * N2 FIX: POST update_threshold ora richiede requireAdmin (era requireAuth).
 * update_threshold muta AffectThreshold per qualsiasi agentId — qualsiasi
 * utente poteva abbassare le soglie critiche e disabilitare Meta-Observer.
 * compute rimane requireAuth (telemetry ingestion).
 */
import { NextRequest, NextResponse } from 'next/server'
import { computeAffect, updateThreshold, affectHistory, affectStats } from '@/lib/kernel/affect-subsystem'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'

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
  const body = await req.json()
  const { action } = body

  if (action === 'compute') {
    // compute è telemetry ingestion — requireAuth sufficiente
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response

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
    // N2 FIX: requireAdmin — muta AffectThreshold (soglie di intervento critiche)
    const auth = await requireAdmin(req)
    if (!auth.ok) return auth.response

    const { agentId, action: _action, ...updates } = body
    // Filter to only valid threshold fields
    const validUpdates: any = {}
    if (typeof updates.desperationCritical === 'number') validUpdates.desperationCritical = updates.desperationCritical
    if (typeof updates.frustrationCritical === 'number') validUpdates.frustrationCritical = updates.frustrationCritical
    if (typeof updates.cooldownMs === 'number') validUpdates.cooldownMs = updates.cooldownMs
    if (typeof updates.tighteningPct === 'number') validUpdates.tighteningPct = updates.tighteningPct
    const threshold = await updateThreshold(agentId, validUpdates)
    await publishAgentEvent({
      agentId, phase: '11',
      event: 'threshold_updated',
      level: 'info',
      payload: { agentId, updates, updatedBy: auth.email },
    })
    await db.agentLog.create({
      data: {
        agentId, phase: '11', event: 'threshold_updated',
        payload: JSON.stringify({ agentId, updates, updatedBy: auth.email }),
        level: 'info',
      },
    }).catch(() => {})
    return NextResponse.json({ ok: true, threshold })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
