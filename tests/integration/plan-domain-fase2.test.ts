/**
 * Integration tests for Plan Domain Fase 2 (C1, C2, C3).
 *
 * C1 — Sandbox isolation: verify that node:vm sandbox in compiled-ai.ts
 *   blocks access to process, require, db, fetch, constructor.constructor.
 * C2 — /api/evaluation auth: verify 401 without session, 403 for viewer.
 * C3 — parseLlmJson: verify markdown stripping, balanced extraction,
 *   recovery, fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as vm from 'node:vm'
import {
  stripMarkdownCodeBlocks,
  extractBalancedJson,
  parseLlmJson,
} from '@/lib/llm-client/parse-json'
import { checkSafety, checkSyntax, checkExecution } from '@/lib/kernel/compiled-ai'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'plan2-admin-test@example.com'
const VIEWER_EMAIL = 'plan2-viewer-test@example.com'
const ADMIN_USER_ID = 'plan2-admin-user'
const VIEWER_USER_ID = 'plan2-viewer-user'
const TENANT = 'plan2-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Plan2 ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `plan2-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

// === C1: compiled-ai sandbox isolation ===============================

describe('Fase 2 — C1: compiled-ai sandbox isolation', () => {
  it('checkSafety blocks constructor.constructor (C1 fix)', () => {
    const result = checkSafety('return input.constructor.constructor("return process")()')
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/constructor\.constructor/)
  })

  it('checkSafety blocks eval(', () => {
    expect(checkSafety('return eval("1+1")').passed).toBe(false)
  })

  it('checkSafety blocks require(', () => {
    expect(checkSafety('return require("fs")').passed).toBe(false)
  })

  it('checkSafety blocks process.exit', () => {
    expect(checkSafety('return process.exit(0)').passed).toBe(false)
  })

  it('checkSafety blocks fetch(', () => {
    expect(checkSafety('return fetch("http://evil.com")').passed).toBe(false)
  })

  it('checkSafety allows safe code', () => {
    expect(checkSafety('return input.value * 2').passed).toBe(true)
  })

  it('checkSyntax validates with vm.Script (not new Function)', () => {
    expect(checkSyntax('return input.value').passed).toBe(true)
    expect(checkSyntax('return input.').passed).toBe(false)
  })

  it('checkExecution runs in vm sandbox — no process access', () => {
    // This code tries to access process — should fail in sandbox
    const result = checkExecution('return process.env.HOME', { value: 'test' })
    expect(result.passed).toBe(false)
  })

  it('checkExecution runs safe code successfully', () => {
    const result = checkExecution('return input.value * 2', { value: 21 })
    expect(result.passed).toBe(true)
  })

  it('checkExecution blocks setTimeout (not in sandbox context)', () => {
    const result = checkExecution('return setTimeout(() => {}, 0)', {})
    expect(result.passed).toBe(false)
  })

  it('checkExecution blocks require (not in sandbox context)', () => {
    const result = checkExecution('return require("fs")', {})
    expect(result.passed).toBe(false)
  })
})

// === C2: /api/evaluation auth ========================================

describe('Fase 2 — C2: /api/evaluation auth', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('GET /api/evaluation returns 401 without session', async () => {
    const { GET } = await import('@/app/api/evaluation/route')
    const req = makeRequest('GET', null, undefined, '/api/evaluation')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/evaluation returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const { GET } = await import('@/app/api/evaluation/route')
    const req = makeRequest('GET', token, undefined, '/api/evaluation')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('stats')
    expect(body).toHaveProperty('benchmarks')
  })

  it('POST /api/evaluation returns 401 without session', async () => {
    const { POST } = await import('@/app/api/evaluation/route')
    const req = makeRequest('POST', null, { action: 'seed-defaults' }, '/api/evaluation')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('POST /api/evaluation returns 403 for viewer (was open before C2)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/evaluation/route')
    const req = makeRequest('POST', token, { action: 'seed-defaults' }, '/api/evaluation')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/evaluation seed-defaults returns 200 for admin', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/evaluation/route')
    const req = makeRequest('POST', token, { action: 'seed-defaults' }, '/api/evaluation')
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// === C3: parseLlmJson helper =========================================

describe('Fase 2 — C3: parseLlmJson helper', () => {
  it('stripMarkdownCodeBlocks removes ```json fences', () => {
    const raw = '```json\n{"key": "value"}\n```'
    const cleaned = stripMarkdownCodeBlocks(raw)
    expect(cleaned).toBe('{"key": "value"}')
  })

  it('stripMarkdownCodeBlocks removes plain ``` fences', () => {
    const raw = '```\n{"key": "value"}\n```'
    const cleaned = stripMarkdownCodeBlocks(raw)
    expect(cleaned).toBe('{"key": "value"}')
  })

  it('stripMarkdownCodeBlocks leaves non-fenced code unchanged', () => {
    const raw = '{"key": "value"}'
    expect(stripMarkdownCodeBlocks(raw)).toBe('{"key": "value"}')
  })

  it('extractBalancedJson handles nested objects', () => {
    const text = 'prefix {"a": {"b": 1}, "c": 2} suffix'
    const result = extractBalancedJson(text)
    expect(result).toBe('{"a": {"b": 1}, "c": 2}')
  })

  it('extractBalancedJson handles strings with braces', () => {
    const text = '{"key": "value with } brace"}'
    const result = extractBalancedJson(text)
    expect(result).toBe('{"key": "value with } brace"}')
  })

  it('extractBalancedJson returns null for no JSON', () => {
    expect(extractBalancedJson('no json here')).toBeNull()
  })

  it('parseLlmJson parses clean JSON', () => {
    const result = parseLlmJson('{"goal": "test", "tasks": []}')
    expect(result.goal).toBe('test')
    expect(result.tasks).toEqual([])
  })

  it('parseLlmJson strips markdown and parses', () => {
    const raw = '```json\n{"goal": "test", "tasks": []}\n```'
    const result = parseLlmJson(raw)
    expect(result.goal).toBe('test')
  })

  it('parseLlmJson handles prose prefix', () => {
    const raw = 'Sure! Here is the plan:\n{"goal": "test", "tasks": []}'
    const result = parseLlmJson(raw)
    expect(result.goal).toBe('test')
  })

  it('parseLlmJson uses fallback on parse failure', () => {
    const fallback = { goal: 'fallback', tasks: [] }
    const result = parseLlmJson('not json at all', fallback)
    expect(result.goal).toBe('fallback')
  })

  it('parseLlmJson throws if no fallback and parse fails', () => {
    expect(() => parseLlmJson('not json at all')).toThrow(/JSON/)
  })

  it('parseLlmJson recovers from trailing comma', () => {
    const raw = '{"key": "value",}'
    const result = parseLlmJson(raw)
    expect(result.key).toBe('value')
  })

  it('parseLlmJson handles LLM output with multiple braces in prose', () => {
    const raw = 'Here is the plan. Note: use { } for objects.\n{"goal": "test", "tasks": [{"taskId": "T1", "agentId": "orchestrator", "description": "test", "dependencies": []}]}'
    const result = parseLlmJson(raw)
    expect(result.goal).toBe('test')
    expect(result.tasks).toHaveLength(1)
  })
})
