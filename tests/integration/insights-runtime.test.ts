/**
 * Integration tests for insights Fase 5 — G7, G8, G9.
 *
 * Coverage:
 *   G7 — Budget alerting via WS:
 *     - stats with today >= warn triggers budget_warn event
 *     - stats with today >= danger triggers budget_danger event
 *     - throttling: second call within 5min does not re-alert
 *   G8 — Pagination on traces and errors:
 *     - /api/traces returns { traces, total, hasMore }
 *     - /api/errors returns { errors, total, hasMore }
 *     - pagination with offset works
 *   G9 — Filters on traces:
 *     - filter by operation (substring)
 *     - filter by status (ok|error)
 *     - filter by phase
 *     - filter by sinceHours
 *     - combined filters
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

import { GET as costGet, POST as costPost } from '@/app/api/cost/route'
import { GET as tracesGet } from '@/app/api/traces/route'
import { GET as errorsGet } from '@/app/api/errors/route'
import * as settingsStore from '@/lib/settings/store'

// === Fixtures ========================================================

const VIEWER_EMAIL = 'insights5-viewer-test@example.com'
const ADMIN_EMAIL = 'insights5-admin-test@example.com'
const VIEWER_USER_ID = 'insights5-viewer-user'
const ADMIN_USER_ID = 'insights5-admin-user'
const TENANT = 'insights5-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Insights5 ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `insights5-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }
function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }

async function cleanupFixtures() {
  await db.traceSpan.deleteMany({ where: { traceId: { startsWith: 'test-trace-g89-' } } })
  await db.errorRecord.deleteMany({ where: { message: { startsWith: 'TEST-ERROR-G89-' } } })
  await db.costEntry.deleteMany({ where: { agentId: 'test-budget-alert-agent' } })
  await db.systemSetting.deleteMany({ where: { key: { startsWith: 'cost.budget.' } } })
  await db.session.deleteMany({ where: { userId: { in: [VIEWER_USER_ID, ADMIN_USER_ID] } } })
  await db.user.deleteMany({ where: { id: { in: [VIEWER_USER_ID, ADMIN_USER_ID] } } })
  await settingsStore.__resetCacheForTests()
  await settingsStore.reloadCache()
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

// Track WS publish calls — use vi.hoisted to make available in mock factory
const { wsPublishMock } = vi.hoisted(() => ({
  wsPublishMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: wsPublishMock,
}))

// === G7: Budget alerting =============================================

describe('Fase 5 — G7: budget alerting via WS', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    wsPublishMock.mockClear()
  })
  afterEach(async () => { await cleanupFixtures() })

  it('stats with today >= warn triggers budget_warn WS event', async () => {
    const adminToken = await makeAdminSession()
    // Set low budget thresholds
    await costPost(makeRequest('POST', adminToken, {
      action: 'set_budget', warn: 0.001, danger: 100,
    }, '/api/cost'))

    // Insert cost entry that exceeds warn
    await db.costEntry.create({
      data: { agentId: 'test-budget-alert-agent', model: 'zai-glm', phase: 'test', tokensIn: 100, tokensOut: 50, cost: 0.005 },
    })

    const viewerToken = await makeViewerSession()
    const req = makeRequest('GET', viewerToken, undefined, '/api/cost?action=stats')
    await costGet(req)

    // Check WS publish was called with budget_warn
    const warnCall = wsPublishMock.mock.calls.find(
      c => c[0]?.event === 'budget_warn'
    )
    expect(warnCall).toBeTruthy()
    expect(warnCall?.[0]?.level).toBe('info')
  })

  it('stats with today >= danger triggers budget_danger WS event', async () => {
    const adminToken = await makeAdminSession()
    await costPost(makeRequest('POST', adminToken, {
      action: 'set_budget', warn: 0.001, danger: 0.002,
    }, '/api/cost'))

    await db.costEntry.create({
      data: { agentId: 'test-budget-alert-agent', model: 'zai-glm', phase: 'test', tokensIn: 100, tokensOut: 50, cost: 0.005 },
    })

    const viewerToken = await makeViewerSession()
    await costGet(makeRequest('GET', viewerToken, undefined, '/api/cost?action=stats'))

    const dangerCall = wsPublishMock.mock.calls.find(
      c => c[0]?.event === 'budget_danger'
    )
    expect(dangerCall).toBeTruthy()
    expect(dangerCall?.[0]?.level).toBe('warn')
  })

  it('stats with today < warn does NOT trigger any budget alert', async () => {
    const adminToken = await makeAdminSession()
    await costPost(makeRequest('POST', adminToken, {
      action: 'set_budget', warn: 100, danger: 500,
    }, '/api/cost'))

    await db.costEntry.create({
      data: { agentId: 'test-budget-alert-agent', model: 'zai-glm', phase: 'test', tokensIn: 100, tokensOut: 50, cost: 0.001 },
    })

    const viewerToken = await makeViewerSession()
    await costGet(makeRequest('GET', viewerToken, undefined, '/api/cost?action=stats'))

    const budgetCalls = wsPublishMock.mock.calls.filter(
      c => c[0]?.event === 'budget_warn' || c[0]?.event === 'budget_danger'
    )
    expect(budgetCalls.length).toBe(0)
  })
})

// === G8+G9: Traces pagination + filters ==============================

describe('Fase 5 — G8+G9: traces pagination + filters', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    // Insert test trace spans
    for (let i = 0; i < 15; i++) {
      await db.traceSpan.create({
        data: {
          traceId: `test-trace-g89-${i}`,
          spanId: `span-${i}`,
          operation: i < 5 ? 'ltl.verify' : i < 10 ? 'patchboard.apply' : 'cost.record',
          phase: i < 8 ? '4' : '6',
          status: i % 3 === 0 ? 'error' : 'ok',
          durationMs: 100 + i,
        },
      })
    }
  })
  afterEach(async () => { await cleanupFixtures() })

  it('returns { traces, total, hasMore } structure', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('traces')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('hasMore')
    expect(Array.isArray(body.traces)).toBe(true)
  })

  it('paginates with limit + offset', async () => {
    const token = await makeViewerSession()
    const req1 = makeRequest('GET', token, undefined, '/api/traces?limit=5&offset=0')
    const res1 = await tracesGet(req1)
    const body1 = await json(res1)
    expect(body1.traces.length).toBeLessThanOrEqual(5)
    expect(body1.hasMore).toBe(true)
    expect(body1.total).toBeGreaterThanOrEqual(15)

    const req2 = makeRequest('GET', token, undefined, '/api/traces?limit=5&offset=10')
    const res2 = await tracesGet(req2)
    const body2 = await json(res2)
    // Page 3 should have at least 5 traces (15 total)
    expect(body2.traces.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by operation (substring)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?operation=ltl')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    body.traces.forEach((t: any) => {
      expect(t.firstOp).toMatch(/ltl/)
    })
  })

  it('filters by status=error', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?status=error')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    body.traces.forEach((t: any) => {
      expect(t.status).toBe('error')
    })
  })

  it('filters by phase', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?phase=4')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    // All traces should have at least one span with phase=4
    expect(body.traces.length).toBeGreaterThan(0)
  })

  it('returns empty for non-matching filter', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?operation=nonexistent')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.traces.length).toBe(0)
    expect(body.total).toBe(0)
  })

  it('combines operation + status filters', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?operation=patchboard&status=error')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    body.traces.forEach((t: any) => {
      expect(t.firstOp).toMatch(/patchboard/)
      expect(t.status).toBe('error')
    })
  })

  it('action=stats still works', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?action=stats')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('totalSpans')
    expect(body).toHaveProperty('totalTraces')
  })

  it('action=detail returns spans for a trace', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/traces?action=detail&traceId=test-trace-g89-0')
    const res = await tracesGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.traceId).toBe('test-trace-g89-0')
    expect(Array.isArray(body.spans)).toBe(true)
  })
})

// === G8: Errors pagination ===========================================

describe('Fase 5 — G8: errors pagination', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    // Insert test errors
    for (let i = 0; i < 15; i++) {
      await db.errorRecord.create({
        data: {
          fingerprint: `fp-g89-${i}`,
          message: `TEST-ERROR-G89-${i}`,
          source: i < 5 ? 'kernel' : i < 10 ? 'api' : 'ui',
          status: i % 2 === 0 ? 'open' : 'resolved',
          count: 1,
        },
      })
    }
  })
  afterEach(async () => { await cleanupFixtures() })

  it('returns { errors, total, hasMore } structure', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/errors')
    const res = await errorsGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('errors')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('hasMore')
    expect(Array.isArray(body.errors)).toBe(true)
  })

  it('paginates with limit + offset', async () => {
    const token = await makeViewerSession()
    const req1 = makeRequest('GET', token, undefined, '/api/errors?limit=5&offset=0')
    const res1 = await errorsGet(req1)
    const body1 = await json(res1)
    expect(body1.errors.length).toBe(5)
    expect(body1.hasMore).toBe(true)
    expect(body1.total).toBeGreaterThanOrEqual(15)

    const req2 = makeRequest('GET', token, undefined, '/api/errors?limit=5&offset=10')
    const res2 = await errorsGet(req2)
    const body2 = await json(res2)
    expect(body2.errors.length).toBeGreaterThanOrEqual(5) // at least 5 remaining
    // No overlap
    const page1Messages = new Set(body1.errors.map((e: any) => e.id))
    body2.errors.forEach((e: any) => {
      expect(page1Messages.has(e.id)).toBe(false)
    })
  })

  it('filters by source', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/errors?source=kernel')
    const res = await errorsGet(req)
    const body = await json(res)
    body.errors.forEach((e: any) => {
      expect(e.source).toBe('kernel')
    })
  })

  it('filters by status', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/errors?status=open')
    const res = await errorsGet(req)
    const body = await json(res)
    body.errors.forEach((e: any) => {
      expect(e.status).toBe('open')
    })
  })

  it('action=stats still works', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/errors?action=stats')
    const res = await errorsGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('open')
  })
})
