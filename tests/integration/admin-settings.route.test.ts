/**
 * Integration tests for /api/admin/settings (C6).
 *
 * We exercise the real route handlers (GET and POST) end-to-end with a real
 * admin session created in the test DB. The handlers see a real NextRequest
 * with the sota_session cookie set, run the real requireAdmin middleware,
 * and write through the real settings store to the real SQLite DB.
 *
 * Coverage:
 *   - GET 401 without session
 *   - GET 403 with non-admin (viewer) session
 *   - GET 200 with admin session returns settings + live blocks
 *   - POST 400 with missing body
 *   - POST 200 applies writable updates, returns applied + rejected
 *   - POST rejects read-only keys with reason
 *   - POST rejects unknown keys
 *   - POST reload=true reloads cache
 *   - POST change is visible on next GET
 *   - GET /api/admin/settings/reload returns reloaded:true
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// Route handlers are imported once at the top. Both store + route use the
// same singleton `db`, so DB writes from the route are visible to the store
// and vice versa.
import { GET as settingsGet, POST as settingsPost } from '@/app/api/admin/settings/route'
import { GET as reloadGet, POST as reloadPost } from '@/app/api/admin/settings/reload/route'
import * as settingsStore from '@/lib/settings/store'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'admin-c6-test@example.com'
const VIEWER_EMAIL = 'viewer-c6-test@example.com'
const ADMIN_USER_ID = 'c6-admin-user'
const VIEWER_USER_ID = 'c6-viewer-user'
const ADMIN_TENANT = 'c6-test-tenant'

async function createAdminSession(): Promise<string> {
  await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      id: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      name: 'C6 Admin',
      role: 'admin',
      tenantId: ADMIN_TENANT,
      active: true,
    },
    update: { role: 'admin', active: true },
  })

  const token = `c6-admin-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: {
      userId: ADMIN_USER_ID,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  return token
}

async function createViewerSession(): Promise<string> {
  await db.user.upsert({
    where: { email: VIEWER_EMAIL },
    create: {
      id: VIEWER_USER_ID,
      email: VIEWER_EMAIL,
      name: 'C6 Viewer',
      role: 'viewer',
      tenantId: ADMIN_TENANT,
      active: true,
    },
    update: { role: 'viewer', active: true },
  })

  const token = `c6-viewer-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: {
      userId: VIEWER_USER_ID,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  return token
}

async function cleanupFixtures() {
  await db.systemSetting.deleteMany({})
  await db.session.deleteMany({ where: { userId: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
  await db.user.deleteMany({ where: { id: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
}

function makeRequest(
  method: 'GET' | 'POST',
  token: string | null,
  body?: unknown,
  path = '/api/admin/settings',
): NextRequest {
  // Next's NextRequest uses its own RequestInit type that extends the DOM
  // lib version with extra optional fields; cast to any to avoid coupling
  // the test to that internal type.
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }

  const req = new NextRequest(`http://localhost${path}`, init)
  if (token) {
    req.cookies.set('sota_session', token)
  }
  return req
}

async function json(res: Response): Promise<any> {
  return res.json()
}

// === Tests ===========================================================

describe('C6 /api/admin/settings', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    await settingsStore.__resetCacheForTests()
    // Prime the cache so sync readers see defaults.
    await settingsStore.reloadCache()
  })

  afterEach(async () => {
    await cleanupFixtures()
    await settingsStore.__resetCacheForTests()
  })

  // --- Auth ----------------------------------------------------------

  it('GET returns 401 without session cookie', async () => {
    const req = makeRequest('GET', null)
    const res = await settingsGet(req)
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body.error).toMatch(/Not authenticated|session/i)
  })

  it('GET returns 403 for viewer role', async () => {
    const token = await createViewerSession()
    const req = makeRequest('GET', token)
    const res = await settingsGet(req)
    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error).toMatch(/permission|Insufficient/i)
  })

  // --- GET -----------------------------------------------------------

  it('GET returns 200 for admin with settings + live blocks', async () => {
    const token = await createAdminSession()
    const req = makeRequest('GET', token)
    const res = await settingsGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)

    // settings array covers every known setting def
    expect(Array.isArray(body.settings)).toBe(true)
    expect(body.settings.length).toBe(settingsStore.SETTING_DEFS.length)

    // byCategory groups by category string
    expect(body.byCategory).toBeTruthy()
    expect(body.byCategory.llm).toBeTruthy()
    expect(body.byCategory.tools).toBeTruthy()
    expect(body.byCategory.database).toBeTruthy()

    // live block keeps the legacy fields used by the admin UI
    expect(body.live).toBeTruthy()
    expect(body.live.database).toBeTruthy()
    expect(body.live.llm).toBeTruthy()
    expect(body.live.embedding).toBeTruthy()
    expect(body.live.eventMesh).toBeTruthy()
    expect(body.live.observability).toBeTruthy()
    expect(body.live.integration).toBeTruthy()
    expect(body.live.toolPaths).toBeTruthy()
    expect(body.schemaVersion).toBe(1)

    // Each settings row has the expected shape
    const sample = body.settings[0]
    expect(sample).toHaveProperty('key')
    expect(sample).toHaveProperty('value')
    expect(sample).toHaveProperty('category')
    expect(sample).toHaveProperty('readOnly')
    expect(sample).toHaveProperty('description')
    expect(sample).toHaveProperty('source')
    expect(['db', 'env', 'default']).toContain(sample.source)
  })

  // --- POST ----------------------------------------------------------

  it('POST returns 400 for missing body', async () => {
    const token = await createAdminSession()
    // Send a body that doesn't parse as our expected shape
    const req = makeRequest('POST', token, {})
    const res = await settingsPost(req)
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/updates|reload/i)
  })

  it('POST applies a writable setting and reports previousValue', async () => {
    const token = await createAdminSession()
    const req = makeRequest('POST', token, {
      updates: { 'llm.max_tokens': '1024' },
    })
    const res = await settingsPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)

    expect(body.updated).toBe(true)
    expect(body.applied).toHaveLength(1)
    expect(body.applied[0].key).toBe('llm.max_tokens')
    expect(body.applied[0].newValue).toBe('1024')
    expect(body.applied[0].previousValue).toBe('500') // default
    expect(body.applied[0].source).toBe('db')

    expect(body.rejected).toEqual([])
    expect(body.requiresRestart).toEqual([])
    expect(body.writableKeys).toContain('llm.max_tokens')
  })

  it('POST rejects read-only keys', async () => {
    const token = await createAdminSession()
    const req = makeRequest('POST', token, {
      updates: { 'database.url': 'postgres://should-not-be-applied' },
    })
    const res = await settingsPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)

    expect(body.updated).toBe(false)
    expect(body.applied).toEqual([])
    expect(body.rejected).toHaveLength(1)
    expect(body.rejected[0].key).toBe('database.url')
    expect(body.rejected[0].reason).toMatch(/read-only/i)
    expect(body.requiresRestart).toContain('database.url')
  })

  it('POST rejects unknown keys', async () => {
    const token = await createAdminSession()
    const req = makeRequest('POST', token, {
      updates: { 'totally.made_up': 'whatever' },
    })
    const res = await settingsPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)

    expect(body.updated).toBe(false)
    expect(body.applied).toEqual([])
    expect(body.rejected).toHaveLength(1)
    expect(body.rejected[0].key).toBe('totally.made_up')
    expect(body.rejected[0].reason).toMatch(/Unknown setting/i)
  })

  it('POST applies some and rejects others in the same call', async () => {
    const token = await createAdminSession()
    const req = makeRequest('POST', token, {
      updates: {
        'mesh.backend': 'redis',
        'server.port': '4000', // read-only
        'fake.key': 'x', // unknown
      },
    })
    const res = await settingsPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)

    expect(body.applied).toHaveLength(1)
    expect(body.applied[0].key).toBe('mesh.backend')
    expect(body.applied[0].newValue).toBe('redis')

    expect(body.rejected).toHaveLength(2)
    const rejectedKeys = body.rejected.map((r: any) => r.key).sort()
    expect(rejectedKeys).toEqual(['fake.key', 'server.port'])
  })

  it('POST change is visible on subsequent GET', async () => {
    const token = await createAdminSession()

    // Apply
    const postReq = makeRequest('POST', token, {
      updates: { 'embedding.provider': 'ollama' },
    })
    const postRes = await settingsPost(postReq)
    expect(postRes.status).toBe(200)

    // Read back
    const getReq = makeRequest('GET', token)
    const getRes = await settingsGet(getReq)
    expect(getRes.status).toBe(200)
    const body = await json(getRes)

    const emb = body.settings.find((s: any) => s.key === 'embedding.provider')
    expect(emb.value).toBe('ollama')
    expect(emb.source).toBe('db')
  })

  it('POST with reload=true (no updates) reloads cache', async () => {
    const token = await createAdminSession()

    // Direct DB write, bypassing the cache.
    await db.systemSetting.upsert({
      where: { key: 'mesh.backend' },
      create: {
        key: 'mesh.backend',
        value: 'nats',
        category: 'mesh',
        readOnly: false,
        updatedBy: 'external',
      },
      update: { value: 'nats', updatedBy: 'external' },
    })

    // Cache still has the default before reload.
    const before = await settingsStore.getSetting('mesh.backend')
    expect(before?.source).toBe('default')

    const req = makeRequest('POST', token, { reload: true })
    const res = await settingsPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.reloaded).toBe(true)

    const after = await settingsStore.getSetting('mesh.backend')
    expect(after?.source).toBe('db')
    expect(after?.value).toBe('nats')
  })

  // --- /reload subroute ----------------------------------------------

  it('POST /api/admin/settings/reload returns reloaded:true', async () => {
    const token = await createAdminSession()
    const req = makeRequest('POST', token, undefined, '/api/admin/settings/reload')
    const res = await reloadPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.reloaded).toBe(true)
    expect(body.cacheLoaded).toBe(true)
    expect(typeof body.durationMs).toBe('number')
  })

  it('GET /api/admin/settings/reload also works as a convenience', async () => {
    const token = await createAdminSession()
    const req = makeRequest('GET', token, undefined, '/api/admin/settings/reload')
    const res = await reloadGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.reloaded).toBe(true)
  })

  it('POST /api/admin/settings/reload requires admin', async () => {
    const token = await createViewerSession()
    const req = makeRequest('POST', token, undefined, '/api/admin/settings/reload')
    const res = await reloadPost(req)
    expect(res.status).toBe(403)
  })
})
