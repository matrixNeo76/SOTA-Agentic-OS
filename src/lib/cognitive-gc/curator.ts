/**
 * Cognitive Garbage Collection — Fase 2.9
 *
 * Memory Curator Agent che gestisce il ciclo di vita della memoria:
 *   1. Consolidamento: 100 task simili → 1 procedural memory
 *   2. Decadimento: weight = utility_score × recency_score
 *   3. Archiviazione a livelli: Hot (Postgres) → Warm (Postgres archived)
 *      → Cold (MinIO/Garage in Fase 2.x; per ora flag cold in DB)
 *
 * Integrato con:
 *   - Memory Fabric (Fase 1.5) per il layer episodic
 *   - ERL (Fase 5) per il layer procedural
 *   - Event Mesh (Fase 2.1) per job schedulati
 *
 * Job schedulati:
 *   - daily: consolidation + decay update
 *   - weekly: cold archival
 *   - on-demand: via API
 */

import { db } from '@/lib/db'
import { storeMemory, retrieveMemory, type MemoryLayer } from '@/lib/memory-fabric/fabric'
import { embed, cosine } from '@/lib/embeddings'
import { createProvenance, type Provenance } from '@/lib/governance'
import { publish } from '@/lib/event-mesh/publishers'

// === Tipi ============================================================

export interface ConsolidationResult {
  layer: MemoryLayer
  agentUri: string
  inputMemories: number
  consolidatedMemories: number
  archivedMemories: number
  newProceduralMemories: number
  decayedMemories: number
}

export interface ColdArchiveResult {
  archived: number
  freedBytes: number
  archivedUris: string[]
}

export interface GCStats {
  totalMemories: number
  byLayer: Record<string, number>
  byTier: Record<string, number>
  avgWeight: number
  lastConsolidationAt?: string
  lastArchiveAt?: string
}

type MemoryTier = 'hot' | 'warm' | 'cold'

// === Consolidamento ==================================================

/**
 * Consolidamento episodic → procedural.
 *
 * Cerca gruppi di memorie episodic simili per lo stesso agent e le consolida
 * in una singola memoria procedural che ne cattura il pattern.
 *
 * Algoritmo:
 *   1. Per ogni agent, recupera le ultime N memorie episodic
 *   2. Clustering per similarità semantica (cosine > 0.7)
 *   3. Per ogni cluster con >= 3 memorie, genera una memoria procedural
 *   4. Marca le episodic originali come 'consolidated' (cold tier)
 */
