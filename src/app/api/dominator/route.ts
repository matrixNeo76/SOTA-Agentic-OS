/**
 * API: /api/dominator (Fase 7 - Dominator Trees)
 * GET  - tracce + PTA + stats
 * POST - cattura traccia / build PTA / valida traccia
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  captureTrace, buildPTA, validateTrace, getPTA,
  listTraces, dominatorStats,
} from '@/lib/kernel/dominator-tree'
import { publishAgentEvent } from '@/lib/ws-publish'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'

  if (action === 'pta') {
    const workflowId = searchParams.get('workflowId')
    if (!workflowId) return NextResponse.json({ error: 'workflowId required' }, { status: 400 })
    const pta = await getPTA(workflowId)
    return NextResponse.json({ pta })
  }

  if (action === 'traces') {
    const workflowId = searchParams.get('workflowId') || undefined
    const traces = await listTraces(workflowId)
    return NextResponse.json({ traces })
  }

  if (action === 'stats') {
    const stats = await dominatorStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'capture_trace') {
    const { workflowId, traceLabel, states, actions, outcome } = body
    const traceId = await captureTrace(workflowId, traceLabel, states, actions || [], outcome || 'success')
    await publishAgentEvent({
      agentId: 'dominator', phase: '7',
      event: 'trace_captured',
      payload: { workflowId, traceId, statesCount: states.length },
    })
    return NextResponse.json({ ok: true, traceId })
  }

  if (action === 'build_pta') {
    const { workflowId } = body
    try {
      const result = await buildPTA(workflowId)
      await publishAgentEvent({
        agentId: 'dominator', phase: '7',
        event: 'pta_built',
        payload: { workflowId, traceCount: result.traceCount, dominators: result.graph.dominators.length },
      })
      return NextResponse.json({
        ok: true,
        ptaId: result.ptaId,
        traceCount: result.traceCount,
        dominators: result.graph.dominators.length,
        nodeCount: Object.keys(result.graph.nodes).length,
      })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'validate_trace') {
    const { workflowId, states, threshold } = body
    const result = await validateTrace(workflowId, states, threshold || 0.7)
    await publishAgentEvent({
      agentId: 'dominator', phase: '7',
      event: 'trace_validated',
      level: result.verdict === 'reject' ? 'warn' : 'info',
      payload: { workflowId, verdict: result.verdict, coverage: result.dominatorCoverage },
    })
    return NextResponse.json(result)
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
