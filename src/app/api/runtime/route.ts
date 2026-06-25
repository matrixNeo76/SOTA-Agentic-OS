/**
 * GET /api/runtime
 *
 * Fase 1.1 — Espone i metadati del runtime DB:
 *   provider (sqlite | postgresql)
 *   extensions disponibili (pgvector, age)
 *   conteggi rapidi per sanity check
 *
 * Utile per il Cockpit e per debug in produzione.
 */

import { NextResponse } from 'next/server'
import { getProvider, hasPgvector, hasAge } from '@/lib/db-runtime'
import { db } from '@/lib/db'

export async function GET() {
  const provider = await getProvider()
  const pgvector = await hasPgvector()
  const age = await hasAge()

  let counts: Record<string, number | string> = {}
  try {
    const [nodes, edges, embeddings, memories] = await Promise.all([
      db.graphNode.count(),
      db.graphEdge.count(),
      db.embeddingVector.count(),
      db.memoryEntry.count(),
    ])
    counts = { graphNodes: nodes, graphEdges: edges, embeddings, memories }
  } catch (err) {
    counts = { error: String(err) }
  }

  return NextResponse.json({
    provider,
    extensions: {
      pgvector,
      age,
    },
    capabilities: {
      nativeVectorSearch: pgvector,
      cypherQueries: age,
      nativeVectorStorage: pgvector,
    },
    counts,
  })
}
