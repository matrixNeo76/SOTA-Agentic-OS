/**
 * ACTS: Agentic Chain-of-Thought Steering (Fase 3)
 *
 * Un Controller ultraleggero osserva il tracciato di reasoning del modello
 * principale. Ad ogni passo decide la strategia (PLAN/EXECUTE/CHECK/REFLECT)
 * e invia una "steering phrase" per innescare deterministicamente quel
 * comportamento nel motore principale.
 *
 * Budget di token O(1) per decisione.
 */
import { db } from '@/lib/db'

export type Strategy = 'PLAN' | 'EXECUTE' | 'CHECK' | 'REFLECT' | 'HALT'

export const STEERING_VOCABULARY: Record<Strategy, { phrase: string; budgetCost: number; description: string }> = {
  PLAN: {
    phrase: 'Prima di procedere, strutturiamo un piano esplicito in passaggi numerati.',
    budgetCost: 80,
    description: 'Forza la decomposizione del task in sotto-obiettivi ordinati.',
  },
  EXECUTE: {
    phrase: 'Ora esegui il prossimo passo del piano, mostrando l\'output intermedio.',
    budgetCost: 120,
    description: 'Innesca l\'esecuzione concreta del prossimo step pianificato.',
  },
  CHECK: {
    phrase: 'Aspetta, lasciami verificare: il risultato parziale è coerente con i vincoli?',
    budgetCost: 60,
    description: 'Attiva una fase di auto-verifica sui risultati intermedi.',
  },
  REFLECT: {
    phrase: 'Rifletti su cosa ha funzionato e cosa migliorare, poi proponi una regola.',
    budgetCost: 100,
    description: 'Attiva la modalità riflessiva per estrarre euristiche.',
  },
  HALT: {
    phrase: 'Stop: budget esaurito o soglia di sicurezza raggiunta.',
    budgetCost: 0,
    description: 'Ferma il ciclo cognitivo per budget o policy.',
  },
}

// B1 (Fase B) — HALT threshold default. Può essere override per call via haltThreshold param.
export const DEFAULT_HALT_THRESHOLD = 50

// B2 (Fase B) — errorsConsecutive threshold default per forzare CHECK.
export const DEFAULT_ERRORS_CONSECUTIVE_THRESHOLD = 3

// G4 (Fase C) — REFLECT trigger: ogni N step, se ci sono stati check passati,
// il controller entra in modalità riflessiva per consolidare euristiche.
export const DEFAULT_REFLECT_INTERVAL = 10

// B5 (Fase B) — Valori ammissibili per lastStrategy (validation API)
export const VALID_STRATEGIES: readonly Strategy[] = ['PLAN', 'EXECUTE', 'CHECK', 'REFLECT', 'HALT'] as const

/**
 * Decide la prossima strategia in base allo stato del ciclo.
 * Logica deterministica (rule-based, no LLM qui → O(1)).
 *
 * B1 fix (Fase B) — haltThreshold è configurabile (default 50). Per task con
 * budget 100 è troppo aggressivo (HALT al 50%); per budget 10000 è quasi mai
 * (HALT a 9950). Ora il caller può passare haltThreshold proporzionale al budget.
 *
 * B2 fix (Fase B) — errorsConsecutiveThreshold configurabile (default 3).
 * Documentato: il caller DEVE resettare errorsConsecutive a 0 su success
 * (CHECK passato). Su failure, il caller DEVE incrementare errorsConsecutive.
 *
 * G4 fix (Fase C) — REFLECT transizione: ogni `reflectInterval` step (default 10),
 * se step > 0 e non ci sono errori consecutivi, ritorna REFLECT per consolidare
 * euristiche. PRIMA: REFLECT era dead code (decideStrategy non la ritornava mai).
 *
 * G2.1 fix (Fase C) — Integrazione Phase 11 (Affect):
 *   - se affectDesperation >= affectHaltThreshold → HALT forzato (ignora budget)
 *   - se affectFrustration >= affectCheckThreshold → CHECK forzato (ignora errors)
 * L'integrazione è opzionale (i parametri affect sono undefined di default),
 * così decideStrategy resta testabile in isolamento.
 */
