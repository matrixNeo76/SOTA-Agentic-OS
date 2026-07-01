/**
 * Digital Twin Engine — Fase 3.2
 *
 * Simula workflow, agenti, deploy, incident per what-if analysis.
 * Si appoggia a Fork + Simulation del Runtime Kernel (rimandati dalla Fase 1).
 *
 * Componenti:
 *   1. Fork: crea una copia dello stato di runtime (checkpoint fork)
 *   2. Simulation: esegue azioni sul fork senza mutare lo stato reale
 *   3. Comparator: confronta outcomes tra scenari alternativi
 *   4. Forecaster: proietta metriche (costo, latency, success rate) su orizzonte
 *
 * Use cases:
 *   - "Cosa succede se aumento il concurrency a 10?"
 *   - "Cosa succede se rimuovo l'agente reflective?"
 *   - "Cosa succede se cambio il routing da local a api?"
 *   - "Quale versione di skill ha performance migliore su questo task set?"
 *
 * Persistenza: ogni simulazione produce un nodo Document con type=twin-simulation
 * nel Context Graph, con edge BASED_ON al WorldState di partenza.
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'
import {
  saveCheckpoint, loadCheckpoint, type CheckpointState, type CheckpointType,
} from '@/lib/checkpoint/checkpoint'

// === Tipi ============================================================

export interface SimulationScenario {
  uri: string
  name: string
  description: string
  baseWorldStateUri?: string
  baseCheckpointId?: string
  parameters: SimulationParameters
  status: 'drafted' | 'running' | 'completed' | 'failed'
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export interface SimulationParameters {
  // Workflow changes
  agentConcurrency?: number
  removedAgents?: string[]
  addedAgents?: Array<{ uri: string; role: string }>

  // Routing changes
  forceRoutingMode?: 'local' | 'api' | 'hybrid'
  preferredModelOverride?: string

  // Memory changes
  memoryBudgetMultiplier?: number
  disableConsolidation?: boolean

  // Tool changes
  disabledTools?: string[]
  addedToolPermissions?: Array<{ toolId: string; scope: string }>

  // Workload
  taskSetUri?: string // URI di un Benchmark o un task set
  taskCount?: number
  taskDifficultyDistribution?: { trivial: number; easy: number; medium: number; hard: number; expert: number }

  // Duration
  simulationHorizon: string // '1h' | '24h' | '7d' | '30d'
}

export interface SimulationResult {
  scenarioUri: string
  success: boolean
  projectedMetrics: ProjectedMetrics
  events: SimulationEvent[]
  anomalies: string[]
  error?: string
  durationMs: number
}

export interface ProjectedMetrics {
  // Output metrics after simulation
  expectedSuccessRate: number
  expectedErrorRate: number
  expectedAvgLatencyMs: number
  expectedCost: number
  expectedThroughput: number // tasks/hour
  // Confidence bounds (95% CI)
  successRateCI: [number, number]
  errorRateCI: [number, number]
  costCI: [number, number]
}

export interface SimulationEvent {
  timestamp: string
  type: 'task_started' | 'task_completed' | 'task_failed' | 'tool_invoked' | 'error' | 'checkpoint' | 'warning'
  agentUri?: string
  taskUri?: string
  details: Record<string, unknown>
}

export interface ScenarioComparison {
  scenarioA: string
  scenarioB: string
  metric: keyof ProjectedMetrics
  deltaA: number
  deltaB: number
  winner: 'A' | 'B' | 'tie'
  significance: 'high' | 'medium' | 'low'
}

// === Scenario management =============================================

/**
 * Crea uno scenario di simulazione.
 * Opzionalmente fork da un checkpoint esistente.
 */
