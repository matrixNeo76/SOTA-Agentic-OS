/**
 * World Model Layer — Fase 3.1
 *
 * Trasforma dati → comprensione. Analizza task, eventi, repo, SLA, performance,
 * decisioni per produrre una "immagine del mondo" strutturata.
 *
 * Output nodes (già in ENTITY_REGISTRY):
 *   - WorldState: snapshot osservato in un momento T
 *   - Prediction: affermazione futura con probabilità e orizzonte
 *   - Risk: rischio identificato con severity/probability
 *   - Opportunity: opportunità con potenziale
 *
 * Relazioni:
 *   (:Prediction)-[:BASED_ON]->(:WorldState | :Evidence)
 *   (:Prediction)-[:VERIFIED_BY]->(:WorldState futuro)
 *   (:Risk)-[:OBSERVED_IN]->(:WorldState)
 *   (:Risk)-[:MITIGATED_BY]->(:Decision | :Skill)
 *   (:Opportunity)-[:OBSERVED_IN]->(:WorldState)
 *   (:Opportunity)-[:EXPLOITED_BY]->(:Decision | :Skill)
 *
 * Data sources (input):
 *   - AgentLog (task success/failure, tool calls)
 *   - CostEntry (spese per agente/modello)
 *   - TraceSpan (latency, error rates)
 *   - GraphNode/Edge (struttura del grafo)
 *   - MemoryEntry (episodic consolidabili)
 *   - ErrorRecord (incident patterns)
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'
import { embed } from '@/lib/embeddings'
import { storeEmbedding } from '@/lib/vector-store'

// === Tipi ============================================================

export interface WorldState {
  uri: string
  timestamp: string
  snapshot: WorldSnapshot
  sources: string[] // URIs of source entities (AgentLog, TraceSpan, etc.)
  provenance: Provenance
  createdAt: string
}

export interface WorldSnapshot {
  // System metrics at time T
  activeAgents: number
  pendingTasks: number
  completedTasksLast24h: number
  failedTasksLast24h: number
  blockedActions: number
  totalCostLast24h: number
  avgLatencyMs: number
  errorRate: number
  // Graph stats
  graphNodes: number
  graphEdges: number
  // Memory stats
  memoryEntries: number
  // Cognitive state
  dominantDomains: Array<{ domain: string; weight: number }>
  // Anomalies detected
  anomalies: string[]
}

export interface Prediction {
  uri: string
  statement: string
  probability: number // 0..1
  horizon: string // '1h' | '24h' | '7d' | '30d' | '90d'
  basedOnWorldStateUri: string
  basedOnEvidenceUris: string[]
  verifiedByWorldStateUri?: string
  status: 'pending' | 'verified' | 'falsified' | 'expired'
  createdAt: string
  expiresAt: string
}

export interface Risk {
  uri: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  probability: number // 0..1
  observedInWorldStateUri: string
  mitigatedByUris: string[] // Decision/Skill URIs
  status: 'identified' | 'mitigating' | 'mitigated' | 'ignored'
  createdAt: string
}

export interface Opportunity {
  uri: string
  description: string
  potential: 'low' | 'medium' | 'high' | 'transformative'
  estimatedGain: number // 0..1 (relative)
  observedInWorldStateUri: string
  exploitedByUris: string[] // Decision/Skill URIs
  status: 'identified' | 'exploiting' | 'exploited' | 'missed'
  createdAt: string
}

// === World State snapshot ============================================

/**
 * Cattura uno snapshot dello stato del mondo dai dati live.
 * Da chiamare periodicamente (es. ogni ora).
 */
