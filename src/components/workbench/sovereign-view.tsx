'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import {
 ShieldAlert, RefreshCw, Loader2, CheckCircle2, XCircle, Wrench,
 ArrowDownCircle, Ban, AlertTriangle, ChevronDown, Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { SovereignViewSkeleton } from './skeletons'

// === Types (mirror sovereign-modal.tsx) ===
type BlockedAction = {
 id: string
 agentId: string
 action: string
 source: string
 axiomTrail: string
 readableExplanation: string
 status: string // pending | approved | rejected | modified | downgraded
 resolution?: string
 resolvedBy?: string
 createdAt: string
 resolvedAt?: string
}

const SOURCE_STYLE: Record<string, { color: string; bg: string; icon: typeof ShieldAlert; label: string }> = {
 ltl: { color: 'text-status-danger', bg: 'bg-status-danger border-status-danger', icon: ShieldAlert, label: 'LTL Violation' },
 taint: { color: 'text-status-warn', bg: 'bg-status-warn border-status-warn', icon: AlertTriangle, label: 'Taint Tracking' },
 normative: { color: 'text-cat-cognitive', bg: 'bg-cat-cognitive border-cat-cognitive', icon: ShieldAlert, label: 'Normative Calculus' },
 hitl_gate: { color: 'text-cat-governance', bg: 'bg-cat-governance border-cat-governance', icon: AlertTriangle, label: 'HITL Gate' },
}

const STATUS_STYLE: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
 pending: { color: 'text-status-warn', bg: 'bg-status-warn', icon: AlertTriangle, label: 'In attesa' },
 approved: { color: 'text-status-ok', bg: 'bg-status-ok', icon: CheckCircle2, label: 'Approvata' },
 rejected: { color: 'text-status-danger', bg: 'bg-status-danger', icon: XCircle, label: 'Rifiutata' },
 modified: { color: 'text-status-info', bg: 'bg-status-info', icon: Wrench, label: 'Modificata' },
 downgraded: { color: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-500/10', icon: ArrowDownCircle, label: 'Declassata' },
}

type FilterKey = 'all' | 'pending' | 'resolved'
type SourceFilter = 'all' | 'ltl' | 'taint' | 'normative' | 'hitl_gate'

