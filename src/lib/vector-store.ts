/**
 * vector-store.ts — Fase 1.1 / 1.4 / 1.5
 *
 * Façade unificata per la scrittura/lettura di embeddings.
 * Astrae la differenza SQLite (JSON-string) vs PostgreSQL (pgvector nativo).
 *
 * Usato da:
 *   - src/lib/graphrag/engine.ts       (vector search seed)
 *   - src/lib/memory-fabric/fabric.ts  (semantic memory search)
 *   - src/app/api/embeddings/route.ts  (recompute endpoint)
 *   - qualsiasi modulo che vuole persistere un embedding
 */

import { db } from '@/lib/db'
import { vectorSearch, upsertEmbedding, hasPgvector, cosineSimilarity } from '@/lib/db-runtime'

export interface VectorRecord {
  uri: string
  entityType: string
  embedding: number[]
  model: string
  dimensions: number
}

// === Write ===========================================================

export async function storeEmbedding(params: {
  entityUri: string
  entityType: string
  embedding: number[]
  model?: string
}): Promise<void> {
  await upsertEmbedding({
    entityUri: params.entityUri,
    entityType: params.entityType,
    embedding: params.embedding,
    model: params.model,
    dimensions: params.embedding.length,
  })
}

/**
 * Batch upsert — ottimizzato per il recompute di tutti gli embeddings.
 * Su Postgres usa una singola transazione; su SQLite itera.
 */
export async function storeEmbeddingsBatch(
  records: Array<{
    entityUri: string
    entityType: string
    embedding: number[]
    model?: string
  }>,
): Promise<{ stored: number }> {
  if (records.length === 0) return { stored: 0 }

  for (const r of records) {
    await storeEmbedding(r)
  }
  return { stored: records.length }
}

// === Read ============================================================

export async function getEmbedding(entityUri: string): Promise<number[] | null> {
  if (await hasPgvector()) {
    const rows = await db.$queryRawUnsafe<Array<{ embedding: string }>>(
      `SELECT embedding::text FROM "EmbeddingVector" WHERE "entityUri" = $1`,
      entityUri,
    )
    if (rows.length === 0) return null
    // pgvector ritorna "[0.1,0.2,...]" come text
    return parsePgvectorString(rows[0]!.embedding)
  }

  const rec = await db.embeddingVector.findUnique({ where: { entityUri } })
  if (!rec) return null
  return JSON.parse(rec.embedding) as number[]
}

export async function listEmbeddings(entityType?: string): Promise<VectorRecord[]> {
  if (await hasPgvector()) {
    // Path Postgres: query raw che restituisce embedding come text.
    // Usiamo $queryRawUnsafe con parametri espliciti per gestire il filtro condizionale.
    const sql = entityType
      ? `SELECT "entityUri", "entityType", embedding::text AS embedding, model, dimensions
         FROM "EmbeddingVector" WHERE "entityType" = $1`
      : `SELECT "entityUri", "entityType", embedding::text AS embedding, model, dimensions
         FROM "EmbeddingVector"`
    const params = entityType ? [entityType] : []
    const rows = await db.$queryRawUnsafe<Array<{
      entityUri: string
      entityType: string
      embedding: string
      model: string
      dimensions: number
    }>>(sql, ...params)

    return rows.map((r) => ({
      uri: r.entityUri,
      entityType: r.entityType,
      embedding: parsePgvectorString(r.embedding),
      model: r.model,
      dimensions: r.dimensions,
    }))
  }

  const recs = await db.embeddingVector.findMany({
    where: entityType ? { entityType } : undefined,
  })
  return recs.map((r) => ({
    uri: r.entityUri,
    entityType: r.entityType,
    embedding: JSON.parse(r.embedding) as number[],
    model: r.model,
    dimensions: r.dimensions,
  }))
}

// === Search ==========================================================

export async function searchSimilar(
  queryEmbedding: number[],
  options: {
    topK?: number
    entityType?: string
    minScore?: number
  } = {},
): Promise<Array<{ uri: string; entityType: string; score: number }>> {
  const hits = await vectorSearch(queryEmbedding, options)
  // Filtra eventuali hit senza entityType (su SQLite entityType è sempre presente)
  return hits
    .filter((h): h is { uri: string; entityType: string; score: number } => Boolean(h.entityType))
    .map((h) => ({ uri: h.uri, entityType: h.entityType!, score: h.score }))
}

// === Delete ==========================================================

export async function deleteEmbedding(entityUri: string): Promise<void> {
  if (await hasPgvector()) {
    await db.$executeRawUnsafe(
      `DELETE FROM "EmbeddingVector" WHERE "entityUri" = $1`,
      entityUri,
    )
    return
  }
  await db.embeddingVector.deleteMany({ where: { entityUri } })
}

// === Helpers =========================================================

export function parsePgvectorString(s: string): number[] {
  // pgvector text format: "[0.1,0.2,0.3]"
  const trimmed = s.replace(/^\[/, '').replace(/\]$/, '')
  if (!trimmed) return []
  return trimmed.split(',').map(parseFloat)
}

export { cosineSimilarity }