export function decideStrategy(state: {
  step: number
  lastStrategy: Strategy
  lastCheckPassed: boolean | null
  budgetRemaining: number
  errorsConsecutive: number
  // B1 — threshold configurable per HALT (default DEFAULT_HALT_THRESHOLD)
  haltThreshold?: number
  // B2 — threshold configurable per forzare CHECK (default 3)
  errorsConsecutiveThreshold?: number
  // G4 — intervallo per trigger REFLECT (default 10). 0 = disabilitato.
  reflectInterval?: number
  // G2.1 — Affect context (Phase 11). undefined = integrazione disattivata.
  affectDesperation?: number
  affectFrustration?: number
  affectHaltThreshold?: number
  affectCheckThreshold?: number
}): Strategy {
  const {
    step, lastStrategy, lastCheckPassed, budgetRemaining, errorsConsecutive,
    haltThreshold = DEFAULT_HALT_THRESHOLD,
    errorsConsecutiveThreshold = DEFAULT_ERRORS_CONSECUTIVE_THRESHOLD,
    reflectInterval = DEFAULT_REFLECT_INTERVAL,
    affectDesperation,
    affectFrustration,
    affectHaltThreshold = DEFAULT_AFFECT_HALTERN_THRESHOLD,
    affectCheckThreshold = DEFAULT_AFFECT_CHECK_THRESHOLD,
  } = state

  // G2.1 — Affect-driven HALT: desperation critica (Phase 11) → HALT immediato
  // Indipendente dal budget: l'agente è in stato di "panico cognitivo".
  if (affectDesperation !== undefined && affectDesperation >= affectHaltThreshold) {
    return 'HALT'
  }

  // HALT conditions (budget)
  if (budgetRemaining < haltThreshold) return 'HALT'

  // G2.1 — Affect-driven CHECK: frustration alta (Phase 11) → CHECK forzato
  // Anche se errorsConsecutive è sotto threshold: l'agente è frustrato, deve verificare.
  if (affectFrustration !== undefined && affectFrustration >= affectCheckThreshold) {
    return 'CHECK'
  }

  if (errorsConsecutive >= errorsConsecutiveThreshold) return 'CHECK'

  // G4 — REFLECT trigger: ogni `reflectInterval` step, se non siamo in stato
  // di errore e non siamo già in REFLECT (per evitare loop REFLECT→PLAN→REFLECT).
  // Esegue PRIMA delle transizioni FSM normali per permettere il consolidamento
  // periodico delle euristiche apprese.
  if (
    reflectInterval > 0 &&
    step > 0 &&
    step % reflectInterval === 0 &&
    lastStrategy !== 'REFLECT' &&
    errorsConsecutive === 0
  ) {
    return 'REFLECT'
  }

  // Flusso PLAN -> EXECUTE -> CHECK -> (loop) -> REFLECT
  if (step === 0) return 'PLAN'
  if (lastStrategy === 'PLAN') return 'EXECUTE'
  if (lastStrategy === 'EXECUTE') return 'CHECK'
  if (lastStrategy === 'CHECK') {
    return lastCheckPassed === false ? 'PLAN' : 'EXECUTE'
  }
  if (lastStrategy === 'REFLECT') return 'PLAN'
  // fallback
  return 'EXECUTE'
}

/**
 * Esegue uno steering event: decide, registra, consuma budget.
 *
 * G1 (Fase A) — Persiste lo stato FSM su SteeringState.
 * C3 (Fase B) — cycleId ora String (cuid generato dal DB default), non più
 *               generateTimeSortableId() con collision risk ~1%.
 * B1 (Fase B) — haltThreshold configurabile.
 * B7 (Fase B) — Idempotency: stesso (agentId, planId, step) non crea duplicati
 *               (unique constraint su SteeringEvent + lookup pre-create).
 */
