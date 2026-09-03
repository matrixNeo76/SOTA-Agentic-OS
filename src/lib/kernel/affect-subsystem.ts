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

// N6 FIX: removed module-level cycleCounter — was causing cycleId collisions
// in multi-instance/serverless. Now uses DB-backed count for unique cycleId.

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
 *
 * C2 fix (Affect Monitor audit Fase A): cycleId race condition eliminata.
 * PRIMA: N6 fix usava `sampleCount` come offset, ma 2 computeAffect simultanee
 * leggevano entrambe sampleCount=N prima del persist → stessa cycleId (collisione).
 * ORA: usa timestamp millisecondi + random offset 0-999 — collisione possibile
 * solo se 2 chiamate avvengono nello stesso millisecondo con stesso random
 * (probabilità trascurabile: 1/1000 * 1/ms).
 */
export async function computeAffect(input: AffectInput): Promise<AffectMetrics> {
  // C2 — cycleId race-safe: timestamp_ms % 100000 * 1000 + random(0..999)
  // (nessuna dipendenza da DB count, no race condition su lettura sampleCount)
  const cycleId = Math.floor(Date.now() / 1) % 100000 * 1000 + Math.floor(Math.random() * 1000)

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

  // C3 — Size cap su intervention (1KB) con marker [truncated]
  if (intervention && intervention.length > 1000) {
    intervention = intervention.slice(0, 1000) + '...[truncated]'
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
  // B5 fix (Affect Monitor audit Fase B): validazione range dei valori.
  // PRIMA: nessuna validazione — potevano essere persistiti valori fuori range:
  //  - desperationCritical > 1.0 (invalido, fuori dal range 0..1)
  //  - frustrationCritical negativo
  //  - cooldownMs <= 0 (loop infinito o no cooldown)
  //  - tighteningPct > 1.0 (100%+ tightening non ha senso)
  // ORA: throw esplicito su valori fuori range.
  if (updates.desperationCritical !== undefined) {
    if (typeof updates.desperationCritical !== 'number' || updates.desperationCritical < 0 || updates.desperationCritical > 1) {
      throw new Error(`desperationCritical must be a number in [0, 1], got: ${updates.desperationCritical}`)
    }
  }
  if (updates.frustrationCritical !== undefined) {
    if (typeof updates.frustrationCritical !== 'number' || updates.frustrationCritical < 0 || updates.frustrationCritical > 1) {
      throw new Error(`frustrationCritical must be a number in [0, 1], got: ${updates.frustrationCritical}`)
    }
  }
  if (updates.cooldownMs !== undefined) {
    if (typeof updates.cooldownMs !== 'number' || updates.cooldownMs <= 0 || !Number.isFinite(updates.cooldownMs)) {
      throw new Error(`cooldownMs must be a positive finite number, got: ${updates.cooldownMs}`)
    }
  }
  if (updates.tighteningPct !== undefined) {
    if (typeof updates.tighteningPct !== 'number' || updates.tighteningPct < 0 || updates.tighteningPct > 1) {
      throw new Error(`tighteningPct must be a number in [0, 1], got: ${updates.tighteningPct}`)
    }
  }

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
 *
 * B3 fix (Affect Monitor audit Fase B): tutte le query in un unico Promise.all.
 * PRIMA: 3 query in Promise.all + 1 query sequenziale (recent) → 2 round-trip DB.
 * ORA: 4 query in un unico Promise.all → 1 round-trip DB (parallelismo massimo).
 *
 * B6 fix (Affect Monitor audit Fase B): aggregation documentato come best-effort.
 * PRIMA: caricava 100 righe in memoria per calcolare avgDesperation/avgFrustration.
 * ORA: mantiene lo stesso pattern (Prisma non supporta aggregate su "ultimi N per
 * timestamp" in modo efficiente senza subquery), ma documentato come best-effort
 * e aggiunto commento esplicativo. Per dataset molto grandi (>10k samples),
 * considerare una query SQL raw con window function.
 *
 * G4 fix (Affect Monitor audit Fase C): metriche aggiuntive per monitoraggio.
 * PRIMA: solo 5 metriche (samples, agents, interventions, avgDesperation, avgFrustration).
 * ORA: aggiunte 4 metriche:
 *  - interventionRate: % di cicli con intervento (interventions / samples)
 *  - peakDesperation: max desperation storica (gravità massima)
 *  - peakFrustration: max frustration storica (gravità massima)
 *  - agentsInCriticalState: count agenti con ultima sample > critical
 * Le ultime 2 richiedono query aggiuntive ma in Promise.all (1 round-trip).
 */
export async function affectStats() {
  const [samples, agents, interventions, recent, peakDesperationAgg, peakFrustrationAgg] = await Promise.all([
    db.affectSample.count(),
    db.affectSample.groupBy({ by: ['agentId'], _count: true }),
    db.affectSample.count({ where: { intervention: { not: null } } }),
    // B6 — best-effort avg: carica ultimi 100 samples per calcolo media
    // (alternative SQL raw con window function richiederebbe refactor maggiore)
    db.affectSample.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100,
      select: { desperation: true, frustration: true },
    }),
    // G4 — peak desperation storica (max)
    db.affectSample.aggregate({ _max: { desperation: true } }),
    // G4 — peak frustration storica (max)
    db.affectSample.aggregate({ _max: { frustration: true } }),
  ])
  const avgDesperation = recent.length
    ? recent.reduce((s, r) => s + r.desperation, 0) / recent.length
    : 0
  const avgFrustration = recent.length
    ? recent.reduce((s, r) => s + r.frustration, 0) / recent.length
    : 0

  // G4 — interventionRate: % di cicli con intervento del Meta-Observer
  const interventionRate = samples > 0 ? interventions / samples : 0

  // G4 — peak values (max storico, null se no samples)
  const peakDesperation = peakDesperationAgg._max.desperation ?? 0
  const peakFrustration = peakFrustrationAgg._max.frustration ?? 0

  // G4 — agentsInCriticalState: count agenti con ultima sample desperation/frustration > 0.7
  // (soglia default critical, non per-agent per evitare N+1 query)
  const CRITICAL_THRESHOLD = 0.7
  const lastSamplesPerAgent = await db.affectSample.findMany({
    where: {
      // Ultimo sample per ogni agente: usiamo timestamp recentissimo (ultimi 5min)
      // come proxy per "current state" — evita subquery complessa per find-last-per-group
      timestamp: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    orderBy: { timestamp: 'desc' },
    distinct: ['agentId'],
    select: { desperation: true, frustration: true },
  })
  const agentsInCriticalState = lastSamplesPerAgent.filter(
    s => s.desperation >= CRITICAL_THRESHOLD || s.frustration >= CRITICAL_THRESHOLD
  ).length

  return {
    samples,
    agents: agents.length,
    interventions,
    avgDesperation,
    avgFrustration,
    // G4 — metriche aggiuntive
    interventionRate,
    peakDesperation,
    peakFrustration,
    agentsInCriticalState,
  }
}
