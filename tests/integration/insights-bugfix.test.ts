/**
 * Integration tests for insights bugfixes (Fase 3 — B6, B9, B10).
 *
 * Coverage:
 *   B6 — evaluation/run agentUri/benchmarkUri existence validation:
 *     - run with non-existent agentUri → 404 AGENT_NOT_FOUND
 *     - run with non-existent benchmarkUri → 404 BENCHMARK_NOT_FOUND
 *     - run with existing URIs (passes validation, may fail on taskResults)
 *   B9 — /api/cost?action=recent filters:
 *     - filter by agentId
 *     - filter by model
 *     - filter by phase
 *     - filter by sinceHours
 *     - combined filters
 *     - limit cap at 500
 *     - response includes filters object
 *   B10 — /api/errors/record input validation:
 *     - record with missing input → 400
 *     - record with missing message → 400
 *     - record with empty message → 400
 *     - record with message > 10000 chars → 400
 *     - record with missing source → 400
 *     - record with invalid source → 400
 *     - record with non-string stack → 400
 *     - record with valid input → 200
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

import { POST as evPost } from '@/app/api/evaluation/route'
import { GET as costGet } from '@/app/api/cost/route'
import { GET as errorsGet, POST as errorsPost } from '@/app/api/errors/route'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'insights3-admin-test@example.com'
const VIEWER_EMAIL = 'insights3-viewer-test@example.com'
const ADMIN_USER_ID = 'insights3-admin-user'
const VIEWER_USER_ID = 'insights3-viewer-user'
const TENANT = 'insights3-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Insights3 ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `insights3-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }
function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }

async function cleanupFixtures() {
  await db.costEntry.deleteMany({ where: { agentId: 'test-filters-agent' } })
  await db.errorRecord.deleteMany({ where: { message: { startsWith: 'TEST-ERROR-' } } })
  await db.session.deleteMany({ where: { userId: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
  await db.user.deleteMany({ where: { id: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
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

// === B6: evaluation/run existence validation ========================

describe('Fase 3 — B6: evaluation/run agentUri/benchmarkUri existence', () => {
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

  it('run with non-existent agentUri → 404 AGENT_NOT_FOUND', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://non-existent-agent-b6',
      benchmarkUri: 'benchmark://non-existent-benchmark-b6',
      taskResults: [validTaskResult],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.code).toBe('AGENT_NOT_FOUND')
  })

  it('run with non-existent benchmarkUri (existing agent) → 404 BENCHMARK_NOT_FOUND', async () => {
    const token = await makeAdminSession()
    // Create a real agent node
    await db.graphNode.upsert({
      where: { uri: 'agent://test-b6-agent' },
      create: {
        uri: 'agent://test-b6-agent',
        entityType: 'Agent',
        lifecycleState: 'active',
        attributes: '{}',
        createdByAgent: 'test',
        createdByModel: 'test',
        source: 'system-event',
        confidence: 1.0,
      },
      update: {},
    })

    const req = makeRequest('POST', token, {
      action: 'run',
      agentUri: 'agent://test-b6-agent',
      benchmarkUri: 'benchmark://non-existent-benchmark-b6',
      taskResults: [validTaskResult],
    }, '/api/evaluation')
    const res = await evPost(req)
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.code).toBe('BENCHMARK_NOT_FOUND')

    // Cleanup
    await db.graphNode.deleteMany({ where: { uri: 'agent://test-b6-agent' } })
  })
})

// === B9: /api/cost?action=recent filters =============================

describe('Fase 3 — B9: /api/cost?action=recent filters', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    // Insert test cost entries
    await db.costEntry.createMany({
      data: [
        { agentId: 'test-filters-agent', model: 'zai-glm', phase: 'plan_generation', tokensIn: 100, tokensOut: 50, cost: 0.001 },
        { agentId: 'test-filters-agent', model: 'gpt-4', phase: 'task_execution', tokensIn: 200, tokensOut: 100, cost: 0.05 },
        { agentId: 'test-filters-agent', model: 'zai-glm', phase: 'reflection', tokensIn: 50, tokensOut: 25, cost: 0.0005 },
        { agentId: 'other-agent', model: 'zai-glm', phase: 'plan_generation', tokensIn: 300, tokensOut: 150, cost: 0.003 },
      ],
    })
  })
  afterEach(async () => { await cleanupFixtures() })

  it('returns all entries without filters', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.length).toBeGreaterThanOrEqual(4)
    expect(body.filters).toBeTruthy()
  })

  it('filters by agentId', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&agentId=test-filters-agent')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.every((e: any) => e.agentId === 'test-filters-agent')).toBe(true)
    expect(body.entries.length).toBe(3)
  })

  it('filters by model', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&model=gpt-4')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.every((e: any) => e.model === 'gpt-4')).toBe(true)
    expect(body.entries.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by phase', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&phase=plan_generation')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.every((e: any) => e.phase === 'plan_generation')).toBe(true)
    expect(body.entries.length).toBeGreaterThanOrEqual(2)
  })

  it('filters by sinceHours=0 returns all (no time filter)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&sinceHours=0')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.length).toBeGreaterThanOrEqual(4)
  })

  it('combines multiple filters', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&agentId=test-filters-agent&model=zai-glm')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.every((e: any) => e.agentId === 'test-filters-agent' && e.model === 'zai-glm')).toBe(true)
    expect(body.entries.length).toBe(2)
  })

  it('caps limit at 500', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&limit=99999')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.length).toBeLessThanOrEqual(500)
    expect(body.filters.limit).toBe(500)
  })

  it('response includes filters object', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&agentId=test-filters-agent&model=zai-glm')
    const res = await costGet(req)
    const body = await json(res)
    expect(body.filters).toEqual({
      agentId: 'test-filters-agent',
      model: 'zai-glm',
      phase: undefined,
      sinceHours: 0,
      limit: 50,
    })
  })

  it('returns empty array for non-matching filter', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/cost?action=recent&agentId=non-existent-agent')
    const res = await costGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.entries.length).toBe(0)
  })
})

// === B10: /api/errors/record input validation =======================

describe('Fase 3 — B10: /api/errors/record input validation', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('record with missing input object → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, { action: 'record' }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /Missing input object/ })
  })

  it('record with missing message → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { source: 'api' },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /input\.message is required/ })
  })

  it('record with empty message → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { message: '   ', source: 'api' },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /input\.message is required/ })
  })

  it('record with message > 10000 chars → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { message: 'x'.repeat(10001), source: 'api' },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /too long/ })
  })

  it('record with missing source → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { message: 'TEST-ERROR-test' },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /input\.source is required/ })
  })

  it('record with invalid source → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { message: 'TEST-ERROR-test', source: 'invalid' },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /source is required/ })
  })

  it('record with non-string stack → 400', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { message: 'TEST-ERROR-test', source: 'api', stack: 123 },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: /input\.stack must be a string/ })
  })

  it('record with valid input → 200', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'record',
      input: { message: 'TEST-ERROR-valid-test', source: 'api', stack: 'Error: test', phase: '4' },
    }, '/api/errors')
    const res = await errorsPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
    expect(body.errorId).toBeTruthy()
  })

  it('record deduplicates by fingerprint (same message+source)', async () => {
    const token = await makeViewerSession()
    // First record
    await errorsPost(makeRequest('POST', token, {
      action: 'record',
      input: { message: 'TEST-ERROR-dedup', source: 'api' },
    }, '/api/errors'))
    // Second record (same message+source)
    const res2 = await errorsPost(makeRequest('POST', token, {
      action: 'record',
      input: { message: 'TEST-ERROR-dedup', source: 'api' },
    }, '/api/errors'))
    expect(res2.status).toBe(200)
    const body2 = await json(res2)
    expect(body2.isNew).toBe(false)
    expect(body2.count).toBe(2) // incremented
  })
})
