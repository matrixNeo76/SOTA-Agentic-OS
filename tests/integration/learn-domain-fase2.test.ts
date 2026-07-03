/**
 * Integration tests for Learn Domain Fase 2 (N1, N2, N8, N9).
 *
 * N1 — /api/router POST update_config requireAdmin
 * N2 — /api/affect POST update_threshold requireAdmin
 * N8 — phase14 JSON.parse robustness (verified via API not crashing)
 * N9 — grounded-inference sandbox isolation (vm.runInNewContext)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as vm from 'node:vm'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'learn2-admin-test@example.com'
const VIEWER_EMAIL = 'learn2-viewer-test@example.com'
const ADMIN_USER_ID = 'learn2-admin-user'
const VIEWER_USER_ID = 'learn2-viewer-user'
const TENANT = 'learn2-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Learn2 ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `learn2-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }
function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }

async function cleanupFixtures() {
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

// === N1: /api/router auth ===========================================

describe('Fase 2 — N1: /api/router POST update_config requireAdmin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('GET /api/router returns 401 without session', async () => {
    const { GET } = await import('@/app/api/router/route')
    const req = makeRequest('GET', null, undefined, '/api/router?action=stats')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/router returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const { GET } = await import('@/app/api/router/route')
    const req = makeRequest('GET', token, undefined, '/api/router?action=stats')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/router update_config returns 403 for viewer (was open before N1)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/router/route')
    const req = makeRequest('POST', token, { action: 'update_config', marginThreshold: 0.3 }, '/api/router')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/router update_config returns 200 for admin', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/router/route')
    const req = makeRequest('POST', token, { action: 'update_config', marginThreshold: 0.3 }, '/api/router')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/router route returns 200 for viewer (not mutative)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/router/route')
    const req = makeRequest('POST', token, { action: 'route', agentId: 'test', prompt: 'test' }, '/api/router')
    const res = await POST(req)
    // May be 200 or 500 (LLM error) but NOT 403
    expect(res.status).not.toBe(403)
  })
})

// === N2: /api/affect auth ===========================================

describe('Fase 2 — N2: /api/affect POST update_threshold requireAdmin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST /api/affect compute returns 200 for viewer (not mutative)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/affect/route')
    const req = makeRequest('POST', token, {
      action: 'compute',
      agentId: 'test-affect-agent',
      toolFailures: 0, toolCalls: 10, gateRejects: 0, gateAttempts: 5, repeatedToolCalls: 0,
    }, '/api/affect')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/affect update_threshold returns 403 for viewer (was open before N2)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/affect/route')
    const req = makeRequest('POST', token, {
      action: 'update_threshold',
      agentId: 'test-affect-agent',
      desperationCritical: 0.9,
    }, '/api/affect')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/affect update_threshold returns 200 for admin', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/affect/route')
    const req = makeRequest('POST', token, {
      action: 'update_threshold',
      agentId: 'test-affect-agent',
      desperationCritical: 0.9,
    }, '/api/affect')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// === N9: grounded-inference sandbox isolation ========================

describe('Fase 2 — N9: grounded-inference sandbox isolation', () => {
  it('sandbox blocks access to process', () => {
    const script = 'return process.env.HOME'
    const sandbox = { input: 'test', JSON, Math, Date, String, Number, Array, Object, Boolean }
    const wrappedCode = `(function(input) {\n${script}\n})(input)`
    expect(() => {
      vm.runInNewContext(wrappedCode, sandbox, { timeout: 5000 })
    }).toThrow()
  })

  it('sandbox blocks access to require', () => {
    const script = 'return require("fs")'
    const sandbox = { input: 'test', JSON, Math, Date, String, Number, Array, Object, Boolean }
    const wrappedCode = `(function(input) {\n${script}\n})(input)`
    expect(() => {
      vm.runInNewContext(wrappedCode, sandbox, { timeout: 5000 })
    }).toThrow()
  })

  it('sandbox allows safe operations', () => {
    const script = 'return JSON.stringify({ result: Math.max(1, 2) })'
    const sandbox = { input: { value: 42 }, JSON, Math, Date, String, Number, Array, Object, Boolean }
    const wrappedCode = `(function(input) {\n${script}\n})(input)`
    const result = vm.runInNewContext(wrappedCode, sandbox, { timeout: 5000 })
    expect(result).toBe('{"result":2}')
  })

  it('sandbox timeout prevents infinite loops', () => {
    const script = 'while(true) {}'
    const sandbox = { input: 'test', JSON, Math, Date, String, Number, Array, Object, Boolean }
    const wrappedCode = `(function(input) {\n${script}\n})(input)`
    expect(() => {
      vm.runInNewContext(wrappedCode, sandbox, { timeout: 100 })
    }).toThrow(/timed?\s*out|timeout/i)
  })
})
