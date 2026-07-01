'use client'

/**
 * GovernanceView — Fase 4 G1
 *
 * Vista unificata del modulo Trust & Governance con 5 tab:
 *   1. Overview   — KPI aggregate (blocked, gates, delegations, LTL, redlines, audit)
 *   2. Sovereign  — Blocked actions queue (HITL)
 *   3. LTL & Taint — Regole LTL + Taint records + editor
 *   4. Red Lines  — Red Lines + Axioms normative + CRUD completa
 *   5. Audit      — Audit Ledger con filtri + pagination + export JSON/CSV
 *
 * B9: adaptive polling via useGovernanceData (5s active, 30s idle)
 * B12: error handling con toast su ogni operazione
 * G4: export JSON/CSV per Audit Ledger
 * G5: usa /api/admin/audit/ledger con filtri
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Shield, ShieldAlert, Scale, BookOpen, Activity, Lock,
  RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle,
  Trash2, Power, Edit, Download, Filter, Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGovernanceData } from './use-governance-data'
import { SovereignView } from '@/components/workbench/sovereign-view'
import { LTLNormativeEditor } from '@/components/agentic/ltl-normative-editor'

// === Types ===========================================================

type BlockedAction = {
  id: string
  agentId: string
  action: string
  source: string
  readableExplanation: string
  status: string
  createdAt: string
}

type ApprovalGate = {
  id: string
  agentId: string
  action: string
  reason: string
  status: string
  createdAt: string
  expiresAt?: string | null
}

type RedLine = {
  id: string
  description: string
  rationale: string
  severity: string
  active: boolean
}

type LTLRule = {
  id: string
  ruleId: string
  ltlFormula: string
  severity: string
  active: boolean
}

type Axiom = {
  id: string
  axiom: string
  priority: number
  active: boolean
}

type AuditEntry = {
  id: string
  agentId: string
  action: string
  decision: string
  delegationId?: string | null
  readableNarrative: string
  reversible: boolean
  timestamp: string
}

type GovernanceOverview = {
  blockedActions: BlockedAction[]
  approvalGates: ApprovalGate[]
  redLines: RedLine[]
  ltlRules: LTLRule[]
  normativeRules: Axiom[]
}

type RetainerStats = {
  activeDelegations: number
  totalDelegations: number
  pendingGates: number
  resolvedGates: number
  approvedGates: number
  rejectedGates: number
  auditEntries: number
  normativeResolutions: number
  blockedResolutions: number
}

type BlockedStats = {
  total: number
  pending: number
  approved: number
  rejected: number
  modified: number
  downgraded: number
}

// === Helpers =========================================================

const SEVERITY_BADGE: Record<string, string> = {
  absolute: 'bg-status-danger text-white',
  strong: 'bg-status-warn text-white',
  soft: 'bg-status-info text-white',
}

const PRIORITY_LABEL: Record<number, { label: string; color: string; border: string }> = {
  1: { label: 'Legale', color: 'bg-status-danger', border: 'border-status-danger' },
  2: { label: 'Operativo', color: 'bg-status-warn', border: 'border-status-warn' },
  3: { label: 'Efficienza', color: 'bg-status-info', border: 'border-status-info' },
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// === Main Component ==================================================

export function GovernanceView() {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <ModulePage
      title="Trust & Governance"
      description="LTL · Conflicts · Sovereign · Audit · Delegations"
      icon="ShieldCheck"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-4xl grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="overview"><Activity className="size-3.5 mr-1.5" /> Overview</TabsTrigger>
          <TabsTrigger value="sovereign"><ShieldAlert className="size-3.5 mr-1.5" /> Sovereign</TabsTrigger>
          <TabsTrigger value="ltl"><Lock className="size-3.5 mr-1.5" /> LTL & Taint</TabsTrigger>
          <TabsTrigger value="redlines"><Shield className="size-3.5 mr-1.5" /> Red Lines</TabsTrigger>
          <TabsTrigger value="audit"><BookOpen className="size-3.5 mr-1.5" /> Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="sovereign" className="mt-4">
          {/* G1: riusa SovereignView esistente (ha già batch resolve, filters, axiom trail) */}
          <SovereignView />
        </TabsContent>

        <TabsContent value="ltl" className="mt-4 space-y-4">
          <LTLTaintTab />
        </TabsContent>

        <TabsContent value="redlines" className="mt-4 space-y-4">
          <RedLinesTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4 space-y-4">
          <AuditLedgerTab />
        </TabsContent>
      </Tabs>
    </ModulePage>
  )
}

