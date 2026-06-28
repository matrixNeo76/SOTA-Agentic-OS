/**
 * GET  /api/memory/rules — List all logical rules
 * POST /api/memory/rules — Create/update/delete a logical rule
 *
 * C6.14 — Logical rule editor API for the Memory & Knowledge view.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const rules = await db.logicalRule.findMany({
    orderBy: { priority: 'asc' },
  })

  return NextResponse.json({
    rules: rules.map(r => ({
      ...r,
      dependencies: r.dependencies ? JSON.parse(r.dependencies) : [],
    })),
    total: rules.length,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const { ruleId, expression, dependencies, priority, active } = body
    if (!ruleId || !expression) {
      return NextResponse.json({ error: 'Missing ruleId or expression' }, { status: 400 })
    }

    const existing = await db.logicalRule.findUnique({ where: { ruleId } })
    if (existing) {
      return NextResponse.json({ error: `Rule '${ruleId}' already exists` }, { status: 409 })
    }

    const rule = await db.logicalRule.create({
      data: {
        ruleId,
        expression,
        dependencies: JSON.stringify(dependencies || []),
        priority: priority ?? 0,
        active: active ?? true,
      },
    })

    return NextResponse.json({
      created: true,
      rule: { ...rule, dependencies: JSON.parse(rule.dependencies) },
    })
  }

  if (action === 'update') {
    const { id, ruleId, expression, dependencies, priority, active } = body
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const existing = await db.logicalRule.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const rule = await db.logicalRule.update({
      where: { id },
      data: {
        ...(ruleId !== undefined && { ruleId }),
        ...(expression !== undefined && { expression }),
        ...(dependencies !== undefined && { dependencies: JSON.stringify(dependencies) }),
        ...(priority !== undefined && { priority }),
        ...(active !== undefined && { active }),
      },
    })

    return NextResponse.json({
      updated: true,
      rule: { ...rule, dependencies: JSON.parse(rule.dependencies) },
    })
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const existing = await db.logicalRule.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    await db.logicalRule.delete({ where: { id } })
    return NextResponse.json({ deleted: true, id })
  }

  if (action === 'toggle') {
    const { id } = body
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const existing = await db.logicalRule.findUnique({ where: { id }, select: { id: true, active: true } })
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    await db.logicalRule.update({ where: { id }, data: { active: !existing.active } })
    return NextResponse.json({ toggled: true, id, active: !existing.active })
  }

  return NextResponse.json({ error: 'Unknown action. Use: create, update, delete, toggle' }, { status: 400 })
}
