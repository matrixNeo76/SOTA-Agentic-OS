/**
 * Embeddings utility - simulazione locale di embedding semantici.
 * In produzione si utilizzerebbe un modello reale; qui usiamo un hash-based
 * embedding deterministico per garantire coerenza vettoriale tra query e documenti.
 */

// Vocabolario di token semplici (italiano + inglese tecnico)
const VOCAB: Record<string, number> = {}
const TOKENS = [
  'piano','task','agente','memoria','stato','verifica','sicurezza','regola',
  'euristica','riflessione','kernel','ciclo','token','budget','schema','patch',
  'json','dag','thread','coda','sensorium','curator','taint','ltl','fsm',
  'normative','redline','compiled','template','steering','plan','execute',
  'check','reflect','approval','risk','high','low','human','semantic','episodic',
  'logical','vector','ema','decay','drift','memory','entity','observation',
  'rule','dependency','topological','scheduler','parallel','concurrent','validation',
  'safety','syntax','accuracy','deploy','artifact','cache','queue','load',
  'monitor','event','state','label','verdict','block','warn','audit','trace',
  'flow','payload','source','priority','axiom','legal','operational','efficiency',
  'experience','learning','success','failure','extraction','similarity','cosine',
  'rag','retrieval','injection','context','innovation','supervisor','evaluate',
]
TOKENS.forEach((t, i) => { VOCAB[t] = i })
const DIM = 128

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Embedding deterministico: combina hashing dei token con pesi posizionali.
 * Le entità con vocabolario condiviso avranno vettori simili (cosine sim. > 0.7).
 */
export function embed(text: string): number[] {
  const vec = new Array(DIM).fill(0)
  const tokens = tokenize(text)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (VOCAB[t] !== undefined) {
      const idx = VOCAB[t] % DIM
      vec[idx] += 1 / (1 + i * 0.1)
    } else {
      // hash fallback per token fuori vocabolario
      let h = 0
      for (let c = 0; c < t.length; c++) h = (h * 31 + t.charCodeAt(c)) >>> 0
      vec[h % DIM] += 0.3 / (1 + i * 0.1)
    }
  }
  // normalizzazione L2
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
    return JSON.parse(s)
  } catch {
    return new Array(DIM).fill(0)
  }
}

export const EMBED_DIM = DIM
