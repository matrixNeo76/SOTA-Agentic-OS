/**
 * A2A Tasks API — IO-2b
 *
 * POST /api/a2a/tasks — Submit a new task (from external agent)
 * GET /api/a2a/tasks?taskId=xxx — Get task status
 * POST /api/a2a/tasks/cancel — Cancel a task
 *
 * Auth: API key with scope 'exec' (Bearer sak_...)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/api-key'
import { submitTask, getTask, cancelTask } from '@/lib/a2a/protocol'

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, 'exec')
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()

    // Cancel action
    if (body.action === 'cancel') {
      const { taskId } = body
      if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
      const result = await cancelTask(taskId)
      return NextResponse.json(result)
    }

    // Submit task
    const result = await submitTask({
      message: body.message,
      sessionId: body.sessionId,
      metadata: body.metadata,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, 'read')
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')

  if (!taskId) {
    return NextResponse.json({
      error: 'Missing taskId parameter. Use GET /api/a2a/tasks?taskId=xxx',
    }, { status: 400 })
  }

  const task = await getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json(task)
}