export async function consolidateEpisodicToProcedural(options?: {
  agentUri?: string
  minClusterSize?: number
  similarityThreshold?: number
  maxMemoriesPerRun?: number
}): Promise<ConsolidationResult> {
  const minClusterSize = options?.minClusterSize ?? 3
  const threshold = options?.similarityThreshold ?? 0.7
  const maxMemories = options?.maxMemoriesPerRun ?? 500

  // Recupera le memorie episodic non ancora consolidate
  const episodicMemories = await db.memoryEntry.findMany({
    where: {
      layer: 'episodic',
      ...(options?.agentUri && { agentUri: options.agentUri }),
      // tier filter via attributes non disponibile; usiamo weight
      weight: { gt: 0.1 }, // escludi già archiviate
    },
    take: maxMemories,
    orderBy: { createdAt: 'desc' },
  })

  // Raggruppa per agent
  const byAgent = new Map<string, typeof episodicMemories>()
  for (const m of episodicMemories) {
    if (!byAgent.has(m.agentUri)) byAgent.set(m.agentUri, [])
    byAgent.get(m.agentUri)!.push(m)
  }

  let consolidatedMemories = 0
  let archivedMemories = 0
  let newProceduralMemories = 0
  let decayedMemories = 0

  for (const [agentUri, memories] of byAgent) {
    // Clustering greedy per similarità
    const clusters: Array<typeof memories> = []
    const assigned = new Set<string>()

    for (let i = 0; i < memories.length; i++) {
      const mem = memories[i]!
      if (assigned.has(mem.id)) continue

      const cluster = [mem]
      assigned.add(mem.id)

      const memEmbedding = mem.embedding ? JSON.parse(mem.embedding) : null
      if (!memEmbedding) continue

      for (let j = i + 1; j < memories.length; j++) {
        const candidate = memories[j]!
        if (assigned.has(candidate.id)) continue

        const candEmbedding = candidate.embedding ? JSON.parse(candidate.embedding) : null
        if (!candEmbedding) continue

        const sim = cosine(memEmbedding, candEmbedding)
        if (sim >= threshold) {
          cluster.push(candidate)
          assigned.add(candidate.id)
        }
      }

      clusters.push(cluster)
    }

    // Per ogni cluster sufficientemente grande, genera procedural memory
    const consolidatedIds = new Set<string>()
    for (const cluster of clusters) {
      if (cluster.length < minClusterSize) continue

      // Genera embedding medio del cluster
      const embeddings = cluster
        .map((c) => (c.embedding ? JSON.parse(c.embedding) as number[] : null))
        .filter(Boolean) as number[][]
      if (embeddings.length === 0) continue

      const avgEmbedding = averageVectors(embeddings)

      // Contenuto consolidato: concatena i top-K contenuti (per lunghezza)
      const sortedByLength = [...cluster].sort((a, b) => b.content.length - a.content.length)
      const topContents = sortedByLength.slice(0, 3).map((c) => c.content)
      const consolidatedContent = `[Consolidated from ${cluster.length} episodes]\n${topContents.join('\n---\n')}`

      // Salva come procedural memory
      await storeMemory({
        layer: 'procedural',
        agentUri,
        content: consolidatedContent,
        embedding: avgEmbedding,
        utilityScore: Math.min(0.95, 0.5 + 0.1 * cluster.length),
      })
      newProceduralMemories++

      // Marca le episodic originali come archived (cold tier)
      for (const mem of cluster) {
        await db.memoryEntry.update({
          where: { id: mem.id },
          data: {
            weight: 0.05, // weight molto basso = cold
            recencyScore: 0.1,
          },
        })
        archivedMemories++
        consolidatedIds.add(mem.id)
      }

      consolidatedMemories += cluster.length
    }

    // Apply decay a tutte le memorie non consolidate (incluse quelle in cluster piccoli)
    for (const mem of memories) {
      if (consolidatedIds.has(mem.id)) continue
      const newDecay = Math.max(0, mem.recencyScore - 0.05)
      const newWeight = mem.utilityScore * newDecay
      await db.memoryEntry.update({
        where: { id: mem.id },
        data: {
          recencyScore: newDecay,
          weight: newWeight,
        },
      })
      if (newWeight < 0.1) decayedMemories++
    }
  }

  // Pubblica evento di consolidamento
  await publish({
    type: 'ExperienceLearned',
    payload: {
      experienceUri: `consolidation://${Date.now()}`,
      outcome: 'success',
      heuristic: `Consolidated ${consolidatedMemories} episodic memories into ${newProceduralMemories} procedural`,
    },
    provenance: gcProvenance(),
  }).catch(() => {})

  return {
    layer: 'episodic',
    agentUri: options?.agentUri || '*',
    inputMemories: episodicMemories.length,
    consolidatedMemories,
    archivedMemories,
    newProceduralMemories,
    decayedMemories,
  }
}

// === Decay update ====================================================

/**
 * Aggiorna il decay score di tutte le memorie.
 * Formula: recencyScore = max(0, 1 - daysSinceLastAccess / 30)
 *          weight = utilityScore × recencyScore
 *
 * Da eseguire giornalmente come job schedulato.
 */
export async function updateDecayScores(options?: {
  agentUri?: string
  olderThanDays?: number
}): Promise<{ updated: number; archived: number }> {
  const olderThanDays = options?.olderThanDays ?? 1
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)

  const memories = await db.memoryEntry.findMany({
    where: {
      ...(options?.agentUri && { agentUri: options.agentUri }),
      updatedAt: { lt: cutoff },
    },
    take: 1000,
  })

  let updated = 0
  let archived = 0

  for (const mem of memories) {
    const lastAccess = mem.lastAccessedAt || mem.createdAt
    const daysSinceAccess = (Date.now() - lastAccess.getTime()) / (1000 * 60 * 60 * 24)
    const newRecency = Math.max(0, 1 - daysSinceAccess / 30)
    const newWeight = mem.utilityScore * newRecency

    await db.memoryEntry.update({
      where: { id: mem.id },
      data: {
        recencyScore: newRecency,
        weight: newWeight,
      },
    })
    updated++

    if (newWeight < 0.05) archived++
  }

  return { updated, archived }
}

// === Cold archival ===================================================

/**
 * Archiviazione a livelli: sposta le memorie con weight molto basso
 * nel tier 'cold' (in Fase 2 sono ancora in Postgres ma flaggate;
 * in Fase 2.x si sposteranno a MinIO/Garage).
 *
 * Criteri:
 *   - weight < 0.05
 *   - lastAccessedAt > 30 giorni fa
 *   - layer episodic (procedural e semantic non si archiviano)
 */
