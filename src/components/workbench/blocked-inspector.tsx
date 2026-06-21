'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Wrench, ArrowDownCircle, Ban,
  Clock, Cpu, Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

// === Types (mirror sovereign-view.tsx) ===
type BlockedAction = {
  id: string
  agentId: string
  action: string
  source: string
  axiomTrail: string
  readableExplanation: string
  status: string
  resolution?: string
  resolvedBy?: string
  createdAt: string
  resolvedAt?: string
}

const SOURCE_STYLE: Record<string, { color: string; bg: string; icon: typeof ShieldAlert; label: string }> = {
  ltl: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', icon: ShieldAlert, label: 'LTL Violation' },
  taint: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle, label: 'Taint Tracking' },
  normative: { color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10', icon: ShieldAlert, label: 'Normative Calculus' },
  hitl_gate: { color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-500/10', icon: AlertTriangle, label: 'HITL Gate' },
}

const STATUS_STYLE: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  pending: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle, label: 'In attesa' },
  approved: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle2, label: 'Approvata' },
  rejected: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', icon: XCircle, label: 'Rifiutata' },
  modified: { color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10', icon: Wrench, label: 'Modificata' },
  downgraded: { color: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-500/10', icon: ArrowDownCircle, label: 'Declassata' },
}

// === Main BlockedInspector ===
export function BlockedInspector({ blockedId }: { blockedId: string }) {
  const [action, setAction] = useState<BlockedAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [resolutionNote, setResolutionNote] = useState('')
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const r = await fetch('/api/blocked-actions?action=recent')
        const d = await r.json()
        if (cancelled) return
        const found = (d.items || []).find((a: BlockedAction) => a.id === blockedId)
        if (found) setAction(found)
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [blockedId])

  const resolve = async (choice: 'approved' | 'modified' | 'downgraded' | 'rejected') => {
    if (!action) return
    setResolving(true)
    try {
      const r = await fetch('/api/blocked-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          blockedId: action.id,
          choice,
          resolvedBy: 'admin',
          resolutionDetails: { note: resolutionNote, source: 'context_panel' },
        }),
      })
      const d = await r.json()
      if (d.ok) {
        toast.success(`Azione ${choice}`)
        setResolutionNote('')
        // Reload
        const r2 = await fetch('/api/blocked-actions?action=recent')
        const d2 = await r2.json()
        const updated = (d2.items || []).find((a: BlockedAction) => a.id === blockedId)
        if (updated) setAction(updated)
      } else {
        toast.error(d.error || 'Errore')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setResolving(false)
    }
  }

  const sourceStyle = action ? (SOURCE_STYLE[action.source] || SOURCE_STYLE.ltl) : null
  const statusStyle = action ? (STATUS_STYLE[action.status] || STATUS_STYLE.pending) : null
  const SourceIcon = sourceStyle?.icon || ShieldAlert
  const StatusIcon = statusStyle?.icon || AlertTriangle

  let trail: Array<{ step: string; rule: string; result: string }> = []
  if (action) {
    try {
      trail = JSON.parse(action.axiomTrail)
    } catch {
      // ignore
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Blocked Action</h2>
          {action && (
            <Badge variant="outline" className={cn('ml-auto text-[9px] py-0 font-mono', sourceStyle!.color)}>
              {sourceStyle!.label}
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
          {blockedId}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : !action ? (
          <div className="text-center text-xs text-muted-foreground italic py-8">
            Azione non trovata. Potrebbe essere stata rimossa.
          </div>
        ) : (
          <>
            {/* Action attempted */}
            <div className={cn('rounded-md p-2.5', sourceStyle!.bg)}>
              <div className="flex items-center gap-2 mb-1.5">
                <SourceIcon className={cn('size-4', sourceStyle!.color)} />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Azione tentata
                </span>
              </div>
              <p className="text-sm font-medium break-words">"{action.action}"</p>
            </div>

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Agente" icon={Cpu}>
                <span className="text-xs font-mono">{action.agentId}</span>
              </Field>
              <Field label="Stato" icon={StatusIcon}>
                <Badge variant="outline" className={cn('text-[10px] py-0', statusStyle!.color)}>
                  <StatusIcon className="size-2.5 mr-1" />
                  {statusStyle!.label}
                </Badge>
              </Field>
            </div>

            {/* Timestamps */}
            <Field label="Creata" icon={Clock}>
              <span className="text-xs font-mono">
                {new Date(action.createdAt).toLocaleString('it-IT')}
              </span>
            </Field>

            {action.resolvedAt && (
              <Field label="Risolta" icon={CheckCircle2}>
                <span className="text-xs font-mono">
                  {new Date(action.resolvedAt).toLocaleString('it-IT')}
                </span>
                {action.resolvedBy && (
                  <span className="text-[10px] text-muted-foreground ml-2 font-mono">da {action.resolvedBy}</span>
                )}
              </Field>
            )}

            {/* Readable explanation */}
            <Field label="Spiegazione" icon={AlertTriangle}>
              <pre className="text-[11px] whitespace-pre-wrap bg-muted/50 rounded p-2 max-h-40 overflow-auto font-mono">
{action.readableExplanation}
              </pre>
            </Field>

            {/* Axiom trail */}
            {trail.length > 0 && (
              <Field label="Axiom Trail" icon={ShieldAlert}>
                <div className="space-y-1.5">
                  {trail.map((step, i) => (
                    <div key={i} className="text-[11px] border-l-2 border-primary/40 pl-2 py-0.5">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px] py-0 font-mono">{step.step}</Badge>
                        <span className="font-mono text-[10px] break-all">{step.rule}</span>
                      </div>
                      {step.result && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 break-words">→ {step.result}</div>
                      )}
                    </div>
                  ))}
                </div>
              </Field>
            )}

            {/* Resolution info (if already resolved) */}
            {action.status !== 'pending' && action.resolution && (
              <Field label="Risoluzione" icon={CheckCircle2}>
                <div className="text-[11px] bg-muted/30 rounded-md p-2 font-mono break-words">
                  {action.resolution}
                </div>
              </Field>
            )}

            {/* Resolution form (only for pending) */}
            {action.status === 'pending' && (
              <div className="space-y-2 pt-2 border-t">
                <Field label="Nota (opzionale)" icon={AlertTriangle}>
                  <Textarea
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Es. Approvato dopo verifica manuale"
                    rows={2}
                    className="text-xs"
                    disabled={resolving}
                  />
                </Field>
                <div className="flex flex-wrap gap-1.5">
                  <ResolveBtn choice="approved" onClick={resolve} disabled={resolving} />
                  <ResolveBtn choice="modified" onClick={resolve} disabled={resolving} />
                  <ResolveBtn choice="downgraded" onClick={resolve} disabled={resolving} />
                  <ResolveBtn choice="rejected" onClick={resolve} disabled={resolving} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// === Resolve button ===
function ResolveBtn({
  choice,
  onClick,
  disabled,
}: {
  choice: 'approved' | 'modified' | 'downgraded' | 'rejected'
  onClick: (c: 'approved' | 'modified' | 'downgraded' | 'rejected') => void
  disabled: boolean
}) {
  const styles = {
    approved: { icon: CheckCircle2, label: 'Approva', className: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    modified: { icon: Wrench, label: 'Modifica', className: 'border hover:bg-accent' },
    downgraded: { icon: ArrowDownCircle, label: 'Declassa', className: 'border hover:bg-accent' },
    rejected: { icon: Ban, label: 'Rifiuta', className: 'bg-destructive hover:bg-destructive/90 text-white' },
  }[choice]
  const Icon = styles.icon
  return (
    <button
      onClick={() => onClick(choice)}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-50',
        styles.className
      )}
    >
      <Icon className="size-3" />
      {styles.label}
    </button>
  )
}

// === Field wrapper ===
function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: typeof ShieldAlert
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="size-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="ml-4">{children}</div>
    </div>
  )
}
