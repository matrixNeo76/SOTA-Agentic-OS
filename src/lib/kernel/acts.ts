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
import { generateTimeSortableId } from '@/lib/utils'

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

/**
 * Decide la prossima strategia in base allo stato del ciclo.
 * Logica deterministica (rule-based, no LLM qui → O(1)).
 */
export function decideStrategy(state: {
  step: number
  lastStrategy: Strategy
  lastCheckPassed: boolean | null
  budgetRemaining: number
  errorsConsecutive: number
}): Strategy {
  const { step, lastStrategy, lastCheckPassed, budgetRemaining, errorsConsecutive } = state

  // HALT conditions
  if (budgetRemaining < 50) return 'HALT'
  if (errorsConsecutive >= 3) return 'CHECK'

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
 * G1 (ACTS audit) — Ora persiste anche lo stato FSM su SteeringState.
 * Questo permette di riprendere un ciclo cognitivo interrotto (es. dopo
 * refresh browser) e condividere lo stato tra UI, executor e API.
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
): Promise<{ strategy: Strategy; phrase: string; tokenUsed: number; budgetRemaining: number }> {
  // B6 — cycleCounter (ex module-level) era incrementato ma mai letto.
  // Rimosso: cycleId basato su generateTimeSortableId() è già unico.
  // UUID v7 time-sortable: timestamp + counter casuale
  const cycleId = generateTimeSortableId()
  const budgetRemaining = budgetTotal - budgetUsed
  const strategy = decideStrategy({
    step, lastStrategy, lastCheckPassed, budgetRemaining, errorsConsecutive,
  })
  const entry = STEERING_VOCABULARY[strategy]
  const tokenUsed = entry.budgetCost

  await db.steeringEvent.create({
    data: {
      cycleId,
      agentId,
      strategy,
      phrase: entry.phrase,
      tokenBudget: budgetTotal,
      tokenUsed,
    },
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
