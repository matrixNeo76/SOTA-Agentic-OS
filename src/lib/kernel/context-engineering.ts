/**
 * Fase 6: Context Engineering & Pruning
 *
 * Risolve il "context rot": nei task con uso intensivo di tool, l'accumulo
 * di risposte JSON/API nella finestra di contesto distrugge le performance.
 *
 * Strategia ibrida:
 *  1) Ring-buffer: mantieni solo le ultime N coppie Tool Call/Response nel prompt
 *  2) Summarization asincrona: le coppie evicted vengono compresse in un
 *     log narrativo compatto dal summarizer
 *  3) Contesto finale = Summary + ultime N coppie (riassembliato dal Curator)
 *
 * Risultato: agent sempre concentrato sullo stato corrente, con consapevolezza
 * situazionale globale senza il peso dei token crudi.
 */
import { db } from '@/lib/db'
import { embed, serialize } from '@/lib/embeddings'

// Policy di default (override via DB)
const DEFAULT_WINDOW = 5
const DEFAULT_THRESHOLD = 10

/**
 * Registra una nuova coppia Tool Call/Response nel ring buffer.
 * Se la policy supera la threshold, scatena la summarization asincrona.
 */
export async function recordToolCall(
  agentId: string,
  toolName: string,
  callPayload: unknown,
  responsePayload: unknown,
  tokenCost = 0
): Promise<{ entryId: string; evicted: number; summaryId?: string }> {
  const policy = await getOrCreatePolicy(agentId)

  const entry = await db.toolCallEntry.create({
    data: {
      agentId,
      toolName,
      callPayload: JSON.stringify(callPayload),
      responsePayload: JSON.stringify(responsePayload),
      tokenCost,
    },
  })

  // Conta entry non evict per questo agente
  const active = await db.toolCallEntry.count({
    where: { agentId, evicted: false },
  })

  let evicted = 0
  let summaryId: string | undefined

  // Se supera la threshold e autoSummarize è attivo, scatena summarization
  if (policy.autoSummarize && active > policy.summarizeThreshold) {
    const summary = await summarizeAndEvict(agentId, policy.windowSize)
    evicted = summary.evictedCount
    summaryId = summary.summaryId
  } else if (active > policy.windowSize) {
    // Senza summarization, fai solo prune (evict senza riassunto)
    evicted = await pruneOnly(agentId, policy.windowSize)
  }

  return { entryId: entry.id, evicted, summaryId }
}

/**
 * Riassembliamento del contesto di lavoro per l'agente:
 *   [ContextSummary più recente] + [ultime N ToolCallEntry]
 * Questo è ciò che il Curator (Fase 1) inietta nel prompt.
 */
export async function assembleWorkingContext(agentId: string): Promise<{
  summary: { narrative: string; cycleId: number; coveredCount: number } | null
  recentCalls: {
    id: string
    toolName: string
    callPayload: unknown
    responsePayload: unknown
    tokenCost: number
    createdAt: Date
  }[]
  totalTokenCost: number
}> {
  const policy = await getOrCreatePolicy(agentId)

  const latestSummary = await db.contextSummary.findFirst({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
  })

  const recentCalls = await db.toolCallEntry.findMany({
    where: { agentId, evicted: false },
    orderBy: { createdAt: 'desc' },
    take: policy.windowSize,
  })

  const totalTokenCost =
    (latestSummary?.tokenCost || 0) +
    recentCalls.reduce((s, c) => s + c.tokenCost, 0)

  return {
    summary: latestSummary
      ? {
          narrative: latestSummary.narrative,
          cycleId: latestSummary.cycleId,
          coveredCount: latestSummary.coveredCallIds
            ? JSON.parse(latestSummary.coveredCallIds).length
            : 0,
        }
      : null,
    recentCalls: recentCalls.reverse().map((c) => ({
      id: c.id,
      toolName: c.toolName,
      callPayload: JSON.parse(c.callPayload),
      responsePayload: JSON.parse(c.responsePayload),
      tokenCost: c.tokenCost,
      createdAt: c.createdAt,
    })),
    totalTokenCost,
  }
}

/**
 * Summarization: prende tutte le entry non evict tranne le ultime N,
 * genera un riassunto narrativo, marca le entry come evicted.
 *
 * In questa implementazione il summarizer è deterministico (no LLM):
 * costruisce un log narrativo compatto elencando i tool chiamati e
 * i risultati salienti (status, conteggi, primi 80 char del risultato).
 * In produzione si può sostituire con una chiamata LLM secondaria.
 */
