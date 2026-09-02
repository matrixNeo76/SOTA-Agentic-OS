/**
 * Integration tests for Lean4 LeanEvolve Fase C
 * (G1, G2, G3)
 *
 * G1 — Unit test per leanEvolve, leanStats, listVerifiedWorkflows, listEvolveEvents
 * G2 — a11y in phase8.tsx (aria-label, role=status)
 * G3 — verifyWorkflow version incrementale (assorbito in C3 Fase A)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'lean-faseC-'

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

// === G2: a11y in phase8.tsx ==========================================

describe('Fase C — G2: phase8.tsx a11y (aria-label, role=status)', () => {
  it('Aggiorna button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase8.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna contratti e statistiche Lean4"/)
  })

  it('stats grid ha role=status e aria-live', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase8.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Lean4 LeanEvolve"/)
  })

  it('Auto-genera Contratti button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase8.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Genera contratti formali automaticamente"/)
  })

  it('Verifica Workflow button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase8.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Verifica formalmente il workflow"/)
  })

  it('Esegui LeanEvolve button ha aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase8.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Evolvi l'istruzione del task fallito via LLM"/)
  })
})

// === G1: Unit test per leanEvolve, leanStats, listVerifiedWorkflows, listEvolveEvents ===

describe('Fase C — G1: Unit test lean4-agent.ts', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('leanStats ritorna tutte le metriche corrette', async () => {
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
    expect(typeof stats.verifiedWorkflows).toBe('number')
    expect(typeof stats.deployedWorkflows).toBe('number')
    expect(typeof stats.evolveEvents).toBe('number')
    expect(typeof stats.successfulEvolve).toBe('number')
  })

  it('listVerifiedWorkflows ritorna array di workflow', async () => {
    const { autoGenerateContracts, verifyWorkflow, listVerifiedWorkflows } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g1-list-wf`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test list workflows',
        planJson: JSON.stringify({
          tasks: [{ taskId: 'T1', agentId: 'test', description: 'step', dependencies: [] }],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })
    await autoGenerateContracts(planId)
    await verifyWorkflow(planId)

    const workflows = await listVerifiedWorkflows(planId)
    expect(Array.isArray(workflows)).toBe(true)
    expect(workflows.length).toBeGreaterThan(0)
    expect(workflows[0].planId).toBe(planId)
    expect(workflows[0].version).toBe(1)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('listVerifiedWorkflows senza planId ritorna tutti (max 20)', async () => {
    const { listVerifiedWorkflows } = await import('@/lib/kernel/lean4-agent')
    const workflows = await listVerifiedWorkflows()
    expect(Array.isArray(workflows)).toBe(true)
    expect(workflows.length).toBeLessThanOrEqual(20)
  })

  it('listEvolveEvents ritorna array di eventi', async () => {
    const { leanEvolve, listEvolveEvents } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g1-list-ev`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test list events',
        planJson: JSON.stringify({
          tasks: [{ taskId: 'T1', agentId: 'test', description: 'step', dependencies: [] }],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })
    await leanEvolve(planId, 'T1', 'test failure')

    const events = await listEvolveEvents(planId)
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].planId).toBe(planId)
    expect(events[0].failedTaskId).toBe('T1')
    expect(events[0].cycle).toBe(1)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('listEvolveEvents senza planId ritorna tutti (max 20)', async () => {
    const { listEvolveEvents } = await import('@/lib/kernel/lean4-agent')
    const events = await listEvolveEvents()
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeLessThanOrEqual(20)
  })

  it('leanEvolve ritorna struttura corretta', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g1-evolve-struct`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test structure',
        planJson: JSON.stringify({
          tasks: [{ taskId: 'T1', agentId: 'test', description: 'step', dependencies: [] }],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    const result = await leanEvolve(planId, 'T1', 'test')
    expect(result).toHaveProperty('cycle')
    expect(result).toHaveProperty('rewrittenInstruction')
    expect(result).toHaveProperty('revalidated')
    expect(result).toHaveProperty('revalidationLog')
    expect(typeof result.cycle).toBe('number')
    expect(typeof result.rewrittenInstruction).toBe('string')
    expect(typeof result.revalidated).toBe('boolean')
    expect(typeof result.revalidationLog).toBe('string')

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('leanEvolve persiste LeanEvolveEvent con tutti i campi', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g1-evolve-persist`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test persist',
        planJson: JSON.stringify({
          tasks: [{ taskId: 'T1', agentId: 'test', description: 'step', dependencies: [] }],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await leanEvolve(planId, 'T1', 'test failure reason')

    const event = await db.leanEvolveEvent.findFirst({ where: { planId } })
    expect(event).not.toBeNull()
    expect(event!.planId).toBe(planId)
    expect(event!.failedTaskId).toBe('T1')
    expect(event!.failureReason).toBe('test failure reason')
    expect(event!.leanFeedback).toBeDefined()
    expect(event!.rewrittenInstruction).toBeDefined()
    expect(event!.cycle).toBe(1)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('autoGenerateContracts genera preconditions e postconditions corrette', async () => {
    const { autoGenerateContracts } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g1-contracts`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test contracts',
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

    const contracts = await autoGenerateContracts(planId)
    expect(contracts.length).toBe(2)

    // T1: no dependencies → preconditions = ["task.T1.status = 'pending'"]
    const t1 = contracts.find((c) => c.taskId === 'T1')!
    expect(t1.preconditions).toContain("task.T1.status = 'pending'")
    expect(t1.postconditions).toContain("task.T1.status = 'completed'")

    // T2: depends on T1 → preconditions include "task.T1.status = 'completed'"
    const t2 = contracts.find((c) => c.taskId === 'T2')!
    expect(t2.preconditions).toContain("task.T1.status = 'completed'")
    expect(t2.preconditions).toContain("task.T2.status = 'pending'")

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('verifyWorkflow genera Lean4 source con structure e theorem', async () => {
    const { autoGenerateContracts, verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}g1-lean-source`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test lean source',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'test', description: 'step 1', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await autoGenerateContracts(planId)
    const result = await verifyWorkflow(planId)

    expect(result.leanSource).toContain('structure TaskState')
    expect(result.leanSource).toContain('structure WorkflowState')
    expect(result.leanSource).toContain('theorem task_T1_correct')
    expect(result.leanSource).toContain('sorry')

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})

// === G3: verifyWorkflow version incrementale (assorbito in C3) =====

describe('Fase C — G3: version incrementale (assorbito in C3 Fase A)', () => {
  it('G3 è già implementato in C3 (Fase A)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix.*version incrementale/)
    expect(content).toMatch(/nextVersion/)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('full pipeline: autoGenerate → verify → leanEvolve → listEvents → leanStats', async () => {
    const {
      autoGenerateContracts, verifyWorkflow, leanEvolve,
      listEvolveEvents, leanStats,
    } = await import('@/lib/kernel/lean4-agent')

    const planId = `${TEST_PREFIX}smoke-full`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'smoke full pipeline',
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

    // 1. Auto-genera contratti
    const contracts = await autoGenerateContracts(planId)
    expect(contracts.length).toBe(2)

    // 2. Verifica workflow
    const verifyResult = await verifyWorkflow(planId)
    expect(verifyResult.verified).toBe(true)
    expect(verifyResult.results.length).toBe(2)

    // 3. LeanEvolve (simula failure su T1)
    const evolveResult = await leanEvolve(planId, 'T1', 'timeout')
    expect(evolveResult.cycle).toBe(1)
    expect(evolveResult.rewrittenInstruction).toBeDefined()

    // 4. Lista eventi evolve
    const events = await listEvolveEvents(planId)
    expect(events.length).toBe(1)
    expect(events[0].failedTaskId).toBe('T1')

    // 5. leanStats
    const stats = await leanStats()
    expect(stats.contracts).toBeGreaterThanOrEqual(2)
    expect(stats.verifiedContracts).toBeGreaterThanOrEqual(2)
    expect(stats.evolveEvents).toBeGreaterThanOrEqual(1)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})
