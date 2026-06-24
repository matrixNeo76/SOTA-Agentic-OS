'use client'
import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, AlertCircle } from 'lucide-react'
import type { DagType } from './canvas-toolbar'

export function EntitySelector({ dagType, plans, trees, workflows, selectedPlanId, selectedTreeId, selectedWorkflowId, onSelectPlan, onSelectTree, onSelectWorkflow }: any) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  const items = dagType === 'dynamo' ? plans.map((p: any) => ({ id: p.id, label: p.taskGoal })) : dagType === 'objective' ? trees.map((t: any) => ({ id: t.id, label: t.rootGoal })) : workflows.map((w: any) => ({ id: w.id, label: `Workflow v${w.version}` }))
  const selId = dagType === 'dynamo' ? selectedPlanId : dagType === 'objective' ? selectedTreeId : selectedWorkflowId
  const sel = items.find((i: any) => i.id === selId)
  return (
    <div ref={ref} className="relative"><button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border bg-card text-xs hover:bg-muted/50 transition-colors max-w-[200px]"><span className="truncate">{sel ? sel.label : `Seleziona ${dagType === 'dynamo' ? 'piano' : dagType === 'objective' ? 'albero' : 'workflow'}`}</span><ChevronDown className={cn('size-3 text-muted-foreground shrink-0', open && 'rotate-180')} /></button>
      {open && <div className="absolute top-full left-0 mt-1 w-64 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg z-10">{items.length === 0 ? <p className="text-xs text-muted-foreground italic p-2">Nessun elemento</p> : items.map((item: any) => <button key={item.id} onClick={() => { if (dagType === 'dynamo') onSelectPlan(item.id); else if (dagType === 'objective') onSelectTree(item.id); else onSelectWorkflow(item.id); setOpen(false) }} className={cn('w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted transition-colors truncate', item.id === selId && 'bg-primary/10 text-primary font-medium')}>{item.label}</button>)}</div>}</div>
  )
}

export function CanvasWrapper({ children, onNodeClick }: { children: React.ReactNode; onNodeClick: (id: string, meta?: Record<string, unknown>) => void }) {
  const handleClick = (e: React.MouseEvent) => { const t = e.target as HTMLElement; const n = t.closest('[data-nodeid]') as HTMLElement | null; if (n) onNodeClick(n.dataset.nodeid!, { nodeType: n.dataset.nodetype }) }
  return <div onClick={handleClick} className="h-full w-full border rounded-lg overflow-hidden bg-background">{children}</div>
}

export function CanvasEmptyState({ icon: Icon, title, description }: { icon: typeof AlertCircle; title: string; description: string }) {
  return <div className="h-full flex flex-col items-center justify-center border rounded-lg bg-muted/20"><Icon className="size-10 text-muted-foreground/40 mb-3" /><p className="text-sm font-medium text-muted-foreground">{title}</p><p className="text-xs text-muted-foreground/70 mt-1 max-w-sm text-center px-4">{description}</p></div>
}

export function buildDependenciesFromContracts(contracts: Array<{ taskId: string }>): Record<string, string[]> {
  const deps: Record<string, string[]> = {}; const sorted = [...contracts].sort((a, b) => a.taskId.localeCompare(b.taskId)); sorted.forEach((c, i) => { deps[c.taskId] = i > 0 ? [sorted[i - 1].taskId] : [] }); return deps
}
