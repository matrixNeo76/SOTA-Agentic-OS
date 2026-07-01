/**
 * Integration tests for governance bug fixes (Fase 3 — C7-C10, B3-B8).
 *
 * Coverage:
 *   C7 — evaluateIntent: priorità uguale non deve più bloccare
 *   C8 — resolveNormativeConflict: tie-break solo se SAFETY
 *   C9 — checkAuthority: pattern matching robusto (no bypass tool:exec → tool:executor)
 *   C10 — auto-expire gates: lazy expire su listPendingGates + endpoint manuale
 *   B3 — addLTLRule: ruleId duplicato → LTLRuleConflictError (409)
 *   B4 — add-redline: description duplicato → 409 Conflict
 *   B5 — deleteAxiom/deleteLTLRule: 404 su id non esistente (no più silent updateMany)
 *   B6 — taint: propagateTaint persiste su DB (non più Map in-memory)
 *   B7 — taint: clearExpiredFlows marca record scaduti come EXPIRED
 *   B10 — addAxiom: priorità non valida + duplicati case-insensitive
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

// Lib functions under test
import { evaluateIntent, addAxiom, deleteAxiom, AxiomConflictError, AxiomNotFoundError, DEFAULT_AXIOMS } from '@/lib/kernel/normative'
import {
  resolveNormativeConflict, grantDelegation, checkAuthority,
  listPendingGates, expirePendingGates, requestApproval,
  __resetExpireThrottleForTests,
} from '@/lib/kernel/artificial-retainer'
import { addLTLRule, deleteLTLRule, LTLRuleConflictError, LTLRuleNotFoundError } from '@/lib/kernel/ltl-monitor'
import { taintInput, propagateTaint, checkSink, clearExpiredFlows, getTaintTTL } from '@/lib/kernel/taint'

// Mock WS publish (in test env, no WS server running)
vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === Fixtures ========================================================

const TEST_AGENT = 'gov-test-agent'
const TEST_TENANT = 'gov-test-tenant'

async function cleanupGovData() {
  __resetExpireThrottleForTests()
  await db.auditLedgerEntry.deleteMany({ where: { agentId: { in: [TEST_AGENT, 'system', 'verifier', 'reflective'] } } })
  await db.agentLog.deleteMany({ where: { agentId: { in: [TEST_AGENT, 'system', 'verifier', 'reflective'] } } })
  await db.taintRecord.deleteMany({})
  await db.delegationContract.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.approvalGate.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.normativeResolution.deleteMany({})
  await db.lTLRule.deleteMany({ where: { ruleId: { startsWith: 'LTL-TEST-' } } })
  await db.normativeRule.deleteMany({ where: { axiom: { contains: 'TEST-AXIOM-' } } })
}

// === Tests ===========================================================

describe('Fase 3 — C7: evaluateIntent priorità uguale non blocca', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('priority 3 violates priority 3 axiom → ALLOW (was BLOCK before C7)', async () => {
    // Crea un assioma di priority 3 (efficienza)
    await db.normativeRule.create({
      data: { axiom: 'TEST-AXIOM-efficiency', priority: 3, active: true },
    })

    const verdict = await evaluateIntent({
      agentId: TEST_AGENT,
      action: 'optimize token usage',
      rationale: 'speed up task',
      claimedPriority: 3,
      affectedAxioms: [{ axiom: 'TEST-AXIOM-efficiency', impact: 'violate' }],
    })

    // C7 fix: stessa priorità → ALLOW (prima era BLOCK per via di `<=`)
    expect(verdict.allowed).toBe(true)
    expect(verdict.blockingAxiom).toBeUndefined()
  })

  it('priority 3 violates priority 1 axiom → BLOCK (rule still works)', async () => {
    await db.normativeRule.create({
      data: { axiom: 'TEST-AXIOM-legal', priority: 1, active: true },
    })

    const verdict = await evaluateIntent({
      agentId: TEST_AGENT,
      action: 'bypass security for speed',
      rationale: 'speed up task',
      claimedPriority: 3,
      affectedAxioms: [{ axiom: 'TEST-AXIOM-legal', impact: 'violate' }],
    })

    expect(verdict.allowed).toBe(false)
    expect(verdict.blockingAxiom).toBe('TEST-AXIOM-legal')
    expect(verdict.blockingPriority).toBe(1)
  })

  it('priority 2 violates priority 1 axiom → BLOCK', async () => {
    await db.normativeRule.create({
      data: { axiom: 'TEST-AXIOM-legal2', priority: 1, active: true },
    })

    const verdict = await evaluateIntent({
      agentId: TEST_AGENT,
      action: 'skip audit trail',
      rationale: 'faster',
      claimedPriority: 2,
      affectedAxioms: [{ axiom: 'TEST-AXIOM-legal2', impact: 'violate' }],
    })

    expect(verdict.allowed).toBe(false)
    expect(verdict.blockingPriority).toBe(1)
  })

  it('priority 1 violates priority 1 axiom → ALLOW (same level, not strictly higher)', async () => {
    await db.normativeRule.create({
      data: { axiom: 'TEST-AXIOM-legal3', priority: 1, active: true },
    })

    const verdict = await evaluateIntent({
      agentId: TEST_AGENT,
      action: 'legal override another legal',
      rationale: 'higher legal priority',
      claimedPriority: 1,
      affectedAxioms: [{ axiom: 'TEST-AXIOM-legal3', impact: 'violate' }],
    })

    // C7: stessa priorità → ALLOW (l'intenzione è priority 1, l'assioma è priority 1)
    expect(verdict.allowed).toBe(true)
  })
})

describe('Fase 3 — C8: resolveNormativeConflict tie-break corretto', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('SAFETY vs SAFETY → BLOCK (tie-break a safety)', async () => {
    const result = await resolveNormativeConflict({
      userInstruction: 'disable firewall',
      userLevel: 'SAFETY',
      systemPolicy: 'firewall must stay on',
      systemLevel: 'SAFETY',
    })
    expect(result.verdict).toBe('block')
  })

  it('OPERATIONAL vs OPERATIONAL → MODIFY (was BLOCK before C8)', async () => {
    const result = await resolveNormativeConflict({
      userInstruction: 'use blue button',
      userLevel: 'OPERATIONAL',
      systemPolicy: 'use red button',
      systemLevel: 'OPERATIONAL',
    })
    // C8 fix: tie-break bloccante solo se SAFETY. OPERATIONAL vs OPERATIONAL → MODIFY
    expect(result.verdict).toBe('modify')
    expect(result.modifiedAction).toBeTruthy()
  })

  it('AESTHETIC vs AESTHETIC → MODIFY (was BLOCK before C8)', async () => {
    const result = await resolveNormativeConflict({
      userInstruction: 'use blue color',
      userLevel: 'AESTHETIC',
      systemPolicy: 'use red color',
      systemLevel: 'AESTHETIC',
    })
    expect(result.verdict).toBe('modify')
  })

  it('SAFETY (system) vs OPERATIONAL (user) → BLOCK (system higher)', async () => {
    const result = await resolveNormativeConflict({
      userInstruction: 'deploy without tests',
      userLevel: 'OPERATIONAL',
      systemPolicy: 'tests mandatory',
      systemLevel: 'SAFETY',
    })
    expect(result.verdict).toBe('block')
  })

  it('OPERATIONAL (system) vs AESTHETIC (user) → BLOCK (system higher)', async () => {
    const result = await resolveNormativeConflict({
      userInstruction: 'add rainbow gradient',
      userLevel: 'AESTHETIC',
      systemPolicy: 'keep design minimal',
      systemLevel: 'OPERATIONAL',
    })
    // systemLevel (OPERATIONAL=2) < userLevel (AESTHETIC=3) → system ha priorità
    // superiore (numero più basso = priorità più alta) → BLOCK
    expect(result.verdict).toBe('block')
  })
})

describe('Fase 3 — C9: checkAuthority pattern matching robusto', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('exact match: tool:exec authorizes tool:exec', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(true)
  })

  it('C9 fix: tool:exec does NOT authorize tool:executor (was authorized before)', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:executor')
    expect(result.authorized).toBe(false)
  })

  it('C9 fix: tool:exec does NOT authorize tool:exec_malicious', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:exec_malicious')
    expect(result.authorized).toBe(false)
  })

  it('C9 fix: tool:exec does NOT authorize tool:execprivileged', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:execprivileged')
    expect(result.authorized).toBe(false)
  })

  it('wildcard *: authorizes anything', async () => {
    await grantDelegation(TEST_AGENT, '*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'anything:whatever')
    expect(result.authorized).toBe(true)
  })

  it('pattern*: tool:exec* authorizes tool:exec (exact after strip)', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(true)
  })

  it('pattern*: tool:exec* does NOT authorize tool:executor (alnum after)', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:executor')
    expect(result.authorized).toBe(false)
  })

  it('pattern*: tool:exec* authorizes tool:exec:privileged (separator :)', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:exec:privileged')
    expect(result.authorized).toBe(true)
  })

  it('pattern/*: tool:exec/* authorizes tool:exec/privileged', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec/*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:exec/privileged')
    expect(result.authorized).toBe(true)
  })

  it('pattern/*: tool:exec/* does NOT authorize tool:executor', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec/*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'tool:executor')
    expect(result.authorized).toBe(false)
  })

  it('pattern: fs:read:/tmp/* authorizes fs:read:/tmp/file1', async () => {
    await grantDelegation(TEST_AGENT, 'fs:read:/tmp/*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'fs:read:/tmp/file1')
    expect(result.authorized).toBe(true)
  })

  it('pattern: fs:read:/tmp/* does NOT authorize fs:read:/var/file1', async () => {
    await grantDelegation(TEST_AGENT, 'fs:read:/tmp/*', {}, 'admin')
    const result = await checkAuthority(TEST_AGENT, 'fs:read:/var/file1')
    expect(result.authorized).toBe(false)
  })

  it('expired delegation does NOT authorize', async () => {
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin', new Date(Date.now() - 60 * 60 * 1000)) // 1h ago
    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(false)
  })
})

describe('Fase 3 — C10: auto-expire gates', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('expirePendingGates marks expired gates (expiresAt < now)', async () => {
    // Crea un gate scaduto (expiresAt 1h fa)
    await db.approvalGate.create({
      data: {
        agentId: TEST_AGENT,
        action: 'expired_action',
        payload: '{}',
        reason: 'test',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    })
    // Crea un gate non scaduto
    await db.approvalGate.create({
      data: {
        agentId: TEST_AGENT,
        action: 'active_action',
        payload: '{}',
        reason: 'test',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    const count = await expirePendingGates(true)
    expect(count).toBe(1)

    const expired = await db.approvalGate.findFirst({
      where: { agentId: TEST_AGENT, action: 'expired_action' },
    })
    expect(expired?.status).toBe('expired')
    expect(expired?.decidedBy).toBe('system-auto-expire')

    const active = await db.approvalGate.findFirst({
      where: { agentId: TEST_AGENT, action: 'active_action' },
    })
    expect(active?.status).toBe('pending')
  })

  it('expirePendingGates writes audit entry for expired gates', async () => {
    await db.approvalGate.create({
      data: {
        agentId: TEST_AGENT,
        action: 'audit_test_action',
        payload: '{}',
        reason: 'test',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    await expirePendingGates(true)

    const audit = await db.auditLedgerEntry.findFirst({
      where: { action: { contains: 'Auto-expire' } },
    })
    expect(audit).toBeTruthy()
    expect(audit?.readableNarrative).toMatch(/scaduti automaticamente/)
  })

  it('listPendingGates triggers lazy expire (no expired gates in result)', async () => {
    await db.approvalGate.create({
      data: {
        agentId: TEST_AGENT,
        action: 'lazy_expired',
        payload: '{}',
        reason: 'test',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const pending = await listPendingGates(TEST_AGENT)
    expect(pending.length).toBe(0) // expired gate non è più pending
  })

  it('expirePendingGates is throttled (force=false returns 0 on second call)', async () => {
    await db.approvalGate.create({
      data: {
        agentId: TEST_AGENT,
        action: 'throttle_test_1',
        payload: '{}',
        reason: 'test',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const count1 = await expirePendingGates(false) // prima chiamata, esegue
    expect(count1).toBe(1)

    // Crea un altro gate scaduto
    await db.approvalGate.create({
      data: {
        agentId: TEST_AGENT,
        action: 'throttle_test_2',
        payload: '{}',
        reason: 'test',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const count2 = await expirePendingGates(false) // throttled, non esegue
    expect(count2).toBe(0)

    // Force bypassa il throttle
    const count3 = await expirePendingGates(true)
    expect(count3).toBe(1)
  })
})

describe('Fase 3 — B3: addLTLRule ruleId duplicato', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('first add succeeds', async () => {
    await addLTLRule({
      ruleId: 'LTL-TEST-DUP',
      formula: 'G(p -> X q)',
      description: 'test rule',
      severity: 'warn',
    })
    const rule = await db.lTLRule.findUnique({ where: { ruleId: 'LTL-TEST-DUP' } })
    expect(rule).toBeTruthy()
  })

  it('second add with same ruleId throws LTLRuleConflictError', async () => {
    await addLTLRule({
      ruleId: 'LTL-TEST-DUP2',
      formula: 'G(p)',
      description: 'first',
      severity: 'warn',
    })

    await expect(addLTLRule({
      ruleId: 'LTL-TEST-DUP2',
      formula: 'F(q)',
      description: 'second',
      severity: 'warn',
    })).rejects.toThrow(LTLRuleConflictError)
  })

  it('LTLRuleConflictError has correct ruleId', async () => {
    await addLTLRule({
      ruleId: 'LTL-TEST-DUP3',
      formula: 'G(p)',
      description: '',
      severity: 'warn',
    })
    try {
      await addLTLRule({
        ruleId: 'LTL-TEST-DUP3',
        formula: 'F(q)',
        description: '',
        severity: 'warn',
      })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(LTLRuleConflictError)
      expect((e as LTLRuleConflictError).ruleId).toBe('LTL-TEST-DUP3')
    }
  })
})

describe('Fase 3 — B5: deleteLTLRule 404 on not found', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('deleteLTLRule throws LTLRuleNotFoundError for non-existent ruleId', async () => {
    await expect(deleteLTLRule('LTL-TEST-NONEXISTENT'))
      .rejects.toThrow(LTLRuleNotFoundError)
  })

  it('deleteLTLRule succeeds for existing rule', async () => {
    await addLTLRule({
      ruleId: 'LTL-TEST-DELETE',
      formula: 'G(p)',
      description: '',
      severity: 'warn',
    })
    await deleteLTLRule('LTL-TEST-DELETE')
    const rule = await db.lTLRule.findUnique({ where: { ruleId: 'LTL-TEST-DELETE' } })
    expect(rule?.active).toBe(false)
  })
})

describe('Fase 3 — B5: deleteAxiom 404 on not found', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('deleteAxiom throws AxiomNotFoundError for non-existent id', async () => {
    await expect(deleteAxiom('non-existent-id')).rejects.toThrow(AxiomNotFoundError)
  })

  it('deleteAxiom succeeds for existing axiom', async () => {
    await addAxiom('TEST-AXIOM-DELETE', 2)
    const axioms = await db.normativeRule.findMany({ where: { axiom: 'TEST-AXIOM-DELETE' } })
    expect(axioms.length).toBe(1)
    await deleteAxiom(axioms[0].id)
    const after = await db.normativeRule.findUnique({ where: { id: axioms[0].id } })
    expect(after?.active).toBe(false)
  })
})

describe('Fase 3 — B10: addAxiom validation', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('rejects empty axiom text', async () => {
    await expect(addAxiom('', 2)).rejects.toThrow(/Axiom text is required/)
    await expect(addAxiom('   ', 2)).rejects.toThrow(/Axiom text is required/)
  })

  it('rejects invalid priority (must be 1, 2, or 3)', async () => {
    await expect(addAxiom('TEST-AXIOM-P0', 0)).rejects.toThrow(/Invalid priority/)
    await expect(addAxiom('TEST-AXIOM-P4', 4)).rejects.toThrow(/Invalid priority/)
    await expect(addAxiom('TEST-AXIOM-P-1', -1)).rejects.toThrow(/Invalid priority/)
  })

  it('accepts valid priorities (1, 2, 3)', async () => {
    await addAxiom('TEST-AXIOM-VALID1', 1)
    await addAxiom('TEST-AXIOM-VALID2', 2)
    await addAxiom('TEST-AXIOM-VALID3', 3)
    const count = await db.normativeRule.count({ where: { axiom: { contains: 'TEST-AXIOM-VALID' } } })
    expect(count).toBe(3)
  })

  it('rejects duplicate axiom (case-insensitive)', async () => {
    await addAxiom('TEST-AXIOM-DUP', 2)
    await expect(addAxiom('TEST-AXIOM-DUP', 2)).rejects.toThrow(AxiomConflictError)
    await expect(addAxiom('test-axiom-dup', 2)).rejects.toThrow(AxiomConflictError) // case-insensitive
  })
})

describe('Fase 3 — B6: taint persiste su DB (no Map in-memory)', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('taintInput persists record to DB', async () => {
    const id = await taintInput('user_chat', 'malicious input')
    const record = await db.taintRecord.findUnique({ where: { id } })
    expect(record).toBeTruthy()
    expect(record?.source).toBe('user_chat')
    expect(record?.payload).toBe('malicious input')
    expect(record?.taintLabel).toBe('TAINTED')
    expect(record?.blocked).toBe(false)
    const flowTrace = JSON.parse(record?.flowTrace || '[]')
    expect(flowTrace).toEqual(['input:user_chat'])
  })

  it('propagateTaint updates flowTrace in DB', async () => {
    const id = await taintInput('user_chat', 'test payload')
    await propagateTaint(id, 'llm:think')
    await propagateTaint(id, 'tool:prepare')

    const record = await db.taintRecord.findUnique({ where: { id } })
    const flowTrace = JSON.parse(record?.flowTrace || '[]')
    expect(flowTrace).toEqual(['input:user_chat', 'llm:think', 'tool:prepare'])
  })

  it('propagateTaint on non-existent id is silent no-op', async () => {
    // Non deve throware, ma non deve creare nulla
    await propagateTaint('non-existent-id', 'step')
    const record = await db.taintRecord.findUnique({ where: { id: 'non-existent-id' } })
    expect(record).toBeNull()
  })

  it('checkSink reads from DB and blocks on active taint', async () => {
    const id = await taintInput('user_chat', 'malicious')
    const result = await checkSink('tool_call:exec', [id])
    expect(result.allowed).toBe(false)
    expect(result.blockedFlows.length).toBe(1)
    expect(result.blockedFlows[0].source).toBe('user_chat')

    // Verify record updated
    const record = await db.taintRecord.findUnique({ where: { id } })
    expect(record?.blocked).toBe(true)
    const flowTrace = JSON.parse(record?.flowTrace || '[]')
    expect(flowTrace).toContain('sink:tool_call:exec')
  })

  it('checkSink on non-sensitive sink → allowed', async () => {
    const id = await taintInput('user_chat', 'test')
    const result = await checkSink('log:write', [id])
    expect(result.allowed).toBe(true)
  })

  it('checkSink with non-existent taintIds → allowed with warning', async () => {
    const result = await checkSink('tool_call:exec', ['non-existent-1', 'non-existent-2'])
    expect(result.allowed).toBe(true)
    expect(result.reason).toMatch(/scaduti o non trovati/)
  })
})

describe('Fase 3 — B7: taint TTL decay', () => {
  beforeEach(async () => {
    await cleanupGovData()
  })
  afterEach(async () => {
    await cleanupGovData()
  })

  it('clearExpiredFlows marks old records as EXPIRED', async () => {
    // Crea un record vecchio (scaduto)
    const oldRecord = await db.taintRecord.create({
      data: {
        source: 'user_chat',
        payload: 'old',
        taintLabel: 'TAINTED',
        flowTrace: '[]',
        blocked: false,
        createdAt: new Date(Date.now() - getTaintTTL() - 1000), // 1s dopo TTL
      },
    })

    // Crea un record recente (non scaduto)
    const freshRecord = await db.taintRecord.create({
      data: {
        source: 'user_chat',
        payload: 'fresh',
        taintLabel: 'TAINTED',
        flowTrace: '[]',
        blocked: false,
        createdAt: new Date(), // now
      },
    })

    const count = await clearExpiredFlows()
    expect(count).toBe(1)

    const oldAfter = await db.taintRecord.findUnique({ where: { id: oldRecord.id } })
    expect(oldAfter?.taintLabel).toBe('EXPIRED')

    const freshAfter = await db.taintRecord.findUnique({ where: { id: freshRecord.id } })
    expect(freshAfter?.taintLabel).toBe('TAINTED') // non toccato
  })

  it('clearExpiredFlows does NOT touch blocked records', async () => {
    // Un record vecchio ma che ha già bloccato un sink (audit trail da preservare)
    const blockedOld = await db.taintRecord.create({
      data: {
        source: 'user_chat',
        payload: 'blocked',
        taintLabel: 'TAINTED',
        flowTrace: '[]',
        blocked: true,
        createdAt: new Date(Date.now() - getTaintTTL() - 1000),
      },
    })

    await clearExpiredFlows()

    const after = await db.taintRecord.findUnique({ where: { id: blockedOld.id } })
    expect(after?.taintLabel).toBe('TAINTED') // non expired perché blocked=true
  })

  it('clearExpiredFlows is idempotent (second call returns 0)', async () => {
    await db.taintRecord.create({
      data: {
        source: 'user_chat',
        payload: 'old',
        taintLabel: 'TAINTED',
        flowTrace: '[]',
        blocked: false,
        createdAt: new Date(Date.now() - getTaintTTL() - 1000),
      },
    })

    const count1 = await clearExpiredFlows()
    expect(count1).toBe(1)

    const count2 = await clearExpiredFlows()
    expect(count2).toBe(0) // già marcato EXPIRED
  })
})
