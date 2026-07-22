/**
 * Integration tests for Phase 3 (ACTS) + Tool Manager Fase 2
 * (C1, C3, C4, B1, B2 documentation).
 *
 * C1 — ToolPermission.toolId key consistency (tool.id cuid interno, non toolId user-facing)
 * C3 — /api/tools POST mutative actions require admin
 * C4 — http.fetch SSRF protection (block localhost/private/metadata IPs)
 * B1 — isPathAllowed path-separator-aware comparison
 * B2 — apiKey plaintext documented as known issue (verified via comment)
 * B4 — try/catch strutturato su /api/steering e /api/admin/tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolve, sep } from 'path'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'p3tm-admin-test@example.com'
const VIEWER_EMAIL = 'p3tm-viewer-test@example.com'
const ADMIN_USER_ID = 'p3tm-admin-user'
const VIEWER_USER_ID = 'p3tm-viewer-user'
const TENANT = 'p3tm-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `P3TM ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `p3tm-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }
function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }

async function cleanupFixtures() {
  // Clean tools created during tests (unique toolId prefix 'p3tm-test-')
  const tools = await db.tool.findMany({
    where: { toolId: { startsWith: 'p3tm-test-' } },
    select: { id: true },
  })
  if (tools.length > 0) {
    await db.toolPermission.deleteMany({
      where: { toolId: { in: tools.map((t) => t.id) } },
    })
    await db.tool.deleteMany({ where: { id: { in: tools.map((t) => t.id) } } })
  }
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

// === C1: ToolPermission.toolId key consistency ======================

describe('Fase 2 — C1: ToolPermission.toolId standardizzato su tool.id (cuid interno)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('installTool crea permessi con toolId = tool.id (cuid), non toolId user-facing', async () => {
    const { installTool } = await import('@/lib/kernel/tool-registry')
    const userFacingToolId = 'p3tm-test-c1-install-tool'
    const result = await installTool({
      toolId: userFacingToolId,
      name: 'C1 Test Tool',
      version: '1.0.0',
    }, 'test-admin')

    // Find the tool by user-facing toolId
    const tool = await db.tool.findUnique({ where: { toolId: userFacingToolId } })
    expect(tool).not.toBeNull()
    expect(tool!.id).not.toBe(userFacingToolId) // cuid != user-facing string

    // All permissions should be stored with tool.id, NOT userFacingToolId
    const permsByCuid = await db.toolPermission.findMany({
      where: { toolId: tool!.id },
    })
    expect(permsByCuid.length).toBeGreaterThan(0)

    const permsByUserFacing = await db.toolPermission.findMany({
      where: { toolId: userFacingToolId },
    })
    expect(permsByUserFacing).toEqual([])
  })

  it('admin/tools grant-scope salva permesso con tool.id (cuid), non toolId user-facing', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/admin/tools/route')
    const userFacingToolId = 'p3tm-test-c1-grant-scope'

    // Register the tool first
    const registerReq = makeRequest('POST', token, {
      action: 'register',
      toolId: userFacingToolId,
      name: 'C1 Grant Scope Tool',
      transport: 'http',
      endpoint: 'https://example.com/api',
    }, '/api/admin/tools')
    const registerRes = await POST(registerReq)
    expect(registerRes.status).toBe(200)

    const tool = await db.tool.findUnique({ where: { toolId: userFacingToolId } })
    expect(tool).not.toBeNull()

    // Grant a scope via admin API
    const grantReq = makeRequest('POST', token, {
      action: 'grant-scope',
      toolId: userFacingToolId,
      scope: 'tool:exec',
    }, '/api/admin/tools')
    const grantRes = await POST(grantReq)
    expect(grantRes.status).toBe(200)
    const grantBody = await json(grantRes)
    expect(grantBody.granted).toBe(true)
    expect(grantBody.permission.toolId).toBe(tool!.id) // ← key fix: should be cuid, not user-facing

    // Permission stored with cuid, NOT with user-facing string
    const permByCuid = await db.toolPermission.findFirst({
      where: { toolId: tool!.id, scope: 'tool:exec' },
    })
    expect(permByCuid).not.toBeNull()
    expect(permByCuid!.granted).toBe(true)

    const permByUserFacing = await db.toolPermission.findFirst({
      where: { toolId: userFacingToolId, scope: 'tool:exec' },
    })
    expect(permByUserFacing).toBeNull()
  })

  it('checkToolPermission ritorna authorized=true quando permesso è granted su tool.id', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const userFacingToolId = 'p3tm-test-c1-check-perm'

    await installTool({
      toolId: userFacingToolId,
      name: 'C1 Check Perm Tool',
      version: '1.0.0',
    }, 'test-admin')

    // setPermission should store on tool.id (cuid), and checkToolPermission should find it
    await setPermission(userFacingToolId, 'filesystem:read', true, 'test-admin')

    const result = await checkToolPermission(userFacingToolId, 'filesystem:read')
    expect(result.authorized).toBe(true)
    expect(result.reason).toBe('Autorizzato')
  })

  it('admin/tools grant-scope è idempotente (no duplicati su grant multipli)', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/admin/tools/route')
    const userFacingToolId = 'p3tm-test-c1-idempotent'

    // Register
    const registerReq = makeRequest('POST', token, {
      action: 'register',
      toolId: userFacingToolId,
      name: 'C1 Idempotent Tool',
      transport: 'http',
      endpoint: 'https://example.com/api',
    }, '/api/admin/tools')
    await POST(registerReq)

    const tool = await db.tool.findUnique({ where: { toolId: userFacingToolId } })

    // Grant same scope twice
    for (let i = 0; i < 2; i++) {
      const grantReq = makeRequest('POST', token, {
        action: 'grant-scope',
        toolId: userFacingToolId,
        scope: 'tool:exec',
      }, '/api/admin/tools')
      const grantRes = await POST(grantReq)
      expect(grantRes.status).toBe(200)
    }

    // Should have exactly ONE permission for (tool.id, 'tool:exec'), not two
    const perms = await db.toolPermission.findMany({
      where: { toolId: tool!.id, scope: 'tool:exec' },
    })
    expect(perms.length).toBe(1)
  })
})

// === C3: /api/tools POST requireAdmin ================================

describe('Fase 2 — C3: /api/tools POST mutative actions require admin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST /api/tools check_permission returns 200 for viewer (read-only)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', token, {
      action: 'check_permission',
      toolId: 'p3tm-test-c3-viewer-check',
      scope: 'filesystem:read',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/tools install returns 403 for viewer (was open before C3)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', token, {
      action: 'install',
      toolId: 'p3tm-test-c3-viewer-install',
      name: 'Should Not Install',
      version: '1.0.0',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error).toMatch(/Insufficient permissions/i)
  })

  it('POST /api/tools install returns 200 for admin', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', token, {
      action: 'install',
      toolId: 'p3tm-test-c3-admin-install',
      name: 'Admin Install Test',
      version: '1.0.0',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
  })

  it('POST /api/tools revoke returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', token, {
      action: 'revoke',
      toolId: 'p3tm-test-c3-viewer-revoke',
      reason: 'test',
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/tools set_permission returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', token, {
      action: 'set_permission',
      toolId: 'p3tm-test-c3-viewer-set-perm',
      scope: 'filesystem:read',
      granted: true,
    }, '/api/tools')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/tools install logs actor email in publishAgentEvent', async () => {
    const token = await makeAdminSession()
    const { publishAgentEvent } = await import('@/lib/ws-publish')
    ;(publishAgentEvent as any).mockClear()
    const { POST } = await import('@/app/api/tools/route')
    const req = makeRequest('POST', token, {
      action: 'install',
      toolId: 'p3tm-test-c3-actor-logging',
      name: 'Actor Logging Test',
      version: '1.0.0',
    }, '/api/tools')
    await POST(req)
    expect((publishAgentEvent as any)).toHaveBeenCalled()
    const lastCall = (publishAgentEvent as any).mock.calls.at(-1)[0]
    expect(lastCall.payload.actor).toBe(ADMIN_EMAIL)
  })
})

// === C4: SSRF protection in http.fetch ===============================

describe('Fase 2 — C4: http.fetch SSRF protection', () => {
  it('blocks http://127.0.0.1 (loopback)', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://127.0.0.1:3000/api/admin/users' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked/i)
  })

  it('blocks http://localhost (string hostname)', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://localhost:3000/api/admin' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked.*localhost/i)
  })

  it('blocks AWS metadata IP http://169.254.169.254', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://169.254.169.254/latest/meta-data/' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked/i)
  })

  it('blocks private IP http://192.168.1.1', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://192.168.1.1/admin' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked/i)
  })

  it('blocks private IP http://10.0.0.1', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://10.0.0.1/internal' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked/i)
  })

  it('blocks IPv6 loopback http://[::1]', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://[::1]:3000/' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked/i)
  })

  it('blocks .local hostnames', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'http://my-service.local/api' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SSRF blocked.*\.local/i)
  })

  it('blocks non-http schemes (ftp://)', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')!
    const result = await tool.execute(
      { url: 'ftp://example.com/file' },
      { agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/only http\/https/i)
  })
})

// === B1: isPathAllowed path-separator-aware ==========================

describe('Fase 2 — B1: isPathAllowed path-separator-aware comparison', () => {
  it('filesystem.read blocca path sibling con stesso prefisso stringa', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.read')!
    // Use a tmp dir we control
    const allowedDir = resolve('/tmp/p3tm-b1-allowed')
    const siblingDir = resolve('/tmp/p3tm-b1-allowed-sibling')
    // Path /tmp/p3tm-b1-allowed/secret.txt è consentito
    // Path /tmp/p3tm-b1-allowed-sibling/secret.txt NON deve essere consentito
    // anche se ha lo stesso prefisso stringa "/tmp/p3tm-b1-allowed"
    const blockedPath = resolve(siblingDir, 'secret.txt')
    const result = await tool.execute(
      { path: blockedPath },
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true,
        allowedPaths: [allowedDir],
      },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Path not allowed/i)
  })

  it('filesystem.read permette path dentro directory consentita', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.read')!
    const allowedDir = resolve('/tmp')
    // /tmp/<anything> è consentito
    const allowedPath = resolve(allowedDir, 'p3tm-b1-inside.txt')
    const result = await tool.execute(
      { path: allowedPath },
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true,
        allowedPaths: [allowedDir],
      },
    )
    // Path è consentito ma il file non esiste → "File not found" (NON "Path not allowed")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/File not found/i)
  })

  it('filesystem.read permette path uguale al path consentito (non "Path not allowed")', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.read')!
    // path === allowed dir → isPathAllowed ritorna true (path === resolved branch).
    // readFileSync fallirà con EISDIR (è una directory), NON con "Path not allowed".
    const allowedDir = resolve('/tmp')
    const result = await tool.execute(
      { path: allowedDir }, // path === allowed
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true,
        allowedPaths: [allowedDir],
      },
    )
    expect(result.success).toBe(false)
    // L'errore NON deve essere "Path not allowed" — è il path check che stiamo testando
    expect(result.error).not.toMatch(/Path not allowed/i)
  })

  it('filesystem.write blocca path sibling con stesso prefisso stringa', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.write')!
    const allowedDir = resolve('/tmp/p3tm-b1-write-allowed')
    const siblingDir = resolve('/tmp/p3tm-b1-write-allowed-sibling')
    const blockedPath = resolve(siblingDir, 'pwned.txt')
    const result = await tool.execute(
      { path: blockedPath, content: 'attacker' },
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000, sandboxEnabled: true,
        allowedPaths: [allowedDir],
      },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Path not allowed/i)
  })
})

// === B4: try/catch strutturato su /api/steering =====================

describe('Fase 2 — B4: /api/steering try/catch strutturato', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST /api/steering con body JSON invalido ritorna 400 (no 500 stack trace)', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/steering/route')
    const req = new NextRequest('http://localhost/api/steering', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    })
    req.cookies.set('sota_session', token)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/Invalid JSON body/i)
  })

  it('POST /api/steering con body valido ritorna 200 + steering result', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/steering/route')
    const req = makeRequest('POST', token, {
      agentId: 'p3tm-test-steer',
      budgetTotal: 1000,
      budgetUsed: 100,
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
  })
})

// === B4: try/catch strutturato su /api/admin/tools ==================

describe('Fase 2 — B4: /api/admin/tools try/catch strutturato', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('POST /api/admin/tools con body JSON invalido ritorna 500 con detail (no stack)', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/admin/tools/route')
    const req = new NextRequest('http://localhost/api/admin/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    })
    req.cookies.set('sota_session', token)
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toBeDefined()
    expect(body.detail).toBeDefined()
  })

  it('GET /api/admin/tools ritorna 200 con builtin + registered + mcpExternal', async () => {
    const token = await makeAdminSession()
    const { GET } = await import('@/app/api/admin/tools/route')
    const req = makeRequest('GET', token, undefined, '/api/admin/tools')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body.builtin)).toBe(true)
    expect(Array.isArray(body.registered)).toBe(true)
    expect(body.mcpExternal).toBeDefined()
  })
})

// === C2: executeRegistered scope-based check ========================

describe('Fase 2 — C2: executeRegistered scope-based check', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('tool registrato senza tool:exec scope granted viene bloccato', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/admin/tools/route')
    const userFacingToolId = 'p3tm-test-c2-no-exec'

    // Register tool with http transport
    const registerReq = makeRequest('POST', token, {
      action: 'register',
      toolId: userFacingToolId,
      name: 'C2 No Exec Tool',
      transport: 'http',
      endpoint: 'https://example.com/api',
    }, '/api/admin/tools')
    await POST(registerReq)

    // Grant only filesystem:read (not tool:exec, not network:post)
    const grantReq = makeRequest('POST', token, {
      action: 'grant-scope',
      toolId: userFacingToolId,
      scope: 'filesystem:read',
    }, '/api/admin/tools')
    await POST(grantReq)

    // Try to dispatch the tool
    const testReq = makeRequest('POST', token, {
      action: 'test',
      toolName: userFacingToolId,
      args: {},
      agentId: 'test-c2',
    }, '/api/admin/tools')
    const res = await POST(testReq)
    const body = await json(res)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/Permission denied.*tool:exec/i)
  })

  it('tool registrato con tool:exec + network:post granted passa lo scope check', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/admin/tools/route')
    const userFacingToolId = 'p3tm-test-c2-with-exec'

    // Register
    const registerReq = makeRequest('POST', token, {
      action: 'register',
      toolId: userFacingToolId,
      name: 'C2 With Exec Tool',
      transport: 'http',
      endpoint: 'https://example.com/api',
    }, '/api/admin/tools')
    await POST(registerReq)

    // Grant required scopes
    for (const scope of ['tool:exec', 'network:post']) {
      const grantReq = makeRequest('POST', token, {
        action: 'grant-scope',
        toolId: userFacingToolId,
        scope,
      }, '/api/admin/tools')
      await POST(grantReq)
    }

    // Dispatch — should pass scope check (will fail at network level, but that's OK)
    const testReq = makeRequest('POST', token, {
      action: 'test',
      toolName: userFacingToolId,
      args: {},
      agentId: 'test-c2',
    }, '/api/admin/tools')
    const res = await POST(testReq)
    const body = await json(res)
    // Scope check passed; will fail at fetch level (DNS or connection error)
    expect(body.success).toBe(false)
    expect(body.error).not.toMatch(/Permission denied/i)
  })
})
