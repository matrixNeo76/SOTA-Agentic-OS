/**
 * GET /api/runs/list — List all plan executions (past + in-progress)
 *
 * Query params:
 *   ?status=running  → filter by status
 *   ?limit=20        → max results (default 50)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const limit = parseInt(url.searchParams.get('limit') || '50', 10)

  const plans = await db.agentPlan.findMany({
    where: status ? { status } : undefined,
    include: {
      tasks: {
        select: {
          id: true,
          taskId: true,
          agentId: true,
          description: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          result: true,
        },
      },
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
  })

  const runs = plans.map((p) => {
    const tasks = p.tasks
    const completed = tasks.filter((t) => t.status === 'done').length
    const failed = tasks.filter((t) => t.status === 'failed').length
    const blocked = tasks.filter((t) => t.status === 'blocked').length
    const running = tasks.filter((t) => t.status === 'running').length
    const totalDuration = tasks.reduce((sum, t) => {
      if (t.startedAt && t.finishedAt) {
        return sum + (t.finishedAt.getTime() - t.startedAt.getTime())
      }
      return sum
    }, 0)

    return {
      planId: p.id,
      goal: p.taskGoal,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      taskCount: tasks.length,
      tasksCompleted: completed,
      tasksFailed: failed,
      tasksBlocked: blocked,
      tasksRunning: running,
      totalDurationMs: totalDuration,
      agentCount: p.agentCount,
      batches: p.dagJson ? JSON.parse(p.dagJson) : [],
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        agentId: t.agentId,
        description: t.description,
        status: t.status,
        startedAt: t.startedAt?.toISOString() || null,
        finishedAt: t.finishedAt?.toISOString() || null,
        durationMs: t.startedAt && t.finishedAt
          ? t.finishedAt.getTime() - t.startedAt.getTime()
          : null,
        result: t.result?.slice(0, 500) || null, // truncate for list view
      })),
    }
  })

  return NextResponse.json({ runs, total: runs.length })
}
