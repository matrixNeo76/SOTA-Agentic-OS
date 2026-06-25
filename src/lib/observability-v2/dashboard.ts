/**
 * Observability v2 — Fase 2.6
 *
 * Layer unificato che integra:
 *   - Error tracking (gia' in kernel/observability.ts)
 *   - Distributed tracing (gia' in kernel/observability.ts — TraceSpan)
 *   - Metrics (gia' in kernel/observability.ts — recordMetric + Prometheus export)
 *   - Cost ledger (gia' in kernel/cost-ledger.ts)
 *
 * Nuovo in Fase 2.6:
 *   1. Langfuse-style trace export (JSON compatibile con Langfuse self-hosted)
 *   2. Aggregazione metriche real-time via Event Mesh
 *   3. Dashboard unificato (cost + latency + token + error + tool accuracy)
 *   4. Governance hooks: policy engine + audit trail + HITL gates
 *
 * Integrazione Langfuse:
 *   POST /api/public/ingestion  →  HTTP endpoint con API key
 *   In dev: trace salvati solo in TraceSpan (nessun export)
 *   In prod: export async verso Langfuse se LANGFUSE_URL+KEY settati
 */

import { db } from '@/lib/db'
import { recordSpan } from '@/lib/kernel/observability'
import { recordCostEntry } from '@/lib/kernel/cost-ledger'
import { subscribeEvent } from '@/lib/event-mesh/mesh'

// === Langfuse-compatible trace format ================================

export interface LangfuseTrace {
  id: string
  name: string
  userId?: string
  sessionId?: string
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface LangfuseEvent {
  id: string
  traceId: string
  type: 'span' | 'event' | 'score' | 'generation'
  name: string
  startTime: string
  endTime?: string
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  level?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  statusMessage?: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    cost?: number
  }
  model?: string
}

export interface LangfuseExport {
  traces: LangfuseTrace[]
  events: LangfuseEvent[]
}

// === Trace context (per-request) =====================================

export interface TraceContext {
  traceId: string
  agentId: string
  userId?: string
  sessionId?: string
  startedAt: Date
  events: LangfuseEvent[]
  costs: Array<{ agentId: string; model: string; tokensIn: number; tokensOut: number; cost: number }>
}

const _activeTraces = new Map<string, TraceContext>()

/**
 * Inizia un nuovo trace. Ritorna un context da passare attraverso la catena.
 */
export function startTrace(params: {
  name: string
  agentId: string
  userId?: string
  sessionId?: string
  input?: unknown
}): TraceContext {
  const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ctx: TraceContext = {
    traceId,
    agentId: params.agentId,
    userId: params.userId,
    sessionId: params.sessionId,
    startedAt: new Date(),
    events: [],
    costs: [],
  }

  _activeTraces.set(traceId, ctx)
  return ctx
}

/**
 * Aggiunge uno span (event con start/end) al trace.
 */
