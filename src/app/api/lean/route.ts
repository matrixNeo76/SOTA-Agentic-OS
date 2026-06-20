/**
 * API: /api/lean (Fase 8 - Lean4Agent)
 * GET  - workflow verificati + eventi evolve + stats
 * POST - auto-genera contratti / verifica / evolve
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  autoGenerateContracts, verifyWorkflow, leanEvolve,
  listVerifiedWorkflows, listEvolveEvents, leanStats,
} from '@/lib/kernel/lean4-agent'
import { publishAgentEvent } from '@/lib/ws-publish'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'

  if (action === 'workflows') {
    const planId = searchParams.get('planId') || undefined
    const workflows = await listVerifiedWorkflows(planId)
    return NextResponse.json({ workflows })
  }

  if (action === 'evolve_events') {
    const planId = searchParams.get('planId') || undefined
    const events = await listEvolveEvents(planId)
    return NextResponse.json({ events })
  }

  if (action === 'stats') {
    const stats = await leanStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'auto_contracts') {
    const { planId } = body
    try {
      const contracts = await autoGenerateContracts(planId)
      await publishAgentEvent({
        agentId: 'lean', phase: '8',
        event: 'contracts_generated',
        payload: { planId, count: contracts.length },
      })
      return NextResponse.json({ ok: true, contracts, count: contracts.length })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'verify') {
    const { planId } = body
    try {
      const result = await verifyWorkflow(planId)
      await publishAgentEvent({
        agentId: 'lean', phase: '8',
        event: 'workflow_verified',
        level: result.verified ? 'info' : 'warn',
        payload: { planId, verified: result.verified, errors: result.results.reduce((s, r) => s + r.errors.length, 0) },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'evolve') {
    const { planId, failedTaskId, failureReason } = body
    try {
      const result = await leanEvolve(planId, failedTaskId, failureReason)
      await publishAgentEvent({
        agentId: 'lean', phase: '8',
        event: 'lean_evolve',
        level: result.revalidated ? 'info' : 'warn',
        payload: { planId, failedTaskId, cycle: result.cycle, revalidated: result.revalidated },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
