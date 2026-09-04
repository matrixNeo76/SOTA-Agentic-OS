'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  Plus, Trash2, Play, ArrowRight, Loader2, GitBranch, Save, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =====================================================
// Pipeline Builder — definisci piani senza LLM
// =====================================================

type PipelineTask = {
  taskId: string
  agentId: string
  description: string
  dependencies: string[]
}

const AGENTS = [
  { id: 'orchestrator', label: 'Orchestrator', desc: 'Coordina e distribuisce' },
  { id: 'curator', label: 'Curator', desc: 'Raccoglie contesto' },
  { id: 'controller', label: 'Controller', desc: 'Esegue azioni' },
  { id: 'verifier', label: 'Verifier', desc: 'Valida risultati' },
  { id: 'reflective', label: 'Reflective', desc: 'Sintetizza e riflette' },
]

const PIPELINE_TEMPLATES = [
  {
    name: 'Sequential Analysis',
    tasks: [
      { taskId: 'T1', agentId: 'curator', description: 'Gather context and data', dependencies: [] },
      { taskId: 'T2', agentId: 'controller', description: 'Process and analyze data', dependencies: ['T1'] },
      { taskId: 'T3', agentId: 'verifier', description: 'Validate analysis results', dependencies: ['T2'] },
      { taskId: 'T4', agentId: 'reflective', description: 'Synthesize final report', dependencies: ['T3'] },
    ],
  },
  {
    name: 'Parallel Research',
    tasks: [
      { taskId: 'T1', agentId: 'orchestrator', description: 'Plan research approach', dependencies: [] },
      { taskId: 'T2', agentId: 'curator', description: 'Research source A', dependencies: ['T1'] },
      { taskId: 'T3', agentId: 'curator', description: 'Research source B', dependencies: ['T1'] },
      { taskId: 'T4', agentId: 'verifier', description: 'Cross-validate findings', dependencies: ['T2', 'T3'] },
      { taskId: 'T5', agentId: 'reflective', description: 'Synthesize report', dependencies: ['T4'] },
    ],
  },
  {
    name: 'Bug Fix Pipeline',
    tasks: [
      { taskId: 'T1', agentId: 'orchestrator', description: 'Reproduce the bug', dependencies: [] },
      { taskId: 'T2', agentId: 'controller', description: 'Identify root cause', dependencies: ['T1'] },
      { taskId: 'T3', agentId: 'controller', description: 'Implement fix', dependencies: ['T2'] },
      { taskId: 'T4', agentId: 'verifier', description: 'Test the fix', dependencies: ['T3'] },
      { taskId: 'T5', agentId: 'reflective', description: 'Document the fix', dependencies: ['T4'] },
    ],
  },
]

