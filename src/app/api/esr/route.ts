/**
 * API: /api/esr (Fase 13 - ESR + Quorum)
 *
 * C1 FIX: POST ora richiede requireAdmin (era requireAuth).
 * Tutte le 4 POST actions sono mutative e governance-sensitive:
 * record_belief, sync_belief, propose_quorum, vote_quorum.
 * C6 FIX: AgentLog writes su tutte le mutative actions.
 * C3+C4 FIX: delegate a esr-quorum.ts per duplicate vote prevention + atomic increment.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  recordBelief, getBeliefLineage, listBeliefs,
  syncBelief, listSyncEvents,
  proposeQuorumAction, voteQuorum, listQuorumDecisions, getQuorumVotes,
  esrStats,
} from '@/lib/kernel/esr-quorum'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
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
  // C1 FIX: requireAdmin instead of requireAuth
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'record_belief') {
    const { agentId, content, beliefType, lineageId, confidence } = body
    // C6: validate beliefType
    const VALID_TYPES = ['summary', 'evidence', 'plan', 'observation']
    if (beliefType && !VALID_TYPES.includes(beliefType)) {
      return NextResponse.json({ error: `beliefType must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
    }
    const result = await recordBelief({ agentId, content, beliefType, lineageId, confidence })
    await publishAgentEvent({
      agentId, phase: '13',
      event: 'belief_recorded',
      payload: { beliefId: result.beliefId, superseded: !!result.supersededId, triggeredBy: auth.email },
    })
    // C6: audit log
    await db.agentLog.create({
      data: {
        agentId, phase: '13', event: 'belief_recorded',
        payload: JSON.stringify({ beliefId: result.beliefId, beliefType, triggeredBy: auth.email }),
        level: 'info',
      },
    }).catch(() => {})
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'sync_belief') {
    const { sourceAgentId, targetAgentId, beliefId } = body
    const result = await syncBelief(sourceAgentId, targetAgentId, beliefId)
    await publishAgentEvent({
      agentId: sourceAgentId, phase: '13',
      event: 'esr_sync',
      level: result.syncStatus === 'conflict' ? 'warn' : 'info',
      payload: { targetAgentId, syncStatus: result.syncStatus, triggeredBy: auth.email },
    })
    // C6: audit log
    await db.agentLog.create({
      data: {
        agentId: sourceAgentId, phase: '13', event: 'esr_sync',
        payload: JSON.stringify({ targetAgentId, syncStatus: result.syncStatus, triggeredBy: auth.email }),
        level: result.syncStatus === 'conflict' ? 'warn' : 'info',
      },
    }).catch(() => {})
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'propose_quorum') {
    const { workflowJoinId, quorumAction, requiredQuorum } = body
    // C6: validate requiredQuorum
    const rq = typeof requiredQuorum === 'number' ? requiredQuorum : 2
    if (rq < 1 || rq > 10 || !Number.isInteger(rq)) {
      return NextResponse.json({ error: 'requiredQuorum must be an integer between 1 and 10' }, { status: 400 })
    }
    const result = await proposeQuorumAction(workflowJoinId, quorumAction || 'unspecified', rq)
    await publishAgentEvent({
      agentId: 'quorum', phase: '13',
      event: 'quorum_proposed',
      payload: { decisionId: result.decisionId, action: quorumAction, triggeredBy: auth.email },
    })
    // C6: audit log
    await db.agentLog.create({
      data: {
        agentId: 'quorum', phase: '13', event: 'quorum_proposed',
        payload: JSON.stringify({ decisionId: result.decisionId, action: quorumAction, requiredQuorum: rq, triggeredBy: auth.email }),
        level: 'warn',
      },
    }).catch(() => {})
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'vote_quorum') {
    const { decisionId, voterAgentId, vote, reason, confidence } = body
    // C6: validate vote
    const VALID_VOTES = ['accept', 'reject']
    if (!vote || !VALID_VOTES.includes(vote)) {
      return NextResponse.json({ error: `vote must be one of: ${VALID_VOTES.join(', ')}` }, { status: 400 })
    }
    try {
      const result = await voteQuorum(decisionId, voterAgentId, vote as 'accept' | 'reject', reason, confidence || 1.0)
      await publishAgentEvent({
        agentId: voterAgentId, phase: '13',
        event: 'quorum_vote',
        payload: { decisionId, vote, verdict: result.verdict, triggeredBy: auth.email },
      })
      // C6: audit log
      await db.agentLog.create({
        data: {
          agentId: voterAgentId, phase: '13', event: 'quorum_vote',
          payload: JSON.stringify({ decisionId, vote, verdict: result.verdict, triggeredBy: auth.email }),
          level: result.verdict !== 'pending' ? 'info' : 'info',
        },
      }).catch(() => {})
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      // C3: duplicate vote error
      if (e.message?.includes('already voted')) {
        return NextResponse.json({ ok: false, error: e.message, code: 'DUPLICATE_VOTE' }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
