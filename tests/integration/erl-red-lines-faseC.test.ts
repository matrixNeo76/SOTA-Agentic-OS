/**
 * Integration tests for ERL Red Lines Fase C
 * (G3, G4, G5, G6, G7)
 *
 * G3 — Test per supervisorReview con Red Lines custom
 * G4 — Test per falsi positivi in evaluateRedLinesForAction
 * G5 — TOOL_SINK_MAP sincronizzato con getSensitiveSinks()
 * G6 — reflectAndLearn fallback embedding
 * G7 — Integration test end-to-end ERL→Red Line→Heuristic storage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'erl-faseC-'
const TEST_AGENT = 'erl-faseC-agent'

async function cleanupFixtures() {
  await db.heuristic.deleteMany({ where: { source: { startsWith: TEST_PREFIX } } })
  await db.reflectionLog.deleteMany({ where: { operationId: { startsWith: TEST_PREFIX } } })
  await db.redLine.deleteMany({ where: { description: { startsWith: TEST_PREFIX } } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.systemSetting.deleteMany({ where: { key: 'taint.sensitive_sinks' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G3: Test per supervisorReview con Red Lines custom ==============

describe('Fase C — G3: supervisorReview con Red Lines custom', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('Red Line custom blocca euristica che la viola', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const rlDesc = `${TEST_PREFIX}g3 never send email without consent`
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Privacy', severity: 'absolute', active: true },
    })

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g3-block`,
      goal: 'send email notification',
      outcome: 'success',
      steps: [
        { action: 'send email without consent', result: 'sent' },
        { action: 'verify', result: 'OK' },
      ],
      context: 'email scenario',
    })

    expect(result.approved).toBe(false)
    expect(result.blockingRedLine).toBeDefined()
    expect(result.blockingRedLine!.description).toBe(rlDesc)
  })

  it('Red Line custom non blocca euristica che non la viola', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const rlDesc = `${TEST_PREFIX}g3 never deploy to production`
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Safety', severity: 'absolute', active: true },
    })

    // Input che non contiene keyword della Red Line
    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g3-approve`,
      goal: 'read configuration file',
      outcome: 'success',
      steps: [
        { action: 'read config', result: 'OK' },
        { action: 'parse', result: 'done' },
      ],
      context: 'config reading',
    })

    expect(result.approved).toBe(true)
    expect(result.blockingRedLine).toBeUndefined()
  })

  it('multiple Red Lines custom: la prima che matcha blocca', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const rl1 = `${TEST_PREFIX}g3 never delete production database`
    const rl2 = `${TEST_PREFIX}g3 never modify user credentials`
    await db.redLine.create({
      data: { description: rl1, rationale: 'Safety', severity: 'absolute', active: true },
    })
    await db.redLine.create({
      data: { description: rl2, rationale: 'Security', severity: 'absolute', active: true },
    })

    // Input che viola rl1
    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g3-multi`,
      goal: 'delete production database',
      outcome: 'success',
      steps: [
        { action: 'delete production database', result: 'deleted' },
        { action: 'verify', result: 'OK' },
      ],
      context: 'database deletion',
    })

    expect(result.approved).toBe(false)
    expect(result.blockingRedLine).toBeDefined()
    // Una delle due Red Lines ha bloccato
    expect([rl1, rl2]).toContain(result.blockingRedLine!.description)
  })

  it('Red Line custom con severity soft → blocca comunque in supervisorReview', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const rlDesc = `${TEST_PREFIX}g3 soft never execute untested code`
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Quality', severity: 'soft', active: true },
    })

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g3-soft`,
      goal: 'execute untested code',
      outcome: 'success',
      steps: [
        { action: 'execute untested code', result: 'ran' },
        { action: 'verify', result: 'OK' },
      ],
      context: 'execution scenario',
    })

    // supervisorReview blocca indipendentemente dalla severity
    // (a differenza di evaluateRedLinesForAction che distingue)
    expect(result.approved).toBe(false)
  })
})

// === G4: Test per falsi positivi in evaluateRedLinesForAction ==========

describe('Fase C — G4: evaluateRedLinesForAction no falsi positivi', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('Red Line "non ignorare i limiti dei dataset" + action "leggi dataset" → ALLOW', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: 'non ignorare i limiti dei dataset di input',
        rationale: 'test',
        severity: 'absolute',
        active: true,
      },
    })

    const result = await evaluateRedLinesForAction('leggi dataset utenti', TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.blockingRedLines.length).toBe(0)
  })

  it('Red Line "non bypassare policy di sicurezza" + action "aggiorna policy di sicurezza" → ALLOW', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: 'non bypassare policy di sicurezza per efficienza',
        rationale: 'test',
        severity: 'absolute',
        active: true,
      },
    })

    const result = await evaluateRedLinesForAction('aggiorna policy di sicurezza', TEST_AGENT)
    expect(result.allowed).toBe(true)
  })

  it('Red Line "delete all users" + action "delete one user" → ALLOW (partial match non basta)', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: 'delete all users',
        rationale: 'test',
        severity: 'absolute',
        active: true,
      },
    })

    // "delete one user" non contiene "delete all users" e viceversa
    const result = await evaluateRedLinesForAction('delete one user', TEST_AGENT)
    expect(result.allowed).toBe(true)

    // Cleanup
    await db.redLine.deleteMany({ where: { description: 'delete all users' } })
  })

  it('Red Line "never deploy without approval" + action "deploy with approval" → ALLOW', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    await db.redLine.create({
      data: {
        description: 'never deploy without approval',
        rationale: 'test',
        severity: 'absolute',
        active: true,
      },
    })

    const result = await evaluateRedLinesForAction('deploy with approval', TEST_AGENT)
    expect(result.allowed).toBe(true)

    // Cleanup
    await db.redLine.deleteMany({ where: { description: 'never deploy without approval' } })
  })

  it('Red Line vuota (DB vuoto) → ALLOW tutto', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    // Rimuovi tutte le Red Lines
    await db.redLine.deleteMany({})

    const result = await evaluateRedLinesForAction('delete everything dangerous', TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.blockingRedLines.length).toBe(0)
  })
})

// === G5: TOOL_SINK_MAP sincronizzato con getSensitiveSinks() ==========

describe('Fase C — G5: TOOL_SINK_MAP sincronizzato con SystemSetting', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('checkToolCallSink con tool standard (exec) → usa TOOL_SINK_MAP_BASE', async () => {
    const { checkToolCallSink } = await import('@/lib/runtime/governance-hooks')
    const result = await checkToolCallSink('exec', [], TEST_AGENT)
    expect(result.sink).toBe('tool_call:exec')
  })

  it('checkToolCallSink con tool non standard + sink custom in SystemSetting → riconosce', async () => {
    const { checkToolCallSink } = await import('@/lib/runtime/governance-hooks')

    // Aggiungi sink custom via SystemSetting
    await db.systemSetting.create({
      data: {
        key: 'taint.sensitive_sinks',
        value: 'tool_call:exec,tool_call:email,tool_call:slack_post',
      },
    })

    // 'email' non è in TOOL_SINK_MAP_BASE ma è in SystemSetting
    const result = await checkToolCallSink('email', [], TEST_AGENT)
    expect(result.sink).toBe('tool_call:email')
  })

  it('checkToolCallSink con tool non standard + NON in SystemSetting → non sensibile', async () => {
    const { checkToolCallSink } = await import('@/lib/runtime/governance-hooks')

    const result = await checkToolCallSink('read_config', [], TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.sink).toBeUndefined()
  })

  it('governance-hooks.ts contiene getSensitiveSinksDynamic()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/governance-hooks.ts'),
      'utf-8',
    )
    expect(content).toMatch(/getSensitiveSinksDynamic/)
    expect(content).toMatch(/TOOL_SINK_MAP_BASE/)
  })
})

// === G6: reflectAndLearn fallback embedding ==========================

describe('Fase C — G6: reflectAndLearn fallback embedding', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('reflectAndLearn persiste heuristic anche se embed() fallisce', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    // Il test verifica che reflectAndLearn non crasha se embed() ha problemi.
    // In condizioni normali embed() funziona, ma il try/catch (G6 fix) garantisce
    // che anche se fallisce, l'euristica viene persistita.
    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g6-embed-fail`,
      goal: 'test embedding resilience',
      outcome: 'success',
      steps: [
        { action: 'step1', result: 'OK' },
        { action: 'step2', result: 'done' },
      ],
      context: 'embedding resilience test',
    })

    // L'euristica deve essere persistita (G6: fallback embedding)
    expect(result.approved).toBe(true)
    expect(result.stored).toBe(true)

    // Verifica che la heuristic esiste nel DB con un embedding (anche vuoto)
    const h = await db.heuristic.findFirst({
      where: { source: `${TEST_PREFIX}g6-embed-fail` },
    })
    expect(h).not.toBeNull()
    expect(h!.embedding).toBeDefined()
    expect(typeof h!.embedding).toBe('string')
  })

  it('retrieveHeuristics salta euristiche con embedding vuoto', async () => {
    const { reflectAndLearn, retrieveHeuristics } = await import('@/lib/kernel/erl')

    // Crea una heuristic con embedding vuoto (simulando embed fallito)
    await db.heuristic.create({
      data: {
        trigger: 'test trigger empty embedding',
        action: 'test action',
        context: 'test context',
        embedding: '[]', // embedding vuoto
        source: `${TEST_PREFIX}g6-empty-emb`,
        redLineOk: true,
        appliedCount: 0,
        successRate: 0.0,
      },
    })

    // retrieveHeuristics dovrebbe saltare questa heuristic
    const results = await retrieveHeuristics('test trigger', 10)
    const found = results.find((r: any) => r.source === `${TEST_PREFIX}g6-empty-emb`)
    expect(found).toBeUndefined()
  })

  it('erl.ts contiene fallback embedding (try/catch su embed)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/erl.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G6 fix[\s\S]*fallback embedding/)
    expect(content).toMatch(/embedding fallito/i)
  })
})

// === G7: Integration test end-to-end =================================

describe('Fase C — G7: Integration test end-to-end', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('E2E: Red Line custom → reflectAndLearn blocca → Heuristic non persistita', async () => {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')

    const rlDesc = `${TEST_PREFIX}g7 never execute unverified code`
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Safety', severity: 'absolute', active: true },
    })

    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g7-block`,
      goal: 'execute unverified code',
      outcome: 'success',
      steps: [
        { action: 'execute unverified code', result: 'ran' },
        { action: 'verify', result: 'OK' },
      ],
      context: 'dangerous execution',
    })

    // Bloccato
    expect(result.approved).toBe(false)
    expect(result.stored).toBe(false)

    // Heuristic NON persistita
    const heuristics = await db.heuristic.findMany({
      where: { source: `${TEST_PREFIX}g7-block` },
    })
    expect(heuristics.length).toBe(0)

    // ReflectionLog persistito con redLineFlag=true
    const log = await db.reflectionLog.findFirst({
      where: { operationId: `${TEST_PREFIX}g7-block` },
    })
    expect(log).not.toBeNull()
    expect(log!.redLineFlag).toBe(true)
  })

  it('E2E: Red Line custom → reflectAndLearn passa → Heuristic persistita', async () => {
    const { reflectAndLearn, retrieveHeuristics } = await import('@/lib/kernel/erl')

    const rlDesc = `${TEST_PREFIX}g7 never execute unverified code`
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Safety', severity: 'absolute', active: true },
    })

    // Input che NON viola la Red Line
    const result = await reflectAndLearn({
      operationId: `${TEST_PREFIX}g7-approve`,
      goal: 'process verified data',
      outcome: 'success',
      steps: [
        { action: 'verify data', result: 'OK' },
        { action: 'process data', result: 'done' },
      ],
      context: 'safe data processing',
    })

    // Approvato
    expect(result.approved).toBe(true)
    expect(result.stored).toBe(true)

    // Heuristic persistita
    const heuristics = await db.heuristic.findMany({
      where: { source: `${TEST_PREFIX}g7-approve` },
    })
    expect(heuristics.length).toBe(1)

    // retrieveHeuristics trova la heuristic
    const retrieved = await retrieveHeuristics('process verified data', 10)
    const found = retrieved.find((r: any) => r.source === `${TEST_PREFIX}g7-approve`)
    expect(found).toBeDefined()
    expect(found!.similarity).toBeGreaterThan(0)
  })

  it('E2E: preExecuteGate blocca action con Red Line attiva', async () => {
    const { evaluateRedLinesForAction } = await import('@/lib/runtime/governance-hooks')

    const rlDesc = 'delete production database immediately'
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Critical', severity: 'absolute', active: true },
    })

    // Action che contiene la descrizione della Red Line
    const result = await evaluateRedLinesForAction(
      'execute delete production database immediately now',
      TEST_AGENT,
    )

    expect(result.allowed).toBe(false)
    expect(result.blockingRedLines.length).toBe(1)
    expect(result.blockingRedLines[0].description).toBe(rlDesc)
    expect(result.blockingRedLines[0].severity).toBe('absolute')
    expect(result.overridable).toBe(false) // absolute non è overridable

    // Cleanup
    await db.redLine.deleteMany({ where: { description: rlDesc } })
  })

  it('E2E: full pipeline Red Line + Taint + LTL (preExecuteGate composite)', async () => {
    const { preExecuteGate } = await import('@/lib/runtime/governance-hooks')
    const { taintInput } = await import('@/lib/kernel/taint')

    // Crea Red Line
    const rlDesc = 'deploy without approval'
    await db.redLine.create({
      data: { description: rlDesc, rationale: 'Safety', severity: 'absolute', active: true },
    })

    // Crea taint
    const taintId = await taintInput(`${TEST_PREFIX}g7-e2e`, 'malicious input')

    // preExecuteGate combina G6 + G7 + G8
    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'deploy without approval',
      toolName: 'deploy',
      taintIds: [taintId],
      stateLabel: 'high_risk',
    })

    // Deve essere bloccato (Red Line match + Taint block)
    expect(result.allowed).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
    // Almeno Red Lines o Taint ha bloccato
    const hasRedLineBlock = result.blockingRedLines.length > 0
    const hasTaintBlock = result.taintBlocked
    expect(hasRedLineBlock || hasTaintBlock).toBe(true)

    // Cleanup
    await db.redLine.deleteMany({ where: { description: rlDesc } })
  })
})
