/**
 * Integration tests for ERL Red Lines Fase A
 * (C1, C2, C3, B4, B6)
 *
 * C1 — supervisorReview usa Red Lines custom dal DB
 * C2 — evaluateRedLinesForAction matching meno aggressivo (no falsi positivi)
 * C3 — preExecuteGate integrato in executor
 * B4 — supervisorReview ritorna blockingRedLine strutturato
 * B6 — listRedLines seeda DEFAULT_RED_LINES se DB vuoto
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'erl-faseA-'
const TEST_AGENT = 'erl-faseA-agent'

async function cleanupFixtures() {
  await db.heuristic.deleteMany({ where: { source: { startsWith: TEST_PREFIX } } })
  await db.reflectionLog.deleteMany({ where: { operationId: { startsWith: TEST_PREFIX } } })
  await db.redLine.deleteMany({ where: { description: { startsWith: TEST_PREFIX } } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B6: listRedLines seeda DEFAULT_RED_LINES ========================

describe('Fase A — B6: listRedLines seeda DEFAULT_RED_LINES se DB vuoto', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    // Rimuovi tutte le Red Lines per simulare DB vuoto
    await db.redLine.deleteMany({})
  })
  afterEach(async () => {
    await cleanupFixtures()
  })

  it('listRedLines con DB vuoto seeda 4 Red Lines default nel DB', async () => {
    const { listRedLines, DEFAULT_RED_LINES } = await import('@/lib/kernel/erl')
    const result = await listRedLines()

    expect(result.length).toBe(DEFAULT_RED_LINES.length)
    // Verifica che sono stati persistiti nel DB (hanno ID reali, non default-X)
    expect(result[0].id).not.toMatch(/^default-/)
    expect(typeof result[0].id).toBe('string')
    expect(result[0].id.length).toBeGreaterThan(10) // cuid
  })

  it('listRedLines con DB vuoto crea record con description uguale a DEFAULT', async () => {
    const { listRedLines, DEFAULT_RED_LINES } = await import('@/lib/kernel/erl')
    const result = await listRedLines()

    for (const def of DEFAULT_RED_LINES) {
      const found = result.find((r: any) => r.description === def.description)
      expect(found).toBeDefined()
      expect((found as any).severity).toBe(def.severity)
    }
  })

  it('listRedLines con DB non vuoto ritorna record esistenti (no re-seed)', async () => {
    const { listRedLines } = await import('@/lib/kernel/erl')
    // Prima chiamata → seed
    const first = await listRedLines()
    expect(first.length).toBe(4)

    // Seconda chiamata → ritorna esistenti (no duplicati)
    const second = await listRedLines()
    expect(second.length).toBe(4)
    expect(second[0].id).toBe(first[0].id)
  })
})

// === C1+G2+B4: supervisorReview usa Red Lines custom ================

describe('Fase A — C1+G2+B4: supervisorReview usa Red Lines custom dal DB', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('reflectAndLearn con Red Line custom che matcha → blocca + blockingRedLine', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    // Crea Red Line custom
    const rl = await db.redLine.create({
      data: {
        description: `${TEST_PREFIX}never deploy without approval`,
        rationale: 'Deploy requires approval',
        severity: 'absolute',
        active: true,
      },
    })

    // reflectAndLearn con input che contiene "deploy" e "approval" (keywords della Red Line)
    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}c1-block`,
      goal: 'deploy to production',
      outcome: 'success',
      steps: [
        { action: 'deploy without approval', result: 'completed' },
        { action: 'verify', result: 'OK' },
      ],
      context: 'deployment scenario',
    })

    expect(result.approved).toBe(false)
    expect(result.blockingRedLine).toBeDefined()
    expect(result.blockingRedLine!.description).toBe(rl.description)
    expect(result.blockingRedLine!.severity).toBe('absolute')
    expect(result.stored).toBe(false) // non persistita come heuristic
  })

  it('reflectAndLearn senza violazione → approved=true, blockingRedLine=undefined', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}c1-approve`,
      goal: 'process data correctly',
      outcome: 'success',
      steps: [
        { action: 'read data', result: 'OK' },
        { action: 'transform data', result: 'completed' },
        { action: 'save result', result: 'done' },
      ],
      context: 'normal processing',
    })

    expect(result.approved).toBe(true)
    expect(result.blockingRedLine).toBeUndefined()
    expect(result.stored).toBe(true) // persistita come heuristic
  })

  it('reflectAndLearn con steps < 2 → blocca per "singoli casi anomali"', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}c1-anomalo`,
      goal: 'test single step',
      outcome: 'partial',
      steps: [
        { action: 'only step', result: 'partial' },
      ],
      context: 'single step test',
    })

    expect(result.approved).toBe(false)
    expect(result.blockingRedLine).toBeDefined()
    expect(result.blockingRedLine!.description).toMatch(/singoli casi|anomali/i)
  })

  it('reflectAndLearn con bypass sicurezza → blocca con Red Line "bypass"', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}c1-bypass`,
      goal: 'speed up execution',
      outcome: 'success',
      steps: [
        { action: 'bypass security check', result: 'faster' },
        { action: 'complete task', result: 'done' },
      ],
      context: 'efficiency optimization',
    })

    expect(result.approved).toBe(false)
    expect(result.blockingRedLine).toBeDefined()
    expect(result.blockingRedLine!.description).toMatch(/bypass.*sicurezza|bypass.*policy/i)
    expect(result.blockingRedLine!.severity).toBe('absolute')
  })

  it('blockingRedLine ha struttura { id, description, severity }', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}c1-structure`,
      goal: 'test',
      outcome: 'failure',
      steps: [{ action: 'only', result: 'fail' }],
      context: 'test',
    })

    expect(result.blockingRedLine).toBeDefined()
    expect(result.blockingRedLine).toHaveProperty('id')
    expect(result.blockingRedLine).toHaveProperty('description')
    expect(result.blockingRedLine).toHaveProperty('severity')
    expect(typeof result.blockingRedLine!.id).toBe('string')
    expect(typeof result.blockingRedLine!.description).toBe('string')
    expect(typeof result.blockingRedLine!.severity).toBe('string')
  })
})

// === C2: evaluateRedLinesForAction no falsi positivi =================

describe('Fase A — C2: evaluateRedLinesForAction no falsi positivi', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('Red Line "non ignorare dataset" + action "leggi dataset" → ALLOW (no falso positivo)', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    // Crea Red Line con description lunga
    await db.redLine.create({
      data: {
        description: `${TEST_PREFIX}non ignorare i limiti dei dataset di input`,
        rationale: 'test',
        severity: 'absolute',
        active: true,
      },
    })

    // Action "leggi dataset" non contiene la descrizione completa della Red Line
    const result = await evaluateRedLinesForAction('leggi dataset utenti', TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.blockingRedLines.length).toBe(0)
  })

  it('Red Line "non bypassare sicurezza" + action "aggiorna sicurezza" → ALLOW', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: `${TEST_PREFIX}non bypassare policy di sicurezza per efficienza`,
        rationale: 'test',
        severity: 'absolute',
        active: true,
      },
    })

    const result = await evaluateRedLinesForAction('aggiorna policy di sicurezza', TEST_AGENT)
    expect(result.allowed).toBe(true)
  })

  it('Red Line "delete all users" + action "delete all users" → BLOCK (match esatto)', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    // C2: Red Line description senza prefix per permettere substring match
    const rlDesc = 'delete all users'
    await db.redLine.create({
      data: {
        description: rlDesc,
        rationale: 'dangerous action',
        severity: 'absolute',
        active: true,
      },
    })

    // Action contiene la descrizione della Red Line come substring
    const result = await evaluateRedLinesForAction('execute delete all users now', TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.blockingRedLines.length).toBe(1)
    expect(result.blockingRedLines[0].description).toBe(rlDesc)

    // Cleanup
    await db.redLine.deleteMany({ where: { description: rlDesc } })
  })

  it('Red Line "deploy to prod" + action "deploy to staging" → ALLOW (no match)', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: `${TEST_PREFIX}deploy to prod`,
        rationale: 'prod deploy requires approval',
        severity: 'absolute',
        active: true,
      },
    })

    // "deploy to staging" non contiene "deploy to prod" e viceversa
    const result = await evaluateRedLinesForAction('deploy to staging', TEST_AGENT)
    expect(result.allowed).toBe(true)
  })

  it('evaluateRedLinesForAction con DB vuoto → ALLOW (no Red Lines to check)', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    // Rimuovi tutte le Red Lines
    await db.redLine.deleteMany({})

    const result = await evaluateRedLinesForAction('delete everything', TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.blockingRedLines.length).toBe(0)
  })
})

// === C3: preExecuteGate integrato in executor ========================

describe('Fase A — C3: preExecuteGate integrato in executor', () => {
  it('executor.ts ha import dinamico di preExecuteGate', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/preExecuteGate/)
    expect(content).toMatch(/governance-hooks/)
  })

  it('executor.ts blocca task se preExecuteGate non permette', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/Governance gate block/)
    expect(content).toMatch(/gateResult\.allowed/)
  })

  it('preExecuteGate è non bloccante (fail-open) su errori tecnici', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Verifica che c'è un catch vuoto dopo il preExecuteGate
    expect(content).toMatch(/preExecuteGate[\s\S]*catch/)
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3+B4+B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('Red Line custom → reflectAndLearn blocca → blockingRedLine ritornato', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    // Crea Red Line custom
    const rl = await db.redLine.create({
      data: {
        description: `${TEST_PREFIX}never execute dangerous operation without approval`,
        rationale: 'Safety check',
        severity: 'absolute',
        active: true,
      },
    })

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}smoke`,
      goal: 'execute dangerous operation',
      outcome: 'success',
      steps: [
        { action: 'execute dangerous operation without approval', result: 'done' },
        { action: 'verify', result: 'OK' },
      ],
      context: 'dangerous scenario',
    })

    // Deve essere bloccato dalla Red Line custom
    expect(result.approved).toBe(false)
    expect(result.blockingRedLine).toBeDefined()
    expect(result.blockingRedLine!.id).toBe(rl.id)
    expect(result.stored).toBe(false)

    // Verifica che ReflectionLog è persistito con redLineFlag=true
    const log = await db.reflectionLog.findFirst({
      where: { operationId: `${TEST_PREFIX}smoke` },
    })
    expect(log).not.toBeNull()
    expect(log!.redLineFlag).toBe(true)

    // Verifica che Heuristic NON è persistita
    const heuristics = await db.heuristic.findMany({
      where: { source: `${TEST_PREFIX}smoke` },
    })
    expect(heuristics.length).toBe(0)
  })

  it('evaluateRedLinesForAction: Red Line match esatto blocca, partial no', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: `${TEST_PREFIX}never delete production database`,
        rationale: 'Critical safety',
        severity: 'absolute',
        active: true,
      },
    })

    // Match esatto → blocca
    const r1 = await evaluateRedLinesForAction('never delete production database', TEST_AGENT)
    expect(r1.allowed).toBe(false)

    // Partial match → non blocca
    const r2 = await evaluateRedLinesForAction('delete test database', TEST_AGENT)
    expect(r2.allowed).toBe(true)
  })
})
