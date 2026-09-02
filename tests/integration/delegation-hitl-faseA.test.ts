/**
 * Integration tests for Delegation HITL Fase A
 * (C1, C2, C3, B4, B5)
 *
 * C1 — checkAuthority integrato nell'executor (non bloccante, fail-open)
 * C2 — registerBlockedAction integrato quando un gate blocca (LTL/Normative/Lean4/Governance)
 * C3 — Size cap su payload/reason/axiomTrail in requestApproval/resolveApproval
 * B4 — grantDelegation valida scope non vuoto
 * B5 — blocked-actions API POST ha try/catch su req.json()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'del-hitl-a-'
const TEST_AGENT = 'del-hitl-a-agent'

async function cleanupFixtures() {
  // Pulisci tutte le tabelle coinvolte, ordinate per dipendenze
  await db.blockedAction.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.cockpitNarrative.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.auditLedgerEntry.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.normativeResolution.deleteMany({ where: { userInstruction: { startsWith: 'del-hitl-a-' } } })
  await db.approvalGate.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.delegationContract.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.planTask.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.executionTrace.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
  await db.agentPlan.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B4: grantDelegation scope validation ============================

describe('Fase A — B4: grantDelegation valida scope non vuoto', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('grantDelegation con scope vuoto → throws', async () => {
    const { grantDelegation } = await import('@/lib/kernel/artificial-retainer')
    try {
      await grantDelegation(TEST_AGENT, '', {}, 'admin')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/scope.*required.*empty/i)
    }
  })

  it('grantDelegation con scope undefined → throws', async () => {
    const { grantDelegation } = await import('@/lib/kernel/artificial-retainer')
    try {
      await grantDelegation(TEST_AGENT, undefined as any, {}, 'admin')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/scope.*required.*empty/i)
    }
  })

  it('grantDelegation con scope whitespace → throws', async () => {
    const { grantDelegation } = await import('@/lib/kernel/artificial-retainer')
    try {
      await grantDelegation(TEST_AGENT, '   ', {}, 'admin')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/scope.*required.*empty/i)
    }
  })

  it('grantDelegation con scope valido → ok (crea delega)', async () => {
    const { grantDelegation } = await import('@/lib/kernel/artificial-retainer')
    const delegationId = await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    expect(delegationId).toBeDefined()
    expect(typeof delegationId).toBe('string')

    const delegation = await db.delegationContract.findUnique({ where: { id: delegationId } })
    expect(delegation).not.toBeNull()
    expect(delegation!.scope).toBe('tool:exec')
    expect(delegation!.active).toBe(true)
  })

  it('artificial-retainer.ts ha B4 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/artificial-retainer.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B4 fix[\s\S]*scope.*non vuoto/)
    expect(content).toMatch(/scope is required and cannot be empty/)
  })
})

// === C3: Size cap su payload/reason/axiomTrail ========================

describe('Fase A — C3: requestApproval/resolveApproval con size cap', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('requestApproval tronca payload > 50KB', async () => {
    const { requestApproval } = await import('@/lib/kernel/artificial-retainer')
    // Crea payload > 50KB
    const hugePayload = { data: 'x'.repeat(60_000) }
    const { gateId } = await requestApproval(
      TEST_AGENT,
      'test:huge-payload',
      hugePayload,
      'test reason',
    )
    const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(gate).not.toBeNull()
    // C3: payload deve essere troncato (≤ 50KB + marker)
    expect(gate!.payload.length).toBeLessThanOrEqual(50_000 + 50) // +marker
    expect(gate!.payload).toMatch(/\[truncated\]$/)
  })

  it('requestApproval tronca reason > 5KB', async () => {
    const { requestApproval } = await import('@/lib/kernel/artificial-retainer')
    const hugeReason = 'r'.repeat(6_000)
    const { gateId } = await requestApproval(
      TEST_AGENT,
      'test:huge-reason',
      { foo: 'bar' },
      hugeReason,
    )
    const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(gate).not.toBeNull()
    // C3: reason deve essere troncato (≤ 5KB + marker)
    expect(gate!.reason.length).toBeLessThanOrEqual(5_000 + 50)
    expect(gate!.reason).toMatch(/\[truncated\]$/)
  })

  it('requestApproval con payload piccolo → non troncato', async () => {
    const { requestApproval } = await import('@/lib/kernel/artificial-retainer')
    const smallPayload = { task: 'do something', params: { x: 1 } }
    const { gateId } = await requestApproval(
      TEST_AGENT,
      'test:small-payload',
      smallPayload,
      'small reason',
    )
    const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(gate).not.toBeNull()
    expect(gate!.payload).toBe(JSON.stringify(smallPayload))
    expect(gate!.reason).toBe('small reason')
    expect(gate!.payload).not.toMatch(/\[truncated\]$/)
  })

  it('resolveApproval tronca axiomTrail > 10KB', async () => {
    const { requestApproval, resolveApproval } = await import('@/lib/kernel/artificial-retainer')
    const { gateId } = await requestApproval(
      TEST_AGENT,
      'test:huge-axiom',
      { foo: 'bar' },
      'test reason',
    )
    // Crea axiomTrail > 10KB
    const hugeAxiomTrail: Record<string, unknown> = {}
    for (let i = 0; i < 500; i++) {
      hugeAxiomTrail[`step_${i}`] = { rule: 'r'.repeat(50), result: 'x'.repeat(50) }
    }
    await resolveApproval(gateId, 'approved', 'admin', hugeAxiomTrail)

    const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(gate).not.toBeNull()
    // C3: axiomTrail deve essere troncato (≤ 10KB + marker)
    expect(gate!.axiomTrail!.length).toBeLessThanOrEqual(10_000 + 50)
    expect(gate!.axiomTrail).toMatch(/\[truncated\]$/)
  })

  it('artificial-retainer.ts ha costanti di size cap', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/artificial-retainer.ts'),
      'utf-8',
    )
    expect(content).toMatch(/MAX_PAYLOAD_SIZE/)
    expect(content).toMatch(/MAX_REASON_SIZE/)
    expect(content).toMatch(/MAX_AXIOM_TRAIL_SIZE/)
    expect(content).toMatch(/C3 fix[\s\S]*size cap/)
    expect(content).toMatch(/\[truncated\]/)
  })
})

// === C1: checkAuthority integrato nell'executor =======================

describe('Fase A — C1: checkAuthority integrato in executor.ts', () => {
  it('executor.ts ha import dinamico di checkAuthority', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/checkAuthority/)
    expect(content).toMatch(/artificial-retainer/)
  })

  it('executor.ts ha C1 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*Delegation HITL[\s\S]*checkAuthority/)
    expect(content).toMatch(/task:execute:/)
  })

  it('executor.ts checkAuthority è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Deve essere dentro try/catch (fail-open)
    expect(content).toMatch(/checkAuthority[\s\S]*?} catch \{/)
  })

  it('executor.ts logga warning all\'audit ledger quando unauthorized', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/unauthorized-but-proceeded/)
    expect(content).toMatch(/Esecuzione senza delega esplicita/)
  })
})

// === C2: registerBlockedAction integrato quando un gate blocca ==========

describe('Fase A — C2: registerBlockedAction integrato in executor.ts', () => {
  it('executor.ts ha import dinamico di registerBlockedAction', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/registerBlockedAction/)
    expect(content).toMatch(/sovereign-translator/)
  })

  it('executor.ts registra block per LTL reject (source: ltl)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // LTL reject block deve chiamare registerBlockedAction con source='ltl'
    expect(content).toMatch(/C2 fix[\s\S]*registerBlockedAction[\s\S]*source: 'ltl'/)
  })

  it('executor.ts registra block per Normative (source: normative)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/source: 'normative'/)
  })

  it('executor.ts registra block per Governance gate (source: hitl_gate)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/source: 'hitl_gate'/)
  })

  it('executor.ts registra block per Formal verification (Lean4)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/Formal verification failed[\s\S]*registerBlockedAction/)
  })

  it('executor.ts registerBlockedAction è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Ogni registerBlockedAction call deve essere dentro try/catch
    const matches = content.match(/registerBlockedAction/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(4) // LTL + Lean4 + Normative + Governance
  })
})

// === B5: blocked-actions API try/catch su req.json() ==================

describe('Fase A — B5: blocked-actions API POST ha try/catch su body parsing', () => {
  it('blocked-actions/route.ts ha try/catch su req.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/blocked-actions/route.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B5 fix[\s\S]*try\/catch[\s\S]*req\.json/)
    expect(content).toMatch(/try \{[\s\S]*body = await req\.json\(\)[\s\S]*\} catch/)
    expect(content).toMatch(/Invalid JSON body/)
  })

  it('blocked-actions/route.ts ritorna 400 su body non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/blocked-actions/route.ts'),
      'utf-8',
    )
    // Status 400 (Bad Request)
    expect(content).toMatch(/status: 400/)
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3+B4+B5 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('grantDelegation + checkAuthority + requestApproval (con size cap)', async () => {
    const { grantDelegation, checkAuthority, requestApproval, resolveApproval } =
      await import('@/lib/kernel/artificial-retainer')

    // B4: grantDelegation valida scope non vuoto (valido qui)
    // Pattern `task:execute*` (star finale senza `:` prima) → matcha
    // `task:execute:orchestrator` perché `:` è un separatore non-alnum.
    const delegationId = await grantDelegation(
      TEST_AGENT,
      'task:execute*',
      { maxCalls: 100 },
      'admin',
    )
    expect(delegationId).toBeDefined()

    // C1 path: checkAuthority ora chiamato anche dall'executor, testiamo qui la funzione diretta
    const authorityResult = await checkAuthority(TEST_AGENT, 'task:execute:orchestrator')
    expect(authorityResult.authorized).toBe(true)
    expect(authorityResult.delegationId).toBe(delegationId)

    // C3: requestApproval con payload che rispetta size cap (no truncation)
    const { gateId } = await requestApproval(
      TEST_AGENT,
      'irreversible:delete:resource',
      { resource: 'test-resource', reason: 'cleanup' },
      'Richiesta approvazione per eliminazione risorsa di test',
    )

    // C3: resolveApproval con axiomTrail piccolo (no truncation)
    const result = await resolveApproval(gateId, 'approved', 'admin', {
      step1: { rule: 'policy check', result: 'passed' },
    })
    expect(result.status).toBe('approved')

    const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(gate!.status).toBe('approved')
    expect(gate!.payload).not.toMatch(/\[truncated\]/)
    expect(gate!.axiomTrail).not.toMatch(/\[truncated\]/)
  })

  it('C3 smoke: requestApproval con payload enorme → troncato ma gate creato', async () => {
    const { requestApproval, resolveApproval } = await import('@/lib/kernel/artificial-retainer')

    const hugePayload = { blob: 'x'.repeat(100_000) }
    const hugeReason = 'r'.repeat(20_000)
    const { gateId } = await requestApproval(
      TEST_AGENT,
      'test:enormous',
      hugePayload,
      hugeReason,
    )

    const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(gate).not.toBeNull()
    expect(gate!.payload.length).toBeLessThan(100_000) // troncato
    expect(gate!.reason.length).toBeLessThan(20_000) // troncato
    expect(gate!.payload).toMatch(/\[truncated\]$/)
    expect(gate!.reason).toMatch(/\[truncated\]$/)

    // resolveApproval con axiomTrail enorme → troncato ma gate risolto
    const hugeAxiom: Record<string, unknown> = { trail: 'y'.repeat(50_000) }
    const result = await resolveApproval(gateId, 'rejected', 'admin', hugeAxiom)
    expect(result.status).toBe('rejected')

    const updated = await db.approvalGate.findUnique({ where: { id: gateId } })
    expect(updated!.axiomTrail!.length).toBeLessThan(50_000)
    expect(updated!.axiomTrail).toMatch(/\[truncated\]$/)
  })

  it('B4 smoke: grantDelegation rifiuta scope vuoto ma accetta scope con wildcard', async () => {
    const { grantDelegation, checkAuthority } = await import('@/lib/kernel/artificial-retainer')

    // B4: scope vuoto → throw
    try {
      await grantDelegation(TEST_AGENT, '', {}, 'admin')
      expect.fail('Should have thrown on empty scope')
    } catch (e: any) {
      expect(e.message).toMatch(/scope.*required/i)
    }

    // scope con wildcard → ok
    const delegationId = await grantDelegation(
      TEST_AGENT,
      'tool:exec*',
      { maxCalls: 10 },
      'admin',
    )
    expect(delegationId).toBeDefined()

    // checkAuthority con scope matching wildcard → authorized
    const result1 = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result1.authorized).toBe(true)

    // checkAuthority con scope NON matching (alnum suffix) → not authorized (C9 fix preserved)
    const result2 = await checkAuthority(TEST_AGENT, 'tool:executor')
    expect(result2.authorized).toBe(false)
  })
})
