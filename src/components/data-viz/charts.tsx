'use client'

/**
 * Data-viz Components — UX-5b
 *
 * Grafici standardizzati con recharts per costi, token, latenza, trend evaluation.
 * Usano i token CSS del design system per coerenza visiva.
 *
 * Pattern: ogni grafico = Card con header + chart + footer (summary)
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  type TooltipProps,
} from 'recharts'

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
          <span className="font-medium tnum">
            {typeof entry.value === 'number'
              ? entry.value < 1
                ? `$${entry.value.toFixed(4)}`
                : entry.value.toLocaleString()
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// === Cost Trend Chart =================================================

export interface CostTrendData {
  timestamp: string
  cost: number
  tokensIn: number
  tokensOut: number
}

export function CostTrendChart({ data, height = 200 }: { data: CostTrendData[]; height?: number }) {
  const formatted = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
  }))

  const totalCost = data.reduce((s, d) => s + d.cost, 0)
  const totalTokens = data.reduce((s, d) => s + d.tokensIn + d.tokensOut, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cost Trend</CardTitle>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Total: <span className="font-medium text-foreground tnum">${totalCost.toFixed(4)}</span></span>
          <span>Tokens: <span className="font-medium text-foreground tnum">{totalTokens.toLocaleString()}</span></span>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={formatted}>
            <defs>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="cost"
              name="Cost"
              stroke="var(--brand)"
              strokeWidth={2}
              fill="url(#costGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// === Token Usage Bar Chart ============================================

export function TokenUsageChart({ data, height = 200 }: { data: CostTrendData[]; height?: number }) {
  const formatted = data.map((d) => ({
    time: new Date(d.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
    Input: d.tokensIn,
    Output: d.tokensOut,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Token Usage</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
            <Bar dataKey="Input" fill="var(--status-info)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Output" fill="var(--status-ok)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// === Latency Line Chart ===============================================

export interface LatencyData {
  timestamp: string
  latencyMs: number
  label?: string
}

export function LatencyChart({ data, height = 200 }: { data: LatencyData[]; height?: number }) {
  const formatted = data.map((d) => ({
    ...d,
    time: d.label || new Date(d.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
  }))

  const avg = data.length > 0 ? data.reduce((s, d) => s + d.latencyMs, 0) / data.length : 0
  const max = data.length > 0 ? Math.max(...data.map((d) => d.latencyMs)) : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Latency</CardTitle>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Avg: <span className="font-medium text-foreground tnum">{avg.toFixed(0)}ms</span></span>
          <span>Max: <span className="font-medium text-foreground tnum">{max.toFixed(0)}ms</span></span>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}ms`} />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="latencyMs"
              name="Latency"
              stroke="var(--status-warn)"
              strokeWidth={2}
              dot={{ r: 2, fill: 'var(--status-warn)' }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// === Evaluation Trend =================================================

export interface EvaluationTrendData {
  evaluation: string
  score: number
  taskSuccess: number
}

export function EvaluationTrendChart({ data, height = 200 }: { data: EvaluationTrendData[]; height?: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Evaluation Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="evaluation" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="score" name="Overall Score" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="taskSuccess" name="Task Success" stroke="var(--status-ok)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// === Mini Sparkline (inline) ==========================================

export function Sparkline({ data, color = 'var(--brand)', height = 32, width = 80 }: {
  data: number[]
  color?: string
  height?: number
  width?: number
}) {
  const chartData = data.map((v, i) => ({ x: i, y: v }))
  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.4} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