export async function steer(
  agentId: string,
  budgetTotal: number,
  budgetUsed: number,
  step: number,
  lastStrategy: Strategy,
  lastCheckPassed: boolean | null,
  errorsConsecutive: number,
  // G1 — planId opzionale per associare lo stato a un piano specifico
  planId?: string,
  // B1 — haltThreshold override (default 50)
  haltThreshold?: number,
  // G4 — reflectInterval override (default 10, 0 = disable)
  reflectInterval?: number,
  // G2.1 — Affect context override (default: legge da Phase 11 se non fornito)
  affectDesperation?: number,
  affectFrustration?: number,
  // G2.3 — Prompt per Phase 14 model routing (default: usa lastStrategy come hint)
  routingPrompt?: string,
): Promise<{
  strategy: Strategy
  phrase: string
  tokenUsed: number
  budgetRemaining: number
  cycleId: string
  idempotent: boolean
  // G2.3 — Modello suggerito da Phase 14 (null se router non disponibile o HALT)
  routedModel?: { modelId: string; confidence: number; routedTo: string } | null
  // G2.1 — Affect context usato per decidere (null se Phase 11 non disponibile)
  affectContext?: { desperation: number; frustration: number; intervention: string | null } | null
}> {
  // G2.1 — Leggi affect context da Phase 11 se non fornito dal caller.
  // Questo permette a decideStrategy di considerare lo stato affettivo dell'agente.
  let affectContext: { desperation: number; frustration: number; intervention: string | null } | null = null
  if (affectDesperation === undefined && affectFrustration === undefined) {
    const ctx = await getAffectContext(agentId)
    if (ctx) {
      affectContext = {
        desperation: ctx.desperation,
        frustration: ctx.frustration,
        intervention: ctx.intervention,
      }
      affectDesperation = ctx.desperation
      affectFrustration = ctx.frustration
    }
  } else {
    affectContext = {
      desperation: affectDesperation ?? 0,
      frustration: affectFrustration ?? 0,
      intervention: null,
    }
  }

  const budgetRemaining = budgetTotal - budgetUsed
  const strategy = decideStrategy({
    step, lastStrategy, lastCheckPassed, budgetRemaining, errorsConsecutive,
    haltThreshold,
    reflectInterval,
    affectDesperation,
    affectFrustration,
  })

  // G2.3 — Suggerisci modello specializzato da Phase 14 (TimeRouter).
  // Non bloccante: se il router fallisce, routedModel resta null.
  const routingPromptForStrategy = routingPrompt || `ACTS strategy: ${strategy}`
  const routedModel = await getRoutedModel(strategy, agentId, routingPromptForStrategy)

  // G3 fix (Fase C) — Consulta SteeringStrategy DB per override di phrase/budgetCost.
  // PRIMA: steer() usava sempre STEERING_VOCABULARY hardcoded, ignorando il DB.
  // ORA: se esiste record attivo per la strategia, usa triggerPhrase + budgetCost dal DB.
  // Fallback a STEERING_VOCABULARY solo se record non esiste o active=false.
  const customStrategy = await db.steeringStrategy.findUnique({
    where: { name: strategy },
  }).catch(() => null)

  const entry = customStrategy && customStrategy.active
    ? {
        phrase: customStrategy.triggerPhrase,
        budgetCost: customStrategy.budgetCost,
        description: customStrategy.description || STEERING_VOCABULARY[strategy].description,
      }
    : STEERING_VOCABULARY[strategy]
  const tokenUsed = entry.budgetCost

  // B7 — Idempotency: se esiste già un SteeringEvent per (agentId, planId, step),
  // ritorna quello esistente senza crearne uno nuovo. Previene duplicati su retry.
  const planIdForKey = planId || null
  const existing = await db.steeringEvent.findUnique({
    where: {
      agentId_planId_step: { agentId, planId: planIdForKey as any, step },
    } as any,
    select: { id: true, cycleId: true, strategy: true, phrase: true, tokenUsed: true, tokenBudget: true },
  }).catch(() => null)

  if (existing) {
    // Idempotent: ritorna l'evento esistente (con routedModel/affectContext ricalcolati)
    return {
      strategy: existing.strategy as Strategy,
      phrase: existing.phrase,
      tokenUsed: existing.tokenUsed,
      budgetRemaining: existing.tokenBudget - existing.tokenUsed,
      cycleId: existing.cycleId,
      idempotent: true,
      routedModel,
      affectContext,
    }
  }

  // C3 — cycleId generato dal DB default (cuid string), non più generateTimeSortableId()
  const created = await db.steeringEvent.create({
    data: {
      agentId,
      planId: planIdForKey,
      step,
      strategy,
      phrase: entry.phrase,
      tokenBudget: budgetTotal,
      tokenUsed,
    },
    select: { id: true, cycleId: true },
  })

  // G1 — Upsert dello stato FSM su SteeringState (per piano + agent, o solo agent)
  const stateKey = { agentId_planId: { agentId, planId: planId || null } }
  try {
    await db.steeringState.upsert({
      where: stateKey as any,
      create: {
        agentId,
        planId: planId || null,
        step,
        lastStrategy: strategy, // salva la strategia DECISA, non l'input
        lastCheckPassed,
        errorsConsecutive,
        budgetTotal,
        budgetUsed: budgetUsed + tokenUsed,
      },
      update: {
        step,
        lastStrategy: strategy, // aggiorna con la strategia appena decisa
        lastCheckPassed,
        errorsConsecutive,
        budgetTotal,
        budgetUsed: budgetUsed + tokenUsed,
      },
    })
  } catch {
    // Non bloccante: l'evento è già persistito su SteeringEvent
  }

  return {
    strategy,
    phrase: entry.phrase,
    tokenUsed,
    budgetRemaining: budgetRemaining - tokenUsed,
    cycleId: created.cycleId,
    idempotent: false,
    routedModel,
    affectContext,
  }
}

