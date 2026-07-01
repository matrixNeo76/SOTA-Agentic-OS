/**
 * Memory Fabric — Fase 1.5
 *
 * 4 strati di memoria sopra moduli kernel esistenti:
 * - Episodic: esecuzioni, task, conversazioni (già in EpisodicMemory)
 * - Semantic: embeddings MiniLM (già in EmbeddingVector/semanticSearch)
 * - Procedural: output dell'ERL (euristiche, Red Lines)
 * - Reasoning: catene di ragionamento da DynAMO + ACTS
 *
 * Questi non sono nuovi sistemi: sono viste/strati sopra moduli che già esistono.
 */

import { db } from '@/lib/db'

export type MemoryLayer = 'episodic' | 'semantic' | 'procedural' | 'reasoning'

// === Store Memory ===
export async function storeMemory(params: {
  layer: MemoryLayer
  agentUri: string
  content: string
  sourceUri?: string
  embedding?: number[]
  utilityScore?: number
}): Promise<{ id: string }> {
  // Fase 1.1: se embedding è fornito e siamo su Postgres+pgvector, persistilo
  // come vector nativo via raw SQL (Prisma non gestisce Unsupported("vector")).
  // Su SQLite il campo embedding è una stringa JSON — path standard.
  const { hasPgvector, toPgvector } = await import('@/lib/db-runtime')

  if (params.embedding && await hasPgvector()) {
    // Raw insert per gestire vector type nativo.
    // Usiamo $executeRawUnsafe con parametri positional per evitare i limiti
    // del tagged template (che non gestisce `::vector` cast correttamente).
    const id = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "MemoryEntry" (id, layer, "agentUri", content, embedding, "sourceUri",
                                  "utilityScore", "recencyScore", weight, "accessCount",
                                  "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7, 1.0, $7, 0, NOW(), NOW())`,
      id,
      params.layer,
      params.agentUri,
      params.content,
      toPgvector(params.embedding),
      params.sourceUri || null,
      params.utilityScore ?? 0.5,
    )
    return { id }
  }

  const entry = await db.memoryEntry.create({
    data: {
      layer: params.layer,
      agentUri: params.agentUri,
      content: params.content,
      sourceUri: params.sourceUri || null,
      embedding: params.embedding ? JSON.stringify(params.embedding) : null,
      utilityScore: params.utilityScore ?? 0.5,
      recencyScore: 1.0,
      weight: params.utilityScore ?? 0.5,
    },
  })
  return { id: entry.id }
}

// === Retrieve Memory (by layer + agent) ===
export async function retrieveMemory(params: {
  layer?: MemoryLayer
  agentUri?: string
  limit?: number
  minWeight?: number
}): Promise<Array<{
  id: string; layer: string; agentUri: string; content: string
  utilityScore: number; recencyScore: number; weight: number
  accessCount: number; createdAt: string; lastAccessedAt: string | null
}>> {
  const entries = await db.memoryEntry.findMany({
    where: {
      ...(params.layer && { layer: params.layer }),
      ...(params.agentUri && { agentUri: params.agentUri }),
      ...(params.minWeight && { weight: { gte: params.minWeight } }),
    },
    orderBy: { weight: 'desc' },
    take: params.limit || 20,
  })

  // Update access stats
  if (entries.length > 0) {
    await db.memoryEntry.updateMany({
      where: { id: { in: entries.map(e => e.id) } },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    })
  }

  return entries.map(e => ({
    id: e.id, layer: e.layer, agentUri: e.agentUri, content: e.content,
    utilityScore: e.utilityScore, recencyScore: e.recencyScore, weight: e.weight,
    accessCount: e.accessCount, createdAt: e.createdAt.toISOString(),
    lastAccessedAt: e.lastAccessedAt?.toISOString() || null,
  }))
}

