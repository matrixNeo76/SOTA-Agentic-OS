'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DynAMODagVisualizer,
  ObjectiveTreeVisualizer,
  LeanWorkflowVisualizer,
} from '@/components/agentic/dag-visualizers'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  Workflow, Target, FunctionSquare, RefreshCw, Loader2,
  AlertCircle, ChevronDown, CheckCircle2, XCircle, Clock, Loader,
} from 'lucide-react'
import { toast } from 'sonner'

// === Types ===
type DagType = 'dynamo' | 'objective' | 'lean'

type Plan = {
  id: string
  taskGoal: string
  status: string
  agentCount: number
  tasks: Array<{
    taskId: string
    agentId: string
    description: string
    dependencies: string[]
    status?: string
  }>
}

type ObjectiveTree = {
  id: string
  rootGoal: string
  status: string
  maxDepth: number
  nodes?: Array<{
    id: string
    description: string
    depth: number
    weight: number
    contextTier: string
    status: string
    parentId: string | null
  }>
}

type VerifiedWorkflow = {
  id: string
  planId: string
  version: number
  verified: boolean
  deployed: boolean
  contractsJson: string  // JSON string of FormalContract[]
  // Parsed contracts (client-side):
  contracts?: Array<{
    taskId: string
    verified: boolean
    preconditions: string[]
    postconditions: string[]
  }>
}

const DAG_TYPES: Array<{ id: DagType; label: string; icon: typeof Workflow; description: string }> = [
  { id: 'dynamo', label: 'DynAMO Plan', icon: Workflow, description: 'Grafo dipendenze task multi-agente' },
  { id: 'objective', label: 'Objective Tree', icon: Target, description: 'Albero rubrica BFS goal decomposition' },
  { id: 'lean', label: 'Lean Workflow', icon: FunctionSquare, description: 'Workflow contratti Lean4 verificati' },
]

const STATUS_FILTERS = [
  { id: 'all', label: 'Tutti', color: 'text-muted-foreground' },
  { id: 'done', label: 'Done', color: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'running', label: 'Running', color: 'text-sky-600 dark:text-sky-400' },
  { id: 'failed', label: 'Failed', color: 'text-red-600 dark:text-red-400' },
  { id: 'pending', label: 'Pending', color: 'text-amber-600 dark:text-amber-400' },
] as const

