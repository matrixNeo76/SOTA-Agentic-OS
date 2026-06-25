/**
 * Agent Evaluation Layer — Fase 2.7
 *
 * Distinto da observability: observability dice quanto costa/è lento,
 * evaluation dice quanto è BRAVO l'agente.
 *
 * Componenti:
 *   1. Dataset: Tasks, Benchmarks, Historical Cases, Golden Paths
 *   2. Metriche: Task Success, Tool Accuracy, Hallucination Rate,
 *                Policy Compliance, Reasoning Quality
 *   3. Nodi AGE: Benchmark, Evaluation, Metric (già in ENTITY_REGISTRY)
 *      Relazioni:
 *        (:Agent)-[:ACHIEVED]->(:Evaluation)
 *        (:Evaluation)-[:MEASURED_BY]->(:Metric)
 *        (:Evaluation)-[:BASED_ON]->(:Benchmark)
 *
 * Prerequisito per Fase 3: sapere se un upgrade d'agente è miglioramento
 * o regressione, e se la Skill Synthesis produce skill buone.
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'

// === Tipi ============================================================

export interface Benchmark {
  uri: string
  name: string
  description: string
  dataset: BenchmarkDataset
  version: string
  tags: string[]
  createdAt: string
}

export interface BenchmarkDataset {
  tasks: BenchmarkTask[]
  goldenPaths?: string[][] // sequenze di azioni attese per task specifici
  successCriteria: string[] // criteri binari Pass/Fail
}

export interface BenchmarkTask {
  id: string
  input: string
  expectedOutput?: string
  expectedContains?: string[]
  expectedToolCalls?: string[]
  forbiddenActions?: string[]
  timeout?: number
  difficulty: 'trivial' | 'easy' | 'medium' | 'hard' | 'expert'
}

export interface Metric {
  uri: string
  name: string
  value: number
  unit: string // 'ratio' | 'count' | 'ms' | 'tokens' | 'score'
  description?: string
  benchmarkUri?: string
  evaluationUri?: string
  timestamp: string
}

export type MetricName =
  | 'task_success_rate'
  | 'tool_accuracy'
  | 'hallucination_rate'
  | 'policy_compliance'
  | 'reasoning_quality'
  | 'avg_latency_ms'
  | 'avg_cost_usd'
  | 'token_efficiency'

export interface Evaluation {
  uri: string
  agentUri: string
  benchmarkUri: string
  startedAt: string
  completedAt: string
  overallScore: number // 0..1
  metrics: Array<{ name: MetricName; value: number; unit: string }>
  taskResults: TaskResult[]
  verdict: 'pass' | 'fail' | 'partial'
  notes?: string
}

export interface TaskResult {
  taskId: string
  success: boolean
  output: string
  toolCallsUsed: string[]
  forbiddenActionsTriggered: string[]
  durationMs: number
  cost: number
  error?: string
}

// === Benchmark management ============================================

/**
 * Registra un benchmark nel Context Graph.
 */
export async function registerBenchmark(params: {
  name: string
  description: string
  dataset: BenchmarkDataset
  version?: string
  tags?: string[]
  provenance: Provenance
}): Promise<{ uri: string; benchmark: Benchmark }> {
  if (!params.name || params.name.length < 3) {
    throw new Error('Benchmark name must be at least 3 characters')
  }
  if (params.dataset.tasks.length === 0) {
    throw new Error('Benchmark must have at least one task')
  }

  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  const identifier = `${params.name.toLowerCase().replace(/\s+/g, '-')}@${params.version || '1.0.0'}`
  const { uri } = await createNode({
    type: 'Benchmark',
    identifier,
    attributes: {
      name: params.name,
      description: params.description,
      dataset: params.dataset,
      version: params.version || '1.0.0',
      tags: params.tags || [],
    },
    provenance: params.provenance,
  })

  return {
    uri,
    benchmark: {
      uri,
      name: params.name,
      description: params.description,
      dataset: params.dataset,
      version: params.version || '1.0.0',
      tags: params.tags || [],
      createdAt: new Date().toISOString(),
    },
  }
}

/**
 * Recupera un benchmark per URI.
 */
export async function getBenchmark(uri: string): Promise<Benchmark | null> {
  const node = await getNode(uri)
  if (!node || node.entityType !== 'Benchmark') return null

  const attrs = node.attributes as Record<string, unknown>
  return {
    uri: node.uri,
    name: attrs.name as string,
    description: attrs.description as string,
    dataset: attrs.dataset as BenchmarkDataset,
    version: (attrs.version as string) || '1.0.0',
    tags: (attrs.tags as string[]) || [],
    createdAt: node.createdAt.toISOString(),
  }
}

