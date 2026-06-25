/**
 * API: /api/cost — Cost tracking dettagli
 *
 * GET action=stats   → aggregazioni complete (total, today, week, byAgent, byModel, byPhase)
 * GET action=recent  → ultime N voci di costo (per timeline view nel modal)
 * POST action=set_budget → set budget giornaliero (alert threshold)
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCostStats } from '@/lib/kernel/cost-ledger'
import { requireAuth } from '@/lib/auth/require-auth'

// === In-memory budget config (would be DB in production) ===
let dailyBudgetUSD: number = 1.0  // default $1/day warn threshold
let dangerBudgetUSD: number = 5.0  // $5/day danger threshold

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'stats'

  if (action === 'stats') {
    const stats = await getCostStats()
    return NextResponse.json({
      ...stats,
      budget: {
        warn: dailyBudgetUSD,
        danger: dangerBudgetUSD,
      },
    })
  }

  if (action === 'recent') {
    const limit = parseInt(searchParams.get('limit') || '50')
    const entries = await db.costEntry.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
    return NextResponse.json({ entries })
  }

  if (action === 'budget') {
    return NextResponse.json({
      warn: dailyBudgetUSD,
      danger: dangerBudgetUSD,
    })
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'set_budget') {
    const { warn, danger } = body
    if (typeof warn === 'number' && warn > 0) dailyBudgetUSD = warn
    if (typeof danger === 'number' && danger > 0) dangerBudgetUSD = danger
    return NextResponse.json({ ok: true, warn: dailyBudgetUSD, danger: dangerBudgetUSD })
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}