export async function archiveColdMemories(options?: {
  agentUri?: string
  maxArchives?: number
}): Promise<ColdArchiveResult> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const coldMemories = await db.memoryEntry.findMany({
    where: {
      layer: 'episodic',
      weight: { lt: 0.05 },
      OR: [
        { lastAccessedAt: { lt: cutoff } },
        { lastAccessedAt: null, createdAt: { lt: cutoff } },
      ],
      ...(options?.agentUri && { agentUri: options.agentUri }),
    },
    take: options?.maxArchives || 100,
  })

  let archived = 0
  let freedBytes = 0
  const archivedUris: string[] = []

  for (const mem of coldMemories) {
    const contentSize = mem.content.length + (mem.embedding?.length || 0)
    freedBytes += contentSize

    // In Fase 2.x: sposta a MinIO/Garage qui
    // Per ora: marca come cold tramite weight=0 e svuota embedding (size optimization)
    await db.memoryEntry.update({
      where: { id: mem.id },
      data: {
        weight: 0,
        recencyScore: 0,
        // Manteniamo content per audit; embedding viene rimosso per risparmiare spazio
        embedding: null,
      },
    })

    archivedUris.push(mem.id)
    archived++
  }

  return { archived, freedBytes, archivedUris }
}

// === Tier management =================================================

/**
 * Classifica le memorie in tier (hot/warm/cold) in base al weight.
 * Helper per dashboard e query.
 */
export function classifyTier(weight: number): MemoryTier {
  if (weight >= 0.3) return 'hot'
  if (weight >= 0.05) return 'warm'
  return 'cold'
}

// === Stats ===========================================================

export async function gcStats(): Promise<GCStats> {
  const [total, byLayer, recent] = await Promise.all([
    db.memoryEntry.count(),
    db.memoryEntry.groupBy({ by: ['layer'], _count: true }),
    db.memoryEntry.findMany({
      take: 1000,
      select: { weight: true, layer: true, recencyScore: true, lastAccessedAt: true },
    }),
  ])

  const byLayerMap = byLayer.reduce((acc, l) => ({ ...acc, [l.layer]: l._count }), {} as Record<string, number>)

  const byTier: Record<string, number> = { hot: 0, warm: 0, cold: 0 }
  let weightSum = 0
  for (const m of recent) {
    const tier = classifyTier(m.weight)
    byTier[tier]++
    weightSum += m.weight
  }

  return {
    totalMemories: total,
    byLayer: byLayerMap,
    byTier,
    avgWeight: recent.length > 0 ? weightSum / recent.length : 0,
  }
}

// === Scheduler =======================================================

let _dailyJobInterval: NodeJS.Timeout | null = null
let _weeklyJobInterval: NodeJS.Timeout | null = null

/**
 * Avvia il job scheduler per GC.
 *   - daily (ogni 24h): decay update + consolidation
 *   - weekly (ogni 7 giorni): cold archival
 */
export function startGCScheduler(options?: {
  dailyIntervalHours?: number
  weeklyIntervalHours?: number
}): void {
  const dailyHours = options?.dailyIntervalHours ?? 24
  const weeklyHours = options?.weeklyIntervalHours ?? 168 // 7 giorni

  stopGCScheduler()

  _dailyJobInterval = setInterval(async () => {
    try {
      console.log('[cognitive-gc] Daily job: decay update + consolidation')
      await updateDecayScores()
      await consolidateEpisodicToProcedural({ maxMemoriesPerRun: 200 })
    } catch (err) {
      console.error('[cognitive-gc] Daily job failed:', err)
    }
  }, dailyHours * 60 * 60 * 1000)

  _weeklyJobInterval = setInterval(async () => {
    try {
      console.log('[cognitive-gc] Weekly job: cold archival')
      await archiveColdMemories({ maxArchives: 500 })
    } catch (err) {
      console.error('[cognitive-gc] Weekly job failed:', err)
    }
  }, weeklyHours * 60 * 60 * 1000)
}

export function stopGCScheduler(): void {
  if (_dailyJobInterval) {
    clearInterval(_dailyJobInterval)
    _dailyJobInterval = null
  }
  if (_weeklyJobInterval) {
    clearInterval(_weeklyJobInterval)
    _weeklyJobInterval = null
  }
}

// === Helpers =========================================================

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const dim = vectors[0]!.length
  const sum = new Array(dim).fill(0)
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i]! += v[i]!
  }
  const avg = sum.map((s) => s / vectors.length)

  // L2 normalize
  let norm = 0
  for (const x of avg) norm += x * x
  norm = Math.sqrt(norm) || 1
  return avg.map((x) => x / norm)
}

export function gcProvenance(agentUri: string = 'agent://memory-curator'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'agent-reasoning',
    confidence: 0.9,
  })
}
