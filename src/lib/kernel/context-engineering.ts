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
import { embed, serialize, deserialize, cosine } from '@/lib/embeddings'

// Policy di default (override via DB)
const DEFAULT_WINDOW = 5
const DEFAULT_THRESHOLD = 10

// B7 fix: size cap su payload (50KB ciascuno)
const MAX_PAYLOAD_SIZE = 50_000

// B2 fix: size cap sulla narrativa (5KB)
const MAX_NARRATIVE_SIZE = 5_000

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

  // B7 fix: size cap su payload (50KB ciascuno) per prevenire DB bloat
  let callStr: string
  let respStr: string
  try {
    callStr = JSON.stringify(callPayload)
  } catch {
    callStr = String(callPayload)
  }
  try {
    respStr = JSON.stringify(responsePayload)
  } catch {
    respStr = String(responsePayload)
  }
  if (callStr.length > MAX_PAYLOAD_SIZE) {
    callStr = callStr.slice(0, MAX_PAYLOAD_SIZE) + '\n...[truncated]'
  }
  if (respStr.length > MAX_PAYLOAD_SIZE) {
    respStr = respStr.slice(0, MAX_PAYLOAD_SIZE) + '\n...[truncated]'
  }

  const entry = await db.toolCallEntry.create({
    data: {
      agentId,
      toolName,
      callPayload: callStr,
      responsePayload: respStr,
      tokenCost,
    },
  })

  // Conta entry non evict per questo agente
  const active = await db.toolCallEntry.count({
    where: { agentId, evicted: false },
  })

  let evicted = 0
  let summaryId: string | undefined

  // B2 fix: when autoSummarize is on, let entries accumulate until threshold
  // (don't prune at windowSize — that prevents summarization from ever triggering).
  // PRIMA: pruneOnly fired at active > windowSize, keeping active at windowSize,
  // so active never reached summarizeThreshold → summarization never triggered.
  // ORA: pruneOnly only fires when autoSummarize is off.
  if (policy.autoSummarize && active > policy.summarizeThreshold) {
    const summary = await summarizeAndEvict(agentId, policy.windowSize)
    evicted = summary.evictedCount
    summaryId = summary.summaryId
  } else if (!policy.autoSummarize && active > policy.windowSize) {
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
            ? safeJsonParse(latestSummary.coveredCallIds, []).length
            : 0,
        }
      : null,
    // C3 fix: try/catch su JSON.parse per payload corrotti.
    // PRIMA: JSON.parse throwava su payload non valido → crash di assembleWorkingContext.
    // ORA: se parse fallisce, ritorna la stringa grezza o null.
    recentCalls: recentCalls.reverse().map((c) => ({
      id: c.id,
      toolName: c.toolName,
      callPayload: safeJsonParse(c.callPayload, c.callPayload),
      responsePayload: safeJsonParse(c.responsePayload, c.responsePayload),
      tokenCost: c.tokenCost,
      createdAt: c.createdAt,
    })),
    totalTokenCost,
  }
}

/**
 * C3 fix — Helper per JSON.parse sicuro con fallback.
 * Se parse fallisce, ritorna il fallback invece di throware.
 */
