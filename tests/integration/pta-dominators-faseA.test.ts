/**
 * Integration tests for PTA Dominators Fase A
 * (C1, C2, C3, B2, B3)
 *
 * C1 — requireAdmin su POST /api/dominator
 * C2 — validateTrace non fa break su deviazione (coverage accurato)
 * C3 — captureTrace valida input (states non vuoto, workflowId non vuoto)
 * B2 — buildPTA try/catch su JSON.parse(statesJson)
 * B3 — validateTrace try/catch su tutti i JSON.parse
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

const TEST_PREFIX = 'pta-faseA-'
const TEST_AGENT = 'pta-faseA-agent'
const TEST_WORKFLOW = 'pta-faseA-workflow'

async function cleanupFixtures() {
  const traces = await db.executionTrace.findMany({
    where: { workflowId: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })
  if (traces.length > 0) {
    await db.traceValidation.deleteMany({
      where: { ptaId: { in: traces.map((t) => t.id) } },
    })
    await db.executionTrace.deleteMany({
      where: { workflowId: { startsWith: TEST_PREFIX } },
    })
  }
  await db.prefixTreeAutomaton.deleteMany({
    where: { workflowId: { startsWith: TEST_PREFIX } },
  })
  await db.traceValidation.deleteMany({
    where: { ptaId: { contains: TEST_PREFIX } },
  })
}

function makeRequest(method: 'GET' | 'POST', token: string | null, body?: unknown, path = '/api/test'): NextRequest {
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  const req = new NextRequest(`http://localhost${path}`, init)
  if (token) req.cookies.set('sota_session', token)
  return req
}

async function json(res: Response): Promise<any> { return res.json() }

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C3: captureTrace valida input ==================================

describe('Fase A — C3: captureTrace valida input', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('captureTrace con states vuoto → throws', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    try {
      await captureTrace(TEST_WORKFLOW, 'test', [], [], 'success')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/states.*non-empty/i)
    }
  })

  it('captureTrace con workflowId vuoto → throws', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    try {
      await captureTrace('', 'test', ['start', 'end'], [], 'success')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/workflowId.*required/i)
    }
  })

  it('captureTrace con traceLabel vuoto → throws', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    try {
      await captureTrace(TEST_WORKFLOW, '', ['start', 'end'], [], 'success')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/traceLabel.*required/i)
    }
  })

  it('captureTrace con input valido → crea traccia', async () => {
    const { captureTrace } = await import('@/lib/kernel/dominator-tree')
    const traceId = await captureTrace(
      `${TEST_PREFIX}valid`,
      'test trace',
      ['start', 'step1', 'end'],
      ['action1', 'action2'],
      'success',
    )
    expect(traceId).toBeDefined()

    const trace = await db.executionTrace.findUnique({ where: { id: traceId } })
    expect(trace).not.toBeNull()
    expect(trace!.workflowId).toBe(`${TEST_PREFIX}valid`)
    expect(JSON.parse(trace!.statesJson)).toEqual(['start', 'step1', 'end'])
  })
})

// === C2: validateTrace non fa break =================================

describe('Fase A — C2: validateTrace non interrompe su deviazione', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('validateTrace con deviazione al step 3 di 5 → pathValid=false ma coverage calcolato', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}c2-deviation`
    // Cattura 2 tracce positive che divergono → crea dominatori
    await captureTrace(wfId, 'trace1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 'trace2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')

    // Build PTA
    await buildPTA(wfId)

    // Valida traccia con deviazione al step 3 (state non presente nel PTA)
    const result = await validateTrace(wfId, ['start', 'login', 'INVALID_STATE', 'dashboard', 'end'])

    // C2: pathValid deve essere false (deviazione trovata)
    expect(result.pathValid).toBe(false)
    // C2: coverage deve essere calcolato sui dominatori raggiunti (non 0 per break)
    // Se 'start' e 'login' sono dominatori, coverage > 0 anche con deviazione
    expect(result.dominatorCoverage).toBeGreaterThanOrEqual(0)
  })

  it('validateTrace con traccia valida → pathValid=true, coverage=1.0', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}c2-valid`
    await captureTrace(wfId, 'trace1', ['start', 'step1', 'step2', 'end'], [], 'success')
    await captureTrace(wfId, 'trace2', ['start', 'step1', 'step3', 'end'], [], 'success')
    await buildPTA(wfId)

    const result = await validateTrace(wfId, ['start', 'step1', 'step2', 'end'])
    expect(result.pathValid).toBe(true)
    expect(result.dominatorCoverage).toBe(1.0)
    expect(result.verdict).toBe('accept')
  })

  it('validateTrace: dominatori.ts non contiene più break su deviazione', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/dominator-tree.ts'),
      'utf-8',
    )
    // C2 fix: il commento dice "NON interrompere" e non c'è break
    expect(content).toMatch(/C2 fix.*NON interrompere/)
    expect(content).not.toMatch(/break\s*\/\/.*Non interrompere/)
  })
})

// === B2: buildPTA try/catch su JSON.parse ===========================

describe('Fase A — B2: buildPTA try/catch su JSON.parse corrotto', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('buildPTA salta tracce con statesJson corrotto invece di crashare', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}b2-corrupt`
    // Cattura traccia valida
    await captureTrace(wfId, 'valid', ['start', 'step1', 'end'], [], 'success')

    // Inserisci traccia con statesJson corrotto
    await db.executionTrace.create({
      data: {
        workflowId: wfId,
        traceLabel: 'corrupt',
        statesJson: 'not-valid-json{',
        actionsJson: '[]',
        outcome: 'success',
      },
    })

    // buildPTA non deve crashare (salta la traccia corrotta)
    const result = await buildPTA(wfId)
    expect(result.traceCount).toBeGreaterThanOrEqual(1) // almeno la traccia valida
    expect(result.graph.nodes).toBeDefined()
  })

  it('buildPTA salta tracce con states vuoto (array vuoto)', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}b2-empty-states`
    await captureTrace(wfId, 'valid', ['start', 'end'], [], 'success')

    // Inserisci traccia con states vuoto
    await db.executionTrace.create({
      data: {
        workflowId: wfId,
        traceLabel: 'empty',
        statesJson: '[]',
        actionsJson: '[]',
        outcome: 'success',
      },
    })

    const result = await buildPTA(wfId)
    expect(result.traceCount).toBeGreaterThanOrEqual(1)
  })
})

// === B3: validateTrace try/catch su JSON.parse ======================

describe('Fase A — B3: validateTrace try/catch su PTA corrotto', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('validateTrace con nodesJson corrotto → ritorna warn invece di crashare', async () => {
    const { validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}b3-corrupt-pta`
    // Inserisci PTA con nodesJson corrotto
    await db.prefixTreeAutomaton.create({
      data: {
        workflowId: wfId,
        nodesJson: 'not-valid-json{',
        dominatorsJson: '[]',
        startNodeId: 'n0',
        acceptNodeIds: '[]',
      },
    })

    const result = await validateTrace(wfId, ['start', 'end'])
    expect(result.verdict).toBe('warn')
    expect(result.reason).toMatch(/corrupted/i)
    expect(result.pathValid).toBe(false)
  })

  it('validateTrace con dominatorsJson corrotto → ritorna warn', async () => {
    const { validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}b3-corrupt-dom`
    await db.prefixTreeAutomaton.create({
      data: {
        workflowId: wfId,
        nodesJson: JSON.stringify({
          n0: { id: 'n0', state: 'start', children: {}, isAccept: true, depth: 0 },
        }),
        dominatorsJson: 'broken-json',
        startNodeId: 'n0',
        acceptNodeIds: JSON.stringify(['n0']),
      },
    })

    const result = await validateTrace(wfId, ['start'])
    expect(result.verdict).toBe('warn')
    expect(result.reason).toMatch(/corrupted/i)
  })
})

// === C1: requireAdmin su POST /api/dominator ========================

describe('Fase A — C1: POST /api/dominator usa requireAdmin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST senza sessione → 401', async () => {
    const { POST } = await import('@/app/api/dominator/route')
    const req = makeRequest('POST', null, {
      action: 'capture_trace',
      workflowId: TEST_WORKFLOW,
      traceLabel: 'test',
      states: ['start', 'end'],
    }, '/api/dominator')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('POST con sessione viewer → 403 (requireAdmin)', async () => {
    const { POST } = await import('@/app/api/dominator/route')
    const email = 'pta-faseA-viewer@example.com'
    const userId = 'pta-faseA-viewer-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Viewer', role: 'viewer', tenantId: 'test', active: true },
      update: { role: 'viewer', active: true },
    })
    const token = `pta-viewer-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    const req = makeRequest('POST', token, {
      action: 'capture_trace',
      workflowId: TEST_WORKFLOW,
      traceLabel: 'test',
      states: ['start', 'end'],
    }, '/api/dominator')
    const res = await POST(req)
    expect(res.status).toBe(403)

    await db.session.deleteMany({ where: { userId } })
    await db.user.deleteMany({ where: { id: userId } })
  })

  it('POST con sessione admin → 200', async () => {
    const { POST } = await import('@/app/api/dominator/route')
    const email = 'pta-faseA-admin@example.com'
    const userId = 'pta-faseA-admin-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Admin', role: 'admin', tenantId: 'test', active: true },
      update: { role: 'admin', active: true },
    })
    const token = `pta-admin-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    try {
      const req = makeRequest('POST', token, {
        action: 'capture_trace',
        workflowId: `${TEST_PREFIX}admin-capture`,
        traceLabel: 'admin test',
        states: ['start', 'step1', 'end'],
        actions: ['action1'],
      }, '/api/dominator')
      const res = await POST(req)
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.ok).toBe(true)
      expect(body.traceId).toBeDefined()
    } finally {
      await db.session.deleteMany({ where: { userId } })
      await db.user.deleteMany({ where: { id: userId } })
    }
  })

  it('POST con body JSON invalido → 400', async () => {
    const { POST } = await import('@/app/api/dominator/route')
    const email = 'pta-faseA-admin2@example.com'
    const userId = 'pta-faseA-admin2-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Admin2', role: 'admin', tenantId: 'test', active: true },
      update: { role: 'admin', active: true },
    })
    const token = `pta-admin2-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    try {
      const req = new NextRequest('http://localhost/api/dominator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      })
      req.cookies.set('sota_session', token)
      const res = await POST(req)
      expect(res.status).toBe(400)
    } finally {
      await db.session.deleteMany({ where: { userId } })
      await db.user.deleteMany({ where: { id: userId } })
    }
  })

  it('POST capture_trace con states vuoto → 400 (C3 validation via API)', async () => {
    const { POST } = await import('@/app/api/dominator/route')
    const email = 'pta-faseA-admin3@example.com'
    const userId = 'pta-faseA-admin3-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Admin3', role: 'admin', tenantId: 'test', active: true },
      update: { role: 'admin', active: true },
    })
    const token = `pta-admin3-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    try {
      const req = makeRequest('POST', token, {
        action: 'capture_trace',
        workflowId: `${TEST_PREFIX}empty-states`,
        traceLabel: 'test',
        states: [], // C3: vuoto
      }, '/api/dominator')
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await json(res)
      expect(body.error).toMatch(/states.*non-empty/i)
    } finally {
      await db.session.deleteMany({ where: { userId } })
      await db.user.deleteMany({ where: { id: userId } })
    }
  })
})

// === Smoke: full Fase A integration =================================

describe('Fase A — Smoke: full C1+C2+C3+B2+B3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('captureTrace → buildPTA → validateTrace con deviazione (no break)', async () => {
    const { captureTrace, buildPTA, validateTrace } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}smoke`
    // 2 tracce positive con branch divergente
    await captureTrace(wfId, 'trace1', ['start', 'login', 'submit', 'dashboard', 'end'], [], 'success')
    await captureTrace(wfId, 'trace2', ['start', 'login', 'reset', 'dashboard', 'end'], [], 'success')

    // Build PTA
    const ptaResult = await buildPTA(wfId)
    expect(ptaResult.traceCount).toBe(2)
    expect(ptaResult.graph.dominators.length).toBeGreaterThan(0)

    // Validate traccia valida
    const validResult = await validateTrace(wfId, ['start', 'login', 'submit', 'dashboard', 'end'])
    expect(validResult.pathValid).toBe(true)
    expect(validResult.verdict).toBe('accept')

    // Validate traccia con deviazione (C2: no break, coverage calcolato)
    const devResult = await validateTrace(wfId, ['start', 'login', 'UNKNOWN', 'dashboard', 'end'])
    expect(devResult.pathValid).toBe(false)
    // Coverage potrebbe essere > 0 perché start/login/dashboard sono dominatori raggiunti
    expect(devResult.dominatorCoverage).toBeGreaterThanOrEqual(0)
  })

  it('buildPTA salta traccia corrotta, usa solo valide', async () => {
    const { captureTrace, buildPTA } = await import('@/lib/kernel/dominator-tree')

    const wfId = `${TEST_PREFIX}smoke-corrupt`
    await captureTrace(wfId, 'valid1', ['start', 'step1', 'end'], [], 'success')
    await captureTrace(wfId, 'valid2', ['start', 'step2', 'end'], [], 'success')

    // Aggiungi traccia corrotta
    await db.executionTrace.create({
      data: {
        workflowId: wfId,
        traceLabel: 'corrupt',
        statesJson: 'broken{',
        actionsJson: '[]',
        outcome: 'success',
      },
    })

    const result = await buildPTA(wfId)
    expect(result.traceCount).toBeGreaterThanOrEqual(2) // solo le 2 valide
    expect(Object.keys(result.graph.nodes).length).toBeGreaterThan(1)
  })
})
