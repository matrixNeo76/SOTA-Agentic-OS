/**
 * GET /api/memory/edges — List graph edges with filters
 *
 * Query params:
 *   ?relationType=X    → filter by relation type
 *   ?nodeId=X          → filter edges connected to a specific node (in or out)
 *   ?direction=out     → only outgoing edges from nodeId
 *   ?direction=in      → only incoming edges to nodeId
 *   ?limit=50&offset=0 → pagination
 *
 * C6.13 — New API for the Edge Browser in Memory & Knowledge view.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const relationType = url.searchParams.get('relationType')
  const nodeId = url.searchParams.get('nodeId')
  const direction = url.searchParams.get('direction') || 'both' // both|in|out
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)

  const where: any = {}
  if (relationType && relationType !== 'all') {
    where.relationType = relationType
  }
  if (nodeId) {
    if (direction === 'out') {
      where.fromNodeId = nodeId
    } else if (direction === 'in') {
      where.toNodeId = nodeId
    } else {
      where.OR = [{ fromNodeId: nodeId }, { toNodeId: nodeId }]
    }
  }

  const [edges, total] = await Promise.all([
    db.graphEdge.findMany({
      where,
      include: {
        fromNode: { select: { id: true, uri: true, entityType: true } },
        toNode: { select: { id: true, uri: true, entityType: true } },
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    db.graphEdge.count({ where }),
  ])

  // Get unique relation types for the filter dropdown
  const allRelationTypes = await db.graphEdge.findMany({
    select: { relationType: true },
    distinct: ['relationType'],
    take: 100,
  })

  return NextResponse.json({
    edges: edges.map(e => ({
      id: e.id,
      relationType: e.relationType,
      properties: e.properties ? safeParse(e.properties) : {},
      createdAt: e.createdAt.toISOString(),
      from: e.fromNode,
      to: e.toNode,
    })),
    total,
    hasMore: offset + edges.length < total,
    relationTypes: allRelationTypes.map(r => r.relationType).filter(Boolean).sort(),
  })
}

function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return s }
}
