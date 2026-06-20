/**
 * API: /api/esr (Fase 13 - ESR + Quorum)
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  recordBelief, getBeliefLineage, listBeliefs,
  syncBelief, listSyncEvents,
  proposeQuorumAction, voteQuorum, listQuorumDecisions, getQuorumVotes,
  esrStats,
} from '@/lib/kernel/esr-quorum'
import { publishAgentEvent } from '@/lib/ws-publish'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'

  if (action === 'beliefs') {
    const agentId = searchParams.get('agentId') || undefined
    const beliefs = await listBeliefs(agentId, 30)
    return NextResponse.json({ beliefs })
  }

  if (action === 'lineage') {
    const beliefId = searchParams.get('beliefId')
    if (!beliefId) return NextResponse.json({ error: 'beliefId required' }, { status: 400 })
    const lineage = await getBeliefLineage(beliefId)
    return NextResponse.json({ lineage })
  }

  if (action === 'sync_events') {
    const events = await listSyncEvents(30)
    return NextResponse.json({ events })
  }

  if (action === 'quorum_decisions') {
    const decisions = await listQuorumDecisions(20)
    return NextResponse.json({ decisions })
  }

  if (action === 'quorum_votes') {
    const decisionId = searchParams.get('decisionId')
    if (!decisionId) return NextResponse.json({ error: 'decisionId required' }, { status: 400 })
    const votes = await getQuorumVotes(decisionId)
    return NextResponse.json({ votes })
  }

  if (action === 'stats') {
    const stats = await esrStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'record_belief') {
    const { agentId, content, beliefType, lineageId, confidence } = body
    const result = await recordBelief({ agentId, content, beliefType, lineageId, confidence })
    await publishAgentEvent({
      agentId, phase: '13',
      event: 'belief_recorded',
      payload: { beliefId: result.beliefId, superseded: !!result.supersededId },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'sync_belief') {
    const { sourceAgentId, targetAgentId, beliefId } = body
    const result = await syncBelief(sourceAgentId, targetAgentId, beliefId)
    await publishAgentEvent({
      agentId: sourceAgentId, phase: '13',
      event: 'esr_sync',
      level: result.syncStatus === 'conflict' ? 'warn' : 'info',
      payload: { targetAgentId, syncStatus: result.syncStatus },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'propose_quorum') {
    const { workflowJoinId, quorumAction, requiredQuorum } = body
    const result = await proposeQuorumAction(workflowJoinId, quorumAction || 'unspecified', requiredQuorum || 2)
    await publishAgentEvent({
      agentId: 'quorum', phase: '13',
      event: 'quorum_proposed',
      payload: { decisionId: result.decisionId, action: quorumAction },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'vote_quorum') {
    const { decisionId, voterAgentId, vote, reason, confidence } = body
    const result = await voteQuorum(decisionId, voterAgentId, vote, reason, confidence || 1.0)
    await publishAgentEvent({
      agentId: voterAgentId, phase: '13',
      event: 'quorum_vote',
      payload: { decisionId, vote, verdict: result.verdict },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
