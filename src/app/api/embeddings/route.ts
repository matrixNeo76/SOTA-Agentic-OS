/**
 * API: /api/embeddings
 * GET  - dimensione embedding + statistiche
 * POST - ricalcola embeddings di tutti i record esistenti (migration)
 */
import { NextResponse } from 'next/server'
import { EMBED_DIM, recomputeAllEmbeddings } from '@/lib/embeddings'
import { db } from '@/lib/db'

export async function GET() {
  const [eps, ents, heurs] = await Promise.all([
    db.episodicMemory.count(),
    db.semanticEntity.count(),
    db.heuristic.count(),
  ])
  return NextResponse.json({
    dim: EMBED_DIM,
    counts: { episodes: eps, entities: ents, heuristics: heurs },
    model: 'tfidf-semantic-v2',
  })
}

export async function POST() {
  const result = await recomputeAllEmbeddings()
  return NextResponse.json({ ok: true, ...result })
}
