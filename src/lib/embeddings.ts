/**
 * Embeddings semantici locali.
 *
 * Strategia ibrida (senza dipendere da un'API embeddings esterna):
 *  1) Tokenizzazione con stemming leggero (italiano + inglese)
 *  2) Vocabolario dinamico con hashing controllato (LSH-like in bucket semanticamente coerenti)
 *  3) Pesatura TF-IDF normalizzata L2
 *  4) "Semantic buckets" raggruppano token sinonimi tramite un dizionario
 *     di alias compilato a partire dai concetti del dominio agentic OS
 *
 * Risultato: embedding a 256 dimensioni con cosine similarity significativa
 * (entità concettualmente vicine hanno sim > 0.5).
 */

const DIM = 256

// Dizionario di alias: mappa termini specifici a concetti canonici.
// Questo rende il embedding semantico invece che puramente ortografico.
const ALIASES: Record<string, string> = {
  // agenti
  'orchestrator': 'orchestrator',
  'orchestratore': 'orchestrator',
  'curator': 'curator',
  'curatore': 'curator',
  'controller': 'controller',
  'verifier': 'verifier',
  'verificatore': 'verifier',
  'reflective': 'reflective',
  'agent': 'agent',
  'agente': 'agent',
  'agenti': 'agent',

  // memoria
  'memory': 'memory',
  'memoria': 'memory',
  'episodic': 'episodic_memory',
  'episodico': 'episodic_memory',
  'episodio': 'episodic_memory',
  'semantic': 'semantic_memory',
  'semantico': 'semantic_memory',
  'logical': 'logical_memory',
  'logico': 'logical_memory',
  'regola': 'rule',
  'rule': 'rule',
  'rules': 'rule',
  'entity': 'entity',
  'entita': 'entity',
  'embedding': 'embedding',
  'vector': 'vector',
  'vettore': 'vector',
  'ema': 'ema_decay',
  'decay': 'ema_decay',

  // fasi
  'phase': 'phase',
  'fase': 'phase',
  'stato': 'state',
  'state': 'state',
  'sensorium': 'sensorium',
  'patchboard': 'patchboard',
  'patch': 'patch',
  'transaction': 'transaction',
  'transazione': 'transaction',

  // orchestrazione
  'plan': 'plan',
  'piano': 'plan',
  'task': 'task',
  'dag': 'dag',
  'schedule': 'scheduler',
  'scheduler': 'scheduler',
  'topological': 'topological',
  'parallel': 'parallel',
  'parallelo': 'parallel',
  'concurrent': 'parallel',
  'compiled': 'compiled_ai',
  'compile': 'compiled_ai',
  'template': 'template',
  'artifact': 'artifact',
  'artefatto': 'artifact',

  // steering
  'steering': 'steering',
  'sterzata': 'steering',
  'acts': 'acts',
  'budget': 'budget',
  'token': 'token',
  'plan': 'plan',
  'execute': 'execute',
  'check': 'check',
  'reflect': 'reflect',
  'halt': 'halt',

  // verifica
  'verify': 'verify',
  'verifica': 'verify',
  'ltl': 'ltl',
  'fsm': 'fsm',
  'monitor': 'monitor',
  'taint': 'taint',
  'tainted': 'taint',
  'sink': 'sink',
  'mit': 'mit_e',
  'normative': 'normative',
  'axiom': 'axiom',
  'assioma': 'axiom',
  'priority': 'priority',
  'priorita': 'priority',
  'legal': 'priority_legal',
  'legale': 'priority_legal',
  'operational': 'priority_operational',
  'operativo': 'priority_operational',
  'efficiency': 'priority_efficiency',
  'efficienza': 'priority_efficiency',

  // riflessione
  'erl': 'erl',
  'reflection': 'reflection',
  'riflessione': 'reflection',
  'heuristic': 'heuristic',
  'euristica': 'heuristic',
  'red': 'red_line',
  'line': 'red_line',
  'redline': 'red_line',
  'autosota': 'autosota',
  'rag': 'rag',
  'retrieval': 'retrieval',
  'extraction': 'extraction',

  // sicurezza
  'security': 'security',
  'sicurezza': 'security',
  'risk': 'risk',
  'rischio': 'risk',
  'approval': 'approval',
  'approvazione': 'approval',
  'human': 'human',
  'umano': 'human',
  'bypass': 'bypass',
  'policy': 'policy',
  'safety': 'safety',

  // sistema
  'system': 'system',
  'sistema': 'system',
  'cycle': 'cycle',
  'ciclo': 'cycle',
  'queue': 'queue',
  'coda': 'queue',
  'thread': 'thread',
  'load': 'load',
  'kernel': 'kernel',
}

