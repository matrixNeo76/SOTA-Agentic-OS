/**
 * GET /api/admin/governance — RedLines, NormativeRules, ApprovalGates, BlockedActions
 * POST /api/admin/governance — Manage governance rules
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const [redLines, normativeRules, approvalGates, blockedActions, ltlRules] = await Promise.all([
    db.redLine.findMany({ take: 20, orderBy: { createdAt: 'desc' } }),
    db.normativeRule.findMany({ take: 20, orderBy: { createdAt: 'desc' } }),
    db.approvalGate.findMany({ where: { status: 'pending' }, take: 20, orderBy: { createdAt: 'desc' } }),
    db.blockedAction.findMany({ where: { status: 'pending' }, take: 20, orderBy: { createdAt: 'desc' } }),
    db.lTLRule.findMany({ where: { active: true }, take: 20 }),
  ])

  return NextResponse.json({
    redLines: redLines.map((r) => ({
      id: r.id,
      description: r.description,
      rationale: r.rationale,
      severity: r.severity,
      active: r.active,
    })),
    normativeRules: normativeRules.map((r) => ({
      id: r.id,
      axiom: r.axiom,
      priority: r.priority,
      active: r.active,
    })),
    approvalGates: approvalGates.map((g) => ({
      id: g.id,
      agentId: g.agentId,
      action: g.action,
      reason: g.reason,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      expiresAt: g.expiresAt?.toISOString(),
    })),
    blockedActions: blockedActions.map((b) => ({
      id: b.id,
      agentId: b.agentId,
      action: b.action,
      source: b.source,
      readableExplanation: b.readableExplanation,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    })),
    ltlRules: ltlRules.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      ltlFormula: r.ltlFormula,
      severity: r.severity,
      active: r.active,
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { action } = body

  if (action === 'resolve-blocked') {
    const { blockedActionId, choice, reason } = body
    if (!blockedActionId || !choice) {
      return NextResponse.json({ error: 'Missing blockedActionId or choice' }, { status: 400 })
    }

    const updated = await db.blockedAction.update({
      where: { id: blockedActionId },
      data: {
        status: choice, // approved | modified | downgraded | rejected
        resolvedBy: auth.email,
        resolvedAt: new Date(),
        resolution: JSON.stringify({ reason }),
      },
    })
    return NextResponse.json({ resolved: true, action: updated })
  }

  if (action === 'resolve-approval') {
    const { gateId, choice } = body
    if (!gateId || !choice) {
      return NextResponse.json({ error: 'Missing gateId or choice' }, { status: 400 })
    }

    const updated = await db.approvalGate.update({
      where: { id: gateId },
      data: {
        status: choice, // approved | rejected | expired
        decidedBy: auth.email,
        decidedAt: new Date(),
      },
    })
    return NextResponse.json({ resolved: true, gate: updated })
  }

  if (action === 'toggle-ltl') {
    const { ruleId, active } = body
    if (!ruleId) return NextResponse.json({ error: 'Missing ruleId' }, { status: 400 })

    await db.lTLRule.update({ where: { id: ruleId }, data: { active } })
    return NextResponse.json({ toggled: true })
  }

  if (action === 'add-redline') {
    const { description, rationale, severity } = body
    if (!description) return NextResponse.json({ error: 'Missing description' }, { status: 400 })

    const rl = await db.redLine.create({
      data: { description, rationale: rationale || '', severity: severity || 'strong' },
    })
    return NextResponse.json({ created: true, redLine: rl })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