// === Main CanvasView ===
export function CanvasView() {
  const { setSelectedItem } = useStore()
  const [dagType, setDagType] = useState<DagType>('dynamo')
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]['id']>('all')
  const [loading, setLoading] = useState(true)

  // Data state
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [objectiveTrees, setObjectiveTrees] = useState<ObjectiveTree[]>([])
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null)
  const [workflows, setWorkflows] = useState<VerifiedWorkflow[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)

  // === Load plans ===
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/plan')
        const d = await r.json()
        if (cancelled) return
        // PlanTask.dependencies is stored as JSON string in DB — parse it
        const parsed = (d.plans || []).map((p: Plan & { tasks: Array<{ dependencies: string }> }) => ({
          ...p,
          tasks: p.tasks.map((t) => ({
            ...t,
            dependencies: typeof t.dependencies === 'string'
              ? safeParseDeps(t.dependencies)
              : (t.dependencies || []),
          })),
        }))
        setPlans(parsed)
        if (parsed.length > 0 && !selectedPlanId) {
          setSelectedPlanId(parsed[0].id)
        }
      } catch (e) {
        toast.error('Errore caricamento piani')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // === Load objective trees ===
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/objective?action=list')
        const d = await r.json()
        if (cancelled) return
        setObjectiveTrees(d.trees || [])
        if (d.trees?.length > 0 && !selectedTreeId) {
          setSelectedTreeId(d.trees[0].id)
        }
      } catch {
        // silent
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // === Load Lean workflows ===
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/lean?action=workflows')
        const d = await r.json()
        if (cancelled) return
        // Parse contractsJson string into contracts array
        const parsed = (d.workflows || []).map((w: VerifiedWorkflow) => {
          let contracts: VerifiedWorkflow['contracts'] = []
          try {
            contracts = JSON.parse(w.contractsJson || '[]')
          } catch {
            contracts = []
          }
          return { ...w, contracts }
        })
        setWorkflows(parsed)
        if (parsed.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(parsed[0].id)
        }
      } catch {
        // silent
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // === Load full tree data when selected ===
  const [fullTree, setFullTree] = useState<ObjectiveTree | null>(null)
  useEffect(() => {
    if (dagType !== 'objective' || !selectedTreeId) {
      setFullTree(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`/api/objective?action=tree&treeId=${selectedTreeId}`)
        const d = await r.json()
        if (!cancelled) setFullTree(d)
      } catch {
        if (!cancelled) setFullTree(null)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dagType, selectedTreeId])

  // === Refresh handler ===
  const handleRefresh = async () => {
    setLoading(true)
    try {
      if (dagType === 'dynamo') {
        const r = await fetch('/api/plan')
        const d = await r.json()
        const parsed = (d.plans || []).map((p: Plan & { tasks: Array<{ dependencies: string }> }) => ({
          ...p,
          tasks: p.tasks.map((t) => ({
            ...t,
            dependencies: typeof t.dependencies === 'string'
              ? safeParseDeps(t.dependencies)
              : (t.dependencies || []),
          })),
        }))
        setPlans(parsed)
      } else if (dagType === 'objective') {
        const r = await fetch('/api/objective?action=list')
        const d = await r.json()
        setObjectiveTrees(d.trees || [])
        if (selectedTreeId) {
          const tr = await fetch(`/api/objective?action=tree&treeId=${selectedTreeId}`)
          setFullTree(await tr.json())
        }
      } else {
        const r = await fetch('/api/lean?action=workflows')
        const d = await r.json()
        const parsed = (d.workflows || []).map((w: VerifiedWorkflow) => {
          let contracts: VerifiedWorkflow['contracts'] = []
          try {
            contracts = JSON.parse(w.contractsJson || '[]')
          } catch {
            contracts = []
          }
          return { ...w, contracts }
        })
        setWorkflows(parsed)
      }
      toast.success('Canvas aggiornato')
    } catch {
      toast.error('Errore aggiornamento')
    } finally {
      setLoading(false)
    }
  }

  // === Compute filtered data based on status filter ===
  const filteredPlan = useMemo(() => {
    if (!selectedPlanId) return null
    const plan = plans.find((p) => p.id === selectedPlanId)
    if (!plan) return null
    if (statusFilter === 'all') return plan
    return {
      ...plan,
      tasks: plan.tasks.filter((t) => (t.status || 'pending') === statusFilter),
    }
  }, [plans, selectedPlanId, statusFilter])

  const filteredTree = useMemo(() => {
    if (!fullTree?.nodes) return null
    if (statusFilter === 'all') return fullTree
    return {
      ...fullTree,
      nodes: fullTree.nodes.filter((n) => n.status === statusFilter),
    }
  }, [fullTree, statusFilter])

  const filteredWorkflow = useMemo(() => {
    if (!selectedWorkflowId) return null
    const wf = workflows.find((w) => w.id === selectedWorkflowId)
    if (!wf) return null
    if (statusFilter === 'all') return wf
    if (statusFilter === 'done') return { ...wf, contracts: (wf.contracts || []).filter((c) => c.verified) }
    if (statusFilter === 'failed') return { ...wf, contracts: (wf.contracts || []).filter((c) => !c.verified) }
    return wf
  }, [workflows, selectedWorkflowId, statusFilter])

  // === Select node handler → context panel integration (Fase 4) ===
  const handleNodeClick = (nodeId: string, meta?: Record<string, unknown>) => {
    setSelectedItem({ type: 'node', view: 'canvas', id: nodeId, meta })
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="flex items-center gap-3">
          <Workflow className="size-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Canvas</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              DAG visualizer unificato — DynAMO · Objective Tree · Lean Workflow
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs hover:bg-accent transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Aggiorna
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
        {/* DAG type tabs */}
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {DAG_TYPES.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setDagType(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-all',
                  dagType === t.id
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title={t.description}
              >
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            )
          })}
        </div>

        {/* Entity selector dropdown */}
        <EntitySelector
          dagType={dagType}
          plans={plans}
          trees={objectiveTrees}
          workflows={workflows}
          selectedPlanId={selectedPlanId}
          selectedTreeId={selectedTreeId}
          selectedWorkflowId={selectedWorkflowId}
          onSelectPlan={setSelectedPlanId}
          onSelectTree={setSelectedTreeId}
          onSelectWorkflow={setSelectedWorkflowId}
        />

        {/* Status filter (only for dynamo and objective) */}
        {(dagType === 'dynamo' || dagType === 'objective' || dagType === 'lean') && (
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5 ml-auto">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium transition-all',
                  statusFilter === s.id
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {s.id !== 'all' && <span className={cn('size-1.5 rounded-full',
                  s.id === 'done' ? 'bg-emerald-500' :
                  s.id === 'running' ? 'bg-sky-500' :
                  s.id === 'failed' ? 'bg-red-500' : 'bg-amber-500'
                )} />}
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 min-h-0 mt-3 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : dagType === 'dynamo' ? (
          filteredPlan && filteredPlan.tasks.length > 0 ? (
            <CanvasWrapper onNodeClick={handleNodeClick}>
              <DynAMODagVisualizer
                tasks={filteredPlan.tasks.map((t) => ({
                  taskId: t.taskId,
                  agentId: t.agentId,
                  description: t.description,
                  dependencies: t.dependencies,
                  status: t.status || 'pending',
                }))}
                batches={undefined}
              />
            </CanvasWrapper>
          ) : (
            <EmptyState
              icon={Workflow}
              title="Nessun piano DynAMO"
              description={plans.length === 0
                ? 'Genera un piano nella Fase 2 — Planner & Compiler per visualizzarlo qui.'
                : 'Nessun task corrisponde al filtro selezionato.'}
            />
          )
        ) : dagType === 'objective' ? (
          filteredTree && filteredTree.nodes && filteredTree.nodes.length > 0 ? (
            <CanvasWrapper onNodeClick={handleNodeClick}>
              <ObjectiveTreeVisualizer nodes={filteredTree.nodes} />
            </CanvasWrapper>
          ) : (
            <EmptyState
              icon={Target}
              title="Nessun albero obiettivo"
              description={objectiveTrees.length === 0
                ? 'Crea un albero nella Fase 12 — Objective Builder per visualizzarlo qui.'
                : 'Nessun nodo corrisponde al filtro selezionato.'}
            />
          )
        ) : (
          // Lean workflow
          filteredWorkflow && (filteredWorkflow.contracts || []).length > 0 ? (
            <CanvasWrapper onNodeClick={handleNodeClick}>
              <LeanWorkflowVisualizer
                contracts={(filteredWorkflow.contracts || []).map((c) => ({
                  taskId: c.taskId,
                  verified: c.verified,
                  preconditions: c.preconditions,
                  postconditions: c.postconditions,
                }))}
                dependencies={buildDependenciesFromContracts(filteredWorkflow.contracts || [])}
              />
            </CanvasWrapper>
          ) : (
            <EmptyState
              icon={FunctionSquare}
              title="Nessun workflow Lean"
              description={workflows.length === 0
                ? 'Verifica un workflow nella Fase 8 — Formal Verifier per visualizzarlo qui.'
                : 'Nessun contratto corrisponde al filtro selezionato.'}
            />
          )
        )}
      </div>

      {/* Info footer */}
      <div className="shrink-0 border-t pt-2 mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {dagType === 'dynamo' && (plans.length > 0 ? `${plans.length} piani · ${filteredPlan?.tasks.length || 0} task visibili` : 'Nessun piano')}
          {dagType === 'objective' && (objectiveTrees.length > 0 ? `${objectiveTrees.length} alberi · ${filteredTree?.nodes?.length || 0} nodi visibili` : 'Nessun albero')}
          {dagType === 'lean' && (workflows.length > 0 ? `${workflows.length} workflow · ${filteredWorkflow?.contracts?.length || 0} contratti visibili` : 'Nessun workflow')}
        </span>
        <span className="font-mono">Click su un nodo per ispezionarlo nel context panel</span>
      </div>
    </div>
  )
}