export async function addSpan(ctx: TraceContext, params: {
  name: string
  input?: unknown
  output?: unknown
  startTime?: Date
  endTime?: Date
  metadata?: Record<string, unknown>
  level?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  statusMessage?: string
}): Promise<string> {
  const spanId = `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const start = params.startTime || new Date()
  const end = params.endTime || new Date()

  const event: LangfuseEvent = {
    id: spanId,
    traceId: ctx.traceId,
    type: 'span',
    name: params.name,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    input: params.input,
    output: params.output,
    metadata: params.metadata,
    level: params.level || 'INFO',
    statusMessage: params.statusMessage,
  }

  ctx.events.push(event)

  // Persistenza in TraceSpan (compatibile con kernel/observability.ts)
  await recordSpan({
    traceId: ctx.traceId,
    spanId,
    operation: params.name,
    phase: 'observability-v2',
    userId: ctx.userId,
    status: params.level === 'ERROR' ? 'error' : 'ok',
    durationMs: end.getTime() - start.getTime(),
    metadata: params.metadata,
  })

  return spanId
}

/**
 * Aggiunge un evento di generazione LLM (con usage/cost).
 */
export async function addGeneration(ctx: TraceContext, params: {
  name: string
  model: string
  input?: unknown
  output?: unknown
  promptTokens?: number
  completionTokens?: number
  cost?: number
  startTime?: Date
  endTime?: Date
}): Promise<string> {
  const genId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const start = params.startTime || new Date()
  const end = params.endTime || new Date()

  const totalTokens = (params.promptTokens || 0) + (params.completionTokens || 0)

  const event: LangfuseEvent = {
    id: genId,
    traceId: ctx.traceId,
    type: 'generation',
    name: params.name,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    input: params.input,
    output: params.output,
    model: params.model,
    usage: {
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens,
      cost: params.cost,
    },
  }

  ctx.events.push(event)

  // Registra il costo nel cost-ledger (Fase 14)
  if (params.cost && params.cost > 0) {
    await recordCostEntry({
      agentId: ctx.agentId,
      model: params.model,
      phase: params.name,
      tokensIn: params.promptTokens || 0,
      tokensOut: params.completionTokens || 0,
      cost: params.cost,
    })
    ctx.costs.push({
      agentId: ctx.agentId,
      model: params.model,
      tokensIn: params.promptTokens || 0,
      tokensOut: params.completionTokens || 0,
      cost: params.cost,
    })
  }

  return genId
}

/**
 * Finalizza il trace e lo esporta (best-effort) verso Langfuse.
 */
export async function endTrace(ctx: TraceContext, params?: {
  output?: unknown
  metadata?: Record<string, unknown>
}): Promise<{ traceId: string; exportStatus: 'synced' | 'failed' | 'disabled' }> {
  _activeTraces.delete(ctx.traceId)

  const trace: LangfuseTrace = {
    id: ctx.traceId,
    name: `agent-trace-${ctx.agentId}`,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    input: undefined,
    output: params?.output,
    metadata: {
      ...params?.metadata,
      agentId: ctx.agentId,
      durationMs: Date.now() - ctx.startedAt.getTime(),
      totalCost: ctx.costs.reduce((s, c) => s + c.cost, 0),
      totalTokensIn: ctx.costs.reduce((s, c) => s + c.tokensIn, 0),
      totalTokensOut: ctx.costs.reduce((s, c) => s + c.tokensOut, 0),
      eventsCount: ctx.events.length,
    },
    createdAt: ctx.startedAt.toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Export verso Langfuse (se configurato)
  const exportResult = await exportToLangfuse({
    traces: [trace],
    events: ctx.events,
  })

  return { traceId: ctx.traceId, exportStatus: exportResult }
}

// === Langfuse export =================================================

/**
 * Esporta batch di trace/event verso Langfuse self-hosted.
 *
 * Richiede:
 *   LANGFUSE_URL=https://langfuse.example.com
 *   LANGFUSE_PUBLIC_KEY=...
 *   LANGFUSE_SECRET_KEY=...
 *
 * Se non configurato, ritorna 'disabled' (no-op).
 */
export async function exportToLangfuse(payload: LangfuseExport): Promise<'synced' | 'failed' | 'disabled'> {
  const url = process.env.LANGFUSE_URL
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY

  if (!url || !publicKey || !secretKey) {
    return 'disabled'
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
    const response = await fetch(`${url}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        batch: [
          ...payload.traces.map((t) => ({ type: 'trace-create', body: t })),
          ...payload.events.map((e) => ({ type: 'event-create', body: e })),
        ],
      }),
    })

    if (!response.ok) {
      console.warn(`[observability-v2] Langfuse export failed: ${response.status}`)
      return 'failed'
    }

    return 'synced'
  } catch (err) {
    console.warn('[observability-v2] Langfuse export error:', err)
    return 'failed'
  }
}

// === Real-time metrics aggregator ====================================

export interface MetricUpdate {
  name: string
  value: number
  labels: Record<string, string>
  timestamp: string
}

const _metricsBuffer: MetricUpdate[] = []
const _metricsSubscribed = new Set<string>()

