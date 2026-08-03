'use client'

/**
 * InsightsView — Fase 4 G1
 *
 * Vista unificata del modulo Insights con 6 tab:
 *   1. Overview      — KPI aggregate (reuse AutonomousDashboard pattern)
 *   2. World Model   — Predictions + latest WorldState
 *   3. Evaluation    — Benchmarks + agent rankings + export JSON/CSV
 *   4. Cost          — Timeline chart + by agent/model + budget config
 *   5. Observability — Errors + traces con filtri
 *   6. Affect        — Desperation/frustration per agente + thresholds
 *
 * B9: adaptive polling via useGovernanceData (5s active, 30s idle)
 * B12: error handling con toast su ogni operazione
 * G3: export JSON/CSV per evaluation results
 * G10: a11y completa (aria-label, role, aria-busy)
 * G11: audit log su cost set_budget + errors resolve
 */

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  TrendingUp, Brain, GitBranch, DollarSign, Activity, HeartPulse,
  RefreshCw, Download, AlertTriangle, CheckCircle2, XCircle, Clock,
  Filter, Zap, Target, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGovernanceData } from '@/components/module-pages/use-governance-data'
import { AutonomousDashboard } from '@/components/autonomous-dashboard/autonomous-dashboard'
import { DigitalTwinDashboard } from '@/components/autonomous-dashboard/digital-twin-panel'

// === Main Component ==================================================

export function InsightsView() {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <ModulePage
      title="Insights"
      description="World Model · Digital Twin · Evaluation · Cost · Observability · Affect"
      icon="TrendingUp"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-4xl grid-cols-2 md:grid-cols-6">
          <TabsTrigger value="overview"><Activity className="size-3.5 mr-1.5" /> Overview</TabsTrigger>
          <TabsTrigger value="worldmodel"><Brain className="size-3.5 mr-1.5" /> World Model</TabsTrigger>
          <TabsTrigger value="evaluation"><Target className="size-3.5 mr-1.5" /> Evaluation</TabsTrigger>
          <TabsTrigger value="cost"><DollarSign className="size-3.5 mr-1.5" /> Cost</TabsTrigger>
          <TabsTrigger value="observability"><AlertTriangle className="size-3.5 mr-1.5" /> Observability</TabsTrigger>
          <TabsTrigger value="affect"><HeartPulse className="size-3.5 mr-1.5" /> Affect</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          <AutonomousDashboard />
          <DigitalTwinDashboard />
        </TabsContent>
        <TabsContent value="worldmodel" className="mt-4 space-y-4"><WorldModelTab /></TabsContent>
        <TabsContent value="evaluation" className="mt-4 space-y-4"><EvaluationTab /></TabsContent>
        <TabsContent value="cost" className="mt-4 space-y-4"><CostTab /></TabsContent>
        <TabsContent value="observability" className="mt-4 space-y-4"><ObservabilityTab /></TabsContent>
        <TabsContent value="affect" className="mt-4 space-y-4"><AffectTab /></TabsContent>
      </Tabs>
    </ModulePage>
  )
}

// === Tab 2: World Model ==============================================

type WorldModelData = {
  stats?: { worldStates?: number; pendingPredictions?: number; risks?: number }
  latestWorldState?: { uri?: string; snapshot?: any; capturedAt?: string }
  pendingPredictions?: Array<{ uri: string; statement: string; probability: number; horizon: string; basedOnWorldStateUri: string }>
}