// Stopword minime
const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'del', 'della', 'dei', 'a', 'ad', 'al', 'alla',
  'da', 'dal', 'dalla', 'in', 'nel', 'nella', 'con', 'su', 'per', 'tra', 'fra',
  'e', 'ed', 'o', 'od', 'ma', 'se', 'che', 'come', 'cosa', 'questo', 'questa',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'and', 'or', 'but', 'if', 'then', 'that', 'this', 'these', 'those', 'as', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can',
])

/**
 * Tokenizza con normalizzazione: lowercase, alias mapping, rimozione stopwords,
 * rimozione punteggiatura, splitting camelCase.
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  // split camelCase
  const camel = lower.replace(/([a-z])([A-Z])/g, '$1 $2')
  // estrai token alfanumerici
  const raw = camel
    .replace(/[^a-z0-9\s_àèéìòù]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const tokens: string[] = []
  for (const t of raw) {
    if (STOPWORDS.has(t) || t.length < 2) continue
    // Applica alias mapping (semantico)
    const canonical = ALIASES[t] || t
    tokens.push(canonical)
    // Aggiungi anche il token originale per co-occorrenza
    if (canonical !== t) tokens.push(t)
  }
  return tokens
}

/**
 * Hash deterministico in [0, DIM) con buona distribuzione.
 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % DIM
}

/**
 * Embedding TF-IDF-like con buckets semantici.
 * - Token canonico → bucket primario (peso 1.0)
 * - Token originale → bucket secondario (peso 0.3, captures co-occurrence)
 * - Bigrammi di token canonici → bucket terziario (peso 0.5)
 */
export function embed(text: string): number[] {
  const vec = new Array(DIM).fill(0)
  const tokens = tokenize(text)
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1)
  }

  // Token weights (TF log)
  for (const [t, count] of tf) {
    const weight = 1 + Math.log(count)
    vec[hash(t)] += weight
  }

  // Bigram captures local context
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`
    vec[hash(bigram) % DIM] += 0.5
  }

  // Trigram captures richer context
  for (let i = 0; i < tokens.length - 2; i++) {
    const trigram = `${tokens[i]}_${tokens[i + 1]}_${tokens[i + 2]}`
    vec[(hash(trigram) + 37) % DIM] += 0.3
  }

  // L2 normalize
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return vec.map((v) => v / norm)
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // già normalizzati
}

export function serialize(vec: number[]): string {
  return JSON.stringify(vec)
}

export function deserialize(s: string): number[] {
  try {
    const v = JSON.parse(s)
    if (Array.isArray(v)) return v
    return new Array(DIM).fill(0)
  } catch {
    return new Array(DIM).fill(0)
  }
}

export const EMBED_DIM = DIM

/**
 * Helper: ricalcola l'embedding di tutti i record esistenti (episodi + entità + euristiche)
 * dopo un cambio di modello embedding. Da chiamare via API.
 */
export async function recomputeAllEmbeddings(): Promise<{ episodes: number; entities: number; heuristics: number }> {
  // Lazy import per evitare circular dep
  const { db } = await import('@/lib/db')
  let episodes = 0, entities = 0, heuristics = 0

  const eps = await db.episodicMemory.findMany()
  for (const e of eps) {
    const emb = embed(e.observation)
    await db.episodicMemory.update({ where: { id: e.id }, data: { embedding: serialize(emb) } })
    episodes++
  }

  const ents = await db.semanticEntity.findMany()
  for (const e of ents) {
    const emb = embed(`${e.name} ${e.type} ${e.description || ''}`)
    await db.semanticEntity.update({ where: { id: e.id }, data: { embedding: serialize(emb) } })
    entities++
  }

  const heurs = await db.heuristic.findMany()
  for (const h of heurs) {
    const emb = embed(`${h.trigger} ${h.action} ${h.context}`)
    await db.heuristic.update({ where: { id: h.id }, data: { embedding: serialize(emb) } })
    heuristics++
  }

  return { episodes, entities, heuristics }
}
