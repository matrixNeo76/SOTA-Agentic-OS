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

  try {
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
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to list tools', detail: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  try {
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

      // B2 — KNOWN ISSUE: apiKey è stored in plaintext nel DB. La cifratura
      // richiede un secret manager (HashiCorp Vault, AWS KMS, Doppler, etc.)
      // che non è attualmente disponibile in fase di bootstrapping.
      // Tracciato come debt tecnico: implementare encryption at-rest per
      // apiKey + endpoint secrets prima della produzione.
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

      // C1 — Lookup tool per toolId (user-facing) per ottenere tool.id (cuid interno).
      // ToolPermission.toolId DEVE essere tool.id (cuid interno), non toolId (user-facing string).
      // Questo standardizza il key usato da:
      //   - installTool() → tool.id
      //   - admin/tools grant-scope → tool.id (questo fix)
      //   - checkToolPermission() → tool.id (lookup interno)
      const tool = await db.tool.findUnique({
        where: { toolId },
        select: { id: true, toolId: true, name: true },
      })
      if (!tool) {
        return NextResponse.json({ error: `Tool not found: ${toolId}` }, { status: 404 })
      }

      // Upsert: se il permesso esiste già per questo (tool.id, scope), aggiorna;
      // altrimenti crea. Evita duplicati su grant multipli.
      const existing = await db.toolPermission.findFirst({
        where: { toolId: tool.id, scope },
      })
      let perm
      if (existing) {
        perm = await db.toolPermission.update({
          where: { id: existing.id },
          data: { granted: true, grantedBy: auth.email },
        })
      } else {
        perm = await db.toolPermission.create({
          data: { toolId: tool.id, scope, granted: true, grantedBy: auth.email },
        })
      }
      return NextResponse.json({ granted: true, permission: perm, toolId: tool.toolId, toolName: tool.name })
    }

    return NextResponse.json({ error: 'Unknown action. Use: test, register, grant-scope' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to execute admin tool action', detail: err.message },
      { status: 500 },
    )
  }
}
