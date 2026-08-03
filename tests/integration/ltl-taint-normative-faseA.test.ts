/**
 * Integration tests for LTL Taint Normative Fase A
 * (C1, C2, C3, B1, B2, B4, B6 anticipato)
 *
 * C1 — LTL monitor stato FSM persistito su DB (LTLRuleState)
 * C2 — G(a -> X b) gestisce 'a' consecutivi con pendingBCount
 * C3 — Taint checkSink idempotency (blockedAtSink tracking)
 * B1 — LTL parser valida nomi proposizione
 * B2 — Normative evaluateIntent valida claimedPriority range
 * B4 — LTL verifyEvent size cap su payload (10KB)
 * B6 — LTL evalEvent non resetta stato dopo violazione
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

// === Fixtures ========================================================

const TEST_PREFIX = 'ltl-faseA-'

async function cleanupFixtures() {
  // Hard delete (non soft delete) per evitare unique constraint su retry
  await db.lTLRuleState.deleteMany({
    where: { ruleId: { startsWith: TEST_PREFIX } },
  })
  await db.lTLRule.deleteMany({
    where: { ruleId: { startsWith: TEST_PREFIX } },
  })
  await db.verificationEvent.deleteMany({
    where: { stateLabel: { startsWith: 'test_faseA_' } },
  })
  await db.taintRecord.deleteMany({
    where: { source: { startsWith: TEST_PREFIX } },
  })
}

/**
 * Setup helper per test C2: disabilita TUTTE le regole default (LTL-001..006)
 * e riattiva solo la regola di test. Questo evita interferenze quando il test
 * manda eventi 'a' che potrebbero violare regole default (es. LTL-006 G(plan -> F execute)).
 */
async function isolateTestRule(ruleId: string) {
  // Disabilita tutte le regole non di test (not: { startsWith } per compatibilità Prisma)
  await db.lTLRule.updateMany({
    where: { ruleId: { not: { startsWith: TEST_PREFIX } } },
    data: { active: false },
  })
  // Riattiva solo la regola di test
  await db.lTLRule.update({
    where: { ruleId },
    data: { active: true },
  })
  // Forza reload del monitor
  const { reloadMonitor } = await import('@/lib/kernel/ltl-monitor')
  await reloadMonitor()
}

/**
 * Ripristina le regole default dopo i test C2 (per non rompere altri test).
 */
