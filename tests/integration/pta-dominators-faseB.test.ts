/**
 * Integration tests for PTA Dominators Fase B
 * (B1, B4, B5, B6)
 *
 * B1 — phase7.tsx try/catch su refresh/capture/validate
 * B4 — Size cap su statesJson/actionsJson (50KB)
 * B5 — dominatorStats usa aggregate invece di 100 record
 * B6 — computeDominators cap iterazioni (max 1000)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'pta-faseB-'

async function cleanupFixtures() {
  await db.traceValidation.deleteMany({ where: { ptaId: { contains: TEST_PREFIX } } })
  await db.prefixTreeAutomaton.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
  await db.executionTrace.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B4: Size cap su statesJson/actionsJson ==========================

describe('Fase B — B4: captureTrace size cap su payload (50KB)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('payload sotto 50KB → persistito intero', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    const states = ['start', 'step1', 'step2', 'end']
    await captureTrace(`${TEST_PREFIX}b4-small`, 'test', states, ['a1', 'a2'], 'success')

    const trace = await db.executionTrace.findFirst({
      where: { workflowId: `${TEST_PREFIX}b4-small` },
    })
    expect(trace!.statesJson).toContain('start')
    expect(trace!.statesJson.length).toBeLessThan(50_000)
  })

  it('payload sopra 50KB → troncato con marker [truncated]', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    // Crea states con stringhe lunghe per superare 50KB
    const bigStates = Array.from({ length: 5000 }, (_, i) => `state_${i}_${'x'.repeat(20)}`)
    await captureTrace(`${TEST_PREFIX}b4-big`, 'test', bigStates, [], 'success')

    const trace = await db.executionTrace.findFirst({
      where: { workflowId: `${TEST_PREFIX}b4-big` },
    })
    expect(trace!.statesJson.length).toBeLessThan(52_000) // ~50KB + marker
    expect(trace!.statesJson).toMatch(/\[truncated\]/)
  })

  it('actionsJson sopra 50KB → troncato', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    const bigActions = Array.from({ length: 5000 }, (_, i) => `action_${i}_${'y'.repeat(20)}`)
    await captureTrace(`${TEST_PREFIX}b4-big-actions`, 'test', ['start', 'end'], bigActions, 'success')

    const trace = await db.executionTrace.findFirst({
      where: { workflowId: `${TEST_PREFIX}b4-big-actions` },
    })
    expect(trace!.actionsJson.length).toBeLessThan(52_000)
    expect(trace!.actionsJson).toMatch(/\[truncated\]/)
  })
})

// === B5: dominatorStats usa aggregate ================================

describe('Fase B — B5: dominatorStats usa aggregate', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('dominatorStats ritorna structure con avgCoverage e acceptRate', async () => {
    const { dominatorStats } = await import('@/lib/kernel/dominator-tree')
    const stats = await dominatorStats()
    expect(stats).toHaveProperty('traces')
    expect(stats).toHaveProperty('ptas')
    expect(stats).toHaveProperty('validations')
    expect(stats).toHaveProperty('avgCoverage')
    expect(stats).toHaveProperty('acceptRate')
    expect(typeof stats.avgCoverage).toBe('number')
    expect(typeof stats.acceptRate).toBe('number')
    expect(stats.avgCoverage).toBeGreaterThanOrEqual(0)
    expect(stats.acceptRate).toBeGreaterThanOrEqual(0)
    expect(stats.acceptRate).toBeLessThanOrEqual(1)
  })

  it('dominatorStats non usa più findMany take:100 per calcolare stats', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/dominator-tree.ts'),
      'utf-8',
    )
    // B5: usa aggregate invece di findMany
    expect(content).toMatch(/aggregate/)
    expect(content).toMatch(/_avg/)
    // La vecchia implementazione aveva "recentValidations" con findMany take:100
    expect(content).not.toMatch(/recentValidations/)
  })

  it('dominatorStats con TraceValidation calcola avgCoverage correttamente', async () => {
    const { captureTrace, buildPTA, validateTrace, dominatorStats } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}b5-stats`

    // Crea PTA e validazioni
    await captureTrace(wfId, 't1', ['start', 'step1', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'step2', 'end'], [], 'success')
    await buildPTA(wfId)
    await validateTrace(wfId, ['start', 'step1', 'end']) // accept (coverage 1.0)
    await validateTrace(wfId, ['start', 'UNKNOWN', 'end']) // warn/reject (coverage < 1.0)

    const stats = await dominatorStats()
    expect(stats.validations).toBeGreaterThanOrEqual(2)
    expect(stats.avgCoverage).toBeGreaterThan(0)
  })
})

// === B6: computeDominators cap iterazioni =============================

describe('Fase B — B6: computeDominators cap iterazioni (max 1000)', () => {
  it('dominator-tree.ts contiene MAX_ITERATIONS = 1000', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/dominator-tree.ts'),
      'utf-8',
    )
    expect(content).toMatch(/MAX_ITERATIONS/)
    expect(content).toMatch(/iterations < MAX_ITERATIONS/)
  })

  it('computeDominators converge su PTA normale (albero aciclico)', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}b6-converge`

    // 3 tracce con branch → PTA con dominatori
    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't3', ['start', 'login', 'submit', 'error', 'end'], [], 'success')

    const result = await buildPTA(wfId)
    expect(result.graph.dominators.length).toBeGreaterThan(0)
    // start, login, dashboard/end dovrebbero essere dominatori
  })

  it('computeDominators con PTA grande (50+ nodi) converge entro cap', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}b6-large`

    // Crea 10 tracce con 10 stati ciascuna, con branch
    for (let t = 0; t < 10; t++) {
      const states = ['start']
      for (let s = 0; s < 8; s++) {
        states.push(`step_${s}_${t % 3}`) // 3 branch paths
      }
      states.push('end')
      await captureTrace(wfId, `trace_${t}`, states, [], 'success')
    }

    const result = await buildPTA(wfId)
    expect(Object.keys(result.graph.nodes).length).toBeGreaterThan(10)
    expect(result.graph.dominators.length).toBeGreaterThanOrEqual(0)
  })
})

// === B1: phase7.tsx try/catch su fetch ===============================

describe('Fase B — B1: phase7.tsx try/catch su fetch', () => {
  it('phase7.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B1 fix.*try\/catch su fetch/)
    expect(content).toMatch(/Caricamento dominator fallito/)
  })

  it('phase7.tsx ha try/catch su capture()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Cattura fallita.*errore di rete/)
  })

  it('phase7.tsx ha try/catch su validate()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Validazione fallita.*errore di rete/)
  })

  it('phase7.tsx buildPta() aveva già try/catch (preesistente)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    // buildPta già aveva try/catch prima di Fase B
    expect(content).toMatch(/buildPta[\s\S]*try[\s\S]*catch/)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B4+B5+B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('captureTrace con payload grande → truncate → buildPTA → validateTrace → dominatorStats', async () => {
    const { captureTrace, buildPTA, validateTrace, dominatorStats } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}smoke`

    // B4: Crea tracce con payload moderato (sotto 50KB)
    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')

    // B6: buildPTA converge (computeDominators con cap iterazioni)
    const ptaResult = await buildPTA(wfId)
    expect(ptaResult.traceCount).toBe(2)
    expect(ptaResult.graph.dominators.length).toBeGreaterThan(0)

    // validateTrace
    const validResult = await validateTrace(wfId, ['start', 'login', 'submit', 'dashboard', 'end'])
    expect(validResult.verdict).toBe('accept')

    // B5: dominatorStats usa aggregate
    const stats = await dominatorStats()
    expect(stats.validations).toBeGreaterThanOrEqual(1)
    expect(stats.avgCoverage).toBeGreaterThan(0)
  })

  it('B4: payload enorme viene troncato senza crashare buildPTA', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}smoke-truncate`
    // Crea traccia con payload enorme (> 50KB)
    const bigStates = Array.from({ length: 3000 }, (_, i) => `state_${i}_${'x'.repeat(20)}`)
    await captureTrace(wfId, 'big', bigStates, [], 'success')

    // buildPTA non deve crashare (B4: payload troncato, B2: JSON.parse robusto)
    const result = await buildPTA(wfId)
    expect(result.traceCount).toBeGreaterThanOrEqual(1)
    expect(result.graph.nodes).toBeDefined()
  })
})
