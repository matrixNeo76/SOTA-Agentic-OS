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
}): Strategy {
  const {
    step, lastStrategy, lastCheckPassed, budgetRemaining, errorsConsecutive,
    haltThreshold = DEFAULT_HALT_THRESHOLD,
    errorsConsecutiveThreshold = DEFAULT_ERRORS_CONSECUTIVE_THRESHOLD,
    reflectInterval = DEFAULT_REFLECT_INTERVAL,
  } = state

  // HALT conditions
  if (budgetRemaining < haltThreshold) return 'HALT'
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
): Promise<{ strategy: Strategy; phrase: string; tokenUsed: number; budgetRemaining: number; cycleId: string; idempotent: boolean }> {
  const budgetRemaining = budgetTotal - budgetUsed
  const strategy = decideStrategy({
    step, lastStrategy, lastCheckPassed, budgetRemaining, errorsConsecutive,
    haltThreshold,
    reflectInterval,
  })

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
    // Idempotent: ritorna l'evento esistente
    return {
      strategy: existing.strategy as Strategy,
      phrase: existing.phrase,
      tokenUsed: existing.tokenUsed,
      budgetRemaining: existing.tokenBudget - existing.tokenUsed,
      cycleId: existing.cycleId,
      idempotent: true,
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
