/**
 * Tests for Agent Evaluation Layer (Fase 2.7)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  registerBenchmark, getBenchmark, listBenchmarks,
  runEvaluation, computeMetrics, getAgentEvaluations,
  compareEvaluations, evaluationStats, seedDefaultBenchmarks,
  evaluationProvenance,
  type TaskResult,
} from '@/lib/evaluation/runner'
import { db } from '@/lib/db'

const VALID_PROV = evaluationProvenance()

const SAMPLE_DATASET = {
  tasks: [
    {
      id: 't1',
      input: 'What is 2+2?',
      expectedContains: ['4'],
      expectedToolCalls: [],
      difficulty: 'trivial' as const,
    },
    {
      id: 't2',
      input: 'Search for TypeScript tutorial',
      expectedContains: ['typescript'],
      expectedToolCalls: ['web.search'],
      forbiddenActions: ['file.delete'],
      difficulty: 'easy' as const,
    },
    {
      id: 't3',
      input: 'Read file /tmp/test.txt',
      expectedContains: ['content'],
      expectedToolCalls: ['file.read'],
      difficulty: 'easy' as const,
    },
  ],
  successCriteria: ['All tasks completed'],
}

describe('Evaluation Layer — registerBenchmark', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
  })

  it('registra un benchmark valido', async () => {
    const { uri, benchmark } = await registerBenchmark({
      name: 'test-benchmark',
      description: 'A benchmark for testing',
      version: '1.0.0',
      tags: ['test'],
      dataset: SAMPLE_DATASET,
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^benchmark:\/\/test-benchmark@1\.0\.0$/)
    expect(benchmark.name).toBe('test-benchmark')
    expect(benchmark.dataset.tasks.length).toBe(3)
  })

  it('rifiuta name < 3 caratteri', async () => {
    await expect(
      registerBenchmark({
        name: 'ab',
        description: 'too short name',
        dataset: { tasks: [], successCriteria: [] },
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/name must be at least 3 characters/)
  })

  it('rifiuta benchmark senza task', async () => {
    await expect(
      registerBenchmark({
        name: 'empty-benchmark',
        description: 'no tasks',
        dataset: { tasks: [], successCriteria: [] },
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/at least one task/)
  })
})

describe('Evaluation Layer — getBenchmark + listBenchmarks', () => {
  it('recupera benchmark per URI', async () => {
    const { uri } = await registerBenchmark({
      name: 'get-test-bm',
      description: 'For getBenchmark test',
      dataset: SAMPLE_DATASET,
      provenance: VALID_PROV,
    })

    const bm = await getBenchmark(uri)
    expect(bm).not.toBeNull()
    expect(bm!.name).toBe('get-test-bm')
  })

  it('ritorna null per URI inesistente', async () => {
    expect(await getBenchmark('benchmark://nonexistent@1.0.0')).toBeNull()
  })

  it('listBenchmarks ritorna tutti i benchmark', async () => {
    const list = await listBenchmarks()
    expect(list.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Evaluation Layer — computeMetrics', () => {
  it('calcola task_success_rate correttamente', () => {
    const results: TaskResult[] = [
      { taskId: 't1', success: true, output: '4', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 100, cost: 0 },
      { taskId: 't2', success: false, output: 'wrong', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 200, cost: 0 },
    ]
    const metrics = computeMetrics(results, SAMPLE_DATASET)
    const successRate = metrics.find((m) => m.name === 'task_success_rate')!
    expect(successRate.value).toBe(0.5)
  })

  it('calcola tool_accuracy: 1/2 expected tools usati', () => {
    const results: TaskResult[] = [
      {
        taskId: 't2', // expected: web.search
        success: true,
        output: 'typescript tutorial',
        toolCallsUsed: ['web.search'],
        forbiddenActionsTriggered: [],
        durationMs: 500,
        cost: 0,
      },
      {
        taskId: 't3', // expected: file.read
        success: true,
        output: 'content',
        toolCallsUsed: [], // mancato!
        forbiddenActionsTriggered: [],
        durationMs: 100,
        cost: 0,
      },
    ]
    const metrics = computeMetrics(results, SAMPLE_DATASET)
    const toolAcc = metrics.find((m) => m.name === 'tool_accuracy')!
    expect(toolAcc.value).toBe(0.5)
  })

  it('policy_compliance: 0 se forbidden action triggered', () => {
    const results: TaskResult[] = [
      {
        taskId: 't2',
        success: true,
        output: 'ok',
        toolCallsUsed: ['web.search'],
        forbiddenActionsTriggered: ['file.delete'], // VIOLAZIONE
        durationMs: 100,
        cost: 0,
      },
    ]
    const metrics = computeMetrics(results, SAMPLE_DATASET)
    const compliance = metrics.find((m) => m.name === 'policy_compliance')!
    expect(compliance.value).toBe(0)
  })

  it('hallucination_rate: 1 se nessun expectedContains matcha', () => {
    const results: TaskResult[] = [
      {
        taskId: 't1', // expected: '4'
        success: false,
        output: 'cinque', // non contiene '4'
        toolCallsUsed: [],
        forbiddenActionsTriggered: [],
        durationMs: 100,
        cost: 0,
      },
    ]
    const metrics = computeMetrics(results, SAMPLE_DATASET)
    const halluc = metrics.find((m) => m.name === 'hallucination_rate')!
    expect(halluc.value).toBe(1)
  })

  it('avg_latency_ms è la media delle durationMs', () => {
    const results: TaskResult[] = [
      { taskId: 't1', success: true, output: '', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 100, cost: 0 },
      { taskId: 't2', success: true, output: '', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 200, cost: 0 },
    ]
    const metrics = computeMetrics(results, SAMPLE_DATASET)
    const latency = metrics.find((m) => m.name === 'avg_latency_ms')!
    expect(latency.value).toBe(150)
  })

  it('computa 8 metriche in totale', () => {
    const results: TaskResult[] = [
      { taskId: 't1', success: true, output: 'test', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 100, cost: 0.01 },
    ]
    const metrics = computeMetrics(results, SAMPLE_DATASET)
    expect(metrics.length).toBe(8)
  })
})

describe('Evaluation Layer — runEvaluation', () => {
  it('crea Evaluation + relazioni ACHIEVED + MEASURED_BY', async () => {
    const { uri: bmUri } = await registerBenchmark({
      name: 'eval-test-bm',
      description: 'For runEvaluation test',
      dataset: SAMPLE_DATASET,
      provenance: VALID_PROV,
    })

    // Crea un Agent node per la relazione ACHIEVED
    const { createNode } = await import('@/lib/graph-age')
    await createNode({
      type: 'Agent',
      identifier: 'eval-test-agent',
      attributes: { name: 'Eval Test Agent', role: 'general' },
      provenance: VALID_PROV,
    })

    const taskResults: TaskResult[] = [
      { taskId: 't1', success: true, output: '4', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 100, cost: 0 },
      { taskId: 't2', success: true, output: 'typescript tutorial found', toolCallsUsed: ['web.search'], forbiddenActionsTriggered: [], durationMs: 300, cost: 0.01 },
      { taskId: 't3', success: false, output: 'error', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 50, cost: 0 },
    ]

    const { uri, evaluation } = await runEvaluation({
      agentUri: 'agent://eval-test-agent',
      benchmarkUri: bmUri,
      taskResults,
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^evaluation:\/\//)
    expect(evaluation.verdict).toBe('partial') // 2/3 success
    expect(evaluation.metrics.length).toBe(8)
    expect(evaluation.overallScore).toBeGreaterThan(0)
    expect(evaluation.overallScore).toBeLessThanOrEqual(1)

    // Verifica relazioni nel grafo
    const achievedEdges = await db.graphEdge.findMany({
      where: { relationType: 'ACHIEVED', fromNodeId: await getNodeByUri('agent://eval-test-agent') },
    })
    expect(achievedEdges.length).toBeGreaterThan(0)
  })

  it('verdict=pass se tutti i task hanno success', async () => {
    const { uri: bmUri } = await registerBenchmark({
      name: 'pass-test-bm',
      description: 'For pass verdict test',
      dataset: SAMPLE_DATASET,
      provenance: VALID_PROV,
    })

    const taskResults: TaskResult[] = SAMPLE_DATASET.tasks.map((t) => ({
      taskId: t.id,
      success: true,
      output: 'ok',
      toolCallsUsed: t.expectedToolCalls || [],
      forbiddenActionsTriggered: [],
      durationMs: 100,
      cost: 0,
    }))

    const { evaluation } = await runEvaluation({
      agentUri: 'agent://test',
      benchmarkUri: bmUri,
      taskResults,
      provenance: VALID_PROV,
    })

    expect(evaluation.verdict).toBe('pass')
  })

  it('verdict=fail se nessun task ha success', async () => {
    const { uri: bmUri } = await registerBenchmark({
      name: 'fail-test-bm',
      description: 'For fail verdict test',
      dataset: SAMPLE_DATASET,
      provenance: VALID_PROV,
    })

    const taskResults: TaskResult[] = SAMPLE_DATASET.tasks.map((t) => ({
      taskId: t.id,
      success: false,
      output: 'error',
      toolCallsUsed: [],
      forbiddenActionsTriggered: [],
      durationMs: 100,
      cost: 0,
    }))

    const { evaluation } = await runEvaluation({
      agentUri: 'agent://test',
      benchmarkUri: bmUri,
      taskResults,
      provenance: VALID_PROV,
    })

    expect(evaluation.verdict).toBe('fail')
  })
})

describe('Evaluation Layer — getAgentEvaluations + compareEvaluations', () => {
  it('getAgentEvaluations ritorna valutazioni per agent', async () => {
    const evals = await getAgentEvaluations('agent://test')
    expect(evals.length).toBeGreaterThan(0)
    expect(evals.every((e) => e.agentUri === 'agent://test')).toBe(true)
  })

  it('compareEvaluations rileva improved/regressed/stable', () => {
    const before = {
      uri: 'eval://1',
      agentUri: 'a',
      benchmarkUri: 'b',
      startedAt: '',
      completedAt: '',
      overallScore: 0.5,
      metrics: [
        { name: 'task_success_rate' as const, value: 0.5, unit: 'ratio' },
        { name: 'hallucination_rate' as const, value: 0.3, unit: 'ratio' },
      ],
      taskResults: [],
      verdict: 'partial' as const,
    }
    const after = {
      ...before,
      uri: 'eval://2',
      overallScore: 0.8,
      metrics: [
        { name: 'task_success_rate' as const, value: 0.9, unit: 'ratio' }, // improved
        { name: 'hallucination_rate' as const, value: 0.3, unit: 'ratio' }, // stable
      ],
    }

    const comparisons = compareEvaluations(before, after)
    expect(comparisons.length).toBe(2)
    const successRate = comparisons.find((c) => c.metric === 'task_success_rate')!
    expect(successRate.trend).toBe('improved')
    expect(successRate.delta).toBeGreaterThan(0)

    const halluc = comparisons.find((c) => c.metric === 'hallucination_rate')!
    expect(halluc.trend).toBe('stable')
  })

  it('compareEvaluations: lower is better per hallucination/latency/cost', () => {
    const before = {
      uri: 'eval://1',
      agentUri: 'a',
      benchmarkUri: 'b',
      startedAt: '',
      completedAt: '',
      overallScore: 0.5,
      metrics: [
        { name: 'avg_latency_ms' as const, value: 1000, unit: 'ms' },
      ],
      taskResults: [],
      verdict: 'partial' as const,
    }
    const after = {
      ...before,
      uri: 'eval://2',
      metrics: [
        { name: 'avg_latency_ms' as const, value: 500, unit: 'ms' }, // migliorato
      ],
    }

    const comparisons = compareEvaluations(before, after)
    expect(comparisons[0]!.trend).toBe('improved')
    expect(comparisons[0]!.delta).toBe(-500)
  })
})

describe('Evaluation Layer — stats + seedDefaultBenchmarks', () => {
  it('evaluationStats ritorna aggregati', async () => {
    const stats = await evaluationStats()
    expect(stats.totalEvaluations).toBeGreaterThan(0)
    expect(stats.totalBenchmarks).toBeGreaterThan(0)
    expect(typeof stats.avgOverallScore).toBe('number')
  })

  it('seedDefaultBenchmarks è idempotente', async () => {
    const first = await seedDefaultBenchmarks()
    expect(first.created + first.skipped).toBeGreaterThan(0)

    const second = await seedDefaultBenchmarks()
    expect(second.created).toBe(0)
  })
})

// === Helper =========================================================

async function getNodeByUri(uri: string): Promise<string | undefined> {
  const node = await db.graphNode.findUnique({ where: { uri }, select: { id: true } })
  return node?.id
}
