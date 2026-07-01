/**
 * Agent Runtime Checkpointing — Fase 1.6
 *
 * Estende il kernel attuale con checkpoint deterministici.
 * Capacità: Resume, Replay, Rollback (Fork e Simulation rimandati a Fase 3).
 *
 * Rollback si appoggia al PatchBoard transazionale già presente.
 *
 * Checkpoint types:
 *   execution_state  — stato dell'esecuzione (task corrente, step, batch)
 *   tool_state       — stato dei tool (sessioni, permessi, cache)
 *   memory_state     — snapshot della memoria rilevante
 *   workflow_state   — stato del workflow DynAMO
 */

import { db } from '@/lib/db'

export type CheckpointType = 'execution_state' | 'tool_state' | 'memory_state' | 'workflow_state'

export type CheckpointState = {
  taskUri?: string
  stepIndex?: number
  batchIndex?: number
  agentStates?: Record<string, any>
  toolSessions?: Record<string, any>
  memorySnapshot?: Record<string, any>
  workflowSnapshot?: Record<string, any>
  cycleId?: number
}

// === Save Checkpoint ===
export async function saveCheckpoint(params: {
  agentUri: string
  taskId?: string
  checkpointType: CheckpointType
  state: CheckpointState
  cycleId?: number
}): Promise<{ id: string }> {
  const checkpoint = await db.agentCheckpoint.create({
    data: {
      agentUri: params.agentUri,
      taskId: params.taskId || null,
      checkpointType: params.checkpointType,
      stateJson: JSON.stringify(params.state),
      cycleId: params.cycleId || null,
    },
  })
  return { id: checkpoint.id }
}

// === Load Checkpoint (most recent) ===
export async function loadCheckpoint(params: {
  agentUri: string
  taskId?: string
  checkpointType?: CheckpointType
}): Promise<{ id: string; state: CheckpointState; cycleId: number | null; createdAt: string } | null> {
  const checkpoint = await db.agentCheckpoint.findFirst({
    where: {
      agentUri: params.agentUri,
      ...(params.taskId && { taskId: params.taskId }),
      ...(params.checkpointType && { checkpointType: params.checkpointType }),
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!checkpoint) return null

  return {
    id: checkpoint.id,
    state: JSON.parse(checkpoint.stateJson) as CheckpointState,
    cycleId: checkpoint.cycleId,
    createdAt: checkpoint.createdAt.toISOString(),
  }
}

// === Resume from Checkpoint ===
export async function resumeFromCheckpoint(params: {
  agentUri: string
  taskId?: string
}): Promise<{ resumed: boolean; state: CheckpointState | null; checkpointId: string | null }> {
  // Load the latest execution_state checkpoint
  const checkpoint = await loadCheckpoint({
    agentUri: params.agentUri,
    taskId: params.taskId,
    checkpointType: 'execution_state',
  })

  if (!checkpoint) {
    return { resumed: false, state: null, checkpointId: null }
  }

  // Restore the state
  // In production: restore tool sessions, memory, workflow
  // For now: return the state for the caller to apply
  return { resumed: true, state: checkpoint.state, checkpointId: checkpoint.id }
}

// === Replay from Checkpoint ===
export async function replayFromCheckpoint(params: {
  agentUri: string
  taskId?: string
  fromCheckpointId?: string
}): Promise<{ replayable: boolean; checkpoints: Array<{ id: string; type: string; createdAt: string }> }> {
  // Get all checkpoints for this agent/task after the given one
  const checkpoints = await db.agentCheckpoint.findMany({
    where: {
      agentUri: params.agentUri,
      ...(params.taskId && { taskId: params.taskId }),
      ...(params.fromCheckpointId && {
        id: { not: params.fromCheckpointId },
        createdAt: {
          gte: (await db.agentCheckpoint.findUnique({ where: { id: params.fromCheckpointId } }))?.createdAt || new Date(0),
        },
      }),
    },
    orderBy: { createdAt: 'asc' },
  })

  return {
    replayable: checkpoints.length > 0,
    checkpoints: checkpoints.map(c => ({
      id: c.id,
      type: c.checkpointType,
      createdAt: c.createdAt.toISOString(),
    })),
  }
}

// === Rollback to Checkpoint ===
export async function rollbackToCheckpoint(params: {
  agentUri: string
  toCheckpointId: string
}): Promise<{ rolledBack: boolean; restoredState: CheckpointState | null }> {
  const checkpoint = await db.agentCheckpoint.findUnique({
    where: { id: params.toCheckpointId },
  })

  if (!checkpoint || checkpoint.agentUri !== params.agentUri) {
    return { rolledBack: false, restoredState: null }
  }

  const state = JSON.parse(checkpoint.stateJson) as CheckpointState

  // In production: this would trigger PatchBoard rollback
  // For now: return the state for the caller to apply
  // Also: delete all checkpoints after this one (they're invalidated)
  await db.agentCheckpoint.deleteMany({
    where: {
      agentUri: params.agentUri,
      createdAt: { gt: checkpoint.createdAt },
    },
  })

  return { rolledBack: true, restoredState: state }
}

// === List Checkpoints ===
export async function listCheckpoints(params: {
  agentUri: string
  taskId?: string
  limit?: number
}): Promise<Array<{
  id: string; checkpointType: string; cycleId: number | null; createdAt: string
}>> {
  const checkpoints = await db.agentCheckpoint.findMany({
    where: {
      agentUri: params.agentUri,
      ...(params.taskId && { taskId: params.taskId }),
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit || 20,
  })

  return checkpoints.map(c => ({
    id: c.id,
    checkpointType: c.checkpointType,
    cycleId: c.cycleId,
    createdAt: c.createdAt.toISOString(),
  }))
}

// === Auto-checkpoint (called during execution) ===
export async function autoCheckpoint(params: {
  agentUri: string
  taskId?: string
  cycleId?: number
  currentState: CheckpointState
}): Promise<{ id: string }> {
  // Save execution state
  return saveCheckpoint({
    agentUri: params.agentUri,
    taskId: params.taskId,
    checkpointType: 'execution_state',
    state: params.currentState,
    cycleId: params.cycleId,
  })
}
