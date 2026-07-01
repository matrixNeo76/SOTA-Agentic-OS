'use client'
import { useEffect, useMemo, useState } from 'react'
import { DynAMODagVisualizer, ObjectiveTreeVisualizer, LeanWorkflowVisualizer } from '@/components/agentic/dag-visualizers'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Workflow, Target, FunctionSquare, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { CanvasViewSkeleton } from '@/components/workbench/skeletons'
import { CanvasToolbar, safeParseDeps, type DagType, type StatusFilterId } from './canvas-toolbar'
import { EntitySelector, CanvasWrapper, CanvasEmptyState, buildDependenciesFromContracts } from './canvas-helpers'

type Plan = { id: string; taskGoal: string; status: string; agentCount: number; tasks: Array<{ taskId: string; agentId: string; description: string; dependencies: string[]; status?: string }> }
type ObjectiveTree = { id: string; rootGoal: string; status: string; maxDepth: number; nodes?: Array<{ id: string; description: string; depth: number; weight: number; contextTier: string; status: string; parentId: string | null }> }
type VerifiedWorkflow = { id: string; planId: string; version: number; verified: boolean; deployed: boolean; contractsJson: string; contracts?: Array<{ taskId: string; verified: boolean; preconditions: string[]; postconditions: string[] }> }

