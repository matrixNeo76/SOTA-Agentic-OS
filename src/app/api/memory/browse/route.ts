/**
 * GET /api/memory/browse — Unified memory browser + search
 *
 * Query params:
 *   ?view=graph        → list graph nodes (optional ?entityType=X & ?limit=50 & ?offset=0)
 *   ?view=memory       → list memory entries (optional ?layer=X & ?agentUri=X & ?limit=50 & ?offset=0)
 *   ?view=node&id=X    → graph node detail with incoming/outgoing edges
 *   ?view=search&q=X   → unified search across MemoryEntry + SemanticEntity + EpisodicMemory + GraphNode
 *
 * C6.12 — New unified browse API for the Memory & Knowledge view.
 * Replaces the fragmented approach of calling 3 different endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const view = url.searchParams.get('view') || 'graph'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)

  // === Graph node list ===
  if (view === 'graph') {
    const entityType = url.searchParams.get('entityType')
    const where: any = {}
    if (entityType && entityType !== 'all') {
      where.entityType = entityType
    }

    const [nodes, total] = await Promise.all([
      db.graphNode.findMany({
        where,
        select: {
          id: true,
          uri: true,
          entityType: true,
          lifecycleState: true,
          attributes: true,
          createdByAgent: true,
          confidence: true,
          createdAt: true,
          updatedAt: true,
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      db.graphNode.count({ where }),
    ])

    // Get edge counts per node
    const nodeIds = nodes.map(n => n.id)
    const edgeCounts = await db.graphEdge.groupBy({
      by: ['fromNodeId'],
      where: { fromNodeId: { in: nodeIds } },
      _count: true,
    })
    const incomingCounts = await db.graphEdge.groupBy({
      by: ['toNodeId'],
      where: { toNodeId: { in: nodeIds } },
      _count: true,
    })

    const outMap = new Map(edgeCounts.map(e => [e.fromNodeId, e._count]))
    const inMap = new Map(incomingCounts.map(e => [e.toNodeId, e._count]))

    return NextResponse.json({
      nodes: nodes.map(n => ({
        ...n,
        attributes: n.attributes ? safeParse(n.attributes) : {},
        outgoingEdges: outMap.get(n.id) || 0,
        incomingEdges: inMap.get(n.id) || 0,
      })),
      total,
      hasMore: offset + nodes.length < total,
    })
  }

  // === Memory entry list ===
  if (view === 'memory') {
    const layer = url.searchParams.get('layer')
    const agentUri = url.searchParams.get('agentUri')
    const where: any = {}
    if (layer && layer !== 'all') {
      where.layer = layer
    }
    if (agentUri && agentUri !== 'all') {
      where.agentUri = agentUri
    }

    const [entries, total, layers, agents] = await Promise.all([
      db.memoryEntry.findMany({
        where,
        select: {
          id: true,
          layer: true,
          agentUri: true,
          content: true,
          sourceUri: true,
          utilityScore: true,
          recencyScore: true,
          weight: true,
          accessCount: true,
          lastAccessedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      db.memoryEntry.count({ where }),
      db.memoryEntry.findMany({ select: { layer: true }, distinct: ['layer'] }),
      db.memoryEntry.findMany({ select: { agentUri: true }, distinct: ['agentUri'] }),
    ])

    return NextResponse.json({
      entries: entries.map(e => ({
        ...e,
        content: e.content.slice(0, 500), // truncate for list view
      })),
      total,
      hasMore: offset + entries.length < total,
      layers: layers.map(l => l.layer).filter(Boolean).sort(),
      agents: agents.map(a => a.agentUri).filter(Boolean).sort(),
    })
  }

  // === Node detail with edges ===
  if (view === 'node') {
    const nodeId = url.searchParams.get('id')
    if (!nodeId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const node = await db.graphNode.findUnique({
      where: { id: nodeId },
    })
    if (!node) {
      return NextResponse.json({ error: 'Node not found' }, { status: 404 })
    }

    // Get outgoing edges with target node info
    const outgoing = await db.graphEdge.findMany({
      where: { fromNodeId: nodeId },
      include: {
        toNode: {
          select: { id: true, uri: true, entityType: true, lifecycleState: true },
        },
      },
      take: 50,
    })

    // Get incoming edges with source node info
    const incoming = await db.graphEdge.findMany({
      where: { toNodeId: nodeId },
      include: {
        fromNode: {
          select: { id: true, uri: true, entityType: true, lifecycleState: true },
        },
      },
      take: 50,
    })

    return NextResponse.json({
      node: {
        ...node,
        attributes: node.attributes ? safeParse(node.attributes) : {},
      },
      outgoing: outgoing.map(e => ({
        id: e.id,
        relationType: e.relationType,
        properties: e.properties ? safeParse(e.properties) : {},
        target: e.toNode,
      })),
      incoming: incoming.map(e => ({
        id: e.id,
        relationType: e.relationType,
        properties: e.properties ? safeParse(e.properties) : {},
        source: e.fromNode,
      })),
    })
  }

  // === Unified search ===
  if (view === 'search') {
    const q = url.searchParams.get('q') || ''
    if (!q.trim()) {
      return NextResponse.json({ results: [], total: 0 })
    }

    // C6.12 — SQLite doesn't support mode: 'insensitive' (Postgres-only).
    // SQLite LIKE is case-insensitive for ASCII by default, so we use plain contains.
    const searchPattern = { contains: q }

    // Search across 4 tables in parallel
    const [memories, entities, episodes, graphNodes] = await Promise.all([
      // MemoryEntry: search in content
      db.memoryEntry.findMany({
        where: { content: searchPattern },
        select: {
          id: true, layer: true, agentUri: true, content: true,
          weight: true, createdAt: true,
        },
        take: 10,
        orderBy: { weight: 'desc' },
      }).catch(() => []),

      // SemanticEntity: search in name + description
      db.semanticEntity.findMany({
        where: {
          OR: [
            { name: searchPattern },
            { description: searchPattern },
          ],
        },
        select: {
          id: true, name: true, type: true, description: true, decay: true,
        },
        take: 10,
      }).catch(() => []),

      // EpisodicMemory: search in observation
      db.episodicMemory.findMany({
        where: { observation: searchPattern },
        select: {
          id: true, observation: true, source: true, agentId: true,
          timestamp: true, decay: true,
        },
        take: 10,
        orderBy: { timestamp: 'desc' },
      }).catch(() => []),

      // GraphNode: search in uri + attributes
      db.graphNode.findMany({
        where: {
          OR: [
            { uri: searchPattern },
            { attributes: searchPattern },
          ],
        },
        select: {
          id: true, uri: true, entityType: true, lifecycleState: true,
          attributes: true, createdAt: true,
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }).catch(() => []),
    ])

    // Normalize results into a unified format
    const results = [
      ...memories.map(m => ({
        source: 'memory' as const,
        id: m.id,
        title: m.content.slice(0, 80),
        description: m.content.slice(0, 200),
        meta: `layer: ${m.layer} · agent: ${m.agentUri} · weight: ${m.weight?.toFixed(2)}`,
        timestamp: m.createdAt?.toISOString(),
      })),
      ...entities.map(e => ({
        source: 'entity' as const,
        id: e.id,
        title: e.name,
        description: e.description || '',
        meta: `type: ${e.type} · decay: ${e.decay?.toFixed(2)}`,
        timestamp: null,
      })),
      ...episodes.map(ep => ({
        source: 'episode' as const,
        id: ep.id,
        title: ep.observation.slice(0, 80),
        description: ep.observation.slice(0, 200),
        meta: `source: ${ep.source || '—'} · agent: ${ep.agentId || '—'}`,
        timestamp: ep.timestamp?.toISOString(),
      })),
      ...graphNodes.map(gn => ({
        source: 'graph' as const,
        id: gn.id,
        title: gn.uri,
        description: gn.attributes ? safeParse(gn.attributes as string).title || gn.attributes.slice(0, 200) : '',
        meta: `type: ${gn.entityType} · state: ${gn.lifecycleState}`,
        timestamp: gn.createdAt?.toISOString(),
      })),
    ]

    return NextResponse.json({
      results,
      total: results.length,
      breakdown: {
        memory: memories.length,
        entity: entities.length,
        episode: episodes.length,
        graph: graphNodes.length,
      },
    })
  }

  return NextResponse.json({ error: 'Unknown view. Use: graph, memory, node, search' }, { status: 400 })
}

function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return s }
}
