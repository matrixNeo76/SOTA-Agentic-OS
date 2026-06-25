/**
 * GET /api/runs/detail?planId=xxx — Full run detail with tasks, checkpoints, traces
 *
 * Returns:
 *   - Plan info (goal, status, batches)
 *   - All tasks with full results, LTL verdicts
 *   - Checkpoints for this plan (for resume/rollback)
 *   - Execution traces (ReAct loop journal)
 *   - Cost entries for this plan
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const planId = url.searchParams.get('planId')

  if (!planId) {
    return NextResponse.json({ error: 'Missing planId' }, { status: 400 })
  }

  const plan = await db.agentPlan.findUnique({
    where: { id: planId },
    include: {
      tasks: {
        orderBy: { taskId: 'asc' },
      },
    },
  })

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  // Get checkpoints for this plan's tasks
  const checkpoints = await db.agentCheckpoint.findMany({
    where: {
      OR: [
        { taskId: { contains: planId } },
        { agentUri: { contains: planId } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Get execution traces (event journal)
  const traces = await db.executionTrace.findMany({
    where: { workflowId: planId },
    orderBy: { capturedAt: 'desc' },
    take: 50,
  })

  // Get cost entries
  const costs = await db.costEntry.findMany({
    where: {
      OR: [
        { phase: { contains: planId } },
        { agentId: { contains: 'plan' } },
      ],
    },
    orderBy: { timestamp: 'desc' },
    take: 50,
  })

  const totalCost = costs.reduce((sum, c) => sum + c.cost, 0)
  const totalTokensIn = costs.reduce((sum, c) => sum + c.tokensIn, 0)
  const totalTokensOut = costs.reduce((sum, c) => sum + c.tokensOut, 0)

  return NextResponse.json({
    plan: {
      id: plan.id,
      goal: plan.taskGoal,
      status: plan.status,
      planJson: JSON.parse(plan.planJson),
      batches: plan.dagJson ? JSON.parse(plan.dagJson) : [],
      agentCount: plan.agentCount,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    },
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      taskId: t.taskId,
      agentId: t.agentId,
      description: t.description,
      dependencies: JSON.parse(t.dependencies),
      status: t.status,
      result: t.result,
      startedAt: t.startedAt?.toISOString() || null,
      finishedAt: t.finishedAt?.toISOString() || null,
      durationMs: t.startedAt && t.finishedAt
        ? t.finishedAt.getTime() - t.startedAt.getTime()
        : null,
    })),
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      agentUri: c.agentUri,
      taskId: c.taskId,
      checkpointType: c.checkpointType,
      cycleId: c.cycleId,
      createdAt: c.createdAt.toISOString(),
      state: JSON.parse(c.stateJson),
    })),
    traces: traces.map((t) => ({
      id: t.id,
      traceLabel: t.traceLabel,
      states: JSON.parse(t.statesJson),
      actions: JSON.parse(t.actionsJson),
      outcome: t.outcome,
      capturedAt: t.capturedAt.toISOString(),
    })),
    costs: {
      total: totalCost,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      entries: costs.map((c) => ({
        agentId: c.agentId,
        model: c.model,
        phase: c.phase,
        tokensIn: c.tokensIn,
        tokensOut: c.tokensOut,
        cost: c.cost,
        timestamp: c.timestamp.toISOString(),
      })),
    },
  })
}
