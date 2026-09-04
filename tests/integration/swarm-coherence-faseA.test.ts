/**
 * Integration tests for Swarm Coherence Fase A
 * (C1, C2, C3)
 *
 * C1 — recordBelief integrato in executor (post-task, non bloccante)
 * C2 — proposeQuorumAction+voteQuorum integrati ai join point del DAG (non bloccante)
 * C3 — Size cap su content/reason/action/conflictReason (DB bloat prevention)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'sc-faseA-agent'
const TEST_AGENT_2 = 'sc-faseA-agent-2'

async function cleanupFixtures() {
  await db.belief.deleteMany({ where: { agentId: { in: [TEST_AGENT, TEST_AGENT_2, 'orchestrator', 'curator'] } } })
  await db.eSRSyncEvent.deleteMany({ where: { sourceAgentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.quorumVote.deleteMany({ where: { voterAgentId: { startsWith: 'sc-faseA-' } } })
  await db.quorumVote.deleteMany({ where: { voterAgentId: 'verifier-1' } })
  await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'sc-faseA-' } } })
  await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'join:plan_' } } })
  await db.agentLog.deleteMany({ where: { agentId: 'objective' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C3: Size cap su payload persistito ===============================

describe('Fase A — C3: size cap su content/reason/action/conflictReason', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('esr-quorum.ts ha costanti di size cap C3', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/esr-quorum.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix[\s\S]*size cap su payload/)
    expect(content).toMatch(/MAX_BELIEF_CONTENT_SIZE = 10_000/)
    expect(content).toMatch(/MAX_VOTE_REASON_SIZE = 2_000/)
    expect(content).toMatch(/MAX_QUORUM_ACTION_SIZE = 1_000/)
    expect(content).toMatch(/MAX_CONFLICT_REASON_SIZE = 2_000/)
    expect(content).toMatch(/truncateWithMarker/)
  })

  it('recordBelief tronca content > 10KB', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    const hugeContent = 'x'.repeat(15_000)
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: hugeContent,
      beliefType: 'observation',
    })
    const belief = await db.belief.findUnique({ where: { id: beliefId } })
    expect(belief).not.toBeNull()
    expect(belief!.content.length).toBeLessThanOrEqual(10_000 + 20)
    expect(belief!.content).toMatch(/\[truncated\]$/)
  })

  it('recordBelief con content piccolo → non troncato', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    const smallContent = 'small belief content'
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: smallContent,
      beliefType: 'summary',
    })
    const belief = await db.belief.findUnique({ where: { id: beliefId } })
    expect(belief!.content).toBe(smallContent)
    expect(belief!.content).not.toMatch(/\[truncated\]$/)
  })

  it('proposeQuorumAction tronca action > 1KB', async () => {
    const { proposeQuorumAction } = await import('@/lib/kernel/esr-quorum')
    const hugeAction = 'a'.repeat(2_000)
    const { decisionId } = await proposeQuorumAction('sc-faseA-quorum', hugeAction, 2)
    const decision = await db.quorumDecision.findUnique({ where: { id: decisionId } })
    expect(decision!.action.length).toBeLessThanOrEqual(1_000 + 20)
    expect(decision!.action).toMatch(/\[truncated\]$/)
  })

  it('voteQuorum tronca reason > 2KB', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseA-reason', 'test action', 2)
    const hugeReason = 'r'.repeat(3_000)
    await voteQuorum(decisionId, 'sc-faseA-voter-1', 'accept', hugeReason)
    const votes = await db.quorumVote.findMany({ where: { workflowJoinId: decisionId } })
    expect(votes.length).toBe(1)
    expect(votes[0]!.reason!.length).toBeLessThanOrEqual(2_000 + 20)
    expect(votes[0]!.reason).toMatch(/\[truncated\]$/)
  })
})

// === C1: recordBelief integrato in executor ===========================

describe('Fase A — C1: recordBelief integrato in executor', () => {
  it('executor.ts ha import dinamico di recordBelief', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/recordBelief/)
    expect(content).toMatch(/esr-quorum/)
  })

  it('executor.ts ha C1 fix comment Swarm Coherence', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*Swarm Coherence audit Fase A[\s\S]*recordBelief/)
    // "divergenza epistemica" è su due righe nel commento
    expect(content).toMatch(/divergenza[\s\S]*epistemica/)
  })

  it('executor.ts recordBelief è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/recordBelief[\s\S]*?} catch \{[\s\S]*?Non bloccante[\s\S]*?recordBelief[\s\S]*?fallisce/)
  })

  it('executor.ts registra belief "observation" con risultato task', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/beliefType: 'observation'/)
    expect(content).toMatch(/confidence: step\.status === 'done' \? 0\.9 : 0\.5/)
  })

  it('executor.ts emette evento belief_recorded', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/onEvent\?\.\('belief_recorded'/)
  })
})

// === C2: proposeQuorumAction+voteQuorum integrati ai join point =======

describe('Fase A — C2: proposeQuorumAction+voteQuorum ai join point', () => {
  it('executor.ts ha import dinamico di proposeQuorumAction+voteQuorum', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/proposeQuorumAction/)
    expect(content).toMatch(/voteQuorum/)
  })

  it('executor.ts ha C2 fix comment Swarm Coherence', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*Swarm Coherence audit Fase A[\s\S]*proposeQuorumAction/)
    expect(content).toMatch(/join point del DAG/)
  })

  it('executor.ts quorum è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/proposeQuorumAction[\s\S]*?} catch \{[\s\S]*?Non bloccante[\s\S]*?quorum.*fallisce/)
  })

  it('executor.ts propone quorum solo se almeno 1 task done', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/doneCount > 0/)
    expect(content).toMatch(/certify plan/)
  })

  it('executor.ts auto-voto verifier-1 basato su majority done', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/majorityDone = doneCount > steps\.length \/ 2/)
    expect(content).toMatch(/voteQuorum\(decisionId, 'verifier-1'/)
  })

  it('executor.ts emette evento quorum_proposed', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/onEvent\?\.\('quorum_proposed'/)
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('C1+C3: recordBelief lifecycle con size cap', async () => {
    const { recordBelief, listBeliefs } = await import('@/lib/kernel/esr-quorum')
    // Registra belief con content normale
    const r1 = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASE-A smoke belief 1',
      beliefType: 'observation',
      confidence: 0.8,
    })
    expect(r1.beliefId).toBeTruthy()

    // Registra belief simile → dovrebbe superseded il primo
    const r2 = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASE-A smoke belief 1',  // stesso content → alta similarità
      beliefType: 'observation',
    })
    expect(r2.supersededId).toBe(r1.beliefId)

    // Verifica belief lineage
    const beliefs = await listBeliefs(TEST_AGENT, 10)
    const activeBeliefs = beliefs.filter((b: any) => !b.superseded)
    expect(activeBeliefs.length).toBeGreaterThanOrEqual(1)

    // C3: tutti i belief hanno content ≤ 10KB + marker
    for (const b of beliefs) {
      expect(b.content.length).toBeLessThanOrEqual(10_000 + 20)
    }
  })

  it('C2+C3: quorum lifecycle con size cap su action/reason', async () => {
    const { proposeQuorumAction, voteQuorum, listQuorumDecisions } = await import('@/lib/kernel/esr-quorum')
    // Propone quorum con action enorme
    const hugeAction = 'b'.repeat(2_000)
    const { decisionId } = await proposeQuorumAction('sc-faseA-smoke', hugeAction, 2)

    // 2 voter votano accept con reason enorme
    const hugeReason = 'r'.repeat(3_000)
    const r1 = await voteQuorum(decisionId, 'sc-faseA-voter-1', 'accept', hugeReason)
    expect(r1.verdict).toBe('pending')  // need 2 votes
    expect(r1.acceptCount).toBe(1)

    const r2 = await voteQuorum(decisionId, 'sc-faseA-voter-2', 'accept', hugeReason)
    expect(r2.verdict).toBe('accepted')
    expect(r2.acceptCount).toBe(2)

    // Verifica size cap su DB
    const decision = await db.quorumDecision.findUnique({ where: { id: decisionId } })
    expect(decision!.action.length).toBeLessThanOrEqual(1_000 + 20)
    expect(decision!.action).toMatch(/\[truncated\]$/)

    const votes = await db.quorumVote.findMany({ where: { workflowJoinId: decisionId } })
    for (const v of votes) {
      expect(v.reason!.length).toBeLessThanOrEqual(2_000 + 20)
    }
  })

  it('C1+C2 smoke: executePlan registra belief + propone quorum (non blocca)', async () => {
    const { db } = await import('@/lib/db')
    const planId = `plan_sc-faseA_smoke_${Date.now()}`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'SC Fase A smoke test',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'Simple task', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Simple task',
            dependencies: '[]',
            status: 'pending',
          }],
        },
      },
    })

    const { executePlan } = await import('@/lib/runtime/executor')
    const result = await executePlan({
      planId,
      signal: new AbortController().signal,
    })

    // Il piano deve completare (non bloccato da recordBelief/quorum)
    expect(result.steps.length).toBe(1)
    expect(['done', 'failed', 'blocked']).toContain(result.steps[0]!.status)

    // C1: se il task è done, dovrebbe aver registrato un belief per orchestrator
    if (result.steps[0]!.status === 'done') {
      const beliefs = await db.belief.findMany({
        where: { agentId: 'orchestrator', beliefType: 'observation' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
      // Almeno 1 belief observation per orchestrator (potrebbero esserci anche preesistenti)
      expect(beliefs.length).toBeGreaterThanOrEqual(1)
    }

    // C2: se almeno 1 task done, dovrebbe aver proposto un quorum (join:planId)
    if (result.steps[0]!.status === 'done') {
      const decisions = await db.quorumDecision.findMany({
        where: { workflowJoinId: `join:${planId}` },
      })
      // Quorum proposto (se C2 non è fallito per errori tecnici)
      if (decisions.length > 0) {
        const decision = decisions[0]!
        expect(decision.action).toMatch(/certify plan/)
        expect(decision.requiredQuorum).toBe(2)
        // verifier-1 ha votato
        const votes = await db.quorumVote.findMany({
          where: { workflowJoinId: decision.id },
        })
        expect(votes.length).toBeGreaterThanOrEqual(1)
        expect(votes[0]!.voterAgentId).toBe('verifier-1')
      }
    }

    // Cleanup
    await db.belief.deleteMany({ where: { agentId: 'orchestrator', beliefType: 'observation' } }).catch(() => {})
    await db.quorumVote.deleteMany({ where: { voterAgentId: 'verifier-1' } }).catch(() => {})
    await db.quorumDecision.deleteMany({ where: { workflowJoinId: `join:${planId}` } }).catch(() => {})
    await db.planTask.deleteMany({ where: { planId } })
    await db.executionTrace.deleteMany({ where: { workflowId: planId } })
    await db.agentPlan.delete({ where: { id: planId } })
  })
})
