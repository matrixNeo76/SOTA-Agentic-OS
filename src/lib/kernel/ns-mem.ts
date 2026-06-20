/**
 * NS-Mem: Memoria a 3 livelli (Fase 1)
 *  - Episodico: osservazioni timestampate con EMA decay
 *  - Semantico: entità coerenti con embedding vettoriale
 *  - Logico: regole procedurali come DAG
 *
 * Aggiornamenti incrementali con EMA per resistere alla deriva semantica.
 */
import { db } from '@/lib/db'
import { embed, serialize, deserialize, cosine } from '@/lib/embeddings'

const EMA_ALPHA = 0.3 // peso nuova osservazione (1=nessun passato, 0=nessun aggiornamento)

/**
 * Livello Episodico: registra un'osservazione.
 * L'embedding viene decaduto gradualmente secondo EMA.
 */
export async function recordEpisode(
  observation: string,
  source?: string,
  agentId?: string,
  tags?: string[]
): Promise<void> {
  const newEmb = embed(observation)
  await db.episodicMemory.create({
    data: {
      observation,
      embedding: serialize(newEmb),
      decay: 1.0,
      source: source || null,
      agentId: agentId || null,
      tags: tags ? JSON.stringify(tags) : null,
    },
  })

  // EMA update: se esiste un'entità semantica correlata, aggiorna il suo embedding
  const entities = await db.semanticEntity.findMany()
  const queryEmb = newEmb
  let best: { id: string; sim: number } | null = null
  for (const e of entities) {
    const sim = cosine(queryEmb, deserialize(e.embedding))
    if (!best || sim > best.sim) best = { id: e.id, sim }
  }
  if (best && best.sim > 0.6) {
    const target = await db.semanticEntity.findUnique({ where: { id: best.id } })
    if (target) {
      const oldEmb = deserialize(target.embedding)
      // EMA: new = α·new + (1-α)·old
      const blended = oldEmb.map((v, i) => EMA_ALPHA * queryEmb[i] + (1 - EMA_ALPHA) * v)
      const newDecay = target.decay * (1 - EMA_ALPHA) + EMA_ALPHA
      await db.semanticEntity.update({
        where: { id: target.id },
        data: { embedding: serialize(blended), decay: newDecay },
      })
    }
  }
}

/**
 * Livello Semantico: registra o aggiorna un'entità.
 */
export async function upsertEntity(
  name: string,
  type: string,
  description?: string,
  attributes?: Record<string, unknown>
): Promise<void> {
  const emb = embed(`${name} ${type} ${description || ''}`)
  await db.semanticEntity.upsert({
    where: { name },
    create: {
      name, type, description,
      embedding: serialize(emb),
      attributes: attributes ? JSON.stringify(attributes) : null,
      decay: 1.0,
    },
    update: {
      type, description,
      attributes: attributes ? JSON.stringify(attributes) : null,
    },
  })
}

/**
 * Livello Logico: aggiunge una regola procedurale (nodo DAG).
 */
export async function addLogicalRule(
  ruleId: string,
  expression: string,
  dependencies: string[] = [],
  priority = 0
): Promise<void> {
  await db.logicalRule.create({
    data: {
      ruleId, expression,
      dependencies: JSON.stringify(dependencies),
      priority,
    },
  })
}

/**
 * Ricerca semantica: top-k entità simili alla query.
 */
export async function semanticSearch(query: string, k = 5) {
  const q = embed(query)
  const all = await db.semanticEntity.findMany()
  const scored = all.map((e) => ({
    id: e.id, name: e.name, type: e.type,
    description: e.description,
    similarity: cosine(q, deserialize(e.embedding)),
    decay: e.decay,
  }))
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}

/**
 * Ricerca episodica: ultime N osservazioni con decay applicato.
 */
export async function recentEpisodes(limit = 20) {
  const rows = await db.episodicMemory.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    observation: r.observation,
    timestamp: r.timestamp,
    decay: r.decay,
    source: r.source,
    agentId: r.agentId,
    tags: r.tags ? JSON.parse(r.tags) : [],
  }))
}

/**
 * Recupera il DAG delle regole logica per la schedulazione topologica.
 */
export async function getLogicalDAG() {
  const rules = await db.logicalRule.findMany({ where: { active: true } })
  return rules.map((r) => ({
    ruleId: r.ruleId,
    expression: r.expression,
    dependencies: r.dependencies ? JSON.parse(r.dependencies) : [],
    priority: r.priority,
  }))
}

/**
 * Statistiche memoria per dashboard.
 */
export async function memoryStats() {
  const [ep, sem, log] = await Promise.all([
    db.episodicMemory.count(),
    db.semanticEntity.count(),
    db.logicalRule.count(),
  ])
  const recent = await db.episodicMemory.findMany({
    orderBy: { timestamp: 'desc' }, take: 50,
    select: { decay: true },
  })
  const avgDecay = recent.length
    ? recent.reduce((s, r) => s + r.decay, 0) / recent.length
    : 0
  return { episodic: ep, semantic: sem, logical: log, avgDecay }
}