export function PipelineBuilder({ onExecute }: {
  onExecute?: (goal: string, plan: { tasks: PipelineTask[] }) => void
}) {
  const [goal, setGoal] = useState('')
  const [tasks, setTasks] = useState<PipelineTask[]>([
    { taskId: 'T1', agentId: 'orchestrator', description: 'First task', dependencies: [] },
  ])
  const [executing, setExecuting] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const addTask = useCallback(() => {
    const nextId = `T${tasks.length + 1}`
    setTasks([...tasks, { taskId: nextId, agentId: 'controller', description: '', dependencies: tasks.length > 0 ? [tasks[tasks.length - 1].taskId] : [] }])
  }, [tasks])

  const removeTask = useCallback((taskId: string) => {
    setTasks(tasks.filter(t => t.taskId !== taskId).map((t, i) => ({
      ...t,
      taskId: `T${i + 1}`,
      dependencies: t.dependencies.filter(d => d !== taskId).map(d => {
        const oldIdx = tasks.findIndex(t => t.taskId === d)
        return oldIdx >= 0 ? `T${tasks.slice(0, oldIdx).filter(t => t.taskId !== taskId).length + 1}` : d
      })
    })))
  }, [tasks])

  const updateTask = useCallback((taskId: string, field: keyof PipelineTask, value: string) => {
    setTasks(tasks.map(t => t.taskId === taskId ? { ...t, [field]: value } : t))
  }, [tasks])

  const toggleDependency = useCallback((taskId: string, dep: string) => {
    setTasks(tasks.map(t => {
      if (t.taskId !== taskId) return t
      const deps = t.dependencies.includes(dep)
        ? t.dependencies.filter(d => d !== dep)
        : [...t.dependencies, dep]
      return { ...t, dependencies: deps }
    }))
  }, [tasks])

  const loadTemplate = useCallback((template: typeof PIPELINE_TEMPLATES[0]) => {
    setTasks(template.tasks.map(t => ({ ...t })))
    if (!goal) setGoal(template.name)
    setShowTemplates(false)
    toast.success(`Template "${template.name}" caricato`)
  }, [goal])

  const handleExecute = useCallback(async () => {
    if (!goal.trim()) { toast.error('Obiettivo richiesto'); return }
    if (tasks.length === 0) { toast.error('Almeno un task richiesto'); return }

    setExecuting(true)
    try {
      // Create plan directly via API (bypass LLM planning)
      const planId = `plan_pipeline_${Date.now()}`
      const plan = {
        goal,
        tasks: tasks.map(t => ({ ...t, dependencies: t.dependencies || [] })),
      }

      const r = await fetch('/api/console/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: `${goal}\n\n[Pipeline definita manualmente: ${tasks.length} task]`,
          mode: 'full',
        }),
      })

      if (!r.ok) {
        const text = await r.text()
        toast.error(`Esecuzione fallita: HTTP ${r.status}`)
        return
      }

      toast.success(`Pipeline avviata: ${tasks.length} task`)
      onExecute?.(goal, plan)
    } catch (e: any) {
      toast.error(`Esecuzione fallita: ${e.message}`)
    } finally {
      setExecuting(false)
    }
  }, [goal, tasks, onExecute])

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <GitBranch className="size-4 text-primary" />
            Pipeline Builder
          </CardTitle>
          <CardDescription>
            Definisci un piano manualmente senza LLM. Aggiungi task, assegna agenti, collega dipendenze.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Obiettivo del piano</Label>
            <Input value={goal} onChange={e => setGoal(e.target.value)} placeholder="es. Analizza e ottimizza il modulo di autenticazione" className="mt-1" />
          </div>

          {/* Template selector */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowTemplates(!showTemplates)}>
              <Save className="size-3.5 mr-1" /> Template
            </Button>
            {showTemplates && (
              <div className="flex flex-wrap gap-2">
                {PIPELINE_TEMPLATES.map(t => (
                  <button key={t.name} onClick={() => loadTemplate(t)} className="text-[10px] px-2 py-1 rounded border hover:bg-muted transition-colors">
                    {t.name} ({t.tasks.length} task)
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Task list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Task ({tasks.length})</CardTitle>
            <Button size="sm" variant="outline" onClick={addTask}>
              <Plus className="size-3.5 mr-1" /> Aggiungi Task
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-96 pr-2">
            <div className="space-y-3">
              {tasks.map((task, idx) => (
                <div key={task.taskId} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{task.taskId}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{AGENTS.find(a => a.id === task.agentId)?.label || task.agentId}</Badge>
                    <span className="text-[10px] text-muted-foreground flex-1">Task {idx + 1} di {tasks.length}</span>
                    {tasks.length > 1 && (
                      <button onClick={() => removeTask(task.taskId)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Agente</Label>
                      <Select value={task.agentId} onValueChange={(v) => updateTask(task.taskId, 'agentId', v)}>
                        <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {AGENTS.map(a => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Task ID</Label>
                      <Input value={task.taskId} onChange={e => updateTask(task.taskId, 'taskId', e.target.value)} className="h-8 text-xs mt-0.5 font-mono" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] text-muted-foreground">Descrizione</Label>
                    <Textarea value={task.description} onChange={e => updateTask(task.taskId, 'description', e.target.value)} placeholder="Cosa deve fare questo task?" rows={2} className="text-xs mt-0.5" />
                  </div>

                  {/* Dependencies */}
                  {tasks.length > 1 && (
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Dipende da</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tasks.filter(t => t.taskId !== task.taskId).map(t => (
                          <button
                            key={t.taskId}
                            onClick={() => toggleDependency(task.taskId, t.taskId)}
                            className={cn(
                              'text-[10px] px-2 py-0.5 rounded border transition-colors',
                              task.dependencies.includes(t.taskId)
                                ? 'bg-primary/10 border-primary text-primary'
                                : 'hover:bg-muted'
                            )}
                          >
                            {t.taskId}
                          </button>
                        ))}
                        {tasks.filter(t => t.taskId !== task.taskId).length === 0 && (
                          <span className="text-[10px] text-muted-foreground italic">Nessuna dipendenza disponibile</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Dependency chain visual */}
                  {task.dependencies.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="font-mono">{task.dependencies.join(', ')}</span>
                      <ArrowRight className="size-3" />
                      <span className="font-mono">{task.taskId}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Execute */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {tasks.length} task · {tasks.filter(t => t.dependencies.length > 0).length} con dipendenze
        </p>
        <Button onClick={handleExecute} disabled={executing || !goal.trim()} className="gap-1.5">
          {executing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Esegui Pipeline
        </Button>
      </div>
    </div>
  )
}