// === Tab 1: Overview =================================================

function OverviewTab() {
  // B9: adaptive polling per stats
  const { data: stats, loading: statsLoading, error: statsError } = useGovernanceData<RetainerStats>(
    useCallback(async () => {
      const r = await fetch('/api/retainer?action=stats')
      if (!r.ok) throw new Error(`Stats: HTTP ${r.status}`)
      return r.json()
    }, []),
  )
  const { data: blockedStats } = useGovernanceData<BlockedStats>(
    useCallback(async () => {
      const r = await fetch('/api/blocked-actions?action=stats')
      if (!r.ok) throw new Error(`Blocked stats: HTTP ${r.status}`)
      return r.json()
    }, []),
  )
  const { data: gov, loading: govLoading } = useGovernanceData<GovernanceOverview>(
    useCallback(async () => {
      const r = await fetch('/api/admin/governance')
      if (!r.ok) throw new Error(`Governance: HTTP ${r.status}`)
      return r.json()
    }, []),
  )

  if ((statsLoading || govLoading) && !stats && !gov) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}
        </div>
        <div className="h-48 bg-muted animate-pulse rounded-lg" />
      </div>
    )
  }

  if (statsError && !stats) {
    return <EmptyState icon="AlertTriangle" title="Failed to load" description={statsError} />
  }

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Blocked Pending" value={blockedStats?.pending ?? 0} tone={blockedStats && blockedStats.pending > 0 ? 'danger' : 'ok'} icon={ShieldAlert} />
        <KpiCard label="Gates Pending" value={stats?.pendingGates ?? 0} tone={stats && stats.pendingGates > 0 ? 'warn' : 'ok'} icon={Clock} />
        <KpiCard label="Active Delegations" value={stats?.activeDelegations ?? 0} icon={Scale} />
        <KpiCard label="Audit Entries" value={stats?.auditEntries ?? 0} icon={BookOpen} />
        <KpiCard label="LTL Rules" value={gov?.ltlRules.filter(r => r.active).length ?? 0} icon={Lock} />
        <KpiCard label="Active Red Lines" value={gov?.redLines.filter(r => r.active).length ?? 0} icon={Shield} />
        <KpiCard label="Normative Axioms" value={gov?.normativeRules.filter(a => a.active).length ?? 0} icon={Scale} />
        <KpiCard label="Blocked Resolutions" value={stats?.blockedResolutions ?? 0} tone={stats && stats.blockedResolutions > 0 ? 'warn' : 'ok'} icon={XCircle} />
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="size-4" /> Quick Stats
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatLine label="Gates Approved" value={stats?.approvedGates ?? 0} tone="ok" />
            <StatLine label="Gates Rejected" value={stats?.rejectedGates ?? 0} tone="danger" />
            <StatLine label="Normative Resolutions" value={stats?.normativeResolutions ?? 0} />
            <StatLine label="Blocked Approved" value={blockedStats?.approved ?? 0} tone="ok" />
            <StatLine label="Blocked Rejected" value={blockedStats?.rejected ?? 0} tone="danger" />
            <StatLine label="Blocked Modified" value={blockedStats?.modified ?? 0} tone="info" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone?: 'ok' | 'warn' | 'danger'; icon: typeof Shield }) {
  const color = tone === 'danger' ? 'text-status-danger' : tone === 'warn' ? 'text-status-warn' : tone === 'ok' ? 'text-status-ok' : ''
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn('text-2xl font-bold font-mono mt-1', color)}>{value}</div>
          </div>
          <Icon className={cn('size-6 opacity-50', color)} />
        </div>
      </CardContent>
    </Card>
  )
}