// === Canvas wrapper (height fix + node click hook) ===
function CanvasWrapper({
  children,
  onNodeClick,
}: {
  children: React.ReactNode
  onNodeClick: (nodeId: string, meta?: Record<string, unknown>) => void
}) {
  // Note: React Flow nodes don't have native click handlers; we wrap and intercept
  // clicks on .react-flow__node elements to capture nodeId.
  useEffect(() => {
    const handler = (e: Event) => {
      const me = e as MouseEvent
      const target = me.target as HTMLElement
      const node = target.closest('.react-flow__node') as HTMLElement | null
      if (node) {
        const nodeId = node.getAttribute('data-id')
        if (nodeId) onNodeClick(nodeId)
      }
    }
    const container = document.querySelector('.canvas-container')
    container?.addEventListener('click', handler as EventListener)
    return () => container?.removeEventListener('click', handler as EventListener)
  }, [onNodeClick])

  return (
    <div className="canvas-container h-full border rounded-md bg-card overflow-hidden">
      <div className="h-full [&>div]:h-full">{children}</div>
    </div>
  )
}

// === Entity selector dropdown ===
function EntitySelector({
  dagType,
  plans,
  trees,
  workflows,
  selectedPlanId,
  selectedTreeId,
  selectedWorkflowId,
  onSelectPlan,
  onSelectTree,
  onSelectWorkflow,
}: {
  dagType: DagType
  plans: Plan[]
  trees: ObjectiveTree[]
  workflows: VerifiedWorkflow[]
  selectedPlanId: string | null
  selectedTreeId: string | null
  selectedWorkflowId: string | null
  onSelectPlan: (id: string) => void
  onSelectTree: (id: string) => void
  onSelectWorkflow: (id: string) => void
}) {
  const [open, setOpen] = useState(false)

  const items = dagType === 'dynamo' ? plans
    : dagType === 'objective' ? trees
    : workflows

  const selectedId = dagType === 'dynamo' ? selectedPlanId
    : dagType === 'objective' ? selectedTreeId
    : selectedWorkflowId

  const selected = items.find((i) => i.id === selectedId)
  const label = selected
    ? dagType === 'dynamo'
      ? (selected as Plan).taskGoal.slice(0, 40)
      : dagType === 'objective'
        ? (selected as ObjectiveTree).rootGoal.slice(0, 40)
        : `Workflow v${(selected as VerifiedWorkflow).version} · ${(selected as VerifiedWorkflow).planId.slice(-8)}`
    : 'Seleziona...'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs hover:bg-accent transition-colors max-w-[280px]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-80 max-h-72 overflow-y-auto bg-popover border rounded-md shadow-lg z-20 p-1">
            {items.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground italic text-center">
                Nessun elemento disponibile
              </div>
            ) : (
              items.map((item) => {
                const isSelected = item.id === selectedId
                const itemLabel = dagType === 'dynamo'
                  ? (item as Plan).taskGoal
                  : dagType === 'objective'
                    ? (item as ObjectiveTree).rootGoal
                    : `Workflow v${(item as VerifiedWorkflow).version} · ${(item as VerifiedWorkflow).planId.slice(-8)}`
                const itemMeta = dagType === 'dynamo'
                  ? `${(item as Plan).tasks.length} task · ${(item as Plan).status}`
                  : dagType === 'objective'
                    ? `L${(item as ObjectiveTree).maxDepth} · ${(item as ObjectiveTree).status}`
                    : `${(item as VerifiedWorkflow).contracts?.length || 0} contratti · ${(item as VerifiedWorkflow).verified ? 'verificato' : 'fallito'}`
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (dagType === 'dynamo') onSelectPlan(item.id)
                      else if (dagType === 'objective') onSelectTree(item.id)
                      else onSelectWorkflow(item.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors',
                      isSelected && 'bg-primary/10'
                    )}
                  >
                    <div className="font-medium truncate">{itemLabel}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{itemMeta}</div>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

// === Empty state ===
function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Workflow
  title: string
  description: string
}) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center max-w-md space-y-3">
        <div className="size-12 mx-auto rounded-xl bg-muted flex items-center justify-center">
          <Icon className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

// === Helper: build dependencies from contracts (Lean) ===
// Lean workflow doesn't expose deps directly; we approximate by ordering contracts alphabetically.
// In a real implementation, the API should return deps explicitly.
function buildDependenciesFromContracts(
  contracts: Array<{ taskId: string }>
): Record<string, string[]> {
  const deps: Record<string, string[]> = {}
  const sorted = [...contracts].sort((a, b) => a.taskId.localeCompare(b.taskId))
  sorted.forEach((c, i) => {
    deps[c.taskId] = i > 0 ? [sorted[i - 1].taskId] : []
  })
  return deps
}

// === Helper: safely parse JSON dependencies string ===
function safeParseDeps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
