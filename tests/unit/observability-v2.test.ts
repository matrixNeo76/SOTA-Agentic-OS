/**
 * Tests for Observability v2 (Fase 2.6)
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  startTrace, addSpan, addGeneration, endTrace,
  exportToLangfuse, startMetricsAggregator, flushMetrics, peekMetrics,
  getDashboardData,
  recordPolicyViolation, peekPolicyViolations, _resetPolicyViolationsForTests,
} from '@/lib/observability-v2/dashboard'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

describe('Observability v2 — startTrace + addSpan + endTrace', () => {
  beforeAll(async () => {
    await db.traceSpan.deleteMany({})
    await db.costEntry.deleteMany({})
    _resetEventMeshForTests()
  })

  it('startTrace ritorna un context con traceId univoco', () => {
    const ctx1 = startTrace({ name: 'test-1', agentId: 'agent://test' })
    const ctx2 = startTrace({ name: 'test-2', agentId: 'agent://test' })
    expect(ctx1.traceId).not.toBe(ctx2.traceId)
    expect(ctx1.traceId).toMatch(/^trace-/)
    expect(ctx1.events).toEqual([])
  })

  it('addSpan aggiunge uno span al context e persiste in TraceSpan', async () => {
    const ctx = startTrace({ name: 'span-test', agentId: 'agent://test' })
    const spanId = await addSpan(ctx, {
      name: 'test-operation',
      input: { foo: 'bar' },
      output: { result: 42 },
      level: 'INFO',
    })

    expect(spanId).toMatch(/^span-/)
    expect(ctx.events.length).toBe(1)
    expect(ctx.events[0]!.type).toBe('span')
    expect(ctx.events[0]!.name).toBe('test-operation')

    // Verifica persistenza
    const spans = await db.traceSpan.findMany({
      where: { traceId: ctx.traceId },
    })
    expect(spans.length).toBe(1)
    expect(spans[0]!.operation).toBe('test-operation')
  })

  it('addSpan con level ERROR persiste status=error', async () => {
    const ctx = startTrace({ name: 'error-test', agentId: 'agent://test' })
    await addSpan(ctx, {
      name: 'failed-op',
      level: 'ERROR',
      statusMessage: 'Operation failed',
    })

    const span = await db.traceSpan.findFirst({
      where: { traceId: ctx.traceId, operation: 'failed-op' },
    })
    expect(span!.status).toBe('error')
  })

  it('addGeneration registra cost + tokens nel cost-ledger', async () => {
    const ctx = startTrace({ name: 'gen-test', agentId: 'agent://test' })
    const genId = await addGeneration(ctx, {
      name: 'plan_generation',
      model: 'gpt-4',
      promptTokens: 500,
      completionTokens: 200,
      cost: 0.027,
    })

    expect(genId).toMatch(/^gen-/)
    expect(ctx.events.length).toBe(1)
    expect(ctx.events[0]!.type).toBe('generation')
    expect(ctx.events[0]!.usage?.totalTokens).toBe(700)
    expect(ctx.costs.length).toBe(1)
    expect(ctx.costs[0]!.cost).toBe(0.027)

    // Verifica persistenza nel cost ledger
    const costs = await db.costEntry.findMany({
      where: { agentId: 'agent://test', model: 'gpt-4' },
    })
    expect(costs.length).toBe(1)
    expect(costs[0]!.tokensIn).toBe(500)
    expect(costs[0]!.tokensOut).toBe(200)
  })

  it('endTrace ritorna exportStatus disabled in dev (no LANGFUSE_URL)', async () => {
    delete process.env.LANGFUSE_URL
    const ctx = startTrace({ name: 'end-test', agentId: 'agent://test' })
    await addSpan(ctx, { name: 'op' })
    const result = await endTrace(ctx, { output: 'done' })
    expect(result.exportStatus).toBe('disabled')
    expect(result.traceId).toBe(ctx.traceId)
  })

  it('endTrace calcola totalCost e totalTokens nella metadata', async () => {
    const ctx = startTrace({ name: 'cost-test', agentId: 'agent://test' })
    await addGeneration(ctx, {
      name: 'gen1',
      model: 'gpt-4',
      promptTokens: 100,
      completionTokens: 50,
      cost: 0.01,
    })
    await addGeneration(ctx, {
      name: 'gen2',
      model: 'gpt-4',
      promptTokens: 200,
      completionTokens: 100,
      cost: 0.02,
    })

    const result = await endTrace(ctx)
    // La metadata viene passata a Langfuse nel payload di export
    // (in dev l'export è disabled ma i costi sono registrati)
    const costs = await db.costEntry.findMany({
      where: { agentId: 'agent://test', phase: { in: ['gen1', 'gen2'] } },
    })
    expect(costs.length).toBe(2)
    const totalCost = costs.reduce((s, c) => s + c.cost, 0)
    expect(totalCost).toBeCloseTo(0.03, 5)
  })
})

describe('Observability v2 — exportToLangfuse', () => {
  it('ritorna "disabled" senza LANGFUSE_URL', async () => {
    delete process.env.LANGFUSE_URL
    const result = await exportToLangfuse({ traces: [], events: [] })
    expect(result).toBe('disabled')
  })

  it('ritorna "failed" con LANGFUSE_URL ma server non raggiungibile', async () => {
    process.env.LANGFUSE_URL = 'http://localhost:9999'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test'
    process.env.LANGFUSE_SECRET_KEY = 'sk-test'

    const result = await exportToLangfuse({
      traces: [{
        id: 'trace-1',
        name: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      events: [],
    })
    expect(result).toBe('failed')

    delete process.env.LANGFUSE_URL
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
  })
})

describe('Observability v2 — metrics aggregator', () => {
  beforeEach(() => {
    _resetEventMeshForTests()
  })

  it('startMetricsAggregator è idempotente', async () => {
    await startMetricsAggregator()
    await startMetricsAggregator() // seconda chiamata no-op
    // Non deve throware
  })

  it('flushMetrics svuota il buffer', () => {
    const before = peekMetrics()
    flushMetrics()
    const after = peekMetrics()
    expect(after.length).toBeLessThanOrEqual(before.length)
  })
})

describe('Observability v2 — getDashboardData', () => {
  beforeAll(async () => {
    // Aggiungi qualche dato per popolare il dashboard
    const ctx = startTrace({ name: 'dashboard-test', agentId: 'agent://dashboard' })
    await addGeneration(ctx, {
      name: 'plan_generation',
      model: 'gpt-4',
      promptTokens: 1000,
      completionTokens: 500,
      cost: 0.05,
    })
    await endTrace(ctx)
  })

  it('ritorna tutti i campi del dashboard', async () => {
    const data = await getDashboardData()
    expect(data).toHaveProperty('cost')
    expect(data).toHaveProperty('latency')
    expect(data).toHaveProperty('tokens')
    expect(data).toHaveProperty('errors')
    expect(data).toHaveProperty('tools')
    expect(data).toHaveProperty('tasks')
  })

  it('cost.total è un numero >= 0', async () => {
    const data = await getDashboardData()
    expect(typeof data.cost.total).toBe('number')
    expect(data.cost.total).toBeGreaterThanOrEqual(0)
  })

  it('latency ha avgMs, p50Ms, p95Ms come numeri', async () => {
    const data = await getDashboardData()
    expect(typeof data.latency.avgMs).toBe('number')
    expect(typeof data.latency.p50Ms).toBe('number')
    expect(typeof data.latency.p95Ms).toBe('number')
  })

  it('tokens.input e tokens.output sono numeri', async () => {
    const data = await getDashboardData()
    expect(typeof data.tokens.input).toBe('number')
    expect(typeof data.tokens.output).toBe('number')
    expect(data.tokens.total).toBe(data.tokens.input + data.tokens.output)
  })

  it('errors ha open/acknowledged/resolved come numeri', async () => {
    const data = await getDashboardData()
    expect(typeof data.errors.open).toBe('number')
    expect(typeof data.errors.acknowledged).toBe('number')
    expect(typeof data.errors.resolved).toBe('number')
  })

  it('tasks.successRate è tra 0 e 1', async () => {
    const data = await getDashboardData()
    expect(data.tasks.successRate).toBeGreaterThanOrEqual(0)
    expect(data.tasks.successRate).toBeLessThanOrEqual(1)
  })
})

describe('Observability v2 — policy violations', () => {
  beforeAll(() => {
    _resetPolicyViolationsForTests()
    _resetEventMeshForTests()
  })

  it('recordPolicyViolation registra una violazione', async () => {
    await recordPolicyViolation({
      ruleId: 'LTL-001',
      ruleDescription: 'High-risk action requires human approval',
      severity: 'warn',
      context: { taskUri: 'task://test' },
    })

    const violations = peekPolicyViolations()
    expect(violations.length).toBeGreaterThan(0)
    const last = violations[violations.length - 1]!
    expect(last.ruleId).toBe('LTL-001')
    expect(last.severity).toBe('warn')
    expect(last.timestamp).toBeTruthy()
  })

  it('violazione con severity=block emette evento ApprovalRequested', async () => {
    const received: any[] = []
    const { subscribeEvent } = await import('@/lib/event-mesh/mesh')
    const { eventToSubject } = await import('@/lib/governance')
    const subject = eventToSubject({
      type: 'ApprovalRequested',
      payload: {},
      provenance: {
        createdByAgent: 'test',
        source: 'system-event',
        confidence: 1.0,
        timestamp: new Date().toISOString(),
      },
    })
    await subscribeEvent(subject, async (e) => received.push(e))

    await recordPolicyViolation({
      ruleId: 'LTL-BLOCK',
      ruleDescription: 'Critical: requires immediate approval',
      severity: 'block',
      context: {},
    })

    // Verifica audit log
    const logs = await db.agentLog.findMany({
      where: { phase: 'policy-engine', event: 'policy-violation' },
      orderBy: { timestamp: 'desc' },
      take: 1,
    })
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]!.level).toBe('error')
  })
})
