/**
 * GET /api/agent-lifecycle/detail?uri=agent://xxx — Full agent detail
 *
 * Returns:
 *   - Agent node (lifecycle state, attributes, version)
 *   - Mesh info (tier, parent, children, peers, delegates, escalations)
 *   - Metrics (task count, success rate, cost, last activity)
 *   - Lifecycle history
 *   - Capabilities, skills, policies
 *
 * C6.17 — New API for the Agent Detail view.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'
import { getMeshTopology } from '@/lib/agent-mesh/topology'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const uri = new URL(req.url).searchParams.get('uri')
  if (!uri) {
    return NextResponse.json({ error: 'Missing uri' }, { status: 400 })
  }

  // === Get agent node from GraphNode ===
  const agentNode = await db.graphNode.findUnique({
    where: { uri },
  })
  if (!agentNode) {
    return NextResponse.json({ error: `Agent not found: ${uri}` }, { status: 404 })
  }

  // Parse attributes
  const attrs = agentNode.attributes ? JSON.parse(agentNode.attributes) : {}

  // === Get mesh topology to find this agent's relationships ===
  const topology = await getMeshTopology()
  const meshNode = topology.nodes.find(n => n.agentUri === uri)

  // Find edges connected to this agent
  const connectedEdges = topology.edges.filter(e => e.from === uri || e.to === uri)

  // === Get metrics from AgentLog ===
  const [totalLogs, errorLogs, warnLogs, lastActivity] = await Promise.all([
    db.agentLog.count({ where: { agentId: uri } }),
    db.agentLog.count({ where: { agentId: uri, level: 'error' } }),
    db.agentLog.count({ where: { agentId: uri, level: 'warn' } }),
    db.agentLog.findFirst({
      where: { agentId: uri },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, event: true, phase: true },
    }),
  ])

  // === Get cost from CostEntry ===
  const costEntries = await db.costEntry.findMany({
    where: { agentId: uri.replace('agent://', '') },
    select: { cost: true, tokensIn: true, tokensOut: true },
    take: 1000,
  })
  const totalCost = costEntries.reduce((s, c) => s + c.cost, 0)
  const totalTokensIn = costEntries.reduce((s, c) => s + c.tokensIn, 0)
  const totalTokensOut = costEntries.reduce((s, c) => s + c.tokensOut, 0)

  // === Get tasks from PlanTask ===
  const tasks = await db.planTask.findMany({
    where: { agentId: uri.replace('agent://', '') },
    select: { status: true },
    take: 1000,
  })
  const taskCount = tasks.length
  const tasksDone = tasks.filter(t => t.status === 'done').length
  const tasksFailed = tasks.filter(t => t.status === 'failed').length
  const successRate = taskCount > 0 ? tasksDone / taskCount : 0

  // === Lifecycle history from attributes ===
  const lifecycleHistory = attrs._lifecycleHistory || []

  // === Build response ===
  return NextResponse.json({
    agent: {
      uri: agentNode.uri,
      entityType: agentNode.entityType,
      lifecycleState: agentNode.lifecycleState,
      confidence: agentNode.confidence,
      createdByAgent: agentNode.createdByAgent,
      createdAt: agentNode.createdAt.toISOString(),
      updatedAt: agentNode.updatedAt.toISOString(),
      version: agentNode.version,
      // Parsed attributes
      name: attrs.name || uri.replace('agent://', ''),
      role: attrs.role,
      description: attrs.description,
      agentVersion: attrs.version,
      capabilities: attrs.capabilities || [],
      skills: attrs.skills || [],
      policies: attrs.policies || [],
      roles: attrs.roles || [],
      currentVersionUri: attrs.currentVersionUri,
      lifecycleHistory,
    },
    mesh: meshNode ? {
      tier: meshNode.tier,
      parentAgentUri: meshNode.parentAgentUri || null,
      childAgentUris: meshNode.childAgentUris || [],
      peerAgentUris: meshNode.peerAgentUris || [],
      delegates: meshNode.delegates || [],
      escalations: meshNode.escalations || [],
      reportsTo: meshNode.reportsTo || null,
    } : null,
    edges: connectedEdges.map(e => ({
      from: e.from,
      to: e.to,
      relation: e.relation,
      direction: e.from === uri ? 'outgoing' : 'incoming',
    })),
    metrics: {
      totalLogs,
      errorLogs,
      warnLogs,
      lastActivity: lastActivity ? {
        timestamp: lastActivity.timestamp.toISOString(),
        event: lastActivity.event,
        phase: lastActivity.phase,
      } : null,
      totalCost,
      totalTokensIn,
      totalTokensOut,
      totalCalls: costEntries.length,
      taskCount,
      tasksDone,
      tasksFailed,
      successRate,
    },
  })
}
