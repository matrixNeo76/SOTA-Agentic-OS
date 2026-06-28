/**
 * GET /api/memory/similarity — Embedding similarity viewer
 *
 * Query params:
 *   ?entityA=X    → first entity ID (SemanticEntity)
 *   ?entityB=Y    → second entity ID
 *
 * Returns cosine similarity between the two entities' embeddings.
 * If only entityA is provided, returns top-5 most similar entities.
 *
 * C6.15 — Embedding similarity viewer for debugging memory retrieval.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

function deserialize(arr: string): number[] {
  try {
    const parsed = JSON.parse(arr)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const entityAId = url.searchParams.get('entityA')
  const entityBId = url.searchParams.get('entityB')

  if (!entityAId) {
    // List all entities with embeddings for the dropdowns
    const entities = await db.semanticEntity.findMany({
      where: { embedding: { not: null } },
      select: { id: true, name: true, type: true },
      take: 100,
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ entities, total: entities.length })
  }

  const entityA = await db.semanticEntity.findUnique({
    where: { id: entityAId },
    select: { id: true, name: true, type: true, description: true, embedding: true },
  })
  if (!entityA) {
    return NextResponse.json({ error: `Entity not found: ${entityAId}` }, { status: 404 })
  }
  if (!entityA.embedding) {
    return NextResponse.json({ error: 'Entity has no embedding' }, { status: 400 })
  }

  const embeddingA = deserialize(entityA.embedding)

  // If entityB is provided, compute pairwise similarity
  if (entityBId) {
    const entityB = await db.semanticEntity.findUnique({
      where: { id: entityBId },
      select: { id: true, name: true, type: true, description: true, embedding: true },
    })
    if (!entityB) {
      return NextResponse.json({ error: `Entity not found: ${entityBId}` }, { status: 404 })
    }
    if (!entityB.embedding) {
      return NextResponse.json({ error: 'Entity B has no embedding' }, { status: 400 })
    }

    const embeddingB = deserialize(entityB.embedding)
    const similarity = cosine(embeddingA, embeddingB)

    return NextResponse.json({
      entityA: { id: entityA.id, name: entityA.name, type: entityA.type },
      entityB: { id: entityB.id, name: entityB.name, type: entityB.type },
      similarity,
      dimensions: embeddingA.length,
    })
  }

  // Otherwise, find top-5 most similar entities
  const allEntities = await db.semanticEntity.findMany({
    where: {
      id: { not: entityAId },
      embedding: { not: null },
    },
    select: { id: true, name: true, type: true, description: true, embedding: true },
    take: 500, // limit for performance
  })

  const scored = allEntities
    .map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
      similarity: cosine(embeddingA, deserialize(e.embedding || '[]')),
    }))
    .filter(s => s.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)

  return NextResponse.json({
    entityA: { id: entityA.id, name: entityA.name, type: entityA.type },
    topSimilar: scored,
    dimensions: embeddingA.length,
  })
}
