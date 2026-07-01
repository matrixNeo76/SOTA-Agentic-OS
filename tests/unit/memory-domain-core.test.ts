/**
 * Unit tests for ns-mem.ts, context-engineering.ts, grounded-inference.ts
 * (Fase 3 — covering 3 core modules that had zero test coverage)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db'

// === ns-mem.ts tests =================================================

describe('ns-mem — recordEpisode + memoryStats', () => {
  beforeEach(async () => {
    await db.episodicMemory.deleteMany({ where: { agentId: 'test-nsmem-agent' } })
  })
  afterEach(async () => {
    await db.episodicMemory.deleteMany({ where: { agentId: 'test-nsmem-agent' } })
  })

  it('recordEpisode creates an episodic memory entry', async () => {
    const { recordEpisode } = await import('@/lib/kernel/ns-mem')
    await recordEpisode('TEST-NSMEM-observation-1', 'unit-test', 'test-nsmem-agent')

    const entries = await db.episodicMemory.findMany({ where: { agentId: 'test-nsmem-agent' } })
    expect(entries.length).toBe(1)
    expect(entries[0].observation).toBe('TEST-NSMEM-observation-1')
    expect(entries[0].source).toBe('unit-test')
    expect(entries[0].embedding).toBeTruthy() // auto-embedded
  })

  it('recordEpisode creates entries with different observations', async () => {
    const { recordEpisode, recentEpisodes } = await import('@/lib/kernel/ns-mem')
    await recordEpisode('first observation', 'test', 'test-nsmem-agent')
    await new Promise(r => setTimeout(r, 10))
    await recordEpisode('second observation', 'test', 'test-nsmem-agent')

    const episodes = await recentEpisodes(10)
    const testEpisodes = episodes.filter(e => e.agentId === 'test-nsmem-agent')
    expect(testEpisodes.length).toBeGreaterThanOrEqual(2)
    // Most recent first
    expect(testEpisodes[0].observation).toBe('second observation')
  })

  it('memoryStats returns counts', async () => {
    const { recordEpisode, memoryStats } = await import('@/lib/kernel/ns-mem')
    await recordEpisode('stats-test', 'test', 'test-nsmem-agent')

    const stats = await memoryStats()
    expect(stats).toHaveProperty('episodic')
    expect(stats).toHaveProperty('semantic')
    expect(stats).toHaveProperty('logical')
    expect(typeof stats.episodic).toBe('number')
    expect(stats.episodic).toBeGreaterThanOrEqual(1)
  })

  it('semanticSearch returns results sorted by similarity', async () => {
    const { semanticSearch } = await import('@/lib/kernel/ns-mem')
    const results = await semanticSearch('test query', 5)
    expect(Array.isArray(results)).toBe(true)
    // Results should be sorted by similarity descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity)
    }
  })
})

// === context-engineering.ts tests ====================================

describe('context-engineering — recordToolCall + contextStats', () => {
  beforeEach(async () => {
    await db.toolCallEntry.deleteMany({ where: { agentId: 'test-ctx-agent' } })
    await db.contextSummary.deleteMany({ where: { agentId: 'test-ctx-agent' } })
    await db.pruningPolicy.deleteMany({ where: { agentId: 'test-ctx-agent' } })
  })
  afterEach(async () => {
    await db.toolCallEntry.deleteMany({ where: { agentId: 'test-ctx-agent' } })
    await db.contextSummary.deleteMany({ where: { agentId: 'test-ctx-agent' } })
    await db.pruningPolicy.deleteMany({ where: { agentId: 'test-ctx-agent' } })
  })

  it('recordToolCall creates a ToolCallEntry', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    const result = await recordToolCall(
      'test-ctx-agent',
      'test-tool',
      { input: 'test' },
      { output: 'result' },
      50,
    )
    expect(result.entryId).toBeTruthy()

    const entry = await db.toolCallEntry.findUnique({ where: { id: result.entryId } })
    expect(entry?.toolName).toBe('test-tool')
    expect(entry?.tokenCost).toBe(50)
    expect(entry?.evicted).toBe(false)
  })

  it('contextStats returns structure with correct fields', async () => {
    const { contextStats } = await import('@/lib/kernel/context-engineering')
    const stats = await contextStats('test-ctx-agent')
    expect(stats).toHaveProperty('activeCalls')
    expect(stats).toHaveProperty('evictedCalls')
    expect(stats).toHaveProperty('summaries')
    expect(stats).toHaveProperty('totalTokensSaved')
    expect(typeof stats.activeCalls).toBe('number')
  })

  it('assembleWorkingContext returns recent tool calls', async () => {
    const { recordToolCall, assembleWorkingContext } = await import('@/lib/kernel/context-engineering')
    await recordToolCall(
      'test-ctx-agent',
      'search',
      { q: 'test' },
      { results: [] },
      100,
    )

    const ctx = await assembleWorkingContext('test-ctx-agent')
    expect(ctx).toHaveProperty('summary')
    expect(ctx).toHaveProperty('recentCalls')
    expect(ctx).toHaveProperty('totalTokenCost')
    expect(ctx.recentCalls.length).toBeGreaterThanOrEqual(1)
    expect(ctx.recentCalls[0].toolName).toBe('search')
  })

  it('searchContextHistory returns sorted results with normalized cosine', async () => {
    const { searchContextHistory } = await import('@/lib/kernel/context-engineering')
    const results = await searchContextHistory('test-ctx-agent', 'test query', 3)
    expect(Array.isArray(results)).toBe(true)
    // All similarity values should be in [-1, 1] range (normalized cosine, B4 fix)
    for (const r of results) {
      expect(r.similarity).toBeGreaterThanOrEqual(-1)
      expect(r.similarity).toBeLessThanOrEqual(1)
    }
  })
})

// === grounded-inference.ts tests =====================================

describe('grounded-inference — encapsulatedCall + stats', () => {
  beforeEach(async () => {
    await db.encapsulatedSession.deleteMany({ where: { agentId: 'test-grounded-agent' } })
    await db.encapsulationPolicy.deleteMany({ where: { agentId: 'test-grounded-agent' } })
  })
  afterEach(async () => {
    await db.encapsulatedSession.deleteMany({ where: { agentId: 'test-grounded-agent' } })
    await db.encapsulationPolicy.deleteMany({ where: { agentId: 'test-grounded-agent' } })
  })

  it('encapsulatedCall creates a session record', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    const result = await encapsulatedCall({
      agentId: 'test-grounded-agent',
      taskGoal: 'Parse JSON output',
      contextData: { data: '{"key": "value"}' },
    })
    expect(result.sessionId).toBeTruthy()
    expect(result.status).toBeTruthy()

    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    expect(session?.agentId).toBe('test-grounded-agent')
    expect(session?.taskGoal).toBe('Parse JSON output')
  })

  it('groundingStats returns structure', async () => {
    const { groundingStats } = await import('@/lib/kernel/grounded-inference')
    const stats = await groundingStats()
    expect(stats).toHaveProperty('sessions')
    expect(stats).toHaveProperty('executed')
    expect(stats).toHaveProperty('sandboxBlocked')
    expect(stats).toHaveProperty('policies')
    expect(typeof stats.sessions).toBe('number')
  })

  it('listSessions returns sessions for an agent', async () => {
    const { encapsulatedCall, listSessions } = await import('@/lib/kernel/grounded-inference')
    await encapsulatedCall({
      agentId: 'test-grounded-agent',
      taskGoal: 'test session',
      contextData: { test: true },
    })

    const sessions = await listSessions('test-grounded-agent', 10)
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    expect(sessions[0].agentId).toBe('test-grounded-agent')
  })

  it('sandbox does not leak process.env (C1 fix)', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    const result = await encapsulatedCall({
      agentId: 'test-grounded-agent',
      taskGoal: 'Parse input',
      contextData: { input: 'test' },
    })
    expect(result.sessionId).toBeTruthy()
    // If sandbox ran, sandboxResult should not contain process env data
    if (result.sandboxOk && result.sandboxResult) {
      const resultStr = JSON.stringify(result.sandboxResult)
      expect(resultStr).not.toContain('NODE_PATH')
      expect(resultStr).not.toContain('DATABASE_URL')
      expect(resultStr).not.toContain('ZAI_API_KEY')
    }
  })
})