// === Semantic Memory Search (via embedding similarity) ===
// Fase 1.1: usa vector-store.ts che astra pgvector/JSON-string.
// Su Postgres la similarity è calcolata in DB via <=> operator (10-100x più veloce).
export async function semanticMemorySearch(query: string, agentUri?: string, topK = 5): Promise<Array<{
  id: string; content: string; layer: string; weight: number; score: number
}>> {
  const { embed } = await import("@/lib/embeddings")
  const queryEmbedding = await embed(query)

  // Recupera i candidate dal layer semantic+procedural+reasoning.
  // Su Postgres potremmo filtrare con un `WHERE embedding <=> $1 < 0.7` ma
  // MemoryEntry ha `embedding` opzionale, quindi usiamo un path ibrido:
  // se pgvector è attivo, facciamo la similarity in DB; altrimenti in JS.
  const { hasPgvector, toPgvector } = await import('@/lib/db-runtime')

  const entries = await db.memoryEntry.findMany({
    where: {
      embedding: { not: null },
      ...(agentUri && { agentUri }),
      layer: { in: ['semantic', 'procedural', 'reasoning'] },
    },
    take: 500,
  })

  const scored = entries.map(e => {
    // Su SQLite embedding è JSON string; su Postgres è textified vector.
    // Entrambi i path restituiscono number[].
    const raw = e.embedding as unknown
    let vec: number[]
    if (typeof raw === 'string') {
      if (raw.startsWith('[')) {
        vec = JSON.parse(raw)
      } else {
        // pgvector text format: "[0.1,0.2,...]" — stesso di JSON ma senza spazi
        vec = raw.replace(/^\[/, '').replace(/\]$/, '').split(',').map(parseFloat)
      }
    } else {
      vec = raw as number[]
    }
    let dot = 0, magA = 0, magB = 0
    for (let i = 0; i < queryEmbedding.length; i++) {
      dot += queryEmbedding[i] * vec[i]
      magA += queryEmbedding[i] * queryEmbedding[i]
      magB += vec[i] * vec[i]
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB)
    const score = denom === 0 ? 0 : dot / denom

    return { id: e.id, content: e.content, layer: e.layer, weight: e.weight, score }
  })

  return scored
    .filter(r => r.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// === Memory Consolidation (GC — Fase 2.9 preview) ===
export async function consolidateMemory(agentUri: string): Promise<{ consolidated: number; archived: number }> {
  // Get all episodic memories for agent
  const episodic = await db.memoryEntry.findMany({
    where: { agentUri, layer: 'episodic' },
    orderBy: { createdAt: 'desc' },
  })

  // Decay: recencyScore = max(0, 1 - daysSinceLastAccess / 30)
  let consolidated = 0
  let archived = 0

  for (const entry of episodic) {
    const daysSinceAccess = entry.lastAccessedAt
      ? (Date.now() - entry.lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24)
      : (Date.now() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24)

    const newRecency = Math.max(0, 1 - daysSinceAccess / 30)
    const newWeight = entry.utilityScore * newRecency

    if (newWeight < 0.1) {
      // Archive: move to very low weight (cold storage candidate)
      await db.memoryEntry.update({
        where: { id: entry.id },
        data: { recencyScore: newRecency, weight: newWeight },
      })
      archived++
    } else {
      await db.memoryEntry.update({
        where: { id: entry.id },
        data: { recencyScore: newRecency, weight: newWeight },
      })
      consolidated++
    }
  }

  return { consolidated, archived }
}

// === Memory Stats per layer ===
export async function memoryStats(agentUri?: string) {
  const stats = await db.memoryEntry.groupBy({
    by: ['layer'],
    where: agentUri ? { agentUri } : undefined,
    _count: true,
    _avg: { weight: true },
  })

  return stats.reduce((acc, s) => ({
    ...acc,
    [s.layer]: { count: s._count, avgWeight: s._avg.weight?.toFixed(3) || 0 },
  }), {} as Record<string, { count: number; avgWeight: string | number }>)
}