function StatLine({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  const color = tone === 'danger' ? 'text-status-danger' : tone === 'warn' ? 'text-status-warn' : tone === 'ok' ? 'text-status-ok' : tone === 'info' ? 'text-status-info' : ''
  return (
    <div className="flex items-center justify-between border-b pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono font-semibold', color)}>{value}</span>
    </div>
  )
}

// === Tab 3: LTL & Taint ==============================================

function LTLTaintTab() {
  const { data: ltlData, loading: ltlLoading, refresh: refreshLtl } = useGovernanceData<{
    rules: Array<{ id: string; ruleId: string; ltlFormula: string; description: string | null; severity: string; active: boolean }>
  }>(useCallback(async () => {
    const r = await fetch('/api/verify?section=ltl')
    if (!r.ok) throw new Error(`LTL: HTTP ${r.status}`)
    return r.json()
  }, []))

  const { data: taintData, refresh: refreshTaint } = useGovernanceData<{
    records: Array<{ id: string; source: string; payload: string; taintLabel: string; flowTrace: string; blocked: boolean; createdAt: string }>
  }>(useCallback(async () => {
    const r = await fetch('/api/verify?section=taint')
    if (!r.ok) throw new Error(`Taint: HTTP ${r.status}`)
    return r.json()
  }, []))

  // G3: simulate LTL
  const [simFormula, setSimFormula] = useState('G(plan -> F execute)')
  const [simEvents, setSimEvents] = useState('plan\nexecute\nhalt')
  const [simResult, setSimResult] = useState<any>(null)
  const [simulating, setSimulating] = useState(false)

  const runSim = async () => {
    setSimulating(true)
    try {
      const events = simEvents.split('\n').map(s => s.trim()).filter(Boolean)
      const r = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'simulate_ltl', formula: simFormula, events }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(`Simulate failed: ${d.error || `HTTP ${r.status}`}`)
        return
      }
      setSimResult(d)
      if (d.finalVerdict === 'accept') toast.success(`Simulazione: ACCEPT (0 violazioni)`)
      else if (d.finalVerdict === 'warn') toast.warning(`Simulazione: WARN (${d.totalViolations} violazioni)`)
      else toast.error(`Simulazione: REJECT (${d.totalViolations} violazioni)`)
    } catch (e: any) {
      toast.error(`Simulate failed: ${e.message}`)
    } finally {
      setSimulating(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="size-4" /> LTL Rules ({ltlData?.rules.length ?? 0})
          </CardTitle>
          <CardDescription>Regole Linear Temporal Logic compilate in FSM con overhead O(1)</CardDescription>
        </CardHeader>
        <CardContent>
          {ltlLoading && !ltlData ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
            </div>
          ) : ltlData && ltlData.rules.length > 0 ? (
            <div className="space-y-2">
              {ltlData.rules.map(r => (
                <div key={r.id} className="border rounded-md p-2 text-xs flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">{r.ruleId}</Badge>
                  <Badge variant={r.severity === 'block' ? 'destructive' : r.severity === 'warn' ? 'warning' : 'secondary'}>
                    {r.severity}
                  </Badge>
                  {!r.active && <Badge variant="outline">inactive</Badge>}
                  <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono flex-1 truncate">{r.ltlFormula}</code>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="Lock" title="No LTL rules" description="Use the editor below to add rules" />
          )}
        </CardContent>
      </Card>

      {/* G3: LTL Simulator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="size-4" /> LTL Simulator (G3)
          </CardTitle>
          <CardDescription>Simula una formula su una sequenza di eventi prima di salvarla</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Formula LTL</Label>
            <Input value={simFormula} onChange={e => setSimFormula(e.target.value)} className="font-mono" />
          </div>
          <div>
            <Label className="text-xs">Eventi (uno per riga)</Label>
            <Textarea value={simEvents} onChange={e => setSimEvents(e.target.value)} rows={4} className="font-mono text-xs" />
          </div>
          <Button size="sm" onClick={runSim} disabled={simulating}>
            {simulating ? <RefreshCw className="size-3.5 mr-1.5 animate-spin" /> : <Activity className="size-3.5 mr-1.5" />}
            Simula
          </Button>
          {simResult && (
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                {simResult.finalVerdict === 'accept' && <CheckCircle2 className="size-4 text-status-ok" />}
                {simResult.finalVerdict === 'warn' && <AlertTriangle className="size-4 text-status-warn" />}
                {simResult.finalVerdict === 'reject' && <XCircle className="size-4 text-status-danger" />}
                <Badge variant={simResult.finalVerdict === 'accept' ? 'success' : simResult.finalVerdict === 'warn' ? 'warning' : 'destructive'}>
                  {simResult.finalVerdict.toUpperCase()}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {simResult.totalViolations} violazione/i · pattern: {simResult.pattern}
                </span>
              </div>
              {simResult.steps && (
                <div className="space-y-1 max-h-40 overflow-auto">
                  {simResult.steps.map((s: any, i: number) => (
                    <div key={i} className="text-[11px] flex items-center gap-2 font-mono">
                      <span className="text-muted-foreground w-6">{i}</span>
                      <span className="w-20">{s.event}</span>
                      {s.verdict === 'accept' && <CheckCircle2 className="size-3 text-status-ok" />}
                      {s.verdict === 'warn' && <AlertTriangle className="size-3 text-status-warn" />}
                      {s.verdict === 'reject' && <XCircle className="size-3 text-status-danger" />}
                      {s.violations.length > 0 && (
                        <span className="text-status-danger truncate">{s.violations.map((v: any) => v.reason).join('; ')}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* LTL Editor */}
      <LTLNormativeEditor />

      {/* Taint records */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="size-4" /> Taint Records ({taintData?.records.length ?? 0})
          </CardTitle>
          <CardDescription>Input non fidati tracciati verso sink sensibili</CardDescription>
        </CardHeader>
        <CardContent>
          {taintData && taintData.records.length > 0 ? (
            <ScrollArea className="h-64 pr-2">
              <ul className="space-y-1.5">
                {taintData.records.map(t => {
                  const flow = safeJsonParse<string[]>(t.flowTrace, [])
                  return (
                    <li key={t.id} className="text-xs border rounded-md p-2">
                      <div className="flex items-center gap-2 mb-1">
                        {t.blocked ? <XCircle className="size-3.5 text-status-danger" /> : <Filter className="size-3.5 text-status-warn" />}
                        <Badge variant="outline">{t.source}</Badge>
                        <Badge variant={t.taintLabel === 'EXPIRED' ? 'secondary' : 'default'}>{t.taintLabel}</Badge>
                        {t.blocked && <Badge variant="destructive">BLOCCATO</Badge>}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(t.createdAt).toLocaleString('it-IT')}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground italic mb-1">"{t.payload}"</div>
                      {flow.length > 0 && (
                        <div className="text-[10px] font-mono">flow: {flow.join(' → ')}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="Filter" title="No taint records" description="Mark input as tainted in Phase 4 to see records here" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// === Tab 4: Red Lines & Axioms =======================================

function RedLinesTab() {
  const { data: gov, loading, refresh } = useGovernanceData<GovernanceOverview>(
    useCallback(async () => {
      const r = await fetch('/api/admin/governance')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }, []),
  )

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [editRationale, setEditRationale] = useState('')
  const [editSeverity, setEditSeverity] = useState('strong')

  const toggleRedLine = async (id: string, active: boolean) => {
    try {
      const r = await fetch('/api/admin/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-redline', redLineId: id, active }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(`Toggle failed: ${d.error}`)
        return
      }
      toast.success(`Red Line ${active ? 'activated' : 'deactivated'}`)
      refresh()
    } catch (e: any) {
      toast.error(`Toggle failed: ${e.message}`)
    }
  }

  const deleteRedLine = async (id: string, desc: string) => {
    if (!confirm(`Delete Red Line "${desc.slice(0, 50)}..." permanently?`)) return
    try {
      const r = await fetch('/api/admin/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-redline', redLineId: id }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(`Delete failed: ${d.error}`)
        return
      }
      toast.success('Red Line deleted')
      refresh()
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  const startEdit = (rl: RedLine) => {
    setEditingId(rl.id)
    setEditDesc(rl.description)
    setEditRationale(rl.rationale)
    setEditSeverity(rl.severity)
  }

  const saveEdit = async () => {
    if (!editingId) return
    try {
      const r = await fetch('/api/admin/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-redline',
          redLineId: editingId,
          description: editDesc,
          rationale: editRationale,
          severity: editSeverity,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(`Update failed: ${d.error}`)
        return
      }
      toast.success('Red Line updated')
      setEditingId(null)
      refresh()
    } catch (e: any) {
      toast.error(`Update failed: ${e.message}`)
    }
  }

  if (loading && !gov) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-12 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Red Lines CRUD */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="size-4" /> Red Lines ({gov?.redLines.length ?? 0})
              </CardTitle>
              <CardDescription>Linee non negoziabili valutate ad ogni euristica proposta</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(s => !s)}>
              <Plus className="size-3.5 mr-1.5" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {showAddForm && <AddRedLineInline onAdded={() => { refresh(); setShowAddForm(false) }} />}
          {gov && gov.redLines.length > 0 ? (
            gov.redLines.map(rl => (
              <div key={rl.id} className="border rounded-md p-3 text-xs">
                {editingId === rl.id ? (
                  <div className="space-y-2">
                    <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" />
                    <Textarea value={editRationale} onChange={e => setEditRationale(e.target.value)} placeholder="Rationale" rows={2} />
                    <Select value={editSeverity} onValueChange={setEditSeverity}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="absolute">absolute</SelectItem>
                        <SelectItem value="strong">strong</SelectItem>
                        <SelectItem value="soft">soft</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit}><CheckCircle2 className="size-3.5 mr-1" /> Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {!rl.active && <Badge variant="secondary">inactive</Badge>}
                          {rl.description}
                        </div>
                        {rl.rationale && <div className="text-muted-foreground mt-1">{rl.rationale}</div>}
                      </div>
                      <Badge className={cn('text-[10px]', SEVERITY_BADGE[rl.severity] || 'bg-secondary')}>{rl.severity}</Badge>
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => toggleRedLine(rl.id, !rl.active)}>
                        <Power className="size-3 mr-1" /> {rl.active ? 'Disable' : 'Enable'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => startEdit(rl)}>
                        <Edit className="size-3 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px] text-status-danger" onClick={() => deleteRedLine(rl.id, rl.description)}>
                        <Trash2 className="size-3 mr-1" /> Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          ) : (
            <EmptyState icon="Shield" title="No Red Lines" description="Add non-negotiable safety rules" />
          )}
        </CardContent>
      </Card>

      {/* Axioms normative */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="size-4" /> Normative Axioms ({gov?.normativeRules.length ?? 0})
          </CardTitle>
          <CardDescription>Gerarchia: legale (1) &gt; operativo (2) &gt; efficienza (3)</CardDescription>
        </CardHeader>
        <CardContent>
          {gov && gov.normativeRules.length > 0 ? (
            <div className="space-y-2">
              {[1, 2, 3].map(p => {
                const axioms = gov.normativeRules.filter(a => a.priority === p)
                if (axioms.length === 0) return null
                const meta = PRIORITY_LABEL[p]
                return (
                  <div key={p} className={cn('border-l-4 pl-3 py-1', meta.border)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('size-2 rounded-full', meta.color)} />
                      <span className="text-xs font-medium">Priorità {p} · {meta.label}</span>
                      <Badge variant="outline" className="text-[10px]">{axioms.length}</Badge>
                    </div>
                    <ul className="space-y-1">
                      {axioms.map(a => (
                        <li key={a.id} className="text-xs flex items-center gap-2 pl-3">
                          {!a.active && <Badge variant="secondary" className="text-[9px]">inactive</Badge>}
                          <span className={cn('flex-1', !a.active && 'text-muted-foreground line-through')}>{a.axiom}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState icon="Scale" title="No axioms" description="Add normative axioms in LTL & Taint tab" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AddRedLineInline({ onAdded }: { onAdded: () => void }) {
  const [description, setDescription] = useState('')
  const [rationale, setRationale] = useState('')
  const [severity, setSeverity] = useState('strong')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!description.trim()) {
      toast.error('Description is required')
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/admin/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-redline', description, rationale, severity }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(`Add failed: ${d.error}`)
        return
      }
      toast.success('Red Line added')
      setDescription(''); setRationale(''); setSeverity('strong')
      onAdded()
    } catch (e: any) {
      toast.error(`Add failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30">
      <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description *" />
      <Textarea value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Rationale" rows={2} />
      <Select value={severity} onValueChange={setSeverity}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="absolute">absolute</SelectItem>
          <SelectItem value="strong">strong</SelectItem>
          <SelectItem value="soft">soft</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" onClick={submit} disabled={saving || !description.trim()}>
        {saving ? <RefreshCw className="size-3.5 mr-1.5 animate-spin" /> : <Plus className="size-3.5 mr-1.5" />}
        Add Red Line
      </Button>
    </div>
  )
}

// === Tab 5: Audit Ledger =============================================

function AuditLedgerTab() {
  // G4 + G5: filtri + pagination + export
  const [agentId, setAgentId] = useState('')
  const [gate, setGate] = useState('all')
  const [outcome, setOutcome] = useState('all')
  const [sinceHours, setSinceHours] = useState('24')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [limit] = useState(20)
  const [data, setData] = useState<{ entries: AuditEntry[]; total: number; hasMore: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        sinceHours,
      })
      if (agentId) params.set('agentId', agentId)
      if (gate !== 'all') params.set('gate', gate)
      if (outcome !== 'all') params.set('outcome', outcome)
      if (q) params.set('q', q)
      const r = await fetch(`/api/admin/audit/ledger?${params}`)
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(b.error || `HTTP ${r.status}`)
      }
      const json = await r.json()
      setData(json)
    } catch (e: any) {
      setError(e.message)
      toast.error(`Audit fetch failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [agentId, gate, outcome, sinceHours, q, offset, limit])

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, gate, outcome, sinceHours, q, offset])

  // Reset offset when filters change
  useEffect(() => { setOffset(0) }, [agentId, gate, outcome, sinceHours, q])

  const exportJSON = () => {
    if (!data?.entries.length) return
    const blob = new Blob([JSON.stringify(data.entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-ledger-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${data.entries.length} entries to JSON`)
  }

  const exportCSV = () => {
    if (!data?.entries.length) return
    const headers = ['timestamp', 'agentId', 'action', 'gate', 'outcome', 'reversible', 'readableNarrative']
    const rows = data.entries.map(e => {
      const decision = safeJsonParse<{ gate?: string; outcome?: string }>(e.decision, {})
      return [
        e.timestamp,
        e.agentId,
        `"${e.action.replace(/"/g, '""')}"`,
        decision.gate || '',
        decision.outcome || '',
        String(e.reversible),
        `"${e.readableNarrative.replace(/"/g, '""')}"`,
      ].join(',')
    })
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${data.entries.length} entries to CSV`)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="size-4" /> Audit Ledger
              </CardTitle>
              <CardDescription>
                {data ? `${data.total} entries${data.hasMore ? ` (showing ${offset + 1}-${offset + data.entries.length})` : ''}` : 'Loading...'}
              </CardDescription>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={exportJSON} disabled={!data?.entries.length}>
                <Download className="size-3.5 mr-1" /> JSON
              </Button>
              <Button size="sm" variant="outline" onClick={exportCSV} disabled={!data?.entries.length}>
                <Download className="size-3.5 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={fetchEntries}>
                <RefreshCw className="size-3.5 mr-1" /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* G4: filters */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <Input value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="agentId filter" />
            <Select value={gate} onValueChange={setGate}>
              <SelectTrigger><SelectValue placeholder="gate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all gates</SelectItem>
                <SelectItem value="delegation">delegation</SelectItem>
                <SelectItem value="hitl">hitl</SelectItem>
                <SelectItem value="normative">normative</SelectItem>
                <SelectItem value="ltl">ltl</SelectItem>
                <SelectItem value="redline">redline</SelectItem>
                <SelectItem value="sovereign">sovereign</SelectItem>
              </SelectContent>
            </Select>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue placeholder="outcome" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all outcomes</SelectItem>
                <SelectItem value="granted">granted</SelectItem>
                <SelectItem value="revoked">revoked</SelectItem>
                <SelectItem value="approved">approved</SelectItem>
                <SelectItem value="rejected">rejected</SelectItem>
                <SelectItem value="block">block</SelectItem>
                <SelectItem value="modify">modify</SelectItem>
                <SelectItem value="expired">expired</SelectItem>
                <SelectItem value="activated">activated</SelectItem>
                <SelectItem value="deactivated">deactivated</SelectItem>
                <SelectItem value="created">created</SelectItem>
                <SelectItem value="deleted">deleted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sinceHours} onValueChange={setSinceHours}>
              <SelectTrigger><SelectValue placeholder="time range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">last 1h</SelectItem>
                <SelectItem value="24">last 24h</SelectItem>
                <SelectItem value="168">last 7d</SelectItem>
                <SelectItem value="720">last 30d</SelectItem>
                <SelectItem value="8760">last 1y</SelectItem>
              </SelectContent>
            </Select>
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="search action/narrative" />
          </div>

          {error && (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/30 rounded-md p-2">
              {error}
            </div>
          )}

          {/* Entries */}
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}
            </div>
          ) : data && data.entries.length > 0 ? (
            <ScrollArea className="h-[28rem] pr-2">
              <ul className="space-y-2">
                {data.entries.map(e => {
                  const decision = safeJsonParse<{ source?: string; intent?: string; gate?: string; outcome?: string }>(e.decision, {})
                  return (
                    <li key={e.id} className="text-xs border rounded-md p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="font-mono text-[10px]">{e.agentId}</Badge>
                        {decision.gate && <Badge variant="secondary" className="text-[10px]">{decision.gate}</Badge>}
                        {decision.outcome && (
                          <Badge variant={decision.outcome === 'approved' || decision.outcome === 'granted' || decision.outcome === 'activated' || decision.outcome === 'created' ? 'success' : decision.outcome === 'rejected' || decision.outcome === 'revoked' || decision.outcome === 'deleted' || decision.outcome === 'block' ? 'destructive' : 'warning'} className="text-[10px]">
                            {decision.outcome}
                          </Badge>
                        )}
                        {!e.reversible && <Badge variant="secondary" className="text-[10px]">irreversible</Badge>}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(e.timestamp).toLocaleString('it-IT')}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mb-1 font-medium">{e.action}</div>
                      <div className="text-[11px] italic bg-muted/30 rounded p-2">{e.readableNarrative}</div>
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          ) : (
            <EmptyState icon="BookOpen" title="No audit entries" description="Adjust filters or perform governance actions" />
          )}

          {/* Pagination */}
          {data && (offset > 0 || data.hasMore) && (
            <div className="flex items-center justify-between pt-2 border-t">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {Math.floor(offset / limit) + 1} of {Math.ceil(data.total / limit)}
              </span>
              <Button size="sm" variant="outline" disabled={!data.hasMore} onClick={() => setOffset(offset + limit)}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
