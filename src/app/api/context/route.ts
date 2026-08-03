/**
 * API: /api/context (Fase 6 - Context Engineering)
 * GET  - contesto di lavoro riassemblato + stats
 * POST - registra tool call / aggiorna policy / search history
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  recordToolCall, assembleWorkingContext, updatePolicy,
  contextStats, searchContextHistory,
} from '@/lib/kernel/context-engineering'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get('agentId') || 'default'
  const action = searchParams.get('action')

  if (action === 'assemble') {
    const ctx = await assembleWorkingContext(agentId)
    return NextResponse.json({ agentId, ...ctx })
  }

  if (action === 'stats') {
    const stats = await contextStats(searchParams.get('agentId') || undefined)
    return NextResponse.json(stats)
  }

  if (action === 'search') {
    const q = searchParams.get('q') || ''
    const results = await searchContextHistory(agentId, q, 5)
    return NextResponse.json({ results })
  }

  // default: assemble + stats
  const [ctx, stats] = await Promise.all([
    assembleWorkingContext(agentId),
    contextStats(),
  ])
  return NextResponse.json({ agentId, context: ctx, stats })
}

export async function POST(req: NextRequest) {
  // B4 fix: azioni mutative richiedono requireAdmin
  // PRIMA: requireAuth su tutto il POST → viewer poteva registrare tool call,
  // cambiare policy, forzare summarization.
  // ORA: requireAdmin per record_tool_call, update_policy, summarize_now.
  const admin = await requireAdmin(req)
  if (!admin.ok) return admin.response
  const actor = admin.email

  let body
  try {
    body = await req.json()
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body', detail: err.message }, { status: 400 })
  }
  const { action } = body

  if (action === 'record_tool_call') {
    const { agentId, toolName, callPayload, responsePayload, tokenCost } = body
    const result = await recordToolCall(agentId, toolName, callPayload, responsePayload, tokenCost || 0)
    await publishAgentEvent({
      agentId, phase: '6',
      event: 'tool_call_recorded',
      payload: { toolName, evicted: result.evicted, summaryId: result.summaryId, actor },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'update_policy') {
    const { agentId, windowSize, summarizeThreshold, autoSummarize } = body
    const policy = await updatePolicy(agentId, { windowSize, summarizeThreshold, autoSummarize })
    await publishAgentEvent({
      agentId, phase: '6',
      event: 'policy_updated',
      level: 'info',
      payload: { agentId, windowSize, summarizeThreshold, autoSummarize, actor },
    })
    return NextResponse.json({ ok: true, policy })
  }

  if (action === 'summarize_now') {
    const { agentId, windowSize } = body
    const { summarizeAndEvict } = await import('@/lib/kernel/context-engineering')
    const result = await summarizeAndEvict(agentId, windowSize || 5)
    await publishAgentEvent({
      agentId, phase: '6',
      event: 'context_summarized',
      payload: { evictedCount: result.evictedCount, tokenSaved: result.tokenSaved, actor },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
