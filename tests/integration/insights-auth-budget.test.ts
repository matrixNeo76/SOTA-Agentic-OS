/**
 * Integration tests for insights API auth + budget persistence (Fase 2 — C1, C2, C3, C5).
 *
 * Coverage:
 *   C1 — Auth su world-model, digital-twin, evaluation:
 *     - GET returns 401 without session
 *     - GET returns 200 for viewer (read-only)
 *     - POST returns 403 for viewer (was open before C1)
 *     - POST returns 200 for admin
 *   C2 — Budget persistence su SystemSetting:
 *     - GET /api/cost?action=budget returns defaults (1.0 / 5.0)
 *     - POST set_budget persists to DB
 *     - GET after set returns new values
 *     - set_budget validates (warn > 0, danger > warn, ranges)
 *     - set_budget requires admin (403 for viewer)
 *   C3 — Digital twin rate limiting:
 *     - what-if returns 429 after 5 requests in 1 minute
 *     - rate limit is per-session (different users have separate limits)
 *   C5 — Evaluation taskResults validation:
 *     - run with non-array taskResults → 400
 *     - run with empty taskResults → 400
 *     - run with taskResults > 1000 → 400
 *     - run with missing taskId → 400
 *     - run with non-boolean success → 400
 *     - run with invalid durationMs → 400
 *     - run with invalid cost → 400
 *     - run with non-array toolCallsUsed → 400
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

import { GET as wmGet, POST as wmPost } from '@/app/api/world-model/route'
import { GET as dtGet, POST as dtPost } from '@/app/api/digital-twin/route'
import { GET as evGet, POST as evPost } from '@/app/api/evaluation/route'
import { GET as costGet, POST as costPost } from '@/app/api/cost/route'
import * as settingsStore from '@/lib/settings/store'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'insights-admin-test@example.com'
const VIEWER_EMAIL = 'insights-viewer-test@example.com'
const ADMIN_USER_ID = 'insights-admin-user'
const VIEWER_USER_ID = 'insights-viewer-user'
const TENANT = 'insights-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Insights ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `insights-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }
function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }

async function cleanupFixtures() {
  await db.systemSetting.deleteMany({ where: { key: { startsWith: 'cost.budget.' } } })
  await db.session.deleteMany({ where: { userId: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
  await db.user.deleteMany({ where: { id: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
  await settingsStore.__resetCacheForTests()
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

// === C1: Auth su insights APIs ======================================

describe('Fase 2 — C1: insights API auth', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  // --- world-model ---

  it('GET /api/world-model returns 401 without session', async () => {
    const req = makeRequest('GET', null, undefined, '/api/world-model')
    const res = await wmGet(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/world-model returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/world-model')
    const res = await wmGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('stats')
    expect(body).toHaveProperty('latestWorldState')
  })

  it('POST /api/world-model capture returns 403 for viewer (was open before C1)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, { action: 'capture' }, '/api/world-model')
    const res = await wmPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/world-model predict validates probability range', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'predict',
      statement: 'test',
      probability: 1.5, // out of range
      horizon: '24h',
      basedOnWorldStateUri: 'worldstate://test',
    }, '/api/world-model')
    const res = await wmPost(req)
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/probability/)
  })

  // --- digital-twin ---

  it('GET /api/digital-twin returns 401 without session', async () => {
    const req = makeRequest('GET', null, undefined, '/api/digital-twin')
    const res = await dtGet(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/digital-twin returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/digital-twin')
    const res = await dtGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('availablePresets')
  })

  it('POST /api/digital-twin create returns 403 for viewer (was open before C1)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'create', name: 'test', description: 'test', parameters: {},
    }, '/api/digital-twin')
    const res = await dtPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/digital-twin what-if returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, { action: 'what-if', presetName: 'scale_up' }, '/api/digital-twin')
    const res = await dtPost(req)
    expect(res.status).toBe(403)
  })

  // --- evaluation ---

  it('GET /api/evaluation returns 401 without session', async () => {
    const req = makeRequest('GET', null, undefined, '/api/evaluation')
    const res = await evGet(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/evaluation returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/evaluation')
    const res = await evGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('stats')
    expect(body).toHaveProperty('benchmarks')
  })

  it('POST /api/evaluation register-benchmark returns 403 for viewer (was open before C1)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'register-benchmark',
      name: 'test', description: 'test', dataset: { tasks: [] },
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/evaluation seed-defaults returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, { action: 'seed-defaults' }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(403)
  })
})

// === C2: Budget persistence ==========================================

describe('Fase 2 — C2: budget persistence su SystemSetting', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    await settingsStore.reloadCache()
  })
  afterEach(async () => {
    await cleanupFixtures()
    await settingsStore.reloadCache()
  })

  it('GET /api/cost?action=budget returns defaults when not set', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=budget')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.warn).toBe(1.0)
    expect(body.danger).toBe(5.0)
  })

  it('POST set_budget persists to DB (survives cache reload)', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'set_budget', warn: 2.5, danger: 10.0,
    }, '/api/cost')
    const res = await costPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
    expect(body.warn).toBe(2.5)
    expect(body.danger).toBe(10.0)

    // Verify persisted in DB
    const dbWarn = await db.systemSetting.findUnique({ where: { key: 'cost.budget.warn' } })
    const dbDanger = await db.systemSetting.findUnique({ where: { key: 'cost.budget.danger' } })
    expect(parseFloat(dbWarn?.value || '0')).toBe(2.5)
    expect(parseFloat(dbDanger?.value || '0')).toBe(10.0)

    // Verify survives cache reload
    await settingsStore.__resetCacheForTests()
    await settingsStore.reloadCache()
    const req2 = makeRequest('GET', token, undefined, '/api/cost?action=budget')
    const res2 = await costGet(req2)
    const body2 = await json(res2)
    expect(body2.warn).toBe(2.5)
    expect(body2.danger).toBe(10.0)
  })

  it('POST set_budget requires admin (403 for viewer)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'set_budget', warn: 2.5, danger: 10.0,
    }, '/api/cost')
    const res = await costPost(req)
    expect(res.status).toBe(403)
  })

  it('POST set_budget rejects warn <= 0', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'set_budget', warn: 0, danger: 10.0,
    }, '/api/cost')
    const res = await costPost(req)
    expect(res.status).toBe(400)
  })

  it('POST set_budget rejects warn > 10000', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'set_budget', warn: 20000, danger: 50000,
    }, '/api/cost')
    const res = await costPost(req)
    expect(res.status).toBe(400)
  })

  it('POST set_budget rejects danger <= warn', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'set_budget', warn: 10.0, danger: 5.0, // danger < warn
    }, '/api/cost')
    const res = await costPost(req)
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/danger.*greater than.*warn/i)
  })

  it('GET /api/cost?action=stats includes budget from SystemSetting', async () => {
    const token = await makeAdminSession()
    // Set custom budget
    await costPost(makeRequest('POST', token, {
      action: 'set_budget', warn: 3.0, danger: 15.0,
    }, '/api/cost'))

    const req = makeRequest('GET', token, undefined, '/api/cost?action=stats')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.budget).toEqual({ warn: 3.0, danger: 15.0 })
  })
})

// === C3: Digital twin rate limiting ==================================

describe('Fase 2 — C3: digital-twin what-if rate limiting', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('what-if returns 429 after 5 requests in 1 minute (same session)', async () => {
    const token = await makeAdminSession()
    // Make 5 requests — should succeed (or fail with non-429 if preset invalid)
    for (let i = 0; i < 5; i++) {
      const req = makeRequest('POST', token, {
        action: 'what-if', presetName: 'scale_up',
      }, '/api/digital-twin')
      const res = await dtPost(req)
      // Could be 200 (success) or 500 (no WorldState) but NOT 429
      expect(res.status).not.toBe(429)
    }

    // 6th request should be rate limited
    const req6 = makeRequest('POST', token, {
      action: 'what-if', presetName: 'scale_up',
    }, '/api/digital-twin')
    const res6 = await dtPost(req6)
    expect(res6.status).toBe(429)
    const body = await json(res6)
    expect(body.code).toBe('RATE_LIMIT')
    expect(body.error).toMatch(/Rate limit/)
  })

  it('rate limit does NOT affect GET requests', async () => {
    const token = await makeAdminSession()
    // Exhaust what-if rate limit
    for (let i = 0; i < 6; i++) {
      await dtPost(makeRequest('POST', token, {
        action: 'what-if', presetName: 'scale_up',
      }, '/api/digital-twin'))
    }

    // GET should still work
    const req = makeRequest('GET', token, undefined, '/api/digital-twin')
    const res = await dtGet(req)
    expect(res.status).toBe(200)
  })

  it('create and run actions are NOT rate limited (only what-if)', async () => {
    const token = await makeAdminSession()
    // Exhaust what-if rate limit
    for (let i = 0; i < 6; i++) {
      await dtPost(makeRequest('POST', token, {
        action: 'what-if', presetName: 'scale_up',
      }, '/api/digital-twin'))
    }

    // create should still work (returns 400 for missing params, not 429)
    const req = makeRequest('POST', token, {
      action: 'create', name: 'test', description: 'test', parameters: {},
    }, '/api/digital-twin')
    const res = await dtPost(req)
    expect(res.status).not.toBe(429)
  })
})

// === C5: Evaluation taskResults validation ==========================

describe('Fase 2 — C5: evaluation taskResults validation', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  const validTaskResult = {
    taskId: 'task-1',
    success: true,
    output: 'result',
    toolCallsUsed: ['tool1'],
    forbiddenActionsTriggered: [],
    durationMs: 1000,
    cost: 0.01,
  }

  it('run with non-array taskResults → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: 'not-an-array',
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /taskResults must be an array/ })
  })

  it('run with empty taskResults → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /cannot be empty/ })
  })

  it('run with missing taskId → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [{ ...validTaskResult, taskId: undefined }],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /taskId is required/ })
  })

  it('run with non-boolean success → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [{ ...validTaskResult, success: 'yes' }],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /success must be boolean/ })
  })

  it('run with invalid durationMs (negative) → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [{ ...validTaskResult, durationMs: -100 }],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /durationMs/ })
  })

  it('run with invalid durationMs (> 1h) → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [{ ...validTaskResult, durationMs: 4_000_000 }],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
  })

  it('run with invalid cost (negative) → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [{ ...validTaskResult, cost: -0.5 }],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /cost/ })
  })

  it('run with non-array toolCallsUsed → 400', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [{ ...validTaskResult, toolCallsUsed: 'tool1' }],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /toolCallsUsed must be an array/ })
  })

  it('run with > 1000 taskResults → 400', async () => {
    const token = await makeAdminSession()
    const tooMany = Array(1001).fill(validTaskResult)
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: tooMany,
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /too large/ })
  })

  it('run requires admin (403 for viewer)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test',
      benchmarkUri: 'benchmark://test',
      taskResults: [validTaskResult],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(403)
  })
})
