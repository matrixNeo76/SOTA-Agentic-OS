/**
 * POST /api/runs/checkpoint — Checkpoint management (resume/rollback)
 *
 * Actions:
 *   - rollback: rollback to a specific checkpoint
 *   - resume: resume execution from a checkpoint
 *   - list: list checkpoints for a plan
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { rollbackToCheckpoint, resumeFromCheckpoint, listCheckpoints } from '@/lib/checkpoint/checkpoint'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const { action } = await req.json()

  if (action === 'rollback') {
    const { agentUri, checkpointId } = await req.json()
    if (!agentUri || !checkpointId) {
      return NextResponse.json({ error: 'Missing agentUri or checkpointId' }, { status: 400 })
    }
    const result = await rollbackToCheckpoint({ agentUri, toCheckpointId: checkpointId })
    return NextResponse.json({ rolledBack: result.rolledBack, restoredState: result.restoredState })
  }

  if (action === 'resume') {
    const { agentUri, taskId } = await req.json()
    if (!agentUri) {
      return NextResponse.json({ error: 'Missing agentUri' }, { status: 400 })
    }
    const result = await resumeFromCheckpoint({ agentUri, taskId })
    return NextResponse.json(result)
  }

  if (action === 'list') {
    const { agentUri, taskId, limit } = await req.json()
    if (!agentUri) {
      return NextResponse.json({ error: 'Missing agentUri' }, { status: 400 })
    }
    const checkpoints = await listCheckpoints({
      agentUri,
      ...(taskId && { taskId }),
      limit: limit || 20,
    })
    return NextResponse.json({ checkpoints })
  }

  return NextResponse.json({ error: 'Unknown action. Use: rollback, resume, list' }, { status: 400 })
}