export async function summarizeAndEvict(
  agentId: string,
  windowSize: number
): Promise<{ summaryId: string; evictedCount: number; tokenSaved: number }> {
  // Recupera tutte le entry attive
  const allActive = await db.toolCallEntry.findMany({
    where: { agentId, evicted: false },
    orderBy: { createdAt: 'asc' },
  })

  // Mantieni le ultime `windowSize`, evict le altre
  const toEvict = allActive.slice(0, Math.max(0, allActive.length - windowSize))

  if (toEvict.length === 0) {
    return { summaryId: '', evictedCount: 0, tokenSaved: 0 }
  }

  // Recupera l'ultimo summary (per appendere alla narrativa esistente)
  const previousSummary = await db.contextSummary.findFirst({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
  })

  // Costruisci narrativa compatta
  const lines: string[] = []
  if (previousSummary) {
    lines.push(previousSummary.narrative)
    lines.push('---')
  }
  lines.push(`[${new Date().toISOString()}] Azioni evicted (${toEvict.length}):`)
  for (const e of toEvict) {
    const callPreview = e.callPayload.slice(0, 80)
    const respPreview = e.responsePayload.slice(0, 80)
    lines.push(`- ${e.toolName}(${callPreview}) → ${respPreview}`)
  }

  const narrative = lines.join('\n')
  const tokenSaved = toEvict.reduce((s, e) => s + e.tokenCost, 0)

  // Embedding della narrativa per retrieval futuro (RAG su contesto)
  const narrativeEmb = embed(narrative)

  // Crea il summary
  const cycleId = Math.floor(Date.now() / 1000) % 100000
  const summary = await db.contextSummary.create({
    data: {
      agentId,
      narrative,
      coveredCallIds: JSON.stringify(toEvict.map((e) => e.id)),
      tokenCost: Math.ceil(narrative.length / 4), // stima token
      cycleId,
    },
  })

  // Marca le entry come evicted
  await db.toolCallEntry.updateMany({
    where: { id: { in: toEvict.map((e) => e.id) } },
    data: {
      evicted: true,
      evictedAt: new Date(),
      summaryId: summary.id,
    },
  })

  return {
    summaryId: summary.id,
    evictedCount: toEvict.length,
    tokenSaved,
  }
}

/**
 * Prune senza summarization: marca le entry più vecchie come evicted.
 */
async function pruneOnly(agentId: string, windowSize: number): Promise<number> {
  const allActive = await db.toolCallEntry.findMany({
    where: { agentId, evicted: false },
    orderBy: { createdAt: 'asc' },
  })
  const toEvict = allActive.slice(0, Math.max(0, allActive.length - windowSize))
  if (toEvict.length === 0) return 0
  await db.toolCallEntry.updateMany({
    where: { id: { in: toEvict.map((e) => e.id) } },
    data: { evicted: true, evictedAt: new Date() },
  })
  return toEvict.length
}

/**
 * Recupera o crea la policy di pruning per un agente.
 */
async function getOrCreatePolicy(agentId: string) {
  let policy = await db.pruningPolicy.findUnique({ where: { agentId } })
  if (!policy) {
    policy = await db.pruningPolicy.create({
      data: {
        agentId,
        windowSize: DEFAULT_WINDOW,
        summarizeThreshold: DEFAULT_THRESHOLD,
        autoSummarize: true,
      },
    })
  }
  return policy
}

/**
 * Aggiorna la policy di pruning.
 */
export async function updatePolicy(
  agentId: string,
  updates: { windowSize?: number; summarizeThreshold?: number; autoSummarize?: boolean }
) {
  return db.pruningPolicy.upsert({
    where: { agentId },
    create: {
      agentId,
      windowSize: updates.windowSize ?? DEFAULT_WINDOW,
      summarizeThreshold: updates.summarizeThreshold ?? DEFAULT_THRESHOLD,
      autoSummarize: updates.autoSummarize ?? true,
    },
    update: updates,
  })
}

/**
 * Statistiche context engineering per dashboard.
 */
export async function contextStats(agentId?: string) {
  const where = agentId ? { agentId } : {}
  const [activeCalls, evictedCalls, summaries, totalTokensSaved] = await Promise.all([
    db.toolCallEntry.count({ where: { ...where, evicted: false } }),
    db.toolCallEntry.count({ where: { ...where, evicted: true } }),
    db.contextSummary.count({ where }),
    db.toolCallEntry.aggregate({
      where: { ...where, evicted: true },
      _sum: { tokenCost: true },
    }),
  ])
  return {
    activeCalls,
    evictedCalls,
    summaries,
    totalTokensSaved: totalTokensSaved._sum.tokenCost || 0,
  }
}

/**
 * Ricerca RAG nel contesto storico (narrative dei summary).
 */
export async function searchContextHistory(agentId: string, query: string, k = 3) {
  const q = embed(query)
  const summaries = await db.contextSummary.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  // Note: non memorizziamo embedding dei summary nel DB per semplicità;
  // ricalcoliamo al volo (50 summary max, costo trascurabile)
  const scored = summaries.map((s) => {
    const emb = embed(s.narrative)
    let dot = 0
    for (let i = 0; i < q.length; i++) dot += q[i] * emb[i]
    return { id: s.id, narrative: s.narrative, cycleId: s.cycleId, similarity: dot }
  })
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}
