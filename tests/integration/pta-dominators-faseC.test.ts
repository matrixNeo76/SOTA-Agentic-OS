/**
 * Integration tests for PTA Dominators Fase C
 * (G1, G2, G3, G4)
 *
 * G1 — Unit test per buildPTA, computeDominators, validateTrace
 * G2 — a11y in phase7.tsx (aria-label, role=status)
 * G3 — captureTrace integrato nell'executor
 * G4 — validateTrace con 0 dominators → warn invece di accept
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'pta-faseC-'

async function cleanupFixtures() {
  await db.traceValidation.deleteMany({ where: { ptaId: { contains: TEST_PREFIX } } })
  await db.prefixTreeAutomaton.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
  await db.executionTrace.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G4: validateTrace con 0 dominators → warn ======================

describe('Fase C — G4: validateTrace con 0 dominators → warn', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('PTA con 0 dominatori → verdict=warn (non accept)', async () => {
    const { validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}g4-zero-dom`
    // Crea PTA con 0 dominatori (singola traccia lineare → nessun branch → 0 dominatori essenziali)
    await db.prefixTreeAutomaton.create({
      data: {
        workflowId: wfId,
        nodesJson: JSON.stringify({
          n0: { id: 'n0', state: 'start', children: { step1: 'n1' }, isAccept: false, depth: 0 },
          n1: { id: 'n1', state: 'step1', children: { end: 'n2' }, isAccept: false, depth: 1 },
          n2: { id: 'n2', state: 'end', children: {}, isAccept: true, depth: 2 },
        }),
        dominatorsJson: '[]', // 0 dominatori
        startNodeId: 'n0',
        acceptNodeIds: JSON.stringify(['n2']),
      },
    })

    const result = await validateTrace(wfId, ['start', 'step1', 'end'])
    // G4: 0 dominatori → warn (non accept)
    expect(result.verdict).toBe('warn')
    expect(result.dominatorCoverage).toBe(0) // non 1.0
    expect(result.reason).toMatch(/0 essential dominators/i)
  })

  it('PTA con dominatori → accept se tutti raggiunti', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}g4-with-dom`
    // 2 tracce con branch → crea dominatori
    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')
    await buildPTA(wfId)

    const result = await validateTrace(wfId, ['start', 'login', 'submit', 'dashboard', 'end'])
    // Con dominatori e path valido → accept
    expect(result.verdict).toBe('accept')
    expect(result.dominatorCoverage).toBe(1.0)
  })

  it('dominator-tree.ts non ha più coverage=1.0 per 0 dominators', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/dominator-tree.ts'),
      'utf-8',
    )
    // G4: il vecchio codice aveva `: 1.0` come fallback per 0 dominators
    expect(content).toMatch(/G4 fix.*0 dominatori.*warn/)
    expect(content).not.toMatch(/dominators\.length > 0[\s\S]*: 1\.0/)
  })
})

// === G3: captureTrace integrato in executor ==========================

describe('Fase C — G3: captureTrace integrato in executor', () => {
  it('executor.ts ha import dinamico di captureTrace', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/captureTrace/)
    expect(content).toMatch(/dominator-tree/)
  })

  it('executor.ts chiama captureTrace dopo task completato', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G3 fix[\s\S]*captureTrace/)
    expect(content).toMatch(/captureTrace/)
    expect(content).toMatch(/plan:/)
  })

  it('executor.ts captureTrace è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Verifica che c'è un catch vuoto dopo captureTrace
    expect(content).toMatch(/captureTrace[\s\S]*catch/)
  })
})

// === G2: a11y in phase7.tsx ==========================================

describe('Fase C — G2: phase7.tsx a11y (aria-label, role=status)', () => {
  it('Aggiorna button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna tracce e statistiche"/)
  })

  it('stats grid ha role=status e aria-live', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche PTA Dominators"/)
  })

  it('Cattura Traccia button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Cattura la traccia/)
  })

  it('Costruisci PTA button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Costruisci il PTA/)
  })

  it('Valida button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase7.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Valida la traccia/)
  })
})

// === G1: Unit test per buildPTA, computeDominators, validateTrace =====

describe('Fase C — G1: Unit test dominator-tree.ts', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('buildPTA con 2 tracce divergenti crea PTA con dominatori', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-buildpta`

    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')

    const result = await buildPTA(wfId)
    expect(result.traceCount).toBe(2)
    expect(result.graph.nodes).toBeDefined()
    expect(Object.keys(result.graph.nodes).length).toBeGreaterThan(3)
    expect(result.graph.dominators.length).toBeGreaterThan(0)
    expect(result.graph.acceptNodeIds.length).toBeGreaterThan(0)
  })

  it('buildPTA con 1 sola traccia diretta (root→accept) → 0 dominatori essenziali', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-single-trace`

    // Traccia con singolo stato ('end' = accept) → root→accept diretto, 0 dominatori
    await captureTrace(wfId, 't1', ['end'], [], 'success')

    const result = await buildPTA(wfId)
    expect(result.traceCount).toBe(1)
    // Root (__start__) → 'end' (accept). Essential dominators = intersection - {root, accept} = 0
    expect(result.graph.dominators.length).toBe(0)
  })

  it('buildPTA con 3 tracce e 3 branch → dominatori significativi', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-multi-branch`

    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't3', ['start', 'login', 'guest', 'dashboard', 'end'], [], 'success')

    const result = await buildPTA(wfId)
    expect(result.traceCount).toBe(3)
    // start, login, dashboard, end dovrebbero essere dominatori (presenti in tutti i path)
    expect(result.graph.dominators.length).toBeGreaterThan(0)
  })

  it('validateTrace con traccia valida → accept, coverage=1.0', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-validate-ok`

    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'end'], [], 'success')
    await buildPTA(wfId)

    const result = await validateTrace(wfId, ['start', 'login', 'submit', 'end'])
    expect(result.verdict).toBe('accept')
    expect(result.dominatorCoverage).toBe(1.0)
    expect(result.pathValid).toBe(true)
  })

  it('validateTrace con deviazione → pathValid=false', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-validate-deviation`

    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'end'], [], 'success')
    await buildPTA(wfId)

    const result = await validateTrace(wfId, ['start', 'login', 'UNKNOWN', 'end'])
    expect(result.pathValid).toBe(false)
  })

  it('validateTrace persiste TraceValidation su DB', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-persist`

    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'end'], [], 'success')
    const ptaResult = await buildPTA(wfId)
    await validateTrace(wfId, ['start', 'login', 'submit', 'end'])

    const validations = await db.traceValidation.findMany({
      where: { ptaId: ptaResult.ptaId },
    })
    expect(validations.length).toBe(1)
    expect(validations[0].verdict).toBe('accept')
  })

  it('getPTA ritorna il grafo persistito', async () => {
    const { captureTrace, buildPTA, getPTA } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-getpta`

    await captureTrace(wfId, 't1', ['start', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'alt', 'end'], [], 'success')
    await buildPTA(wfId)

    const pta = await getPTA(wfId)
    expect(pta).not.toBeNull()
    expect(pta!.nodes).toBeDefined()
    expect(pta!.startNodeId).toBeDefined()
    expect(pta!.dominators).toBeDefined()
  })

  it('listTraces ritorna tracce per workflow', async () => {
    const { captureTrace, listTraces } = await import('@/lib/kernel/dominator-tree')
    const wfId = `${TEST_PREFIX}g1-list`

    await captureTrace(wfId, 't1', ['start', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'alt', 'end'], [], 'success')

    const traces = await listTraces(wfId)
    expect(traces.length).toBe(2)
    expect(traces[0].workflowId).toBe(wfId)
  })

  it('dominatorStats ritorna tutte le metriche', async () => {
    const { dominatorStats } = await import('@/lib/kernel/dominator-tree')
    const stats = await dominatorStats()
    expect(stats).toHaveProperty('traces')
    expect(stats).toHaveProperty('ptas')
    expect(stats).toHaveProperty('validations')
    expect(stats).toHaveProperty('avgCoverage')
    expect(stats).toHaveProperty('acceptRate')
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('full pipeline: capture → build → validate (con dominatori) → accept', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}smoke-full`
    await captureTrace(wfId, 't1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 't2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')

    const ptaResult = await buildPTA(wfId)
    expect(ptaResult.graph.dominators.length).toBeGreaterThan(0)

    const validResult = await validateTrace(wfId, ['start', 'login', 'submit', 'dashboard', 'end'])
    expect(validResult.verdict).toBe('accept')
    expect(validResult.dominatorCoverage).toBe(1.0)
  })

  it('G4: PTA con 0 dominatori → warn (non accept)', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}smoke-g4`
    // Traccia con singolo stato → root→accept diretto, 0 dominatori essenziali
    await captureTrace(wfId, 't1', ['end'], [], 'success')
    const ptaResult = await buildPTA(wfId)
    expect(ptaResult.graph.dominators.length).toBe(0)

    const result = await validateTrace(wfId, ['end'])
    // G4: 0 dominatori → warn
    expect(result.verdict).toBe('warn')
    expect(result.dominatorCoverage).toBe(0)
  })
})
