/**
 * Cost Ledger — Traccia i costi di ogni chiamata LLM per aggregazione dashboard.
 *
 * Schema:
 *   CostEntry { agentId, model, phase, tokensIn, tokensOut, cost, timestamp }
 *
 * Pricing table (per 1K tokens, USD):
 *   - zai-glm: $0.0001 input, $0.0002 output (estimate)
 *   - gpt-4: $0.03 input, $0.06 output
 *   - gpt-3.5-turbo: $0.001 input, $0.002 output
 *   - claude-3-opus: $0.015 input, $0.075 output
 *
 * Hook: ogni chiamata LLM nel backend dovrebbe chiamare recordCostEntry().
 */
import { db } from '@/lib/db'

export type CostEntryInput = {
  agentId: string
  model: string
  phase: string  // plan_generation | task_execution | steering | reflection | routing | compilation
  tokensIn: number
  tokensOut: number
  cost: number
  // C6.5 — Optional planId to correlate cost with a specific run.
  // When provided, the run detail view can show accurate per-run costs
  // instead of the broken `phase: { contains: planId }` query that never matched.
  planId?: string
}

// === Pricing table ===
const PRICING: Record<string, { input: number; output: number }> = {
  'zai-glm': { input: 0.0001, output: 0.0002 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
}

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING[model] || PRICING['zai-glm']
  return (tokensIn / 1000) * pricing.input + (tokensOut / 1000) * pricing.output
}

// === Record a cost entry ===
export async function recordCostEntry(input: CostEntryInput): Promise<void> {
  try {
    await db.costEntry.create({
      data: {
        agentId: input.agentId,
        model: input.model,
        phase: input.phase,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        cost: input.cost,
        // C6.5 — Persist planId when provided so /api/runs/detail can query
        // costs for a specific run with a direct equality filter (instead of
        // the broken `phase: { contains: planId }` substring match).
        ...(input.planId ? { planId: input.planId } : {}),
      },
    })
  } catch (e) {
    // Silent fail — cost tracking is best-effort, should not break LLM calls
    console.error('[cost-ledger] failed to record cost entry:', e)
  }
}

// === Aggregation queries ===

export type CostStats = {
  total: number
  today: number
  week: number
  byAgent: Array<{ agentId: string; cost: number; calls: number }>
  byModel: Array<{ model: string; cost: number; calls: number }>
  byPhase: Array<{ phase: string; cost: number; calls: number }>
  totalTokensIn: number
  totalTokensOut: number
  totalCalls: number
}

export async function getCostStats(): Promise<CostStats> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - 7)

  const [allEntries, todayEntries, weekEntries, byAgentRaw, byModelRaw, byPhaseRaw] = await Promise.all([
    db.costEntry.findMany(),
    db.costEntry.findMany({ where: { timestamp: { gte: todayStart } } }),
    db.costEntry.findMany({ where: { timestamp: { gte: weekStart } } }),
    db.costEntry.groupBy({
      by: ['agentId'],
      _sum: { cost: true },
      _count: true,
      orderBy: { _sum: { cost: 'desc' } },
    }),
    db.costEntry.groupBy({
      by: ['model'],
      _sum: { cost: true },
      _count: true,
      orderBy: { _sum: { cost: 'desc' } },
    }),
    db.costEntry.groupBy({
      by: ['phase'],
      _sum: { cost: true },
      _count: true,
      orderBy: { _sum: { cost: 'desc' } },
    }),
  ])

  const total = allEntries.reduce((s, e) => s + e.cost, 0)
  const today = todayEntries.reduce((s, e) => s + e.cost, 0)
  const week = weekEntries.reduce((s, e) => s + e.cost, 0)
  const totalTokensIn = allEntries.reduce((s, e) => s + e.tokensIn, 0)
  const totalTokensOut = allEntries.reduce((s, e) => s + e.tokensOut, 0)

  return {
    total,
    today,
    week,
    byAgent: byAgentRaw.map((a) => ({
      agentId: a.agentId,
      cost: a._sum.cost || 0,
      calls: a._count,
    })),
    byModel: byModelRaw.map((m) => ({
      model: m.model,
      cost: m._sum.cost || 0,
      calls: m._count,
    })),
    byPhase: byPhaseRaw.map((p) => ({
      phase: p.phase,
      cost: p._sum.cost || 0,
      calls: p._count,
    })),
    totalTokensIn,
    totalTokensOut,
    totalCalls: allEntries.length,
  }
}
