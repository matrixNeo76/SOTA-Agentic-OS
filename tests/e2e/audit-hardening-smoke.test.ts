/**
 * E2E Smoke Tests — Fase 4.4 (Audit & Hardening)
 *
 * Test end-to-end che esercitano i 3 flussi critici toccati durante
 * l'audit & hardening cycle, per garantire non-regression:
 *
 *   1. Tool install + permission grant + dispatch (Phase 3 + Tool Manager)
 *   2. Steering cycle PLAN → EXECUTE → CHECK (ACTS Controller)
 *   3. Auth boundary: viewer blocked from mutative actions (RBAC)
 *
 * Questi test toccano più layer insieme (API + lib + DB + RBAC) e
 * verificano che i fix di sicurezza/Fase 2-3 non regressiscano.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'e2e-audit-admin@example.com'
const VIEWER_EMAIL = 'e2e-audit-viewer@example.com'
const ADMIN_USER_ID = 'e2e-audit-admin-user'
const VIEWER_USER_ID = 'e2e-audit-viewer-user'
const TENANT = 'e2e-audit-tenant'
const TEST_PREFIX = 'e2e-audit-'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `E2E Audit ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `e2e-audit-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }
function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }

async function cleanupFixtures() {
  // Cleanup test tools
  const tools = await db.tool.findMany({
    where: { toolId: { startsWith: TEST_PREFIX } },
    select: { id: true },
  })
  if (tools.length > 0) {
    await db.toolPermission.deleteMany({
      where: { toolId: { in: tools.map((t) => t.id) } },
    })
    await db.tool.deleteMany({ where: { id: { in: tools.map((t) => t.id) } } })
  }
  // Cleanup test steering events
  await db.steeringEvent.deleteMany({
    where: { agentId: { startsWith: 'e2e-audit-' } },
  })
  await db.agentLog.deleteMany({
    where: { agentId: { startsWith: 'e2e-audit-' } },
  })
  // Cleanup sessions + users
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

// === Smoke 1: Tool install + permission grant + dispatch ============

describe('E2E Smoke 1 — Tool install + permission grant + dispatch (full flow)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('admin installa tool, concede scope, dispatch esegue (scope check passa)', async () => {
    const adminToken = await makeAdminSession()
    const { POST: adminToolsPost } = await import('@/app/api/admin/tools/route')

    // Step 1: Register tool with http transport
    const toolId = `${TEST_PREFIX}smoke-full-flow`
    const registerReq = makeRequest('POST', adminToken, {
      action: 'register',
      toolId,
      name: 'E2E Smoke Tool',
      transport: 'http',
      endpoint: 'https://example.com/api',
    }, '/api/admin/tools')
    const registerRes = await adminToolsPost(registerReq)
    expect(registerRes.status).toBe(200)
    const registerBody = await json(registerRes)
    expect(registerBody.registered).toBe(true)

    // Step 2: Verify tool exists in DB with tool.id (cuid, C1 key consistency)
    const tool = await db.tool.findUnique({ where: { toolId } })
    expect(tool).not.toBeNull()
    expect(tool!.id).not.toBe(toolId)

    // Step 3: Try dispatch WITHOUT permissions → should fail (C2 scope check)
    const dispatchReq1 = makeRequest('POST', adminToken, {
      action: 'test',
      toolName: toolId,
      args: {},
      agentId: 'e2e-audit-test',
    }, '/api/admin/tools')
    const dispatchRes1 = await adminToolsPost(dispatchReq1)
    const dispatchBody1 = await json(dispatchRes1)
    expect(dispatchBody1.success).toBe(false)
    expect(dispatchBody1.error).toMatch(/Permission denied.*tool:exec/i)

    // Step 4: Grant required scopes (tool:exec + network:post for http transport)
    for (const scope of ['tool:exec', 'network:post']) {
      const grantReq = makeRequest('POST', adminToken, {
        action: 'grant-scope',
        toolId,
        scope,
      }, '/api/admin/tools')
      const grantRes = await adminToolsPost(grantReq)
      expect(grantRes.status).toBe(200)
    }

    // Step 5: Verify permissions stored with tool.id (C1)
    const perms = await db.toolPermission.findMany({
      where: { toolId: tool!.id, granted: true },
    })
    expect(perms.length).toBe(2)
    expect(perms.map((p) => p.scope).sort()).toEqual(['network:post', 'tool:exec'])

    // Step 6: Dispatch NOW passes scope check (will fail at network level, OK)
    const dispatchReq2 = makeRequest('POST', adminToken, {
      action: 'test',
      toolName: toolId,
      args: {},
      agentId: 'e2e-audit-test',
    }, '/api/admin/tools')
    const dispatchRes2 = await adminToolsPost(dispatchReq2)
    const dispatchBody2 = await json(dispatchRes2)
    expect(dispatchBody2.success).toBe(false)
    // Scope check passed; failure is at fetch level (DNS/connection), NOT permission
    expect(dispatchBody2.error).not.toMatch(/Permission denied/i)
  })

  it('install via /api/tools + check_permission via /api/tools (read-only path)', async () => {
    const adminToken = await makeAdminSession()
    const { POST: toolsPost } = await import('@/app/api/tools/route')

    // Step 1: Install via /api/tools (uses installTool from tool-registry)
    const toolId = `${TEST_PREFIX}install-check`
    const installReq = makeRequest('POST', adminToken, {
      action: 'install',
      toolId,
      name: 'Install Check Tool',
      version: '1.0.0',
    }, '/api/tools')
    const installRes = await toolsPost(installReq)
    expect(installRes.status).toBe(200)
    const installBody = await json(installRes)
    expect(installBody.ok).toBe(true)
    expect(installBody.signature).toMatch(/^sha256:/)

    // Step 2: check_permission should return authorized=false (no scope granted yet)
    const checkReq1 = makeRequest('POST', adminToken, {
      action: 'check_permission',
      toolId,
      scope: 'filesystem:read',
    }, '/api/tools')
    const checkRes1 = await toolsPost(checkReq1)
    expect(checkRes1.status).toBe(200)
    const checkBody1 = await json(checkRes1)
    expect(checkBody1.authorized).toBe(false)

    // Step 3: Grant scope via admin API
    const { POST: adminToolsPost } = await import('@/app/api/admin/tools/route')
    const grantReq = makeRequest('POST', adminToken, {
      action: 'grant-scope',
      toolId,
      scope: 'filesystem:read',
    }, '/api/admin/tools')
    await adminToolsPost(grantReq)

    // Step 4: check_permission now returns authorized=true
    const checkReq2 = makeRequest('POST', adminToken, {
      action: 'check_permission',
      toolId,
      scope: 'filesystem:read',
    }, '/api/tools')
    const checkRes2 = await toolsPost(checkReq2)
    const checkBody2 = await json(checkRes2)
    expect(checkBody2.authorized).toBe(true)
  })
})

// === Smoke 2: Steering cycle PLAN → EXECUTE → CHECK ================

describe('E2E Smoke 2 — Steering cycle (ACTS Controller)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('steer() ritorna sequenza PLAN → EXECUTE → CHECK per step 0,1,2', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    const agentId = 'e2e-audit-steer-cycle'

    // Step 0 → PLAN
    const r0 = await steer(agentId, 1000, 0, 0, 'PLAN', null, 0)
    expect(r0.strategy).toBe('PLAN')
    expect(r0.tokenUsed).toBeGreaterThan(0)
    expect(r0.budgetRemaining).toBeLessThan(1000)

    // Step 1 (after PLAN) → EXECUTE
    const r1 = await steer(agentId, 1000, r0.tokenUsed, 1, 'PLAN', null, 0)
    expect(r1.strategy).toBe('EXECUTE')

    // Step 2 (after EXECUTE) → CHECK
    const r2 = await steer(agentId, 1000, r0.tokenUsed + r1.tokenUsed, 2, 'EXECUTE', null, 0)
    expect(r2.strategy).toBe('CHECK')

    // Cleanup steering events created
    await db.steeringEvent.deleteMany({ where: { agentId } })
  })

  it('POST /api/steering ritorna 200 + steering result per request valida', async () => {
    const adminToken = await makeAdminSession()
    const { POST } = await import('@/app/api/steering/route')
    const req = makeRequest('POST', adminToken, {
      agentId: 'e2e-audit-api-steer',
      budgetTotal: 1000,
      budgetUsed: 0,
      step: 0,
      lastStrategy: 'PLAN',
      lastCheckPassed: null,
      errorsConsecutive: 0,
    }, '/api/steering')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
    expect(body.strategy).toBeDefined()
    expect(body.phrase).toBeDefined()
    expect(typeof body.tokenUsed).toBe('number')
  })

  it('POST /api/steering ritorna 400 per body JSON invalido (B4 try/catch)', async () => {
    const adminToken = await makeAdminSession()
    const { POST } = await import('@/app/api/steering/route')
    const req = new NextRequest('http://localhost/api/steering', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    })
    req.cookies.set('sota_session', adminToken)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/Invalid JSON body/i)
  })

  it('HALT quando budgetRemaining < 50', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 10,
      lastStrategy: 'EXECUTE',
      lastCheckPassed: true,
      budgetRemaining: 30, // < 50
      errorsConsecutive: 0,
    })
    expect(result).toBe('HALT')
  })
})

// === Smoke 3: Auth boundary (RBAC enforcement) =====================

describe('E2E Smoke 3 — Auth boundary: viewer blocked from mutative actions', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('viewer non può installare tool via /api/tools (C3)', async () => {
    const viewerToken = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', viewerToken, {
      action: 'install',
      toolId: `${TEST_PREFIX}viewer-blocked`,
      name: 'Should Not Install',
      version: '1.0.0',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error).toMatch(/Insufficient permissions/i)
  })

  it('viewer non può revocare tool via /api/tools (C3)', async () => {
    const viewerToken = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', viewerToken, {
      action: 'revoke',
      toolId: `${TEST_PREFIX}viewer-revoke-attempt`,
      reason: 'should fail',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('viewer non può set_permission via /api/tools (C3)', async () => {
    const viewerToken = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', viewerToken, {
      action: 'set_permission',
      toolId: `${TEST_PREFIX}viewer-set-perm-attempt`,
      scope: 'filesystem:read',
      granted: true,
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('viewer PUÒ check_permission via /api/tools (read-only, C3 allow)', async () => {
    const viewerToken = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', viewerToken, {
      action: 'check_permission',
      toolId: `${TEST_PREFIX}viewer-allowed-check`,
      scope: 'filesystem:read',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('viewer non può accedere a /api/admin/tools (requireAdmin)', async () => {
    const viewerToken = await makeViewerSession()
    const { GET, POST } = await import('@/app/api/admin/tools/route')

    const getReq = makeRequest('GET', viewerToken, undefined, '/api/admin/tools')
    const getRes = await GET(getReq)
    expect(getRes.status).toBe(403)

    const postReq = makeRequest('POST', viewerToken, {
      action: 'register',
      toolId: `${TEST_PREFIX}viewer-admin-attempt`,
      name: 'Should Not Register',
    }, '/api/admin/tools')
    const postRes = await POST(postReq)
    expect(postRes.status).toBe(403)
  })

  it('admin PUÒ installare tool via /api/tools (C3 allow)', async () => {
    const adminToken = await makeAdminSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', adminToken, {
      action: 'install',
      toolId: `${TEST_PREFIX}admin-allowed`,
      name: 'Admin Allowed',
      version: '1.0.0',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
  })

  it('richiesta senza sessione ritorna 401 su /api/tools', async () => {
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', null, {
      action: 'install',
      toolId: `${TEST_PREFIX}no-session`,
      name: 'No Session',
      version: '1.0.0',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('richiesta senza sessione ritorna 401 su /api/steering', async () => {
    const { GET, POST } = await import('@/app/api/steering/route')
    const getReq = makeRequest('GET', null, undefined, '/api/steering')
    const getRes = await GET(getReq)
    expect(getRes.status).toBe(401)

    const postReq = makeRequest('POST', null, {
      agentId: 'test', budgetTotal: 1000, budgetUsed: 0, step: 0,
    }, '/api/steering')
    const postRes = await POST(postReq)
    expect(postRes.status).toBe(401)
  })
})

// === Smoke 4: SSRF protection invariant (cross-check) ===============

describe('E2E Smoke 4 — SSRF protection invariant (http.fetch builtin)', () => {
  it('blocks cloud metadata IP across multiple invocations', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    // Multiple invocations should all be blocked (no state leakage)
    for (let i = 0; i < 3; i++) {
      const result = await tool.execute(
        { url: 'http://169.254.169.254/latest/meta-data/' },
        { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/SSRF blocked/i)
    }
  })

  it('blocks all common SSRF targets', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const targets = [
      'http://127.0.0.1:3000/',
      'http://localhost/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/',
      'http://0.0.0.0/',
    ]
    for (const url of targets) {
      const result = await tool.execute(
        { url },
        { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/SSRF blocked/i)
    }
  })
})
