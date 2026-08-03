/**
 * API: /api/mcp-client — External MCP server connections (Fase 4 Track 4.2)
 *
 * GET    — list connections (with stats)
 * POST   action='register'    — register new MCP connection
 * POST   action='handshake'   — initialize handshake
 * POST   action='discover'    — refresh tool list
 * POST   action='execute'     — execute external tool
 * POST   action='trust'       — mark connection as trusted (ECDSA verified)
 * POST   action='delete'      — remove connection
 * POST   action='get'         — get connection details + cached tools
 * POST   action='toggle-tool' — enable/disable a specific external tool
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  registerConnection,
  listConnections,
  handshake,
  discoverTools,
  executeExternalTool,
  trustConnection,
  deleteConnection,
  getConnectionStats,
} from '@/lib/kernel/mcp-client'
import { verifySession } from '@/lib/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getContext(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) return { tenantId: 'default', userId: 'anonymous' }
  const session = await verifySession(token)
  if (!session) return { tenantId: 'default', userId: 'anonymous' }
  return { tenantId: session.tenantId, userId: session.userId }
}

export async function GET(req: NextRequest) {
  const { tenantId } = await getContext(req)
  const [connections, stats] = await Promise.all([
    listConnections(tenantId),
    getConnectionStats(tenantId),
  ])
  return NextResponse.json({ connections, stats })
}

export async function POST(req: NextRequest) {
  const { tenantId, userId } = await getContext(req)
  const body = await req.json()
  const { action } = body

  // === Register ===
  if (action === 'register') {
    try {
      const conn = await registerConnection({
        name: body.name,
        endpoint: body.endpoint,
        protocol: body.protocol || 'jsonrpc',
        authType: body.authType || 'none',
        authToken: body.authToken,
        publisherFingerprint: body.publisherFingerprint,
        tenantId,
        createdBy: userId,
      })
      return NextResponse.json({ ok: true, connectionId: conn.id })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Handshake ===
  if (action === 'handshake') {
    try {
      const result = await handshake(body.connectionId)
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Discover tools ===
  if (action === 'discover') {
    try {
      const result = await discoverTools(body.connectionId)
      return NextResponse.json({ ok: true, discovered: result.discovered, tools: result.tools })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Execute external tool ===
  if (action === 'execute') {
    try {
      const result = await executeExternalTool(
        body.connectionId,
        body.toolName,
        body.arguments || {},
        {
          triggeredBy: body.triggeredBy || 'user',
          agentId: body.agentId,
          skillId: body.skillId,
          timeoutMs: body.timeoutMs,
        }
      )
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Trust connection ===
  if (action === 'trust') {
    try {
      const result = await trustConnection(body.connectionId, userId)
      return NextResponse.json({ ok: true, trustedAt: result.trustedAt })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Delete connection ===
  if (action === 'delete') {
    try {
      await deleteConnection(body.connectionId, tenantId)
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Get connection details + cached tools ===
  if (action === 'get') {
    const conn = await db.mcpConnection.findFirst({
      where: { id: body.connectionId, tenantId },
      include: {
        externalTools: { orderBy: { toolName: 'asc' } },
      },
    })
    if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const recentExecutions = await db.toolExecutionLog.findMany({
      where: { connectionId: body.connectionId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return NextResponse.json({
      connection: {
        ...conn,
        capabilities: JSON.parse(conn.capabilities),
        serverInfo: JSON.parse(conn.serverInfo),
        externalTools: conn.externalTools.map(t => ({
          ...t,
          inputSchema: JSON.parse(t.inputSchema),
        })),
      },
      recentExecutions,
    })
  }

  // === Toggle tool enabled ===
  if (action === 'toggle-tool') {
    const { toolId, enabled } = body
    const result = await db.externalTool.updateMany({
      where: { id: toolId, tenantId },
      data: { enabled: enabled !== undefined ? enabled : true },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}
