/**
 * Unit tests for Learn Domain core modules (Fase 3)
 * Covers: time-router.ts (Phase 14), affect-subsystem.ts (Phase 11), agent-objective.ts (Phase 12)
 * These modules had ZERO test coverage before this file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db'

// === time-router.ts tests ============================================

describe('time-router — extractFeatures + routerStats', () => {
  it('extractFeatures returns structure with correct fields', async () => {
    const { extractFeatures } = await import('@/lib/kernel/time-router')
    const features = extractFeatures('Write a function to sort an array of objects by key')
    expect(features).toHaveProperty('length')
    expect(features).toHaveProperty('complexity')
    expect(features).toHaveProperty('domain')
    expect(typeof features.length).toBe('number')
    expect(typeof features.complexity).toBe('number')
  })

  it('extractFeatures handles empty prompt', async () => {
    const { extractFeatures } = await import('@/lib/kernel/time-router')
    const features = extractFeatures('')
    expect(features.length).toBe(0)
  })

  it('routerStats returns structure', async () => {
    const { routerStats } = await import('@/lib/kernel/time-router')
    const stats = await routerStats()
    expect(stats).toHaveProperty('decisions')
    expect(typeof stats.decisions).toBe('number')
  })

  it('DEFAULT_MODELS has at least 2 models', async () => {
    const { DEFAULT_MODELS } = await import('@/lib/kernel/time-router')
    expect(DEFAULT_MODELS.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_MODELS[0]).toHaveProperty('modelId')
  })

  it('listRoutingDecisions returns array', async () => {
    const { listRoutingDecisions } = await import('@/lib/kernel/time-router')
    const decisions = await listRoutingDecisions(10)
    expect(Array.isArray(decisions)).toBe(true)
  })
})

// === affect-subsystem.ts tests =======================================

describe('affect-subsystem — computeAffect + stats', () => {
  beforeEach(async () => {
    await db.affectSample.deleteMany({ where: { agentId: 'test-affect-core-agent' } })
    await db.affectThreshold.deleteMany({ where: { agentId: 'test-affect-core-agent' } })
  })
  afterEach(async () => {
    await db.affectSample.deleteMany({ where: { agentId: 'test-affect-core-agent' } })
    await db.affectThreshold.deleteMany({ where: { agentId: 'test-affect-core-agent' } })
  })

  it('computeAffect creates an AffectSample', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    const result = await computeAffect({
      agentId: 'test-affect-core-agent',
      toolFailures: 2,
      toolCalls: 10,
      gateRejects: 1,
      gateAttempts: 5,
      repeatedToolCalls: 3,
    })
    expect(result).toHaveProperty('desperation')
    expect(result).toHaveProperty('frustration')
    expect(result).toHaveProperty('cycleId')
    expect(typeof result.desperation).toBe('number')
    expect(result.desperation).toBeGreaterThanOrEqual(0)
    expect(result.desperation).toBeLessThanOrEqual(1)

    const samples = await db.affectSample.findMany({ where: { agentId: 'test-affect-core-agent' } })
    expect(samples.length).toBeGreaterThanOrEqual(1)
  })

  it('computeAffect with all-zero inputs returns low desperation', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    const result = await computeAffect({
      agentId: 'test-affect-core-agent',
      toolFailures: 0,
      toolCalls: 10,
      gateRejects: 0,
      gateAttempts: 5,
      repeatedToolCalls: 0,
    })
    expect(result.desperation).toBeLessThan(0.3) // should be low with no failures
  })

  it('computeAffect with high failures returns high desperation', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    const result = await computeAffect({
      agentId: 'test-affect-core-agent',
      toolFailures: 8,
      toolCalls: 10,
      gateRejects: 4,
      gateAttempts: 5,
      repeatedToolCalls: 5,
    })
    expect(result.desperation).toBeGreaterThan(0.3) // should be elevated
  })

  it('affectStats returns structure', async () => {
    const { affectStats } = await import('@/lib/kernel/affect-subsystem')
    const stats = await affectStats()
    expect(stats).toHaveProperty('samples')
    expect(stats).toHaveProperty('agents')
    expect(typeof stats.samples).toBe('number')
  })

  it('affectHistory returns samples for agent', async () => {
    const { computeAffect, affectHistory } = await import('@/lib/kernel/affect-subsystem')
    await computeAffect({
      agentId: 'test-affect-core-agent',
      toolFailures: 1, toolCalls: 5, gateRejects: 0, gateAttempts: 3, repeatedToolCalls: 0,
    })

    const history = await affectHistory('test-affect-core-agent', 10)
    expect(history.length).toBeGreaterThanOrEqual(1)
  })

  it('updateThreshold creates/updates threshold', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    await updateThreshold('test-affect-core-agent', { desperationCritical: 0.8 })
    const threshold = await db.affectThreshold.findUnique({ where: { agentId: 'test-affect-core-agent' } })
    expect(threshold?.desperationCritical).toBe(0.8)
  })

  it('N6: cycleId is unique across calls (DB-backed)', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    const r1 = await computeAffect({
      agentId: 'test-affect-core-agent',
      toolFailures: 0, toolCalls: 1, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0,
    })
    const r2 = await computeAffect({
      agentId: 'test-affect-core-agent',
      toolFailures: 0, toolCalls: 1, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0,
    })
    // cycleId should be different (DB count increments)
    expect(r1.cycleId).not.toBe(r2.cycleId)
  })
})

// === agent-objective.ts tests ========================================

describe('agent-objective — stats + listTrees', () => {
  it('objectiveStats returns structure', async () => {
    const { objectiveStats } = await import('@/lib/kernel/agent-objective')
    const stats = await objectiveStats()
    expect(stats).toHaveProperty('trees')
    expect(stats).toHaveProperty('nodes')
    expect(stats).toHaveProperty('completedTrees')
    expect(typeof stats.trees).toBe('number')
  })

  it('listTrees returns array', async () => {
    const { listTrees } = await import('@/lib/kernel/agent-objective')
    const trees = await listTrees()
    expect(Array.isArray(trees)).toBe(true)
  })
})
