/**
 * Integration tests for Lean4 LeanEvolve Fase B
 * (B1, B2, B3, B4, G4)
 *
 * B1 — Size cap su rewrittenInstruction (10KB) e failureReason (5KB)
 * B2 — leanStats tutte le 6 query in Promise.all
 * B3 — phase8.tsx try/catch su refresh()
 * B4 — verifyWorkflow batch update con Promise.all
 * G4 — leanEvolve cap cicli (MAX_EVOLVE_CYCLES = 10)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'lean-faseB-'

async function cleanupFixtures() {
  await db.leanEvolveEvent.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.verifiedWorkflow.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.formalContract.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.agentPlan.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await db.agentLog.deleteMany({ where: { agentId: 'lean' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G4: leanEvolve cap cicli ========================================

describe('Fase B — G4: leanEvolve cap cicli (MAX_EVOLVE_CYCLES = 10)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('lean4-agent.ts contiene MAX_EVOLVE_CYCLES = 10', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    expect(content).toMatch(/MAX_EVOLVE_CYCLES/)
    expect(content).toMatch(/MAX_EVOLVE_CYCLES = 10/)
  })

  it('leanEvolve dopo 10 cicli → throws', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g4-cap`

    // Crea piano
    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test cap',
        planJson: JSON.stringify({ tasks: [{ taskId: 'T1', agentId: 'test', description: 'test', dependencies: [] }] }),
        status: 'pending',
        agentCount: 1,
      },
    })

    // Crea 10 eventi evolve preesistenti (cycle 1-10)
    for (let i = 1; i <= 10; i++) {
      await db.leanEvolveEvent.create({
        data: {
          planId,
          failedTaskId: 'T1',
          failureReason: `reason ${i}`,
          leanFeedback: 'feedback',
          rewrittenInstruction: `instruction ${i}`,
          revalidated: true,
          cycle: i,
        },
      })
    }

    // 11° leanEvolve → deve throware
    try {
      await leanEvolve(planId, 'T1', '11th attempt')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Max evolve cycles.*10/i)
    }

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('leanEvolve al ciclo 10 → ok (non throwa)', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g4-ok`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test ok',
        planJson: JSON.stringify({ tasks: [{ taskId: 'T1', agentId: 'test', description: 'test', dependencies: [] }] }),
        status: 'pending',
        agentCount: 1,
      },
    })

    // Crea 9 eventi (cycle 1-9)
    for (let i = 1; i <= 9; i++) {
      await db.leanEvolveEvent.create({
        data: {
          planId,
          failedTaskId: 'T1',
          failureReason: `reason ${i}`,
          leanFeedback: 'feedback',
          rewrittenInstruction: `instruction ${i}`,
          revalidated: true,
          cycle: i,
        },
      })
    }

    // 10° leanEvolve → ok (cycle = 10, non supera il cap)
    const result = await leanEvolve(planId, 'T1', '10th attempt')
    expect(result.cycle).toBe(10)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})

// === B1: Size cap su rewrittenInstruction e failureReason ===========

describe('Fase B — B1: Size cap su rewrittenInstruction e failureReason', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('lean4-agent.ts contiene MAX_INSTRUCTION_SIZE e MAX_FAILURE_REASON_SIZE', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    expect(content).toMatch(/MAX_INSTRUCTION_SIZE/)
    expect(content).toMatch(/MAX_FAILURE_REASON_SIZE/)
  })

  it('leanEvolve tronca failureReason > 5KB', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}b1-failure`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test failure cap',
        planJson: JSON.stringify({ tasks: [{ taskId: 'T1', agentId: 'test', description: 'test', dependencies: [] }] }),
        status: 'pending',
        agentCount: 1,
      },
    })

    const bigFailure = 'x'.repeat(10_000) // 10KB > 5KB cap
    await leanEvolve(planId, 'T1', bigFailure)

    const event = await db.leanEvolveEvent.findFirst({
      where: { planId },
      orderBy: { createdAt: 'desc' },
    })
    expect(event!.failureReason.length).toBeLessThan(6_000) // ~5KB + marker
    expect(event!.failureReason).toMatch(/\[truncated\]/)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('leanEvolve tronca rewrittenInstruction > 10KB', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}b1-instruction`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test instruction cap',
        planJson: JSON.stringify({ tasks: [{ taskId: 'T1', agentId: 'test', description: 'x'.repeat(20_000), dependencies: [] }] }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await leanEvolve(planId, 'T1', 'test')

    const event = await db.leanEvolveEvent.findFirst({
      where: { planId },
      orderBy: { createdAt: 'desc' },
    })
    // rewrittenInstruction potrebbe essere > 10KB se LLM genera molto, ma il cap tronca
    // Con deterministicRewrite (LLM non disponibile in test), l'istruzione include la description originale
    // che è 20KB → viene troncata a 10KB
    expect(event!.rewrittenInstruction.length).toBeLessThanOrEqual(11_000) // ~10KB + marker

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})

// === B2: leanStats Promise.all =======================================

describe('Fase B — B2: leanStats tutte le 6 query in Promise.all', () => {
  it('lean4-agent.ts ha tutte le 6 query in un singolo Promise.all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix.*Promise\.all/)
    // Non deve più avere query sequenziali dopo il primo Promise.all
    expect(content).not.toMatch(/const verifiedContracts = await db\.formalContract\.count/)
    expect(content).not.toMatch(/const deployedWorkflows = await db\.verifiedWorkflow\.count/)
    expect(content).not.toMatch(/const successfulEvolve = await db\.leanEvolveEvent\.count/)
  })

  it('leanStats ritorna tutte le metriche', async () => {
    const { leanStats } = await import('@/lib/kernel/lean4-agent')
    const stats = await leanStats()
    expect(stats).toHaveProperty('contracts')
    expect(stats).toHaveProperty('verifiedContracts')
    expect(stats).toHaveProperty('verifiedWorkflows')
    expect(stats).toHaveProperty('deployedWorkflows')
    expect(stats).toHaveProperty('evolveEvents')
    expect(stats).toHaveProperty('successfulEvolve')
    expect(typeof stats.contracts).toBe('number')
    expect(typeof stats.verifiedContracts).toBe('number')
  })
})

// === B3: phase8.tsx try/catch su refresh() ==========================

describe('Fase B — B3: phase8.tsx try/catch su refresh()', () => {
  it('phase8.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase8.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B3 fix.*try\/catch su fetch/)
    expect(content).toMatch(/Caricamento Lean4 fallito/)
  })
})

// === B4: verifyWorkflow batch update =================================

describe('Fase B — B4: verifyWorkflow batch update con Promise.all', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('lean4-agent.ts usa contractUpdates array + Promise.all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B4 fix.*batch update/)
    expect(content).toMatch(/contractUpdates/)
    expect(content).toMatch(/Promise\.all[\s\S]*formalContract\.update/)
    // Non deve più avere await db.formalContract.update nel loop
    expect(content).not.toMatch(/await db\.formalContract\.update\(\s*where: \{ id: c\.id \}/)
  })

  it('verifyWorkflow aggiorna tutti i contratti correttamente', async () => {
    const { autoGenerateContracts, verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}b4-batch`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test batch update',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'test', description: 'step 1', dependencies: [] },
            { taskId: 'T2', agentId: 'test', description: 'step 2', dependencies: ['T1'] },
            { taskId: 'T3', agentId: 'test', description: 'step 3', dependencies: ['T1', 'T2'] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await autoGenerateContracts(planId)
    const result = await verifyWorkflow(planId)
    expect(result.results.length).toBe(3)

    // Verifica che tutti i contratti sono stati aggiornati
    const contracts = await db.formalContract.findMany({ where: { planId } })
    expect(contracts.length).toBe(3)
    for (const c of contracts) {
      expect(c.verified).toBe(true) // tutti verificati
      expect(c.verificationLog).not.toBeNull()
    }

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B4+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('autoGenerateContracts → verifyWorkflow (batch update) → leanStats (Promise.all)', async () => {
    const { autoGenerateContracts, verifyWorkflow, leanStats } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}smoke`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'smoke test',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'test', description: 'step 1', dependencies: [] },
            { taskId: 'T2', agentId: 'test', description: 'step 2', dependencies: ['T1'] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await autoGenerateContracts(planId)
    await verifyWorkflow(planId)

    const stats = await leanStats()
    expect(stats.contracts).toBeGreaterThanOrEqual(2)
    expect(stats.verifiedContracts).toBeGreaterThanOrEqual(2)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('leanEvolve con failureReason enorme → troncato + cap cicli rispettato', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}smoke-cap`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'cap test',
        planJson: JSON.stringify({ tasks: [{ taskId: 'T1', agentId: 'test', description: 'test', dependencies: [] }] }),
        status: 'pending',
        agentCount: 1,
      },
    })

    // B1: failureReason enorme → troncato
    const result = await leanEvolve(planId, 'T1', 'x'.repeat(10_000))
    expect(result.cycle).toBe(1)

    const event = await db.leanEvolveEvent.findFirst({ where: { planId } })
    expect(event!.failureReason.length).toBeLessThan(6_000)
    expect(event!.failureReason).toMatch(/\[truncated\]/)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})
