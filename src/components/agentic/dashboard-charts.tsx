'use client'

/**
 * Dashboard Charts — C6.3
 *
 * Wraps the existing data-viz chart primitives with the timeseries API
 * data shape. Fetches /api/dashboard/timeseries?range=24h|7d|30d and
 * renders three charts: cost trend, token usage, error trend.
 *
 * The range selector is exposed as a prop so the parent can control it.
 */

import { useEffect, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

// === Types ===========================================================

interface CostBucket {
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

interface TimeseriesResponse {
  range: '24h' | '7d' | '30d'
  bucketing: string
  from: string
  to: string
  cost: CostBucket[]
  errors: ErrorBucket[]
  llmCalls: LlmCallBucket[]
}

type Range = '24h' | '7d' | '30d'

// === Shared tooltip ==================================================

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-card border rounded-lg shadow-soft-md p-2 text-xs space-y-0.5">
      {label && <div className="font-medium text-muted-foreground">{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium tabular-nums">
            {typeof entry.value === 'number'
              ? entry.value < 1 && entry.value > 0
                ? `$${entry.value.toFixed(4)}`
                : entry.value.toLocaleString()
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatTs(ts: string, range: Range): string {
  const d = new Date(ts)
  if (range === '24h') {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

// === Main dashboard charts component =================================

export function DashboardCharts({ range: initialRange = '24h' }: { range?: Range }) {
  const [range, setRange] = useState<Range>(initialRange)
  const [data, setData] = useState<TimeseriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async (r: Range) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/timeseries?range=${r}`)
      if (!res.ok) {
        if (res.status === 401) {
          const next = window.location.pathname + window.location.search
          window.location.href = `/login?next=${encodeURIComponent(next)}`
          return
        }
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as TimeseriesResponse
      setData(json)
    } catch (err: any) {
      setError(err.message)
      toast.error(`Failed to load charts: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData(range)
  }, [range])

  const totalCost = data?.cost.reduce((s, b) => s + b.cost, 0) ?? 0
  const totalTokens = data?.cost.reduce((s, b) => s + b.tokensIn + b.tokensOut, 0) ?? 0
  const totalErrors = data?.errors.reduce((s, b) => s + b.count, 0) ?? 0
  const totalOpenErrors = data?.errors.reduce((s, b) => s + b.open, 0) ?? 0
  const totalLlmCalls = data?.llmCalls.reduce((s, b) => s + b.calls, 0) ?? 0
  const totalLlmSuccess = data?.llmCalls.reduce((s, b) => s + b.success, 0) ?? 0
  const totalLlmFailed = data?.llmCalls.reduce((s, b) => s + b.failed, 0) ?? 0

  const rangeOptions: Range[] = ['24h', '7d', '30d']

  return (
    <div className="space-y-4">
      {/* Range selector */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {rangeOptions.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? 'default' : 'outline'}
              onClick={() => setRange(r)}
              className="h-7 text-xs"
            >
              {r === '24h' ? '24 hours' : r === '7d' ? '7 days' : '30 days'}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fetchData(range)}
          disabled={loading}
          className="h-7 text-xs"
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-destructive text-xs">
            Failed to load chart data: {error}
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[260px] bg-muted/30 rounded-lg animate-pulse" />
          <div className="h-[260px] bg-muted/30 rounded-lg animate-pulse" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Cost Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cost Trend</CardTitle>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Total: <span className="font-medium text-foreground tabular-nums">{formatCost(totalCost)}</span></span>
                <span>Tokens: <span className="font-medium text-foreground tabular-nums">{totalTokens.toLocaleString()}</span></span>
                <span>Calls: <span className="font-medium text-foreground tabular-nums">{data.cost.reduce((s, b) => s + b.calls, 0).toLocaleString()}</span></span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.cost.map((b) => ({ ...b, time: formatTs(b.ts, range) }))}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--brand, hsl(221 83% 53%))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--brand, hsl(221 83% 53%))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" tickFormatter={(v) => formatCost(v)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="var(--brand, hsl(221 83% 53%))"
                    strokeWidth={2}
                    fill="url(#costGrad)"
                    name="Cost (USD)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Token Usage */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Token Usage</CardTitle>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>In: <span className="font-medium text-foreground tabular-nums">{(data.cost.reduce((s, b) => s + b.tokensIn, 0)).toLocaleString()}</span></span>
                <span>Out: <span className="font-medium text-foreground tabular-nums">{(data.cost.reduce((s, b) => s + b.tokensOut, 0)).toLocaleString()}</span></span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.cost.map((b) => ({ ...b, time: formatTs(b.ts, range) }))}>
                  <defs>
                    <linearGradient id="tokInGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="tokOutGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(38 92% 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="tokensIn" stroke="hsl(142 71% 45%)" strokeWidth={2} fill="url(#tokInGrad)" name="Tokens In" />
                  <Area type="monotone" dataKey="tokensOut" stroke="hsl(38 92% 50%)" strokeWidth={2} fill="url(#tokOutGrad)" name="Tokens Out" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* LLM Calls (success vs failed) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">LLM Calls</CardTitle>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Total: <span className="font-medium text-foreground tabular-nums">{totalLlmCalls.toLocaleString()}</span></span>
                <span className="text-status-ok">Success: <span className="font-medium tabular-nums">{totalLlmSuccess.toLocaleString()}</span></span>
                <span className="text-status-warn">Failed: <span className="font-medium tabular-nums">{totalLlmFailed.toLocaleString()}</span></span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.llmCalls.map((b) => ({ ...b, time: formatTs(b.ts, range) }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="success" stackId="a" fill="hsl(142 71% 45%)" name="Success" />
                  <Bar dataKey="failed" stackId="a" fill="hsl(0 84% 60%)" name="Failed" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Errors */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Errors</CardTitle>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Total: <span className="font-medium text-foreground tabular-nums">{totalErrors.toLocaleString()}</span></span>
                <span className="text-status-warn">Open: <span className="font-medium tabular-nums">{totalOpenErrors.toLocaleString()}</span></span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.errors.map((b) => ({ ...b, time: formatTs(b.ts, range) }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="count" stroke="hsl(0 84% 60%)" strokeWidth={2} name="Errors" dot={false} />
                  <Line type="monotone" dataKey="open" stroke="hsl(38 92% 50%)" strokeWidth={2} name="Open" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