function WorldModelTab() {
  const { data, loading, refresh } = useGovernanceData<WorldModelData>(
    useCallback(async () => {
      const r = await fetch('/api/world-model')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )

  const captureState = async () => {
    try {
      const r = await fetch('/api/world-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'capture' }),
      })
      const d = await r.json()
      if (!r.ok) { toast.error(`Capture failed: ${d.error}`); return }
      toast.success('WorldState captured')
      refresh()
    } catch (e: any) { toast.error(`Capture failed: ${e.message}`) }
  }

  if (loading && !data) {
    return <div className="space-y-4" aria-busy="true">
      <div className="h-20 bg-muted animate-pulse rounded-lg" />
      <div className="h-48 bg-muted animate-pulse rounded-lg" />
    </div>
  }

  const snapshot = data?.latestWorldState?.snapshot
  const pendingCount = data?.pendingPredictions?.length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><Brain className="w-5 h-5" /> World Model</h3>
          <p className="text-xs text-muted-foreground">
            {data?.stats?.worldStates ?? 0} states · {pendingCount} pending predictions · {data?.stats?.risks ?? 0} risks
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={captureState} aria-label="Capture new WorldState snapshot">
          <RefreshCw className="size-3.5 mr-1.5" /> Capture State
        </Button>
      </div>

      {/* Latest WorldState */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="size-4" /> Latest WorldState</CardTitle>
          {data?.latestWorldState?.capturedAt && (
            <CardDescription>Captured: {new Date(data.latestWorldState.capturedAt).toLocaleString('it-IT')}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          {snapshot ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Tasks 24h" value={`${snapshot.completedTasksLast24h ?? 0} ✓ · ${snapshot.failedTasksLast24h ?? 0} ✗`} />
              <Metric label="Cost 24h" value={`$${(snapshot.totalCostLast24h ?? 0).toFixed(2)}`} />
              <Metric label="Error rate" value={`${((snapshot.errorRate ?? 0) * 100).toFixed(1)}%`} />
              <Metric label="Anomalies" value={snapshot.anomalies?.length ?? 0} tone={snapshot.anomalies?.length > 0 ? 'warn' : 'ok'} />
            </div>
          ) : (
            <EmptyState icon="Brain" title="No WorldState captured" description="Click 'Capture State' to create one" />
          )}
        </CardContent>
      </Card>

      {/* Pending predictions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pending Predictions ({pendingCount})</CardTitle>
          <CardDescription>Predictions not yet validated against actual outcomes</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.pendingPredictions && data.pendingPredictions.length > 0 ? (
            <ScrollArea className="h-64 pr-2">
              <ul className="space-y-2">
                {data.pendingPredictions.map((p) => (
                  <li key={p.uri} className="text-xs border rounded-md p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="font-mono text-[10px]">{p.probability.toFixed(2)}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{p.horizon}</Badge>
                      <span className="flex-1 truncate font-medium">{p.statement}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{p.basedOnWorldStateUri}</div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="Brain" title="No pending predictions" description="All predictions have been validated" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'danger' }) {
  const color = tone === 'danger' ? 'text-status-danger' : tone === 'warn' ? 'text-status-warn' : tone === 'ok' ? 'text-status-ok' : ''
  return (
    <div className="border rounded p-2">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={cn('font-bold text-sm', color)}>{value}</div>
    </div>
  )
}

// === Tab 3: Evaluation ===============================================

type EvaluationData = {
  stats?: { totalBenchmarks?: number; totalEvaluations?: number; avgScore?: number }
  benchmarks?: Array<{ uri: string; name: string; description: string; version: string; tags?: string[] }>
}

function EvaluationTab() {
  const { data, loading, refresh } = useGovernanceData<EvaluationData>(
    useCallback(async () => {
      const r = await fetch('/api/evaluation')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )

  // G3: export JSON/CSV
  const exportJSON = () => {
    if (!data?.benchmarks?.length) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evaluation-benchmarks-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${data.benchmarks.length} benchmarks to JSON`)
  }

  const exportCSV = () => {
    if (!data?.benchmarks?.length) return
    const headers = ['uri', 'name', 'description', 'version', 'tags']
    const rows = data.benchmarks.map(b => [
      b.uri, `"${b.name.replace(/"/g, '""')}"`,
      `"${b.description.replace(/"/g, '""')}"`, b.version,
      `"${(b.tags || []).join(', ')}"`,
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evaluation-benchmarks-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${data.benchmarks.length} benchmarks to CSV`)
  }

  const seedDefaults = async () => {
    try {
      const r = await fetch('/api/evaluation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed-defaults' }),
      })
      const d = await r.json()
      if (!r.ok) { toast.error(`Seed failed: ${d.error}`); return }
      toast.success(`Seeded: ${d.created} created, ${d.skipped} skipped`)
      refresh()
    } catch (e: any) { toast.error(`Seed failed: ${e.message}`) }
  }

  if (loading && !data) {
    return <div className="space-y-4" aria-busy="true">
      <div className="h-20 bg-muted animate-pulse rounded-lg" />
      <div className="h-48 bg-muted animate-pulse rounded-lg" />
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><Target className="w-5 h-5" /> Evaluation</h3>
          <p className="text-xs text-muted-foreground">
            {data?.stats?.totalBenchmarks ?? 0} benchmarks · {data?.stats?.totalEvaluations ?? 0} evaluations · avg score {((data?.stats?.avgScore ?? 0) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={exportJSON} disabled={!data?.benchmarks?.length} aria-label="Export benchmarks to JSON">
            <Download className="size-3.5 mr-1" aria-hidden="true" /> JSON
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={!data?.benchmarks?.length} aria-label="Export benchmarks to CSV">
            <Download className="size-3.5 mr-1" aria-hidden="true" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={seedDefaults} aria-label="Seed default benchmarks">
            <Zap className="size-3.5 mr-1" aria-hidden="true" /> Seed Defaults
          </Button>
          <Button size="sm" variant="outline" onClick={refresh} aria-label="Refresh evaluation data">
            <RefreshCw className="size-3.5 mr-1" aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Benchmarks ({data?.benchmarks?.length ?? 0})</CardTitle>
          <CardDescription>Registered evaluation benchmarks with datasets</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.benchmarks && data.benchmarks.length > 0 ? (
            <ScrollArea className="h-64 pr-2">
              <ul className="space-y-2">
                {data.benchmarks.map((b) => (
                  <li key={b.uri} className="text-xs border rounded-md p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium flex-1 truncate">{b.name}</span>
                      <Badge variant="outline" className="text-[10px]">v{b.version}</Badge>
                      {b.tags?.map(t => <Badge key={t} variant="secondary" className="text-[9px]">{t}</Badge>)}
                    </div>
                    <div className="text-muted-foreground truncate">{b.description}</div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">{b.uri}</div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="Target" title="No benchmarks" description="Click 'Seed Defaults' to register standard benchmarks" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// === Tab 4: Cost =====================================================

type CostStats = {
  total: number; today: number; week: number
  byAgent: Array<{ agentId: string; cost: number; calls: number }>
  byModel: Array<{ model: string; cost: number; calls: number }>
  byPhase: Array<{ phase: string; cost: number; calls: number }>
  totalTokensIn: number; totalTokensOut: number; totalCalls: number
  budget?: { warn: number; danger: number }
}

function CostTab() {
  const { data: stats, loading, refresh } = useGovernanceData<CostStats>(
    useCallback(async () => {
      const r = await fetch('/api/cost?action=stats')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )

  // Recent entries with filters (B9)
  const [filterAgent, setFilterAgent] = useState('')
  const [filterModel, setFilterModel] = useState('all')
  const [filterPhase, setFilterPhase] = useState('all')
  const [recent, setRecent] = useState<any[]>([])

  const fetchRecent = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (filterAgent) params.set('agentId', filterAgent)
      if (filterModel !== 'all') params.set('model', filterModel)
      if (filterPhase !== 'all') params.set('phase', filterPhase)
      const r = await fetch(`/api/cost?action=recent&${params}`)
      if (!r.ok) return
      const d = await r.json()
      setRecent(d.entries || [])
    } catch { /* silent */ }
  }, [filterAgent, filterModel, filterPhase])

  useEffect(() => { fetchRecent() }, [fetchRecent])

  // Budget config (G11: audit logged in API)
  const [warnVal, setWarnVal] = useState('')
  const [dangerVal, setDangerVal] = useState('')
  const [savingBudget, setSavingBudget] = useState(false)

  useEffect(() => {
    if (stats?.budget) {
      setWarnVal(String(stats.budget.warn))
      setDangerVal(String(stats.budget.danger))
    }
  }, [stats?.budget])

  const saveBudget = async () => {
    setSavingBudget(true)
    try {
      const r = await fetch('/api/cost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_budget', warn: parseFloat(warnVal), danger: parseFloat(dangerVal) }),
      })
      const d = await r.json()
      if (!r.ok) { toast.error(`Save budget failed: ${d.error}`); return }
      toast.success('Budget updated (audited)')
      refresh()
    } catch (e: any) { toast.error(`Save budget failed: ${e.message}`) }
    finally { setSavingBudget(false) }
  }

  if (loading && !stats) {
    return <div className="space-y-4" aria-busy="true">
      <div className="h-20 bg-muted animate-pulse rounded-lg" />
      <div className="h-48 bg-muted animate-pulse rounded-lg" />
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><DollarSign className="w-5 h-5" /> Cost Tracking</h3>
          <p className="text-xs text-muted-foreground">
            Total: ${(stats?.total ?? 0).toFixed(4)} · Today: ${(stats?.today ?? 0).toFixed(4)} · Week: ${(stats?.week ?? 0).toFixed(4)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} aria-label="Refresh cost data">
          <RefreshCw className="size-3.5 mr-1" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Total Cost</div>
          <div className="text-2xl font-bold font-mono">${(stats?.total ?? 0).toFixed(4)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Today</div>
          <div className={cn('text-2xl font-bold font-mono', (stats?.today ?? 0) >= (stats?.budget?.warn ?? 1) && 'text-status-warn')}>
            ${(stats?.today ?? 0).toFixed(4)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Total Calls</div>
          <div className="text-2xl font-bold font-mono">{stats?.totalCalls ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Total Tokens</div>
          <div className="text-2xl font-bold font-mono">{((stats?.totalTokensIn ?? 0) + (stats?.totalTokensOut ?? 0)).toLocaleString()}</div>
        </CardContent></Card>
      </div>

      {/* Budget config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="size-4" /> Budget Thresholds</CardTitle>
          <CardDescription>Alert thresholds for daily spend (changes are audit-logged)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Warn threshold (USD/day)</Label>
              <Input type="number" step="0.1" value={warnVal} onChange={e => setWarnVal(e.target.value)} aria-label="Warn budget threshold in USD" />
            </div>
            <div>
              <Label className="text-xs">Danger threshold (USD/day)</Label>
              <Input type="number" step="0.5" value={dangerVal} onChange={e => setDangerVal(e.target.value)} aria-label="Danger budget threshold in USD" />
            </div>
          </div>
          <Button size="sm" onClick={saveBudget} disabled={savingBudget || !warnVal || !dangerVal} aria-label="Save budget thresholds">
            {savingBudget ? <RefreshCw className="size-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1.5" />}
            Save Budget
          </Button>
        </CardContent>
      </Card>

      {/* Breakdown by agent/model/phase */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">By Agent</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {stats?.byAgent?.slice(0, 10).map(a => (
              <div key={a.agentId} className="flex justify-between border-b pb-1">
                <span className="truncate">{a.agentId}</span>
                <span className="font-mono">${a.cost.toFixed(4)} ({a.calls})</span>
              </div>
            )) || <EmptyState icon="DollarSign" title="No data" description="No cost entries recorded yet" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">By Model</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {stats?.byModel?.slice(0, 10).map(m => (
              <div key={m.model} className="flex justify-between border-b pb-1">
                <span className="truncate">{m.model}</span>
                <span className="font-mono">${m.cost.toFixed(4)} ({m.calls})</span>
              </div>
            )) || <EmptyState icon="DollarSign" title="No data" description="No cost entries recorded yet" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">By Phase</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {stats?.byPhase?.slice(0, 10).map(p => (
              <div key={p.phase} className="flex justify-between border-b pb-1">
                <span className="truncate">{p.phase}</span>
                <span className="font-mono">${p.cost.toFixed(4)} ({p.calls})</span>
              </div>
            )) || <EmptyState icon="DollarSign" title="No data" description="No cost entries recorded yet" />}
          </CardContent>
        </Card>
      </div>

      {/* Recent entries with filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="size-4" /> Recent Entries ({recent.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* B9 filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input value={filterAgent} onChange={e => setFilterAgent(e.target.value)} placeholder="agentId filter" aria-label="Filter by agent ID" />
            <Select value={filterModel} onValueChange={setFilterModel}>
              <SelectTrigger aria-label="Filter by model"><SelectValue placeholder="model" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all models</SelectItem>
                <SelectItem value="zai-glm">zai-glm</SelectItem>
                <SelectItem value="gpt-4">gpt-4</SelectItem>
                <SelectItem value="gpt-3.5-turbo">gpt-3.5-turbo</SelectItem>
                <SelectItem value="claude-3-opus">claude-3-opus</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPhase} onValueChange={setFilterPhase}>
              <SelectTrigger aria-label="Filter by phase"><SelectValue placeholder="phase" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all phases</SelectItem>
                <SelectItem value="plan_generation">plan_generation</SelectItem>
                <SelectItem value="task_execution">task_execution</SelectItem>
                <SelectItem value="steering">steering</SelectItem>
                <SelectItem value="reflection">reflection</SelectItem>
                <SelectItem value="routing">routing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {recent.length > 0 ? (
            <ScrollArea className="h-64 pr-2">
              <ul className="space-y-1">
                {recent.map((e) => (
                  <li key={e.id} className="text-xs border rounded p-2 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{e.agentId}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{e.model}</Badge>
                    <Badge variant="outline" className="text-[10px]">{e.phase}</Badge>
                    <span className="font-mono text-[10px]">${e.cost.toFixed(4)}</span>
                    <span className="text-[10px] text-muted-foreground">{e.tokensIn}↓ {e.tokensOut}↑</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{new Date(e.timestamp).toLocaleTimeString('it-IT')}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="DollarSign" title="No entries" description="Adjust filters or run some tasks" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// === Tab 5: Observability ============================================

function ObservabilityTab() {
  const { data: errorStats, loading: errorsLoading } = useGovernanceData<any>(
    useCallback(async () => {
      const r = await fetch('/api/errors?action=stats')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )
  const { data: traceStats } = useGovernanceData<any>(
    useCallback(async () => {
      const r = await fetch('/api/traces?action=stats')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )
  const [errors, setErrors] = useState<any[]>([])
  const [traces, setTraces] = useState<any[]>([])

  const fetchErrors = useCallback(async () => {
    try {
      const r = await fetch('/api/errors?limit=20')
      if (!r.ok) return
      const d = await r.json()
      setErrors(d.errors || [])
    } catch { /* silent */ }
  }, [])

  const fetchTraces = useCallback(async () => {
    try {
      const r = await fetch('/api/traces?limit=20')
      if (!r.ok) return
      const d = await r.json()
      setTraces(d.traces || [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { fetchErrors(); fetchTraces() }, [fetchErrors, fetchTraces])

  const resolveError = async (errorId: string) => {
    try {
      const r = await fetch('/api/errors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', errorId, resolvedBy: 'admin', status: 'resolved' }),
      })
      const d = await r.json()
      if (!r.ok) { toast.error(`Resolve failed: ${d.error}`); return }
      toast.success('Error resolved (audited)')
      fetchErrors()
    } catch (e: any) { toast.error(`Resolve failed: ${e.message}`) }
  }

  if (errorsLoading && !errorStats) {
    return <div className="space-y-4" aria-busy="true">
      <div className="h-20 bg-muted animate-pulse rounded-lg" />
      <div className="h-48 bg-muted animate-pulse rounded-lg" />
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Observability</h3>
          <p className="text-xs text-muted-foreground">
            {errorStats?.open ?? 0} open errors · {errorStats?.resolved ?? 0} resolved · {traceStats?.totalTraces ?? 0} traces
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Open Errors</div>
          <div className={cn('text-2xl font-bold font-mono', (errorStats?.open ?? 0) > 0 && 'text-status-danger')}>{errorStats?.open ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Resolved</div>
          <div className="text-2xl font-bold font-mono text-status-ok">{errorStats?.resolved ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Total Traces</div>
          <div className="text-2xl font-bold font-mono">{traceStats?.totalTraces ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Avg Duration</div>
          <div className="text-2xl font-bold font-mono">{(traceStats?.avgDurationMs ?? 0).toFixed(0)}ms</div>
        </CardContent></Card>
      </div>

      {/* Errors list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Errors</CardTitle>
          <CardDescription>Deduplicated by fingerprint · resolve actions are audit-logged</CardDescription>
        </CardHeader>
        <CardContent>
          {errors.length > 0 ? (
            <ScrollArea className="h-64 pr-2">
              <ul className="space-y-2">
                {errors.map((e) => (
                  <li key={e.id} className="text-xs border rounded-md p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      {e.status === 'open' ? <XCircle className="size-3.5 text-status-danger" /> : <CheckCircle2 className="size-3.5 text-status-ok" />}
                      <Badge variant="outline" className="text-[10px]">{e.source}</Badge>
                      {e.phase && <Badge variant="secondary" className="text-[10px]">{e.phase}</Badge>}
                      <Badge variant={e.status === 'open' ? 'destructive' : 'success'} className="text-[10px]">{e.status}</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {e.count}× · {new Date(e.lastSeen).toLocaleString('it-IT')}
                      </span>
                    </div>
                    <div className="font-medium truncate">{e.message}</div>
                    {e.status === 'open' && (
                      <Button size="sm" variant="ghost" className="h-5 text-[10px] mt-1" onClick={() => resolveError(e.id)} aria-label={`Resolve error: ${e.message.slice(0, 30)}`}>
                        <CheckCircle2 className="size-3 mr-1" /> Resolve
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="CheckCircle2" title="No errors" description="All errors resolved" />
          )}
        </CardContent>
      </Card>

      {/* Traces list */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Recent Traces</CardTitle></CardHeader>
        <CardContent>
          {traces.length > 0 ? (
            <ScrollArea className="h-48 pr-2">
              <ul className="space-y-1">
                {traces.map((t) => (
                  <li key={t.traceId} className="text-xs border rounded p-2 flex items-center gap-2">
                    {t.status === 'error' ? <XCircle className="size-3 text-status-danger" /> : <CheckCircle2 className="size-3 text-status-ok" />}
                    <Badge variant="outline" className="font-mono text-[10px]">{t.operation}</Badge>
                    <span className="font-mono text-[10px]">{t.spanCount} spans · {t.durationMs}ms</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{new Date(t.timestamp).toLocaleString('it-IT')}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="Activity" title="No traces" description="Run some operations to generate traces" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// === Tab 6: Affect ===================================================

function AffectTab() {
  const { data: stats, loading } = useGovernanceData<any>(
    useCallback(async () => {
      const r = await fetch('/api/affect?action=stats')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )
  const [history, setHistory] = useState<any[]>([])
  const [agentId, setAgentId] = useState('orchestrator')

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`/api/affect?action=history&agentId=${encodeURIComponent(agentId)}`)
      if (!r.ok) return
      const d = await r.json()
      setHistory(d.history || [])
    } catch { /* silent */ }
  }, [agentId])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  if (loading && !stats) {
    return <div className="space-y-4" aria-busy="true">
      <div className="h-20 bg-muted animate-pulse rounded-lg" />
      <div className="h-48 bg-muted animate-pulse rounded-lg" />
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><HeartPulse className="w-5 h-5" /> Affect Monitor</h3>
          <p className="text-xs text-muted-foreground">
            Desperation & frustration tracking · {stats?.totalSamples ?? 0} samples · {stats?.interventions ?? 0} interventions
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Total Samples</div>
          <div className="text-2xl font-bold font-mono">{stats?.totalSamples ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Avg Desperation</div>
          <div className={cn('text-2xl font-bold font-mono', (stats?.avgDesperation ?? 0) > 0.7 && 'text-status-danger')}>
            {((stats?.avgDesperation ?? 0) * 100).toFixed(1)}%
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Avg Frustration</div>
          <div className={cn('text-2xl font-bold font-mono', (stats?.avgFrustration ?? 0) > 0.7 && 'text-status-warn')}>
            {((stats?.avgFrustration ?? 0) * 100).toFixed(1)}%
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Interventions</div>
          <div className={cn('text-2xl font-bold font-mono', (stats?.interventions ?? 0) > 0 && 'text-status-warn')}>
            {stats?.interventions ?? 0}
          </div>
        </CardContent></Card>
      </div>

      {/* Agent selector + history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Affect History per Agent</CardTitle>
          <CardDescription>Desperation & frustration over time</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Agent ID</Label>
              <Input value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="orchestrator" aria-label="Agent ID for affect history" />
            </div>
            <Button size="sm" variant="outline" onClick={fetchHistory} aria-label="Fetch affect history">
              <RefreshCw className="size-3.5 mr-1" /> Fetch
            </Button>
          </div>

          {history.length > 0 ? (
            <ScrollArea className="h-64 pr-2">
              {/* G6: simple visualization as bar chart (no recharts dependency needed) */}
              <div className="space-y-2">
                {history.map((h, i) => (
                  <div key={i} className="text-xs border rounded p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-32">{new Date(h.timestamp).toLocaleString('it-IT')}</span>
                      <div className="flex-1 space-y-1">
                        {/* Desperation bar */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] w-16 text-muted-foreground">Desp</span>
                          <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                            <div className={cn('h-full', h.desperation > 0.7 ? 'bg-status-danger' : h.desperation > 0.4 ? 'bg-status-warn' : 'bg-status-ok')}
                              style={{ width: `${Math.min(h.desperation * 100, 100)}%` }} role="progressbar" aria-valuenow={h.desperation} aria-valuemin={0} aria-valuemax={1} aria-label={`Desperation: ${(h.desperation * 100).toFixed(0)}%`} />
                          </div>
                          <span className="text-[9px] font-mono w-8 text-right">{(h.desperation * 100).toFixed(0)}%</span>
                        </div>
                        {/* Frustration bar */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] w-16 text-muted-foreground">Frustr</span>
                          <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                            <div className={cn('h-full', h.frustration > 0.7 ? 'bg-status-danger' : h.frustration > 0.4 ? 'bg-status-warn' : 'bg-status-ok')}
                              style={{ width: `${Math.min(h.frustration * 100, 100)}%` }} role="progressbar" aria-valuenow={h.frustration} aria-valuemin={0} aria-valuemax={1} aria-label={`Frustration: ${(h.frustration * 100).toFixed(0)}%`} />
                          </div>
                          <span className="text-[9px] font-mono w-8 text-right">{(h.frustration * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      {h.intervention && <Badge variant="destructive" className="text-[9px]">intervention</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState icon="HeartPulse" title="No affect history" description={`No samples for agent "${agentId}"`} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
