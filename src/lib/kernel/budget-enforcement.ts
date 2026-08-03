/**
 * Budget Enforcement — Fase 3.2
 *
 * Controlla se un'organizzazione ha superato il budget giornaliero.
 * Se superato, blocca le chiamate LLM (restituisce errore 429).
 *
 * Usato dal middleware API e dalle route che chiamano LLM.
 */
import { redis } from '@/lib/redis'
import { db } from '@/lib/db'

type BudgetCheck = {
  allowed: boolean
  reason?: string
  todaySpend: number
  warnThreshold: number
  dangerThreshold: number
  remaining: number
}

// In-memory budget cache (5 min TTL)
const budgetCache = new Map<string, { value: { warn: number; danger: number }; expires: number }>()

async function getBudget(orgId: string): Promise<{ warn: number; danger: number }> {
  const cached = budgetCache.get(orgId)
  if (cached && cached.expires > Date.now()) {
    return cached.value
  }

  // Default values
  const defaults = { warn: 1.0, danger: 5.0 }

  // Try to get from Redis (set by /api/cost set_budget)
  try {
    const raw = await redis.get(`budget:${orgId}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      const value = { warn: parsed.warn ?? defaults.warn, danger: parsed.danger ?? defaults.danger }
      budgetCache.set(orgId, { value, expires: Date.now() + 5 * 60 * 1000 })
      return value
    }
  } catch {}

  budgetCache.set(orgId, { value: defaults, expires: Date.now() + 5 * 60 * 1000 })
  return defaults
}

/**
 * Check if organization can make LLM calls.
 * Returns allowed=false if daily spend >= danger threshold.
 */
export async function checkBudget(orgId: string): Promise<BudgetCheck> {
  const budget = await getBudget(orgId)

  // Get today's spend from CostEntry
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const entries = await db.costEntry.findMany({
    where: {
      organizationId: orgId,
      timestamp: { gte: todayStart },
    },
    select: { cost: true },
  })

  const todaySpend = entries.reduce((sum, e) => sum + e.cost, 0)
  const remaining = Math.max(0, budget.danger - todaySpend)

  if (todaySpend >= budget.danger) {
    return {
      allowed: false,
      reason: `Budget giornaliero superato: $${todaySpend.toFixed(4)} / $${budget.danger}`,
      todaySpend,
      warnThreshold: budget.warn,
      dangerThreshold: budget.danger,
      remaining: 0,
    }
  }

  return {
    allowed: true,
    todaySpend,
    warnThreshold: budget.warn,
    dangerThreshold: budget.danger,
    remaining,
  }
}

/**
 * Set budget thresholds for an organization (stored in Redis).
 */
export async function setBudget(orgId: string, warn: number, danger: number): Promise<void> {
  const value = { warn, danger }
  await redis.set(`budget:${orgId}`, JSON.stringify(value))
  budgetCache.set(orgId, { value, expires: Date.now() + 5 * 60 * 1000 })
}
