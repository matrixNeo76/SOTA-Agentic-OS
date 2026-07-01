/**
 * Tests for Agent Runtime Checkpointing (Fase 1.6)
 *
 * Verifica le 3 capacità: Resume, Replay, Rollback.
 * Fork e Simulation sono rimandati a Fase 3 (vedi ROADMAP).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  saveCheckpoint, loadCheckpoint, resumeFromCheckpoint,
  replayFromCheckpoint, rollbackToCheckpoint, listCheckpoints,
  autoCheckpoint,
  type CheckpointType, type CheckpointState,
} from '@/lib/checkpoint/checkpoint'
import { db } from '@/lib/db'

const AGENT_URI = 'agent://checkpoint-test'
const TASK_URI = 'task://checkpoint-task'

const SAMPLE_STATE: CheckpointState = {
  taskUri: TASK_URI,
  stepIndex: 3,
  batchIndex: 1,
  agentStates: { planner: { phase: 'executing' } },
  cycleId: 42,
}

describe('Checkpoint — saveCheckpoint + loadCheckpoint', () => {
  beforeAll(async () => {
    await db.agentCheckpoint.deleteMany({})
  })

  it('salva un checkpoint execution_state e lo recupera', async () => {
    const { id } = await saveCheckpoint({
      agentUri: AGENT_URI,
      taskId: TASK_URI,
      checkpointType: 'execution_state',
      state: SAMPLE_STATE,
      cycleId: 42,
    })

    expect(id).toBeTruthy()

    const loaded = await loadCheckpoint({
      agentUri: AGENT_URI,
      taskId: TASK_URI,
      checkpointType: 'execution_state',
    })

    expect(loaded).not.toBeNull()
    expect(loaded!.state.stepIndex).toBe(3)
    expect(loaded!.state.cycleId).toBe(42)
    expect(loaded!.state.agentStates!.planner.phase).toBe('executing')
  })

  it('salva tutti i 4 tipi di checkpoint', async () => {
    const types: CheckpointType[] = [
      'execution_state', 'tool_state', 'memory_state', 'workflow_state',
    ]

    for (const type of types) {
      await saveCheckpoint({
        agentUri: AGENT_URI,
        checkpointType: type,
        state: { ...SAMPLE_STATE, stepIndex: types.indexOf(type) },
      })
    }

    const all = await listCheckpoints({ agentUri: AGENT_URI })
    expect(all.length).toBeGreaterThanOrEqual(4)
  })

  it('loadCheckpoint ritorna il più recente (ORDER BY createdAt DESC)', async () => {
    await saveCheckpoint({
      agentUri: AGENT_URI,
      checkpointType: 'memory_state',
      state: { ...SAMPLE_STATE, stepIndex: 100 },
    })

    // Attendi 10ms per garantire timestamp diverso
    await new Promise((r) => setTimeout(r, 10))

    await saveCheckpoint({
      agentUri: AGENT_URI,
      checkpointType: 'memory_state',
      state: { ...SAMPLE_STATE, stepIndex: 200 },
    })

    const latest = await loadCheckpoint({
      agentUri: AGENT_URI,
      checkpointType: 'memory_state',
    })

    expect(latest!.state.stepIndex).toBe(200)
  })

  it('loadCheckpoint ritorna null se non esiste', async () => {
    const result = await loadCheckpoint({
      agentUri: 'agent://nonexistent',
      checkpointType: 'execution_state',
    })
    expect(result).toBeNull()
  })
})

describe('Checkpoint — resumeFromCheckpoint', () => {
  it('resume ritorna lo stato dell\'ultimo execution_state checkpoint', async () => {
    const result = await resumeFromCheckpoint({
      agentUri: AGENT_URI,
      taskId: TASK_URI,
    })

    expect(result.resumed).toBe(true)
    expect(result.state).not.toBeNull()
    expect(result.checkpointId).toBeTruthy()
  })

  it('resume ritorna resumed=false se non ci sono checkpoint', async () => {
    const result = await resumeFromCheckpoint({
      agentUri: 'agent://never-checkpointed',
    })
    expect(result.resumed).toBe(false)
    expect(result.state).toBeNull()
  })
})

describe('Checkpoint — replayFromCheckpoint', () => {
  it('ritorna la lista di checkpoint successivi a quello dato', async () => {
    const all = await listCheckpoints({ agentUri: AGENT_URI, limit: 100 })
    expect(all.length).toBeGreaterThanOrEqual(2)

    // Prendi il primo come fromCheckpoint
    const from = all[all.length - 1]! // più vecchio (listCheckpoints ordina DESC)
    const replay = await replayFromCheckpoint({
      agentUri: AGENT_URI,
      fromCheckpointId: from.id,
    })

    expect(replay.replayable).toBe(true)
    expect(replay.checkpoints.length).toBeGreaterThan(0)
  })

  it('replay senza fromCheckpointId ritorna tutti i checkpoint', async () => {
    const replay = await replayFromCheckpoint({ agentUri: AGENT_URI })
    expect(replay.replayable).toBe(true)
    expect(replay.checkpoints.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Checkpoint — rollbackToCheckpoint', () => {
  it('rollback ripristina lo stato e invalida i checkpoint successivi', async () => {
    // Salva 3 checkpoint in sequenza
    const cp1 = await saveCheckpoint({
      agentUri: 'agent://rollback-test',
      checkpointType: 'execution_state',
      state: { ...SAMPLE_STATE, stepIndex: 1 },
    })

    await new Promise((r) => setTimeout(r, 10))
    await saveCheckpoint({
      agentUri: 'agent://rollback-test',
      checkpointType: 'execution_state',
      state: { ...SAMPLE_STATE, stepIndex: 2 },
    })

    await new Promise((r) => setTimeout(r, 10))
    await saveCheckpoint({
      agentUri: 'agent://rollback-test',
      checkpointType: 'execution_state',
      state: { ...SAMPLE_STATE, stepIndex: 3 },
    })

    const before = await listCheckpoints({ agentUri: 'agent://rollback-test' })
    expect(before.length).toBe(3)

    // Rollback al primo
    const result = await rollbackToCheckpoint({
      agentUri: 'agent://rollback-test',
      toCheckpointId: cp1.id,
    })

    expect(result.rolledBack).toBe(true)
    expect(result.restoredState!.stepIndex).toBe(1)

    // I checkpoint successivi devono essere stati eliminati
    const after = await listCheckpoints({ agentUri: 'agent://rollback-test' })
    expect(after.length).toBe(1) // rimane solo cp1
  })

  it('rollback rifiuta checkpoint di altro agente', async () => {
    const cp = await saveCheckpoint({
      agentUri: 'agent://owner',
      checkpointType: 'execution_state',
      state: SAMPLE_STATE,
    })

    const result = await rollbackToCheckpoint({
      agentUri: 'agent://impostor',
      toCheckpointId: cp.id,
    })

    expect(result.rolledBack).toBe(false)
  })
})

describe('Checkpoint — autoCheckpoint', () => {
  it('autoCheckpoint è alias di saveCheckpoint con type=execution_state', async () => {
    const { id } = await autoCheckpoint({
      agentUri: 'agent://auto-test',
      cycleId: 1,
      currentState: { ...SAMPLE_STATE, stepIndex: 99 },
    })

    expect(id).toBeTruthy()

    const loaded = await loadCheckpoint({
      agentUri: 'agent://auto-test',
      checkpointType: 'execution_state',
    })

    expect(loaded).not.toBeNull()
    expect(loaded!.state.stepIndex).toBe(99)
    expect(loaded!.cycleId).toBe(1)
  })
})
