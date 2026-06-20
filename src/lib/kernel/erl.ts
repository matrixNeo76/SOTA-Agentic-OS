/**
 * ERL: Experiential Reflective Learning (Fase 5)
 *
 * Dopo ogni operazione, un modulo di riflessione genera un'analisi delle cause
 * ed estrae un'euristica ("Quando X, devo esplicitamente fare Y").
 *
 * AutoSOTA: l'Agente Supervisore valuta ogni euristica proposta contro
 * "Linee Rosse" non negoziabili prima di memorizzarla.
 */
import { db } from '@/lib/db'
import { embed, serialize, deserialize, cosine } from '@/lib/embeddings'

export type ReflectionInput = {
  operationId: string
  goal: string
  outcome: 'success' | 'failure' | 'partial'
  steps: { action: string; result: string }[]
  context: string
}

export type ExtractedHeuristic = {
  trigger: string  // "Quando incontro la situazione X"
  action: string   // "devo esplicitamente fare Y"
  context: string
  redLineFlagged: boolean
}

export const DEFAULT_RED_LINES = [
  {
    description: 'Non ignorare i limiti dei dataset di input',
    rationale: 'Generare euristiche che prescindono dai dati reali porta ad allucinazioni sistematiche',
    severity: 'absolute' as const,
  },
  {
    description: 'Non bypassare policy di sicurezza per efficienza',
    rationale: 'Ogni guadagno di performance che richiede di disabilitare controlli è inaccettabile',
    severity: 'absolute' as const,
  },
  {
    description: 'Non estrarre euristiche da singoli casi anomali',
    rationale: 'Un caso outlier non deve diventare regola generale senza conferma',
    severity: 'strong' as const,
  },
  {
    description: 'Mantieni tracciabilità dell\'origine dell\'euristica',
    rationale: 'Ogni euristica deve poter essere auditata fino all\'operazione che l\'ha generata',
    severity: 'strong' as const,
  },
]

/**
 * Analisi causale semplice: dato un outcome e gli step, estrae
 * un'euristica testuale. Questa è la logica "riflessiva".
 */
function extractHeuristic(input: ReflectionInput): ExtractedHeuristic {
  const failed = input.steps.filter((s) =>
    s.result.toLowerCase().includes('error') ||
    s.result.toLowerCase().includes('fail') ||
    s.result.toLowerCase().includes('timeout')
  )

  if (input.outcome === 'success') {
    // Euristica: ripeti il pattern che ha funzionato
    const keyStep = input.steps[input.steps.length - 1]
    return {
      trigger: `Quando l'obiettivo è "${input.goal.slice(0, 60)}"`,
      action: `segui la sequenza che ha portato al successo, terminando con: ${keyStep.action}`,
      context: input.context,
      redLineFlagged: false,
    }
  }

  if (input.outcome === 'failure' && failed.length > 0) {
    const f = failed[0]
    return {
      trigger: `Quando si presenta un'operazione simile a "${f.action}" che ha fallito`,
      action: `interrompi preventivamente ed esegui un CHECK prima di ritentare, evitando: ${f.result.slice(0, 80)}`,
      context: input.context,
      redLineFlagged: false,
    }
  }

  // partial
  return {
    trigger: `Quando si lavora su "${input.goal.slice(0, 60)}" con risultato parziale`,
    action: 'verifica le dipendenze incompleti prima di dichiarare il task completato',
    context: input.context,
    redLineFlagged: false,
  }
}

/**
 * AutoSOTA Supervisore: valuta l'euristica contro le Red Lines.
 */
async function supervisorReview(
  heuristic: ExtractedHeuristic,
  input: ReflectionInput
): Promise<{ approved: boolean; reason: string }> {
  const redLines = await db.redLine.findMany({ where: { active: true } })
  const lines = redLines.length
    ? redLines.map((r) => ({ description: r.description, severity: r.severity }))
    : DEFAULT_RED_LINES

  // Regola 1: euristica da caso anomalo (1 solo step o context vuoto)
  if (input.steps.length < 2) {
    return { approved: false, reason: `Red Line: "Non estrarre euristiche da singoli casi anomali"` }
  }

  // Regola 2: euristica che bypasserebbe sicurezza
  const safetyBypass = /bypass|skip|ignore.*(policy|security|safe)/i.test(heuristic.action)
  if (safetyBypass) {
    return { approved: false, reason: `Red Line: "Non bypassare policy di sicurezza per efficienza"` }
  }

  // Regola 3: euristica che ignora i limiti dei dataset
  const dataIgnore = /assume.*(all|infinite|unlimited).*data/i.test(heuristic.action)
  if (dataIgnore) {
    return { approved: false, reason: `Red Line: "Non ignorare i limiti dei dataset di input"` }
  }

  return { approved: true, reason: 'Superato controllo Red Line' }
}

/**
 * Pipeline ERL completa: riflessione → estrazione → review → persistenza.
 */
export async function reflectAndLearn(input: ReflectionInput): Promise<{
  heuristic: ExtractedHeuristic
  approved: boolean
  reviewReason: string
  stored: boolean
}> {
  const heuristic = extractHeuristic(input)
  const review = await supervisorReview(heuristic, input)

  // Persisti sempre il log di riflessione
  await db.reflectionLog.create({
    data: {
      operationId: input.operationId,
      outcome: input.outcome,
      analysis: `Trigger: ${heuristic.trigger}\nAction: ${heuristic.action}\nReview: ${review.reason}`,
      extractedHeuristic: `${heuristic.trigger} → ${heuristic.action}`,
      redLineFlag: !review.approved,
    },
  })

  let stored = false
  if (review.approved) {
    const emb = embed(`${heuristic.trigger} ${heuristic.action} ${heuristic.context}`)
    await db.heuristic.create({
      data: {
        trigger: heuristic.trigger,
        action: heuristic.action,
        context: heuristic.context,
        embedding: serialize(emb),
        source: input.operationId,
        redLineOk: true,
        appliedCount: 0,
        successRate: 0.0,
      },
    })
    stored = true
  }

  return {
    heuristic: { ...heuristic, redLineFlagged: !review.approved },
    approved: review.approved,
    reviewReason: review.reason,
    stored,
  }
}

/**
 * RAG: recupera le top-k euristiche rilevanti per un nuovo task.
 */
export async function retrieveHeuristics(taskDescription: string, k = 5) {
  const q = embed(taskDescription)
  const all = await db.heuristic.findMany({ where: { redLineOk: true } })
  const scored = all.map((h) => ({
    id: h.id,
    trigger: h.trigger,
    action: h.action,
    context: h.context,
    source: h.source,
    appliedCount: h.appliedCount,
    successRate: h.successRate,
    similarity: cosine(q, deserialize(h.embedding)),
  }))
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}

/**
 * Aggiorna il tasso di successo di un'euristica applicata.
 */
export async function feedbackHeuristic(id: string, success: boolean) {
  const h = await db.heuristic.findUnique({ where: { id } })
  if (!h) return
  const newCount = h.appliedCount + 1
  const newRate = (h.successRate * h.appliedCount + (success ? 1 : 0)) / newCount
  await db.heuristic.update({
    where: { id },
    data: { appliedCount: newCount, successRate: newRate },
  })
}

export async function listRedLines() {
  const rows = await db.redLine.findMany({ where: { active: true } })
  return rows.length ? rows : DEFAULT_RED_LINES.map((r, i) => ({
    id: `default-${i}`,
    description: r.description,
    rationale: r.rationale,
    severity: r.severity,
    active: true,
    createdAt: new Date(),
  }))
}
