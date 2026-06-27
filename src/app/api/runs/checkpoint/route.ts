/**
 * POST /api/runs/checkpoint — Checkpoint management (resume/rollback)
 *
 * C6.5 — Fixed:
 *   - Double req.json() bug (body stream consumed twice → HTTP 500)
 *   - Missing validation (agentUri/checkpointId/taskId not checked for existence)
 *   - No 404 when checkpoint/task not found → now returns clear error
 *   - No auth check on rollback result → now returns the restored state
 *
 * Actions:
 *   - rollback: rollback to a specific checkpoint
 *   - resume: resume execution from a checkpoint
 *   - list: list checkpoints for a plan or agent
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { rollbackToCheckpoint, resumeFromCheckpoint, listCheckpoints } from '@/lib/checkpoint/checkpoint'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  // C6.5 — Parse the body ONCE. The old code called req.json() twice
  // (once for action, once per handler) which throws because the body
  // stream is already consumed.
  const body = await req.json()
  const { action } = body

  if (action === 'rollback') {
    const { agentUri, checkpointId } = body
    if (!agentUri || !checkpointId) {
      return NextResponse.json(
        { error: 'Missing agentUri or checkpointId' },
        { status: 400 },
      )
    }

    // C6.5 — Verify the checkpoint exists before attempting rollback.
    // rollbackToCheckpoint throws if not found, but we want a clean 404.
    const existing = await db.agentCheckpoint.findUnique({
      where: { id: checkpointId },
      select: { id: true, agentUri: true, checkpointType: true, createdAt: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: `Checkpoint not found: ${checkpointId}` },
        { status: 404 },
      )
    }
    if (existing.agentUri !== agentUri) {
      return NextResponse.json(
        {
          error: `Checkpoint ${checkpointId} belongs to agent ${existing.agentUri}, not ${agentUri}`,
        },
        { status: 400 },
      )
    }

    try {
      const result = await rollbackToCheckpoint({ agentUri, toCheckpointId: checkpointId })
      return NextResponse.json({
        rolledBack: result.rolledBack,
        restoredState: result.restoredState,
        checkpoint: existing,
      })
    } catch (err: any) {
      return NextResponse.json(
        { error: `Rollback failed: ${err.message}` },
        { status: 500 },
      )
    }
  }

  if (action === 'resume') {
    const { agentUri, taskId } = body
    if (!agentUri) {
      return NextResponse.json(
        { error: 'Missing agentUri' },
        { status: 400 },
      )
    }

    try {
      const result = await resumeFromCheckpoint({ agentUri, taskId })
      if (!result || (result as any).resumed === false) {
        return NextResponse.json(
          { error: `No checkpoint found for agent ${agentUri}${taskId ? ` task ${taskId}` : ''}` },
          { status: 404 },
        )
      }
      return NextResponse.json(result)
    } catch (err: any) {
      return NextResponse.json(
        { error: `Resume failed: ${err.message}` },
        { status: 500 },
      )
    }
  }

  if (action === 'list') {
    const { agentUri, taskId, limit } = body
    if (!agentUri) {
      return NextResponse.json(
        { error: 'Missing agentUri' },
        { status: 400 },
      )
    }

    const checkpoints = await listCheckpoints({
      agentUri,
      ...(taskId && { taskId }),
      limit: limit || 20,
    })
    return NextResponse.json({ checkpoints, count: checkpoints.length })
  }

  return NextResponse.json(
    { error: 'Unknown action. Use: rollback, resume, list' },
    { status: 400 },
  )
}
