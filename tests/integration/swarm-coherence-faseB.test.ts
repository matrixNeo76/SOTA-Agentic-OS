/**
 * Integration tests for Swarm Coherence Fase B
 * (B1, B2, B3, B4, B5)
 *
 * B1 — voteQuorum gestisce tie (accept==reject==requiredQuorum → rejected)
 * B2 — phase13.tsx refresh() con toast.error (non solo console.error)
 * B3 — recordBelief valida beliefType enum a runtime
 * B4 — voteQuorum valida vote enum a runtime
 * B5 — syncBelief valida sourceAgentId !== targetAgentId (no self-sync)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'sc-faseB-agent'
const TEST_AGENT_2 = 'sc-faseB-agent-2'

async function cleanupFixtures() {
  await db.belief.deleteMany({ where: { agentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.eSRSyncEvent.deleteMany({ where: { sourceAgentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.quorumVote.deleteMany({ where: { voterAgentId: { startsWith: 'sc-faseB-' } } })
  await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'sc-faseB-' } } })
  await db.agentLog.deleteMany({ where: { agentId: 'objective' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B1: voteQuorum tie handling =====================================

describe('Fase B — B1: voteQuorum tie handling (tie va a safety)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('esr-quorum.ts ha B1 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/esr-quorum.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B1 FIX: tie handling[\s\S]*accept==reject==requiredQuorum[\s\S]*rejected/)
  })

  it('voteQuorum tie (accept==reject==requiredQuorum) → verdict rejected', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-tie', 'test action', 2)

    // 2 accept + 2 reject → tie (4 votes total, accept==reject==2==requiredQuorum)
    await voteQuorum(decisionId, 'sc-faseB-voter-1', 'accept')
    await voteQuorum(decisionId, 'sc-faseB-voter-2', 'reject')
    await voteQuorum(decisionId, 'sc-faseB-voter-3', 'accept')  // accept=2 → verdict accepted? No, check B1
    // B1: dopo 2 accept, verdict sarebbe 'accepted' MA poi arriva 2° reject → tie
    // Verifichiamo che con 2 accept + 2 reject, il verdict finale è 'rejected' (tie va a safety)

    // Per testare il tie, dobbiamo arrivare a 2-2 contemporaneamente.
    // L'ultimo voto che crea il tie è il 2° reject.
    const result = await voteQuorum(decisionId, 'sc-faseB-voter-4', 'reject')
    // B1: accept=2, reject=2, requiredQuorum=2 → tie → rejected
    expect(result.acceptCount).toBe(2)
    expect(result.rejectCount).toBe(2)
    expect(result.verdict).toBe('rejected')  // tie va a safety
  })

  it('voteQuorum senza tie (accept > reject) → verdict accepted', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-no-tie-accept', 'test', 2)

    await voteQuorum(decisionId, 'sc-faseB-voter-5', 'accept')
    const result = await voteQuorum(decisionId, 'sc-faseB-voter-6', 'accept')
    expect(result.verdict).toBe('accepted')  // 2 accept, 0 reject → no tie
  })

  it('voteQuorum senza tie (reject > accept) → verdict rejected', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-no-tie-reject', 'test', 2)

    await voteQuorum(decisionId, 'sc-faseB-voter-7', 'reject')
    const result = await voteQuorum(decisionId, 'sc-faseB-voter-8', 'reject')
    expect(result.verdict).toBe('rejected')  // 0 accept, 2 reject → no tie
  })
})

// === B3: recordBelief valida beliefType enum =========================

describe('Fase B — B3: recordBelief valida beliefType enum', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('esr-quorum.ts ha B3 fix (VALID_BELIEF_TYPES)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/esr-quorum.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B3: validazione runtime di beliefType enum/)
    expect(content).toMatch(/VALID_BELIEF_TYPES.*'summary'.*'evidence'.*'plan'.*'observation'/)
    expect(content).toMatch(/isValidBeliefType/)
    expect(content).toMatch(/Invalid beliefType/)
  })

  it('recordBelief con beliefType valido (summary) → ok', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEB valid summary',
      beliefType: 'summary',
    })
    expect(beliefId).toBeTruthy()
  })

  it('recordBelief con beliefType valido (evidence) → ok', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEB valid evidence',
      beliefType: 'evidence',
    })
    expect(beliefId).toBeTruthy()
  })

  it('recordBelief con beliefType non valido (unknown) → throws', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    try {
      await recordBelief({
        agentId: TEST_AGENT,
        content: 'SC-FASEB invalid',
        beliefType: 'unknown' as any,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid beliefType/)
      expect(e.message).toMatch(/summary.*evidence.*plan.*observation/)
    }
  })

  it('recordBelief con beliefType vuoto → throws', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    try {
      await recordBelief({
        agentId: TEST_AGENT,
        content: 'SC-FASEB empty',
        beliefType: '' as any,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid beliefType/)
    }
  })

  it('recordBelief con beliefType numerico → throws', async () => {
    const { recordBelief } = await import('@/lib/kernel/esr-quorum')
    try {
      await recordBelief({
        agentId: TEST_AGENT,
        content: 'SC-FASEB numeric',
        beliefType: 42 as any,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid beliefType/)
    }
  })
})

// === B4: voteQuorum valida vote enum =================================

describe('Fase B — B4: voteQuorum valida vote enum', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('esr-quorum.ts ha B4 fix (VALID_VOTES)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/esr-quorum.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B4 FIX: validazione runtime di vote enum/)
    expect(content).toMatch(/VALID_VOTES.*'accept'.*'reject'/)
    expect(content).toMatch(/isValidVote/)
    expect(content).toMatch(/Invalid vote/)
  })

  it('voteQuorum con vote valido (accept) → ok', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-accept', 'test', 2)
    const result = await voteQuorum(decisionId, 'sc-faseB-voter-accept', 'accept')
    expect(result.verdict).toBe('pending')
    expect(result.acceptCount).toBe(1)
  })

  it('voteQuorum con vote valido (reject) → ok', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-reject', 'test', 2)
    const result = await voteQuorum(decisionId, 'sc-faseB-voter-reject', 'reject')
    expect(result.verdict).toBe('pending')
    expect(result.rejectCount).toBe(1)
  })

  it('voteQuorum con vote non valido (abstain) → throws', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-abstain', 'test', 2)
    try {
      await voteQuorum(decisionId, 'sc-faseB-voter-abstain', 'abstain' as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid vote/)
      expect(e.message).toMatch(/accept.*reject/)
    }
  })

  it('voteQuorum con vote vuoto → throws', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-empty-vote', 'test', 2)
    try {
      await voteQuorum(decisionId, 'sc-faseB-voter-empty', '' as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid vote/)
    }
  })

  it('voteQuorum con vote numerico → throws', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-numeric-vote', 'test', 2)
    try {
      await voteQuorum(decisionId, 'sc-faseB-voter-numeric', 42 as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid vote/)
    }
  })
})

// === B5: syncBelief valida sourceAgentId !== targetAgentId ===========

describe('Fase B — B5: syncBelief previene self-sync', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('esr-quorum.ts ha B5 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/esr-quorum.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B5: validazione sourceAgentId !== targetAgentId/)
    expect(content).toMatch(/Self-sync not allowed/)
  })

  it('syncBelief con source === target → conflict (no replicazione)', async () => {
    const { recordBelief, syncBelief } = await import('@/lib/kernel/esr-quorum')
    // Crea belief per TEST_AGENT
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEB self-sync test',
      beliefType: 'summary',
    })

    // Self-sync: source === target === TEST_AGENT
    const result = await syncBelief(TEST_AGENT, TEST_AGENT, beliefId)
    expect(result.syncStatus).toBe('conflict')
    expect(result.reason).toMatch(/Self-sync not allowed/)
    expect(result.reason).toContain(TEST_AGENT)
  })

  it('syncBelief con source !== target → ok (no conflict su self-sync)', async () => {
    const { recordBelief, syncBelief } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEB cross-sync test',
      beliefType: 'summary',
    })

    const result = await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)
    // Non deve essere conflict per self-sync (può essere synced o conflict per altro motivo)
    // Se reason è undefined (synced senza conflitto), il test passa
    // Se reason è definito, non deve contenere "Self-sync not allowed"
    if (result.reason) {
      expect(result.reason).not.toMatch(/Self-sync not allowed/)
    }
  })

  it('syncBelief self-sync non crea belief duplicato', async () => {
    const { recordBelief, syncBelief, listBeliefs } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEB no-duplicate test',
      beliefType: 'summary',
    })

    // Conta belief prima del self-sync
    const before = await listBeliefs(TEST_AGENT, 50)
    const beforeCount = before.length

    // Self-sync (dovrebbe fallire)
    await syncBelief(TEST_AGENT, TEST_AGENT, beliefId)

    // Conta belief dopo — non deve essere aumentato (no duplicato)
    const after = await listBeliefs(TEST_AGENT, 50)
    expect(after.length).toBe(beforeCount)
  })
})

// === B2: phase13.tsx refresh() con toast.error ========================

describe('Fase B — B2: phase13.tsx refresh() con toast.error', () => {
  it('phase13.tsx ha toast.error su refresh failure', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*toast\.error user-friendly/)
    expect(content).toMatch(/toast\.error\('Caricamento Swarm Coherence fallito'\)/)
  })

  it('phase13.tsx refresh non cancella stato su errore', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    const catchIdx = content.indexOf("} catch (e: any) {")
    expect(catchIdx).toBeGreaterThan(0)
    const catchSnippet = content.slice(catchIdx, catchIdx + 400)
    expect(catchSnippet).toMatch(/toast\.error\('Caricamento Swarm Coherence fallito'\)/)
    // Il catch block NON deve azzerare lo stato (preserva dati già caricati)
    expect(catchSnippet).not.toMatch(/setBeliefs\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setStats\(null\)/)
    expect(catchSnippet).not.toMatch(/setDecisions\(\[\]\)/)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B4+B5 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('B1+B4: quorum lifecycle con tie + vote validation', async () => {
    const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseB-smoke', 'test', 2)

    // 2 accept + 2 reject → tie → rejected (B1)
    await voteQuorum(decisionId, 'sc-faseB-s-v1', 'accept')
    await voteQuorum(decisionId, 'sc-faseB-s-v2', 'reject')
    await voteQuorum(decisionId, 'sc-faseB-s-v3', 'accept')
    const result = await voteQuorum(decisionId, 'sc-faseB-s-v4', 'reject')
    expect(result.verdict).toBe('rejected')  // B1: tie va a safety
    expect(result.acceptCount).toBe(2)
    expect(result.rejectCount).toBe(2)
  })

  it('B3+B5: recordBelief + syncBelief con validation', async () => {
    const { recordBelief, syncBelief } = await import('@/lib/kernel/esr-quorum')
    // B3: beliefType valido
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEB smoke belief',
      beliefType: 'observation',
    })
    expect(beliefId).toBeTruthy()

    // B5: cross-sync (source !== target) → ok
    const result = await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)
    // Se reason è definito, non deve essere "Self-sync not allowed"
    if (result.reason) {
      expect(result.reason).not.toMatch(/Self-sync not allowed/)
    }
  })

  it('B2 smoke: phase13.tsx ha toast.error + preserva stato', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    // B2: refresh con toast.error
    expect(content).toMatch(/toast\.error\('Caricamento Swarm Coherence fallito'\)/)
    // B2: preserva stato (no setX([]))
    expect(content).not.toMatch(/setBeliefs\(\[\]\)/)
    expect(content).not.toMatch(/setDecisions\(\[\]\)/)
  })
})
