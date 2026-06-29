/**
 * GET /api/admin/governance — RedLines, NormativeRules, ApprovalGates, BlockedActions
 * POST /api/admin/governance — Manage governance rules
 *
 * C5 fix: tutte le POST ora scrivono in AuditLedgerEntry + AgentLog +
 * pubblicano WS event via publishAgentEvent. Prima l'admin poteva
 * approvare/rifiutare blocked actions, toggolare LTL rules, aggiungere
 * red lines senza lasciare traccia auditabile.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'
import { publishAgentEvent } from '@/lib/ws-publish'
import { logAuditEntry } from '@/lib/kernel/artificial-retainer'

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
    const VALID_CHOICES = ['approved', 'modified', 'downgraded', 'rejected']
    if (!VALID_CHOICES.includes(choice)) {
      return NextResponse.json({ error: `Invalid choice. Must be one of: ${VALID_CHOICES.join(', ')}` }, { status: 400 })
    }

    const existing = await db.blockedAction.findUnique({ where: { id: blockedActionId }, select: { id: true, status: true, agentId: true, action: true, source: true } })
    if (!existing) return NextResponse.json({ error: `Blocked action not found: ${blockedActionId}` }, { status: 404 })
    if (existing.status !== 'pending') {
      return NextResponse.json({ error: `Blocked action already resolved: ${existing.status}` }, { status: 409 })
    }

    const updated = await db.blockedAction.update({
      where: { id: blockedActionId },
      data: {
        status: choice,
        resolvedBy: auth.email,
        resolvedAt: new Date(),
        resolution: JSON.stringify({ reason, resolvedBy: auth.email }),
      },
    })

    // C5: audit + WS publish
    await logAuditEntry({
      agentId: existing.agentId,
      action: existing.action,
      decision: {
        source: 'admin_governance_api',
        intent: `resolve-blocked (${existing.source})`,
        gate: 'sovereign',
        outcome: choice,
        reason: reason || null,
        resolvedBy: auth.email,
      },
      readableNarrative: `L'admin ${auth.email} ha ${choice === 'approved' ? 'approvato' : choice === 'rejected' ? 'rifiutato' : choice === 'modified' ? 'modificato' : 'declassato'} l'azione bloccata "${existing.action}" dell'agente ${existing.agentId} (sorgente: ${existing.source}).${reason ? ` Motivo: ${reason}` : ''}`,
      reversible: choice !== 'rejected' && choice !== 'downgraded',
    })
    await db.agentLog.create({
      data: {
        agentId: existing.agentId,
        phase: '17',
        event: 'blocked_action_resolved',
        payload: JSON.stringify({ blockedActionId, choice, resolvedBy: auth.email, reason }),
        level: choice === 'rejected' ? 'warn' : 'info',
      },
    })
    await publishAgentEvent({
      agentId: existing.agentId, phase: '17',
      event: 'blocked_action_resolved',
      level: choice === 'rejected' ? 'warn' : 'info',
      payload: { blockedActionId, choice, resolvedBy: auth.email, action: existing.action },
    })

    return NextResponse.json({ resolved: true, action: updated })
  }

  if (action === 'resolve-approval') {
    const { gateId, choice } = body
    if (!gateId || !choice) {
      return NextResponse.json({ error: 'Missing gateId or choice' }, { status: 400 })
    }
    const VALID_CHOICES = ['approved', 'rejected', 'expired']
    if (!VALID_CHOICES.includes(choice)) {
      return NextResponse.json({ error: `Invalid choice. Must be one of: ${VALID_CHOICES.join(', ')}` }, { status: 400 })
    }

    const existing = await db.approvalGate.findUnique({ where: { id: gateId }, select: { id: true, status: true, agentId: true, action: true, reason: true } })
    if (!existing) return NextResponse.json({ error: `Approval gate not found: ${gateId}` }, { status: 404 })
    if (existing.status !== 'pending') {
      return NextResponse.json({ error: `Approval gate already resolved: ${existing.status}` }, { status: 409 })
    }

    const updated = await db.approvalGate.update({
      where: { id: gateId },
      data: {
        status: choice,
        decidedBy: auth.email,
        decidedAt: new Date(),
      },
    })

    // C5: audit + WS publish
    await logAuditEntry({
      agentId: existing.agentId,
      action: existing.action,
      decision: {
        source: 'admin_governance_api',
        intent: `resolve-approval (HITL gate)`,
        gate: 'hitl',
        outcome: choice,
        reason: existing.reason,
        decidedBy: auth.email,
      },
      readableNarrative: `L'admin ${auth.email} ha ${choice === 'approved' ? 'approvato' : choice === 'rejected' ? 'rifiutato' : 'lasciato scadere'} il gate di approvazione "${existing.action}" richiesto da ${existing.agentId}. Motivo richiesta: ${existing.reason}`,
      reversible: choice === 'rejected',
    })
    await db.agentLog.create({
      data: {
        agentId: existing.agentId,
        phase: '9',
        event: 'approval_resolved',
        payload: JSON.stringify({ gateId, choice, decidedBy: auth.email }),
        level: choice === 'rejected' ? 'warn' : 'info',
      },
    })
    await publishAgentEvent({
      agentId: existing.agentId, phase: '9',
      event: 'approval_resolved',
      level: choice === 'rejected' ? 'warn' : 'info',
      payload: { gateId, choice, decidedBy: auth.email, action: existing.action },
    })

    return NextResponse.json({ resolved: true, gate: updated })
  }

  if (action === 'toggle-ltl') {
    const { ruleId, active } = body
    if (!ruleId) return NextResponse.json({ error: 'Missing ruleId' }, { status: 400 })
    if (typeof active !== 'boolean') return NextResponse.json({ error: 'active must be boolean' }, { status: 400 })

    const existing = await db.lTLRule.findUnique({ where: { id: ruleId }, select: { id: true, active: true, ruleId: true, ltlFormula: true, severity: true } })
    if (!existing) return NextResponse.json({ error: `LTL rule not found: ${ruleId}` }, { status: 404 })

    await db.lTLRule.update({ where: { id: ruleId }, data: { active } })

    // C5: audit + WS publish
    await logAuditEntry({
      agentId: 'verifier',
      action: `LTL rule ${existing.ruleId} ${active ? 'activated' : 'deactivated'}`,
      decision: {
        source: 'admin_governance_api',
        intent: `toggle-ltl ${existing.ruleId}`,
        gate: 'ltl',
        outcome: active ? 'activated' : 'deactivated',
        toggledBy: auth.email,
        formula: existing.ltlFormula,
        severity: existing.severity,
      },
      readableNarrative: `L'admin ${auth.email} ha ${active ? 'attivato' : 'disattivato'} la regola LTL ${existing.ruleId} (${existing.ltlFormula}, severity=${existing.severity}).`,
      reversible: true,
    })
    await db.agentLog.create({
      data: {
        agentId: 'verifier',
        phase: '4',
        event: 'ltl_rule_toggled',
        payload: JSON.stringify({ ruleId: existing.ruleId, active, toggledBy: auth.email }),
        level: active ? 'info' : 'warn',
      },
    })
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'ltl_rule_toggled',
      level: active ? 'info' : 'warn',
      payload: { ruleId: existing.ruleId, active, toggledBy: auth.email },
    })

    return NextResponse.json({ toggled: true, ruleId, active, previousActive: existing.active })
  }

  if (action === 'add-redline') {
    const { description, rationale, severity } = body
    if (!description) return NextResponse.json({ error: 'Missing description' }, { status: 400 })

    const rl = await db.redLine.create({
      data: { description, rationale: rationale || '', severity: severity || 'strong' },
    })

    // C5: audit + WS publish
    await logAuditEntry({
      agentId: 'reflective',
      action: `Red Line added: ${description}`,
      decision: {
        source: 'admin_governance_api',
        intent: 'add-redline',
        gate: 'redline',
        outcome: 'created',
        addedBy: auth.email,
        redLineId: rl.id,
        severity: rl.severity,
      },
      readableNarrative: `L'admin ${auth.email} ha aggiunto una Red Line (severity=${rl.severity}): "${description}".${rationale ? ` Rationale: ${rationale}` : ''}`,
      reversible: true,
    })
    await db.agentLog.create({
      data: {
        agentId: 'reflective',
        phase: '5',
        event: 'redline_added',
        payload: JSON.stringify({ redLineId: rl.id, description, severity: rl.severity, addedBy: auth.email }),
        level: 'warn',
      },
    })
    await publishAgentEvent({
      agentId: 'reflective', phase: '5',
      event: 'redline_added',
      level: 'warn',
      payload: { redLineId: rl.id, description, severity: rl.severity, addedBy: auth.email },
    })

    return NextResponse.json({ created: true, redLine: rl })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
