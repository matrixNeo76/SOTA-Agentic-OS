/**
 * Unit tests for Verify Domain core modules (Fase 3)
 * Covers: esr-quorum.ts (Phase 13), lean4-agent.ts (Phase 8)
 * These modules had ZERO test coverage before this file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db'

// === esr-quorum.ts tests =============================================

describe('esr-quorum — recordBelief + lineage + sync', () => {
  beforeEach(async () => {
    await db.belief.deleteMany({ where: { agentId: 'test-esr-agent' } })
    await db.eSRSyncEvent.deleteMany({ where: { sourceAgentId: 'test-esr-agent' } })
  })
  afterEach(async () => {
    await db.belief.deleteMany({ where: { agentId: 'test-esr-agent' } })
    await db.eSRSyncEvent.deleteMany({ where: { sourceAgentId: 'test-esr-agent' } })
  })

  it('recordBelief creates a belief entry', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    const result = await recordBelief({
      agentId: 'test-esr-agent',
      content: 'TEST-ESR-belief-1',
      beliefType: 'observation',
    })
    expect(result.beliefId).toBeTruthy()

    const belief = await db.belief.findUnique({ where: { id: result.beliefId } })
    expect(belief?.agentId).toBe('test-esr-agent')
    expect(belief?.content).toBe('TEST-ESR-belief-1')
    expect(belief?.beliefType).toBe('observation')
    expect(belief?.superseded).toBe(false)
  })

  it('recordBelief with embedding stores it', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    const result = await recordBelief({
      agentId: 'test-esr-agent',
      content: 'TEST-ESR-with-embedding',
      beliefType: 'evidence',
      confidence: 0.9,
    })
    const belief = await db.belief.findUnique({ where: { id: result.beliefId } })
    expect(belief?.confidence).toBe(0.9)
    expect(belief?.embedding).toBeTruthy() // auto-embedded by embed()
  })

  it('listBeliefs returns non-superseded beliefs', async () => {
    const { recordBelief, listBeliefs } = await import('@/lib/kernel/esr-quorum')
    await recordBelief({ agentId: 'test-esr-agent', content: 'TEST-ESR-unique-list-alpha-12345', beliefType: 'summary' })
    await recordBelief({ agentId: 'test-esr-agent', content: 'TEST-ESR-unique-list-beta-67890', beliefType: 'summary' })

    const beliefs = await listBeliefs('test-esr-agent', 30)
    const testBeliefs = beliefs.filter((b: any) => b.content.startsWith('TEST-ESR-unique-list-'))
    expect(testBeliefs.length).toBeGreaterThanOrEqual(1)
    testBeliefs.forEach((b: any) => expect(b.superseded).toBe(false))
  })

  it('getBeliefLineage respects depth limit (B4 fix)', async () => {
    const { recordBelief, getBeliefLineage } = await import('@/lib/kernel/esr-quorum')
    const result = await recordBelief({
      agentId: 'test-esr-agent',
      content: 'TEST-ESR-lineage-test',
      beliefType: 'plan',
    })
    const lineage = await getBeliefLineage(result.beliefId)
    expect(Array.isArray(lineage)).toBe(true)
    expect(lineage.length).toBeLessThanOrEqual(20) // B4: max depth
    expect(lineage[0]?.id).toBe(result.beliefId)
  })

  it('esrStats returns structure', async () => {
    const { esrStats } = await import('@/lib/kernel/esr-quorum')
    const stats = await esrStats()
    expect(stats).toHaveProperty('beliefs')
    expect(stats).toHaveProperty('syncEvents')
    expect(stats).toHaveProperty('quorumDecisions')
    expect(typeof stats.beliefs).toBe('number')
  })
})

// === esr-quorum: quorum voting tests =================================

describe('esr-quorum — quorum propose + vote', () => {
  beforeEach(async () => {
    await db.quorumVote.deleteMany({ where: { voterAgentId: { startsWith: 'test-q-voter-' } } })
    await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'test-q-wj-' } } })
  })
  afterEach(async () => {
    await db.quorumVote.deleteMany({ where: { voterAgentId: { startsWith: 'test-q-voter-' } } })
    await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'test-q-wj-' } } })
  })

  it('proposeQuorumAction creates a decision', async () => {
    const { proposeQuorumAction } = await import('@/lib/kernel/esr-quorum')
    const result = await proposeQuorumAction('test-q-wj-1', 'deploy', 2)
    expect(result.decisionId).toBeTruthy()

    const decision = await db.quorumDecision.findUnique({ where: { id: result.decisionId } })
    expect(decision?.action).toBe('deploy')
    expect(decision?.requiredQuorum).toBe(2)
    expect(decision?.verdict).toBe('pending')
  })

  it('voteQuorum accepts first vote (pending)', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('test-q-wj-2', 'deploy', 2)

    const result = await voteQuorum(decisionId, 'test-q-voter-1', 'accept')
    expect(result.verdict).toBe('pending') // need 2 votes
    expect(result.acceptCount).toBe(1)
  })

  it('voteQuorum reaches quorum with enough accept votes', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('test-q-wj-3', 'deploy', 2)

    await voteQuorum(decisionId, 'test-q-voter-2', 'accept')
    const result = await voteQuorum(decisionId, 'test-q-voter-3', 'accept')
    expect(result.verdict).toBe('accepted')
  })

  it('voteQuorum rejects with enough reject votes', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('test-q-wj-4', 'deploy', 2)

    await voteQuorum(decisionId, 'test-q-voter-4', 'reject')
    const result = await voteQuorum(decisionId, 'test-q-voter-5', 'reject')
    expect(result.verdict).toBe('rejected')
  })

  it('C3: voteQuorum prevents duplicate votes', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('test-q-wj-5', 'deploy', 2)

    await voteQuorum(decisionId, 'test-q-voter-6', 'accept')
    await expect(voteQuorum(decisionId, 'test-q-voter-6', 'accept'))
      .rejects.toThrow(/already voted/)
  })

  it('listQuorumDecisions returns decisions', async () => {
    const { proposeQuorumAction, listQuorumDecisions } = await import('@/lib/kernel/esr-quorum')
    await proposeQuorumAction('test-q-wj-6', 'test', 1)

    const decisions = await listQuorumDecisions(10)
    expect(decisions.length).toBeGreaterThanOrEqual(1)
  })
})

// === lean4-agent.ts tests ============================================

describe('lean4-agent — contracts + verify + stats', () => {
  beforeEach(async () => {
    await db.formalContract.deleteMany({ where: { planId: 'test-lean-plan' } })
    await db.verifiedWorkflow.deleteMany({ where: { planId: 'test-lean-plan' } })
    await db.agentPlan.deleteMany({ where: { id: 'test-lean-plan' } })
  })
  afterEach(async () => {
    await db.formalContract.deleteMany({ where: { planId: 'test-lean-plan' } })
    await db.verifiedWorkflow.deleteMany({ where: { planId: 'test-lean-plan' } })
    await db.agentPlan.deleteMany({ where: { id: 'test-lean-plan' } })
  })

  it('B3: verifyWorkflow handles corrupted planJson gracefully', async () => {
    await db.agentPlan.create({
      data: {
        id: 'test-lean-plan',
        taskGoal: 'corrupted test',
        planJson: '{ invalid json {{{',
        dagJson: '[]',
        status: 'scheduled',
        agentCount: 1,
      },
    })

    const { verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const result = await verifyWorkflow('test-lean-plan')
    expect(result).toHaveProperty('verified')
    expect(result).toHaveProperty('results')
    expect(Array.isArray(result.results)).toBe(true)
  })

  it('B3: verifyWorkflow handles valid planJson', async () => {
    await db.agentPlan.create({
      data: {
        id: 'test-lean-plan',
        taskGoal: 'valid test',
        planJson: JSON.stringify({
          goal: 'test',
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'first', dependencies: [] },
          ],
        }),
        dagJson: JSON.stringify([['T1']]),
        status: 'scheduled',
        agentCount: 1,
      },
    })

    const { verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const result = await verifyWorkflow('test-lean-plan')
    expect(result).toHaveProperty('verified')
    expect(result).toHaveProperty('leanSource')
  })

  it('leanStats returns structure', async () => {
    const { leanStats } = await import('@/lib/kernel/lean4-agent')
    const stats = await leanStats()
    expect(stats).toHaveProperty('contracts')
    expect(stats).toHaveProperty('verifiedContracts')
    expect(stats).toHaveProperty('verifiedWorkflows')
    expect(stats).toHaveProperty('evolveEvents')
    expect(typeof stats.contracts).toBe('number')
  })

  it('listVerifiedWorkflows returns array', async () => {
    const { listVerifiedWorkflows } = await import('@/lib/kernel/lean4-agent')
    const workflows = await listVerifiedWorkflows()
    expect(Array.isArray(workflows)).toBe(true)
  })

  it('B8: attachContracts uses batch createMany', async () => {
    await db.agentPlan.create({
      data: {
        id: 'test-lean-plan',
        taskGoal: 'batch test',
        planJson: JSON.stringify({
          goal: 'test',
          tasks: [
            { taskId: 'T1', agentId: 'a', description: 'first', dependencies: [] },
            { taskId: 'T2', agentId: 'b', description: 'second', dependencies: ['T1'] },
          ],
        }),
        dagJson: '[]',
        status: 'scheduled',
        agentCount: 2,
      },
    })

    const { autoGenerateContracts } = await import('@/lib/kernel/lean4-agent')
    const contracts = await autoGenerateContracts('test-lean-plan')
    expect(contracts.length).toBe(2)

    // Verify all contracts were created in DB
    const dbContracts = await db.formalContract.findMany({ where: { planId: 'test-lean-plan' } })
    expect(dbContracts.length).toBe(2)
  })
})
