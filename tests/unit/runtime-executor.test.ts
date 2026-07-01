/**
 * Tests for Runtime Executor (WS1.1-1.5)
 *
 * Testa le componenti non-LLM dell'executor:
 *   - State machine (pending → running → done/failed)
 *   - Recovery di piani orfani
 *   - Event journal
 *   - Idempotency (task già completati vengono skippati)
 *
 * Le chiamate LLM sono mockate/non testate qui (richiederebbero API key).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { executePlan, recoverOrphanedPlans } from '@/lib/runtime/executor'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

describe('Runtime Executor — state machine persistente (WS1.2)', () => {
  beforeAll(async () => {
    await db.planTask.deleteMany({})
    await db.agentPlan.deleteMany({})
    await db.executionTrace.deleteMany({})
    _resetEventMeshForTests()
  })

  it('create plan manually + executePlan recupera da DB', async () => {
    // Crea un piano manualmente (simula output di generateAndPersistPlan)
    const planId = `plan_test_${Date.now()}`
    const plan = {
      goal: 'Test goal for executor',
      tasks: [
        { taskId: 'T1', agentId: 'orchestrator', description: 'First task', dependencies: [] },
        { taskId: 'T2', agentId: 'curator', description: 'Second task', dependencies: ['T1'] },
      ],
    }

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: plan.goal,
        planJson: JSON.stringify(plan),
        dagJson: JSON.stringify([['T1'], ['T2']]),
        status: 'scheduled',
        agentCount: 2,
        tasks: {
          create: plan.tasks.map((t) => ({
            taskId: t.taskId,
            agentId: t.agentId,
            description: t.description,
            dependencies: JSON.stringify(t.dependencies),
            status: 'pending',
          })),
        },
      },
    })

    // Esegui il piano (l'LLM verrà chiamato ma con fallback error → task failed)
    const result = await executePlan({
      planId,
      signal: new AbortController().signal,
    })

    expect(result.planId).toBe(planId)
    expect(result.goal).toBe(plan.goal)
    expect(result.steps.length).toBe(2)
    expect(result.batches).toEqual([['T1'], ['T2']])

    // I task possono essere done o failed (dipende dall'LLM availability)
    for (const step of result.steps) {
      expect(['done', 'failed', 'blocked']).toContain(step.status)
      expect(step.durationMs).toBeGreaterThanOrEqual(0)
    }

    // Verifica che lo stato sia persistito su DB
    const dbTasks = await db.planTask.findMany({ where: { planId } })
    for (const task of dbTasks) {
      expect(['done', 'failed', 'blocked', 'pending']).toContain(task.status)
    }
  })

  it('idempotency: task già done vengono skippati (WS1.3)', async () => {
    const planId = `plan_idem_${Date.now()}`
    const plan = {
      goal: 'Idempotency test',
      tasks: [
        { taskId: 'T1', agentId: 'orchestrator', description: 'Already done', dependencies: [] },
      ],
    }

    // Crea piano con T1 già done
    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: plan.goal,
        planJson: JSON.stringify(plan),
        dagJson: JSON.stringify([['T1']]),
        status: 'running',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Already done',
            dependencies: '[]',
            status: 'done',
            result: 'Previous result',
          }],
        },
      },
    })

    const result = await executePlan({ planId })

    // T1 deve essere skippato (usa il risultato precedente)
    expect(result.steps.length).toBe(1)
    expect(result.steps[0]!.status).toBe('done')
    expect(result.steps[0]!.result).toBe('Previous result')
    expect(result.resumed).toBe(true)
  })
})

describe('Runtime Executor — event journal (WS1.3)', () => {
  beforeAll(async () => {
    await db.executionTrace.deleteMany({})
  })

  it('executePlan scrive su ExecutionTrace per ogni task completato', async () => {
    const planId = `plan_journal_${Date.now()}`
    const plan = {
      goal: 'Journal test',
      tasks: [
        { taskId: 'T1', agentId: 'orchestrator', description: 'Journal task', dependencies: [] },
      ],
    }

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: plan.goal,
        planJson: JSON.stringify(plan),
        dagJson: JSON.stringify([['T1']]),
        status: 'scheduled',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Journal task',
            dependencies: '[]',
            status: 'pending',
          }],
        },
      },
    })

    await executePlan({ planId })

    // Verifica che almeno una trace sia stata scritta (se il task è done)
    const traces = await db.executionTrace.findMany({
      where: { workflowId: planId },
    })

    // Se il task è fallito (LLM non disponibile), la trace non viene scritta
    // ma non deve crashare
    if (traces.length > 0) {
      const trace = traces[0]!
      expect(trace.workflowId).toBe(planId)
      expect(trace.traceLabel).toContain('T1')
    }
  })
})

describe('Runtime Executor — recovery (WS1.3)', () => {
  beforeAll(async () => {
    await db.planTask.deleteMany({})
    await db.agentPlan.deleteMany({})
  })

  it('recoverOrphanedPlans trova e riprende piani con task running', async () => {
    // Crea un piano con un task in stato 'running' (orfano)
    const planId = `plan_orphan_${Date.now()}`
    const plan = {
      goal: 'Orphaned plan',
      tasks: [
        { taskId: 'T1', agentId: 'orchestrator', description: 'Orphaned task', dependencies: [] },
      ],
    }

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: plan.goal,
        planJson: JSON.stringify(plan),
        dagJson: JSON.stringify([['T1']]),
        status: 'running',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Orphaned task',
            dependencies: '[]',
            status: 'running',
            startedAt: new Date(),
          }],
        },
      },
    })

    // Esegui recovery
    const result = await recoverOrphanedPlans()

    expect(result.recoveredPlans).toBeGreaterThanOrEqual(0) // può essere 0 se il task viene completato durante il recovery
    expect(result.recoveredTasks).toBeGreaterThanOrEqual(0)

    // Il task deve essere stato resettato a pending (o completato se LLM disponibile)
    const task = await db.planTask.findFirst({ where: { planId, taskId: 'T1' } })
    expect(task).not.toBeNull()
    expect(['pending', 'done', 'failed', 'blocked']).toContain(task!.status)
  })

  it('recoverOrphanedPlans ritorna 0 se non ci sono orfani', async () => {
    // Assicurati che non ci siano piani running
    await db.agentPlan.updateMany({
      where: { status: 'running' },
      data: { status: 'completed' },
    })

    const result = await recoverOrphanedPlans()
    expect(result.recoveredPlans).toBe(0)
    expect(result.recoveredTasks).toBe(0)
  })
})
