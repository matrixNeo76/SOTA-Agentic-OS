/**
 * API: /api/grounded (Fase 10 - Grounded Inference)
 *
 * C3 fix (Model Encapsulator audit Fase A): auth policy allineata con altre API mutative.
 * PRIMA: sia GET che POST usavano requireAuth → qualsiasi viewer autenticato poteva:
 *  - innescare LLM call (cost reale) via encapsulated_call
 *  - modificare EncapsulationPolicy via update_policy (es. disabilitare sandbox)
 * ORA:
 *  - GET (sessions/stats) richiede requireAuth (lettura)
 *  - POST (encapsulated_call/update_policy) richiede requireAdmin (mutative)
 *    perché:
 *    * encapsulated_call esegue LLM call + sandbox → potenziale RCE se N9 fallisce
 *    * update_policy modifica policy di sicurezza (sandboxEnabled, forbidDirectMutation)
 */
import { NextRequest, NextResponse } from 'next/server'
import { encapsulatedCall, updatePolicy, listSessions, groundingStats } from '@/lib/kernel/grounded-inference'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

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
  // C3 — POST mutative richiede requireAdmin (prima era requireAuth)
  const auth = await requireAdmin(req)
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