/**
 * G1 (ACTS audit) — Recupera lo stato FSM persistito per un agent (+ optional planId).
 * Ritorna null se non c'è stato precedente (prima chiamata).
 */
export async function getSteeringState(agentId: string, planId?: string): Promise<{
  step: number
  lastStrategy: Strategy
  lastCheckPassed: boolean | null
  errorsConsecutive: number
  budgetTotal: number
  budgetUsed: number
  updatedAt: Date
} | null> {
  const state = await db.steeringState.findUnique({
    where: { agentId_planId: { agentId, planId: planId || null } } as any,
  })
  if (!state) return null
  return {
    step: state.step,
    lastStrategy: state.lastStrategy as Strategy,
    lastCheckPassed: state.lastCheckPassed,
    errorsConsecutive: state.errorsConsecutive,
    budgetTotal: state.budgetTotal,
    budgetUsed: state.budgetUsed,
    updatedAt: state.updatedAt,
  }
}

/**
 * G1 (ACTS audit) — Reset dello stato FSM per ricominciare un ciclo.
 */
export async function resetSteeringState(agentId: string, planId?: string): Promise<void> {
  await db.steeringState.deleteMany({
    where: { agentId, planId: planId || null },
  })
}

// === G2 (Fase C) — Cross-module integrations ======================

/**
 * G2.1 — Legge le ultime metriche affettive (Phase 11) per un agente.
 * Ritorna null se non ci sono sample affettivi registrati.
 *
 * Usato da decideStrategy per:
 *   - forzare HALT se desperation >= soglia critica
 *   - forzare CHECK se frustration alta (anche senza errorsConsecutive)
 */
