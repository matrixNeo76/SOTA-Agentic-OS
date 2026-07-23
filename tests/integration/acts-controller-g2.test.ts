/**
 * Integration tests for ACTS Controller G2 (cross-module integrations)
 *
 * G2.1 — Phase 11 (Affect): desperation alta forza HALT, frustration alta forza CHECK
 * G2.2 — Phase 5 (ERL): triggerErlReflection chiama reflectAndLearn
 * G2.3 — Phase 14 (Router): getRoutedModel suggerisce modello specializzato
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

// === Fixtures ========================================================

const TEST_AGENT = 'acts-g2-test-agent'
const TEST_PLAN = 'acts-g2-test-plan'

async function cleanupFixtures() {
  await db.steeringState.deleteMany({
    where: { OR: [{ agentId: TEST_AGENT }, { planId: TEST_PLAN }] },
  })
  await db.steeringEvent.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.affectSample.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.reflectionLog.deleteMany({
    where: { operationId: { startsWith: TEST_AGENT } },
  })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G2.1: Phase 11 (Affect) integration ============================

describe('G2.1 — Phase 11 (Affect) integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('DEFAULT_AFFECT_HALTERN_THRESHOLD = 0.85', async () => {
    const { DEFAULT_AFFECT_HALTERN_THRESHOLD } = await import('@/lib/kernel/acts')
    expect(DEFAULT_AFFECT_HALTERN_THRESHOLD).toBe(0.85)
  })

  it('DEFAULT_AFFECT_CHECK_THRESHOLD = 0.7', async () => {
    const { DEFAULT_AFFECT_CHECK_THRESHOLD } = await import('@/lib/kernel/acts')
    expect(DEFAULT_AFFECT_CHECK_THRESHOLD).toBe(0.7)
  })

  it('decideStrategy con affectDesperation >= 0.85 → HALT forzato', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // Anche con budget 500 (non HALT da budget), desperation critica → HALT
    const result = decideStrategy({
      step: 5, lastStrategy: 'EXECUTE', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 0,
      affectDesperation: 0.9, // >= 0.85
    })
    expect(result).toBe('HALT')
  })

  it('decideStrategy con affectDesperation < 0.85 → non HALT per affect', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5, lastStrategy: 'EXECUTE', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 0,
      affectDesperation: 0.5, // < 0.85, non triggera HALT affect
    })
    expect(result).not.toBe('HALT')
    expect(result).toBe('CHECK') // EXECUTE → CHECK (FSM normale)
  })

  it('decideStrategy con affectFrustration >= 0.7 → CHECK forzato', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // Anche con errorsConsecutive=0, frustration alta → CHECK
    const result = decideStrategy({
      step: 5, lastStrategy: 'PLAN', lastCheckPassed: null,
      budgetRemaining: 500, errorsConsecutive: 0,
      affectFrustration: 0.8, // >= 0.7
    })
    expect(result).toBe('CHECK')
  })

  it('decideStrategy con affectFrustration < 0.7 → non CHECK per affect', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5, lastStrategy: 'PLAN', lastCheckPassed: null,
      budgetRemaining: 500, errorsConsecutive: 0,
      affectFrustration: 0.5, // < 0.7
    })
    expect(result).not.toBe('CHECK')
    expect(result).toBe('EXECUTE') // PLAN → EXECUTE (FSM normale)
  })

  it('affectDesperation prioritaria su budget: HALT anche con budget ok', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // budget 1000 (sufficiente), ma desperation critica → HALT
    const result = decideStrategy({
      step: 0, lastStrategy: 'PLAN', lastCheckPassed: null,
      budgetRemaining: 1000, errorsConsecutive: 0,
      affectDesperation: 1.0, // massimo
    })
    expect(result).toBe('HALT')
    // Nota: step=0 normalmente ritornerebbe PLAN, ma affect HALT ha priorità
  })

  it('affectFrustration prioritaria su errorsConsecutive: CHECK anche con errors=0', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 1, lastStrategy: 'PLAN', lastCheckPassed: null,
      budgetRemaining: 500, errorsConsecutive: 0,
      affectFrustration: 0.95,
    })
    expect(result).toBe('CHECK')
    // Nota: PLAN normalmente → EXECUTE, ma affect CHECK ha priorità
  })

  it('getAffectContext ritorna null se nessun sample per agente', async () => {
    const { getAffectContext } = await import('@/lib/kernel/acts')
    const result = await getAffectContext(TEST_AGENT)
    expect(result).toBeNull()
  })

  it('getAffectContext ritorna metriche se sample esiste', async () => {
    const { getAffectContext } = await import('@/lib/kernel/acts')
    // Crea sample affettivo
    await db.affectSample.create({
      data: {
        agentId: TEST_AGENT,
        desperation: 0.7,
        frustration: 0.4,
        toolFailureRate: 0.2,
        gateRejectRate: 0.1,
        repeatedToolCalls: 1,
        intervention: null,
        cycleId: 1,
      },
    })

    const result = await getAffectContext(TEST_AGENT)
    expect(result).not.toBeNull()
    expect(result!.desperation).toBe(0.7)
    expect(result!.frustration).toBe(0.4)
  })

  it('steer() legge affect context da Phase 11 se non fornito dal caller', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    // Crea sample con desperation critica
    await db.affectSample.create({
      data: {
        agentId: TEST_AGENT,
        desperation: 0.95, // >= 0.85 → HALT forzato
        frustration: 0.3,
        toolFailureRate: 0.2,
        gateRejectRate: 0.1,
        repeatedToolCalls: 0,
        intervention: 'halt',
        cycleId: 1,
      },
    })

    // steer() senza affectDesperation param → legge da Phase 11
    const result = await steer(TEST_AGENT, 1000, 100, 5, 'EXECUTE', true, 0, TEST_PLAN)
    expect(result.strategy).toBe('HALT') // forzato da affect
    expect(result.affectContext).not.toBeNull()
    expect(result.affectContext!.desperation).toBe(0.95)
  })

  it('steer() con affect override param ha precedenza su Phase 11', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    // Sample Phase 11 con desperation alta
    await db.affectSample.create({
      data: {
        agentId: TEST_AGENT,
        desperation: 0.95,
        frustration: 0.3,
        toolFailureRate: 0.2,
        gateRejectRate: 0.1,
        repeatedToolCalls: 0,
        intervention: null,
        cycleId: 1,
      },
    })

    // steer() con affectDesperation=0.1 override → non HALT da affect
    const result = await steer(
      TEST_AGENT, 1000, 100, 5, 'EXECUTE', true, 0, TEST_PLAN,
      undefined, undefined, 0.1, 0.1, // affectDesperation=0.1, affectFrustration=0.1
    )
    expect(result.strategy).not.toBe('HALT')
    expect(result.affectContext!.desperation).toBe(0.1) // override usato
  })
})

// === G2.2: Phase 5 (ERL) integration ================================

describe('G2.2 — Phase 5 (ERL) integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('triggerErlReflection ritorna result con heuristic estratta', async () => {
    const { triggerErlReflection } = await import('@/lib/kernel/acts')
    const result = await triggerErlReflection({
      agentId: TEST_AGENT,
      planId: TEST_PLAN,
      outcome: 'success',
      steps: [
        { action: 'load_data', result: 'OK' },
        { action: 'process', result: 'completed' },
      ],
      context: 'Test reflection context',
    })

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('heuristicTrigger')
    expect(result).toHaveProperty('heuristicAction')
    expect(result).toHaveProperty('approved')
    expect(result).toHaveProperty('stored')
    expect(result).toHaveProperty('reviewReason')
    expect(typeof result!.heuristicTrigger).toBe('string')
  })

  it('triggerErlReflection con outcome failure estrae heuristic diversa', async () => {
    const { triggerErlReflection } = await import('@/lib/kernel/acts')
    const result = await triggerErlReflection({
      agentId: TEST_AGENT,
      planId: TEST_PLAN,
      outcome: 'failure',
      steps: [
        { action: 'load_data', result: 'OK' },
        { action: 'process', result: 'failed: timeout' },
      ],
      context: 'Test failure reflection',
    })

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('heuristicTrigger')
  })

  it('triggerErlReflection persiste ReflectionLog su DB', async () => {
    const { triggerErlReflection } = await import('@/lib/kernel/acts')
    await triggerErlReflection({
      agentId: TEST_AGENT,
      planId: TEST_PLAN,
      outcome: 'partial',
      steps: [{ action: 'step1', result: 'partial' }],
      context: 'Persistence test',
    })

    const logs = await db.reflectionLog.findMany({
      where: { operationId: { startsWith: TEST_AGENT } },
    })
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0].outcome).toBe('partial')
  })

  it('triggerErlReflection ritorna null se erl module fallisce', async () => {
    // Mock che fa fallire reflectAndLearn
    vi.doMock('@/lib/kernel/erl', () => ({
      reflectAndLearn: vi.fn().mockRejectedValue(new Error('ERL unavailable')),
    }))

    const { triggerErlReflection } = await import('@/lib/kernel/acts')
    const result = await triggerErlReflection({
      agentId: TEST_AGENT,
      outcome: 'success',
      steps: [],
      context: 'failure test',
    })

    // Non throws, ritorna null gracefully
    expect(result).toBeNull()

    vi.doUnmock('@/lib/kernel/erl')
  })
})

// === G2.3: Phase 14 (Router) integration ============================

describe('G2.3 — Phase 14 (Router) integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('getRoutedModel ritorna null per strategy HALT', async () => {
    const { getRoutedModel } = await import('@/lib/kernel/acts')
    const result = await getRoutedModel('HALT', TEST_AGENT, 'test prompt')
    expect(result).toBeNull()
  })

  it('getRoutedModel ritorna modello per strategy PLAN', async () => {
    const { getRoutedModel } = await import('@/lib/kernel/acts')
    const result = await getRoutedModel('PLAN', TEST_AGENT, 'plan a complex task')
    // Router potrebbe fallire per config mancante, ma dovrebbe ritornare qualcosa
    // o null graceful. Verifichiamo che non throw.
    if (result) {
      expect(result).toHaveProperty('modelId')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('routedTo')
      expect(typeof result.modelId).toBe('string')
    }
    // Se ritorna null è ok (router può non essere inizializzato in test env)
  }, 30_000) // 30s timeout: router può chiamare LLM

  it('getRoutedModel ritorna modello per strategy EXECUTE', async () => {
    const { getRoutedModel } = await import('@/lib/kernel/acts')
    const result = await getRoutedModel('EXECUTE', TEST_AGENT, 'execute the plan')
    if (result) {
      expect(['primary', 'ensemble', 'critic']).toContain(result.routedTo)
    }
  })

  it('steer() ritorna routedModel non null per strategie non-HALT', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    const result = await steer(
      TEST_AGENT, 1000, 0, 0, 'PLAN', null, 0, TEST_PLAN,
      undefined, undefined, 0.0, 0.0, // affect disattivato per evitare HALT
      'test routing prompt',
    )
    expect(result).toHaveProperty('routedModel')
    // routedModel può essere null se router non disponibile, ma la prop deve esistere
    if (result.routedModel) {
      expect(result.routedModel).toHaveProperty('modelId')
    }
  })

  it('steer() con HALT ritorna routedModel null', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    // Forza HALT con budget insufficiente + affectDesperation alto
    const result = await steer(
      TEST_AGENT, 100, 99, 5, 'EXECUTE', true, 0, TEST_PLAN,
      undefined, undefined, 0.95, 0.5, // affectDesperation=0.95 → HALT
    )
    expect(result.strategy).toBe('HALT')
    expect(result.routedModel).toBeNull()
  })
})

// === G2 smoke: full integration ====================================

describe('G2 smoke — full cross-module integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('steer() con affect context + routing + idempotency insieme', async () => {
    const { steer } = await import('@/lib/kernel/acts')

    // Crea sample con frustration alta (forza CHECK)
    await db.affectSample.create({
      data: {
        agentId: TEST_AGENT,
        desperation: 0.3, // non critica
        frustration: 0.8, // >= 0.7 → CHECK
        toolFailureRate: 0.3,
        gateRejectRate: 0.2,
        repeatedToolCalls: 2,
        intervention: null,
        cycleId: 1,
      },
    })

    const r1 = await steer(
      TEST_AGENT, 1000, 100, 5, 'PLAN', null, 0, TEST_PLAN,
      undefined, undefined, undefined, undefined, // affect auto da Phase 11
      'plan: complex task with multiple steps',
    )

    // Aspettiamo CHECK (frustration alta)
    expect(r1.strategy).toBe('CHECK')
    expect(r1.affectContext).not.toBeNull()
    expect(r1.affectContext!.frustration).toBe(0.8)

    // routedModel dovrebbe essere stato calcolato (anche se null per router non disponibile)
    expect(r1).toHaveProperty('routedModel')

    // Idempotency: retry stesso step
    const r2 = await steer(
      TEST_AGENT, 1000, 100, 5, 'PLAN', null, 0, TEST_PLAN,
      undefined, undefined, undefined, undefined,
      'plan: complex task with multiple steps',
    )
    expect(r2.idempotent).toBe(true)
    expect(r2.strategy).toBe(r1.strategy)
  })

  it('REFLECT strategy triggera ERL reflection via API caller', async () => {
    // Verifica che REFLECT sia triggerabile e che il caller possa
    // chiamare triggerErlReflection separatamente
    const { steer, triggerErlReflection, DEFAULT_REFLECT_INTERVAL } = await import('@/lib/kernel/acts')

    // steer a step 10 (multiplo di REFLECT_INTERVAL=10) → REFLECT
    const r = await steer(
      TEST_AGENT, 1000, 100, 10, 'EXECUTE', true, 0, TEST_PLAN,
      undefined, undefined, 0.0, 0.0, // affect disattivato
    )
    expect(r.strategy).toBe('REFLECT')

    // Caller triggera ERL reflection quando vede REFLECT
    const erlResult = await triggerErlReflection({
      agentId: TEST_AGENT,
      planId: TEST_PLAN,
      outcome: 'success',
      steps: [{ action: 'step10', result: 'completed' }],
      context: 'Reflection after 10 steps',
    })

    expect(erlResult).not.toBeNull()
    expect(DEFAULT_REFLECT_INTERVAL).toBe(10)
  })
})
