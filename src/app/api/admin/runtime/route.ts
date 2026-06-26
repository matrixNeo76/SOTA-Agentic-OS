/**
 * GET /api/admin/runtime — Runtime status: workers, jobs, running tasks, checkpoints
 * POST /api/admin/runtime — Actions: recover, stop, gc-run
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'
import { recoverOrphanedPlans } from '@/lib/runtime/executor'
import { consolidateEpisodicToProcedural, archiveColdMemories } from '@/lib/cognitive-gc/curator'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const [runningPlans, runningTasks, pendingJobs, recentCheckpoints, jobStats] = await Promise.all([
    db.agentPlan.findMany({
      where: { status: { in: ['scheduled', 'running'] } },
      include: { tasks: { where: { status: 'running' } } },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    db.planTask.count({ where: { status: 'running' } }),
    db.jobRecord.count({ where: { status: { in: ['queued', 'running', 'retry'] } } }),
    db.agentCheckpoint.count(),
    db.jobRecord.groupBy({ by: ['status'], _count: true }),
  ])

  return NextResponse.json({
    runningPlans: runningPlans.map((p) => ({
      id: p.id,
      goal: p.taskGoal,
      status: p.status,
      runningTasks: p.tasks.length,
      createdAt: p.createdAt.toISOString(),
    })),
    stats: {
      runningPlans: runningPlans.length,
      runningTasks,
      pendingJobs,
      totalCheckpoints: recentCheckpoints,
    },
    jobStats: jobStats.reduce((acc, s) => ({ ...acc, [s.status]: s._count }), {} as Record<string, number>),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const { action } = await req.json()

  if (action === 'recover') {
    const result = await recoverOrphanedPlans()
    return NextResponse.json({ recovered: true, ...result })
  }

  if (action === 'gc-consolidate') {
    const result = await consolidateEpisodicToProcedural({})
    return NextResponse.json({ consolidated: true, ...result })
  }

  if (action === 'gc-archive') {
    const result = await archiveColdMemories({})
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'cancel-plan') {
    const { planId } = await req.json()
    if (!planId) return NextResponse.json({ error: 'Missing planId' }, { status: 400 })

    // Mark all running/pending tasks as 'failed' with a cancellation reason,
    // then mark the plan itself as 'failed'. This frees the worker to pick
    // up other work without waiting for the orphan-recovery timeout.
    const updated = await db.planTask.updateMany({
      where: { planId, status: { in: ['pending', 'ready', 'running'] } },
      data: { status: 'failed', result: 'Cancelled by admin', finishedAt: new Date() },
    })
    await db.agentPlan.update({
      where: { id: planId },
      data: { status: 'failed' },
    })
    return NextResponse.json({ cancelled: true, planId, affectedTasks: updated.count })
  }

  return NextResponse.json({ error: 'Unknown action. Use: recover, gc-consolidate, gc-archive, cancel-plan' }, { status: 400 })
}
