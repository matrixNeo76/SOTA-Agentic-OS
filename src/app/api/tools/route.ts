/**
 * API: /api/tools (Fase 18 - Tool Ecosystem)
 * GET  - elenca tool installati
 * POST - installa nuovo tool
 * DELETE - revoca tool
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  installTool, revokeTool, setPermission, listTools, toolStats, BUILTIN_TOOLS,
} from '@/lib/kernel/tool-registry'
import { publishAgentEvent } from '@/lib/ws-publish'

export async function GET(req: NextRequest) {
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
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'install') {
    const { toolId, name, version, description, publisher, installedBy, defaultPermissions } = body
    if (!toolId || !name || !version) {
      return NextResponse.json({ ok: false, error: 'toolId, name, version obbligatori' }, { status: 400 })
    }
    try {
      const result = await installTool({ toolId, name, version, description, publisher }, installedBy || 'admin')
      // Applica permessi di default se specificati
      if (defaultPermissions && Array.isArray(defaultPermissions)) {
        for (const scope of defaultPermissions) {
          await setPermission(toolId, scope, true, installedBy || 'admin')
        }
      }
      await publishAgentEvent({
        agentId: 'tool-registry', phase: '18',
        event: 'tool_installed',
        payload: { toolId, name, version, signature: result.signature },
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
        payload: { toolId, reason },
      })
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'set_permission') {
    const { toolId, scope, granted, grantedBy, constraint } = body
    try {
      await setPermission(toolId, scope, granted, grantedBy || 'admin', constraint)
      await publishAgentEvent({
        agentId: 'tool-registry', phase: '18',
        event: 'permission_changed',
        payload: { toolId, scope, granted },
      })
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
  }

  if (action === 'check_permission') {
    const { toolId, scope } = body
    const { checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const result = await checkToolPermission(toolId, scope)
    return NextResponse.json(result)
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
