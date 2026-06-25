/**
 * db-runtime.ts — Fase 1.1
 *
 * Rileva il provider del database (sqlite | postgresql) e offre helper
 * per eseguire operazioni native quando disponibili (pgvector, AGE).
 *
 * In dev (SQLite) tutte le funzioni ritornano { available: false } e il
 * chiamante ricade sul path JS (JSON parse + cosine similarity in JS).
 * In produzione (PostgreSQL + pgvector + AGE) vengono usati operatori
 * nativi via $queryRaw per performance 10-100x migliori.
 */

import { PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'

export type DbProvider = 'sqlite' | 'postgresql'

export interface VectorHit {
  uri: string
  score: number
  entityType?: string
  content?: string
}

export interface GraphNodeRow {
  uri: string
  entityType: string
  attributes: Record<string, unknown>
}

export interface GraphEdgeRow {
  fromUri: string
  toUri: string
  relationType: string
  properties: Record<string, unknown>
}

// === Provider detection (cached) =====================================

let _provider: DbProvider | null = null

export async function getProvider(): Promise<DbProvider> {
  if (_provider) return _provider
  // Prisma espone il provider via _engine.config (interno). Per evitare coupling
  // con internals, usiamo una euristica robusta basata su DATABASE_URL.
  const url = process.env.DATABASE_URL || ''
  _provider = url.startsWith('postgresql://') || url.startsWith('postgres://')
    ? 'postgresql'
    : 'sqlite'
  return _provider
}

/** True se il runtime può usare pgvector nativo. */
export async function hasPgvector(): Promise<boolean> {
  return (await getProvider()) === 'postgresql'
}

/** True se il runtime può usare Apache AGE. */
export async function hasAge(): Promise<boolean> {
  if ((await getProvider()) !== 'postgresql') return false
  try {
    const result = await (db as PrismaClient).$queryRaw<[{ ok: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'age'
      ) AS ok
    `
    return Boolean(result[0]?.ok)
  } catch {
    return false
  }
}

// === pgvector operations =============================================

/**
 * Converte un array di float nella rappresentazione stringa accettata da
 * pgvector: "[0.1,0.2,...]".
 */
export function toPgvector(vec: number[]): string {
  return `[${vec.join(',')}]`
}

/**
 * Cerca i top-K vettori più simili a `queryVec` nella tabella `EmbeddingVector`.
 *
 * Su PostgreSQL + pgvector usa l'operatore `<=>` (cosine distance) nativo.
 * Su SQLite ricade su cosine similarity calcolata in JS (nessuna astrazione
 * extra: carica tutti i record e li score in memoria).
 *
 * Sicurezza: l'entityType è passato come parametro, non interpolato.
 */
export async function vectorSearch(
  queryVec: number[],
  options: {
    topK?: number
    entityType?: string
    minScore?: number
  } = {},
): Promise<VectorHit[]> {
  const topK = options.topK ?? 5
  const minScore = options.minScore ?? 0.3

  if (await hasPgvector()) {
    // Path nativo pgvector. La query usa $queryRawUnsafe con placeholder
    // sicuri ($1, $2, ...) — nessuna interpolazione di stringhe utente.
    const sql = `
      SELECT entity_uri AS "uri",
             entity_type AS "entityType",
             1 - (embedding <=> $1::vector) AS score
      FROM "EmbeddingVector"
      ${options.entityType ? 'WHERE entity_type = $2' : ''}
      ORDER BY embedding <=> $1::vector
      LIMIT $${options.entityType ? 3 : 2}
    `
    const params: unknown[] = [toPgvector(queryVec)]
    if (options.entityType) params.push(options.entityType, topK)
    else params.push(topK)

    const rows = await (db as PrismaClient).$queryRawUnsafe<Array<{
      uri: string
      entityType: string
      score: number
    }>>(sql, ...params)

    return rows
      .filter((r) => Number(r.score) >= minScore)
      .map((r) => ({
        uri: r.uri,
        entityType: r.entityType,
        score: Number(r.score),
      }))
  }

  // Fallback SQLite (path esistente in graphrag/engine.ts)
  const all = await db.embeddingVector.findMany({
    where: options.entityType ? { entityType: options.entityType } : undefined,
    take: 1000,
  })
  const scored = all.map((e) => {
    const vec = JSON.parse(e.embedding) as number[]
    return {
      uri: e.entityUri,
      entityType: e.entityType,
      score: cosineSimilarity(queryVec, vec),
    }
  })
  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * upsertEmbedding — scrive un embedding per un'entità.
 *
 * Su Postgres usa raw SQL perché Prisma non può gestire `Unsupported("vector")`
 * direttamente via client. Su SQLite usa il client Prisma standard (campo String).
 */
export async function upsertEmbedding(params: {
  entityUri: string
  entityType: string
  embedding: number[]
  model?: string
  dimensions?: number
}): Promise<void> {
  if (await hasPgvector()) {
    const sql = `
      INSERT INTO "EmbeddingVector" (id, "entityUri", "entityType", embedding, model, dimensions, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3::vector, $4, $5, NOW(), NOW())
      ON CONFLICT ("entityUri") DO UPDATE
        SET embedding = EXCLUDED.embedding,
            model = EXCLUDED.model,
            dimensions = EXCLUDED.dimensions,
            "updatedAt" = NOW()
    `
    await (db as PrismaClient).$executeRawUnsafe(
      sql,
      params.entityUri,
      params.entityType,
      toPgvector(params.embedding),
      params.model ?? 'all-MiniLM-L6-v2',
      params.dimensions ?? params.embedding.length,
    )
    return
  }

  // SQLite fallback
  await db.embeddingVector.upsert({
    where: { entityUri: params.entityUri },
    create: {
      entityUri: params.entityUri,
      entityType: params.entityType,
      embedding: JSON.stringify(params.embedding),
      model: params.model ?? 'all-MiniLM-L6-v2',
      dimensions: params.dimensions ?? params.embedding.length,
    },
    update: {
      embedding: JSON.stringify(params.embedding),
      model: params.model ?? 'all-MiniLM-L6-v2',
      dimensions: params.dimensions ?? params.embedding.length,
    },
  })
}

// === AGE (Apache AGE) operations =====================================

/**
 * Esegue una query Cypher su AGE. Richiede LOAD 'age' in sessione.
 *
 * Il runtime fa LOAD + SET search_path + SELECT ag_catalog.cypher(...)
 * in una singola $queryRawUnsafe. Ritorna un array di righe grezze.
 *
 * Se AGE non è disponibile, lancia un errore che il chiamante deve gestire
 * ricadendo sul path relazionale (GraphNode/GraphEdge via Prisma).
 */
export async function ageCypher<T = unknown>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  if (!(await hasAge())) {
    throw new Error('Apache AGE non disponibile — usa il path relazionale')
  }

  // AGE richiede che i parametri siano passati come JSON. Costruiamo la query
  // wrapper in modo sicuro: il cypher è passato come stringa letterale SQL.
  // Il chiamante è responsabile di sanitizzare il cypher (mai input utente diretto).
  const jsonParams = JSON.stringify(params)
  const sql = `
    LOAD 'age';
    SET search_path = ag_catalog, "$user", public;
    SELECT * FROM ag_catalog.cypher('sota', $Cypher$ ${cypher} $Cypher$, $1::jsonb) AS (result agtype);
  `
  return (db as PrismaClient).$queryRawUnsafe<T[]>(sql, jsonParams)
}

/**
 * cypherAvailable — check preventivo (utile per i test).
 */
export async function cypherAvailable(): Promise<boolean> {
  try {
    return await hasAge()
  } catch {
    return false
  }
}

// === Utilities =======================================================

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
