/**
 * API: /api/tools (Fase 18 - Tool Ecosystem)
 * GET  - elenca tool installati (qualsiasi ruolo autenticato)
 * POST - installa/revoca/set_permission (admin-only, C3)
 *       check_permission (qualsiasi ruolo autenticato, read-only)
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  installTool, revokeTool, setPermission, listTools, toolStats, BUILTIN_TOOLS,
} from '@/lib/kernel/tool-registry'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') || 'list'

    if (action === 'stats') {
      const stats = await toolStats()
      return NextResponse.json(stats)
    }

    if (action === 'builtin') {
      return NextResponse.json({ tools: BUILTIN_TOOLS })
    }

    // default: list
    const includeRevoked = searchParams.get('includeRevoked') === 'true'
    const tools = await listTools(includeRevoked)
    return NextResponse.json({ tools })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to list tools', detail: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // C3 — Body parsing richiede requireAuth (per leggere il body una volta),
  // poi requireAdmin separato per azioni mutative.
  // Azioni mutative (install, revoke, set_permission): admin-only.
  // Azione read-only (check_permission): qualsiasi ruolo autenticato.
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  let body
  try {
    body = await req.json()
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body', detail: err.message }, { status: 400 })
  }
  const { action } = body

  // check_permission è read-only: qualsiasi utente autenticato può verificarlo
  // (necessario per gli agenti che devono sapere se un tool è invocabile).
  if (action === 'check_permission') {
    const { toolId, scope } = body
    try {
      const { checkToolPermission } = await import('@/lib/kernel/tool-registry')
      const result = await checkToolPermission(toolId, scope)
      return NextResponse.json(result)
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 })
    }
  }

  // Tutte le altre azioni (install, revoke, set_permission) sono mutative:
  // C3 — viewer/sovereign non possono installare/revocare/modificare permessi.
  const admin = await requireAdmin(req)
  if (!admin.ok) return admin.response
  const actor = admin.email

  if (action === 'install') {
    const { toolId, name, version, description, publisher, installedBy, defaultPermissions } = body
    if (!toolId || !name || !version) {
      return NextResponse.json({ ok: false, error: 'toolId, name, version obbligatori' }, { status: 400 })
    }
    try {
      const result = await installTool({ toolId, name, version, description, publisher }, installedBy || actor)
      // Applica permessi di default se specificati
      if (defaultPermissions && Array.isArray(defaultPermissions)) {
        for (const scope of defaultPermissions) {
          await setPermission(toolId, scope, true, installedBy || actor)
        }
      }
      await publishAgentEvent({
        agentId: 'tool-registry', phase: '18',
        event: 'tool_installed',
        payload: { toolId, name, version, signature: result.signature, actor },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'revoke') {
    const { toolId, reason } = body
    try {
      await revokeTool(toolId, reason || 'revoked by admin')
      await publishAgentEvent({
        agentId: 'tool-registry', phase: '18',
        event: 'tool_revoked',
        level: 'warn',
        payload: { toolId, reason, actor },
      })
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'set_permission') {
    const { toolId, scope, granted, grantedBy, constraint } = body
    try {
      await setPermission(toolId, scope, granted, grantedBy || actor, constraint)
      await publishAgentEvent({
        agentId: 'tool-registry', phase: '18',
        event: 'permission_changed',
        payload: { toolId, scope, granted, actor },
      })
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
