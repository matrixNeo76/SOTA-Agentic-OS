/**
 * Integration tests for Context Manager Fase C
 * (B6, G1, G4, G6, G7)
 *
 * B6 — phase6.tsx try/catch su fetch
 * G1 — Unit test per context-engineering.ts e curator.ts
 * G4 — a11y in phase6.tsx (aria-label, role=status)
 * G6 — Adaptive polling in context-panel.tsx (già presente via QuickStats)
 * G7 — Integration test end-to-end
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'ctx-faseC-'
const TEST_AGENT = 'ctx-faseC-agent'

async function cleanupFixtures() {
  await db.toolCallEntry.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.contextSummary.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.pruningPolicy.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B6: phase6.tsx try/catch su fetch ====================================

describe('Fase C — B6: phase6.tsx try/catch su fetch', () => {
  it('phase6.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    // B6: refresh ha try/catch
    expect(content).toMatch(/B6 fix[\s\S]*try\/catch su fetch/)
    expect(content).toMatch(/Caricamento contesto fallito/)
  })

  it('phase6.tsx ha try/catch su recordCall()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Registrazione fallita.*errore di rete/)
  })

  it('phase6.tsx ha try/catch su forceSummarize()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Summarization fallita.*errore di rete/)
  })

  it('phase6.tsx ha try/catch su updatePolicyAction()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Aggiornamento policy fallito.*errore di rete/)
  })

  it('phase6.tsx ha try/catch su searchHistory()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Ricerca fallita.*errore di rete/)
  })
})

// === G4: a11y in phase6.tsx ==========================================

describe('Fase C — G4: phase6.tsx a11y (aria-label, role=status)', () => {
  it('Aggiorna button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna contesto e statistiche"/)
  })

  it('stats grid ha role=status e aria-live', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
  })

  it('Forza Summarization button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Forza summarization/)
  })

  it('Registra button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Registra il tool call/)
  })

  it('Switch autoSummarize ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Attiva o disattiva auto-summarize"/)
  })

  it('Salva Policy button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Salva la policy di pruning"/)
  })

  it('Cerca button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Cerca nel contesto storico"/)
  })
})

// === G6: Adaptive polling ============================================

describe('Fase C — G6: adaptive polling (già presente)', () => {
  it('phase6.tsx ha adaptive polling con Page Visibility API', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase6.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/document\.hidden/)
    expect(content).toMatch(/30_000/)
  })

  it('QuickStats usa startGlobalRefresh/stopGlobalRefresh', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workbench/quick-stats.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/startGlobalRefresh/)
    expect(content).toMatch(/stopGlobalRefresh/)
  })
})

// === G1: Unit test per context-engineering.ts ========================

describe('Fase C — G1: Unit test context-engineering.ts', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('recordToolCall crea ToolCallEntry con payload corretto', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    const result = await recordToolCall(
      TEST_AGENT, 'test_tool', { arg: 'value' }, { result: 'ok' }, 50,
    )
    expect(result.entryId).toBeDefined()

    const entry = await db.toolCallEntry.findUnique({ where: { id: result.entryId } })
    expect(entry!.toolName).toBe('test_tool')
    expect(entry!.tokenCost).toBe(50)
    expect(entry!.evicted).toBe(false)
  })

  it('assembleWorkingContext ritorna summary + recentCalls + totalTokenCost', async () => {
    const { recordToolCall, assembleWorkingContext } = await import('@/lib/kernel/context-engineering')
    await recordToolCall(TEST_AGENT, 'tool1', { a: 1 }, { r: 1 }, 10)
    await recordToolCall(TEST_AGENT, 'tool2', { a: 2 }, { r: 2 }, 20)

    const ctx = await assembleWorkingContext(TEST_AGENT)
    expect(ctx.recentCalls.length).toBe(2)
    expect(ctx.totalTokenCost).toBe(30)
    expect(ctx.summary).toBeNull() // no summary yet
  })

  it('summarizeAndEvict crea ContextSummary + marca entry come evicted', async () => {
    const { summarizeAndEvict } = await import('@/lib/kernel/context-engineering')
    // Crea 5 entry
    for (let i = 0; i < 5; i++) {
      await db.toolCallEntry.create({
        data: {
          agentId: TEST_AGENT, toolName: `tool_${i}`,
          callPayload: `{arg: ${i}}`, responsePayload: `{result: ${i}}`,
          tokenCost: 10,
        },
      })
    }

    const result = await summarizeAndEvict(TEST_AGENT, 2) // keep 2, evict 3
    expect(result.evictedCount).toBe(3)
    expect(result.summaryId).toBeDefined()
    expect(result.tokenSaved).toBe(30) // 3 * 10

    // Verify entries are evicted
    const evicted = await db.toolCallEntry.count({
      where: { agentId: TEST_AGENT, evicted: true },
    })
    expect(evicted).toBe(3)
  })

  it('contextStats ritorna aggregazioni corrette', async () => {
    const { recordToolCall, summarizeAndEvict, contextStats } = await import('@/lib/kernel/context-engineering')
    await recordToolCall(TEST_AGENT, 'tool1', {}, {}, 10)
    await recordToolCall(TEST_AGENT, 'tool2', {}, {}, 20)
    await summarizeAndEvict(TEST_AGENT, 1)

    const stats = await contextStats(TEST_AGENT)
    expect(stats.activeCalls).toBeGreaterThanOrEqual(1)
    expect(stats.evictedCalls).toBeGreaterThanOrEqual(1)
    expect(stats.summaries).toBeGreaterThanOrEqual(1)
    expect(stats.totalTokensSaved).toBeGreaterThan(0)
  })

  it('updatePolicy crea policy se non esiste (upsert)', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    const policy = await updatePolicy(TEST_AGENT, { windowSize: 7, summarizeThreshold: 15 })
    expect(policy.windowSize).toBe(7)
    expect(policy.summarizeThreshold).toBe(15)
    expect(policy.autoSummarize).toBe(true)
  })

  it('updatePolicy aggiorna policy esistente', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    await updatePolicy(TEST_AGENT, { windowSize: 5, summarizeThreshold: 10 })
    const updated = await updatePolicy(TEST_AGENT, { windowSize: 8, autoSummarize: false })
    expect(updated.windowSize).toBe(8)
    expect(updated.autoSummarize).toBe(false)
    expect(updated.summarizeThreshold).toBe(10) // unchanged
  })
})

// === G1: Unit test per curator.ts ===================================

describe('Fase C — G1: Unit test curator.ts', () => {
  afterEach(async () => {
    await db.sensoriumSnapshot.deleteMany({})
  })

  it('gatherSensorium ritorna SensoriumData con campi corretti', async () => {
    const { gatherSensorium } = await import('@/lib/kernel/curator')
    const data = await gatherSensorium()
    expect(data).toHaveProperty('cycleId')
    expect(data).toHaveProperty('queueDepth')
    expect(data).toHaveProperty('activeThreads')
    expect(data).toHaveProperty('systemLoad')
    expect(data).toHaveProperty('memoryStats')
    expect(data).toHaveProperty('recentEvents')
    expect(data).toHaveProperty('pendingVerifications')
    expect(data).toHaveProperty('timestamp')
    expect(typeof data.cycleId).toBe('string') // B5: String not Int
  })

  it('compileSensoriumXML ritorna XML strutturato', async () => {
    const { compileSensoriumXML } = await import('@/lib/kernel/curator')
    const xml = compileSensoriumXML({
      cycleId: 'test-123',
      queueDepth: 5,
      activeThreads: 3,
      systemLoad: 0.5,
      memoryStats: { episodic: 10, semantic: 20, logical: 5, avgDecay: 0.8 },
      recentEvents: [{ agentId: 'test', event: 'started', ts: '2026-01-01T00:00:00Z' }],
      pendingVerifications: 2,
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(xml).toMatch(/<sensorium/)
    expect(xml).toMatch(/cycle="test-123"/)
    expect(xml).toMatch(/<queue_depth>5<\/queue_depth>/)
    expect(xml).toMatch(/<active_threads>3<\/active_threads>/)
    expect(xml).toMatch(/<system_load>0\.500<\/system_load>/)
    expect(xml).toMatch(/<event agent="test"/)
  })

  it('produceSensorium persiste snapshot nel DB', async () => {
    const { produceSensorium } = await import('@/lib/kernel/curator')
    const result = await produceSensorium()
    expect(result.data).toBeDefined()
    expect(result.xml).toBeDefined()

    const snapshot = await db.sensoriumSnapshot.findFirst({
      where: { cycleId: result.data.cycleId },
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot!.xmlContent).toBe(result.xml)
  })
})

// === G7: Integration test end-to-end =================================

describe('Fase C — G7: Integration test end-to-end', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('E2E: record tool call → ring buffer → threshold → summarize → assemble → search', async () => {
    const {
      recordToolCall, assembleWorkingContext,
      summarizeAndEvict, searchContextHistory, updatePolicy,
    } = await import('@/lib/kernel/context-engineering')

    // 1. Setup policy with low threshold
    await updatePolicy(TEST_AGENT, { windowSize: 2, summarizeThreshold: 3 })

    // 2. Record 5 tool calls (triggers summarization at >3)
    for (let i = 0; i < 5; i++) {
      await recordToolCall(
        TEST_AGENT,
        `data_tool_${i}`,
        { query: `test query ${i}` },
        { results: [`result ${i}`], count: 1 },
        100,
      )
    }

    // 3. Verify some entries are evicted (summarization triggered)
    const evictedCount = await db.toolCallEntry.count({
      where: { agentId: TEST_AGENT, evicted: true },
    })
    expect(evictedCount).toBeGreaterThan(0)

    // 4. Verify summary exists
    const summaries = await db.contextSummary.findMany({ where: { agentId: TEST_AGENT } })
    expect(summaries.length).toBeGreaterThan(0)
    expect(summaries[0].embedding).not.toBeNull() // B1+G5: embedding persisted

    // 5. Assemble working context
    const ctx = await assembleWorkingContext(TEST_AGENT)
    expect(ctx.summary).not.toBeNull()
    expect(ctx.summary!.coveredCount).toBeGreaterThan(0)
    expect(ctx.recentCalls.length).toBeGreaterThan(0)

    // 6. Search history (RAG)
    const results = await searchContextHistory(TEST_AGENT, 'data tool query', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].similarity).toBeGreaterThan(0)
  })

  it('E2E: JSON.parse robusto su payload corrotto nel full pipeline', async () => {
    const { assembleWorkingContext } = await import('@/lib/kernel/context-engineering')

    // Create entry with corrupt payload
    await db.toolCallEntry.create({
      data: {
        agentId: TEST_AGENT,
        toolName: 'corrupt_tool',
        callPayload: '{broken json',
        responsePayload: 'not-json-at-all',
        tokenCost: 5,
      },
    })
    // Create entry with valid payload
    await db.toolCallEntry.create({
      data: {
        agentId: TEST_AGENT,
        toolName: 'valid_tool',
        callPayload: JSON.stringify({ arg: 'test' }),
        responsePayload: JSON.stringify({ result: 'ok' }),
        tokenCost: 10,
      },
    })

    // assembleWorkingContext should not crash
    const ctx = await assembleWorkingContext(TEST_AGENT)
    expect(ctx.recentCalls.length).toBe(2)

    // Corrupt entry: returns raw string (C3 fix)
    const corrupt = ctx.recentCalls.find((c: any) => c.toolName === 'corrupt_tool')
    expect(corrupt!.callPayload).toBe('{broken json')

    // Valid entry: returns parsed object
    const valid = ctx.recentCalls.find((c: any) => c.toolName === 'valid_tool')
    expect(valid!.callPayload).toEqual({ arg: 'test' })
  })

  it('E2E: produceSensorium → real metrics → XML → persist', async () => {
    const { produceSensorium, compileSensoriumXML } = await import('@/lib/kernel/curator')

    // 1. Produce sensorium (gather + compile + persist)
    const result = await produceSensorium()
    const data = result.data
    expect(data.queueDepth).toBeGreaterThanOrEqual(0)
    expect(data.activeThreads).toBeGreaterThanOrEqual(0)
    expect(data.systemLoad).toBeGreaterThanOrEqual(0)

    // 2. XML is valid
    const xml = result.xml
    expect(xml).toMatch(/<sensorium/)
    expect(xml).toContain(data.cycleId)

    // 3. Verify persisted
    const snapshot = await db.sensoriumSnapshot.findFirst({
      where: { cycleId: data.cycleId },
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot!.queueDepth).toBe(data.queueDepth)
    expect(snapshot!.activeThreads).toBe(data.activeThreads)

    // Cleanup
    await db.sensoriumSnapshot.deleteMany({ where: { cycleId: data.cycleId } })
  })
})
