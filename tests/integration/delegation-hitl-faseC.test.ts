/**
 * Integration tests for Delegation HITL Fase C
 * (G1, G2, G3)
 *
 * G1 — Unit test per sovereign-translator.ts
 *      (registerBlockedAction, resolveBlockedAction, generateExplanation,
 *       listPendingBlocked, listRecentBlocked, blockedStats,
 *       recordNarrative, listNarratives)
 * G2 — a11y in phase9.tsx (aria-label, role=status)
 * G3 — sovereign-view.tsx try/catch su fetch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'del-hitl-c-'
const TEST_AGENT = 'del-hitl-c-agent'

async function cleanupFixtures() {
  await db.blockedAction.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.cockpitNarrative.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.auditLedgerEntry.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.normativeResolution.deleteMany({ where: { userInstruction: { startsWith: 'del-hitl-c-' } } })
  await db.approvalGate.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.delegationContract.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.planTask.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.executionTrace.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
  await db.agentPlan.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G1: Unit test per sovereign-translator.ts ======================

describe('Fase C — G1: sovereign-translator registerBlockedAction', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('registerBlockedAction persiste BlockedAction con tutti i campi', async () => {
    const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:register',
      source: 'ltl',
      axiomTrail: [
        { step: '1', rule: 'LTL check', result: 'rejected' },
        { step: '2', rule: 'safety violation', result: 'blocked' },
      ],
      readableExplanation: 'Spiegazione test',
    })
    expect(blockedId).toBeDefined()

    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked).not.toBeNull()
    expect(blocked!.agentId).toBe(TEST_AGENT)
    expect(blocked!.action).toBe('test:register')
    expect(blocked!.source).toBe('ltl')
    expect(blocked!.status).toBe('pending')
    expect(blocked!.readableExplanation).toBe('Spiegazione test')
    expect(blocked!.axiomTrail).toContain('LTL check')
    expect(blocked!.axiomTrail).toContain('safety violation')
  })

  it('registerBlockedAction genera explanation auto se non fornita', async () => {
    const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:autogen',
      source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'rule1', result: 'r1' }],
      // readableExplanation non fornito → generateExplanation viene chiamato
    })
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.readableExplanation).not.toBe('')
    // generateExplanation per source 'ltl' contiene la frase di violazione LTL
    expect(blocked!.readableExplanation).toMatch(/LTL/i)
    expect(blocked!.readableExplanation).toContain('Axiom Trail')
  })

  it('registerBlockedAction per source taint genera explanation appropriata', async () => {
    const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:taint',
      source: 'taint',
      axiomTrail: [{ step: '1', rule: 'tainted source', result: 'blocked' }],
    })
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.readableExplanation).toMatch(/tainted/i)
  })

  it('registerBlockedAction per source normative genera explanation appropriata', async () => {
    const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:normative',
      source: 'normative',
      axiomTrail: [{ step: '1', rule: 'policy conflict', result: 'blocked' }],
    })
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.readableExplanation).toMatch(/policy|conflitto/i)
  })

  it('registerBlockedAction per source hitl_gate genera explanation appropriata', async () => {
    const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT,
      action: 'test:hitl',
      source: 'hitl_gate',
      axiomTrail: [{ step: '1', rule: 'requires approval', result: 'pending' }],
    })
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.readableExplanation).toMatch(/approvazione umana|hitl/i)
  })
})

describe('Fase C — G1: sovereign-translator resolveBlockedAction', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('resolveBlockedAction persiste resolvedBy e resolutionDetails', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'test:resolve', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    await resolveBlockedAction(blockedId, 'approved', 'admin-user', { reason: 'verified safe' })
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.status).toBe('approved')
    expect(blocked!.resolvedBy).toBe('admin-user')
    expect(blocked!.resolvedAt).not.toBeNull()
    expect(blocked!.resolution).toContain('verified safe')
  })

  it('resolveBlockedAction default resolvedBy = admin', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'test:default-admin', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    await resolveBlockedAction(blockedId, 'rejected')
    const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
    expect(blocked!.resolvedBy).toBe('admin')
  })

  it('resolveBlockedAction su blockedId non esistente → throws', async () => {
    const { resolveBlockedAction } = await import('@/lib/kernel/sovereign-translator')
    try {
      await resolveBlockedAction('non-existent-id', 'approved')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/non trovata/)
    }
  })

  it('resolveBlockedAction su blocked già risolta → throws', async () => {
    const { registerBlockedAction, resolveBlockedAction } =
      await import('@/lib/kernel/sovereign-translator')
    const { blockedId } = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'test:double-resolve', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    await resolveBlockedAction(blockedId, 'approved')
    try {
      await resolveBlockedAction(blockedId, 'rejected')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/già risolta/)
    }
  })
})

describe('Fase C — G1: sovereign-translator listPendingBlocked/listRecentBlocked/blockedStats', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('listPendingBlocked ritorna solo pending, ordinate per createdAt desc', async () => {
    const { registerBlockedAction, resolveBlockedAction, listPendingBlocked } =
      await import('@/lib/kernel/sovereign-translator')
    const r1 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'p1', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    // wait 10ms per avere timestamp diverso
    await new Promise((r) => setTimeout(r, 10))
    const r2 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'p2', source: 'taint',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    // Risolvi r1
    await resolveBlockedAction(r1.blockedId, 'approved')

    const pending = await listPendingBlocked(20)
    const myPending = pending.filter((p) => p.agentId === TEST_AGENT)
    expect(myPending.length).toBe(1)
    expect(myPending[0]!.id).toBe(r2.blockedId)
    expect(myPending[0]!.status).toBe('pending')
  })

  it('listRecentBlocked ritorna tutti (pending + resolved), max limit', async () => {
    const { registerBlockedAction, listRecentBlocked } = await import('@/lib/kernel/sovereign-translator')
    for (let i = 0; i < 5; i++) {
      await registerBlockedAction({
        agentId: TEST_AGENT, action: `r${i}`, source: 'ltl',
        axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
      })
    }
    const recent = await listRecentBlocked(3)
    expect(recent.length).toBe(3) // limit applicato
    // Ordinati per createdAt desc → i più recenti prima
    expect(recent[0]!.action).toMatch(/^r\d$/)
  })

  it('blockedStats ritorna tutte le 6 metriche', async () => {
    const { registerBlockedAction, resolveBlockedAction, blockedStats } =
      await import('@/lib/kernel/sovereign-translator')
    const r1 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 's1', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    const r2 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 's2', source: 'taint',
      axiomTrail: [{ step: '1', rule: 'r', result: 'x' }],
    })
    await resolveBlockedAction(r1.blockedId, 'approved')
    await resolveBlockedAction(r2.blockedId, 'rejected')

    const stats = await blockedStats()
    expect(stats).toHaveProperty('total')
    expect(stats).toHaveProperty('pending')
    expect(stats).toHaveProperty('approved')
    expect(stats).toHaveProperty('rejected')
    expect(stats).toHaveProperty('modified')
    expect(stats).toHaveProperty('downgraded')
    expect(stats.total).toBeGreaterThanOrEqual(2)
    expect(stats.approved).toBeGreaterThanOrEqual(1)
    expect(stats.rejected).toBeGreaterThanOrEqual(1)
  })
})

describe('Fase C — G1: sovereign-translator recordNarrative/listNarratives', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('recordNarrative persiste CockpitNarrative con tutti i campi', async () => {
    const { recordNarrative } = await import('@/lib/kernel/sovereign-translator')
    await recordNarrative(
      TEST_AGENT,
      'Test narrative event',
      'warn',
      42,
      'phase9',
    )
    const narratives = await db.cockpitNarrative.findMany({
      where: { agentId: TEST_AGENT },
    })
    expect(narratives.length).toBeGreaterThanOrEqual(1)
    const n = narratives[0]!
    expect(n.narrative).toBe('Test narrative event')
    expect(n.level).toBe('warn')
    expect(n.cycleId).toBe(42)
    expect(n.relatedPhase).toBe('phase9')
  })

  it('recordNarrative default level = info', async () => {
    const { recordNarrative } = await import('@/lib/kernel/sovereign-translator')
    await recordNarrative(TEST_AGENT, 'Default level test')
    const n = await db.cockpitNarrative.findFirst({
      where: { agentId: TEST_AGENT, narrative: 'Default level test' },
    })
    expect(n!.level).toBe('info')
  })

  it('listNarratives ritorna tutte, ordinate per timestamp desc', async () => {
    const { recordNarrative, listNarratives } = await import('@/lib/kernel/sovereign-translator')
    await recordNarrative(TEST_AGENT, 'first', 'info')
    await new Promise((r) => setTimeout(r, 10))
    await recordNarrative(TEST_AGENT, 'second', 'warn')

    const narratives = await listNarratives(50)
    const myNarratives = narratives.filter((n) => n.agentId === TEST_AGENT)
    expect(myNarratives.length).toBeGreaterThanOrEqual(2)
    // Verifica ordine desc (più recente prima)
    const firstIdx = myNarratives.findIndex((n) => n.narrative === 'first')
    const secondIdx = myNarratives.findIndex((n) => n.narrative === 'second')
    expect(secondIdx).toBeLessThan(firstIdx)
  })

  it('listNarratives filtra per level', async () => {
    const { recordNarrative, listNarratives } = await import('@/lib/kernel/sovereign-translator')
    await recordNarrative(TEST_AGENT, 'info1', 'info')
    await recordNarrative(TEST_AGENT, 'warn1', 'warn')
    await recordNarrative(TEST_AGENT, 'critical1', 'critical')

    const warnOnly = await listNarratives(50, 'warn')
    const myWarn = warnOnly.filter((n) => n.agentId === TEST_AGENT)
    expect(myWarn.length).toBeGreaterThanOrEqual(1)
    expect(myWarn.every((n) => n.level === 'warn')).toBe(true)
  })
})

// === G2: phase9.tsx a11y ============================================

describe('Fase C — G2: phase9.tsx a11y', () => {
  it('phase9.tsx ha aria-label su button Aggiorna', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna dati Artificial Retainer"/)
  })

  it('phase9.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Artificial Retainer"/)
  })

  it('phase9.tsx ha aria-label su button Concedi delega', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Concedi delega all'agente selezionato"/)
  })

  it('phase9.tsx ha aria-label su button Crea Gate', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Crea gate di approvazione HITL"/)
  })

  it('phase9.tsx ha aria-label su button Risolvi Conflitto', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Risolvi conflitto normativo"/)
  })

  it('phase9.tsx ha aria-label su button Approva/Rifiuta gate', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label=\{`Approva gate/)
    expect(content).toMatch(/aria-label=\{`Rifiuta gate/)
  })

  it('phase9.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase9.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })
})

// === G3: sovereign-view.tsx try/catch su fetch =======================

describe('Fase C — G3: sovereign-view.tsx try/catch su fetch', () => {
  it('sovereign-view.tsx ha try/catch su r.json() in resolve', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workbench/sovereign-view.tsx'),
      'utf-8',
    )
    // G3 fix: parse-safe di r.json() dentro resolve()
    expect(content).toMatch(/G3 fix[\s\S]*try\/catch su r\.json/)
    expect(content).toMatch(/try \{[\s\S]*d = await r\.json\(\)[\s\S]*\} catch \{/)
    expect(content).toMatch(/response not JSON/)
  })

  it('sovereign-view.tsx ha try/catch su r.json() in batchApproveAll', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workbench/sovereign-view.tsx'),
      'utf-8',
    )
    // G3 fix: parse-safe di r.json() dentro batchApproveAll
    expect(content).toMatch(/batchApproveAll[\s\S]*try \{[\s\S]*d = await r\.json\(\)[\s\S]*\} catch \{/)
  })

  it('sovereign-view.tsx ha try/catch su fetchBlocked in useEffect', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workbench/sovereign-view.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/fetchBlocked\(\)\.catch\(\(\) => \{\}\)/)
  })

  it('sovereign-view.tsx ha toast.error su risposta non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workbench/sovereign-view.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/toast\.error\(`Risposta non valida dal server/)
  })

  it('sovereign-view.tsx ha console.error per debug su parse fail', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/workbench/sovereign-view.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/console\.error\('\[sovereign-view\] resolve: response not JSON'/)
    expect(content).toMatch(/console\.error\('\[sovereign-view\] batchApproveAll: response not JSON/)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1 smoke: register → list → resolve → stats lifecycle', async () => {
    const {
      registerBlockedAction, resolveBlockedAction,
      listPendingBlocked, listRecentBlocked, blockedStats,
    } = await import('@/lib/kernel/sovereign-translator')

    // Registra 3 blocked actions con source diversi (G1: generateExplanation path)
    const r1 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'ltl-action', source: 'ltl',
      axiomTrail: [{ step: '1', rule: 'LTL rule', result: 'rejected' }],
    })
    const r2 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'taint-action', source: 'taint',
      axiomTrail: [{ step: '1', rule: 'tainted source', result: 'blocked' }],
    })
    const r3 = await registerBlockedAction({
      agentId: TEST_AGENT, action: 'normative-action', source: 'normative',
      axiomTrail: [{ step: '1', rule: 'policy conflict', result: 'blocked' }],
    })

    // listPendingBlocked ritorna tutti e 3
    const pending1 = await listPendingBlocked(20)
    const myPending1 = pending1.filter((p) => p.agentId === TEST_AGENT)
    expect(myPending1.length).toBe(3)

    // Risolvi 2 con choice validi diversi (B3 fix preserved)
    await resolveBlockedAction(r1.blockedId, 'approved', 'admin')
    await resolveBlockedAction(r2.blockedId, 'rejected', 'admin')

    // listPendingBlocked ora ritorna solo 1
    const pending2 = await listPendingBlocked(20)
    const myPending2 = pending2.filter((p) => p.agentId === TEST_AGENT)
    expect(myPending2.length).toBe(1)
    expect(myPending2[0]!.id).toBe(r3.blockedId)

    // listRecentBlocked ritorna tutti e 3
    const recent = await listRecentBlocked(50)
    const myRecent = recent.filter((r) => r.agentId === TEST_AGENT)
    expect(myRecent.length).toBe(3)

    // blockedStats: total=3, pending=1, approved=1, rejected=1
    const stats = await blockedStats()
    expect(stats.total).toBeGreaterThanOrEqual(3)
    expect(stats.approved).toBeGreaterThanOrEqual(1)
    expect(stats.rejected).toBeGreaterThanOrEqual(1)
  })

  it('G1 smoke: narrative lifecycle con levels diversi', async () => {
    const { recordNarrative, listNarratives } = await import('@/lib/kernel/sovereign-translator')

    // Registra 3 narrative con levels diversi
    await recordNarrative(TEST_AGENT, 'info event', 'info', 1, 'phase9')
    await new Promise((r) => setTimeout(r, 10))
    await recordNarrative(TEST_AGENT, 'warn event', 'warn', 2, 'phase9')
    await new Promise((r) => setTimeout(r, 10))
    await recordNarrative(TEST_AGENT, 'critical event', 'critical', 3, 'phase9')

    // listNarratives ritorna tutti e 3
    const all = await listNarratives(50)
    const myAll = all.filter((n) => n.agentId === TEST_AGENT)
    expect(myAll.length).toBeGreaterThanOrEqual(3)

    // Filtro per level
    const warnOnly = await listNarratives(50, 'warn')
    const myWarn = warnOnly.filter((n) => n.agentId === TEST_AGENT)
    expect(myWarn.length).toBeGreaterThanOrEqual(1)
    expect(myWarn.every((n) => n.level === 'warn')).toBe(true)

    const criticalOnly = await listNarratives(50, 'critical')
    const myCritical = criticalOnly.filter((n) => n.agentId === TEST_AGENT)
    expect(myCritical.length).toBeGreaterThanOrEqual(1)
    expect(myCritical.every((n) => n.level === 'critical')).toBe(true)
  })

  it('G1 smoke: generateExplanation per tutti i 4 source', async () => {
    // Test indiretto: registerBlockedAction senza readableExplanation
    // per ognuno dei 4 source, verificando che generateExplanation produca
    // testo non vuoto con keyword attesa.
    const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')

    const sources = [
      { source: 'ltl' as const, action: 'a-ltl', keyword: /LTL/i },
      { source: 'taint' as const, action: 'a-taint', keyword: /tainted/i },
      { source: 'normative' as const, action: 'a-norm', keyword: /policy|conflitto/i },
      { source: 'hitl_gate' as const, action: 'a-hitl', keyword: /approvazione|hitl/i },
    ]

    for (const { source, action, keyword } of sources) {
      const { blockedId } = await registerBlockedAction({
        agentId: TEST_AGENT,
        action,
        source,
        axiomTrail: [{ step: '1', rule: 'test rule', result: 'test result' }],
      })
      const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
      expect(blocked!.readableExplanation).not.toBe('')
      expect(blocked!.readableExplanation).toMatch(keyword)
      expect(blocked!.readableExplanation).toContain('Axiom Trail')
      expect(blocked!.readableExplanation).toContain('test rule')
    }
  })
})
