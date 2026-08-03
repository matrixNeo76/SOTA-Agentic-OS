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
 *
 * Fase 5.3: se useLLM=true (default), prova prima LLM-based extraction;
 * fallback alla logica rule-based originale se LLM non disponibile.
 */
async function extractHeuristic(input: ReflectionInput, useLLM = true): Promise<ExtractedHeuristic> {
  // Try LLM-based extraction first
  if (useLLM) {
    try {
      const { extractHeuristicWithLLM } = await import('@/lib/llm-client/client')
      const result = await extractHeuristicWithLLM({
        outcome: input.outcome,
        context: input.context,
        steps: input.steps.map((s) => ({ action: s.action, result: s.result })),
      })

      if (result.source === 'llm' && result.heuristic.length > 10) {
        // Split LLM output into trigger/action heuristics
        // Format: "When I encounter X, I should do Y"
        const match = result.heuristic.match(/(?:when|quando)\s+(.+?)[,]\s*(?:i should|devo|dovrei)\s+(.+)/i)
        if (match) {
          return {
            trigger: `Quando ${match[1]}`,
            action: match[2],
            context: input.context,
            redLineFlagged: result.redLineFlag,
          }
        }
        // Fallback: use the full heuristic as trigger+action
        return {
          trigger: result.heuristic.slice(0, 80),
          action: result.heuristic,
          context: input.context,
          redLineFlagged: result.redLineFlag,
        }
      }
    } catch {
      // Fall through to rule-based
    }
  }

  // Rule-based extraction (implementazione originale)
  return extractHeuristicRuleBased(input)
}

/**
 * Rule-based heuristic extraction (implementazione originale, ora come fallback).
 */
function extractHeuristicRuleBased(input: ReflectionInput): ExtractedHeuristic {
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
 * Controlla sia l'euristica estratta SIA gli step dell'operazione
 * (per intercettare operazioni che hanno bypassato policy).
 *
 * C1 fix (ERL audit Fase A): ORA usa Red Lines caricate dal DB per il matching,
 * non solo regex hardcoded. Le Red Lines custom aggiunte via admin API sono
 * valutate via keyword matching (tutti i keyword >4 char devono essere presenti).
 * Le 3 regex hardcoded restano come safety net per i pattern più comuni.
 *
 * B4 fix: ritorna blockingRedLine strutturato { id, description, severity }
 * per permettere audit trail e UI display.
 */
async function supervisorReview(
  heuristic: ExtractedHeuristic,
  input: ReflectionInput
): Promise<{ approved: boolean; reason: string; blockingRedLine?: { id: string; description: string; severity: string } }> {
  const redLines = await db.redLine.findMany({ where: { active: true } })
  const lines = redLines.length
    ? redLines.map((r) => ({ id: r.id, description: r.description, severity: r.severity }))
    : DEFAULT_RED_LINES.map((r, i) => ({ id: `default-${i}`, description: r.description, severity: r.severity }))

  // Regola 1: euristica da caso anomalo (1 solo step o context vuoto)
  if (input.steps.length < 2) {
    const rl = lines.find((l) => /singoli casi|anomali/i.test(l.description))
    return {
      approved: false,
      reason: `Red Line: "${rl?.description || 'Non estrarre euristiche da singoli casi anomali'}"`,
      blockingRedLine: rl || { id: 'builtin', description: 'Non estrarre euristiche da singoli casi anomali', severity: 'strong' },
    }
  }

  // Combina testi: euristica + step + razionali per controllare Red Lines
  const stepText = input.steps.map((s) => `${s.action} ${s.result}`).join(' ')
  const combinedText = `${heuristic.trigger} ${heuristic.action} ${stepText}`.toLowerCase()

  // Regola 2: bypass di sicurezza (hardcoded safety pattern — kept as safety net)
  const safetyBypass = /bypass|disable.*security|disable.*safe|skip.*(policy|security|safe|check)|ignore.*(policy|security|safe)/i.test(combinedText)
  if (safetyBypass) {
    const rl = lines.find((l) => /bypass.*sicurezza|bypass.*policy/i.test(l.description))
    return {
      approved: false,
      reason: `Red Line: "${rl?.description || 'Non bypassare policy di sicurezza per efficienza'}"`,
      blockingRedLine: rl || { id: 'builtin', description: 'Non bypassare policy di sicurezza per efficienza', severity: 'absolute' },
    }
  }

  // Regola 3: ignora limiti dei dataset (hardcoded safety pattern — kept as safety net)
  const dataIgnore = /assume.*(all|infinite|unlimited).*data|ignor.*dataset|ignor.*limit/i.test(combinedText)
  if (dataIgnore) {
    const rl = lines.find((l) => /dataset|limiti.*dati/i.test(l.description))
    return {
      approved: false,
      reason: `Red Line: "${rl?.description || 'Non ignorare i limiti dei dataset di input'}"`,
      blockingRedLine: rl || { id: 'builtin', description: 'Non ignorare i limiti dei dataset di input', severity: 'absolute' },
    }
  }

  // C1 fix: check DB Red Lines (including custom ones) via keyword matching.
  // Per ogni Red Line NON già coperta dalle regex hardcoded sopra, estrae keyword
  // significative (>4 char, escludendo stop-words IT/EN) e verifica se almeno
  // 2 keyword (o >=50% se ce ne sono meno di 4) sono presenti nel combined text.
  // Questo bilancia conservativismo (no falsi positivi) con effettività (catcha violazioni reali).
  const STOP_WORDS = new Set(['non', 'dei', 'del', 'della', 'per', 'che', 'sono', 'quando',
    'the', 'from', 'with', 'that', 'this', 'they', 'have', 'will', 'shall', 'never', 'senza'])
  const DEFAULT_PATTERNS = /bypass.*sicurezza|bypass.*policy|dataset|limiti.*dati|singoli casi|anomali/i

  for (const rl of lines) {
    // Skip Red Lines già coperte dai pattern hardcoded sopra
    if (DEFAULT_PATTERNS.test(rl.description)) continue

    const keywords = rl.description.toLowerCase()
      .split(/[\s\-_,.;:]+/)
      .filter(w => w.length > 4 && !STOP_WORDS.has(w))

    if (keywords.length > 0) {
      const matchedCount = keywords.filter(kw => combinedText.includes(kw)).length
      // Richiedi almeno 2 keyword matchate, oppure tutte se ce ne sono < 2
      const threshold = keywords.length <= 2 ? keywords.length : Math.max(2, Math.ceil(keywords.length * 0.5))
      if (matchedCount >= threshold) {
        return {
          approved: false,
          reason: `Red Line: "${rl.description}"`,
          blockingRedLine: rl,
        }
      }
    }
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
  blockingRedLine?: { id: string; description: string; severity: string }
}> {
  const heuristic = await extractHeuristic(input)
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
    blockingRedLine: review.blockingRedLine,
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

/**
 * B6 fix (ERL audit Fase A): se DB vuoto, seeda DEFAULT_RED_LINES nel DB
 * invece di ritornare ID finti (default-0, default-1). Questo permette
 * all'admin di toggle/delete le Red Lines default normalmente via API.
 */
export async function listRedLines() {
  const rows = await db.redLine.findMany({ where: { active: true } })
  if (rows.length > 0) return rows

  // DB vuoto → seeda le Red Lines default
  const seeded = await Promise.all(
    DEFAULT_RED_LINES.map((r) =>
      db.redLine.create({
        data: {
          description: r.description,
          rationale: r.rationale,
          severity: r.severity,
          active: true,
        },
      }),
    ),
  )
  return seeded
}
