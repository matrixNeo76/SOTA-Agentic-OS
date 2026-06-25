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
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'record_tool_call') {
    const { agentId, toolName, callPayload, responsePayload, tokenCost } = body
    const result = await recordToolCall(agentId, toolName, callPayload, responsePayload, tokenCost || 0)
    await publishAgentEvent({
      agentId, phase: '6',
      event: 'tool_call_recorded',
      payload: { toolName, evicted: result.evicted, summaryId: result.summaryId },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'update_policy') {
    const { agentId, windowSize, summarizeThreshold, autoSummarize } = body
    const policy = await updatePolicy(agentId, { windowSize, summarizeThreshold, autoSummarize })
    return NextResponse.json({ ok: true, policy })
  }

  if (action === 'summarize_now') {
    const { agentId, windowSize } = body
    const { summarizeAndEvict } = await import('@/lib/kernel/context-engineering')
    const result = await summarizeAndEvict(agentId, windowSize || 5)
    await publishAgentEvent({
      agentId, phase: '6',
      event: 'context_summarized',
      payload: { evictedCount: result.evictedCount, tokenSaved: result.tokenSaved },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