export async function createScenario(params: {
  name: string
  description: string
  parameters: SimulationParameters
  baseWorldStateUri?: string
  baseCheckpointId?: string
  provenance: Provenance
}): Promise<{ uri: string; scenario: SimulationScenario }> {
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  if (!params.name || params.name.length < 3) {
    throw new Error('Scenario name must be at least 3 characters')
  }

  const identifier = `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uri } = await createNode({
    type: 'Document',
    identifier,
    attributes: {
      title: params.name,
      source: 'digital-twin',
      mimeType: 'application/x-simulation-scenario',
      description: params.description,
      parameters: params.parameters,
      baseWorldStateUri: params.baseWorldStateUri,
      baseCheckpointId: params.baseCheckpointId,
      status: 'drafted',
    },
    provenance: params.provenance,
  })

  // Edge Scenario -[BASED_ON]-> WorldState (se specificato)
  if (params.baseWorldStateUri) {
    try {
      await createEdge({
        fromUri: uri,
        toUri: params.baseWorldStateUri,
        relationType: 'BASED_ON',
        createdByAgent: params.provenance.createdByAgent,
      })
    } catch {}
  }

  const scenario: SimulationScenario = {
    uri,
    name: params.name,
    description: params.description,
    baseWorldStateUri: params.baseWorldStateUri,
    baseCheckpointId: params.baseCheckpointId,
    parameters: params.parameters,
    status: 'drafted',
    createdAt: new Date().toISOString(),
  }

  return { uri, scenario }
}

// === Fork (checkpoint-based) =========================================

/**
 * Crea un fork dello stato di runtime per simulazione.
 *
 * In Fase 3.2 il fork è implementato come nuovo checkpoint con:
 *   - execution_state: stato corrente del kernel
 *   - memory_state: snapshot della memoria rilevante
 *   - workflow_state: piani DynAMO attivi
 *
 * Il fork NON viene mai mischiato con i checkpoint di produzione:
 * il campo `taskId='simulation-fork'` li distingue.
 */
export async function forkRuntimeState(params: {
  scenarioUri: string
  provenance: Provenance
}): Promise<{ forkCheckpointId: string }> {
  // Carica l'ultimo execution_state checkpoint di produzione
  const productionCheckpoint = await loadCheckpoint({
    agentUri: 'agent://orchestrator',
    checkpointType: 'execution_state',
  })

  // Crea un nuovo checkpoint marcato come simulation fork
  const forkState: CheckpointState = {
    ...(productionCheckpoint?.state || {}),
    taskUri: 'simulation-fork',
    agentStates: {
      ...(productionCheckpoint?.state.agentStates || {}),
      _simulation: {
        scenarioUri: params.scenarioUri,
        forkedAt: new Date().toISOString(),
        forkedFrom: productionCheckpoint?.id || null,
      },
    },
  }

  const { id } = await saveCheckpoint({
    agentUri: 'agent://simulation-twin',
    taskId: 'simulation-fork',
    checkpointType: 'execution_state',
    state: forkState,
    cycleId: -1, // negative cycleId = simulation marker
  })

  // Update scenario with fork checkpoint id
  const scenario = await getNode(params.scenarioUri)
  if (scenario) {
    const attrs = scenario.attributes as Record<string, unknown>
    await db.graphNode.update({
      where: { uri: params.scenarioUri },
      data: {
        attributes: JSON.stringify({
          ...attrs,
          forkCheckpointId: id,
        }),
        updatedAt: new Date(),
      },
    })
  }

  return { forkCheckpointId: id }
}

// === Simulation runner ===============================================

/**
 * Esegue una simulazione su uno scenario.
 *
 * In Fase 3.2 la simulazione è rule-based + projection:
 *   1. Applica i parametri (concurrency, routing, etc.) come override
 *   2. Proietta le metriche usando modelli semplificati
 *   3. Genera eventi simulati per analisi
 *
 * In Fase 3.x può essere estesa con:
 *   - Esecuzione reale in sandbox (agenti duplicati)
 *   - ML-based forecasting (modelli addestrati su storico)
 *   - Monte Carlo sampling per confidence intervals
 */
export async function runSimulation(params: {
  scenarioUri: string
  provenance: Provenance
}): Promise<SimulationResult> {
  const startTime = Date.now()
  const scenario = await getScenario(params.scenarioUri)
  if (!scenario) {
    return {
      scenarioUri: params.scenarioUri,
      success: false,
      projectedMetrics: emptyMetrics(),
      events: [],
      anomalies: ['Scenario not found'],
      error: 'Scenario not found',
      durationMs: Date.now() - startTime,
    }
  }

  // Update status to running
  await updateScenarioStatus(params.scenarioUri, 'running', params.provenance)
  const events: SimulationEvent[] = []

  try {
    // 1. Fork runtime state
    const { forkCheckpointId } = await forkRuntimeState({
      scenarioUri: params.scenarioUri,
      provenance: params.provenance,
    })
    events.push({
      timestamp: new Date().toISOString(),
      type: 'checkpoint',
      details: { forkCheckpointId, action: 'fork_created' },
    })

    // 2. Capture base metrics from latest WorldState
    const { getLatestWorldState } = await import('@/lib/world-model/engine')
    const baseWorldState = await getLatestWorldState()
    if (!baseWorldState) {
      throw new Error('No WorldState available for simulation base')
    }

    // 3. Apply parameter overrides and project metrics
    // C1 — Try LLM-enhanced projection first, fallback to rule-based.
    let projectedMetrics: ProjectedMetrics
    try {
      const { llmComplete } = await import('@/lib/llm-client/client')
      const systemPrompt = `You are a Digital Twin simulation engine for SOTA Agentic OS. Project the impact of the given scenario parameters on system metrics.

Output as JSON:
{
  "expectedSuccessRate": 0.0-1.0,
  "expectedErrorRate": 0.0-1.0,
  "expectedAvgLatencyMs": number,
  "expectedCost": number,
  "expectedThroughput": number,
  "reasoning": "brief explanation"
}`

      const userPrompt = `Scenario parameters:
${JSON.stringify(scenario.parameters, null, 2)}

Current system state:
- Success rate: ${baseWorldState.snapshot.completedTasksLast24h > 0 ? (baseWorldState.snapshot.completedTasksLast24h / (baseWorldState.snapshot.completedTasksLast24h + baseWorldState.snapshot.failedTasksLast24h)).toFixed(2) : 'N/A'}
- Error rate: ${(baseWorldState.snapshot.errorRate * 100).toFixed(1)}%
- Cost 24h: $${baseWorldState.snapshot.totalCostLast24h.toFixed(2)}
- Avg latency: ${baseWorldState.snapshot.avgLatencyMs.toFixed(0)}ms

Project the metrics after applying the scenario parameters:`

      const result = await llmComplete({
        prompt: userPrompt,
        systemPrompt,
        agentId: 'agent://digital-twin',
        phase: 'simulation_projection',
        fallback: '{}',
      })

      if (result.source === 'llm') {
        const jsonMatch = result.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const llmMetrics = JSON.parse(jsonMatch[0])
          projectedMetrics = {
            expectedSuccessRate: Math.min(1, Math.max(0, Number(llmMetrics.expectedSuccessRate) || 0.5)),
            expectedErrorRate: Math.min(1, Math.max(0, Number(llmMetrics.expectedErrorRate) || 0.05)),
            expectedAvgLatencyMs: Number(llmMetrics.expectedAvgLatencyMs) || 500,
            expectedCost: Number(llmMetrics.expectedCost) || 5,
            expectedThroughput: Number(llmMetrics.expectedThroughput) || 1,
            successRateCI: [0, 1],
            errorRateCI: [0, 1],
            costCI: [0, 10],
          }
          events.push({
            timestamp: new Date().toISOString(),
            type: 'checkpoint',
            details: { source: 'llm', reasoning: llmMetrics.reasoning || '' },
          })
        } else {
          projectedMetrics = projectMetrics(baseWorldState.snapshot, scenario.parameters, events)
        }
      } else {
        projectedMetrics = projectMetrics(baseWorldState.snapshot, scenario.parameters, events)
      }
    } catch {
      // LLM non disponibile → fallback rule-based
      projectedMetrics = projectMetrics(baseWorldState.snapshot, scenario.parameters, events)
    }

    // 4. Generate anomalies based on parameter interactions
    const anomalies = detectSimulationAnomalies(scenario.parameters, projectedMetrics)

    // 5. Mark scenario as completed
    await updateScenarioStatus(params.scenarioUri, 'completed', params.provenance)

    return {
      scenarioUri: params.scenarioUri,
      success: true,
      projectedMetrics,
      events,
      anomalies,
      durationMs: Date.now() - startTime,
    }
  } catch (err) {
    await updateScenarioStatus(params.scenarioUri, 'failed', params.provenance)
    return {
      scenarioUri: params.scenarioUri,
      success: false,
      projectedMetrics: emptyMetrics(),
      events,
      anomalies: [String(err)],
      error: String(err),
      durationMs: Date.now() - startTime,
    }
  }
}

// === Metric projection (rule-based) ==================================

function projectMetrics(
  baseSnapshot: import('@/lib/world-model/engine').WorldSnapshot,
  params: SimulationParameters,
  events: SimulationEvent[],
): ProjectedMetrics {
  // Base values from current WorldState — fallback to reasonable defaults se 0/NaN
  const completedPlusFailed = baseSnapshot.completedTasksLast24h + baseSnapshot.failedTasksLast24h
  // Default to 0.9 if we have no data or all failed
  let baseSuccessRate = 0.9
  if (completedPlusFailed > 0) {
    baseSuccessRate = baseSnapshot.completedTasksLast24h / completedPlusFailed
    // If successRate is 0 (all failed), use 0.5 as baseline for projection
    if (baseSuccessRate === 0) baseSuccessRate = 0.5
  }
  const baseErrorRate = Number.isFinite(baseSnapshot.errorRate) && baseSnapshot.errorRate > 0 ? baseSnapshot.errorRate : 0.05
  const baseLatency = baseSnapshot.avgLatencyMs > 0 ? baseSnapshot.avgLatencyMs : 500
  const baseCost = baseSnapshot.totalCostLast24h > 0 ? baseSnapshot.totalCostLast24h : 5
  const baseThroughput = baseSnapshot.completedTasksLast24h > 0
    ? baseSnapshot.completedTasksLast24h / 24
    : 1 // default 1 task/hour baseline

  // Apply concurrency change
  let successRate = baseSuccessRate
  let errorRate = baseErrorRate
  let latency = baseLatency
  let cost = baseCost
  let throughput = baseThroughput

  if (params.agentConcurrency && params.agentConcurrency > 1) {
    // Higher concurrency: throughput up, latency slightly down (parallelism)
    throughput *= params.agentConcurrency
    latency *= 0.85 // ~15% improvement
    // But error rate may increase due to contention
    errorRate = Math.min(0.9, errorRate * (1 + 0.1 * params.agentConcurrency))
    events.push({
      timestamp: new Date().toISOString(),
      type: 'warning',
      details: { message: `Concurrency increased to ${params.agentConcurrency}: error rate projected up` },
    })
  }

  // Apply routing change
  if (params.forceRoutingMode === 'local') {
    // Local-only: cost down, latency down, but may fail on complex tasks
    cost *= 0.2
    latency *= 0.7
    successRate *= 0.9
  } else if (params.forceRoutingMode === 'api') {
    // API-only: cost up, latency up, but more reliable
    cost *= 3
    latency *= 1.5
    successRate = Math.min(0.99, successRate * 1.05)
  }

  // Apply memory budget change
  if (params.memoryBudgetMultiplier && params.memoryBudgetMultiplier < 1) {
    // Reduced memory budget: context loss may increase errors
    errorRate = Math.min(0.9, errorRate * (1 + (1 - params.memoryBudgetMultiplier) * 0.5))
    successRate *= 0.95
  }

  // Apply removed agents
  if (params.removedAgents && params.removedAgents.length > 0) {
    // Removing agents: throughput down, may break workflows
    throughput *= Math.max(0.3, 1 - 0.2 * params.removedAgents.length)
    errorRate = Math.min(0.9, errorRate * 1.2)
    events.push({
      timestamp: new Date().toISOString(),
      type: 'warning',
      details: { message: `Removed ${params.removedAgents.length} agents: workflow may break` },
    })
  }

  // Apply disabled tools
  if (params.disabledTools && params.disabledTools.length > 0) {
    // Disabled tools: certain tasks may fail
    successRate = Math.max(0.3, successRate - 0.1 * params.disabledTools.length)
  }

  // Compute confidence intervals (semplificato: ±15%)
  const successCI: [number, number] = [Math.max(0, successRate - 0.15), Math.min(1, successRate + 0.15)]
  const errorCI: [number, number] = [Math.max(0, errorRate - 0.1), Math.min(1, errorRate + 0.1)]
  const costCI: [number, number] = [cost * 0.7, cost * 1.3]

  return {
    expectedSuccessRate: successRate,
    expectedErrorRate: errorRate,
    expectedAvgLatencyMs: latency,
    expectedCost: cost,
    expectedThroughput: throughput,
    successRateCI: successCI,
    errorRateCI: errorCI,
    costCI,
  }
}

function detectSimulationAnomalies(
  params: SimulationParameters,
  metrics: ProjectedMetrics,
): string[] {
  const anomalies: string[] = []

  if (metrics.expectedErrorRate > 0.3) {
    anomalies.push(`Projected error rate ${(metrics.expectedErrorRate * 100).toFixed(1)}% is critically high`)
  }
  if (metrics.expectedSuccessRate < 0.5) {
    anomalies.push(`Projected success rate ${(metrics.expectedSuccessRate * 100).toFixed(1)}% is unacceptable`)
  }
  if (metrics.expectedCost > 100) {
    anomalies.push(`Projected cost $${metrics.expectedCost.toFixed(2)}/day exceeds budget`)
  }
  if (metrics.expectedAvgLatencyMs > 10000) {
    anomalies.push(`Projected latency ${metrics.expectedAvgLatencyMs.toFixed(0)}ms exceeds SLA`)
  }
  if (params.removedAgents && params.removedAgents.length > 3) {
    anomalies.push(`Removing ${params.removedAgents.length} agents may destabilize the system`)
  }

  return anomalies
}

function emptyMetrics(): ProjectedMetrics {
  return {
    expectedSuccessRate: 0,
    expectedErrorRate: 0,
    expectedAvgLatencyMs: 0,
    expectedCost: 0,
    expectedThroughput: 0,
    successRateCI: [0, 0],
    errorRateCI: [0, 0],
    costCI: [0, 0],
  }
}

// === Scenario queries ================================================

export async function getScenario(uri: string): Promise<SimulationScenario | null> {
  const node = await getNode(uri)
  if (!node || node.entityType !== 'Document') return null

  const attrs = node.attributes as Record<string, unknown>
  if (attrs.source !== 'digital-twin') return null

  return {
    uri: node.uri,
    name: attrs.title as string,
    description: (attrs.description as string) || '',
    baseWorldStateUri: attrs.baseWorldStateUri as string | undefined,
    baseCheckpointId: attrs.baseCheckpointId as string | undefined,
    parameters: attrs.parameters as SimulationParameters,
    status: (attrs.status as SimulationScenario['status']) || 'drafted',
    createdAt: node.createdAt.toISOString(),
  }
}

export async function listScenarios(limit = 20): Promise<SimulationScenario[]> {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Document' },
    take: limit * 3, // over-fetch per filtrare
    orderBy: { createdAt: 'desc' },
  })

  const scenarios: SimulationScenario[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    if (attrs.source !== 'digital-twin') continue
    scenarios.push({
      uri: node.uri,
      name: attrs.title as string,
      description: (attrs.description as string) || '',
      baseWorldStateUri: attrs.baseWorldStateUri as string | undefined,
      baseCheckpointId: attrs.baseCheckpointId as string | undefined,
      parameters: attrs.parameters as SimulationParameters,
      status: (attrs.status as SimulationScenario['status']) || 'drafted',
      createdAt: node.createdAt.toISOString(),
    })
    if (scenarios.length >= limit) break
  }
  return scenarios
}

async function updateScenarioStatus(uri: string, status: SimulationScenario['status'], provenance: Provenance): Promise<void> {
  const node = await db.graphNode.findUnique({ where: { uri } })
  if (!node) return
  const attrs = JSON.parse(node.attributes) as Record<string, unknown>
  const updates: Record<string, unknown> = { ...attrs, status }
  if (status === 'running') updates.startedAt = new Date().toISOString()
  if (status === 'completed' || status === 'failed') updates.completedAt = new Date().toISOString()

  await db.graphNode.update({
    where: { uri },
    data: {
      attributes: JSON.stringify(updates),
      updatedAt: new Date(),
    },
  })
}

// === Comparator ======================================================

/**
 * Confronta due scenari di simulazione per identificare il vincitore.
 */
export function compareScenarios(
  resultA: SimulationResult,
  resultB: SimulationResult,
  metric: keyof ProjectedMetrics = 'expectedSuccessRate',
): ScenarioComparison {
  const valueA = resultA.projectedMetrics[metric] as number
  const valueB = resultB.projectedMetrics[metric] as number

  const delta = valueA - valueB
  let winner: 'A' | 'B' | 'tie' = 'tie'
  if (Math.abs(delta) < 0.01) winner = 'tie'
  else if (delta > 0) winner = 'A'
  else winner = 'B'

  // Significance: relativo al valore base
  const baseValue = Math.max(Math.abs(valueA), Math.abs(valueB), 0.01)
  const relDelta = Math.abs(delta) / baseValue
  const significance: 'high' | 'medium' | 'low' =
    relDelta > 0.2 ? 'high' : relDelta > 0.05 ? 'medium' : 'low'

  return {
    scenarioA: resultA.scenarioUri,
    scenarioB: resultB.scenarioUri,
    metric,
    deltaA: valueA,
    deltaB: valueB,
    winner,
    significance,
  }
}

// === What-if presets =================================================

/**
 * Preset di scenari what-if comuni, pronti all'uso.
 */
export const WHAT_IF_PRESETS: Array<{
  name: string
  description: string
  parameters: SimulationParameters
}> = [
  {
    name: 'double-concurrency',
    description: 'What if we double the agent concurrency?',
    parameters: {
      agentConcurrency: 2,
      simulationHorizon: '24h',
    },
  },
  {
    name: 'local-only-routing',
    description: 'What if we route everything to local models?',
    parameters: {
      forceRoutingMode: 'local',
      simulationHorizon: '24h',
    },
  },
  {
    name: 'api-only-routing',
    description: 'What if we route everything to API models?',
    parameters: {
      forceRoutingMode: 'api',
      simulationHorizon: '24h',
    },
  },
  {
    name: 'remove-reflective-agent',
    description: 'What if we remove the reflective agent?',
    parameters: {
      removedAgents: ['agent://reflective'],
      simulationHorizon: '24h',
    },
  },
  {
    name: 'reduce-memory-budget-50',
    description: 'What if we cut memory budget by 50%?',
    parameters: {
      memoryBudgetMultiplier: 0.5,
      simulationHorizon: '24h',
    },
  },
  {
    name: 'disable-consolidation',
    description: 'What if we disable memory consolidation?',
    parameters: {
      disableConsolidation: true,
      simulationHorizon: '7d',
    },
  },
]

/**
 * Esegue un preset what-if contro il WorldState corrente.
 */
export async function runWhatIf(presetName: string, provenance: Provenance): Promise<{
  scenario: SimulationScenario
  result: SimulationResult
}> {
  const preset = WHAT_IF_PRESETS.find((p) => p.name === presetName)
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}. Available: ${WHAT_IF_PRESETS.map((p) => p.name).join(', ')}`)
  }

  // Capture base WorldState
  const { captureWorldState } = await import('@/lib/world-model/engine')
  const { uri: wsUri } = await captureWorldState({ provenance })

  // Create scenario
  const { uri: scenarioUri, scenario } = await createScenario({
    name: `what-if-${presetName}-${Date.now()}`,
    description: preset.description,
    parameters: preset.parameters,
    baseWorldStateUri: wsUri,
    provenance,
  })

  // Run simulation
  const result = await runSimulation({ scenarioUri, provenance })

  return { scenario: { ...scenario, uri: scenarioUri }, result }
}

// === Stats ===========================================================

export async function digitalTwinStats() {
  const scenarios = await listScenarios(100)
  return {
    totalScenarios: scenarios.length,
    byStatus: scenarios.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1
      return acc
    }, {} as Record<string, number>),
    availablePresets: WHAT_IF_PRESETS.length,
  }
}

export function digitalTwinProvenance(agentUri: string = 'agent://digital-twin'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'agent-reasoning',
    confidence: 0.8, // simulation = medium-high confidence
  })
}
