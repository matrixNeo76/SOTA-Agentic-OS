/**
 * API: /api/blocked-actions (Fase 17 - Sovereign Validator)
 *
 * C4 fix: GET (pending/recent/stats) richiede requireAuth (lettura).
 * POST (register/resolve) richiede requireAdmin perché:
 *  - register può creare blocked action arbitrarie (potenziale DoS audit log)
 *  - resolve sblocca azioni che i cancelli di sicurezza avevano bloccato
 *    → operazione amministrativa che bypassa LTL/Taint/Normative gates.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  registerBlockedAction, resolveBlockedAction,
  listPendingBlocked, listRecentBlocked, blockedStats,
  type BlockedActionInput, type ResolutionChoice,
} from '@/lib/kernel/sovereign-translator'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'pending'

  if (action === 'pending') {
    const items = await listPendingBlocked(20)
    return NextResponse.json({ items })
  }

  if (action === 'recent') {
    const items = await listRecentBlocked(30)
    return NextResponse.json({ items })
  }

  if (action === 'stats') {
    const stats = await blockedStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'register') {
    const input: BlockedActionInput = body.input
    const result = await registerBlockedAction(input)
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'resolve') {
    const { blockedId, choice, resolvedBy, resolutionDetails } = body
    const result = await resolveBlockedAction(
      blockedId,
      choice as ResolutionChoice,
      resolvedBy || auth.email,
      resolutionDetails
    )
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
