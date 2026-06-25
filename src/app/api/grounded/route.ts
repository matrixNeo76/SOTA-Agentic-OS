/**
 * API: /api/grounded (Fase 10 - Grounded Inference)
 */
import { NextRequest, NextResponse } from 'next/server'
import { encapsulatedCall, updatePolicy, listSessions, groundingStats } from '@/lib/kernel/grounded-inference'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'

  if (action === 'sessions') {
    const agentId = searchParams.get('agentId') || undefined
    const sessions = await listSessions(agentId, 30)
    return NextResponse.json({ sessions })
  }

  if (action === 'stats') {
    const stats = await groundingStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'encapsulated_call') {
    const { agentId, taskGoal, contextData } = body
    const result = await encapsulatedCall({ agentId, taskGoal, contextData })
    await publishAgentEvent({
      agentId, phase: '10',
      event: 'encapsulated_call',
      level: result.status === 'sandbox_blocked' ? 'warn' : 'info',
      payload: { status: result.status, hasScript: !!result.parsedScript, sandboxOk: result.sandboxOk },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'update_policy') {
    const { agentId, ...updates } = body
    const policy = await updatePolicy(agentId, updates)
    return NextResponse.json({ ok: true, policy })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
