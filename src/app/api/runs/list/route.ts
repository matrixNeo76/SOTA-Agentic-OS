/**
 * GET /api/runs/list — List all plan executions (past + in-progress)
 *
 * Query params:
 *   ?status=running    → filter by plan status (running|scheduled|paused|completed|failed|partial|drafted)
 *   ?agent=orchestrator → filter by agent that worked on the plan (matches any task's agentId)
 *   ?search=migration  → full-text search in plan goal
 *   ?limit=20          → max results per page (default 50, max 200)
 *   ?offset=0          → pagination offset (default 0)
 *
 * C6.7 — Added agent filter, search, and pagination (offset-based).
 * Returns `total` (total count matching filters, not just the page) so
 * the UI can show "X-Y of Z" and implement load-more.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const agent = url.searchParams.get('agent')
  const search = url.searchParams.get('search')
  const tag = url.searchParams.get('tag')
  const includeArchived = url.searchParams.get('archived') === 'true'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)

  // === Build where clause ===
  const where: any = {}
  // C6.8 — Hide archived by default (only show if ?archived=true)
  if (!includeArchived) {
    where.archived = false
  }
  if (status && status !== 'all') {
    where.status = status
  }
  if (search) {
    where.taskGoal = { contains: search }
  }
  // Agent filter: plan must have at least one task with this agentId
  if (agent && agent !== 'all') {
    where.tasks = { some: { agentId: agent } }
  }
  // C6.8 — Tag filter: tags JSON array contains the tag string
  if (tag && tag !== 'all') {
    where.tags = { contains: `"${tag}"` }
  }

  // === Fetch page + total count in parallel ===
  const [plans, totalCount] = await Promise.all([
    db.agentPlan.findMany({
      where,
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
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    db.agentPlan.count({ where }),
  ])

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

    // Unique agents for this plan (for the agent breakdown in the list)
    const agents = Array.from(new Set(tasks.map((t) => t.agentId)))

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
      // C6.8 — Tags + archived status
      tags: p.tags ? JSON.parse(p.tags) : [],
      archived: p.archived,
      agents, // C6.7 — list of unique agent IDs for filter dropdown
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
        result: t.result?.slice(0, 500) || null,
      })),
    }
  })

  // C6.7 — Collect all unique agents across loaded runs for the filter dropdown
  const allAgents = Array.from(new Set(runs.flatMap((r) => r.agents))).sort()
  // C6.8 — Collect all unique tags across loaded runs for the filter dropdown
  const allTags = Array.from(new Set(runs.flatMap((r) => r.tags || []))).sort()

  return NextResponse.json({
    runs,
    total: totalCount,        // total matching the filter (not just this page)
    returned: runs.length,    // how many in this page
    offset,
    limit,
    hasMore: offset + runs.length < totalCount,
    agents: allAgents,        // unique agents for filter dropdown
    tags: allTags,            // C6.8 — unique tags for filter dropdown
  })
}