/**
 * Sottoscrive all'Event Mesh per aggregare metriche real-time.
 * Idempotente: può essere chiamato più volte.
 */
export async function startMetricsAggregator(): Promise<void> {
  if (_metricsSubscribed.has('metrics-aggregator')) return
  _metricsSubscribed.add('metrics-aggregator')

  // Sottoscrive a eventi rilevanti per metriche
  await subscribeEvent('sota.task.TaskCompleted', async (event) => {
    _metricsBuffer.push({
      name: 'task_completed_total',
      value: 1,
      labels: { agentId: String(event.payload?.assignedAgent || 'unknown') },
      timestamp: event.timestamp,
    })
    if (event.payload?.durationMs) {
      _metricsBuffer.push({
        name: 'task_duration_ms',
        value: Number(event.payload.durationMs),
        labels: { agentId: String(event.payload?.assignedAgent || 'unknown') },
        timestamp: event.timestamp,
      })
    }
  })

  await subscribeEvent('sota.task.TaskFailed', async (event) => {
    _metricsBuffer.push({
      name: 'task_failed_total',
      value: 1,
      labels: { agentId: String(event.payload?.agentUri || 'unknown') },
      timestamp: event.timestamp,
    })
  })

  await subscribeEvent('sota.tool.ToolResult', async (event) => {
    _metricsBuffer.push({
      name: event.payload?.success ? 'tool_success_total' : 'tool_failure_total',
      value: 1,
      labels: { toolUri: String(event.payload?.toolUri || 'unknown') },
      timestamp: event.timestamp,
    })
  })
}

/**
 * Svuota il buffer metriche (chiamato periodicamente, es. ogni 30s).
 */
export function flushMetrics(): MetricUpdate[] {
  const flushed = [..._metricsBuffer]
  _metricsBuffer.length = 0
  return flushed
}

/**
 * Snapshot delle metriche correnti nel buffer.
 */
export function peekMetrics(): MetricUpdate[] {
  return [..._metricsBuffer]
}

// === Unified dashboard data ==========================================

