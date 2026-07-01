/**
 * POST /api/runs/manage — Run lifecycle management (tags, archive, delete, duplicate)
 *
 * C6.8 — New API for run-level management operations.
 *
 * Actions:
 *   - add-tag:     add a tag to a plan
 *   - remove-tag:  remove a tag from a plan
 *   - archive:     soft-archive a plan (archived=true, hidden from default list)
 *   - unarchive:   unarchive a plan
 *   - delete:      hard-delete a plan and all its tasks (cascade)
 *   - duplicate:   create a new plan with the same taskGoal (re-execute)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'
import { topologicalBatches } from '@/lib/kernel/scheduler'

const VALID_ACTIONS = ['add-tag', 'remove-tag', 'archive', 'unarchive', 'delete', 'duplicate'] as const
type ManageAction = (typeof VALID_ACTIONS)[number]

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { action, planId } = body as { action: string; planId?: string }

  if (!action || !VALID_ACTIONS.includes(action as ManageAction)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }
  if (!planId) {
    return NextResponse.json({ error: 'Missing planId' }, { status: 400 })
  }

  const plan = await db.agentPlan.findUnique({
    where: { id: planId },
    select: { id: true, taskGoal: true, status: true, tags: true, archived: true, planJson: true },
  })
  if (!plan) {
    return NextResponse.json({ error: `Plan not found: ${planId}` }, { status: 404 })
  }

  const manageAction = action as ManageAction

  // === Tag management ===
  if (manageAction === 'add-tag' || manageAction === 'remove-tag') {
    const { tag } = body as { tag?: string }
    if (!tag || !tag.trim()) {
      return NextResponse.json({ error: 'Missing tag' }, { status: 400 })
    }
    const cleanTag = tag.trim().toLowerCase().slice(0, 50)

    const currentTags: string[] = plan.tags ? JSON.parse(plan.tags) : []
    let newTags: string[]
    if (manageAction === 'add-tag') {
      if (currentTags.includes(cleanTag)) {
        return NextResponse.json({ ok: true, tags: currentTags, message: 'Tag already exists' })
      }
      newTags = [...currentTags, cleanTag]
    } else {
      newTags = currentTags.filter(t => t !== cleanTag)
      if (newTags.length === currentTags.length) {
        return NextResponse.json({ ok: true, tags: currentTags, message: 'Tag not found' })
      }
    }

    await db.agentPlan.update({
      where: { id: planId },
      data: { tags: JSON.stringify(newTags) },
    })

    return NextResponse.json({
      ok: true,
      planId,
      tags: newTags,
      action: manageAction,
    })
  }

  // === Archive / Unarchive ===
  if (manageAction === 'archive' || manageAction === 'unarchive') {
    const newArchived = manageAction === 'archive'
    if (plan.archived === newArchived) {
      return NextResponse.json({
        ok: true,
        planId,
        archived: newArchived,
        message: `Plan already ${newArchived ? 'archived' : 'active'}`,
      })
    }
    await db.agentPlan.update({
      where: { id: planId },
      data: { archived: newArchived },
    })
    return NextResponse.json({
      ok: true,
      planId,
      archived: newArchived,
      action: manageAction,
    })
  }

  // === Delete ===
  if (manageAction === 'delete') {
    // Prevent deleting running plans
    if (['running', 'scheduled', 'paused'].includes(plan.status)) {
      return NextResponse.json(
        { error: `Cannot delete plan in status '${plan.status}'. Abort it first.` },
        { status: 409 },
      )
    }
    // Cascade delete: PlanTask has onDelete: Cascade in schema
    await db.agentPlan.delete({ where: { id: planId } })
    return NextResponse.json({
      ok: true,
      planId,
      deleted: true,
      message: `Plan '${plan.taskGoal}' deleted permanently.`,
    })
  }

  // === Duplicate ===
  if (manageAction === 'duplicate') {
    const { execute = false } = body as { execute?: boolean }
    // Create a new plan with the same goal — LLM will regenerate the task breakdown
    // We don't copy the old tasks because the LLM may produce a different plan
    // (different context, different time). The user just wants to re-run the same goal.
    const newPlanId = `plan_${Date.now()}`
    const planData = JSON.parse(plan.planJson)
    const batches = topologicalBatches(planData.tasks || [])

    await db.agentPlan.create({
      data: {
        id: newPlanId,
        taskGoal: plan.taskGoal,
        planJson: plan.planJson, // reuse the same plan JSON
        dagJson: JSON.stringify(batches),
        status: 'scheduled',
        agentCount: planData.tasks ? new Set(planData.tasks.map((t: any) => t.agentId)).size : 0,
        tags: plan.tags, // copy tags
        tasks: {
          create: (planData.tasks || []).map((t: any) => ({
            taskId: t.taskId,
            agentId: t.agentId,
            description: t.description,
            dependencies: JSON.stringify(t.dependencies || []),
            status: 'pending',
          })),
        },
      },
    })

    return NextResponse.json({
      ok: true,
      planId: newPlanId,
      originalPlanId: planId,
      duplicated: true,
      message: `Plan duplicated as ${newPlanId}. ${execute ? 'Execution will start.' : 'Open it to execute.'}`,
    })
  }

  return NextResponse.json({ error: 'Unhandled action' }, { status: 500 })
}
