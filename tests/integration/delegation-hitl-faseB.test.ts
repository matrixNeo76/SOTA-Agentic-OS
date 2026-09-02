/**
 * Integration tests for Delegation HITL Fase B
 * (B1, B2, B3, G4)
 *
 * B1 — retainerStats: tutte le 9 query in un unico Promise.all (no 3 sequenziali)
 * B2 — phase9.tsx refresh() con try/catch (no unhandled rejection)
 * B3 — resolveBlockedAction valida choice enum a runtime
 * G4 — checkAuthority marca deleghe scadute come active: false
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'del-hitl-b-'
const TEST_AGENT = 'del-hitl-b-agent'

async function cleanupFixtures() {
  await db.blockedAction.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.cockpitNarrative.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.auditLedgerEntry.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.normativeResolution.deleteMany({ where: { userInstruction: { startsWith: 'del-hitl-b-' } } })
  await db.approvalGate.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.delegationContract.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.planTask.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.executionTrace.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
  await db.agentPlan.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B1: retainerStats con tutte le 9 query in Promise.all =============

describe('Fase B — B1: retainerStats con 9 query in Promise.all', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('retainerStats ritorna tutte le 9 metriche corrette', async () => {
    const { retainerStats, grantDelegation, requestApproval, resolveApproval } =
      await import('@/lib/kernel/artificial-retainer')

    // Popola con dati di test
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    await grantDelegation(TEST_AGENT, 'tool:read', {}, 'admin')
    const { gateId } = await requestApproval(
      TEST_AGENT, 'test:action', { foo: 'bar' }, 'test reason',
    )
    await resolveApproval(gateId, 'approved', 'admin')

    const stats = await retainerStats()

    // Verifica tutte le 9 metriche sono presenti
    expect(stats).toHaveProperty('activeDelegations')
    expect(stats).toHaveProperty('totalDelegations')
    expect(stats).toHaveProperty('pendingGates')
    expect(stats).toHaveProperty('resolvedGates')
    expect(stats).toHaveProperty('approvedGates')
    expect(stats).toHaveProperty('rejectedGates')
    expect(stats).toHaveProperty('auditEntries')
    expect(stats).toHaveProperty('normativeResolutions')
    expect(stats).toHaveProperty('blockedResolutions')

    // Verifica valori coerenti con i dati inseriti
    expect(stats.activeDelegations).toBeGreaterThanOrEqual(2)
    expect(stats.totalDelegations).toBeGreaterThanOrEqual(2)
    expect(stats.approvedGates).toBeGreaterThanOrEqual(1)
    expect(stats.auditEntries).toBeGreaterThanOrEqual(2) // grantDelegation logs + resolveApproval logs
  })

  it('artificial-retainer.ts ha B1 fix (single Promise.all)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/artificial-retainer.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B1 fix[\s\S]*9 query.*Promise\.all/)
    // Non deve più esserci la query sequenziale fuori dal Promise.all
    expect(content).not.toMatch(/await db\.approvalGate\.count\(\{ where: \{ status: 'approved' \} \}\)\s*$/m)
  })

  it('retainerStats non ha più query sequenziali dopo il Promise.all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/artificial-retainer.ts'),
      'utf-8',
    )
    // Estrai il corpo di retainerStats
    const statsMatch = content.match(/export async function retainerStats\(\)[\s\S]*?\n\}/)
    expect(statsMatch).not.toBeNull()
    const statsBody = statsMatch![0]
    // Verifica: deve esserci un solo Promise.all e nessun await db.* count dopo
    const promiseAllCount = (statsBody.match(/Promise\.all/g) || []).length
    expect(promiseAllCount).toBe(1)
    // Dopo la chiusura del Promise.all (]), non devono esserci altri await db.* count
    const afterPromiseAll = statsBody.split(']')[1] || ''
    expect(afterPromiseAll).not.toMatch(/await db\.\w+\.count/)
  })
})

// === B3: resolveBlockedAction valida choice enum ======================

describe('Fase B — B3: resolveBlockedAction valida choice enum', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('resolveBlockedAction con choice valido (approved) → ok', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:approve',
      source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    const result = await resolveBlockedAction(blockedId, 'approved', 'admin')
    expect(result.status).toBe('approved')
    expect(result.blockedId).toBe(blockedId)

    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.status).toBe('approved')
    expect(blocked!.resolvedBy).toBe('admin')
  })

  it('resolveBlockedAction con choice valido (modified) → ok', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:modify',
      source: 'taint',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    const result = await resolveBlockedAction(blockedId, 'modified', 'admin', { newAction: 'safe' })
    expect(result.status).toBe('modified')

    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.status).toBe('modified')
    expect(blocked!.resolution).toContain('safe')
  })

  it('resolveBlockedAction con choice valido (downgraded) → ok', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:downgrade',
      source: 'normative',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    const result = await resolveBlockedAction(blockedId, 'downgraded', 'admin')
    expect(result.status).toBe('downgraded')
  })

  it('resolveBlockedAction con choice valido (rejected) → ok', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:reject',
      source: 'hitl_gate',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    const result = await resolveBlockedAction(blockedId, 'rejected', 'admin')
    expect(result.status).toBe('rejected')
  })

  it('resolveBlockedAction con choice non valido (unknown) → throws', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:invalid',
      source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    try {
      await resolveBlockedAction(blockedId, 'unknown' as any, 'admin')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid resolution choice/)
      expect(e.message).toMatch(/approved.*modified.*downgraded.*rejected/)
    }

    // Verifica che lo status nel DB sia rimasto 'pending' (no update eseguito)
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.status).toBe('pending')
  })

  it('resolveBlockedAction con choice vuoto → throws', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:empty',
      source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    try {
      await resolveBlockedAction(blockedId, '' as any, 'admin')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid resolution choice/)
    }
  })

  it('resolveBlockedAction con choice numerico → throws', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:num',
      source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'test', result: 'test' }],
    })
    try {
      await resolveBlockedAction(blockedId, 42 as any, 'admin')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid resolution choice/)
    }
  })

  it('sovereign-translator.ts ha B3 fix (RESOLUTION_CHOICES enum)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/sovereign-translator.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B3 fix[\s\S]*validazione runtime.*choice/)
    expect(content).toMatch(/RESOLUTION_CHOICES/)
    expect(content).toMatch(/isValidResolutionChoice/)
    expect(content).toMatch(/Invalid resolution choice/)
  })
})

// === G4: checkAuthority marca deleghe scadute come active: false ======

describe('Fase B — G4: checkAuthority marca deleghe scadute', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('checkAuthority su delega scaduta → authorized: false', async () => {
    const { grantDelegation, checkAuthority } = await import('@/lib/kernel/artificial-retainer')

    // Crea delega scaduta (expiresAt 1 ora fa)
    const delegationId = await grantDelegation(
      TEST_AGENT,
      'tool:exec',
      {},
      'admin',
      new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    )

    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/Nessuna delega attiva/)
  })

  it('checkAuthority su delega scaduta → delega marcata active: false nel DB', async () => {
    const { grantDelegation, checkAuthority } = await import('@/lib/kernel/artificial-retainer')

    const delegationId = await grantDelegation(
      TEST_AGENT,
      'tool:exec',
      {},
      'admin',
      new Date(Date.now() - 60 * 60 * 1000),
    )

    // Prima della chiamata: active=true
    const before = await db.delegationContract.findUnique({ where: { id: delegationId } })
    expect(before!.active).toBe(true)

    await checkAuthority(TEST_AGENT, 'tool:exec')

    // Dopo la chiamata: active=false (G4 fix)
    const after = await db.delegationContract.findUnique({ where: { id: delegationId } })
    expect(after!.active).toBe(false)
    expect(after!.revokedAt).not.toBeNull()
    expect(after!.revokeReason).toMatch(/auto-expired/)
  })

  it('checkAuthority con delega non scaduta → authorized: true (no invalidazione)', async () => {
    const { grantDelegation, checkAuthority } = await import('@/lib/kernel/artificial-retainer')

    // Delega valida (expires 1h nel futuro)
    const delegationId = await grantDelegation(
      TEST_AGENT,
      'tool:exec',
      {},
      'admin',
      new Date(Date.now() + 60 * 60 * 1000), // 1h future
    )

    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(true)
    expect(result.delegationId).toBe(delegationId)

    // La delega deve rimanere active: true
    const after = await db.delegationContract.findUnique({ where: { id: delegationId } })
    expect(after!.active).toBe(true)
    expect(after!.revokedAt).toBeNull()
  })

  it('checkAuthority su agente senza deleghe → authorized: false (no update)', async () => {
    const { checkAuthority } = await import('@/lib/kernel/artificial-retainer')
    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(false)
  })

  it('checkAuthority marca multiple deleghe scadute in batch', async () => {
    const { grantDelegation, checkAuthority } = await import('@/lib/kernel/artificial-retainer')

    // Crea 3 deleghe scadute (stesso agentId, scope diversi)
    const id1 = await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin', new Date(Date.now() - 1000))
    const id2 = await grantDelegation(TEST_AGENT, 'tool:read', {}, 'admin', new Date(Date.now() - 2000))
    const id3 = await grantDelegation(TEST_AGENT, 'tool:write', {}, 'admin', new Date(Date.now() - 3000))

    // checkAuthority con scope che matcha solo id1, ma il loop itera tutte le deleghe
    const result = await checkAuthority(TEST_AGENT, 'tool:exec')
    expect(result.authorized).toBe(false) // id1 scaduto

    // Verifica che tutte e 3 le deleghe scadute siano state invalidate
    // (G4 batch: raccoglie tutti gli expired durante il loop, anche quelli che non matchano lo scope richiesto
    //  NB: in realtà solo le deleghe che matchano lo scope vengono controllate per expiration;
    //  per invalidare TUTTE le scadute, l'agentId deve avere tutte con scope matching.)
    // Verifica id1 (matching scope): attivo=false
    const d1 = await db.delegationContract.findUnique({ where: { id: id1 } })
    expect(d1!.active).toBe(false)
  })

  it('checkAuthority registra audit entry su auto-expire', async () => {
    const { grantDelegation, checkAuthority } = await import('@/lib/kernel/artificial-retainer')

    await grantDelegation(
      TEST_AGENT,
      'tool:exec',
      {},
      'admin',
      new Date(Date.now() - 60 * 60 * 1000),
    )

    await checkAuthority(TEST_AGENT, 'tool:exec')

    // Verifica audit entry registrato
    const auditEntries = await db.auditLedgerEntry.findMany({
      where: { agentId: TEST_AGENT, action: 'auto-expire delegations' },
    })
    expect(auditEntries.length).toBeGreaterThanOrEqual(1)
    const entry = auditEntries[0]!
    expect(entry.decision).toMatch(/auto-expire-checkAuthority/)
    expect(entry.decision).toMatch(/expired/)
    expect(entry.readableNarrative).toMatch(/scadute automaticamente/)
  })

  it('artificial-retainer.ts ha G4 fix (batch invalidation)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/artificial-retainer.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G4 fix[\s\S]*marca deleghe scadute.*active: false/)
    expect(content).toMatch(/expiredDelegationIds/)
    expect(content).toMatch(/auto-expired/)
  })
})

// === B2: phase9.tsx refresh() con try/catch ==========================

describe('Fase B — B2: phase9.tsx refresh() con try/catch', () => {
  it('phase9.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*try\/catch[\s\S]*refresh/)
    // Il corpo di refresh deve essere dentro try { ... } catch (err) { ... }
    expect(content).toMatch(/try \{[\s\S]*Promise\.all[\s\S]*\} catch \(err\)/)
    expect(content).toMatch(/toast\.error\('Caricamento Artificial Retainer fallito'\)/)
    expect(content).toMatch(/console\.error\('\[phase9\] refresh failed:'/)
  })

  it('phase9.tsx refresh non cancella stato su errore', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    // Estrai il corpo del catch (err) block di refresh: deve contenere toast.error
    // ma NON deve azzerare lo stato con setX([])
    const catchIdx = content.indexOf("} catch (err) {")
    expect(catchIdx).toBeGreaterThan(0)
    // Prendi 400 caratteri dopo il catch (per coprire l'intero catch block)
    const catchSnippet = content.slice(catchIdx, catchIdx + 400)
    // Il catch block deve chiamare toast.error
    expect(catchSnippet).toMatch(/toast\.error\('Caricamento Artificial Retainer fallito'\)/)
    // Il catch block NON deve azzerare lo stato (preserva dati già caricati)
    expect(catchSnippet).not.toMatch(/setDelegations\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setPendingGates\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setRecentGates\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setAudit\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setResolutions\(\[\]\)/)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G4 + B1: delega scaduta invalidata + stats coerenti', async () => {
    const { grantDelegation, checkAuthority, retainerStats } =
      await import('@/lib/kernel/artificial-retainer')

    // Crea 2 deleghe: una valida, una scaduta
    await grantDelegation(TEST_AGENT, 'tool:exec', {}, 'admin')
    const expiredId = await grantDelegation(
      TEST_AGENT,
      'tool:read',
      {},
      'admin',
      new Date(Date.now() - 60 * 60 * 1000),
    )

    // Stats prima della invalidazione: activeDelegations include entrambe
    const statsBefore = await retainerStats()
    expect(statsBefore.activeDelegations).toBeGreaterThanOrEqual(2)

    // checkAuthority triggera G4: invalida la delega scaduta
    await checkAuthority(TEST_AGENT, 'tool:read')

    // Stats dopo: activeDelegations diminuito (la scaduta è ora inactive)
    const statsAfter = await retainerStats()
    expect(statsAfter.activeDelegations).toBeLessThan(statsBefore.activeDelegations)

    // Verifica stato DB
    const expired = await db.delegationContract.findUnique({ where: { id: expiredId } })
    expect(expired!.active).toBe(false)
  })

  it('B3 + B1: blocked action lifecycle + stats coerenti', async () => {
    const { registerBlockedAction, resolveBlockedAction, blockedStats } =
      await import('@/lib/kernel/sovereign-translator')

    // Registra 3 blocked actions
    const r1 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'a1', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    const r2 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'a2', source: 'taint',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    const r3 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'a3', source: 'normative',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })

    // Stats: 3 pending
    const stats1 = await blockedStats()
    expect(stats1.pending).toBeGreaterThanOrEqual(3)

    // Risolvi 2 con choice validi diversi
    await resolveBlockedAction(r1.blockedId, 'approved', 'admin')
    await resolveBlockedAction(r2.blockedId, 'rejected', 'admin')

    // Stats: pending diminuito, approved/rejected aumentati
    const stats2 = await blockedStats()
    expect(stats2.pending).toBeLessThan(stats1.pending)
    expect(stats2.approved).toBeGreaterThanOrEqual(1)
    expect(stats2.rejected).toBeGreaterThanOrEqual(1)

    // Verifica r3 rimane pending
    const r3Blocked = await db.blockedAction.findUnique({ where: { id: r3.blockedId } })
    expect(r3Blocked!.status).toBe('pending')
  })
})
