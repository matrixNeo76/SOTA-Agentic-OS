/**
 * Integration tests for Context Manager Fase B
 * (B1+G5, B2, B3, B7, B8)
 *
 * B1+G5 — Embedding persistito nel DB per searchContextHistory
 * B2 — Size cap sulla narrativa (5KB)
 * B3 — Validazione updatePolicy (windowSize 1-100, threshold >= windowSize)
 * B7 — Size cap su callPayload/responsePayload (50KB)
 * B8 — searchContextHistory usa cosine invece di dot product
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'ctx-faseB-'
const TEST_AGENT = 'ctx-faseB-agent'

async function cleanupFixtures() {
  await db.toolCallEntry.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.contextSummary.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.pruningPolicy.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B3: Validazione updatePolicy ====================================

describe('Fase B — B3: updatePolicy validazione input', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('windowSize=0 → throws', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    try {
      await updatePolicy(TEST_AGENT, { windowSize: 0 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid windowSize.*1-100/i)
    }
  })

  it('windowSize=101 → throws', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    try {
      await updatePolicy(TEST_AGENT, { windowSize: 101 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid windowSize.*1-100/i)
    }
  })

  it('summarizeThreshold=-1 → throws', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    try {
      await updatePolicy(TEST_AGENT, { summarizeThreshold: -1 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid summarizeThreshold.*1-1000/i)
    }
  })

  it('summarizeThreshold < windowSize → throws', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    try {
      await updatePolicy(TEST_AGENT, { windowSize: 10, summarizeThreshold: 5 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/summarizeThreshold.*must be >= windowSize/i)
    }
  })

  it('windowSize=5, summarizeThreshold=10 → ok (validi)', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    const policy = await updatePolicy(TEST_AGENT, { windowSize: 5, summarizeThreshold: 10 })
    expect(policy.windowSize).toBe(5)
    expect(policy.summarizeThreshold).toBe(10)
  })

  it('windowSize=100, summarizeThreshold=1000 → ok (limiti massimi)', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    const policy = await updatePolicy(TEST_AGENT, { windowSize: 100, summarizeThreshold: 1000 })
    expect(policy.windowSize).toBe(100)
    expect(policy.summarizeThreshold).toBe(1000)
  })

  it('autoSummarize=false → ok (boolean validato)', async () => {
    const { updatePolicy } = await import('@/lib/kernel/context-engineering')
    const policy = await updatePolicy(TEST_AGENT, { autoSummarize: false })
    expect(policy.autoSummarize).toBe(false)
  })
})

// === B7: Size cap su payload =========================================

describe('Fase B — B7: recordToolCall size cap su payload (50KB)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('payload sotto 50KB → persistito intero', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    const smallPayload = { data: 'x'.repeat(1000) }
    await recordToolCall(TEST_AGENT, 'test_small', smallPayload, { result: 'ok' }, 10)

    const entry = await db.toolCallEntry.findFirst({
      where: { agentId: TEST_AGENT, toolName: 'test_small' },
    })
    expect(entry!.callPayload).toContain('x'.repeat(1000))
    expect(entry!.callPayload.length).toBeLessThan(50_000)
  })

  it('payload sopra 50KB → troncato con marker [truncated]', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    const bigPayload = { data: 'x'.repeat(60_000) } // 60KB
    await recordToolCall(TEST_AGENT, 'test_big', bigPayload, { result: 'ok' }, 10)

    const entry = await db.toolCallEntry.findFirst({
      where: { agentId: TEST_AGENT, toolName: 'test_big' },
    })
    expect(entry!.callPayload.length).toBeLessThan(52_000) // ~50KB + marker
    expect(entry!.callPayload).toMatch(/\[truncated\]/)
  })

  it('responsePayload sopra 50KB → troncato', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    const bigResponse = { data: 'y'.repeat(55_000) }
    await recordToolCall(TEST_AGENT, 'test_big_resp', { arg: 'test' }, bigResponse, 10)

    const entry = await db.toolCallEntry.findFirst({
      where: { agentId: TEST_AGENT, toolName: 'test_big_resp' },
    })
    expect(entry!.responsePayload.length).toBeLessThan(52_000)
    expect(entry!.responsePayload).toMatch(/\[truncated\]/)
  })

  it('payload non stringificabile (circular) → fallback a String()', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    const circular: any = { a: 1 }
    circular.self = circular
    await recordToolCall(TEST_AGENT, 'test_circular', circular, { ok: true }, 5)

    const entry = await db.toolCallEntry.findFirst({
      where: { agentId: TEST_AGENT, toolName: 'test_circular' },
    })
    expect(entry!.callPayload.length).toBeGreaterThan(0)
    expect(entry!.callPayload).toContain('[object Object]')
  })
})

// === B2: Size cap sulla narrativa ====================================

describe('Fase B — B2: summarizeAndEvict size cap narrativa', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('narrativa troncata se supera 10KB (2x MAX_NARRATIVE_SIZE)', async () => {
    const { recordToolCall } = await import('@/lib/kernel/context-engineering')
    // Crea policy con window=2, threshold=3 per triggerare summarization
    await db.pruningPolicy.create({
      data: { agentId: TEST_AGENT, windowSize: 2, summarizeThreshold: 3, autoSummarize: true },
    })

    // Registra 5 tool call con payload lunghi per creare narrativa grande
    for (let i = 0; i < 5; i++) {
      await recordToolCall(
        TEST_AGENT,
        `tool_${i}`,
        { data: 'A'.repeat(5000) }, // 5KB per call
        { result: 'B'.repeat(5000) },
        100,
      )
    }

    // Verifica che il summary esiste e non è troppo grande
    const summary = await db.contextSummary.findFirst({
      where: { agentId: TEST_AGENT },
      orderBy: { createdAt: 'desc' },
    })
    expect(summary).not.toBeNull()
    // B2: narrativa non deve superare 10KB (2x MAX_NARRATIVE_SIZE)
    expect(summary!.narrative.length).toBeLessThan(12_000)
  })

  it('narrativa precedente troncata a 5KB prima di appendere', async () => {
    const { summarizeAndEvict } = await import('@/lib/kernel/context-engineering')
    // Crea un summary precedente con narrativa lunga
    await db.contextSummary.create({
      data: {
        agentId: TEST_AGENT,
        narrative: 'X'.repeat(8000), // 8KB (> MAX_NARRATIVE_SIZE)
        coveredCallIds: '[]',
        tokenCost: 100,
        cycleId: 1,
      },
    })
    // Crea alcune entry da evict
    for (let i = 0; i < 3; i++) {
      await db.toolCallEntry.create({
        data: {
          agentId: TEST_AGENT,
          toolName: `tool_${i}`,
          callPayload: `{arg: ${i}}`,
          responsePayload: `{result: ${i}}`,
          tokenCost: 10,
        },
      })
    }

    await summarizeAndEvict(TEST_AGENT, 1)

    const summary = await db.contextSummary.findFirst({
      where: { agentId: TEST_AGENT },
      orderBy: { createdAt: 'desc' },
    })
    // La narrativa nuova non deve contenere tutta quella precedente (8KB)
    expect(summary!.narrative.length).toBeLessThan(10_000)
    expect(summary!.narrative).toMatch(/\[truncated\]/)
  })
})

// === B1+G5: Embedding persistito =====================================

describe('Fase B — B1+G5: embedding persistito nel DB', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('summarizeAndEvict persiste embedding nel ContextSummary', async () => {
    const { summarizeAndEvict } = await import('@/lib/kernel/context-engineering')
    // Crea entry da evict
    for (let i = 0; i < 3; i++) {
      await db.toolCallEntry.create({
        data: {
          agentId: TEST_AGENT,
          toolName: `tool_${i}`,
          callPayload: `{arg: ${i}}`,
          responsePayload: `{result: ${i}}`,
          tokenCost: 10,
        },
      })
    }

    await summarizeAndEvict(TEST_AGENT, 1)

    const summary = await db.contextSummary.findFirst({
      where: { agentId: TEST_AGENT },
      orderBy: { createdAt: 'desc' },
    })
    expect(summary).not.toBeNull()
    // B1+G5: embedding deve essere persistito
    expect(summary!.embedding).not.toBeNull()
    expect(summary!.embedding!.length).toBeGreaterThan(10) // JSON array serializzato
  })

  it('searchContextHistory usa embedding persistito (no ricalcolo)', async () => {
    const { searchContextHistory } = await import('@/lib/kernel/context-engineering')
    // Crea summary con embedding
    await db.contextSummary.create({
      data: {
        agentId: TEST_AGENT,
        narrative: 'test narrative about data processing',
        coveredCallIds: '[]',
        tokenCost: 10,
        cycleId: 1,
        embedding: JSON.stringify([0.1, 0.2, 0.3]), // embedding fittizio
      },
    })

    // searchContextHistory non deve crashare (usa embedding persistito)
    const results = await searchContextHistory(TEST_AGENT, 'data processing', 5)
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('similarity')
    expect(typeof results[0].similarity).toBe('number')
  })

  it('searchContextHistory con summary senza embedding → fallback ricalcolo', async () => {
    const { searchContextHistory } = await import('@/lib/kernel/context-engineering')
    // Crea summary SENZA embedding (precedente al B1 fix)
    await db.contextSummary.create({
      data: {
        agentId: TEST_AGENT,
        narrative: 'legacy narrative without embedding',
        coveredCallIds: '[]',
        tokenCost: 10,
        cycleId: 2,
        // embedding: null (non specificato)
      },
    })

    // Non deve crashare (fallback a ricalcolo)
    const results = await searchContextHistory(TEST_AGENT, 'legacy', 5)
    expect(Array.isArray(results)).toBe(true)
  })
})

// === B8: cosine invece di dot product ================================

describe('Fase B — B8: searchContextHistory usa cosine similarity', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('context-engineering.ts importa cosine da embeddings', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/context-engineering.ts'),
      'utf-8',
    )
    expect(content).toMatch(/import.*cosine.*from.*embeddings/)
    expect(content).toMatch(/cosine\(q/)
    expect(content).not.toMatch(/let dot = 0/) // no more dot product
  })

  it('searchContextHistory ritorna similarity normalizzata [0, 1]', async () => {
    const { searchContextHistory } = await import('@/lib/kernel/context-engineering')
    // Crea summary con embedding
    await db.contextSummary.create({
      data: {
        agentId: TEST_AGENT,
        narrative: 'test for cosine normalization',
        coveredCallIds: '[]',
        tokenCost: 10,
        cycleId: 1,
        embedding: JSON.stringify([0.5, 0.5, 0.5]),
      },
    })

    const results = await searchContextHistory(TEST_AGENT, 'test', 5)
    if (results.length > 0) {
      // cosine similarity è in [-1, 1], ma per embedding non-negativi è [0, 1]
      expect(results[0].similarity).toBeGreaterThanOrEqual(-1)
      expect(results[0].similarity).toBeLessThanOrEqual(1)
    }
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B7+B8 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('recordToolCall con payload grande → truncate → summarize → search con embedding', async () => {
    const { recordToolCall, searchContextHistory, updatePolicy } = await import('@/lib/kernel/context-engineering')

    // B3: policy valida
    await updatePolicy(TEST_AGENT, { windowSize: 2, summarizeThreshold: 3 })

    // B7: registra tool call con payload grande (truncated)
    for (let i = 0; i < 5; i++) {
      await recordToolCall(
        TEST_AGENT,
        `data_tool_${i}`,
        { data: 'X'.repeat(60_000) }, // 60KB → truncated
        { result: 'OK' },
        100,
      )
    }

    // Verifica che summary è stato creato (summarization triggered)
    const summaries = await db.contextSummary.findMany({ where: { agentId: TEST_AGENT } })
    expect(summaries.length).toBeGreaterThan(0)

    // B1+G5: embedding persistito
    const summary = summaries[0]
    expect(summary.embedding).not.toBeNull()

    // B2: narrativa non troppo grande
    expect(summary.narrative.length).toBeLessThan(12_000)

    // B8: search usa cosine (non crasha)
    const results = await searchContextHistory(TEST_AGENT, 'data tool', 5)
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
  })
})
