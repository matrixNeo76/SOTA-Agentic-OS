'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
 DollarSign, X, Cpu, Layers, Activity, AlertTriangle,
 TrendingUp, Clock, Loader2,
} from 'lucide-react'

// === Types ===
type CostStats = {
 total: number
 today: number
 week: number
 byAgent: Array<{ agentId: string; cost: number; calls: number }>
 byModel: Array<{ model: string; cost: number; calls: number }>
 byPhase: Array<{ phase: string; cost: number; calls: number }>
 totalTokensIn: number
 totalTokensOut: number
 totalCalls: number
 budget: { warn: number; danger: number }
}

type RecentEntry = {
 id: string
 agentId: string
 model: string
 phase: string
 tokensIn: number
 tokensOut: number
 cost: number
 timestamp: string
}

// === Format helpers ===
function formatCost(cost: number): string {
 if (cost === 0) return '$0.00'
 if (cost < 0.01) return `$${cost.toFixed(5)}`
 if (cost < 1) return `$${cost.toFixed(4)}`
 return `$${cost.toFixed(2)}`
}

function formatTokens(n: number): string {
 if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
 if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
 return String(n)
}

function formatTime(ts: string): string {
 return new Date(ts).toLocaleString('it-IT', {
 hour: '2-digit', minute: '2-digit', second: '2-digit',
 day: '2-digit', month: '2-digit',
 })
}

// === Phase labels ===
const PHASE_LABELS: Record<string, string> = {
 plan_generation: 'Plan Generation',
 task_execution: 'Task Execution',
 steering: 'Steering',
 reflection: 'Reflection',
 routing: 'Routing',
 compilation: 'Compilation',
}

// === Main modal ===
export function CostBreakdownModal({ onClose }: { onClose: () => void }) {
 const [stats, setStats] = useState<CostStats | null>(null)
 const [recent, setRecent] = useState<RecentEntry[]>([])
 const [loading, setLoading] = useState(true)
 const [tab, setTab] = useState<'summary' | 'byAgent' | 'byModel' | 'byPhase' | 'recent'>('summary')

 useEffect(() => {
 let cancelled = false
 const load = async () => {
 setLoading(true)
 try {
 const [statsR, recentR] = await Promise.all([
 fetch('/api/cost?action=stats'),
 fetch('/api/cost?action=recent&limit=30'),
 ])
 const [s, r] = await Promise.all([statsR.json(), recentR.json()])
 if (!cancelled) {
 setStats(s)
 setRecent(r.entries || [])
 }
 } catch {
 // silent
 } finally {
 if (!cancelled) setLoading(false)
 }
 }
 load()
 return () => { cancelled = true }
 }, [])

 // Block body scroll
 useEffect(() => {
 const prev = document.body.style.overflow
 document.body.style.overflow = 'hidden'
 return () => { document.body.style.overflow = prev }
 }, [])

 // Esc to close
 useEffect(() => {
 const handler = (e: KeyboardEvent) => {
 if (e.key === 'Escape') onClose()
 }
 window.addEventListener('keydown', handler)
 return () => window.removeEventListener('keydown', handler)
 }, [onClose])

 const budgetUsed = stats ? (stats.today / stats.budget.danger) * 100 : 0
 const budgetTone = budgetUsed >= 100 ? 'danger' : budgetUsed >= 60 ? 'warn' : 'ok'

 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
 {/* Backdrop */}
 <div
 className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-150"
 onClick={onClose}
 aria-hidden
 />

 {/* Modal */}
 <div className="relative w-full max-w-3xl max-h-[85vh] bg-popover border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in-0 zoom-in-95 duration-200">
 {/* Header */}
 <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b">
 <div className="flex items-center gap-2.5">
 <div className="size-7 rounded-md bg-status-ok flex items-center justify-center">
 <DollarSign className="size-4 text-status-ok" />
 </div>
 <div>
 <h2 className="text-sm font-semibold">Cost Breakdown</h2>
 <p className="text-[10px] text-muted-foreground">
 Tracking spesa LLM in tempo reale
 </p>
 </div>
 </div>
 <button
 onClick={onClose}
 className="size-7 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-all active:scale-95"
 aria-label="Chiudi"
 >
 <X className="size-4" />
 </button>
 </div>

 {/* Tabs */}
 <div className="shrink-0 flex items-center border-b bg-muted/30 px-2">
 {([
 { id: 'summary', label: 'Riepilogo' },
 { id: 'byAgent', label: 'Per Agente' },
 { id: 'byModel', label: 'Per Modello' },
 { id: 'byPhase', label: 'Per Fase' },
 { id: 'recent', label: 'Recenti' },
 ] as const).map((t) => (
 <button
 key={t.id}
 onClick={() => setTab(t.id)}
 className={cn(
 'px-3 h-9 text-xs font-medium border-b-2 transition-all active:scale-95',
 tab === t.id
 ? 'border-primary text-foreground'
 : 'border-transparent text-muted-foreground hover:text-foreground'
 )}
 >
 {t.label}
 </button>
 ))}
 </div>

 {/* Body */}
 <div className="flex-1 overflow-y-auto p-5">
 {loading ? (
 <div className="flex items-center justify-center py-12">
 <Loader2 className="size-6 animate-spin text-muted-foreground" />
 </div>
 ) : !stats ? (
 <div className="text-center text-sm text-muted-foreground italic py-12">
 Impossibile caricare i dati.
 </div>
 ) : (
 <>
 {tab === 'summary' && <SummaryTab stats={stats} budgetUsed={budgetUsed} budgetTone={budgetTone} />}
 {tab === 'byAgent' && <BreakdownTab items={stats.byAgent} labelKey="agentId" labelPrefix="" />}
 {tab === 'byModel' && <BreakdownTab items={stats.byModel} labelKey="model" labelPrefix="" />}
 {tab === 'byPhase' && <BreakdownTab items={stats.byPhase} labelKey="phase" labelPrefix="" labelMap={PHASE_LABELS} />}
 {tab === 'recent' && <RecentTab entries={recent} />}
 </>
 )}
 </div>

 {/* Footer */}
 <div className="shrink-0 flex items-center justify-between px-5 py-2.5 border-t bg-muted/30 text-[10px] text-muted-foreground">
 <span>
 {stats ? `${stats.totalCalls} chiamate totali · ${formatTokens(stats.totalTokensIn + stats.totalTokensOut)} tokens` : ''}
 </span>
 <span className="font-mono">Aggiornato {new Date().toLocaleTimeString('it-IT')}</span>
 </div>
 </div>
 </div>
 )
}

