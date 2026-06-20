'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useStore } from '@/lib/store'
import { useSensoriumLive } from './use-sensorium-live'
import { getIcon } from '@/lib/phase-icons'
import { RelatedPhases, link } from './related-phases'
import { DynAMODagVisualizer } from './dag-visualizers'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Send, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Sparkles, ArrowRight, Clock, Brain, Shield, Zap,
} from 'lucide-react'

type ExecutionStep = {
  taskId: string
  agentId: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked'
  strategy?: string
  ltlVerdict?: string
  result?: string
  startedAt?: string
  completedAt?: string
}

type ConsoleResult = {
  planId: string
  goal: string
  steps: ExecutionStep[]
  batches: string[][]
  reflection?: {
    approved: boolean
    heuristic?: string
    reviewReason?: string
  }
  summary: {
    totalTasks: number
    completed: number
    failed: number
    blocked: number
    durationMs: number
  }
}

type LogEntry = {
  ts: string
  type: 'info' | 'warn' | 'error' | 'success'
  message: string
}

const SUGGESTIONS = [
  'Analizza le metriche di vendita Q3 e produci un report esecutivo',
  'Verifica la conformità di sicurezza del modulo di autenticazione',
  'Ottimizza il processo di deploy del microservizio auth',
  'Crea un piano di test per la nuova API REST',
]

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-muted-foreground', bg: '', label: 'In attesa' },
  running: { icon: Loader2, color: 'text-sky-500', bg: 'bg-sky-50 dark:bg-sky-950/20', label: 'In esecuzione' },
  done: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20', label: 'Completato' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/20', label: 'Fallito' },
  blocked: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', label: 'Bloccato' },
}

const STRATEGY_ICON: Record<string, any> = {
  PLAN: Brain,
  EXECUTE: Zap,
  CHECK: Shield,
  REFLECT: Sparkles,
  HALT: AlertTriangle,
}