async function restoreDefaultRules() {
  await db.lTLRule.updateMany({
    where: { ruleId: { not: { startsWith: TEST_PREFIX } } },
    data: { active: true },
  })
  const { reloadMonitor } = await import('@/lib/kernel/ltl-monitor')
  await reloadMonitor()
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C1: LTLRuleState persistence ===================================

describe('Fase A — C1: LTL monitor stato FSM persistito su DB', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('verifyEvent persiste stato FSM su LTLRuleState', async () => {
    const { verifyEvent, addLTLRule, reloadMonitor } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c1-persist`
    await addLTLRule({
      ruleId,
      formula: 'G(error -> F reflect)',
      description: 'Test C1 persistence',
      severity: 'warn',
    })
    await reloadMonitor()

    // Esegui un evento
    await verifyEvent('error', 'test', { test: true })

    // Verifica che LTLRuleState esiste
    const state = await db.lTLRuleState.findUnique({ where: { ruleId } })
    expect(state).not.toBeNull()
    expect(state!.currentState).toBeDefined()
    expect(typeof state!.currentState).toBe('string')
  })

  it('stato FSM ripreso dopo "restart" (reloadMonitor + loadStateFromDB)', async () => {
    const { verifyEvent, addLTLRule, reloadMonitor, initMonitor } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c1-restart`
    await addLTLRule({
      ruleId,
      formula: 'G(error -> F reflect)',
      description: 'Test C1 restart recovery',
      severity: 'warn',
    })
    await reloadMonitor()

    // Esegui evento 'error' → stato dovrebbe essere WAITING_B
    await verifyEvent('error', 'test', { step: 1 })

    const stateBefore = await db.lTLRuleState.findUnique({ where: { ruleId } })
    expect(stateBefore!.currentState).toBe('WAITING_B')

    // Simula restart: forza reload
    await reloadMonitor()
    await initMonitor()

    // Verifica che lo stato è stato ripristinato
    const stateAfter = await db.lTLRuleState.findUnique({ where: { ruleId } })
    expect(stateAfter!.currentState).toBe('WAITING_B')
  })

  it('LTLRuleState ha campi currentState, history, pendingBCount', async () => {
    const { verifyEvent, addLTLRule, reloadMonitor } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c1-fields`
    await addLTLRule({
      ruleId,
      formula: 'G(high_risk -> X human_approval)',
      description: 'Test C1 fields',
      severity: 'block',
    })
    await reloadMonitor()

    await verifyEvent('high_risk', 'test', { step: 1 })

    const state = await db.lTLRuleState.findUnique({ where: { ruleId } })
    expect(state).not.toBeNull()
    expect(state!.currentState).toBeDefined()
    expect(state!.history).toBeDefined()
    expect(typeof state!.pendingBCount).toBe('number')
    expect(state!.pendingBCount).toBeGreaterThanOrEqual(0)
  })
})

// === C2: G(a -> X b) con 'a' consecutivi ============================

describe('Fase A — C2: G(a -> X b) gestisce a consecutivi', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => {
    await restoreDefaultRules()
    await cleanupFixtures()
  })

  it('sequenza a, a, b NON genera violazione (PRIMA: VIOLATED errato)', async () => {
    const { addLTLRule, reloadMonitor, verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c2-aab`
    await addLTLRule({
      ruleId,
      formula: 'G(a -> X b)',
      description: 'Test C2 a consecutivi',
      severity: 'block',
    })
    await reloadMonitor()
    await isolateTestRule(ruleId)

    // Sequenza: a, a, b
    const r1 = await verifyEvent('a', 'test', {})
    const r2 = await verifyEvent('a', 'test', {})
    const r3 = await verifyEvent('b', 'test', {})

    // Nessuna violazione: il secondo 'a' non deve causare VIOLATED
    expect(r1.verdict).not.toBe('reject')
    expect(r2.verdict).not.toBe('reject') // ← questo era il bug C2
    expect(r3.verdict).not.toBe('reject')
  })

  it('sequenza a, c (non b) GENERA violazione (pendingBCount > 0)', async () => {
    const { addLTLRule, reloadMonitor, verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c2-violation`
    await addLTLRule({
      ruleId,
      formula: 'G(a -> X b)',
      description: 'Test C2 violation',
      severity: 'block',
    })
    await reloadMonitor()
    await isolateTestRule(ruleId)

    // a → pendingBCount=1, EXPECTING_B
    await verifyEvent('a', 'test', {})
    // c (non b, non a) → violazione (pendingBCount > 0)
    const r2 = await verifyEvent('c', 'test', {})

    expect(r2.verdict).toBe('reject')
    expect(r2.violations.length).toBeGreaterThan(0)
    expect(r2.violations[0].ruleId).toBe(ruleId)
  })

  it('pendingBCount si resetta a 0 dopo b', async () => {
    const { addLTLRule, reloadMonitor, verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c2-reset`
    await addLTLRule({
      ruleId,
      formula: 'G(a -> X b)',
      description: 'Test C2 reset pendingBCount',
      severity: 'block',
    })
    await reloadMonitor()
    await isolateTestRule(ruleId)

    await verifyEvent('a', 'test', {}) // pendingBCount=1
    await verifyEvent('b', 'test', {}) // pendingBCount=0

    const state = await db.lTLRuleState.findUnique({ where: { ruleId } })
    expect(state!.pendingBCount).toBe(0)
  })

  it('multipli a consecutivi poi b → no violazione', async () => {
    const { addLTLRule, reloadMonitor, verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}c2-multi`
    await addLTLRule({
      ruleId,
      formula: 'G(a -> X b)',
      description: 'Test C2 multi a',
      severity: 'block',
    })
    await reloadMonitor()
    await isolateTestRule(ruleId)

    // a, a, a, a, b
    await verifyEvent('a', 'test', {})
    await verifyEvent('a', 'test', {})
    await verifyEvent('a', 'test', {})
    await verifyEvent('a', 'test', {})
    const r5 = await verifyEvent('b', 'test', {})

    expect(r5.verdict).not.toBe('reject')
  })
})

// === C3: Taint checkSink idempotency ================================

describe('Fase A — C3: Taint checkSink idempotency', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('stesso taintId passato a 2 sink diversi → blocca solo il primo', async () => {
    const { taintInput, checkSink } = await import('@/lib/kernel/taint')
    const taintId = await taintInput(`${TEST_PREFIX}c3-source`, 'malicious payload')

    // Primo sink: blocca
    const r1 = await checkSink('tool_call:exec', [taintId])
    expect(r1.allowed).toBe(false)
    expect(r1.blockedFlows.length).toBe(1)

    // Secondo sink (diverso): NON blocca (già bloccato)
    const r2 = await checkSink('tool_call:file_write', [taintId])
    expect(r2.allowed).toBe(true) // idempotency: già bloccato, non ri-blocca
    expect(r2.blockedFlows.length).toBe(0)
  })

  it('TaintRecord.blockedAtSink traccia quale sink ha bloccato', async () => {
    const { taintInput, checkSink } = await import('@/lib/kernel/taint')
    const taintId = await taintInput(`${TEST_PREFIX}c3-sink-track`, 'payload')

    await checkSink('tool_call:network', [taintId])

    const record = await db.taintRecord.findUnique({ where: { id: taintId } })
    expect(record!.blocked).toBe(true)
    expect(record!.blockedAtSink).toBe('tool_call:network')
  })

  it('stesso sink passato 2 volte → blocca solo la prima', async () => {
    const { taintInput, checkSink } = await import('@/lib/kernel/taint')
    const taintId = await taintInput(`${TEST_PREFIX}c3-same-sink`, 'payload')

    const r1 = await checkSink('tool_call:exec', [taintId])
    expect(r1.allowed).toBe(false)

    const r2 = await checkSink('tool_call:exec', [taintId])
    expect(r2.allowed).toBe(true) // già bloccato, idempotency
  })

  it('sink non sensibile non blocca mai', async () => {
    const { taintInput, checkSink } = await import('@/lib/kernel/taint')
    const taintId = await taintInput(`${TEST_PREFIX}c3-non-sensitive`, 'payload')

    const r = await checkSink('tool_call:read', [taintId]) // non in SENSITIVE_SINKS
    expect(r.allowed).toBe(true)
    expect(r.blockedFlows.length).toBe(0)
  })
})

// === B1: LTL parser valida nomi proposizione ========================

describe('Fase A — B1: LTL parser valida nomi proposizione', () => {
  it('accetta nomi validi (high_risk, execute, tainted)', async () => {
    const { validateLTLFormula } = await import('@/lib/kernel/ltl-monitor')
    expect(validateLTLFormula('G(high_risk -> X human_approval)').valid).toBe(true)
    expect(validateLTLFormula('G(tainted -> !sensitive_call)').valid).toBe(true)
    expect(validateLTLFormula('F(halt || success)').valid).toBe(true)
  })

  it('rifiuta numeri come nomi (123)', async () => {
    const { validateLTLFormula } = await import('@/lib/kernel/ltl-monitor')
    const result = validateLTLFormula('G(123 -> X b)')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Nome proposizione non valido.*123/)
  })

  it('rifiuta trattini (high-risk)', async () => {
    const { validateLTLFormula } = await import('@/lib/kernel/ltl-monitor')
    const result = validateLTLFormula('G(high-risk -> X b)')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Nome proposizione non valido|Atomo atteso/)
  })

  it('rifiuta caratteri speciali (tainted!)', async () => {
    const { validateLTLFormula } = await import('@/lib/kernel/ltl-monitor')
    const result = validateLTLFormula('G(tainted!)')
    expect(result.valid).toBe(false)
  })

  it('rifiuta nomi che iniziano con cifra (1abc)', async () => {
    const { validateLTLFormula } = await import('@/lib/kernel/ltl-monitor')
    const result = validateLTLFormula('G(1abc)')
    expect(result.valid).toBe(false)
  })
})

// === B2: Normative evaluateIntent valida claimedPriority ============

describe('Fase A — B2: Normative evaluateIntent valida claimedPriority', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('claimedPriority=0 → throws InvalidPriorityError', async () => {
    const { evaluateIntent, InvalidPriorityError } = await import('@/lib/kernel/normative')
    try {
      await evaluateIntent({
        agentId: 'test',
        action: 'test',
        rationale: 'test',
        affectedAxioms: [],
        claimedPriority: 0,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidPriorityError)
      expect(e.priority).toBe(0)
    }
  })

  it('claimedPriority=999 → throws InvalidPriorityError', async () => {
    const { evaluateIntent, InvalidPriorityError } = await import('@/lib/kernel/normative')
    try {
      await evaluateIntent({
        agentId: 'test',
        action: 'test',
        rationale: 'test',
        affectedAxioms: [],
        claimedPriority: 999,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidPriorityError)
      expect(e.priority).toBe(999)
    }
  })

  it('claimedPriority=-5 → throws InvalidPriorityError', async () => {
    const { evaluateIntent, InvalidPriorityError } = await import('@/lib/kernel/normative')
    try {
      await evaluateIntent({
        agentId: 'test',
        action: 'test',
        rationale: 'test',
        affectedAxioms: [],
        claimedPriority: -5,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidPriorityError)
      expect(e.priority).toBe(-5)
    }
  })

  it('claimedPriority=1, 2, 3 → valida senza throw', async () => {
    const { evaluateIntent } = await import('@/lib/kernel/normative')
    for (const p of [1, 2, 3]) {
      const verdict = await evaluateIntent({
        agentId: 'test',
        action: `test ${p}`,
        rationale: 'test',
        affectedAxioms: [],
        claimedPriority: p,
      })
      expect(verdict.allowed).toBe(true) // no violations → allowed
    }
  })

  it('InvalidPriorityError ha message descrittivo', async () => {
    const { InvalidPriorityError } = await import('@/lib/kernel/normative')
    const e = new InvalidPriorityError(0)
    expect(e.message).toMatch(/must be 1.*2.*3/i)
    expect(e.name).toBe('InvalidPriorityError')
  })
})

// === B4: verifyEvent size cap su payload ============================

describe('Fase A — B4: verifyEvent size cap su payload (10KB)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('payload sotto 10KB viene persistito intero', async () => {
    const { verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const smallPayload = { data: 'x'.repeat(1000) }
    await verifyEvent('test_faseA_small', 'test', smallPayload)

    const event = await db.verificationEvent.findFirst({
      where: { stateLabel: 'test_faseA_small' },
      orderBy: { timestamp: 'desc' },
    })
    expect(event).not.toBeNull()
    expect(event!.payload).toContain('x'.repeat(1000))
    expect(event!.payload.length).toBeLessThan(10_000)
  })

  it('payload sopra 10KB viene troncato con marker [truncated]', async () => {
    const { verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const bigPayload = { data: 'x'.repeat(50_000) } // 50KB
    await verifyEvent('test_faseA_big', 'test', bigPayload)

    const event = await db.verificationEvent.findFirst({
      where: { stateLabel: 'test_faseA_big' },
      orderBy: { timestamp: 'desc' },
    })
    expect(event).not.toBeNull()
    expect(event!.payload.length).toBeLessThan(11_000) // ~10KB + marker
    expect(event!.payload).toMatch(/\[truncated\]/)
  })

  it('payload non stringificabile (circular) → fallback a String()', async () => {
    const { verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const circular: any = { a: 1 }
    circular.self = circular
    await verifyEvent('test_faseA_circular', 'test', circular)

    const event = await db.verificationEvent.findFirst({
      where: { stateLabel: 'test_faseA_circular' },
      orderBy: { timestamp: 'desc' },
    })
    expect(event).not.toBeNull()
    expect(event!.payload.length).toBeGreaterThan(0)
  })
})

// === B6 (anticipato): evalEvent non resetta stato dopo violazione ===

describe('Fase A — B6: evalEvent non resetta stato dopo violazione', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => {
    await restoreDefaultRules()
    await cleanupFixtures()
  })

  it('2 violazioni consecutive della stessa regola → 2 violations registrate', async () => {
    const { addLTLRule, reloadMonitor, verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const ruleId = `${TEST_PREFIX}b6-consecutive`
    // G(p): p deve valere sempre. Se p è falso → VIOLATED.
    await addLTLRule({
      ruleId,
      formula: 'G(safe_state)',
      description: 'Test B6 consecutive violations',
      severity: 'warn',
    })
    await reloadMonitor()
    await isolateTestRule(ruleId)

    // Due eventi non-safe consecutivi
    const r1 = await verifyEvent('unsafe', 'test', {})
    const r2 = await verifyEvent('unsafe', 'test', {})

    // PRIMA (con reset): solo r1 aveva violation, r2 era mascherata
    // ORA (senza reset): entrambe hanno violation
    expect(r1.violations.length).toBeGreaterThan(0)
    expect(r2.violations.length).toBeGreaterThan(0)
  })
})

// === Smoke: full Fase A integration =================================

describe('Fase A — Smoke: full integration C1+C2+C3+B1+B2+B4', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => {
    await restoreDefaultRules()
    await cleanupFixtures()
  })

  it('LTL rule con a consecutivi + persistenza + taint block + normative validation', async () => {
    const { addLTLRule, reloadMonitor, verifyEvent } = await import('@/lib/kernel/ltl-monitor')
    const { taintInput, checkSink } = await import('@/lib/kernel/taint')
    const { evaluateIntent } = await import('@/lib/kernel/normative')

    // 1. LTL rule con G(a -> X b)
    const ruleId = `${TEST_PREFIX}smoke`
    await addLTLRule({
      ruleId,
      formula: 'G(a -> X b)',
      description: 'Smoke test',
      severity: 'block',
    })
    await reloadMonitor()
    await isolateTestRule(ruleId)

    // 2. Sequenza a, a, b → no violazione (C2)
    const r1 = await verifyEvent('a', 'test', { step: 1 })
    const r2 = await verifyEvent('a', 'test', { step: 2 })
    const r3 = await verifyEvent('b', 'test', { step: 3 })
    expect(r1.verdict).not.toBe('reject')
    expect(r2.verdict).not.toBe('reject')
    expect(r3.verdict).not.toBe('reject')

    // 3. Stato persistito (C1)
    const state = await db.lTLRuleState.findUnique({ where: { ruleId } })
    expect(state).not.toBeNull()
    expect(state!.pendingBCount).toBe(0) // b ha resettato

    // 4. Taint block (C3)
    const taintId = await taintInput(`${TEST_PREFIX}smoke-source`, 'payload')
    const taintResult = await checkSink('tool_call:exec', [taintId])
    expect(taintResult.allowed).toBe(false)

    // 5. Normative validation (B2)
    const normativeResult = await evaluateIntent({
      agentId: 'test',
      action: 'test action',
      rationale: 'test',
      affectedAxioms: [],
      claimedPriority: 2,
    })
    expect(normativeResult.allowed).toBe(true)
  })
})
