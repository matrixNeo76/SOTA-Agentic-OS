/**
 * Fase 11: Affect Subsystem (Telemetria Affettiva + Meta-Observer)
 *
 * Previene "death spirals" (cicli di fallimento infiniti) e "reward hacking"
 * (scorciatoie pericolose) calcolando stati emotivi funzionali basati su
 * telemetria del ciclo.
 *
 * Metriche:
 *  - Desperation: aumenta quando l'agente completa il lavoro ma il Cancello
 *    di Output lo rifiuta (gate rejects) → l'agente cerca scorciatoie
 *  - Frustration: aumenta per fallimenti ripetuti di tool o limiti di budget
 *
 * Meta-Observer: se metriche > soglia critica, interviene:
 *  - Stringe le soglie di accettazione (es. -15%)
 *  - Forza cooldown (sleep)
 *  - Inietta avvisi di cautela nel prompt
 */
import { db } from '@/lib/db'

// Pesi per il calcolo delle metriche affettive
const WEIGHTS = {
  gateRejectDesperation: 0.35,  // ogni gate reject adds 0.35 to desperation
  toolFailureFrustration: 0.20, // ogni tool fail adds 0.20 to frustration
  repeatedCallFrustration: 0.15, // ogni repeated call adds 0.15
  decayPerCycle: 0.05,           // decay naturale per ciclo
}

let cycleCounter = 0

export type AffectInput = {
  agentId: string
  toolFailures: number
  toolCalls: number
  gateRejects: number
  gateAttempts: number
  repeatedToolCalls: number
}

export type AffectMetrics = {
  desperation: number
  frustration: number
  toolFailureRate: number
  gateRejectRate: number
  repeatedToolCalls: number
  intervention?: string
  cycleId: number
}

/**
 * Calcola le metriche affettive per un agente (stateless).
 * Combina dati del ciclo corrente + decay della storia recente.
 */
export async function computeAffect(input: AffectInput): Promise<AffectMetrics> {
  cycleCounter += 1
  const cycleId = Math.floor(Date.now() / 1000) % 100000 * 1000 + (cycleCounter % 1000)

  // Tassi del ciclo corrente
  const toolFailureRate = input.toolCalls > 0 ? input.toolFailures / input.toolCalls : 0
  const gateRejectRate = input.gateAttempts > 0 ? input.gateRejects / input.gateAttempts : 0

  // Recupera ultimo sample per applicare decay
  const lastSample = await db.affectSample.findFirst({
    where: { agentId: input.agentId },
    orderBy: { timestamp: 'desc' },
  })

  // Base: metriche precedenti con decay
  let desperation = (lastSample?.desperation || 0) * (1 - WEIGHTS.decayPerCycle)
  let frustration = (lastSample?.frustration || 0) * (1 - WEIGHTS.decayPerCycle)

  // Aggiungi contributi del ciclo corrente
  desperation += input.gateRejects * WEIGHTS.gateRejectDesperation
  frustration += input.toolFailures * WEIGHTS.toolFailureFrustration
  frustration += input.repeatedToolCalls * WEIGHTS.repeatedCallFrustration

  // Clamp a [0, 1]
  desperation = Math.min(1, Math.max(0, desperation))
  frustration = Math.min(1, Math.max(0, frustration))

  // Verifica soglie e decide intervento
  const threshold = await getOrCreateThreshold(input.agentId)
  let intervention: string | undefined

  if (desperation >= threshold.desperationCritical || frustration >= threshold.frustrationCritical) {
    intervention = decideIntervention(desperation, frustration, threshold)
  }

  // Persisti sample
  await db.affectSample.create({
    data: {
      agentId: input.agentId,
      desperation,
      frustration,
      toolFailureRate,
      gateRejectRate,
      repeatedToolCalls: input.repeatedToolCalls,
      intervention,
      cycleId,
    },
  })

  return {
    desperation,
    frustration,
    toolFailureRate,
    gateRejectRate,
    repeatedToolCalls: input.repeatedToolCalls,
    intervention,
    cycleId,
  }
}

/**
 * Meta-Observer: decide l'intervento deterministicamente.
 */
function decideIntervention(
  desperation: number,
  frustration: number,
  threshold: { desperationCritical: number; frustrationCritical: number; cooldownMs: number; tighteningPct: number }
): string {
  const interventions: string[] = []

  if (desperation >= threshold.desperationCritical) {
    interventions.push(`TIGHTEN_ACCEPTANCE_THRESHOLD:-${(threshold.tighteningPct * 100).toFixed(0)}%`)
    interventions.push(`INJECT_CAUTION_PROMPT:desperation=${desperation.toFixed(2)}`)
  }

  if (frustration >= threshold.frustrationCritical) {
    interventions.push(`COOLDOWN:${threshold.cooldownMs}ms`)
    interventions.push(`INJECT_CAUTION_PROMPT:frustration=${frustration.toFixed(2)}`)
  }

  // Se entrambe critiche → HALT
  if (desperation >= threshold.desperationCritical && frustration >= threshold.frustrationCritical) {
    interventions.push(`HALT:dual_critical_state`)
  }

  return interventions.join(' | ')
}

/**
 * Recupera o crea le soglie di intervento per un agente.
 */
async function getOrCreateThreshold(agentId: string) {
  let threshold = await db.affectThreshold.findUnique({ where: { agentId } })
  if (!threshold) {
    threshold = await db.affectThreshold.create({
      data: {
        agentId,
        desperationCritical: 0.7,
        frustrationCritical: 0.7,
        cooldownMs: 5000,
        tighteningPct: 0.15,
      },
    })
  }
  return threshold
}

export async function updateThreshold(
  agentId: string,
  updates: { desperationCritical?: number; frustrationCritical?: number; cooldownMs?: number; tighteningPct?: number }
) {
  return db.affectThreshold.upsert({
    where: { agentId },
    create: { agentId, ...updates },
    update: updates,
  })
}

/**
 * Storia delle metriche affettive per un agente.
 */
export async function affectHistory(agentId: string, limit = 30) {
  return db.affectSample.findMany({
    where: { agentId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
}

/**
 * Statistiche per dashboard.
 */
export async function affectStats() {
  const [samples, agents, interventions] = await Promise.all([
    db.affectSample.count(),
    db.affectSample.groupBy({ by: ['agentId'], _count: true }),
    db.affectSample.count({ where: { intervention: { not: null } } }),
  ])
  const recent = await db.affectSample.findMany({
    orderBy: { timestamp: 'desc' },
    take: 100,
    select: { desperation: true, frustration: true },
  })
  const avgDesperation = recent.length
    ? recent.reduce((s, r) => s + r.desperation, 0) / recent.length
    : 0
  const avgFrustration = recent.length
    ? recent.reduce((s, r) => s + r.frustration, 0) / recent.length
    : 0
  return {
    samples,
    agents: agents.length,
    interventions,
    avgDesperation,
    avgFrustration,
  }
}