export function CanvasView() {
 const { setSelectedItem } = useStore()
 const [dagType, setDagType] = useState<DagType>('dynamo')
 const [statusFilter, setStatusFilter] = useState<StatusFilterId>('all')
 const [loading, setLoading] = useState(true)
 const [plans, setPlans] = useState<Plan[]>([]); const [selPlanId, setSelPlanId] = useState<string | null>(null)
 const [trees, setTrees] = useState<ObjectiveTree[]>([]); const [selTreeId, setSelTreeId] = useState<string | null>(null)
 const [workflows, setWorkflows] = useState<VerifiedWorkflow[]>([]); const [selWfId, setSelWfId] = useState<string | null>(null)
 const [fullTree, setFullTree] = useState<ObjectiveTree | null>(null)

 useEffect(() => { let c = false; const load = async () => { try { const r = await fetch('/api/plan'); const d = await r.json(); if (c) return; const p = (d.plans || []).map((pl: any) => ({ ...pl, tasks: pl.tasks.map((t: any) => ({ ...t, dependencies: typeof t.dependencies === 'string' ? safeParseDeps(t.dependencies) : t.dependencies || [] })) })); setPlans(p); if (p.length > 0 && !selPlanId) setSelPlanId(p[0].id) } catch { toast.error('Errore piani') } finally { if (!c) setLoading(false) } }; load(); return () => { c = true } }, [])
 useEffect(() => { let c = false; fetch('/api/objective?action=list').then(r => r.json()).then(d => { if (c) return; setTrees(d.trees || []); if (d.trees?.length > 0 && !selTreeId) setSelTreeId(d.trees[0].id) }).catch(() => {}); return () => { c = true } }, [])
 useEffect(() => { let c = false; fetch('/api/lean?action=workflows').then(r => r.json()).then(d => { if (c) return; const p = (d.workflows || []).map((w: any) => { let ct: any[] = []; try { ct = JSON.parse(w.contractsJson || '[]') } catch {} return { ...w, contracts: ct } }); setWorkflows(p); if (p.length > 0 && !selWfId) setSelWfId(p[0].id) }).catch(() => {}); return () => { c = true } }, [])
 useEffect(() => { if (dagType !== 'objective' || !selTreeId) { setFullTree(null); return } let c = false; fetch(`/api/objective?action=tree&treeId=${selTreeId}`).then(r => r.json()).then(d => { if (!c) setFullTree(d) }).catch(() => { if (!c) setFullTree(null) }); return () => { c = true } }, [dagType, selTreeId])

 const fPlan = useMemo(() => { if (!selPlanId) return null; const p = plans.find(x => x.id === selPlanId); if (!p) return null; return statusFilter === 'all' ? p : { ...p, tasks: p.tasks.filter(t => (t.status || 'pending') === statusFilter) } }, [plans, selPlanId, statusFilter])
 const fTree = useMemo(() => { if (!fullTree?.nodes) return null; return statusFilter === 'all' ? fullTree : { ...fullTree, nodes: fullTree.nodes.filter(n => n.status === statusFilter) } }, [fullTree, statusFilter])
 const fWf = useMemo(() => { if (!selWfId) return null; const w = workflows.find(x => x.id === selWfId); if (!w) return null; if (statusFilter === 'all') return w; if (statusFilter === 'done') return { ...w, contracts: (w.contracts || []).filter(c => c.verified) }; if (statusFilter === 'failed') return { ...w, contracts: (w.contracts || []).filter(c => !c.verified) }; return w }, [workflows, selWfId, statusFilter])

 const handleNodeClick = (id: string) => setSelectedItem({ type: 'node', view: 'canvas', id, meta: { dagType, planId: selPlanId, treeId: selTreeId, workflowId: selWfId } })

 return (
 <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
 <div className="flex items-center justify-between gap-4 pb-4"><div className="flex items-center gap-3"><Workflow className="size-5 text-primary" /><div><h1 className="text-lg font-semibold tracking-tight">Canvas</h1><p className="text-xs text-muted-foreground mt-0.5">DAG visualizer — DynAMO · Objective · Lean</p></div></div><button onClick={async () => { setLoading(true); try { toast.success('Aggiornato') } catch {} finally { setLoading(false) } }} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs hover:bg-accent transition-colors">{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Aggiorna</button></div>
 <CanvasToolbar dagType={dagType} setDagType={setDagType} statusFilter={statusFilter} setStatusFilter={setStatusFilter} entitySelector={<EntitySelector dagType={dagType} plans={plans} trees={trees} workflows={workflows} selectedPlanId={selPlanId} selectedTreeId={selTreeId} selectedWorkflowId={selWfId} onSelectPlan={setSelPlanId} onSelectTree={setSelTreeId} onSelectWorkflow={setSelWfId} />} />
 <div className="flex-1 min-h-0 mt-3 overflow-hidden">
 {loading ? <CanvasViewSkeleton /> : dagType === 'dynamo' ? (fPlan && fPlan.tasks.length > 0 ? <CanvasWrapper onNodeClick={handleNodeClick}><DynAMODagVisualizer tasks={fPlan.tasks.map(t => ({ taskId: t.taskId, agentId: t.agentId, description: t.description, dependencies: t.dependencies, status: t.status || 'pending' }))} batches={undefined} /></CanvasWrapper> : <CanvasEmptyState icon={Workflow} title="Nessun piano DynAMO" description={plans.length === 0 ? 'Genera un piano nella Console.' : 'Nessun task per il filtro.'} />) : dagType === 'objective' ? (fTree && fTree.nodes && fTree.nodes.length > 0 ? <CanvasWrapper onNodeClick={handleNodeClick}><ObjectiveTreeVisualizer nodes={fTree.nodes} /></CanvasWrapper> : <CanvasEmptyState icon={Target} title="Nessun albero obiettivo" description={trees.length === 0 ? 'Crea un albero in Objective Builder.' : 'Nessun nodo per il filtro.'} />) : (fWf && (fWf.contracts || []).length > 0 ? <CanvasWrapper onNodeClick={handleNodeClick}><LeanWorkflowVisualizer contracts={(fWf.contracts || []).map(c => ({ taskId: c.taskId, verified: c.verified, preconditions: c.preconditions, postconditions: c.postconditions }))} dependencies={buildDependenciesFromContracts(fWf.contracts || [])} /></CanvasWrapper> : <CanvasEmptyState icon={FunctionSquare} title="Nessun workflow Lean4" description={workflows.length === 0 ? 'Verifica un workflow in Formal Verifier.' : 'Nessun contratto per il filtro.'} />)}
 </div>
 </div>
 )
}