// === Main SovereignView ===
export function SovereignView() {
 const { setSelectedItem } = useStore()
 const [actions, setActions] = useState<BlockedAction[]>([])
 const [loading, setLoading] = useState(true)
 const [statusFilter, setStatusFilter] = useState<FilterKey>('all')
 const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
 const [selectedId, setSelectedId] = useState<string | null>(null)
 const [resolutionNote, setResolutionNote] = useState('')
 const [resolving, setResolving] = useState(false)
 const [expandedId, setExpandedId] = useState<string | null>(null)

 // === Load all blocked actions (pending + recent) ===
 const load = async () => {
 setLoading(true)
 try {
 const [pendingR, recentR] = await Promise.all([
 fetch('/api/blocked-actions?action=pending'),
 fetch('/api/blocked-actions?action=recent'),
 ])
 const [pending, recent] = await Promise.all([pendingR.json(), recentR.json()])
 // Merge, dedupe by id, sort by createdAt desc
 const map = new Map<string, BlockedAction>()
 ;(recent.items || []).forEach((a: BlockedAction) => map.set(a.id, a))
 ;(pending.items || []).forEach((a: BlockedAction) => map.set(a.id, a)) // pending overrides recent for same id
 const merged = Array.from(map.values()).sort(
 (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
 )
 setActions(merged)
 } catch {
 toast.error('Errore caricamento azioni bloccate')
 } finally {
 setLoading(false)
 }
 }

 useEffect(() => {
 load()
 }, [])

 // Auto-refresh pending every 10s (less aggressive than modal's 5s)
 useEffect(() => {
 const t = setInterval(load, 10000)
 return () => clearInterval(t)
 }, [])

 // === Apply filters ===
 const filtered = useMemo(() => {
 return actions.filter((a) => {
 if (statusFilter === 'pending' && a.status !== 'pending') return false
 if (statusFilter === 'resolved' && a.status === 'pending') return false
 if (sourceFilter !== 'all' && a.source !== sourceFilter) return false
 return true
 })
 }, [actions, statusFilter, sourceFilter])

 // === Stats ===
 const stats = useMemo(() => {
 return {
 total: actions.length,
 pending: actions.filter((a) => a.status === 'pending').length,
 approved: actions.filter((a) => a.status === 'approved').length,
 rejected: actions.filter((a) => a.status === 'rejected').length,
 modified: actions.filter((a) => a.status === 'modified').length,
 downgraded: actions.filter((a) => a.status === 'downgraded').length,
 }
 }, [actions])

 // === Resolve single action ===
 const resolve = async (id: string, choice: 'approved' | 'modified' | 'downgraded' | 'rejected') => {
 setResolving(true)
 try {
 const r = await fetch('/api/blocked-actions', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'resolve',
 blockedId: id,
 choice,
 resolvedBy: 'admin',
 resolutionDetails: { note: resolutionNote },
 }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Azione ${choice}`)
 setResolutionNote('')
 setSelectedId(null)
 await load()
 } else {
 toast.error(d.error || 'Errore risoluzione')
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setResolving(false)
 }
 }

 // === Batch resolve: approve all pending (with confirmation) ===
 const [batchConfirm, setBatchConfirm] = useState(false)
 const [batchRunning, setBatchRunning] = useState(false)

 const batchApproveAll = async () => {
 setBatchRunning(true)
 let success = 0
 let failed = 0
 const pending = filtered.filter((a) => a.status === 'pending')
 for (const a of pending) {
 try {
 const r = await fetch('/api/blocked-actions', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'resolve',
 blockedId: a.id,
 choice: 'approved',
 resolvedBy: 'admin',
 resolutionDetails: { note: 'Batch approve from Sovereign View', batch: true },
 }),
 })
 const d = await r.json()
 if (d.ok) success++
 else failed++
 } catch {
 failed++
 }
 }
 setBatchRunning(false)
 setBatchConfirm(false)
 toast.success(`${success} approvate${failed > 0 ? `, ${failed} fallite` : ''}`)
 await load()
 }

 return (
 <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
 {/* Header */}
 <div className="flex items-center justify-between gap-4 pb-4">
 <div className="flex items-center gap-3">
 <ShieldAlert className="size-5 text-primary" />
 <div>
 <h1 className="text-lg font-semibold tracking-tight">Sovereign</h1>
 <p className="text-xs text-muted-foreground mt-0.5">
 Supervisione batch delle azioni bloccate dai cancelli di sicurezza
 </p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {stats.pending > 0 && (
 <button
 onClick={() => setBatchConfirm(true)}
 disabled={batchRunning}
 className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-status-ok hover:bg-status-ok/90 text-white text-xs font-medium transition-colors disabled:opacity-50"
 >
 {batchRunning ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
 Approva tutte ({stats.pending})
 </button>
 )}
 <button
 onClick={load}
 disabled={loading}
 className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs hover:bg-accent transition-colors disabled:opacity-50"
 >
 {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
 Aggiorna
 </button>
 </div>
 </div>

 {/* Stats row */}
 <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pb-3 border-b">
 <StatTile label="Totale" value={stats.total} tone="muted" />
 <StatTile label="Pending" value={stats.pending} tone={stats.pending > 0 ? 'warn' : 'muted'} />
 <StatTile label="Approvate" value={stats.approved} tone="ok" />
 <StatTile label="Rifiutate" value={stats.rejected} tone="danger" />
 <StatTile label="Modificate" value={stats.modified} tone="info" />
 <StatTile label="Declassate" value={stats.downgraded} tone="muted" />
 </div>

 {/* Filters */}
 <div className="flex flex-wrap items-center gap-2 py-3 border-b">
 <Filter className="size-3.5 text-muted-foreground" />
 {/* Status filter */}
 <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
 {([
 { id: 'all', label: 'Tutte' },
 { id: 'pending', label: 'Pending' },
 { id: 'resolved', label: 'Risolte' },
 ] as const).map((s) => (
 <button
 key={s.id}
 onClick={() => setStatusFilter(s.id)}
 className={cn(
 'inline-flex items-center px-2 h-7 rounded text-[11px] font-medium transition-all',
 statusFilter === s.id
 ? 'bg-background shadow-sm text-foreground'
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 {s.label}
 </button>
 ))}
 </div>
 {/* Source filter */}
 <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
 {([
 { id: 'all', label: 'Tutte le sorgenti' },
 { id: 'ltl', label: 'LTL' },
 { id: 'taint', label: 'Taint' },
 { id: 'normative', label: 'Normative' },
 { id: 'hitl_gate', label: 'HITL' },
 ] as const).map((s) => (
 <button
 key={s.id}
 onClick={() => setSourceFilter(s.id)}
 className={cn(
 'inline-flex items-center px-2 h-7 rounded text-[11px] font-medium transition-all',
 sourceFilter === s.id
 ? 'bg-background shadow-sm text-foreground'
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 {s.label}
 </button>
 ))}
 </div>
 <span className="ml-auto text-[10px] text-muted-foreground font-mono">
 {filtered.length} di {actions.length} azioni
 </span>
 </div>

 {/* List */}
 <div className="flex-1 min-h-0 mt-3 overflow-y-auto space-y-2 pr-1">
 {loading ? (
 <SovereignViewSkeleton />
 ) : filtered.length === 0 ? (
 <div className="flex items-center justify-center py-12">
 <div className="text-center max-w-md space-y-3">
 <div className="size-12 mx-auto rounded-xl bg-status-ok flex items-center justify-center">
 <CheckCircle2 className="size-6 text-status-ok" />
 </div>
 <h3 className="text-sm font-semibold">Nessuna azione bloccata</h3>
 <p className="text-xs text-muted-foreground">
 {actions.length === 0
 ? 'Il sistema è in salute. Le azioni bloccate appariranno qui.'
 : 'Nessuna azione corrisponde ai filtri selezionati.'}
 </p>
 </div>
 </div>
 ) : (
 filtered.map((a) => (
 <BlockedActionCard
 key={a.id}
 action={a}
 expanded={expandedId === a.id}
 onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
 isResolving={selectedId === a.id && resolving}
 isSelected={selectedId === a.id}
 onSelect={() => {
 setSelectedId(a.id)
 setSelectedItem({ type: 'blocked', view: 'sovereign', id: a.id, meta: { source: a.source, agentId: a.agentId } })
 }}
 resolutionNote={selectedId === a.id ? resolutionNote : ''}
 onNoteChange={setResolutionNote}
 onResolve={(choice) => resolve(a.id, choice)}
 canResolve={a.status === 'pending'}
 />
 ))
 )}
 </div>

 {/* Batch confirm modal */}
 {batchConfirm && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
 <div
 className="absolute inset-0 bg-black/40 backdrop-blur-sm"
 onClick={() => !batchRunning && setBatchConfirm(false)}
 />
 <div className="relative w-full max-w-md bg-popover border rounded-xl shadow-2xl p-6 space-y-3">
 <div className="flex items-center gap-2">
 <AlertTriangle className="size-5 text-status-warn" />
 <h2 className="text-sm font-semibold">Conferma batch approve</h2>
 </div>
 <p className="text-xs text-muted-foreground">
 Stai per approvare <strong>{stats.pending} azioni bloccate</strong> in blocco, assumendoti la responsabilità come Sovereign Validator.
 Questa azione non è reversibile.
 </p>
 <div className="bg-status-warn border border-status-warn rounded-md p-2 text-[11px] text-status-warn">
 ⚠️ Assicurati di aver revisionato ogni azione prima di procedere.
 </div>
 <div className="flex gap-2 pt-2">
 <button
 onClick={() => setBatchConfirm(false)}
 disabled={batchRunning}
 className="flex-1 h-8 rounded-md border text-xs hover:bg-accent transition-colors disabled:opacity-50"
 >
 Annulla
 </button>
 <button
 onClick={batchApproveAll}
 disabled={batchRunning}
 className="flex-1 h-8 rounded-md bg-status-ok hover:bg-status-ok/90 text-white text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
 >
 {batchRunning ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
 Approva tutte
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}

// === Stat tile ===
function StatTile({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'ok' | 'warn' | 'danger' | 'info' }) {
 const toneClasses = {
 muted: 'text-foreground',
 ok: 'text-status-ok',
 warn: 'text-status-warn',
 danger: 'text-status-danger',
 info: 'text-status-info',
 }[tone]

 return (
 <div className="bg-muted/30 rounded-md p-2 text-center">
 <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
 <div className={cn('text-base font-bold font-mono tabular-nums', toneClasses)}>{value}</div>
 </div>
 )
}

// === Blocked action card ===
function BlockedActionCard({
 action,
 expanded,
 onToggle,
 isResolving,
 isSelected,
 onSelect,
 resolutionNote,
 onNoteChange,
 onResolve,
 canResolve,
}: {
 action: BlockedAction
 expanded: boolean
 onToggle: () => void
 isResolving: boolean
 isSelected: boolean
 onSelect: () => void
 resolutionNote: string
 onNoteChange: (v: string) => void
 onResolve: (choice: 'approved' | 'modified' | 'downgraded' | 'rejected') => void
 canResolve: boolean
}) {
 const sourceStyle = SOURCE_STYLE[action.source] || SOURCE_STYLE.ltl
 const statusStyle = STATUS_STYLE[action.status] || STATUS_STYLE.pending
 const SourceIcon = sourceStyle.icon
 const StatusIcon = statusStyle.icon

 let trail: Array<{ step: string; rule: string; result: string }> = []
 try {
 trail = JSON.parse(action.axiomTrail)
 } catch {
 // ignore
 }

 return (
 <div
 className={cn(
 'rounded-lg border overflow-hidden transition-all',
 sourceStyle.bg,
 isSelected && 'ring-2 ring-primary/30'
 )}
 >
 {/* Card header (clickable to expand) */}
 <button
 onClick={() => {
 onToggle()
 onSelect()
 }}
 className="w-full flex items-start gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
 >
 <div className={cn('size-7 rounded-md flex items-center justify-center shrink-0', sourceStyle.bg)}>
 <SourceIcon className={cn('size-4', sourceStyle.color)} />
 </div>
 <div className="flex-1 min-w-0 space-y-1">
 <div className="flex items-center gap-2 flex-wrap">
 <Badge variant="outline" className={cn('font-mono text-[9px] py-0', sourceStyle.color)}>
 {sourceStyle.label}
 </Badge>
 <Badge variant="outline" className="text-[9px] font-mono py-0">
 {action.agentId}
 </Badge>
 <Badge variant="secondary" className={cn('text-[9px] py-0', statusStyle.bg, statusStyle.color)}>
 <StatusIcon className="size-2.5 mr-0.5" />
 {statusStyle.label}
 </Badge>
 <span className="text-[10px] text-muted-foreground ml-auto font-mono shrink-0">
 {new Date(action.createdAt).toLocaleString('it-IT')}
 </span>
 </div>
 <div className="text-xs font-medium truncate">
 "{action.action}"
 </div>
 {!expanded && (
 <div className="text-[10px] text-muted-foreground line-clamp-1">
 {action.readableExplanation}
 </div>
 )}
 </div>
 <ChevronDown className={cn('size-3.5 text-muted-foreground shrink-0 transition-transform mt-1', expanded && 'rotate-180')} />
 </button>

 {/* Expanded content */}
 {expanded && (
 <div className="px-3 pb-3 space-y-3 border-t">
 {/* Readable explanation */}
 <div className="pt-2">
 <div className="text-[10px] text-muted-foreground uppercase mb-1">Spiegazione</div>
 <pre className="text-[11px] whitespace-pre-wrap bg-muted/50 rounded-md p-2 max-h-32 overflow-auto font-mono">
{action.readableExplanation}
 </pre>
 </div>

 {/* Axiom trail */}
 {trail.length > 0 && (
 <div>
 <div className="text-[10px] text-muted-foreground uppercase mb-1">Axiom Trail</div>
 <div className="space-y-1">
 {trail.map((step, i) => (
 <div key={i} className="text-[11px] border-l-2 border-primary/40 pl-2 py-0.5">
 <div className="flex items-center gap-1.5">
 <Badge variant="outline" className="text-[9px] py-0 font-mono">{step.step}</Badge>
 <span className="font-mono text-[10px]">{step.rule}</span>
 </div>
 {step.result && (
 <div className="text-[10px] text-muted-foreground mt-0.5">→ {step.result}</div>
 )}
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Resolution info (if already resolved) */}
 {action.status !== 'pending' && action.resolution && (
 <div>
 <div className="text-[10px] text-muted-foreground uppercase mb-1">Risoluzione</div>
 <div className="text-[11px] bg-muted/30 rounded-md p-2 font-mono break-words">
 {action.resolution}
 </div>
 {action.resolvedBy && (
 <div className="text-[10px] text-muted-foreground mt-1">
 da <span className="font-mono">{action.resolvedBy}</span>
 {action.resolvedAt && ` · ${new Date(action.resolvedAt).toLocaleString('it-IT')}`}
 </div>
 )}
 </div>
 )}

 {/* Resolution form (only for pending) */}
 {canResolve && (
 <div className="space-y-2 pt-2 border-t">
 <div>
 <div className="text-[10px] text-muted-foreground uppercase mb-1">Nota (opzionale)</div>
 <Textarea
 value={resolutionNote}
 onChange={(e) => onNoteChange(e.target.value)}
 placeholder="Es. Approvato dopo verifica manuale"
 rows={2}
 className="text-xs"
 disabled={isResolving}
 />
 </div>
 <div className="flex flex-wrap gap-1.5">
 <button
 onClick={() => onResolve('approved')}
 disabled={isResolving}
 className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-status-ok hover:bg-status-ok/90 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
 >
 <CheckCircle2 className="size-3" />
 Approva
 </button>
 <button
 onClick={() => onResolve('modified')}
 disabled={isResolving}
 className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-medium hover:bg-accent transition-colors disabled:opacity-50"
 >
 <Wrench className="size-3" />
 Modifica
 </button>
 <button
 onClick={() => onResolve('downgraded')}
 disabled={isResolving}
 className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-medium hover:bg-accent transition-colors disabled:opacity-50"
 >
 <ArrowDownCircle className="size-3" />
 Declassa
 </button>
 <button
 onClick={() => onResolve('rejected')}
 disabled={isResolving}
 className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-destructive hover:bg-destructive/90 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
 >
 <Ban className="size-3" />
 Rifiuta
 </button>
 </div>
 </div>
 )}
 </div>
 )}
 </div>
 )
}