export async function captureWorldState(options?: {
  sources?: string[]
  provenance?: Provenance
}): Promise<{ uri: string; worldState: WorldState }> {
  const now = new Date()
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Collect metrics in parallel
  const [
    activeAgents,
    pendingTasks,
    completedTasks24h,
    failedTasks24h,
    blockedActions,
    totalCost24h,
    recentTraces,
    errors24h,
    graphNodes,
    graphEdges,
    memoryEntries,
    recentLogs,
  ] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Agent', lifecycleState: 'active' } }),
    db.graphNode.count({ where: { entityType: 'Task', lifecycleState: 'active' } }),
    db.agentLog.count({ where: { event: 'TaskCompleted', timestamp: { gte: cutoff24h } } }),
    db.agentLog.count({ where: { event: 'TaskFailed', timestamp: { gte: cutoff24h } } }),
    db.blockedAction.count({ where: { status: 'pending' } }),
    db.costEntry.aggregate({ _sum: { cost: true }, where: { timestamp: { gte: cutoff24h } } }).then((r) => r._sum.cost || 0),
    db.traceSpan.findMany({ where: { timestamp: { gte: cutoff24h } }, select: { durationMs: true, status: true } }),
    db.errorRecord.count({ where: { lastSeen: { gte: cutoff24h } } }),
    db.graphNode.count(),
    db.graphEdge.count(),
    db.memoryEntry.count(),
    db.agentLog.findMany({ where: { timestamp: { gte: cutoff24h } }, take: 200, select: { event: true, payload: true } }),
  ])

  const avgLatency = recentTraces.length > 0
    ? recentTraces.reduce((s, t) => s + t.durationMs, 0) / recentTraces.length
    : 0
  const errorTraces = recentTraces.filter((t) => t.status === 'error').length
  const errorRate = recentTraces.length > 0 ? errorTraces / recentTraces.length : 0

  // Extract dominant domains from recent logs (semantic clustering semplificato)
  const domainCounts = new Map<string, number>()
  for (const log of recentLogs) {
    try {
      const payload = JSON.parse(log.payload) as Record<string, unknown>
      const domain = (payload.domain as string) || (payload.agentId as string) || 'unknown'
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)
    } catch {}
  }
  const dominantDomains = Array.from(domainCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([domain, count]) => ({
      domain,
      weight: count / Math.max(1, recentLogs.length),
    }))

  // Detect anomalies (regole semplici)
  const anomalies: string[] = []
  if (errorRate > 0.2) anomalies.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`)
  if (failedTasks24h > completedTasks24h && completedTasks24h > 0) {
    anomalies.push(`More failures than successes in 24h: ${failedTasks24h} > ${completedTasks24h}`)
  }
  if (totalCost24h > 10) anomalies.push(`High cost in 24h: $${totalCost24h.toFixed(2)}`)
  if (blockedActions > 5) anomalies.push(`${blockedActions} blocked actions pending`)
  if (avgLatency > 5000) anomalies.push(`High avg latency: ${avgLatency.toFixed(0)}ms`)

  const snapshot: WorldSnapshot = {
    activeAgents,
    pendingTasks,
    completedTasksLast24h: completedTasks24h,
    failedTasksLast24h: failedTasks24h,
    blockedActions,
    totalCostLast24h: totalCost24h,
    avgLatencyMs: avgLatency,
    errorRate,
    graphNodes,
    graphEdges,
    memoryEntries,
    dominantDomains,
    anomalies,
  }

  const provenance = options?.provenance || createProvenance({
    agent: 'agent://world-model',
    source: 'system-event',
    confidence: 1.0,
  })

  const identifier = `world-state-${now.toISOString().replace(/[:.]/g, '-')}`
  const { uri } = await createNode({
    type: 'WorldState',
    identifier,
    attributes: {
      snapshot, // required by ENTITY_REGISTRY
      timestamp: now.toISOString(), // required by ENTITY_REGISTRY
      sources: options?.sources || [],
      anomalies,
    },
    provenance,
  })

  // Persisti anche un embedding dello snapshot per similarity search tra world states
  const snapshotText = JSON.stringify(snapshot)
  const embedding = embed(snapshotText)
  await storeEmbedding({
    entityUri: uri,
    entityType: 'WorldState',
    embedding,
  })

  const worldState: WorldState = {
    uri,
    timestamp: now.toISOString(),
    snapshot,
    sources: options?.sources || [],
    provenance,
    createdAt: now.toISOString(),
  }

  return { uri, worldState }
}

/**
 * Recupera l'ultimo WorldState catturato.
 */
export async function getLatestWorldState(): Promise<WorldState | null> {
  const node = await db.graphNode.findFirst({
    where: { entityType: 'WorldState' },
    orderBy: { createdAt: 'desc' },
  })
  if (!node) return null

  const attrs = JSON.parse(node.attributes) as Record<string, unknown>
  return {
    uri: node.uri,
    timestamp: attrs.timestamp as string,
    snapshot: attrs.snapshot as WorldSnapshot,
    sources: (attrs.sources as string[]) || [],
    provenance: {
      createdByAgent: node.createdByAgent,
      createdByModel: node.createdByModel || undefined,
      source: node.source as Provenance['source'],
      confidence: node.confidence,
      timestamp: node.provenanceTs.toISOString(),
    } as Provenance,
    createdAt: node.createdAt.toISOString(),
  }
}

// === Predictions =====================================================

/**
 * Crea una predizione basata su un WorldState.
 *
 * In Fase 3.1 le predizioni sono generate da agenti (LLM) o da regole deterministiche.
 * Il World Model fornisce l'infrastruttura; il "motore predittivo" può essere
 * - rule-based (analisi trend)
 * - LLM-based (prompting con WorldState)
 * - ML-based (modelli addestrati su storico)
 */
export async function createPrediction(params: {
  statement: string
  probability: number
  horizon: Prediction['horizon']
  basedOnWorldStateUri: string
  basedOnEvidenceUris?: string[]
  provenance: Provenance
}): Promise<{ uri: string; prediction: Prediction }> {
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  if (params.probability < 0 || params.probability > 1) {
    throw new Error('Probability must be between 0 and 1')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + parseHorizonMs(params.horizon))

  const identifier = `prediction-${now.toISOString().replace(/[:.]/g, '-')}`
  const { uri } = await createNode({
    type: 'Prediction',
    identifier,
    attributes: {
      statement: params.statement, // required
      probability: params.probability, // required
      horizon: params.horizon, // required
      basedOnWorldStateUri: params.basedOnWorldStateUri,
      basedOnEvidenceUris: params.basedOnEvidenceUris || [],
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    },
    provenance: params.provenance,
  })

  // Crea edge Prediction -[BASED_ON]-> WorldState
  try {
    await createEdge({
      fromUri: uri,
      toUri: params.basedOnWorldStateUri,
      relationType: 'BASED_ON',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  // Crea edges Prediction -[BASED_ON]-> Evidence (per ogni evidence URI)
  for (const evidenceUri of params.basedOnEvidenceUris || []) {
    try {
      await createEdge({
        fromUri: uri,
        toUri: evidenceUri,
        relationType: 'BASED_ON',
        createdByAgent: params.provenance.createdByAgent,
      })
    } catch {}
  }

  const prediction: Prediction = {
    uri,
    statement: params.statement,
    probability: params.probability,
    horizon: params.horizon,
    basedOnWorldStateUri: params.basedOnWorldStateUri,
    basedOnEvidenceUris: params.basedOnEvidenceUris || [],
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }

  return { uri, prediction }
}

/**
 * Verifica una predizione contro un nuovo WorldState.
 * Mark come 'verified' se la statement è coerente, 'falsified' altrimenti.
 *
 * La verifica può essere:
 *   - manuale (human decision via Sovereign Validator)
 *   - automatica (rule-based: confronta valori predetti vs attuali)
 *   - LLM-based (prompting con entrambi gli snapshot)
 */
export async function verifyPrediction(params: {
  predictionUri: string
  verifyingWorldStateUri: string
  outcome: 'verified' | 'falsified'
  reason?: string
  provenance: Provenance
}): Promise<void> {
  const prediction = await getNode(params.predictionUri)
  if (!prediction || prediction.entityType !== 'Prediction') {
    throw new Error(`Prediction not found: ${params.predictionUri}`)
  }

  // Update status nelle attributes
  const attrs = prediction.attributes as Record<string, unknown>
  await db.graphNode.update({
    where: { uri: params.predictionUri },
    data: {
      attributes: JSON.stringify({
        ...attrs,
        status: params.outcome,
        verifiedByWorldStateUri: params.verifyingWorldStateUri,
        verificationReason: params.reason,
        verifiedAt: new Date().toISOString(),
      }),
      updatedAt: new Date(),
    },
  })

  // Crea edge Prediction -[VERIFIED_BY]-> WorldState
  try {
    await createEdge({
      fromUri: params.predictionUri,
      toUri: params.verifyingWorldStateUri,
      relationType: 'VERIFIED_BY',
      createdByAgent: params.provenance.createdByAgent,
      properties: { outcome: params.outcome, reason: params.reason },
    })
  } catch {}
}

/**
 * Lista predizioni pendenti non ancora scadute.
 */
export async function listPendingPredictions(): Promise<Prediction[]> {
  const now = new Date().toISOString()
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Prediction' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const predictions: Prediction[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    if (attrs.status !== 'pending') continue
    if ((attrs.expiresAt as string) < now) continue

    predictions.push({
      uri: node.uri,
      statement: attrs.statement as string,
      probability: attrs.probability as number,
      horizon: attrs.horizon as Prediction['horizon'],
      basedOnWorldStateUri: attrs.basedOnWorldStateUri as string,
      basedOnEvidenceUris: (attrs.basedOnEvidenceUris as string[]) || [],
      status: 'pending',
      createdAt: node.createdAt.toISOString(),
      expiresAt: attrs.expiresAt as string,
    })
  }
  return predictions
}

// === Risks ===========================================================

export async function identifyRisk(params: {
  description: string
  severity: Risk['severity']
  probability: number
  observedInWorldStateUri: string
  provenance: Provenance
}): Promise<{ uri: string; risk: Risk }> {
  if (params.probability < 0 || params.probability > 1) {
    throw new Error('Probability must be between 0 and 1')
  }

  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  const identifier = `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uri } = await createNode({
    type: 'Risk',
    identifier,
    attributes: {
      description: params.description, // required
      severity: params.severity, // required
      probability: params.probability, // required
      observedInWorldStateUri: params.observedInWorldStateUri,
      mitigatedByUris: [],
      status: 'identified',
    },
    provenance: params.provenance,
  })

  // Edge Risk -[OBSERVED_IN]-> WorldState
  try {
    await createEdge({
      fromUri: uri,
      toUri: params.observedInWorldStateUri,
      relationType: 'OBSERVED_IN',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  const risk: Risk = {
    uri,
    description: params.description,
    severity: params.severity,
    probability: params.probability,
    observedInWorldStateUri: params.observedInWorldStateUri,
    mitigatedByUris: [],
    status: 'identified',
    createdAt: new Date().toISOString(),
  }

  return { uri, risk }
}

/**
 * Collega un Risk a una mitigazione (Decision/Skill).
 */
export async function mitigateRisk(params: {
  riskUri: string
  mitigationUri: string // Decision or Skill URI
  provenance: Provenance
}): Promise<void> {
  const risk = await getNode(params.riskUri)
  if (!risk || risk.entityType !== 'Risk') {
    throw new Error(`Risk not found: ${params.riskUri}`)
  }

  // Update attributes
  const attrs = risk.attributes as Record<string, unknown>
  const mitigatedByUris = (attrs.mitigatedByUris as string[]) || []
  mitigatedByUris.push(params.mitigationUri)
  await db.graphNode.update({
    where: { uri: params.riskUri },
    data: {
      attributes: JSON.stringify({
        ...attrs,
        mitigatedByUris,
        status: 'mitigating',
      }),
      updatedAt: new Date(),
    },
  })

  // Edge Risk -[MITIGATED_BY]-> Decision/Skill
  try {
    await createEdge({
      fromUri: params.riskUri,
      toUri: params.mitigationUri,
      relationType: 'MITIGATED_BY',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}
}

// === Opportunities ===================================================

export async function identifyOpportunity(params: {
  description: string
  potential: Opportunity['potential']
  estimatedGain: number
  observedInWorldStateUri: string
  provenance: Provenance
}): Promise<{ uri: string; opportunity: Opportunity }> {
  if (params.estimatedGain < 0 || params.estimatedGain > 1) {
    throw new Error('estimatedGain must be between 0 and 1')
  }

  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  const identifier = `opportunity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uri } = await createNode({
    type: 'Opportunity',
    identifier,
    attributes: {
      description: params.description, // required
      potential: params.potential, // required
      estimatedGain: params.estimatedGain,
      observedInWorldStateUri: params.observedInWorldStateUri,
      exploitedByUris: [],
      status: 'identified',
    },
    provenance: params.provenance,
  })

  try {
    await createEdge({
      fromUri: uri,
      toUri: params.observedInWorldStateUri,
      relationType: 'OBSERVED_IN',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  const opportunity: Opportunity = {
    uri,
    description: params.description,
    potential: params.potential,
    estimatedGain: params.estimatedGain,
    observedInWorldStateUri: params.observedInWorldStateUri,
    exploitedByUris: [],
    status: 'identified',
    createdAt: new Date().toISOString(),
  }

  return { uri, opportunity }
}

export async function exploitOpportunity(params: {
  opportunityUri: string
  exploitUri: string // Decision or Skill URI
  provenance: Provenance
}): Promise<void> {
  const opp = await getNode(params.opportunityUri)
  if (!opp || opp.entityType !== 'Opportunity') {
    throw new Error(`Opportunity not found: ${params.opportunityUri}`)
  }

  const attrs = opp.attributes as Record<string, unknown>
  const exploitedByUris = (attrs.exploitedByUris as string[]) || []
  exploitedByUris.push(params.exploitUri)
  await db.graphNode.update({
    where: { uri: params.opportunityUri },
    data: {
      attributes: JSON.stringify({
        ...attrs,
        exploitedByUris,
        status: 'exploiting',
      }),
      updatedAt: new Date(),
    },
  })

  try {
    await createEdge({
      fromUri: params.opportunityUri,
      toUri: params.exploitUri,
      relationType: 'EXPLOITED_BY',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}
}

// === Rule-based predictors ===========================================

/**
 * Predittore rule-based che genera Prediction/Risk/Opportunity
 * a partire dal WorldState corrente usando regole deterministiche.
 *
 * Le regole sono semplici soglie che, quando superate, emettono eventi.
 * In produzione possono essere sostituite da modelli ML.
 */
export async function runRuleBasedPredictor(worldState: WorldState): Promise<{
  predictions: Prediction[]
  risks: Risk[]
  opportunities: Opportunity[]
}> {
  const predictions: Prediction[] = []
  const risks: Risk[] = []
  const opportunities: Opportunity[] = []

  const provenance = createProvenance({
    agent: 'agent://world-model',
    source: 'agent-reasoning',
    confidence: 0.7, // rule-based = media confidence
  })

  // Rule 1: error rate alto → predizione di incident
  if (worldState.snapshot.errorRate > 0.2) {
    const { prediction } = await createPrediction({
      statement: `Incident likely in next 24h due to error rate ${(worldState.snapshot.errorRate * 100).toFixed(1)}%`,
      probability: Math.min(0.9, worldState.snapshot.errorRate + 0.3),
      horizon: '24h',
      basedOnWorldStateUri: worldState.uri,
      provenance,
    })
    predictions.push(prediction)

    const { risk } = await identifyRisk({
      description: 'Sustained high error rate may indicate systemic issue',
      severity: 'high',
      probability: worldState.snapshot.errorRate,
      observedInWorldStateUri: worldState.uri,
      provenance,
    })
    risks.push(risk)
  }

  // Rule 2: cost > $50 in 24h → risk budget overrun
  if (worldState.snapshot.totalCostLast24h > 50) {
    const { risk } = await identifyRisk({
      description: `Cost trajectory: $${worldState.snapshot.totalCostLast24h.toFixed(2)}/day → budget overrun risk`,
      severity: 'medium',
      probability: 0.6,
      observedInWorldStateUri: worldState.uri,
      provenance,
    })
    risks.push(risk)
  }

  // Rule 3: low error rate + many completed tasks → opportunity to scale
  if (worldState.snapshot.errorRate < 0.05 && worldState.snapshot.completedTasksLast24h > 10) {
    const { opportunity } = await identifyOpportunity({
      description: 'System stable with high throughput: opportunity to take on more complex tasks',
      potential: 'medium',
      estimatedGain: 0.3,
      observedInWorldStateUri: worldState.uri,
      provenance,
    })
    opportunities.push(opportunity)
  }

  // Rule 4: many blocked actions → risk of gridlock
  if (worldState.snapshot.blockedActions > 5) {
    const { risk } = await identifyRisk({
      description: `${worldState.snapshot.blockedActions} blocked actions may cause gridlock`,
      severity: 'medium',
      probability: 0.5,
      observedInWorldStateUri: worldState.uri,
      provenance,
    })
    risks.push(risk)
  }

  // Rule 5: anomaly count > 0 → prediction of system degradation
  if (worldState.snapshot.anomalies.length > 0) {
    const { prediction } = await createPrediction({
      statement: `${worldState.snapshot.anomalies.length} anomalies detected → expect degradation in next 1h`,
      probability: Math.min(0.8, worldState.snapshot.anomalies.length * 0.2),
      horizon: '1h',
      basedOnWorldStateUri: worldState.uri,
      provenance,
    })
    predictions.push(prediction)
  }

  // Rule 6: graph growth → opportunity for knowledge consolidation
  if (worldState.snapshot.graphNodes > 1000 && worldState.snapshot.memoryEntries > 500) {
    const { opportunity } = await identifyOpportunity({
      description: 'Large knowledge graph: opportunity for cognitive GC consolidation',
      potential: 'low',
      estimatedGain: 0.2,
      observedInWorldStateUri: worldState.uri,
      provenance,
    })
    opportunities.push(opportunity)
  }

  return { predictions, risks, opportunities }
}

// === Stats ===========================================================

export async function worldModelStats() {
  const [worldStates, predictions, risks, opportunities] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'WorldState' } }),
    db.graphNode.count({ where: { entityType: 'Prediction' } }),
    db.graphNode.count({ where: { entityType: 'Risk' } }),
    db.graphNode.count({ where: { entityType: 'Opportunity' } }),
  ])

  const pendingPredictions = await listPendingPredictions()
  const openRisks = await db.graphNode.count({
    where: { entityType: 'Risk' },
  })

  return {
    worldStates,
    predictions,
    pendingPredictions: pendingPredictions.length,
    risks: openRisks,
    opportunities,
  }
}

// === Helpers =========================================================

function parseHorizonMs(horizon: Prediction['horizon']): number {
  const match = horizon.match(/^(\d+)([hdm])$/)
  if (!match) return 24 * 60 * 60 * 1000 // default 24h
  const value = parseInt(match[1]!, 10)
  const unit = match[2]!
  switch (unit) {
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    case 'm': return value * 30 * 24 * 60 * 60 * 1000
    default: return 24 * 60 * 60 * 1000
  }
}