export function AgentConsole() {
  const [input, setInput] = useState('')
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showGraph, setShowGraph] = useState(false)
  const { events } = useSensoriumLive()
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  // Capture WS events during execution
  useEffect(() => {
    if (!executing) return
    const recent = events[0]
    if (!recent) return
    const type = recent.level === 'warn' ? 'warn' : recent.level === 'error' ? 'error' : 'info'
    setLogs(prev => [...prev, {
      ts: new Date(recent.ts).toLocaleTimeString('it-IT'),
      type,
      message: `[P${recent.phase}] ${recent.agentId}: ${recent.event}`,
    }])
  }, [events, executing])

  const execute = async () => {
    if (!input.trim()) return
    setExecuting(true)
    setResult(null)
    setLogs([{
      ts: new Date().toLocaleTimeString('it-IT'),
      type: 'info',
      message: `Task inviato: "${input.slice(0, 80)}"`,
    }])

    try {
      const r = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: input, mode: 'full' }),
      })
      const d = await r.json()
      if (d.ok) {
        setResult(d.result)
        setLogs(prev => [...prev, {
          ts: new Date().toLocaleTimeString('it-IT'),
          type: 'success',
          message: `Esecuzione completata in ${(d.result.summary.durationMs / 1000).toFixed(1)}s — ${d.result.summary.completed}/${d.result.summary.totalTasks} task completati`,
        }])
        toast.success(`Task completato: ${d.result.summary.completed}/${d.result.summary.totalTasks}`)
      } else {
        setLogs(prev => [...prev, {
          ts: new Date().toLocaleTimeString('it-IT'),
          type: 'error',
          message: `Errore: ${d.error}`,
        }])
        toast.error(d.error)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setExecuting(false)
    }
  }

  const planOnly = async () => {
    if (!input.trim()) return
    setExecuting(true)
    setResult(null)
    setLogs([{
      ts: new Date().toLocaleTimeString('it-IT'),
      type: 'info',
      message: `Generazione piano per: "${input.slice(0, 80)}"`,
    }])

    try {
      const r = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: input, mode: 'plan-only' }),
      })
      const d = await r.json()
      if (d.ok) {
        setResult(d.result)
        setLogs(prev => [...prev, {
          ts: new Date().toLocaleTimeString('it-IT'),
          type: 'success',
          message: `Piano generato: ${d.result.summary.totalTasks} task in ${d.result.batches.length} batch`,
        }])
        toast.success('Piano generato')
      } else {
        toast.error(d.error)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto p-6">
      {/* Input section */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold mb-1">Console Agentica</h1>
        <p className="text-xs text-muted-foreground mb-4">
          Invia un task all'agente. Il sistema genera un piano (F2), esegue ogni task con steering (F3),
          verifica LTL (F4), e al termine estrae euristiche (F5).
        </p>

        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Descrivi il task da eseguire…"
            rows={3}
            className="resize-none pr-32"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) execute()
            }}
          />
          <div className="absolute bottom-3 right-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={planOnly}
              disabled={executing || !input.trim()}
              className="h-8 text-xs"
            >
              Solo piano
            </Button>
            <Button
              size="sm"
              onClick={execute}
              disabled={executing || !input.trim()}
              className="h-8 text-xs"
            >
              {executing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />}
              Esegui
            </Button>
          </div>
        </div>

        {/* Suggestions */}
        {!result && !executing && (
          <div className="flex flex-wrap gap-2 mt-3">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="text-xs px-3 py-1.5 rounded-lg border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Execution log (real-time) */}
      {executing && (
        <div className="mb-4 rounded-lg border bg-zinc-950 text-zinc-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="size-3.5 animate-spin text-sky-400" />
            <span className="text-xs font-medium text-zinc-400">Esecuzione in corso…</span>
          </div>
          <div ref={logRef} className="h-32 overflow-y-auto space-y-0.5 font-mono text-[11px]">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-zinc-600 shrink-0">{l.ts}</span>
                <span className={cn(
                  l.type === 'error' && 'text-red-400',
                  l.type === 'warn' && 'text-amber-400',
                  l.type === 'success' && 'text-emerald-400',
                  l.type === 'info' && 'text-zinc-300',
                )}>
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Summary bar */}
          <div className="flex items-center gap-4 py-3 border-y">
            <div className="flex items-center gap-2">
              {result.summary.failed > 0 || result.summary.blocked > 0 ? (
                <AlertTriangle className="size-4 text-amber-500" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-500" />
              )}
              <span className="text-sm font-medium">
                {result.summary.completed}/{result.summary.totalTasks} completati
              </span>
            </div>
            {result.summary.failed > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400">
                {result.summary.failed} falliti
              </Badge>
            )}
            {result.summary.blocked > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
                {result.summary.blocked} bloccati
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {(result.summary.durationMs / 1000).toFixed(1)}s
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowGraph(!showGraph)}
              className="h-7 text-xs"
            >
              {showGraph ? 'Nascondi grafo' : 'Mostra grafo'}
            </Button>
          </div>

          {/* DAG visualization */}
          {showGraph && result.steps.length > 0 && (
            <div className="h-72 border rounded-lg overflow-hidden">
              <DynAMODagVisualizer
                tasks={result.steps.map(s => ({
                  taskId: s.taskId,
                  agentId: s.agentId,
                  description: s.description,
                  dependencies: [],
                  status: s.status,
                }))}
                batches={result.batches}
              />
            </div>
          )}

          {/* Task steps */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Task eseguiti</h3>
            {result.steps.map((step, i) => {
              const config = STATUS_CONFIG[step.status]
              const StatusIcon = config.icon
              const StratIcon = step.strategy ? STRATEGY_ICON[step.strategy] : null

              return (
                <div
                  key={step.taskId}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                    config.bg
                  )}
                >
                  <div className="flex items-center gap-2 shrink-0 w-20">
                    <StatusIcon className={cn('size-4', config.color, step.status === 'running' && 'animate-spin')} />
                    <span className="text-xs font-mono font-medium">{step.taskId}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{step.description}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <Badge variant="outline" className="text-[9px] py-0">
                        {step.agentId}
                      </Badge>
                      {step.strategy && (
                        <Badge variant="outline" className="text-[9px] py-0 gap-1">
                          {StratIcon && <StratIcon className="size-2.5" />}
                          {step.strategy}
                        </Badge>
                      )}
                      {step.ltlVerdict && step.ltlVerdict !== 'accept' && (
                        <Badge variant="outline" className={cn(
                          'text-[9px] py-0',
                          step.ltlVerdict === 'reject' && 'border-red-500 text-red-600 dark:text-red-400',
                          step.ltlVerdict === 'warn' && 'border-amber-500 text-amber-600 dark:text-amber-400',
                        )}>
                          LTL: {step.ltlVerdict}
                        </Badge>
                      )}
                      <span className={cn('text-[10px]', config.color)}>
                        {config.label}
                      </span>
                    </div>
                    {step.result && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 font-mono">
                        {step.result}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Reflection */}
          {result.reflection && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className={cn('size-4', result.reflection.approved ? 'text-emerald-500' : 'text-amber-500')} />
                <h3 className="text-sm font-medium">Riflessione ERL</h3>
                <Badge
                  variant="secondary"
                  className={cn(
                    'text-[9px] ml-auto',
                    result.reflection.approved ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  )}
                >
                  {result.reflection.approved ? 'Euristica approvata' : 'Red Line'}
                </Badge>
              </div>
              {result.reflection.heuristic && (
                <p className="text-xs text-muted-foreground italic">
                  "{result.reflection.heuristic}"
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {result.reflection.reviewReason}
              </p>
            </div>
          )}

          {/* Log (post-execution) */}
          {!executing && logs.length > 0 && (
            <div className="rounded-lg border bg-zinc-950 text-zinc-100 p-3">
              <div className="text-xs font-medium text-zinc-400 mb-2">Log di esecuzione</div>
              <div className="h-32 overflow-y-auto space-y-0.5 font-mono text-[11px]">
                {logs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-zinc-600 shrink-0">{l.ts}</span>
                    <span className={cn(
                      l.type === 'error' && 'text-red-400',
                      l.type === 'warn' && 'text-amber-400',
                      l.type === 'success' && 'text-emerald-400',
                      l.type === 'info' && 'text-zinc-300',
                    )}>
                      {l.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New task */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setResult(null); setLogs([]); setInput('') }}
              className="h-8 text-xs"
            >
              Nuovo task
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
