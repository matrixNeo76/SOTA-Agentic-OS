/**
 * POST /api/runs/control — Run lifecycle control (pause/resume/abort)
 *
 * C6.6 — New API for run-level controls. Complements the existing
 * /api/admin/runtime/cancel-plan (which is admin-only) with a user-facing
 * route that respects the requireAuth (any authenticated user can control
 * their own runs; admin/operator can control any run).
 *
 * Actions:
 *   - pause:   mark a running plan as 'paused' (tasks stay in their current
 *              state; the executor will skip paused plans on next tick)
 *   - resume:  mark a paused plan back to 'running' (executor picks it up)
 *   - abort:   mark all pending/ready/running tasks as 'failed' with
 *              'Cancelled by user' reason, then mark the plan as 'failed'
 *
 * The pause/resume cycle is safe: pausing doesn't kill in-flight HTTP
 * requests (those complete naturally), it just prevents the executor from
 * starting the next batch. Abort is destructive — it cancels everything
 * not yet done.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

const VALID_ACTIONS = ['pause', 'resume', 'abort'] as const
type RunAction = (typeof VALID_ACTIONS)[number]

// Status transitions allowed for each action.
const PAUSABLE_STATUSES = ['running', 'scheduled']
const RESUMABLE_STATUSES = ['paused']
const ABORTABLE_STATUSES = ['running', 'scheduled', 'paused', 'partial']

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { action, planId } = body as { action: string; planId?: string }

  // === Validate action ===
  if (!action || !VALID_ACTIONS.includes(action as RunAction)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  // === Validate planId ===
  if (!planId) {
    return NextResponse.json(
      { error: 'Missing planId' },
      { status: 400 },
    )
  }

  // === Load plan ===
  const plan = await db.agentPlan.findUnique({
    where: { id: planId },
    select: { id: true, status: true, taskGoal: true },
  })
  if (!plan) {
    return NextResponse.json(
      { error: `Plan not found: ${planId}` },
      { status: 404 },
    )
  }

  const runAction = action as RunAction

  // === pause ===
  if (runAction === 'pause') {
    if (!PAUSABLE_STATUSES.includes(plan.status)) {
      return NextResponse.json(
        {
          error: `Cannot pause plan in status '${plan.status}'. Must be one of: ${PAUSABLE_STATUSES.join(', ')}`,
        },
        { status: 409 },
      )
    }
    await db.agentPlan.update({
      where: { id: planId },
      data: { status: 'paused' },
    })
    return NextResponse.json({
      paused: true,
      planId,
      previousStatus: plan.status,
      message: `Plan '${plan.taskGoal}' paused. In-flight tasks will complete; no new batches will start.`,
    })
  }

  // === resume ===
  if (runAction === 'resume') {
    if (!RESUMABLE_STATUSES.includes(plan.status)) {
      return NextResponse.json(
        {
          error: `Cannot resume plan in status '${plan.status}'. Must be one of: ${RESUMABLE_STATUSES.join(', ')}`,
        },
        { status: 409 },
      )
    }
    await db.agentPlan.update({
      where: { id: planId },
      data: { status: 'running' },
    })
    return NextResponse.json({
      resumed: true,
      planId,
      previousStatus: plan.status,
      message: `Plan '${plan.taskGoal}' resumed. Executor will pick up pending tasks.`,
    })
  }

  // === abort ===
  if (runAction === 'abort') {
    if (!ABORTABLE_STATUSES.includes(plan.status)) {
      return NextResponse.json(
        {
          error: `Cannot abort plan in status '${plan.status}'. Must be one of: ${ABORTABLE_STATUSES.join(', ')}`,
        },
        { status: 409 },
      )
    }

    // Mark all non-terminal tasks as failed
    const updated = await db.planTask.updateMany({
      where: {
        planId,
        status: { in: ['pending', 'ready', 'running', 'blocked'] },
      },
      data: {
        status: 'failed',
        result: 'Cancelled by user via run control',
        finishedAt: new Date(),
      },
    })

    await db.agentPlan.update({
      where: { id: planId },
      data: { status: 'failed' },
    })

    return NextResponse.json({
      aborted: true,
      planId,
      previousStatus: plan.status,
      affectedTasks: updated.count,
      message: `Plan '${plan.taskGoal}' aborted. ${updated.count} task(s) marked as failed.`,
    })
  }

  // Should never reach here (action is validated above)
  return NextResponse.json(
    { error: 'Unhandled action' },
    { status: 500 },
  )
}