function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str)
  } catch {
    return fallback
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
    // B2 fix: tronca narrativa precedente a MAX_NARRATIVE_SIZE prima di appendere
    // PRIMA: la narrativa cresceva indefinitamente (appende tutto il precedente)
    // ORA: mantieni solo ultimi 5KB della narrativa precedente
    const prevNarrative = previousSummary.narrative.length > MAX_NARRATIVE_SIZE
      ? '...[truncated]\n' + previousSummary.narrative.slice(-MAX_NARRATIVE_SIZE)
      : previousSummary.narrative
    lines.push(prevNarrative)
    lines.push('---')
  }
  lines.push(`[${new Date().toISOString()}] Azioni evicted (${toEvict.length}):`)
  for (const e of toEvict) {
    const callPreview = e.callPayload.slice(0, 80)
    const respPreview = e.responsePayload.slice(0, 80)
    lines.push(`- ${e.toolName}(${callPreview}) → ${respPreview}`)
  }

  let narrative = lines.join('\n')
  // B2 fix: se la narrativa finale supera il cap, tronca
  if (narrative.length > MAX_NARRATIVE_SIZE * 2) {
    narrative = narrative.slice(0, MAX_NARRATIVE_SIZE * 2) + '\n...[narrative truncated]'
  }

  const tokenSaved = toEvict.reduce((s, e) => s + e.tokenCost, 0)

  // B1+G5 fix: calcola e persisti embedding della narrativa al creation time
  // PRIMA: searchContextHistory ricalcolava embed() per 50 summary per query
  // ORA: embedding persistito, searchContextHistory lo legge dal DB
  let embeddingStr: string | null = null
  try {
    const narrativeEmb = embed(narrative)
    embeddingStr = serialize(narrativeEmb)
  } catch {
    // Non bloccante: se embed fallisce, persisti senza embedding
  }

  // Crea il summary
  const cycleId = Math.floor(Date.now() / 1000) % 100000
  const summary = await db.contextSummary.create({
    data: {
      agentId,
      narrative,
      coveredCallIds: JSON.stringify(toEvict.map((e) => e.id)),
      tokenCost: Math.ceil(narrative.length / 4), // stima token
      cycleId,
      ...(embeddingStr && { embedding: embeddingStr }), // B1+G5: persisti embedding
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
 *
 * B3 fix (Context Manager audit Fase B): valida input.
 * PRIMA: windowSize=0 → contesto vuoto, threshold=-1 → summarization ad ogni call.
 * ORA: windowSize deve essere 1-100, summarizeThreshold >= windowSize e <= 1000.
 */
export async function updatePolicy(
  agentId: string,
  updates: { windowSize?: number; summarizeThreshold?: number; autoSummarize?: boolean }
) {
  // B3: validazione
  if (updates.windowSize !== undefined) {
    if (!Number.isInteger(updates.windowSize) || updates.windowSize < 1 || updates.windowSize > 100) {
      throw new Error(`Invalid windowSize ${updates.windowSize}: must be integer 1-100`)
    }
  }
  if (updates.summarizeThreshold !== undefined) {
    if (!Number.isInteger(updates.summarizeThreshold) || updates.summarizeThreshold < 1 || updates.summarizeThreshold > 1000) {
      throw new Error(`Invalid summarizeThreshold ${updates.summarizeThreshold}: must be integer 1-1000`)
    }
    // threshold deve essere >= windowSize (se entrambi specificati)
    const effectiveWindow = updates.windowSize ?? (await getOrCreatePolicy(agentId)).windowSize
    if (updates.summarizeThreshold < effectiveWindow) {
      throw new Error(`summarizeThreshold ${updates.summarizeThreshold} must be >= windowSize ${effectiveWindow}`)
    }
  }

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
 *
 * B1+G5 fix: usa embedding persistito nel DB invece di ricalcolare embed() per ogni summary.
 * B8 fix: usa cosine similarity invece di dot product grezzo.
 * PRIMA: ricalcolava 50 embedding per query + dot product biased da magnitudo.
 * ORA: legge embedding dal DB (O(1) per summary) + cosine normalizzato.
 */
export async function searchContextHistory(agentId: string, query: string, k = 3) {
  const q = embed(query)
  const summaries = await db.contextSummary.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  const scored = summaries.map((s) => {
    let similarity = 0
    // B1+G5: usa embedding persistito se disponibile
    if (s.embedding) {
      try {
        const emb = deserialize(s.embedding)
        similarity = cosine(q, emb) // B8: cosine invece di dot product
      } catch {
        // Fallback: ricalcola embedding se deserialize fallisce
        try {
          const emb = embed(s.narrative)
          similarity = cosine(q, emb)
        } catch {
          similarity = 0
        }
      }
    } else {
      // Summary senza embedding (precedente al B1 fix) → ricalcola
      try {
        const emb = embed(s.narrative)
        similarity = cosine(q, emb)
      } catch {
        similarity = 0
      }
    }
    return { id: s.id, narrative: s.narrative, cycleId: s.cycleId, similarity }
  })
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}
