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

let cycleCounter = 0

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
 */
export async function steer(
  agentId: string,
  budgetTotal: number,
  budgetUsed: number,
  step: number,
  lastStrategy: Strategy,
  lastCheckPassed: boolean | null,
  errorsConsecutive: number
): Promise<{ strategy: Strategy; phrase: string; tokenUsed: number; budgetRemaining: number }> {
  cycleCounter += 1
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

  return {
    strategy,
    phrase: entry.phrase,
    tokenUsed,
    budgetRemaining: budgetRemaining - tokenUsed,
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
