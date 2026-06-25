'use client'
import { cn } from '@/lib/utils'
import { Workflow, Target, FunctionSquare } from 'lucide-react'

export type DagType = 'dynamo' | 'objective' | 'lean'
export const DAG_TYPES: Array<{ id: DagType; label: string; icon: typeof Workflow; description: string }> = [
 { id: 'dynamo', label: 'DynAMO Plan', icon: Workflow, description: 'Grafo dipendenze task' },
 { id: 'objective', label: 'Objective Tree', icon: Target, description: 'Albero BFS goal' },
 { id: 'lean', label: 'Lean Workflow', icon: FunctionSquare, description: 'Workflow Lean4' },
]
export const STATUS_FILTERS = [{ id: 'all', label: 'Tutti' }, { id: 'done', label: 'Done' }, { id: 'running', label: 'Running' }, { id: 'failed', label: 'Failed' }, { id: 'pending', label: 'Pending' }] as const
export type StatusFilterId = typeof STATUS_FILTERS[number]['id']

export function CanvasToolbar({ dagType, setDagType, statusFilter, setStatusFilter, entitySelector }: { dagType: DagType; setDagType: (t: DagType) => void; statusFilter: StatusFilterId; setStatusFilter: (s: StatusFilterId) => void; entitySelector: React.ReactNode }) {
 return (
 <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
 <div className="inline-flex rounded-md border bg-muted/30 p-0.5">{DAG_TYPES.map(t => { const Icon = t.icon; return <button key={t.id} onClick={() => setDagType(t.id)} className={cn('inline-flex items-center gap-1.5 px-2.5 h-7 rounded-sm text-xs font-medium transition-all', dagType === t.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')} title={t.description}><Icon className="size-3.5" /><span className="hidden sm:inline">{t.label}</span></button> })}</div>
 {entitySelector}
 <div className="inline-flex rounded-md border bg-muted/30 p-0.5 ml-auto">{STATUS_FILTERS.map(s => <button key={s.id} onClick={() => setStatusFilter(s.id)} className={cn('inline-flex items-center gap-1 px-2 h-7 rounded-sm text-[11px] font-medium transition-all', statusFilter === s.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>{s.label}</button>)}</div>
 </div>
 )
}

export function safeParseDeps(deps: string | string[]): string[] {
 if (Array.isArray(deps)) return deps
 try { const p = JSON.parse(deps); return Array.isArray(p) ? p : [] } catch { return [] }
}
