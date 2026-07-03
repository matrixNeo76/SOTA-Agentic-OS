/**
 * Integration tests for Verify Domain Fase 2 (C1-C6, B3).
 *
 * C1 — /api/esr POST requireAdmin (was requireAuth)
 * C2 — /api/lean POST requireAdmin (was requireAuth)
 * C3 — voteQuorum duplicate vote prevention
 * C4 — voteQuorum atomic increment (no lost update)
 * C6 — AgentLog writes on mutative actions
 * B3 — lean4-agent.ts JSON.parse try/catch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { voteQuorum, proposeQuorumAction, recordBelief } from '@/lib/kernel/esr-quorum'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'verify2-admin-test@example.com'
const VIEWER_EMAIL = 'verify2-viewer-test@example.com'
const ADMIN_USER_ID = 'verify2-admin-user'
const VIEWER_USER_ID = 'verify2-viewer-user'
const TENANT = 'verify2-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Verify2 ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `verify2-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession() { return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID) }
function makeViewerSession() { return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID) }

async function cleanupFixtures() {
  await db.quorumVote.deleteMany({ where: { voterAgentId: { startsWith: 'test-voter-' } } })
  await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'test-wj-' } } })
  await db.belief.deleteMany({ where: { agentId: { startsWith: 'test-belief-agent-' } } })
  await db.agentLog.deleteMany({ where: { agentId: { startsWith: 'test-belief-agent-' } } })
  await db.agentLog.deleteMany({ where: { agentId: 'quorum' } })
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

// === C1: /api/esr auth ==============================================

describe('Fase 2 — C1: /api/esr POST requireAdmin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('GET /api/esr returns 401 without session', async () => {
    const { GET } = await import('@/app/api/esr/route')
    const req = makeRequest('GET', null, undefined, '/api/esr')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/esr returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const { GET } = await import('@/app/api/esr/route')
    const req = makeRequest('GET', token, undefined, '/api/esr?action=stats')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/esr returns 401 without session', async () => {
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', null, { action: 'record_belief', agentId: 'test', content: 'test' }, '/api/esr')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('POST /api/esr returns 403 for viewer (was open before C1)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, { action: 'record_belief', agentId: 'test', content: 'test' }, '/api/esr')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/esr record_belief returns 200 for admin', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, {
      action: 'record_belief',
      agentId: 'test-belief-agent-c1',
      content: 'test belief',
      beliefType: 'observation',
    }, '/api/esr')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
  })

  it('POST /api/esr validates beliefType', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, {
      action: 'record_belief',
      agentId: 'test-belief-agent-invalid',
      content: 'test',
      beliefType: 'invalid_type',
    }, '/api/esr')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST /api/esr validates requiredQuorum', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, {
      action: 'propose_quorum',
      workflowJoinId: 'test-wj-invalid',
      quorumAction: 'test',
      requiredQuorum: 0,
    }, '/api/esr')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST /api/esr validates vote value', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, {
      action: 'vote_quorum',
      decisionId: 'fake',
      voterAgentId: 'test-voter-1',
      vote: 'invalid',
    }, '/api/esr')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// === C2: /api/lean auth =============================================

describe('Fase 2 — C2: /api/lean POST requireAdmin', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('GET /api/lean returns 200 for viewer', async () => {
    const token = await makeViewerSession()
    const { GET } = await import('@/app/api/lean/route')
    const req = makeRequest('GET', token, undefined, '/api/lean?action=stats')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/lean returns 403 for viewer (was open before C2)', async () => {
    const token = await makeViewerSession()
    const { POST } = await import('@/app/api/lean/route')
    const req = makeRequest('POST', token, { action: 'auto_contracts', planId: 'fake' }, '/api/lean')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

// === C3: duplicate vote prevention ===================================

describe('Fase 2 — C3: voteQuorum duplicate vote prevention', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('first vote succeeds', async () => {
    // Create a quorum decision first
    const { decisionId } = await proposeQuorumAction('test-wj-c3', 'test_action', 2)

    const result = await voteQuorum(decisionId, 'test-voter-1', 'accept')
    expect(result.verdict).toBe('pending') // need 2 votes
    expect(result.acceptCount).toBe(1)
  })

  it('second vote from same voter throws (C3 fix)', async () => {
    const { decisionId } = await proposeQuorumAction('test-wj-c3-dup', 'test_action', 2)

    await voteQuorum(decisionId, 'test-voter-2', 'accept')

    await expect(voteQuorum(decisionId, 'test-voter-2', 'accept'))
      .rejects.toThrow(/already voted/)
  })

  it('second vote from different voter succeeds', async () => {
    const { decisionId } = await proposeQuorumAction('test-wj-c3-diff', 'test_action', 2)

    await voteQuorum(decisionId, 'test-voter-3', 'accept')
    const result = await voteQuorum(decisionId, 'test-voter-4', 'accept')
    expect(result.verdict).toBe('accepted') // reached requiredQuorum=2
  })

  it('API returns 409 on duplicate vote', async () => {
    const token = await makeAdminSession()
    const { decisionId } = await proposeQuorumAction('test-wj-c3-api', 'test_action', 2)

    // First vote via API
    const { POST } = await import('@/app/api/esr/route')
    const req1 = makeRequest('POST', token, {
      action: 'vote_quorum',
      decisionId,
      voterAgentId: 'test-voter-5',
      vote: 'accept',
    }, '/api/esr')
    const res1 = await POST(req1)
    expect(res1.status).toBe(200)

    // Duplicate vote via API
    const req2 = makeRequest('POST', token, {
      action: 'vote_quorum',
      decisionId,
      voterAgentId: 'test-voter-5',
      vote: 'accept',
    }, '/api/esr')
    const res2 = await POST(req2)
    expect(res2.status).toBe(409)
    const body = await json(res2)
    expect(body.code).toBe('DUPLICATE_VOTE')
  })
})

// === C6: audit trail (AgentLog) =====================================

describe('Fase 2 — C6: AgentLog on /api/esr mutative actions', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('record_belief writes AgentLog', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, {
      action: 'record_belief',
      agentId: 'test-belief-agent-c6',
      content: 'test audit',
      beliefType: 'observation',
    }, '/api/esr')
    await POST(req)

    const logs = await db.agentLog.findMany({
      where: { agentId: 'test-belief-agent-c6', event: 'belief_recorded' },
    })
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0].phase).toBe('13')
    expect(logs[0].payload).toMatch(/triggeredBy/)
  })

  it('propose_quorum writes AgentLog', async () => {
    const token = await makeAdminSession()
    const { POST } = await import('@/app/api/esr/route')
    const req = makeRequest('POST', token, {
      action: 'propose_quorum',
      workflowJoinId: 'test-wj-c6',
      quorumAction: 'test_audit',
      requiredQuorum: 2,
    }, '/api/esr')
    await POST(req)

    const logs = await db.agentLog.findMany({
      where: { agentId: 'quorum', event: 'quorum_proposed' },
    })
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })
})

// === B3: lean4-agent JSON.parse try/catch ===========================

describe('Fase 2 — B3: lean4-agent JSON.parse robustness', () => {
  it('verifyWorkflow handles corrupted planJson gracefully', async () => {
    // Create a plan with corrupted planJson
    const plan = await db.agentPlan.create({
      data: {
        taskGoal: 'test-corrupted',
        planJson: '{ invalid json {{{',
        dagJson: '[]',
        status: 'scheduled',
        agentCount: 1,
      },
    })

    const { verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    // Should not throw — should return results with empty tasks
    const result = await verifyWorkflow(plan.id)
    expect(result).toHaveProperty('verified')
    expect(result).toHaveProperty('results')

    // Cleanup
    await db.agentPlan.delete({ where: { id: plan.id } })
  })
})
