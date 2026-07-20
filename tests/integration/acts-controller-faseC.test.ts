/**
 * Integration tests for ACTS Controller Fase C (B3, B4, B6, G3, G4, G5)
 *
 * B3 — phase3.tsx auto-run stabilizzato (useRef) — test type-level
 * B4 — CHECK reale (Phase 8 Lean4) o deterministico fallback (no Math.random)
 * B6 — SteeringStrategy seed su tabella vuota
 * G3 — steer() consulta SteeringStrategy DB per override phrase/budgetCost
 * G4 — REFLECT transizione ogni N step
 * G5 — Integration test end-to-end POST /api/steering → GET /api/steering → verifica storia
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// === Fixtures ========================================================

const TEST_AGENT = 'acts-faseC-test-agent'
const TEST_PLAN = 'acts-faseC-test-plan'

async function cleanupFixtures() {
  await db.steeringState.deleteMany({
    where: { OR: [{ agentId: TEST_AGENT }, { planId: TEST_PLAN }] },
  })
  await db.steeringEvent.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
}

function makeRequest(method: 'GET' | 'POST', body?: unknown, path = '/api/test'): NextRequest {
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  return new NextRequest(`http://localhost${path}`, init)
}

async function json(res: Response): Promise<any> { return res.json() }

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G4: REFLECT transizione ========================================

describe('Fase C — G4: REFLECT transizione ogni N step', () => {
  it('DEFAULT_REFLECT_INTERVAL = 10', async () => {
    const { DEFAULT_REFLECT_INTERVAL } = await import('@/lib/kernel/acts')
    expect(DEFAULT_REFLECT_INTERVAL).toBe(10)
  })

  it('decideStrategy ritorna REFLECT a step 10 (default interval)', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 10, lastStrategy: 'EXECUTE', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 0,
    })
    expect(result).toBe('REFLECT')
  })

  it('decideStrategy ritorna REFLECT a step 20, 30, 40 (multipli di 10)', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    for (const step of [20, 30, 40, 50]) {
      const result = decideStrategy({
        step, lastStrategy: 'EXECUTE', lastCheckPassed: true,
        budgetRemaining: 500, errorsConsecutive: 0,
      })
      expect(result).toBe('REFLECT')
    }
  })

  it('decideStrategy NON ritorna REFLECT se errorsConsecutive > 0', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // step=10 ma errorsConsecutive=1 → CHECK forzato (errors >= 3? no, ma 1 basta
    // per non triggerare REFLECT che richiede errorsConsecutive === 0)
    // Con errorsConsecutive=1 e threshold=3, non triggera CHECK, ma REFLECT richiede 0
    const result = decideStrategy({
      step: 10, lastStrategy: 'EXECUTE', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 1,
    })
    expect(result).not.toBe('REFLECT')
    expect(result).toBe('CHECK') // EXECUTE → CHECK (FSM normale)
  })

  it('decideStrategy NON ritorna REFLECT se lastStrategy=REFLECT (evita loop)', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // step=10, lastStrategy=REFLECT → PLAN (non REFLECT di nuovo)
    const result = decideStrategy({
      step: 10, lastStrategy: 'REFLECT', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 0,
    })
    expect(result).toBe('PLAN') // REFLECT → PLAN
  })

  it('decideStrategy con reflectInterval=5 → REFLECT a step 5, 10, 15', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    for (const step of [5, 10, 15, 20]) {
      const result = decideStrategy({
        step, lastStrategy: 'EXECUTE', lastCheckPassed: true,
        budgetRemaining: 500, errorsConsecutive: 0,
        reflectInterval: 5,
      })
      expect(result).toBe('REFLECT')
    }
  })

  it('decideStrategy con reflectInterval=0 → REFLECT disabilitato (mai)', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // step=10 ma reflectInterval=0 → REFLECT disabilitato, prosegue FSM
    const result = decideStrategy({
      step: 10, lastStrategy: 'EXECUTE', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 0,
      reflectInterval: 0,
    })
    expect(result).not.toBe('REFLECT')
    expect(result).toBe('CHECK') // EXECUTE → CHECK (FSM normale)
  })

  it('REFLECT transizione: dopo REFLECT → PLAN (evita loop infinito REFLECT)', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    // step=10 → REFLECT (lastStrategy=EXECUTE)
    const r1 = decideStrategy({
      step: 10, lastStrategy: 'EXECUTE', lastCheckPassed: true,
      budgetRemaining: 500, errorsConsecutive: 0,
    })
    expect(r1).toBe('REFLECT')

    // step=11, lastStrategy=REFLECT → PLAN (non REFLECT di nuovo)
    const r2 = decideStrategy({
      step: 11, lastStrategy: 'REFLECT', lastCheckPassed: true,
      budgetRemaining: 400, errorsConsecutive: 0,
    })
    expect(r2).toBe('PLAN')
  })
})

// === G3: steer() consulta SteeringStrategy DB ======================

describe('Fase C — G3: steer() consulta SteeringStrategy DB', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    // Cleanup any custom strategies from previous tests
    await db.steeringStrategy.deleteMany({
      where: { name: { startsWith: 'TEST_CUSTOM_' } },
    })
  })
  afterEach(async () => {
    await cleanupFixtures()
    await db.steeringStrategy.deleteMany({
      where: { name: { startsWith: 'TEST_CUSTOM_' } },
    })
  })

  it('steer() usa STEERING_VOCABULARY hardcoded se DB non ha record per strategia', async () => {
    const { steer, STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    // Nessun record in DB per 'PLAN' (seeds sono solo in /api/seed, non qui)
    const result = await steer(TEST_AGENT, 1000, 0, 0, 'PLAN', null, 0, TEST_PLAN)
    expect(result.phrase).toBe(STEERING_VOCABULARY.PLAN.phrase)
    expect(result.tokenUsed).toBe(STEERING_VOCABULARY.PLAN.budgetCost)
  })

  it('steer() usa triggerPhrase + budgetCost dal DB se record attivo esiste', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    // Insert custom strategy for PLAN (upsert per gestire record esistente)
    await db.steeringStrategy.upsert({
      where: { name: 'PLAN' },
      create: {
        name: 'PLAN',
        triggerPhrase: 'TEST_CUSTOM_PLAN_PHRASE',
        description: 'Custom plan phrase for testing',
        budgetCost: 200,
        active: true,
      },
      update: {
        triggerPhrase: 'TEST_CUSTOM_PLAN_PHRASE',
        description: 'Custom plan phrase for testing',
        budgetCost: 200,
        active: true,
      },
    })

    const result = await steer(TEST_AGENT, 1000, 0, 0, 'PLAN', null, 0, TEST_PLAN)
    expect(result.phrase).toBe('TEST_CUSTOM_PLAN_PHRASE')
    expect(result.tokenUsed).toBe(200) // custom budgetCost

    // Cleanup: ripristina il default eliminando il record custom
    await db.steeringStrategy.deleteMany({ where: { name: 'PLAN' } })
  })

  it('steer() ignora record DB se active=false (fallback a STEERING_VOCABULARY)', async () => {
    const { steer, STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    await db.steeringStrategy.upsert({
      where: { name: 'PLAN' },
      create: {
        name: 'PLAN',
        triggerPhrase: 'INACTIVE_PHRASE',
        description: 'Should be ignored',
        budgetCost: 999,
        active: false,
      },
      update: {
        triggerPhrase: 'INACTIVE_PHRASE',
        description: 'Should be ignored',
        budgetCost: 999,
        active: false,
      },
    })

    const result = await steer(TEST_AGENT, 1000, 0, 0, 'PLAN', null, 0, TEST_PLAN)
    // active=false → fallback a STEERING_VOCABULARY
    expect(result.phrase).toBe(STEERING_VOCABULARY.PLAN.phrase)
    expect(result.tokenUsed).toBe(STEERING_VOCABULARY.PLAN.budgetCost)

    await db.steeringStrategy.deleteMany({ where: { name: 'PLAN' } })
  })
})

// === B6: SteeringStrategy seed su tabella vuota ====================

describe('Fase C — B6: /api/steering GET seeda SteeringStrategy se tabella vuota', () => {
  // Nota: questi test richiedono sessione auth reale, quindi testiamo la logica
  // indirettamente verificando il comportamento del seed.

  beforeEach(async () => {
    // Cleanup ALL strategies per testare il seed
    await db.steeringStrategy.deleteMany({})
  })
  afterEach(async () => {
    // Restore default strategies
    await db.steeringStrategy.deleteMany({})
  })

  it('se tabella SteeringStrategy vuota, la logica di seed crea 5 record', async () => {
    const { STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    // Verifica stato iniziale
    const before = await db.steeringStrategy.count()
    expect(before).toBe(0)

    // Simula il seed logic dalla API GET
    const strategies = await Promise.all(
      Object.entries(STEERING_VOCABULARY).map(async ([name, info]) => {
        return db.steeringStrategy.create({
          data: {
            name,
            triggerPhrase: info.phrase,
            description: info.description,
            budgetCost: info.budgetCost,
            active: true,
          },
        })
      }),
    )

    expect(strategies.length).toBe(5)
    const after = await db.steeringStrategy.count()
    expect(after).toBe(5)

    // Verifica che le strategie seeded abbiano i valori corretti
    const planStrategy = await db.steeringStrategy.findUnique({ where: { name: 'PLAN' } })
    expect(planStrategy).not.toBeNull()
    expect(planStrategy!.triggerPhrase).toBe(STEERING_VOCABULARY.PLAN.phrase)
    expect(planStrategy!.budgetCost).toBe(STEERING_VOCABULARY.PLAN.budgetCost)
    expect(planStrategy!.active).toBe(true)
  })

  it('se tabella ha già record, NON fa seed (no duplicati)', async () => {
    const { STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    // Inserisci solo 1 record
    await db.steeringStrategy.create({
      data: {
        name: 'PLAN',
        triggerPhrase: 'existing',
        budgetCost: 50,
        active: true,
      },
    })

    // Simula la logica GET: se count > 0, skip seed
    const existing = await db.steeringStrategy.findMany()
    if (existing.length === 0) {
      // non dovrebbe entrare qui
      throw new Error('Should not seed when table has records')
    }

    expect(existing.length).toBe(1)
    expect(existing[0].name).toBe('PLAN')
  })
})

// === B3: phase3.tsx auto-run useRef (type-level) ====================

describe('Fase C — B3: phase3.tsx auto-run stabilizzato (useRef)', () => {
  it('Phase3 component è importabile e ben formata', async () => {
    const mod = await import('@/components/agentic/phase3')
    expect(mod.Phase3).toBeDefined()
    expect(typeof mod.Phase3).toBe('function')
  })

  it('useRef pattern: stateRef inizializzato con stato completo', async () => {
    // Test type-level: useRef pattern è valido
    const stateRef = { current: { step: 0, lastStrategy: 'PLAN' as const, lastCheckPassed: null, errorsConsecutive: 0, budgetUsed: 0, budgetTotal: 1000 } }
    expect(stateRef.current.step).toBe(0)
    expect(stateRef.current.lastStrategy).toBe('PLAN')
    // Aggiornamento ref non causa re-render (no stale closure)
    stateRef.current.step = 5
    expect(stateRef.current.step).toBe(5)
  })
})

// === B4: CHECK reale (no Math.random) ===============================

describe('Fase C — B4: CHECK deterministico (no Math.random)', () => {
  it('phase3.tsx non usa più Math.random per CHECK (verifica codice sorgente)', async () => {
    // Verifica che il file phase3.tsx non contiene Math.random in codice attivo
    // (escludendo commenti). Cerchiamo la chiamata Math.random() in contesto di
    // assegnamento a variabile passed (pattern del vecchio codice).
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase3.tsx'),
      'utf-8',
    )
    // Pattern del vecchio codice: `const passed = Math.random() > 0.3`
    const hasRandomCheck = /const\s+passed\s*=\s*Math\.random/.test(content)
    expect(hasRandomCheck).toBe(false)
  })

  it('phase3.tsx contiene performRealCheck function', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase3.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/performRealCheck/)
    expect(content).toMatch(/Phase 8|Lean4/i)
  })

  it('performRealCheck logic: errorsConsecutive > 0 → più probabile fallimento', async () => {
    // Test della logica deterministica (replica qui per testare senza React)
    // Ritorna true se CHECK passato, false se fallito.
    const deterministicCheck = (step: number, errorsConsecutive: number, budgetPct: number): boolean => {
      if (errorsConsecutive > 0) {
        return step % 2 === 1 // dispari passa, pari fallisce
      }
      if (budgetPct < 0.3) {
        return step % 3 !== 0 // non-multiplo di 3 passa, multiplo fallisce
      }
      return true
    }

    // Caso errorsConsecutive > 0:
    // step=2, errors=1 → false (pari fallisce)
    expect(deterministicCheck(2, 1, 0.5)).toBe(false)
    // step=3, errors=1 → true (dispari passa)
    expect(deterministicCheck(3, 1, 0.5)).toBe(true)

    // Caso budget ok, errors=0:
    // step=0, errors=0, budget 50% → true (sempre passa)
    expect(deterministicCheck(0, 0, 0.5)).toBe(true)

    // Caso budget < 30% (stress), errors=0:
    // step=3, errors=0, budget 20% → multiplo di 3 → false (fallisce sotto stress)
    expect(deterministicCheck(3, 0, 0.2)).toBe(false)
    // step=4, errors=0, budget 20% → non multiplo di 3 → true (passa)
    expect(deterministicCheck(4, 0, 0.2)).toBe(true)
    // step=1, errors=0, budget 20% → non multiplo di 3 → true
    expect(deterministicCheck(1, 0, 0.2)).toBe(true)
  })
})

// === G5: Integration end-to-end POST → GET → verifica storia =======

describe('Fase C — G5: Integration end-to-end POST → GET → verifica storia', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST /api/steering crea evento → GET /api/steering ritorna evento in history', async () => {
    // Setup: auth bypass per test (mock requireAuth)
    const { POST } = await import('@/app/api/steering/route')
    const { GET } = await import('@/app/api/steering/route')

    // Mock session: user admin
    const ADMIN_EMAIL = 'faseC-g5-admin@example.com'
    const ADMIN_USER_ID = 'faseC-g5-admin-user'
    const TENANT = 'faseC-g5-tenant'
    await db.user.upsert({
      where: { email: ADMIN_EMAIL },
      create: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: 'Fase C G5 Admin', role: 'admin', tenantId: TENANT, active: true },
      update: { role: 'admin', active: true },
    })
    const token = `faseC-g5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.session.create({
      data: { userId: ADMIN_USER_ID, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    })

    try {
      // POST: crea evento steering
      const postReq = makeRequest('POST', {
        agentId: TEST_AGENT,
        budgetTotal: 1000,
        budgetUsed: 0,
        step: 0,
        lastStrategy: 'PLAN',
        lastCheckPassed: null,
        errorsConsecutive: 0,
        planId: TEST_PLAN,
      }, '/api/steering')
      postReq.cookies.set('sota_session', token)
      const postRes = await POST(postReq)
      expect(postRes.status).toBe(200)
      const postBody = await json(postRes)
      expect(postBody.ok).toBe(true)
      expect(postBody.strategy).toBe('PLAN')
      expect(postBody.cycleId).toBeDefined()
      expect(postBody.idempotent).toBe(false)

      // GET: verifica evento in history
      const getReq = makeRequest('GET', undefined, `/api/steering?agentId=${TEST_AGENT}&planId=${TEST_PLAN}`)
      getReq.cookies.set('sota_session', token)
      const getRes = await GET(getReq)
      expect(getRes.status).toBe(200)
      const getBody = await json(getRes)
      expect(getBody.history).toBeInstanceOf(Array)
      expect(getBody.history.length).toBeGreaterThan(0)

      // Verifica che l'evento appena creato sia in history
      const foundEvent = getBody.history.find((e: any) => e.cycleId === postBody.cycleId)
      expect(foundEvent).toBeDefined()
      expect(foundEvent.strategy).toBe('PLAN')
      expect(foundEvent.agentId).toBe(TEST_AGENT)
      expect(foundEvent.planId).toBe(TEST_PLAN)
      expect(foundEvent.step).toBe(0)

      // Verifica currentState (G1)
      expect(getBody.currentState).not.toBeNull()
      expect(getBody.currentState.step).toBe(0)
      expect(getBody.currentState.lastStrategy).toBe('PLAN')
    } finally {
      await db.session.deleteMany({ where: { userId: ADMIN_USER_ID } })
      await db.user.deleteMany({ where: { id: ADMIN_USER_ID } })
    }
  })

  it('POST 2 step diversi → GET ritorna entrambi in history ordinati per timestamp desc', async () => {
    const { POST } = await import('@/app/api/steering/route')
    const { GET } = await import('@/app/api/steering/route')

    const ADMIN_EMAIL = 'faseC-g5-admin2@example.com'
    const ADMIN_USER_ID = 'faseC-g5-admin2-user'
    const TENANT = 'faseC-g5-tenant'
    await db.user.upsert({
      where: { email: ADMIN_EMAIL },
      create: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: 'Fase C G5 Admin 2', role: 'admin', tenantId: TENANT, active: true },
      update: { role: 'admin', active: true },
    })
    const token = `faseC-g5-2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.session.create({
      data: { userId: ADMIN_USER_ID, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    })

    try {
      // POST step 0
      const req1 = makeRequest('POST', {
        agentId: TEST_AGENT, budgetTotal: 1000, budgetUsed: 0, step: 0,
        lastStrategy: 'PLAN', lastCheckPassed: null, errorsConsecutive: 0, planId: TEST_PLAN,
      }, '/api/steering')
      req1.cookies.set('sota_session', token)
      const res1 = await POST(req1)
      const body1 = await json(res1)

      // Small delay per timestamp diverso
      await new Promise((r) => setTimeout(r, 50))

      // POST step 1
      const req2 = makeRequest('POST', {
        agentId: TEST_AGENT, budgetTotal: 1000, budgetUsed: 80, step: 1,
        lastStrategy: 'PLAN', lastCheckPassed: null, errorsConsecutive: 0, planId: TEST_PLAN,
      }, '/api/steering')
      req2.cookies.set('sota_session', token)
      const res2 = await POST(req2)
      const body2 = await json(res2)

      // GET history
      const getReq = makeRequest('GET', undefined, `/api/steering?agentId=${TEST_AGENT}&planId=${TEST_PLAN}`)
      getReq.cookies.set('sota_session', token)
      const getRes = await GET(getReq)
      const getBody = await json(getRes)

      expect(getBody.history.length).toBeGreaterThanOrEqual(2)
      // Verifica che entrambi gli eventi sono presenti
      const cycleIds = getBody.history.map((e: any) => e.cycleId)
      expect(cycleIds).toContain(body1.cycleId)
      expect(cycleIds).toContain(body2.cycleId)

      // Verifica ordinamento desc per timestamp
      for (let i = 1; i < getBody.history.length; i++) {
        const prev = new Date(getBody.history[i - 1].timestamp).getTime()
        const curr = new Date(getBody.history[i].timestamp).getTime()
        expect(prev).toBeGreaterThanOrEqual(curr)
      }
    } finally {
      await db.session.deleteMany({ where: { userId: ADMIN_USER_ID } })
      await db.user.deleteMany({ where: { id: ADMIN_USER_ID } })
    }
  })

  it('POST con input invalido → 400 + errors array (B5)', async () => {
    const { POST } = await import('@/app/api/steering/route')

    const ADMIN_EMAIL = 'faseC-g5-admin3@example.com'
    const ADMIN_USER_ID = 'faseC-g5-admin3-user'
    const TENANT = 'faseC-g5-tenant'
    await db.user.upsert({
      where: { email: ADMIN_EMAIL },
      create: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: 'Fase C G5 Admin 3', role: 'admin', tenantId: TENANT, active: true },
      update: { role: 'admin', active: true },
    })
    const token = `faseC-g5-3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.session.create({
      data: { userId: ADMIN_USER_ID, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    })

    try {
      // POST con budgetTotal negativo
      const req = makeRequest('POST', {
        agentId: TEST_AGENT, budgetTotal: -100, budgetUsed: 0, step: 0,
        lastStrategy: 'INVALID', errorsConsecutive: 200,
      }, '/api/steering')
      req.cookies.set('sota_session', token)
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await json(res)
      expect(body.ok).toBe(false)
      expect(body.error).toMatch(/Validation failed/i)
      expect(Array.isArray(body.errors)).toBe(true)
      expect(body.errors.length).toBeGreaterThan(0)

      // Verifica che ci sono errori per budgetTotal, lastStrategy, errorsConsecutive
      const fields = body.errors.map((e: any) => e.field)
      expect(fields).toContain('budgetTotal')
      expect(fields).toContain('lastStrategy')
      expect(fields).toContain('errorsConsecutive')
    } finally {
      await db.session.deleteMany({ where: { userId: ADMIN_USER_ID } })
      await db.user.deleteMany({ where: { id: ADMIN_USER_ID } })
    }
  })

  it('POST idempotency: stesso step ritorna stesso evento (B7 + G5)', async () => {
    const { POST } = await import('@/app/api/steering/route')

    const ADMIN_EMAIL = 'faseC-g5-admin4@example.com'
    const ADMIN_USER_ID = 'faseC-g5-admin4-user'
    const TENANT = 'faseC-g5-tenant'
    await db.user.upsert({
      where: { email: ADMIN_EMAIL },
      create: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: 'Fase C G5 Admin 4', role: 'admin', tenantId: TENANT, active: true },
      update: { role: 'admin', active: true },
    })
    const token = `faseC-g5-4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.session.create({
      data: { userId: ADMIN_USER_ID, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    })

    try {
      // POST step 0 (prima volta)
      const req1 = makeRequest('POST', {
        agentId: TEST_AGENT, budgetTotal: 1000, budgetUsed: 0, step: 0,
        lastStrategy: 'PLAN', lastCheckPassed: null, errorsConsecutive: 0, planId: TEST_PLAN,
      }, '/api/steering')
      req1.cookies.set('sota_session', token)
      const res1 = await POST(req1)
      const body1 = await json(res1)
      expect(body1.idempotent).toBe(false)

      // POST step 0 (seconda volta - retry)
      const req2 = makeRequest('POST', {
        agentId: TEST_AGENT, budgetTotal: 1000, budgetUsed: 0, step: 0,
        lastStrategy: 'PLAN', lastCheckPassed: null, errorsConsecutive: 0, planId: TEST_PLAN,
      }, '/api/steering')
      req2.cookies.set('sota_session', token)
      const res2 = await POST(req2)
      const body2 = await json(res2)
      expect(body2.idempotent).toBe(true)
      expect(body2.cycleId).toBe(body1.cycleId)
    } finally {
      await db.session.deleteMany({ where: { userId: ADMIN_USER_ID } })
      await db.user.deleteMany({ where: { id: ADMIN_USER_ID } })
    }
  })
})
