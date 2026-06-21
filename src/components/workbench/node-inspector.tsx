'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Activity, Workflow, Target, FunctionSquare,
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  Cpu, GitBranch, ArrowRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { NodeInspectorSkeleton } from './skeletons'

// === Types ===
type DagType = 'dynamo' | 'objective' | 'lean'

type NodeDetails =
  | {
      kind: 'dynamo'
      taskId: string
      agentId: string
      description: string
      dependencies: string[]
      status: string
      planGoal?: string
    }
  | {
      kind: 'objective'
      id: string
      description: string
      depth: number
      weight: number
      contextTier: string
      status: string
      parentId: string | null
      treeGoal?: string
    }
  | {
      kind: 'lean'
      taskId: string
      verified: boolean
      preconditions: string[]
      postconditions: string[]
      workflowId?: string
    }
  | { kind: 'not-found' }

const STATUS_STYLE: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  done: { color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2, label: 'Done' },
  pass: { color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2, label: 'Pass' },
  verified: { color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2, label: 'Verified' },
  running: { color: 'text-sky-600 dark:text-sky-400', icon: Loader2, label: 'Running' },
  failed: { color: 'text-red-600 dark:text-red-400', icon: XCircle, label: 'Failed' },
  reject: { color: 'text-red-600 dark:text-red-400', icon: XCircle, label: 'Rejected' },
  pending: { color: 'text-amber-600 dark:text-amber-400', icon: Clock, label: 'Pending' },
  ready: { color: 'text-amber-600 dark:text-amber-400', icon: AlertTriangle, label: 'Ready' },
  skipped: { color: 'text-muted-foreground', icon: AlertTriangle, label: 'Skipped' },
}

const TIER_COLOR: Record<string, string> = {
  strategic: 'text-sky-600 dark:text-sky-400',
  methodological: 'text-violet-600 dark:text-violet-400',
  implementation: 'text-emerald-600 dark:text-emerald-400',
}

// === Main NodeInspector ===
export function NodeInspector({
  nodeId,
  dagType,
  planId,
  treeId,
  workflowId,
}: {
  nodeId: string
  dagType: DagType
  planId?: string
  treeId?: string
  workflowId?: string
}) {
  const [details, setDetails] = useState<NodeDetails | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        if (dagType === 'dynamo') {
          // Fetch plan and find task
          const r = await fetch('/api/plan')
          const d = await r.json()
          if (cancelled) return
          const plan = (d.plans || []).find((p: { id: string }) => p.id === planId)
          if (plan) {
            const task = plan.tasks.find((t: { taskId: string }) => t.taskId === nodeId)
            if (task) {
              const deps = typeof task.dependencies === 'string'
                ? safeParseDeps(task.dependencies)
                : (task.dependencies || [])
              setDetails({
                kind: 'dynamo',
                taskId: task.taskId,
                agentId: task.agentId,
                description: task.description,
                dependencies: deps,
                status: task.status || 'pending',
                planGoal: plan.taskGoal,
              })
            } else {
              setDetails({ kind: 'not-found' })
            }
          } else {
            setDetails({ kind: 'not-found' })
          }
        } else if (dagType === 'objective' && treeId) {
          const r = await fetch(`/api/objective?action=tree&treeId=${treeId}`)
          const d = await r.json()
          if (cancelled) return
          const node = (d.nodes || []).find((n: { id: string }) => n.id === nodeId)
          if (node) {
            setDetails({
              kind: 'objective',
              id: node.id,
              description: node.description,
              depth: node.depth,
              weight: node.weight,
              contextTier: node.contextTier,
              status: node.status,
              parentId: node.parentId,
              treeGoal: d.rootGoal,
            })
          } else {
            setDetails({ kind: 'not-found' })
          }
        } else if (dagType === 'lean' && workflowId) {
          const r = await fetch('/api/lean?action=workflows')
          const d = await r.json()
          if (cancelled) return
          const wf = (d.workflows || []).find((w: { id: string }) => w.id === workflowId)
          if (wf) {
            let contracts: Array<{ taskId: string; verified: boolean; preconditions: string[]; postconditions: string[] }> = []
            try {
              contracts = JSON.parse(wf.contractsJson || '[]')
            } catch {
              contracts = []
            }
            const c = contracts.find((c) => c.taskId === nodeId)
            if (c) {
              setDetails({
                kind: 'lean',
                taskId: c.taskId,
                verified: c.verified,
                preconditions: c.preconditions,
                postconditions: c.postconditions,
                workflowId: wf.id,
              })
            } else {
              setDetails({ kind: 'not-found' })
            }
          } else {
            setDetails({ kind: 'not-found' })
          }
        } else {
          setDetails({ kind: 'not-found' })
        }
      } catch {
        if (!cancelled) setDetails({ kind: 'not-found' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [nodeId, dagType, planId, treeId, workflowId])

  // === Render ===
  const DagIcon = dagType === 'dynamo' ? Workflow : dagType === 'objective' ? Target : FunctionSquare
  const dagLabel = dagType === 'dynamo' ? 'DynAMO Plan' : dagType === 'objective' ? 'Objective Tree' : 'Lean Workflow'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <DagIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Node Inspector</h2>
          <Badge variant="outline" className="ml-auto text-[9px] py-0 font-mono">
            {dagLabel}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
          {nodeId}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <NodeInspectorSkeleton />
        ) : !details || details.kind === 'not-found' ? (
          <div className="text-center text-xs text-muted-foreground italic py-8">
            Nodo non trovato. Potrebbe essere stato rimosso.
          </div>
        ) : details.kind === 'dynamo' ? (
          <DynAMODetails details={details} />
        ) : details.kind === 'objective' ? (
          <ObjectiveDetails details={details} />
        ) : (
          <LeanDetails details={details} />
        )}
      </div>
    </div>
  )
}

