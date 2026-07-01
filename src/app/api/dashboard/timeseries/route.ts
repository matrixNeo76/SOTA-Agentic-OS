/**
 * GET /api/dashboard/timeseries?range=24h|7d|30d
 *
 * Returns hourly time-series for the dashboard charts:
 *   - cost:      [{ ts, cost, tokensIn, tokensOut, calls }]
 *   - errors:    [{ ts, count, open, resolved }]
 *   - llmCalls:  [{ ts, calls, success, failed }]
 *
 * The range param controls the window and bucket size:
 *   24h → 24 buckets of 1h each (most granular)
 *   7d  → 7 buckets of 1d each (daily summary)
 *   30d → 30 buckets of 1d each (monthly trend)
 *
 * All buckets are aligned to UTC midnight for daily ranges, and to the
 * top of the hour for 24h. Empty buckets are returned with zero values
 * so charts render continuous lines.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/require-auth'

type Range = '24h' | '7d' | '30d'

interface HourBucket {
  ts: string
  cost: number
  tokensIn: number
  tokensOut: number
  calls: number
}

interface ErrorBucket {
  ts: string
  count: number
  open: number
  resolved: number
}

interface LlmCallBucket {
  ts: string
  calls: number
  success: number
  failed: number
}

function parseRange(range: string | null): Range {
  if (range === '7d' || range === '30d') return range
  return '24h' // default
}

function getRangeConfig(range: Range): { hours: number; bucketMs: number; label: string } {
  switch (range) {
    case '24h':
      return { hours: 24, bucketMs: 60 * 60 * 1000, label: 'hourly' }      // 1h buckets
    case '7d':
      return { hours: 24 * 7, bucketMs: 24 * 60 * 60 * 1000, label: 'daily' } // 1d buckets
    case '30d':
      return { hours: 24 * 30, bucketMs: 24 * 60 * 60 * 1000, label: 'daily' }
  }
}

function buildBucketStarts(range: Range): Date[] {
  const config = getRangeConfig(range)
  const now = new Date()
  // Align the latest bucket to the start of the current hour/day
  const latest = new Date(now.getTime() - (now.getTime() % config.bucketMs))
  const starts: Date[] = []
  for (let i = config.hours / (config.bucketMs / (60 * 60 * 1000)) - 1; i >= 0; i--) {
    starts.push(new Date(latest.getTime() - i * config.bucketMs))
  }
  return starts
}

function formatBucketTs(d: Date, range: Range): string {
  if (range === '24h') {
    return d.toISOString().slice(0, 13) + ':00:00.000Z' // hour precision
  }
  return d.toISOString().slice(0, 10) + 'T00:00:00.000Z' // day precision
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const range = parseRange(url.searchParams.get('range'))
  const config = getRangeConfig(range)
  const bucketStarts = buildBucketStarts(range)
  const oldest = bucketStarts[0]!

  // === Cost buckets ===
  // GROUP BY hour/day — SQLite doesn't have DATE_TRUNC, so we compute the
  // bucket start in JS from the timestamp. We fetch all rows in range and
  // bucket client-side (cheap for ~thousands of rows; for production scale
  // we'd add a pre-aggregated CostBucket table).
  const costRows = await db.costEntry.findMany({
    where: { timestamp: { gte: oldest } },
    select: { timestamp: true, cost: true, tokensIn: true, tokensOut: true },
    orderBy: { timestamp: 'asc' },
  })

  const costByTs = new Map<string, HourBucket>()
  for (const start of bucketStarts) {
    const ts = formatBucketTs(start, range)
    costByTs.set(ts, { ts, cost: 0, tokensIn: 0, tokensOut: 0, calls: 0 })
  }
  for (const row of costRows) {
    const bucketIdx = Math.floor((row.timestamp.getTime() - oldest.getTime()) / config.bucketMs)
    if (bucketIdx < 0 || bucketIdx >= bucketStarts.length) continue
    const ts = formatBucketTs(bucketStarts[bucketIdx]!, range)
    const bucket = costByTs.get(ts)!
    bucket.cost += row.cost
    bucket.tokensIn += row.tokensIn
    bucket.tokensOut += row.tokensOut
    bucket.calls += 1
  }

  // === Error buckets ===
  // ErrorRecord has firstSeen + lastSeen + count. For timeseries we bucket
  // by lastSeen (when the error was most recently observed).
  const errorRows = await db.errorRecord.findMany({
    where: { lastSeen: { gte: oldest } },
    select: { lastSeen: true, count: true, status: true },
    orderBy: { lastSeen: 'asc' },
  })

  const errorsByTs = new Map<string, ErrorBucket>()
  for (const start of bucketStarts) {
    const ts = formatBucketTs(start, range)
    errorsByTs.set(ts, { ts, count: 0, open: 0, resolved: 0 })
  }
  for (const row of errorRows) {
    const bucketIdx = Math.floor((row.lastSeen.getTime() - oldest.getTime()) / config.bucketMs)
    if (bucketIdx < 0 || bucketIdx >= bucketStarts.length) continue
    const ts = formatBucketTs(bucketStarts[bucketIdx]!, range)
    const bucket = errorsByTs.get(ts)!
    bucket.count += row.count
    if (row.status === 'open' || row.status === 'acknowledged') bucket.open += row.count
    else if (row.status === 'resolved') bucket.resolved += row.count
  }

  // === LLM call buckets ===
  // We don't have a dedicated LLMCall table, so we approximate using
  // AgentLog entries with event='TaskCompleted' or 'TaskFailed' as a proxy
  // for LLM call success/failure. This is rough but gives a trend.
  const llmCallRows = await db.agentLog.findMany({
    where: {
      timestamp: { gte: oldest },
      event: { in: ['TaskCompleted', 'TaskFailed'] },
    },
    select: { timestamp: true, event: true },
    orderBy: { timestamp: 'asc' },
  })

  const llmByTs = new Map<string, LlmCallBucket>()
  for (const start of bucketStarts) {
    const ts = formatBucketTs(start, range)
    llmByTs.set(ts, { ts, calls: 0, success: 0, failed: 0 })
  }
  for (const row of llmCallRows) {
    const bucketIdx = Math.floor((row.timestamp.getTime() - oldest.getTime()) / config.bucketMs)
    if (bucketIdx < 0 || bucketIdx >= bucketStarts.length) continue
    const ts = formatBucketTs(bucketStarts[bucketIdx]!, range)
    const bucket = llmByTs.get(ts)!
    bucket.calls += 1
    if (row.event === 'TaskCompleted') bucket.success += 1
    else if (row.event === 'TaskFailed') bucket.failed += 1
  }

  return NextResponse.json({
    range,
    bucketing: config.label,
    from: oldest.toISOString(),
    to: new Date().toISOString(),
    cost: [...costByTs.values()],
    errors: [...errorsByTs.values()],
    llmCalls: [...llmByTs.values()],
  })
}
