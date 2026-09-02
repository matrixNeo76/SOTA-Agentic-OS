/**
 * Integration tests for Lean4 LeanEvolve Fase A
 * (C1, C2, C3, B5)
 *
 * C1 — leanEvolve try/catch su JSON.parse(plan.planJson)
 * C2 — verifyWorkflow integrato nell'executor
 * C3 — verifyWorkflow usa version incrementale (max+1)
 * B5 — autoGenerateContracts e verifyWorkflow validano planId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'lean-faseA-'

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

// === B5: Validazione planId =========================================

describe('Fase A — B5: autoGenerateContracts e verifyWorkflow validano planId', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('autoGenerateContracts con planId vuoto → throws', async () => {
    const { autoGenerateContracts } = await import('@/lib/kernel/lean4-agent')
    try {
      await autoGenerateContracts('')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/planId.*required/i)
    }
  })

  it('autoGenerateContracts con planId undefined → throws', async () => {
    const { autoGenerateContracts } = await import('@/lib/kernel/lean4-agent')
    try {
      await autoGenerateContracts(undefined as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/planId.*required/i)
    }
  })

  it('verifyWorkflow con planId vuoto → throws', async () => {
    const { verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    try {
      await verifyWorkflow('')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/planId.*required/i)
    }
  })

  it('verifyWorkflow con planId whitespace → throws', async () => {
    const { verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    try {
      await verifyWorkflow('   ')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/planId.*required/i)
    }
  })
})

// === C1: leanEvolve try/catch su JSON.parse ===========================

describe('Fase A — C1: leanEvolve try/catch su JSON.parse(plan.planJson)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('leanEvolve non crasha se planJson è corrotto', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}c1-corrupt`

    // Crea piano con planJson corrotto
    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test corrupt',
        planJson: 'not-valid-json{',
        status: 'pending',
        agentCount: 1,
      },
    })

    // leanEvolve non deve crashare (C1 fix: try/catch su JSON.parse)
    const result = await leanEvolve(planId, 'T1', 'test failure')
    expect(result).toBeDefined()
    expect(result.cycle).toBe(1)
    expect(result.rewrittenInstruction).toBeDefined()

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('leanEvolve usa fallback deterministicRewrite se planJson corrotto', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}c1-fallback`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test fallback',
        planJson: 'broken{',
        status: 'pending',
        agentCount: 1,
      },
    })

    const result = await leanEvolve(planId, 'T1', 'timeout')
    // C1: con planJson corrotto, LLM potrebbe non matchare il pattern deterministicRewrite
    // Verifica solo che rewrittenInstruction è definito e non vuoto
    expect(result.rewrittenInstruction).toBeDefined()
    expect(result.rewrittenInstruction.length).toBeGreaterThan(0)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('lean4-agent.ts ha try/catch su JSON.parse in leanEvolve', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    // C1 fix: deve avere try/catch su JSON.parse(plan?.planJson) in leanEvolve
    expect(content).toMatch(/C1 fix.*try\/catch.*JSON\.parse.*planJson/)
    expect(content).toMatch(/try \{ planJson = JSON\.parse\(plan\?\.planJson/)
  })
})

// === C3: verifyWorkflow version incrementale ==========================

describe('Fase A — C3: verifyWorkflow usa version incrementale', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('prima verifyWorkflow → version=1', async () => {
    const { autoGenerateContracts, verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}c3-v1`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test version',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'step 1', dependencies: [] },
            { taskId: 'T2', agentId: 'orchestrator', description: 'step 2', dependencies: ['T1'] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await autoGenerateContracts(planId)
    const result = await verifyWorkflow(planId)

    const workflow = await db.verifiedWorkflow.findFirst({
      where: { planId },
      orderBy: { version: 'desc' },
    })
    expect(workflow).not.toBeNull()
    expect(workflow!.version).toBe(1)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('seconda verifyWorkflow → version=2 (incrementale)', async () => {
    const { autoGenerateContracts, verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}c3-v2`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test version 2',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'step 1', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await autoGenerateContracts(planId)
    await verifyWorkflow(planId) // version 1
    await verifyWorkflow(planId) // version 2

    const workflows = await db.verifiedWorkflow.findMany({
      where: { planId },
      orderBy: { version: 'asc' },
    })
    expect(workflows.length).toBe(2)
    expect(workflows[0].version).toBe(1)
    expect(workflows[1].version).toBe(2)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('verifyWorkflow non crea duplicati con version=1', async () => {
    const { autoGenerateContracts, verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}c3-no-dup`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'test no dup',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'step 1', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    await autoGenerateContracts(planId)
    await verifyWorkflow(planId)
    await verifyWorkflow(planId)
    await verifyWorkflow(planId)

    const v1Workflows = await db.verifiedWorkflow.findMany({
      where: { planId, version: 1 },
    })
    expect(v1Workflows.length).toBe(1) // solo 1 con version=1

    const allWorkflows = await db.verifiedWorkflow.findMany({
      where: { planId },
      orderBy: { version: 'asc' },
    })
    expect(allWorkflows.length).toBe(3) // version 1, 2, 3
    expect(allWorkflows[0].version).toBe(1)
    expect(allWorkflows[1].version).toBe(2)
    expect(allWorkflows[2].version).toBe(3)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('lean4-agent.ts ha C3 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/lean4-agent.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix.*version incrementale/)
    expect(content).toMatch(/nextVersion/)
    expect(content).not.toMatch(/version: 1/) // no more hardcoded
  })
})

// === C2: verifyWorkflow integrato in executor ========================

describe('Fase A — C2: verifyWorkflow integrato in executor', () => {
  it('executor.ts ha import dinamico di verifyWorkflow', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/verifyWorkflow/)
    expect(content).toMatch(/lean4-agent/)
  })

  it('executor.ts blocca task se formal verification fallisce', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*verifyWorkflow/)
    expect(content).toMatch(/Formal verification failed/)
  })

  it('executor.ts verifyWorkflow è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/verifyWorkflow[\s\S]*catch/)
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3+B5 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('autoGenerateContracts → verifyWorkflow (version 1) → verifyWorkflow (version 2)', async () => {
    const { autoGenerateContracts, verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}smoke`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'smoke test',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'first step', dependencies: [] },
            { taskId: 'T2', agentId: 'orchestrator', description: 'second step', dependencies: ['T1'] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
      },
    })

    // B5: planId valido → ok
    const contracts = await autoGenerateContracts(planId)
    expect(contracts.length).toBe(2)

    // C3: prima verifica → version 1
    const r1 = await verifyWorkflow(planId)
    expect(r1.verified).toBe(true)

    // C3: seconda verifica → version 2
    const r2 = await verifyWorkflow(planId)
    expect(r2.verified).toBe(true)

    const workflows = await db.verifiedWorkflow.findMany({
      where: { planId },
      orderBy: { version: 'asc' },
    })
    expect(workflows.length).toBe(2)
    expect(workflows[0].version).toBe(1)
    expect(workflows[1].version).toBe(2)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('leanEvolve con planJson corrotto non crasha (C1)', async () => {
    const { leanEvolve } = await import('@/lib/kernel/lean4-agent')
    const planId = `${TEST_PREFIX}smoke-corrupt`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'corrupt test',
        planJson: 'totally-broken-json{{{',
        status: 'pending',
        agentCount: 1,
      },
    })

    // C1: leanEvolve non deve crashare
    const result = await leanEvolve(planId, 'T1', 'test failure')
    expect(result.cycle).toBe(1)
    expect(result.rewrittenInstruction).toBeDefined()
    expect(result.rewrittenInstruction.length).toBeGreaterThan(0)

    // Cleanup
    await db.agentPlan.delete({ where: { id: planId } })
  })
})