// === DynAMO details ===
function DynAMODetails({ details }: { details: Extract<NodeDetails, { kind: 'dynamo' }> }) {
  const status = STATUS_STYLE[details.status] || STATUS_STYLE.pending
  const StatusIcon = status.icon

  return (
    <>
      {details.planGoal && (
        <Field label="Piano" icon={Workflow}>
          <p className="text-xs break-words">{details.planGoal}</p>
        </Field>
      )}

      <Field label="Status" icon={StatusIcon}>
        <Badge variant="outline" className={cn('text-[10px] py-0', status.color)}>
          <StatusIcon className={cn('size-2.5 mr-1', status.icon === Loader2 && 'animate-spin')} />
          {status.label}
        </Badge>
      </Field>

      <Field label="Agente" icon={Cpu}>
        <span className="text-xs font-mono">{details.agentId}</span>
      </Field>

      <Field label="Descrizione" icon={Workflow}>
        <p className="text-xs break-words">{details.description}</p>
      </Field>

      <Field label="Dipendenze" icon={GitBranch}>
        {details.dependencies.length === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">Nessuna (root task)</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {details.dependencies.map((d) => (
              <Badge key={d} variant="outline" className="text-[10px] py-0 font-mono">
                {d}
              </Badge>
            ))}
          </div>
        )}
      </Field>
    </>
  )
}

// === Objective details ===
function ObjectiveDetails({ details }: { details: Extract<NodeDetails, { kind: 'objective' }> }) {
  const status = STATUS_STYLE[details.status] || STATUS_STYLE.pending
  const StatusIcon = status.icon
  const tierColor = TIER_COLOR[details.contextTier] || 'text-muted-foreground'

  return (
    <>
      {details.treeGoal && (
        <Field label="Albero" icon={Target}>
          <p className="text-xs break-words">{details.treeGoal}</p>
        </Field>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Field label="Depth" icon={Target} compact>
          <span className="text-xs font-mono">L{details.depth}</span>
        </Field>
        <Field label="Weight" icon={Target} compact>
          <span className="text-xs font-mono">{details.weight.toFixed(3)}</span>
        </Field>
        <Field label="Tier" icon={Target} compact>
          <span className={cn('text-[10px] font-medium capitalize', tierColor)}>{details.contextTier}</span>
        </Field>
      </div>

      <Field label="Status" icon={StatusIcon}>
        <Badge variant="outline" className={cn('text-[10px] py-0', status.color)}>
          <StatusIcon className="size-2.5 mr-1" />
          {status.label}
        </Badge>
      </Field>

      <Field label="Descrizione" icon={Target}>
        <p className="text-xs break-words">{details.description}</p>
      </Field>

      {details.parentId && (
        <Field label="Parent" icon={ArrowRight}>
          <span className="text-xs font-mono">{details.parentId}</span>
        </Field>
      )}
    </>
  )
}

// === Lean details ===
function LeanDetails({ details }: { details: Extract<NodeDetails, { kind: 'lean' }> }) {
  return (
    <>
      <Field label="Verification" icon={details.verified ? CheckCircle2 : XCircle}>
        <Badge variant="outline" className={cn('text-[10px] py-0',
          details.verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
        )}>
          {details.verified ? 'Verified' : 'Failed'}
        </Badge>
      </Field>

      {details.workflowId && (
        <Field label="Workflow" icon={FunctionSquare}>
          <span className="text-xs font-mono truncate">{details.workflowId.slice(-12)}</span>
        </Field>
      )}

      <Field label="Pre-conditions" icon={CheckCircle2}>
        {details.preconditions.length === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">Nessuna</span>
        ) : (
          <ul className="space-y-1">
            {details.preconditions.map((p, i) => (
              <li key={i} className="text-[11px] font-mono bg-muted/40 rounded px-1.5 py-1 break-words">
                {p}
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field label="Post-conditions" icon={ArrowRight}>
        {details.postconditions.length === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">Nessuna</span>
        ) : (
          <ul className="space-y-1">
            {details.postconditions.map((p, i) => (
              <li key={i} className="text-[11px] font-mono bg-muted/40 rounded px-1.5 py-1 break-words">
                {p}
              </li>
            ))}
          </ul>
        )}
      </Field>
    </>
  )
}

// === Field wrapper ===
function Field({
  label,
  icon: Icon,
  children,
  compact = false,
}: {
  label: string
  icon: typeof Activity
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn(compact ? '' : 'rounded-md border bg-card/50 p-2')}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="size-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="ml-4">{children}</div>
    </div>
  )
}

// === Helper ===
function safeParseDeps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
