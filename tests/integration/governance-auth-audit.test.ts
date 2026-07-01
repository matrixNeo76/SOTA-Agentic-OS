/**
 * Integration tests for governance API routes (C1 + C4 + C5 fixes — Fase 2).
 *
 * Coverage:
 *   AUTH (C1 + C4):
 *     - GET /api/conflict-resolution returns 401 without session
 *     - GET /api/conflict-resolution returns 200 with viewer session (read-only)
 *     - POST /api/conflict-resolution returns 401 without session
 *     - POST /api/conflict-resolution returns 403 for viewer (was 200 before fix)
 *     - POST /api/blocked-actions returns 403 for viewer (was 200 before fix)
 *     - POST /api/verify add_ltl returns 403 for viewer (was 200 before fix)
 *     - POST /api/verify validate_ltl returns 200 for viewer (read-only exception)
 *     - POST /api/verify preview_fsm returns 200 for viewer (read-only exception)
 *     - POST /api/reflect returns 403 for viewer (was 200 before fix)
 *     - POST /api/retainer returns 403 for viewer (was 200 before fix)
 *
 *   AUDIT (C5):
 *     - POST /api/admin/governance resolve-blocked writes AuditLedgerEntry
 *     - POST /api/admin/governance resolve-approval writes AuditLedgerEntry
 *     - POST /api/admin/governance toggle-ltl writes AuditLedgerEntry
 *     - POST /api/admin/governance add-redline writes AuditLedgerEntry
 *     - AuditLedgerEntry contains correct agentId, action, outcome, resolvedBy
 *
 *   DATA-STORE (C2 + C3):
 *     - data-store fetchBlocked reads .items (not .actions)
 *     - data-store fetchBlocked uses ?action=recent (not ?action=all)
 *
 * Pattern: real route handlers + real SQLite DB + real session cookies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// Route handlers
import { GET as conflictGet, POST as conflictPost } from '@/app/api/conflict-resolution/route'
import { GET as blockedGet, POST as blockedPost } from '@/app/api/blocked-actions/route'
import { GET as verifyGet, POST as verifyPost } from '@/app/api/verify/route'
import { GET as reflectGet, POST as reflectPost } from '@/app/api/reflect/route'
import { GET as retainerGet, POST as retainerPost } from '@/app/api/retainer/route'
import { GET as adminGovGet, POST as adminGovPost } from '@/app/api/admin/governance/route'

// === Fixtures ========================================================

const ADMIN_EMAIL = 'gov-admin-test@example.com'
const VIEWER_EMAIL = 'gov-viewer-test@example.com'
const ADMIN_USER_ID = 'gov-admin-user'
const VIEWER_USER_ID = 'gov-viewer-user'
const TENANT = 'gov-test-tenant'

async function createSession(role: 'admin' | 'viewer', email: string, userId: string): Promise<string> {
  await db.user.upsert({
    where: { email },
    create: { id: userId, email, name: `Gov ${role}`, role, tenantId: TENANT, active: true },
    update: { role, active: true },
  })
  const token = `gov-${role}-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.session.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  return token
}

function makeAdminSession(): Promise<string> {
  return createSession('admin', ADMIN_EMAIL, ADMIN_USER_ID)
}
function makeViewerSession(): Promise<string> {
  return createSession('viewer', VIEWER_EMAIL, VIEWER_USER_ID)
}

async function cleanupFixtures() {
  // Clean governance data created by tests
  await db.auditLedgerEntry.deleteMany({ where: { agentId: { in: ['test-agent', 'verifier', 'reflective', 'orchestrator'] } } })
  await db.agentLog.deleteMany({ where: { agentId: { in: ['test-agent', 'verifier', 'reflective', 'orchestrator'] } } })
  await db.blockedAction.deleteMany({ where: { agentId: 'test-agent' } })
  await db.approvalGate.deleteMany({ where: { agentId: 'test-agent' } })
  await db.lTLRule.deleteMany({ where: { ruleId: { startsWith: 'LTL-TEST-' } } })
  await db.redLine.deleteMany({ where: { description: { startsWith: 'TEST-RL-' } } })
  await db.normativeRule.deleteMany({ where: { axiom: { startsWith: 'TEST-AXIOM-' } } })
  await db.session.deleteMany({ where: { userId: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
  await db.user.deleteMany({ where: { id: { in: [ADMIN_USER_ID, VIEWER_USER_ID] } } })
}

function makeRequest(
  method: 'GET' | 'POST',
  token: string | null,
  body?: unknown,
  path = '/api/test',
): NextRequest {
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  const req = new NextRequest(`http://localhost${path}`, init)
  if (token) req.cookies.set('sota_session', token)
  return req
}

async function json(res: Response): Promise<any> {
  return res.json()
}

// Mock WS publish (in test env, no WS server running)
vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === Tests ===========================================================

describe('Fase 2 — Governance Auth (C1 + C4)', () => {
  beforeEach(async () => {
    await cleanupFixtures()
  })
  afterEach(async () => {
    await cleanupFixtures()
  })

  // --- C1: /api/conflict-resolution ---

  it('GET /api/conflict-resolution returns 401 without session', async () => {
    const req = makeRequest('GET', null, undefined, '/api/conflict-resolution')
    const res = await conflictGet(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/conflict-resolution returns 200 for viewer (read-only)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/conflict-resolution')
    const res = await conflictGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('pending')
    expect(body).toHaveProperty('stats')
  })

  it('POST /api/conflict-resolution returns 401 without session', async () => {
    const req = makeRequest('POST', null, { action: 'auto-resolve' }, '/api/conflict-resolution')
    const res = await conflictPost(req)
    expect(res.status).toBe(401)
  })

  it('POST /api/conflict-resolution returns 403 for viewer (was open before C1)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, { action: 'auto-resolve' }, '/api/conflict-resolution')
    const res = await conflictPost(req)
    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error).toMatch(/permission|Insufficient/i)
  })

  // --- C4: /api/blocked-actions ---

  it('GET /api/blocked-actions returns 401 without session', async () => {
    const req = makeRequest('GET', null, undefined, '/api/blocked-actions')
    const res = await blockedGet(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/blocked-actions returns 200 for viewer (pending)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/blocked-actions?action=pending')
    const res = await blockedGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('items')
  })

  it('POST /api/blocked-actions resolve returns 403 for viewer (was open before C4)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'resolve',
      blockedId: 'fake-id',
      choice: 'approved',
    }, '/api/blocked-actions')
    const res = await blockedPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/blocked-actions register returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'register',
      input: { agentId: 'x', action: 'y', source: 'ltl', axiomTrail: [] },
    }, '/api/blocked-actions')
    const res = await blockedPost(req)
    expect(res.status).toBe(403)
  })

  // --- C4: /api/verify (mixed auth: read-only stays requireAuth, mutative goes requireAdmin) ---

  it('POST /api/verify validate_ltl returns 200 for viewer (read-only exception)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'validate_ltl',
      formula: 'G(p -> X q)',
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/verify preview_fsm returns 200 for viewer (read-only exception)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'preview_fsm',
      formula: 'G(p -> X q)',
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/verify add_ltl returns 403 for viewer (was open before C4)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'add_ltl',
      spec: { ruleId: 'LTL-TEST-FORBIDDEN', formula: 'G(p)', description: 'test', severity: 'warn' },
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/verify delete_ltl returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'delete_ltl',
      ruleId: 'LTL-001',
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/verify add_axiom returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'add_axiom',
      axiom: 'TEST-AXIOM-FORBIDDEN',
      priority: 1,
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/verify verify_event returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'verify_event',
      eventLabel: 'check',
      eventType: 'tool_call',
      payload: {},
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(403)
  })

  // --- C4: /api/reflect ---

  it('GET /api/reflect returns 200 for viewer (read-only)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/reflect')
    const res = await reflectGet(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/reflect returns 403 for viewer (was open before C4)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'reflect',
      input: {
        operationId: 'test-op',
        goal: 'test',
        outcome: 'success',
        steps: [],
        context: 'test',
      },
    }, '/api/reflect')
    const res = await reflectPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/reflect feedback returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'feedback',
      heuristicId: 'fake-id',
      success: true,
    }, '/api/reflect')
    const res = await reflectPost(req)
    expect(res.status).toBe(403)
  })

  // --- C4: /api/retainer ---

  it('GET /api/retainer returns 200 for viewer (stats)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/retainer?action=stats')
    const res = await retainerGet(req)
    expect(res.status).toBe(200)
  })

  it('POST /api/retainer grant_delegation returns 403 for viewer (was open before C4)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'grant_delegation',
      agentId: 'test-agent',
      scope: 'tool:exec',
      constraints: {},
      grantedBy: 'viewer',
    }, '/api/retainer')
    const res = await retainerPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/retainer resolve_approval returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'resolve_approval',
      gateId: 'fake-id',
      decision: 'approved',
    }, '/api/retainer')
    const res = await retainerPost(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/retainer resolve_normative returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'resolve_normative',
      conflict: {
        userInstruction: 'test',
        userLevel: 'AESTHETIC',
        systemPolicy: 'test',
        systemLevel: 'SAFETY',
      },
    }, '/api/retainer')
    const res = await retainerPost(req)
    expect(res.status).toBe(403)
  })
})

describe('Fase 2 — Governance Audit Logging (C5)', () => {
  beforeEach(async () => {
    await cleanupFixtures()
  })
  afterEach(async () => {
    await cleanupFixtures()
  })

  it('POST /api/admin/governance resolve-blocked writes AuditLedgerEntry', async () => {
    const token = await makeAdminSession()
    // Create a blocked action first
    const blocked = await db.blockedAction.create({
      data: {
        agentId: 'test-agent',
        action: 'dangerous_tool_call',
        source: 'ltl',
        axiomTrail: JSON.stringify([{ step: '1', rule: 'LTL-001', result: 'violated' }]),
        readableExplanation: 'Test blocked action',
        status: 'pending',
      },
    })

    const req = makeRequest('POST', token, {
      action: 'resolve-blocked',
      blockedActionId: blocked.id,
      choice: 'approved',
      reason: 'Test approved by admin',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(200)

    // Verify AuditLedgerEntry was created
    const entries = await db.auditLedgerEntry.findMany({
      where: { agentId: 'test-agent', action: 'dangerous_tool_call' },
    })
    expect(entries.length).toBe(1)
    const entry = entries[0]
    expect(entry.decision).toMatch(/admin_governance_api/)
    expect(entry.decision).toMatch(/resolve-blocked/)
    expect(entry.decision).toMatch(/approved/)
    expect(entry.decision).toMatch(new RegExp(ADMIN_EMAIL))
    expect(entry.readableNarrative).toMatch(/approvato/)
    expect(entry.readableNarrative).toMatch(new RegExp(ADMIN_EMAIL))
    expect(entry.reversible).toBe(true)
  })

  it('POST /api/admin/governance resolve-blocked returns 409 if already resolved', async () => {
    const token = await makeAdminSession()
    const blocked = await db.blockedAction.create({
      data: {
        agentId: 'test-agent',
        action: 'already_resolved',
        source: 'taint',
        axiomTrail: '[]',
        readableExplanation: 'Already resolved',
        status: 'rejected',
      },
    })
    const req = makeRequest('POST', token, {
      action: 'resolve-blocked',
      blockedActionId: blocked.id,
      choice: 'approved',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(409)
  })

  it('POST /api/admin/governance resolve-approval writes AuditLedgerEntry', async () => {
    const token = await makeAdminSession()
    const gate = await db.approvalGate.create({
      data: {
        agentId: 'test-agent',
        action: 'deploy_to_production',
        payload: '{}',
        reason: 'Irreversible action',
        status: 'pending',
      },
    })

    const req = makeRequest('POST', token, {
      action: 'resolve-approval',
      gateId: gate.id,
      choice: 'rejected',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(200)

    const entries = await db.auditLedgerEntry.findMany({
      where: { agentId: 'test-agent', action: 'deploy_to_production' },
    })
    expect(entries.length).toBe(1)
    const entry = entries[0]
    expect(entry.decision).toMatch(/resolve-approval/)
    expect(entry.decision).toMatch(/rejected/)
    expect(entry.readableNarrative).toMatch(/rifiutato/)
    // Semantic: rejected is reversible (action NOT executed, can still approve later),
    // approved is NOT reversible (action already executed). Mirrors artificial-retainer.ts.
    expect(entry.reversible).toBe(true)
  })

  it('POST /api/admin/governance toggle-ltl writes AuditLedgerEntry', async () => {
    const token = await makeAdminSession()
    const rule = await db.lTLRule.create({
      data: {
        ruleId: 'LTL-TEST-TOGGLE',
        ltlFormula: 'G(p -> X q)',
        description: 'Test rule for toggle audit',
        severity: 'warn',
        active: true,
      },
    })

    const req = makeRequest('POST', token, {
      action: 'toggle-ltl',
      ruleId: rule.id,
      active: false,
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(200)

    const entries = await db.auditLedgerEntry.findMany({
      where: { agentId: 'verifier', action: { contains: 'LTL-TEST-TOGGLE' } },
    })
    expect(entries.length).toBe(1)
    expect(entries[0].decision).toMatch(/deactivated/)
    expect(entries[0].decision).toMatch(new RegExp(ADMIN_EMAIL))
    expect(entries[0].readableNarrative).toMatch(/disattivato/)
  })

  it('POST /api/admin/governance add-redline writes AuditLedgerEntry', async () => {
    const token = await makeAdminSession()
    const req = makeRequest('POST', token, {
      action: 'add-redline',
      description: 'TEST-RL-never-delete-user-data',
      rationale: 'Critical safety rule',
      severity: 'absolute',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(200)

    const entries = await db.auditLedgerEntry.findMany({
      where: { agentId: 'reflective', action: { contains: 'TEST-RL-never-delete' } },
    })
    expect(entries.length).toBe(1)
    expect(entries[0].decision).toMatch(/add-redline/)
    expect(entries[0].decision).toMatch(/absolute/)
    expect(entries[0].readableNarrative).toMatch(/Red Line/)
    expect(entries[0].readableNarrative).toMatch(new RegExp(ADMIN_EMAIL))
  })

  it('AuditLedgerEntry is NOT written when admin governance action fails', async () => {
    const token = await makeAdminSession()
    // Try to resolve a non-existent blocked action
    const req = makeRequest('POST', token, {
      action: 'resolve-blocked',
      blockedActionId: 'non-existent-id',
      choice: 'approved',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(404)

    // No audit entry should be created for failed operations
    const entries = await db.auditLedgerEntry.findMany({
      where: { action: { contains: 'non-existent' } },
    })
    expect(entries.length).toBe(0)
  })

  it('POST /api/admin/governance also writes AgentLog', async () => {
    const token = await makeAdminSession()
    const blocked = await db.blockedAction.create({
      data: {
        agentId: 'test-agent',
        action: 'test-agentlog-action',
        source: 'normative',
        axiomTrail: '[]',
        readableExplanation: 'Test',
        status: 'pending',
      },
    })

    const req = makeRequest('POST', token, {
      action: 'resolve-blocked',
      blockedActionId: blocked.id,
      choice: 'rejected',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(200)

    const logs = await db.agentLog.findMany({
      where: { agentId: 'test-agent', event: 'blocked_action_resolved' },
      orderBy: { timestamp: 'desc' },
    })
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const log = logs[0] // Most recent — created by this test
    expect(log.phase).toBe('17')
    expect(log.payload).toMatch(/rejected/)
    expect(log.payload).toMatch(new RegExp(ADMIN_EMAIL))
    expect(log.level).toBe('warn') // rejected → warn
  })
})

describe('Fase 2 — Governance data-store field mapping (C2 + C3)', () => {
  // These tests verify the API contract that data-store depends on,
  // ensuring .items is returned (not .actions) and 'recent' is a valid action.

  beforeEach(async () => {
    await cleanupFixtures()
  })
  afterEach(async () => {
    await cleanupFixtures()
  })

  it('GET /api/blocked-actions?action=pending returns { items: [...] } (not .actions)', async () => {
    const token = await makeAdminSession()
    // Create a pending blocked action
    await db.blockedAction.create({
      data: {
        agentId: 'test-agent',
        action: 'pending-action-1',
        source: 'ltl',
        axiomTrail: '[]',
        readableExplanation: 'pending',
        status: 'pending',
      },
    })

    const req = makeRequest('GET', token, undefined, '/api/blocked-actions?action=pending')
    const res = await blockedGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    // C2 fix: API contract is .items (was being read as .actions by data-store)
    expect(body).toHaveProperty('items')
    expect(body.items).toBeInstanceOf(Array)
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    expect(body.items.some((b: any) => b.action === 'pending-action-1')).toBe(true)
  })

  it('GET /api/blocked-actions?action=recent returns { items: [...] } (C3: was ?action=all)', async () => {
    const token = await makeAdminSession()
    await db.blockedAction.create({
      data: {
        agentId: 'test-agent',
        action: 'recent-action-1',
        source: 'taint',
        axiomTrail: '[]',
        readableExplanation: 'recent',
        status: 'approved',
      },
    })

    // C3 fix: data-store was calling ?action=all (invalid). Now uses ?action=recent.
    const req = makeRequest('GET', token, undefined, '/api/blocked-actions?action=recent')
    const res = await blockedGet(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveProperty('items')
    expect(body.items).toBeInstanceOf(Array)
    expect(body.items.some((b: any) => b.action === 'recent-action-1')).toBe(true)
  })

  it('GET /api/blocked-actions?action=all returns 400 (invalid action)', async () => {
    const token = await makeAdminSession()
    // This documents WHY C3 was a bug: ?action=all was never a valid action.
    const req = makeRequest('GET', token, undefined, '/api/blocked-actions?action=all')
    const res = await blockedGet(req)
    expect(res.status).toBe(400)
  })
})

describe('Fase 2 — validateLTLFormula dead code removal (B2)', () => {
  it('returns correct pattern (not "unknown") for G(p -> X q)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'validate_ltl',
      formula: 'G(p -> X q)',
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.valid).toBe(true)
    // B2 fix: previously the dead-code check on LTLMonitor.detectPattern
    // would have returned 'unknown' for valid formulas.
    expect(body.pattern).toBe('G(a -> X b)')
    expect(body.pattern).not.toBe('unknown')
  })

  it('returns correct pattern for F(p)', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'validate_ltl',
      formula: 'F(success)',
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.valid).toBe(true)
    expect(body.pattern).toBe('F(p)')
  })

  it('returns invalid for malformed formula', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'validate_ltl',
      formula: 'G(',  // unbalanced paren
    }, '/api/verify')
    const res = await verifyPost(req)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.valid).toBe(false)
    expect(body.error).toBeTruthy()
  })
})

describe('Fase 2 — Admin governance API also requires admin (defense in depth)', () => {
  beforeEach(async () => {
    await cleanupFixtures()
  })
  afterEach(async () => {
    await cleanupFixtures()
  })

  it('GET /api/admin/governance returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('GET', token, undefined, '/api/admin/governance')
    const res = await adminGovGet(req)
    expect(res.status).toBe(403)
  })

  it('POST /api/admin/governance returns 403 for viewer', async () => {
    const token = await makeViewerSession()
    const req = makeRequest('POST', token, {
      action: 'add-redline',
      description: 'TEST-RL-viewer-attempt',
    }, '/api/admin/governance')
    const res = await adminGovPost(req)
    expect(res.status).toBe(403)
    // Verify no redline was created
    const rls = await db.redLine.findMany({ where: { description: 'TEST-RL-viewer-attempt' } })
    expect(rls.length).toBe(0)
  })
})
