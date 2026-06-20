/**
 * API: /api/router (Fase 14 - TimeRouter)
 */
import { NextRequest, NextResponse } from 'next/server'
import { route, updateConfig, listRoutingDecisions, routerStats, extractFeatures, DEFAULT_MODELS } from '@/lib/kernel/time-router'
import { publishAgentEvent } from '@/lib/ws-publish'

export async function GET(req: NextRequest) {
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
    const { agentId, prompt } = body
    const result = await route(agentId, prompt)
    await publishAgentEvent({
      agentId, phase: '14',
      event: 'routing_decision',
      level: result.routedTo === 'primary' ? 'info' : 'warn',
      payload: { primaryModel: result.primaryModel, routedTo: result.routedTo, confidence: result.confidence, margin: result.margin },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'update_config') {
    const updates = body
    delete updates.action
    const config = await updateConfig(updates)
    return NextResponse.json({ ok: true, config })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
