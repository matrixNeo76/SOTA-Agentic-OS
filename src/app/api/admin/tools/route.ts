/**
 * GET /api/admin/tools — List all tools (builtin + registered + MCP external)
 * POST /api/admin/tools — Register/test a tool
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'
import { listBuiltinTools } from '@/lib/runtime/builtin-tools'
import { dispatchTool, getDefaultScopes } from '@/lib/runtime/tool-dispatcher'
import { mcpClientStats } from '@/lib/mcp-client/client'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const [builtin, registered, mcpStats] = await Promise.all([
    Promise.resolve(listBuiltinTools()),
    db.tool.findMany({ take: 50 }),
    mcpClientStats(),
  ])

  return NextResponse.json({
    builtin: builtin.map((t) => ({ ...t, type: 'builtin' })),
    registered: registered.map((t) => ({
      toolId: t.toolId,
      name: t.name,
      version: t.version,
      active: t.active,
      publisher: t.publisher,
      permissions: [] as string[], // permissions loaded via separate query if needed
      type: 'registered' as const,
    })),
    mcpExternal: mcpStats,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  // Parse the body once and reuse. Calling req.json() twice throws because
  // the body stream is already consumed.
  const body = await req.json()
  const { action } = body

  if (action === 'test') {
    const { toolName, args, agentId } = {
      toolName: body.toolName,
      args: body.args || {},
      agentId: body.agentId || 'admin',
    }
    if (!toolName) return NextResponse.json({ error: 'Missing toolName' }, { status: 400 })

    const result = await dispatchTool(
      { name: toolName, arguments: args },
      { agentId, planId: 'admin-test', taskId: 'admin-test', allowedScopes: getDefaultScopes(agentId) },
    )
    return NextResponse.json(result)
  }

  if (action === 'register') {
    const { toolId, name, version, description, publisher, transport, endpoint, apiKey } = body
    if (!toolId || !name) return NextResponse.json({ error: 'Missing toolId or name' }, { status: 400 })

    // Check for duplicate toolId first — db.tool.create throws P2002 on unique violation.
    const existing = await db.tool.findUnique({ where: { toolId }, select: { toolId: true } })
    if (existing) {
      return NextResponse.json({ error: `Tool with toolId '${toolId}' already exists` }, { status: 409 })
    }

    const tool = await db.tool.create({
      data: {
        toolId, name,
        version: version || '1.0.0',
        description, publisher,
        signature: 'admin-registered',
        active: true,
        installedBy: auth.email,
        // C2 — Campi per esecuzione tool esterni
        ...(transport && { transport }),
        ...(endpoint && { endpoint }),
        ...(apiKey && { apiKey }),
      },
    })
    return NextResponse.json({ registered: true, tool })
  }

  if (action === 'grant-scope') {
    const { toolId, scope } = body
    if (!toolId || !scope) return NextResponse.json({ error: 'Missing toolId or scope' }, { status: 400 })

    // Verify the tool exists — ToolPermission.toolId is a free string (not FK),
    // so we validate here to avoid orphan permissions.
    const toolExists = await db.tool.findUnique({ where: { toolId }, select: { toolId: true } })
    if (!toolExists) {
      return NextResponse.json({ error: `Tool not found: ${toolId}` }, { status: 404 })
    }

    const perm = await db.toolPermission.create({
      data: { toolId, scope, granted: true, grantedBy: auth.email },
    })
    return NextResponse.json({ granted: true, permission: perm })
  }

  return NextResponse.json({ error: 'Unknown action. Use: test, register, grant-scope' }, { status: 400 })
}