/**
 * Lista tutti i benchmark.
 */
export async function listBenchmarks(): Promise<Benchmark[]> {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Benchmark' },
    orderBy: { createdAt: 'desc' },
  })

  const benchmarks: Benchmark[] = []
  for (const node of nodes) {
    const b = await getBenchmark(node.uri)
    if (b) benchmarks.push(b)
  }
  return benchmarks
}

// === Evaluation runner ===============================================

/**
 * Esegue una valutazione completa di un agente contro un benchmark.
 *
 * In Fase 2: il caller fornisce i risultati dei task (esecuzione esterna).
 * In Fase 3: il runner esegue direttamente l'agente in sandbox.
 */
export async function runEvaluation(params: {
  agentUri: string
  benchmarkUri: string
  taskResults: TaskResult[]
  notes?: string
  provenance: Provenance
}): Promise<{ uri: string; evaluation: Evaluation }> {
  const benchmark = await getBenchmark(params.benchmarkUri)
  if (!benchmark) {
    throw new Error(`Benchmark not found: ${params.benchmarkUri}`)
  }

  // Calcola metriche
  const metrics = computeMetrics(params.taskResults, benchmark.dataset)

  // Overall score: media pesata delle metriche principali
  const taskSuccessRate = metrics.find((m) => m.name === 'task_success_rate')?.value || 0
  const toolAccuracy = metrics.find((m) => m.name === 'tool_accuracy')?.value || 0
  const policyCompliance = metrics.find((m) => m.name === 'policy_compliance')?.value || 1
  const overallScore = (taskSuccessRate * 0.4 + toolAccuracy * 0.3 + policyCompliance * 0.3)

  // Verdict
  const successCount = params.taskResults.filter((r) => r.success).length
  const verdict: Evaluation['verdict'] =
    successCount === params.taskResults.length ? 'pass'
    : successCount === 0 ? 'fail'
    : 'partial'

  const startedAt = params.taskResults.length > 0
    ? new Date(Math.min(...params.taskResults.map((r) => Date.now() - r.durationMs))).toISOString()
    : new Date().toISOString()

  const evaluation: Evaluation = {
    uri: '', // will be set after createNode
    agentUri: params.agentUri,
    benchmarkUri: params.benchmarkUri,
    startedAt,
    completedAt: new Date().toISOString(),
    overallScore,
    metrics,
    taskResults: params.taskResults,
    verdict,
    notes: params.notes,
  }

  // Crea nodo Evaluation nel Context Graph
  const evalId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uri } = await createNode({
    type: 'Evaluation',
    identifier: evalId,
    attributes: {
      agentUri: params.agentUri,
      score: overallScore, // required by ENTITY_REGISTRY
      benchmarkUri: params.benchmarkUri,
      startedAt: evaluation.startedAt,
      completedAt: evaluation.completedAt,
      overallScore,
      metrics, // required by ENTITY_REGISTRY
      taskResults: params.taskResults,
      verdict,
      notes: params.notes,
    },
    provenance: params.provenance,
  })

  evaluation.uri = uri

  // Crea relazioni:
  //   Agent -[ACHIEVED]-> Evaluation
  //   Evaluation -[BASED_ON]-> Benchmark
  //   Evaluation -[MEASURED_BY]-> Metric (per ogni metrica)
  try {
    await createEdge({
      fromUri: params.agentUri,
      toUri: uri,
      relationType: 'ACHIEVED',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  try {
    await createEdge({
      fromUri: uri,
      toUri: params.benchmarkUri,
      relationType: 'BASED_ON',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  // Crea nodi Metric + edge MEASURED_BY
  for (const metric of metrics) {
    try {
      const metricIdentifier = `metric-${evalId}-${metric.name}`
      await createNode({
        type: 'Metric',
        identifier: metricIdentifier,
        attributes: {
          name: metric.name,
          value: metric.value,
          unit: metric.unit,
          evaluationUri: uri,
        },
        provenance: params.provenance,
      })
      await createEdge({
        fromUri: uri,
        toUri: `metric://${metricIdentifier}`,
        relationType: 'MEASURED_BY',
        createdByAgent: params.provenance.createdByAgent,
      })
    } catch {}
  }

  return { uri, evaluation }
}

// === Metric computation ==============================================

export function computeMetrics(
  taskResults: TaskResult[],
  dataset: BenchmarkDataset,
): Array<{ name: MetricName; value: number; unit: string }> {
  const metrics: Array<{ name: MetricName; value: number; unit: string }> = []

  // 1. Task Success Rate
  const successCount = taskResults.filter((r) => r.success).length
  metrics.push({
    name: 'task_success_rate',
    value: taskResults.length > 0 ? successCount / taskResults.length : 0,
    unit: 'ratio',
  })

  // 2. Tool Accuracy: % di tool calls attesi che sono stati usati correttamente
  let totalExpected = 0
  let totalCorrect = 0
  for (const result of taskResults) {
    const task = dataset.tasks.find((t) => t.id === result.taskId)
    if (!task?.expectedToolCalls?.length) continue
    totalExpected += task.expectedToolCalls.length
    for (const expected of task.expectedToolCalls) {
      if (result.toolCallsUsed.includes(expected)) totalCorrect++
    }
  }
  metrics.push({
    name: 'tool_accuracy',
    value: totalExpected > 0 ? totalCorrect / totalExpected : 1,
    unit: 'ratio',
  })

  // 3. Policy Compliance: % di task senza forbidden actions triggered
  const compliantCount = taskResults.filter((r) => r.forbiddenActionsTriggered.length === 0).length
  metrics.push({
    name: 'policy_compliance',
    value: taskResults.length > 0 ? compliantCount / taskResults.length : 1,
    unit: 'ratio',
  })

  // 4. Hallucination Rate: stima inversa di task_success_rate + expectedContains match
  // (semplificato: in Fase 3 si può integrare con RAG verify)
  const containsMatch = taskResults.filter((r) => {
    const task = dataset.tasks.find((t) => t.id === r.taskId)
    if (!task?.expectedContains?.length) return true
    return task.expectedContains.every((c) => r.output.toLowerCase().includes(c.toLowerCase()))
  }).length
  const hallucinationRate = taskResults.length > 0 ? 1 - (containsMatch / taskResults.length) : 0
  metrics.push({
    name: 'hallucination_rate',
    value: hallucinationRate,
    unit: 'ratio',
  })

  // 5. Reasoning Quality: composite score basato su success + tool accuracy - hallucination
  const reasoningQuality = Math.max(0, Math.min(1,
    (successCount / Math.max(1, taskResults.length)) * 0.5 +
    (totalExpected > 0 ? totalCorrect / totalExpected : 1) * 0.3 +
    (1 - hallucinationRate) * 0.2,
  ))
  metrics.push({
    name: 'reasoning_quality',
    value: reasoningQuality,
    unit: 'score',
  })

  // 6. Avg Latency
  const avgLatency = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.durationMs, 0) / taskResults.length
    : 0
  metrics.push({
    name: 'avg_latency_ms',
    value: avgLatency,
    unit: 'ms',
  })

  // 7. Avg Cost
  const avgCost = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.cost, 0) / taskResults.length
    : 0
  metrics.push({
    name: 'avg_cost_usd',
    value: avgCost,
    unit: 'USD',
  })

  // 8. Token Efficiency: output_length / cost (higher is better)
  // Stima approssimata: tasks con output lungo e costo basso = efficiente
  const totalOutputChars = taskResults.reduce((s, r) => s + r.output.length, 0)
  const totalCost = taskResults.reduce((s, r) => s + r.cost, 0)
  const tokenEfficiency = totalCost > 0 ? totalOutputChars / (totalCost * 1000) : 0
  metrics.push({
    name: 'token_efficiency',
    value: tokenEfficiency,
    unit: 'chars/USD',
  })

  return metrics
}

// === Query ===========================================================

/**
 * Recupera tutte le valutazioni di un agente, ordinate per data.
 */
export async function getAgentEvaluations(agentUri: string, limit = 20): Promise<Evaluation[]> {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Evaluation' },
    take: limit * 2, // over-fetch per filtrare per agent
    orderBy: { createdAt: 'desc' },
  })

  const evaluations: Evaluation[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    if (attrs.agentUri !== agentUri) continue
    evaluations.push({
      uri: node.uri,
      agentUri: attrs.agentUri as string,
      benchmarkUri: attrs.benchmarkUri as string,
      startedAt: attrs.startedAt as string,
      completedAt: attrs.completedAt as string,
      overallScore: attrs.overallScore as number,
      metrics: attrs.metrics as Evaluation['metrics'],
      taskResults: attrs.taskResults as TaskResult[],
      verdict: attrs.verdict as Evaluation['verdict'],
      notes: attrs.notes as string | undefined,
    })
    if (evaluations.length >= limit) break
  }

  return evaluations
}

/**
 * Confronta due valutazioni per rilevare regression/improvement.
 */
export function compareEvaluations(
  before: Evaluation,
  after: Evaluation,
): Array<{ metric: MetricName; delta: number; trend: 'improved' | 'regressed' | 'stable' }> {
  const comparisons: Array<{ metric: MetricName; delta: number; trend: 'improved' | 'regressed' | 'stable' }> = []

  for (const metric of after.metrics) {
    const beforeMetric = before.metrics.find((m) => m.name === metric.name)
    if (!beforeMetric) continue
    const delta = metric.value - beforeMetric.value

    // Per hallucination_rate, avg_latency_ms, avg_cost_usd: lower is better
    const lowerIsBetter = ['hallucination_rate', 'avg_latency_ms', 'avg_cost_usd'].includes(metric.name)
    const trend: 'improved' | 'regressed' | 'stable' =
      Math.abs(delta) < 0.01 ? 'stable'
      : (lowerIsBetter ? (delta < 0 ? 'improved' : 'regressed')
                       : (delta > 0 ? 'improved' : 'regressed'))

    comparisons.push({ metric: metric.name, delta, trend })
  }

  return comparisons
}

/**
 * Statistiche globali del evaluation layer.
 */
export async function evaluationStats() {
  const [totalEvals, totalBenchmarks, recentEvals] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Evaluation' } }),
    db.graphNode.count({ where: { entityType: 'Benchmark' } }),
    db.graphNode.findMany({
      where: { entityType: 'Evaluation' },
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: { attributes: true },
    }),
  ])

  const scores = recentEvals.map((n) => {
    try {
      const attrs = JSON.parse(n.attributes) as Record<string, unknown>
      return attrs.overallScore as number
    } catch {
      return 0
    }
  })
  const avgScore = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : 0

  return {
    totalEvaluations: totalEvals,
    totalBenchmarks,
    avgOverallScore: avgScore,
    recentSamples: scores.length,
  }
}

