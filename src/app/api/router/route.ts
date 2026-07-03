/**
 * API: /api/router (Fase 14 - TimeRouter)
 *
 * N1 FIX: POST update_config ora richiede requireAdmin (era requireAuth).
 * update_config muta la RouterConfig globale — qualsiasi utente poteva
 * cambiare il comportamento di routing del sistema.
 * route() rimane requireAuth (telemetry ingestion, non governance).
 */
import { NextRequest, NextResponse } from 'next/server'
import { route, updateConfig, listRoutingDecisions, routerStats, extractFeatures, DEFAULT_MODELS } from '@/lib/kernel/time-router'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'

  if (action === 'decisions') {
    const decisions = await listRoutingDecisions(30)
    return NextResponse.json({ decisions })
  }

  if (action === 'stats') {
    const stats = await routerStats()
    return NextResponse.json(stats)
  }

  if (action === 'models') {
    return NextResponse.json({ models: DEFAULT_MODELS })
  }

  if (action === 'features') {
    const prompt = searchParams.get('prompt') || ''
    const features = extractFeatures(prompt)
    return NextResponse.json({ features })
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'route') {
    // route() è telemetry ingestion — requireAuth sufficiente
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response

    const { agentId, prompt } = body
    try {
      const result = await route(agentId, prompt)
      await publishAgentEvent({
        agentId, phase: '14',
        event: 'routing_decision',
        level: result.routedTo === 'primary' ? 'info' : 'warn',
        payload: { primaryModel: result.primaryModel, routedTo: result.routedTo, confidence: result.confidence, margin: result.margin },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
  }

  if (action === 'update_config') {
    // N1 FIX: requireAdmin — muta RouterConfig globale
    const auth = await requireAdmin(req)
    if (!auth.ok) return auth.response

    const updates = body
    delete updates.action
    const config = await updateConfig(updates)
    await publishAgentEvent({
      agentId: 'router', phase: '14',
      event: 'config_updated',
      level: 'info',
      payload: { ...updates, updatedBy: auth.email },
    })
    // N1: audit log
    await db.agentLog.create({
      data: {
        agentId: 'router', phase: '14', event: 'config_updated',
        payload: JSON.stringify({ ...updates, updatedBy: auth.email }),
        level: 'info',
      },
    }).catch(() => {})
    return NextResponse.json({ ok: true, config })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