// === Summary tab ===
function SummaryTab({ stats, budgetUsed, budgetTone }: { stats: CostStats; budgetUsed: number; budgetTone: string }) {
 return (
 <div className="space-y-5">
 {/* Top stats grid */}
 <div className="grid grid-cols-3 gap-3">
 <StatCard label="Totale" value={formatCost(stats.total)} icon={DollarSign} tone="muted" />
 <StatCard label="Oggi" value={formatCost(stats.today)} icon={Clock} tone="ok" />
 <StatCard label="Settimana" value={formatCost(stats.week)} icon={TrendingUp} tone="muted" />
 </div>

 {/* Budget progress */}
 <div className="rounded-lg border p-4 space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-xs font-medium">Budget giornaliero</span>
 <span className={cn(
 'text-xs font-mono font-semibold',
 budgetTone === 'danger' ? 'text-status-danger'
 : budgetTone === 'warn' ? 'text-status-warn'
 : 'text-status-ok'
 )}>
 {formatCost(stats.today)} / {formatCost(stats.budget.danger)}
 </span>
 </div>
 <div className="h-2 rounded-full bg-muted overflow-hidden">
 <div
 className={cn(
 'h-full transition-all duration-500',
 budgetTone === 'danger' ? 'bg-status-danger'
 : budgetTone === 'warn' ? 'bg-status-warn'
 : 'bg-status-ok'
 )}
 style={{ width: `${Math.min(budgetUsed, 100)}%` }}
 />
 </div>
 <div className="flex items-center justify-between text-[10px] text-muted-foreground">
 <span>Warn: {formatCost(stats.budget.warn)}</span>
 <span>Danger: {formatCost(stats.budget.danger)}</span>
 </div>
 </div>

 {/* Tokens breakdown */}
 <div className="grid grid-cols-2 gap-3">
 <StatCard label="Tokens Input" value={formatTokens(stats.totalTokensIn)} icon={Layers} tone="muted" />
 <StatCard label="Tokens Output" value={formatTokens(stats.totalTokensOut)} icon={Activity} tone="muted" />
 </div>

 {/* Top contributors */}
 <div className="space-y-2">
 <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top contributor</h3>
 {stats.byAgent.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessun dato</p>
 ) : (
 <div className="space-y-1.5">
 {stats.byAgent.slice(0, 3).map((a) => (
 <div key={a.agentId} className="flex items-center gap-3 p-2 rounded-md border bg-card/50">
 <div className="size-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
 <Cpu className="size-3.5 text-primary" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-xs font-medium font-mono truncate">{a.agentId}</div>
 <div className="text-[10px] text-muted-foreground">{a.calls} chiamate</div>
 </div>
 <span className="text-xs font-mono font-semibold tabular-nums">{formatCost(a.cost)}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 )
}

// === Breakdown tab (byAgent / byModel / byPhase) ===
function BreakdownTab({
 items,
 labelKey,
 labelPrefix = '',
 labelMap,
}: {
 items: Array<{ agentId?: string; model?: string; phase?: string; cost: number; calls: number }>
 labelKey: 'agentId' | 'model' | 'phase'
 labelPrefix?: string
 labelMap?: Record<string, string>
}) {
 if (items.length === 0) {
 return <p className="text-center text-xs text-muted-foreground italic py-8">Nessun dato</p>
 }

 const maxCost = Math.max(...items.map((i) => i.cost), 0.0001)

 return (
 <div className="space-y-2">
 {items.map((item) => {
 const rawLabel = (item[labelKey] as string) || 'unknown'
 const label = labelMap?.[rawLabel] || rawLabel
 const pct = (item.cost / maxCost) * 100
 return (
 <div key={rawLabel} className="rounded-md border bg-card/50 p-3 space-y-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium font-mono">{labelPrefix}{label}</span>
 <span className="text-[10px] text-muted-foreground">{item.calls} chiamate</span>
 </div>
 <span className="text-xs font-mono font-semibold tabular-nums">{formatCost(item.cost)}</span>
 </div>
 <div className="h-1.5 rounded-full bg-muted overflow-hidden">
 <div
 className="h-full bg-primary/60 transition-all duration-300"
 style={{ width: `${pct}%` }}
 />
 </div>
 </div>
 )
 })}
 </div>
 )
}

// === Recent tab ===
function RecentTab({ entries }: { entries: RecentEntry[] }) {
 if (entries.length === 0) {
 return <p className="text-center text-xs text-muted-foreground italic py-8">Nessuna voce recente</p>
 }

 return (
 <div className="space-y-1.5">
 {entries.map((e) => (
 <div key={e.id} className="flex items-center gap-3 p-2 rounded-md border bg-card/50 text-xs">
 <div className="flex-1 min-w-0 space-y-0.5">
 <div className="flex items-center gap-2">
 <span className="font-mono font-medium">{e.agentId}</span>
 <span className="text-[10px] text-muted-foreground">{e.model}</span>
 <span className="text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground">
 {PHASE_LABELS[e.phase] || e.phase}
 </span>
 </div>
 <div className="text-[10px] text-muted-foreground font-mono">
 {formatTime(e.timestamp)} · {e.tokensIn} in / {e.tokensOut} out
 </div>
 </div>
 <span className="font-mono font-semibold tabular-nums shrink-0">{formatCost(e.cost)}</span>
 </div>
 ))}
 </div>
 )
}

// === Stat card ===
function StatCard({
 label,
 value,
 icon: Icon,
 tone = 'muted',
}: {
 label: string
 value: string
 icon: typeof DollarSign
 tone: 'ok' | 'warn' | 'danger' | 'muted'
}) {
 const toneClass = {
 ok: 'text-status-ok',
 warn: 'text-status-warn',
 danger: 'text-status-danger',
 muted: 'text-foreground',
 }[tone]

 return (
 <div className="rounded-lg border bg-card/50 p-3 space-y-1">
 <div className="flex items-center gap-1.5">
 <Icon className={cn('size-3', toneClass)} />
 <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
 </div>
 <div className={cn('text-lg font-bold font-mono tabular-nums', toneClass)}>{value}</div>
 </div>
 )
}