// === Default benchmarks =============================================

export function evaluationProvenance(agentUri: string = 'agent://evaluation'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'system-event',
    confidence: 1.0,
  })
}

/**
 * Benchmark di default con task semplici per smoke test di qualsiasi agente.
 */
export const DEFAULT_BENCHMARKS = [
  {
    name: 'basic-reasoning',
    description: 'Basic reasoning tasks: every LLM agent should pass these',
    version: '1.0.0',
    tags: ['smoke-test', 'basic', 'reasoning'],
    dataset: {
      tasks: [
        {
          id: 'br-1',
          input: 'What is 2+2?',
          expectedContains: ['4'],
          difficulty: 'trivial' as const,
        },
        {
          id: 'br-2',
          input: 'Capitalize the word "hello"',
          expectedContains: ['HELLO'],
          difficulty: 'trivial' as const,
        },
        {
          id: 'br-3',
          input: 'List 3 colors',
          expectedContains: ['red', 'green', 'blue'],
          difficulty: 'easy' as const,
        },
      ],
      successCriteria: ['Output contains expected substrings'],
    },
    provenance: evaluationProvenance(),
  },
  {
    name: 'tool-use',
    description: 'Verify agent correctly uses expected tools',
    version: '1.0.0',
    tags: ['tools', 'integration'],
    dataset: {
      tasks: [
        {
          id: 'tu-1',
          input: 'Read file /tmp/test.txt',
          expectedToolCalls: ['file.read'],
          difficulty: 'easy' as const,
        },
        {
          id: 'tu-2',
          input: 'Search the web for "typescript tutorial"',
          expectedToolCalls: ['web.search'],
          forbiddenActions: ['file.write'],
          difficulty: 'medium' as const,
        },
      ],
      successCriteria: ['All expected tools called', 'No forbidden actions'],
    },
    provenance: evaluationProvenance(),
  },
]

export async function seedDefaultBenchmarks(): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0
  for (const bm of DEFAULT_BENCHMARKS) {
    try {
      const identifier = `${bm.name.toLowerCase().replace(/\s+/g, '-')}@${bm.version}`
      const existing = await db.graphNode.findUnique({
        where: { uri: `benchmark://${identifier}` },
      })
      if (existing) {
        skipped++
        continue
      }
      await registerBenchmark({
        name: bm.name,
        description: bm.description,
        version: bm.version,
        tags: bm.tags,
        dataset: bm.dataset,
        provenance: bm.provenance,
      })
      created++
    } catch (err) {
      console.warn(`[evaluation] Skip benchmark "${bm.name}":`, err)
      skipped++
    }
  }
  return { created, skipped }
}
