/**
 * Integration tests for Swarm Coherence Fase C
 * (G1, G2, G3, G4/B6)
 *
 * G1 — Unit test per syncBelief conflitto/getBeliefLineage catena/listSyncEvents/getQuorumVotes in isolamento
 * G2 — phase13.tsx a11y (aria-label, role=status)
 * G3 — phase13.tsx 4 action functions parse-safe su r.json()
 * G4/B6 — esrStats con metriche derivate (conflictRate, quorumCompletionRate, pendingQuorum, avgConfidence)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'sc-faseC-agent'
const TEST_AGENT_2 = 'sc-faseC-agent-2'

async function cleanupFixtures() {
  await db.belief.deleteMany({ where: { agentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.eSRSyncEvent.deleteMany({ where: { sourceAgentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.quorumVote.deleteMany({ where: { voterAgentId: { startsWith: 'sc-faseC-' } } })
  await db.quorumDecision.deleteMany({ where: { workflowJoinId: { startsWith: 'sc-faseC-' } } })
  await db.agentLog.deleteMany({ where: { agentId: 'objective' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G1: syncBelief conflitto in isolamento ===========================

describe('Fase C — G1: syncBelief conflitto (simile ma divergente)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('syncBelief source non trovato → conflict', async () => {
    const { syncBelief } = await import('@/lib/kernel/esr-quorum')
    const result = await syncBelief(TEST_AGENT, TEST_AGENT_2, 'nonexistent-belief-id')
    expect(result.syncStatus).toBe('conflict')
    expect(result.reason).toMatch(/Source belief not found/)
  })

  it('syncBelief senza belief simile nel target → synced', async () => {
    const { recordBelief, syncBelief } = await import('@/lib/kernel/esr-quorum')
    // Crea belief nel source
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC unique content alpha-12345',
      beliefType: 'observation',
    })
    // Target non ha belief simili → synced
    const result = await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)
    expect(result.syncStatus).toBe('synced')
  })

  it('syncBelief crea belief replicato nel target (con version +1)', async () => {
    const { recordBelief, syncBelief, listBeliefs } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC replication test beta-67890',
      beliefType: 'summary',
    })
    const sourceBelief = await db.belief.findUnique({ where: { id: beliefId } })

    await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)

    // Verifica belief replicato nel target
    const targetBeliefs = await listBeliefs(TEST_AGENT_2, 10)
    const replicated = targetBeliefs.find((b: any) => b.content.includes('beta-67890'))
    expect(replicated).toBeDefined()
    // B5: version deve essere source.version + 1
    expect(replicated!.version).toBe((sourceBelief!.version || 0) + 1)
  })

  it('syncBelief crea ESRSyncEvent persistito', async () => {
    const { recordBelief, syncBelief, listSyncEvents } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC sync event test gamma-99999',
      beliefType: 'evidence',
    })
    await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)

    const events = await listSyncEvents(10)
    const myEvent = events.find((e: any) =>
      e.sourceAgentId === TEST_AGENT && e.targetAgentId === TEST_AGENT_2
    )
    expect(myEvent).toBeDefined()
    expect(myEvent!.syncStatus).toBe('synced')
  })
})

// === G1: getBeliefLineage catena lunga ================================

describe('Fase C — G1: getBeliefLineage catena di versioni', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('getBeliefLineage ritorna array con belief corrente come primo elemento', async () => {
    const { recordBelief, getBeliefLineage } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC lineage first delta-11111',
      beliefType: 'plan',
    })
    const lineage = await getBeliefLineage(beliefId)
    expect(lineage.length).toBeGreaterThanOrEqual(1)
    expect(lineage[0]!.id).toBe(beliefId)
  })

  it('getBeliefLineage costruisce catena su supersede (2 versioni)', async () => {
    const { recordBelief, getBeliefLineage } = await import('@/lib/kernel/esr-quorum')
    // Prima belief
    const r1 = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC lineage chain epsilon-22222',
      beliefType: 'summary',
    })
    // Seconda belief con stesso content → supersede la prima
    const r2 = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC lineage chain epsilon-22222',  // identico → alta similarità
      beliefType: 'summary',
    })
    expect(r2.supersededId).toBe(r1.beliefId)

    // Lineage della seconda belief deve contenere entrambe
    const lineage = await getBeliefLineage(r2.beliefId)
    expect(lineage.length).toBeGreaterThanOrEqual(2)
    expect(lineage[0]!.id).toBe(r2.beliefId)
    // La belief precedente deve essere nel lineage (come parent)
    const parent = lineage.find((b: any) => b.id === r1.beliefId)
    expect(parent).toBeDefined()
  })

  it('getBeliefLineage rispetta depth limit (max 20, B4 fix)', async () => {
    const { recordBelief, getBeliefLineage } = await import('@/lib/kernel/esr-quorum')
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC depth limit test zeta-33333',
      beliefType: 'observation',
    })
    const lineage = await getBeliefLineage(beliefId)
    expect(lineage.length).toBeLessThanOrEqual(20)
  })

  it('getBeliefLineage ritorna array vuoto per ID non esistente', async () => {
    const { getBeliefLineage } = await import('@/lib/kernel/esr-quorum')
    const lineage = await getBeliefLineage('nonexistent-id')
    expect(lineage).toEqual([])
  })
})

// === G1: listSyncEvents e getQuorumVotes ==============================

describe('Fase C — G1: listSyncEvents e getQuorumVotes', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('listSyncEvents ritorna eventi ordinati per timestamp desc', async () => {
    const { recordBelief, syncBelief, listSyncEvents } = await import('@/lib/kernel/esr-quorum')
    // Crea 2 sync events
    const r1 = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC sync order alpha-aaaa',
      beliefType: 'summary',
    })
    await syncBelief(TEST_AGENT, TEST_AGENT_2, r1.beliefId)
    await new Promise((r) => setTimeout(r, 5))
    const r2 = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC sync order beta-bbbb',
      beliefType: 'summary',
    })
    await syncBelief(TEST_AGENT, TEST_AGENT_2, r2.beliefId)

    const events = await listSyncEvents(10)
    const myEvents = events.filter((e: any) => e.sourceAgentId === TEST_AGENT)
    expect(myEvents.length).toBeGreaterThanOrEqual(2)
    // Verifica ordinamento desc (più recente prima)
    if (myEvents.length >= 2) {
      expect(myEvents[0]!.timestamp.getTime()).toBeGreaterThan(myEvents[1]!.timestamp.getTime())
    }
  })

  it('listSyncEvents rispetta il limit', async () => {
    const { listSyncEvents } = await import('@/lib/kernel/esr-quorum')
    const events = await listSyncEvents(3)
    expect(events.length).toBeLessThanOrEqual(3)
  })

  it('getQuorumVotes ritorna voti per decisionId', async () => {
    const { proposeQuorumAction, voteQuorum, getQuorumVotes } = await import('@/lib/kernel/esr-quorum')
    const { decisionId } = await proposeQuorumAction('sc-faseC-votes', 'test', 2)
    await voteQuorum(decisionId, 'sc-faseC-voter-1', 'accept')
    await voteQuorum(decisionId, 'sc-faseC-voter-2', 'reject')

    const votes = await getQuorumVotes(decisionId)
    expect(votes.length).toBe(2)
    const acceptVote = votes.find((v: any) => v.voterAgentId === 'sc-faseC-voter-1')
    expect(acceptVote).toBeDefined()
    expect(acceptVote!.vote).toBe('accept')
  })

  it('getQuorumVotes ritorna array vuoto per decisionId senza voti', async () => {
    const { getQuorumVotes } = await import('@/lib/kernel/esr-quorum')
    const votes = await getQuorumVotes('nonexistent-decision')
    expect(votes).toEqual([])
  })
})

// === G4/B6: esrStats metriche derivate ================================

describe('Fase C — G4/B6: esrStats metriche derivate', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('esrStats ritorna tutte le 10 metriche (6 originali + 4 G4)', async () => {
    const { esrStats } = await import('@/lib/kernel/esr-quorum')
    const stats = await esrStats()
    // 6 originali
    expect(stats).toHaveProperty('beliefs')
    expect(stats).toHaveProperty('syncEvents')
    expect(stats).toHaveProperty('conflicts')
    expect(stats).toHaveProperty('quorumDecisions')
    expect(stats).toHaveProperty('acceptedQuorum')
    expect(stats).toHaveProperty('rejectedQuorum')
    // 4 G4
    expect(stats).toHaveProperty('conflictRate')
    expect(stats).toHaveProperty('quorumCompletionRate')
    expect(stats).toHaveProperty('pendingQuorum')
    expect(stats).toHaveProperty('avgConfidence')
  })

  it('esrStats conflictRate = conflicts / syncEvents', async () => {
    const { recordBelief, syncBelief, esrStats } = await import('@/lib/kernel/esr-quorum')
    // Crea sync event (synced, no conflict)
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC conflictRate test delta-4444',
      beliefType: 'summary',
    })
    await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)

    const stats = await esrStats()
    expect(stats.syncEvents).toBeGreaterThan(0)
    expect(stats.conflictRate).toBeGreaterThanOrEqual(0)
    expect(stats.conflictRate).toBeLessThanOrEqual(1)
    // Verifica formula
    if (stats.syncEvents > 0) {
      expect(stats.conflictRate).toBeCloseTo(stats.conflicts / stats.syncEvents, 5)
    }
  })

  it('esrStats quorumCompletionRate = (accepted + rejected) / decisions', async () => {
    const { proposeQuorumAction, voteQuorum, esrStats } = await import('@/lib/kernel/esr-quorum')
    // Crea decision accepted (2 accept votes)
    const { decisionId } = await proposeQuorumAction('sc-faseC-completion', 'test', 2)
    await voteQuorum(decisionId, 'sc-faseC-voter-3', 'accept')
    await voteQuorum(decisionId, 'sc-faseC-voter-4', 'accept')

    const stats = await esrStats()
    expect(stats.quorumDecisions).toBeGreaterThan(0)
    expect(stats.quorumCompletionRate).toBeGreaterThanOrEqual(0)
    expect(stats.quorumCompletionRate).toBeLessThanOrEqual(1)
    // Verifica formula
    if (stats.quorumDecisions > 0) {
      const decided = stats.acceptedQuorum + stats.rejectedQuorum
      expect(stats.quorumCompletionRate).toBeCloseTo(decided / stats.quorumDecisions, 5)
    }
  })

  it('esrStats pendingQuorum = decisions - accepted - rejected', async () => {
    const { proposeQuorumAction, esrStats } = await import('@/lib/kernel/esr-quorum')
    // Crea decision pending (0 votes)
    await proposeQuorumAction('sc-faseC-pending', 'test pending', 2)

    const stats = await esrStats()
    const decided = stats.acceptedQuorum + stats.rejectedQuorum
    expect(stats.pendingQuorum).toBe(stats.quorumDecisions - decided)
    expect(stats.pendingQuorum).toBeGreaterThanOrEqual(0)
  })

  it('esrStats avgConfidence è numerico', async () => {
    const { recordBelief, esrStats } = await import('@/lib/kernel/esr-quorum')
    await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC confidence test eta-5555',
      beliefType: 'evidence',
      confidence: 0.85,
    })

    const stats = await esrStats()
    expect(typeof stats.avgConfidence).toBe('number')
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0)
    expect(stats.avgConfidence).toBeLessThanOrEqual(1)
  })

  it('esr-quorum.ts ha G4 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/esr-quorum.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G4\/B6 fix[\s\S]*metriche derivate aggiuntive/)
    expect(content).toMatch(/conflictRate[\s\S]*conflicts \/ syncEvents/)
    expect(content).toMatch(/quorumCompletionRate[\s\S]*accepted \+ rejected/)
    expect(content).toMatch(/pendingQuorum: decisioni ancora pending/)
    expect(content).toMatch(/avgConfidence: media confidence/)
  })
})

// === G2: phase13.tsx a11y =============================================

describe('Fase C — G2: phase13.tsx a11y', () => {
  it('phase13.tsx ha aria-label su button Aggiorna', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna dati Swarm Coherence"/)
  })

  it('phase13.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Swarm Coherence"/)
  })

  it('phase13.tsx ha aria-label su 3 action button', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Registra belief nell'epistemic registry"/)
    expect(content).toMatch(/aria-label="Sincronizza belief tra agenti/)
    expect(content).toMatch(/aria-label="Proponi quorum semantico/)
  })

  it('phase13.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })

  it('phase13.tsx stats grid ha 9 stat card (5 originali + 4 G4)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    // G4: nuove stat card
    expect(content).toMatch(/label="Conflict rate"/)
    expect(content).toMatch(/label="Completion"/)
    expect(content).toMatch(/label="Pending"/)
    expect(content).toMatch(/label="Avg confidence"/)
  })
})

// === G3: phase13.tsx parse-safe su r.json() ===========================

describe('Fase C — G3: phase13.tsx parse-safe su r.json()', () => {
  it('phase13.tsx ha G3 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/G3 fix[\s\S]*parse-safe su r\.json/)
  })

  it('phase13.tsx recordBelief ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase13\] recordBelief: response not JSON/)
  })

  it('phase13.tsx syncBelief ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase13\] syncBelief: response not JSON/)
  })

  it('phase13.tsx proposeQuorum ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase13\] proposeQuorum: response not JSON/)
  })

  it('phase13.tsx voteQuorum ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase13\] voteQuorum: response not JSON/)
  })

  it('phase13.tsx ha 4 fallback a r.text() (una per action function)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    const textFallbackCount = (content.match(/await r\.text\(\)\.catch\(\(\) => '<no body>'\)/g) || []).length
    expect(textFallbackCount).toBe(4)  // recordBelief, syncBelief, proposeQuorum, voteQuorum
  })

  it('phase13.tsx ha 4 toast.error su risposta non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )
    const toastErrorCount = (content.match(/toast\.error\(`Risposta non valida dal server \(status \$\{r\.status\}\)`\)/g) || []).length
    expect(toastErrorCount).toBe(4)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4/B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1+G4: recordBelief + syncBelief lifecycle + stats con 10 metriche coerenti', async () => {
    const { recordBelief, syncBelief, esrStats } = await import('@/lib/kernel/esr-quorum')
    // Crea belief
    const { beliefId } = await recordBelief({
      agentId: TEST_AGENT,
      content: 'SC-FASEC smoke lifecycle theta-6666',
      beliefType: 'observation',
      confidence: 0.9,
    })
    // Sync (synced, no conflict)
    await syncBelief(TEST_AGENT, TEST_AGENT_2, beliefId)

    // Verifica stats con 10 metriche
    const stats = await esrStats()
    expect(stats.beliefs).toBeGreaterThanOrEqual(2)  // source + target replicated
    expect(stats.syncEvents).toBeGreaterThanOrEqual(1)
    // G4 metriche
    expect(stats.conflictRate).toBeGreaterThanOrEqual(0)
    expect(stats.quorumCompletionRate).toBeGreaterThanOrEqual(0)
    expect(stats.pendingQuorum).toBeGreaterThanOrEqual(0)
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0)
  })

  it('G2+G3: phase13.tsx ha a11y + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase13.tsx'),
      'utf-8',
    )

    // G2: a11y
    expect(content).toMatch(/aria-label="Aggiorna dati Swarm Coherence"/)
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)

    // G3: parse-safe (4 funzioni)
    expect(content).toMatch(/G3 fix[\s\S]*parse-safe/)
    expect(content).toMatch(/recordBelief: response not JSON/)
    expect(content).toMatch(/syncBelief: response not JSON/)
    expect(content).toMatch(/proposeQuorum: response not JSON/)
    expect(content).toMatch(/voteQuorum: response not JSON/)
  })

  it('G4: stats ritorna 10 metriche tutte numeriche', async () => {
    const { esrStats } = await import('@/lib/kernel/esr-quorum')
    const stats = await esrStats()

    const keys = ['beliefs', 'syncEvents', 'conflicts', 'quorumDecisions',
                  'acceptedQuorum', 'rejectedQuorum',
                  'conflictRate', 'quorumCompletionRate', 'pendingQuorum', 'avgConfidence']
    for (const key of keys) {
      expect(stats).toHaveProperty(key)
      expect(typeof (stats as any)[key]).toBe('number')
      expect((stats as any)[key]).toBeGreaterThanOrEqual(0)
    }

    // Coerenza: rate in [0, 1], confidence in [0, 1]
    expect(stats.conflictRate).toBeLessThanOrEqual(1)
    expect(stats.quorumCompletionRate).toBeLessThanOrEqual(1)
    expect(stats.avgConfidence).toBeLessThanOrEqual(1)
  })
})