export async function getAffectContext(agentId: string): Promise<{
  desperation: number
  frustration: number
  intervention: string | null
  timestamp: Date
} | null> {
  try {
    const { db: dbInstance } = await import('@/lib/db')
    const lastSample = await dbInstance.affectSample.findFirst({
      where: { agentId },
      orderBy: { timestamp: 'desc' },
      select: { desperation: true, frustration: true, intervention: true, timestamp: true },
    })
    if (!lastSample) return null
    return {
      desperation: lastSample.desperation,
      frustration: lastSample.frustration,
      intervention: lastSample.intervention || null,
      timestamp: lastSample.timestamp,
    }
  } catch {
    return null
  }
}

/**
 * G2.1 — Soglia default per forzare HALT da desperation (Phase 11).
 * Se desperation dell'agente >= questo valore, decideStrategy ritorna HALT
 * indipendentemente dal budget rimanente.
 */
export const DEFAULT_AFFECT_HALTERN_THRESHOLD = 0.85

/**
 * G2.1 — Soglia default per forzare CHECK da frustration (Phase 11).
 * Se frustration dell'agente >= questo valore, decideStrategy ritorna CHECK
 * anche se errorsConsecutive è sotto la threshold normale.
 */
export const DEFAULT_AFFECT_CHECK_THRESHOLD = 0.7

/**
 * G2.2 — Triggera la riflessione ERL (Phase 5) per consolidare euristiche.
 * Da chiamare quando decideStrategy ritorna REFLECT.
 *
 * @param agentId - Agente che sta riflettendo
 * @param planId - Piano associato (opzionale)
 * @param outcome - 'success' | 'failure' | 'partial'
 * @param steps - Steps eseguiti nel ciclo (per contesto)
 * @param context - Contesto aggiuntivo (goal, errori, etc.)
 * @returns Result della riflessione (heuristic estratta, approved, stored)
 */
export async function triggerErlReflection(params: {
  agentId: string
  planId?: string
  outcome: 'success' | 'failure' | 'partial'
  steps?: Array<{ action: string; result: string }>
  context?: string
}): Promise<{
  heuristicTrigger: string
  heuristicAction: string
  approved: boolean
  stored: boolean
  reviewReason: string
} | null> {
  try {
    const { reflectAndLearn } = await import('@/lib/kernel/erl')
    const result = await reflectAndLearn({
      operationId: `${params.agentId}:${params.planId || 'standalone'}:${Date.now()}`,
      goal: params.context || `Steering cycle for agent ${params.agentId}`,
      outcome: params.outcome,
      steps: params.steps || [],
      context: params.context || `Plan: ${params.planId || 'standalone'}.`,
    })
    return {
      heuristicTrigger: result.heuristic.trigger,
      heuristicAction: result.heuristic.action,
      approved: result.approved,
      stored: result.stored,
      reviewReason: result.reviewReason,
    }
  } catch {
    return null
  }
}

/**
 * G2.3 — Suggerisce un modello specializzato (Phase 14) per la strategia corrente.
 * Da chiamare per scegliere il modello LLM più adatto alla strategia ACTS.
 *
 * Mappatura strategia → preferenza modello:
 *   - PLAN: modello con specializzazione 'reasoning' (più riflessivo)
 *   - EXECUTE: modello con specializzazione 'coding' (più esecutivo)
 *   - CHECK: modello con specializzazione 'reasoning' (verifica logica)
 *   - REFLECT: modello con specializzazione 'reasoning' (sintesi euristiche)
 *   - HALT: nessun modello richiesto
 *
 * @returns modelId suggerito + confidence, o null se router non disponibile
 */
export async function getRoutedModel(
  strategy: Strategy,
  agentId: string,
  prompt: string,
): Promise<{
  modelId: string
  confidence: number
  routedTo: 'primary' | 'ensemble' | 'critic'
} | null> {
  if (strategy === 'HALT') return null
  try {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route(agentId, prompt)
    return {
      modelId: result.primaryModel,
      confidence: result.confidence,
      routedTo: result.routedTo,
    }
  } catch {
    return null
  }
}

/**
 * Storia degli eventi steering per un agente.
 */
export async function steeringHistory(agentId: string, limit = 20) {
  return db.steeringEvent.findMany({
    where: { agentId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
}
