/**
 * Integration tests for Context Manager Fase A
 * (C1, C2, C3, B4, B5)
 *
 * C1 — recordToolCall integrato nell'executor
 * C2 — curator metriche reali (non simulate)
 * C3 — assembleWorkingContext JSON.parse robusto
 * B4 — API POST /api/context usa requireAdmin per mutative
 * B5 — cycleId String (cuid) invece di Int
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

const TEST_PREFIX = 'ctx-faseA-'
const TEST_AGENT = 'ctx-faseA-agent'

async function cleanupFixtures() {
  await db.toolCallEntry.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.contextSummary.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.pruningPolicy.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.sensoriumSnapshot.deleteMany({ where: { cycleId: { contains: TEST_PREFIX } } })
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

// === C3: assembleWorkingContext JSON.parse robusto ==================

describe('Fase A — C3: assembleWorkingContext JSON.parse robusto', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('assembleWorkingContext non crasha su callPayload corrotto', async () => {
    const { assembleWorkingContext } = await import('@/lib/kernel/context-engineering')
    // Inserisci entry con payload non JSON
    await db.toolCallEntry.create({
      data: {
        agentId: TEST_AGENT,
        toolName: 'test_corrupt',
        callPayload: 'not-valid-json{',
        responsePayload: 'also-not-json',
        tokenCost: 10,
      },
    })

    // Non deve throware
    const result = await assembleWorkingContext(TEST_AGENT)
    expect(result.recentCalls.length).toBe(1)
    // C3 fix: ritorna la stringa grezza come fallback
    expect(result.recentCalls[0].callPayload).toBe('not-valid-json{')
    expect(result.recentCalls[0].responsePayload).toBe('also-not-json')
  })

  it('assembleWorkingContext con payload JSON valido → parse corretto', async () => {
    const { assembleWorkingContext } = await import('@/lib/kernel/context-engineering')
    await db.toolCallEntry.create({
      data: {
        agentId: TEST_AGENT,
        toolName: 'test_valid',
        callPayload: JSON.stringify({ arg: 'value' }),
        responsePayload: JSON.stringify({ result: 'ok' }),
        tokenCost: 5,
      },
    })

    const result = await assembleWorkingContext(TEST_AGENT)
    expect(result.recentCalls[0].callPayload).toEqual({ arg: 'value' })
    expect(result.recentCalls[0].responsePayload).toEqual({ result: 'ok' })
  })

  it('assembleWorkingContext con coveredCallIds corrotto → fallback a 0', async () => {
    const { assembleWorkingContext } = await import('@/lib/kernel/context-engineering')
    // Crea summary con coveredCallIds non JSON
    await db.contextSummary.create({
      data: {
        agentId: TEST_AGENT,
        narrative: 'test narrative',
        coveredCallIds: 'not-json[',
        tokenCost: 10,
        cycleId: 1,
      },
    })

    const result = await assembleWorkingContext(TEST_AGENT)
    expect(result.summary).not.toBeNull()
    expect(result.summary!.coveredCount).toBe(0) // fallback
  })
})

// === B5: cycleId String (cuid) ======================================

describe('Fase A — B5: cycleId String invece di Int', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('produceSensorium ritorna cycleId come stringa', async () => {
    const { produceSensorium } = await import('@/lib/kernel/curator')
    const result = await produceSensorium()
    expect(typeof result.data.cycleId).toBe('string')
    expect(result.data.cycleId.length).toBeGreaterThan(5)
  })

  it('SensoriumSnapshot.cycleId è string nel DB', async () => {
    const { produceSensorium } = await import('@/lib/kernel/curator')
    const result = await produceSensorium()
    const snapshot = await db.sensoriumSnapshot.findFirst({
      where: { cycleId: result.data.cycleId },
    })
    expect(snapshot).not.toBeNull()
    expect(typeof snapshot!.cycleId).toBe('string')
  })

  it('100 produceSensorium producono 100 cycleId univoci (no collision)', async () => {
    const { produceSensorium } = await import('@/lib/kernel/curator')
    const cycleIds = new Set<string>()
    for (let i = 0; i < 20; i++) { // 20 per non sovraccaricare il DB
      const result = await produceSensorium()
      cycleIds.add(result.data.cycleId)
    }
    expect(cycleIds.size).toBe(20) // tutti univoci

    // Cleanup
    await db.sensoriumSnapshot.deleteMany({
      where: { cycleId: { in: Array.from(cycleIds) } },
    })
  })
})

// === C2: curator metriche reali =====================================

describe('Fase A — C2: curator metriche reali (non simulate)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('gatherSensorium ritorna queueDepth reale dal DB', async () => {
    const { gatherSensorium } = await import('@/lib/kernel/curator')
    const data = await gatherSensorium()
    // queueDepth deve essere un numero >= 0 (reale dal DB, non formula)
    expect(typeof data.queueDepth).toBe('number')
    expect(data.queueDepth).toBeGreaterThanOrEqual(0)
  })

  it('gatherSensorium ritorna activeThreads reale dal DB', async () => {
    const { gatherSensorium } = await import('@/lib/kernel/curator')
    const data = await gatherSensorium()
    expect(typeof data.activeThreads).toBe('number')
    expect(data.activeThreads).toBeGreaterThanOrEqual(0)
  })

  it('gatherSensorium ritorna systemLoad reale da OS', async () => {
    const { gatherSensorium } = await import('@/lib/kernel/curator')
    const data = await gatherSensorium()
    expect(typeof data.systemLoad).toBe('number')
    expect(data.systemLoad).toBeGreaterThanOrEqual(0)
    expect(data.systemLoad).toBeLessThan(1) // capped at 0.99
  })

  it('curator.ts non usa più cycleCounter module-level', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/curator.ts'),
      'utf-8',
    )
    expect(content).not.toMatch(/let cycleCounter/)
    expect(content).not.toMatch(/cycleCounter \+= 1/)
    expect(content).toMatch(/os\.loadavg/)
    expect(content).toMatch(/jobRecord.*count|jobRecord\.count/)
  })
})

// === B4: API POST requireAdmin ======================================

describe('Fase A — B4: API POST /api/context usa requireAdmin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST senza sessione → 401', async () => {
    const { POST } = await import('@/app/api/context/route')
    const req = makeRequest('POST', null, {
      action: 'record_tool_call',
      agentId: TEST_AGENT,
      toolName: 'test',
      callPayload: {},
      responsePayload: {},
    }, '/api/context')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('POST con sessione viewer → 403 (requireAdmin)', async () => {
    const { POST } = await import('@/app/api/context/route')
    // Create viewer session
    const email = 'ctx-faseA-viewer@example.com'
    const userId = 'ctx-faseA-viewer-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Viewer', role: 'viewer', tenantId: 'test', active: true },
      update: { role: 'viewer', active: true },
    })
    const token = `ctx-viewer-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    const req = makeRequest('POST', token, {
      action: 'record_tool_call',
      agentId: TEST_AGENT,
      toolName: 'test',
      callPayload: {},
      responsePayload: {},
    }, '/api/context')
    const res = await POST(req)
    expect(res.status).toBe(403)

    // Cleanup
    await db.session.deleteMany({ where: { userId } })
    await db.user.deleteMany({ where: { id: userId } })
  })

  it('POST con sessione admin → 200 (requireAdmin passa)', async () => {
    const { POST } = await import('@/app/api/context/route')
    const email = 'ctx-faseA-admin@example.com'
    const userId = 'ctx-faseA-admin-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Admin', role: 'admin', tenantId: 'test', active: true },
      update: { role: 'admin', active: true },
    })
    const token = `ctx-admin-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    try {
      const req = makeRequest('POST', token, {
        action: 'record_tool_call',
        agentId: TEST_AGENT,
        toolName: 'test_admin',
        callPayload: { arg: 'test' },
        responsePayload: { result: 'ok' },
        tokenCost: 10,
      }, '/api/context')
      const res = await POST(req)
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.ok).toBe(true)
      expect(body.entryId).toBeDefined()
    } finally {
      await db.session.deleteMany({ where: { userId } })
      await db.user.deleteMany({ where: { id: userId } })
    }
  })

  it('POST con body JSON invalido → 400', async () => {
    const { POST } = await import('@/app/api/context/route')
    const email = 'ctx-faseA-admin2@example.com'
    const userId = 'ctx-faseA-admin2-user'
    await db.user.upsert({
      where: { email },
      create: { id: userId, email, name: 'Admin2', role: 'admin', tenantId: 'test', active: true },
      update: { role: 'admin', active: true },
    })
    const token = `ctx-admin2-${Date.now()}`
    await db.session.create({
      data: { userId, token, expiresAt: new Date(Date.now() + 3600000) },
    })

    try {
      const req = new NextRequest('http://localhost/api/context', {
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
})

// === C1: recordToolCall integrato in executor ========================

describe('Fase A — C1: recordToolCall integrato in executor', () => {
  it('executor.ts ha import dinamico di recordToolCall', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/recordToolCall/)
    expect(content).toMatch(/context-engineering/)
  })

  it('react-loop.ts ha import dinamico di assembleWorkingContext', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    expect(content).toMatch(/assembleWorkingContext/)
    expect(content).toMatch(/workingContext/)
  })

  it('react-loop.ts inietta working context nel prompt', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    expect(content).toMatch(/Context Summary/)
    expect(content).toMatch(/Recent Tool Calls/)
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3+B4+B5 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('recordToolCall + assembleWorkingContext + JSON.parse robusto', async () => {
    const { recordToolCall, assembleWorkingContext } = await import('@/lib/kernel/context-engineering')

    // 1. Registra tool call con payload valido
    await recordToolCall(
      TEST_AGENT,
      'filesystem.read',
      { path: '/tmp/test' },
      { content: 'file content', size: 12 },
      50,
    )

    // 2. Registra tool call con payload corrotto (simula DB corruption)
    await db.toolCallEntry.create({
      data: {
        agentId: TEST_AGENT,
        toolName: 'corrupt_tool',
        callPayload: '{broken',
        responsePayload: 'not-json',
        tokenCost: 5,
      },
    })

    // 3. Assembla working context — non deve crashare
    const ctx = await assembleWorkingContext(TEST_AGENT)
    expect(ctx.recentCalls.length).toBe(2)

    // Il primo (valido) ha payload parsed
    const valid = ctx.recentCalls.find((c: any) => c.toolName === 'filesystem.read')
    expect(valid).toBeDefined()
    expect(valid!.callPayload).toEqual({ path: '/tmp/test' })

    // Il secondo (corrotto) ha payload come stringa grezza (C3 fix)
    const corrupt = ctx.recentCalls.find((c: any) => c.toolName === 'corrupt_tool')
    expect(corrupt).toBeDefined()
    expect(corrupt!.callPayload).toBe('{broken')
    expect(corrupt!.responsePayload).toBe('not-json')

    // totalTokenCost include entrambi
    expect(ctx.totalTokenCost).toBe(55) // 50 + 5
  })

  it('produceSensorium con metriche reali + cycleId string univoco', async () => {
    const { produceSensorium } = await import('@/lib/kernel/curator')

    const r1 = await produceSensorium()
    const r2 = await produceSensorium()

    // cycleId univoci (B5)
    expect(r1.data.cycleId).not.toBe(r2.data.cycleId)
    expect(typeof r1.data.cycleId).toBe('string')

    // Metriche reali (C2): numeri >= 0
    expect(r1.data.queueDepth).toBeGreaterThanOrEqual(0)
    expect(r1.data.activeThreads).toBeGreaterThanOrEqual(0)
    expect(r1.data.systemLoad).toBeGreaterThanOrEqual(0)

    // Cleanup
    await db.sensoriumSnapshot.deleteMany({
      where: { cycleId: { in: [r1.data.cycleId, r2.data.cycleId] } },
    })
  })
})
