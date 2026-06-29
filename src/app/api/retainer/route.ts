/**
 * API: /api/retainer (Fase 9 - Artificial Retainer)
 * GET  - delegations + gates + audit ledger + normative resolutions + stats (requireAuth)
 * POST - grant/revoke delegation, request/resolve approval, resolve normative conflict (requireAdmin)
 *
 * C4 fix: prima tutte le POST usavano requireAuth, permettendo a qualsiasi
 * utente autenticato di concedersi deleghe, risolvere gates HITL al posto
 * dell'admin, e risolvere conflitti normativi. Ora tutte le POST richiedono
 * ruolo admin/operator.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  grantDelegation, revokeDelegation, checkAuthority, listDelegations,
  requestApproval, resolveApproval, listPendingGates, listRecentGates,
  resolveNormativeConflict, listNormativeResolutions,
  listAuditLedger, retainerStats, type NormativeConflict,
} from '@/lib/kernel/artificial-retainer'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'

  if (action === 'delegations') {
    const agentId = searchParams.get('agentId') || undefined
    const delegations = await listDelegations(agentId)
    return NextResponse.json({ delegations })
  }

  if (action === 'gates_pending') {
    const agentId = searchParams.get('agentId') || undefined
    const gates = await listPendingGates(agentId)
    return NextResponse.json({ gates })
  }

  if (action === 'gates_recent') {
    const agentId = searchParams.get('agentId') || undefined
    const gates = await listRecentGates(agentId, 30)
    return NextResponse.json({ gates })
  }

  if (action === 'audit') {
    const agentId = searchParams.get('agentId') || undefined
    const entries = await listAuditLedger(50, agentId)
    return NextResponse.json({ entries })
  }

  if (action === 'normative') {
    const resolutions = await listNormativeResolutions(20)
    return NextResponse.json({ resolutions })
  }

  if (action === 'stats') {
    const stats = await retainerStats()
    return NextResponse.json(stats)
  }

  if (action === 'check_authority') {
    const agentId = searchParams.get('agentId') || ''
    const scope = searchParams.get('scope') || ''
    const result = await checkAuthority(agentId, scope)
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'grant_delegation') {
    const { agentId, scope, constraints, grantedBy, expiresAt } = body
    // Use authenticated email if grantedBy not specified (audit trail integrity)
    const granter = grantedBy || auth.email
    const delegationId = await grantDelegation(agentId, scope, constraints || {}, granter, expiresAt ? new Date(expiresAt) : undefined)
    await publishAgentEvent({
      agentId, phase: '9',
      event: 'delegation_granted',
      payload: { scope, delegationId, grantedBy: granter },
    })
    return NextResponse.json({ ok: true, delegationId })
  }

  if (action === 'revoke_delegation') {
    const { delegationId, revokeReason } = body
    await revokeDelegation(delegationId, revokeReason || `revoked by ${auth.email}`)
    await publishAgentEvent({
      agentId: 'system', phase: '9',
      event: 'delegation_revoked',
      payload: { delegationId, revokedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'request_approval') {
    const { agentId, gateAction, payload, reason, expiresAt } = body
    const result = await requestApproval(agentId, gateAction || 'unspecified_action', payload, reason, expiresAt ? new Date(expiresAt) : undefined)
    await publishAgentEvent({
      agentId, phase: '9',
      event: 'approval_requested',
      level: 'warn',
      payload: { gateId: result.gateId, action: gateAction, requestedBy: auth.email },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'resolve_approval') {
    const { gateId, decision, decidedBy, axiomTrail } = body
    try {
      // Use authenticated email if decidedBy not specified
      const decider = decidedBy || auth.email
      const result = await resolveApproval(gateId, decision, decider, axiomTrail)
      await publishAgentEvent({
        agentId: 'system', phase: '9',
        event: 'approval_resolved',
        payload: { gateId, decision, decidedBy: decider },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'resolve_normative') {
    const conflict: NormativeConflict = body.conflict
    const result = await resolveNormativeConflict(conflict)
    await publishAgentEvent({
      agentId: 'system', phase: '9',
      event: 'normative_resolved',
      level: result.verdict === 'block' ? 'warn' : 'info',
      payload: { verdict: result.verdict, conflictType: conflict.userLevel + '_vs_' + conflict.systemLevel, resolvedBy: auth.email },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