export interface DashboardData {
  cost: {
    total: number
    byAgent: Record<string, number>
    byModel: Record<string, number>
    last24h: number
  }
  latency: {
    avgMs: number
    p50Ms: number
    p95Ms: number
    byOperation: Record<string, number>
  }
  tokens: {
    input: number
    output: number
    total: number
  }
  errors: {
    open: number
    acknowledged: number
    resolved: number
    last24h: number
  }
  tools: {
    invocations: number
    successRate: number
    byTool: Record<string, { success: number; failure: number }>
  }
  tasks: {
    completed: number
    failed: number
    blocked: number
    successRate: number
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  // Cost aggregation
  const costEntries = await db.costEntry.findMany({
    where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  })
  const byAgent: Record<string, number> = {}
  const byModel: Record<string, number> = {}
  let totalCost = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  for (const entry of costEntries) {
    byAgent[entry.agentId] = (byAgent[entry.agentId] || 0) + entry.cost
    byModel[entry.model] = (byModel[entry.model] || 0) + entry.cost
    totalCost += entry.cost
    totalTokensIn += entry.tokensIn
    totalTokensOut += entry.tokensOut
  }

  // Error aggregation
  const errors = await db.errorRecord.groupBy({
    by: ['status'],
    _count: true,
  })
  const errors24h = await db.errorRecord.count({
    where: { lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  })

  // Traces aggregation (latency)
  const traces = await db.traceSpan.findMany({
    where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { durationMs: true, operation: true, status: true },
  })
  const durations = traces.map((t) => t.durationMs).sort((a, b) => a - b)
  const avgMs = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0
  const p50Ms = durations.length > 0 ? durations[Math.floor(durations.length * 0.5)]! : 0
  const p95Ms = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0
  const byOperation: Record<string, number> = {}
  for (const t of traces) {
    byOperation[t.operation] = (byOperation[t.operation] || 0) + t.durationMs
  }

  // Tool aggregation (from agent log)
  const toolLogs = await db.agentLog.findMany({
    where: { phase: 'tool-registry', timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  })
  let toolInvocations = 0
  let toolSuccess = 0
  let toolFailure = 0
  const byTool: Record<string, { success: number; failure: number }> = {}
  for (const log of toolLogs) {
    toolInvocations++
    if (log.level === 'info') toolSuccess++
    else toolFailure++
    const match = log.payload.match(/"toolId":"([^"]+)"/)
    if (match) {
      const toolId = match[1]!
      if (!byTool[toolId]) byTool[toolId] = { success: 0, failure: 0 }
      if (log.level === 'info') byTool[toolId]!.success++
      else byTool[toolId]!.failure++
    }
  }

  // Task aggregation (from agent log)
  const taskLogs = await db.agentLog.findMany({
    where: {
      event: { in: ['TaskCompleted', 'TaskFailed', 'TaskBlocked'] },
      timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  })
  let taskCompleted = 0
  let taskFailed = 0
  let taskBlocked = 0
  for (const log of taskLogs) {
    if (log.event === 'TaskCompleted') taskCompleted++
    else if (log.event === 'TaskFailed') taskFailed++
    else if (log.event === 'TaskBlocked') taskBlocked++
  }

  return {
    cost: {
      total: totalCost,
      byAgent,
      byModel,
      last24h: totalCost,
    },
    latency: {
      avgMs,
      p50Ms,
      p95Ms,
      byOperation,
    },
    tokens: {
      input: totalTokensIn,
      output: totalTokensOut,
      total: totalTokensIn + totalTokensOut,
    },
    errors: {
      open: errors.find((e) => e.status === 'open')?._count || 0,
      acknowledged: errors.find((e) => e.status === 'acknowledged')?._count || 0,
      resolved: errors.find((e) => e.status === 'resolved')?._count || 0,
      last24h: errors24h,
    },
    tools: {
      invocations: toolInvocations,
      successRate: toolInvocations > 0 ? toolSuccess / toolInvocations : 0,
      byTool,
    },
    tasks: {
      completed: taskCompleted,
      failed: taskFailed,
      blocked: taskBlocked,
      successRate: (taskCompleted + taskFailed) > 0 ? taskCompleted / (taskCompleted + taskFailed) : 0,
    },
  }
}

// === Governance: policy engine hooks =================================

export interface PolicyViolation {
  ruleId: string
  ruleDescription: string
  severity: 'block' | 'warn' | 'log'
  context: Record<string, unknown>
  timestamp: string
}

const _policyViolations: PolicyViolation[] = []

/**
 * Registra una violazione di policy (es. LTL rule violata, red line toccata).
 * Le violazioni 'block' dovrebbero anche emettere un evento ApprovalRequested.
 */
export async function recordPolicyViolation(violation: Omit<PolicyViolation, 'timestamp'>): Promise<void> {
  const full: PolicyViolation = { ...violation, timestamp: new Date().toISOString() }
  _policyViolations.push(full)

  // In caso di severity 'block', emetti evento per Sovereign Validator
  if (violation.severity === 'block') {
    const { publishApprovalRequested } = await import('@/lib/event-mesh/publishers')
    const { createProvenance } = await import('@/lib/governance')
    await publishApprovalRequested(
      `policy-violation://${violation.ruleId}`,
      `Policy violation: ${violation.ruleDescription}`,
      'hitl_gate',
      createProvenance({
        agent: 'agent://policy-engine',
        source: 'system-event',
        confidence: 1.0,
      }),
    )
  }

  // Audit log
  try {
    await db.agentLog.create({
      data: {
        agentId: 'agent://policy-engine',
        phase: 'policy-engine',
        event: 'policy-violation',
        payload: JSON.stringify(full),
        level: violation.severity === 'block' ? 'error' : 'warn',
      },
    })
  } catch {}
}

export function peekPolicyViolations(limit = 100): PolicyViolation[] {
  return _policyViolations.slice(-limit)
}

export function _resetPolicyViolationsForTests(): void {
  _policyViolations.length = 0
}
