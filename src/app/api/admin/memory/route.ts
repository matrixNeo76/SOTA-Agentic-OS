/**
 * GET /api/admin/memory — Context Graph browser + memory stats
 * POST /api/admin/memory — Semantic search or GC trigger
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'
import { graphStats } from '@/lib/graph-age'
import { gcStats } from '@/lib/cognitive-gc/curator'
import { semanticMemorySearch } from '@/lib/memory-fabric/fabric'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const entityType = url.searchParams.get('entityType')
  const limit = parseInt(url.searchParams.get('limit') || '50', 10)

  if (entityType) {
    // Browse nodes by type
    const nodes = await db.graphNode.findMany({
      where: { entityType },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        uri: true,
        entityType: true,
        lifecycleState: true,
        attributes: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ nodes, entityType })
  }

  // Default: show stats
  const [gStats, memStats] = await Promise.all([
    graphStats(),
    gcStats(),
  ])

  return NextResponse.json({
    graph: gStats,
    memory: memStats,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  // Parse the body once and reuse. Calling req.json() twice throws because
  // the body stream is already consumed.
  const body = await req.json()
  const { action } = body

  if (action === 'search') {
    const { query, agentUri, topK } = body
    if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 })

    const results = await semanticMemorySearch(query, agentUri, topK || 10)
    return NextResponse.json({ results })
  }

  return NextResponse.json({ error: 'Unknown action. Use: search' }, { status: 400 })
}
