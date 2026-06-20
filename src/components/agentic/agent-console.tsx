'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useSensoriumLive } from './use-sensorium-live'
import { DynAMODagVisualizer } from './dag-visualizers'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  ArrowUp, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Sparkles, Brain, Shield, Zap, Clock, Terminal, Compass,
  RefreshCw, ChevronDown, ChevronRight,
} from 'lucide-react'

// =====================================================
// Types
// =====================================================

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

type ExecStep = {
  taskId: string
  agentId: string
  description: string
  status: StepStatus
  strategy?: string
  ltlVerdict?: string
  ltlViolations?: string[]
  result?: string
  error?: ErrorDetail
  durationMs?: number
}

type ErrorDetail = {
  type: string
  message: string
  phase: string
  recoverable: boolean
  suggestion?: string
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  result?: {
    goal: string
    steps: ExecStep[]
    batches: string[][]
    reflection?: {
      approved: boolean
      heuristic?: string
      reviewReason?: string
      error?: string
    }
    summary: {
      totalTasks: number
      completed: number
      failed: number
      blocked: number
      durationMs: number
    }
    errors?: ErrorDetail[]
  }
  isPlanOnly?: boolean
  error?: string
  errors?: ErrorDetail[]
}

// =====================================================
// Suggestions
// =====================================================

const SUGGESTIONS = [
  { icon: Brain, title: 'Analizza e reportizza', desc: 'Analizza le metriche di vendita Q3 e produci un report esecutivo' },
  { icon: Shield, title: 'Verifica conformità', desc: 'Verifica la conformità di sicurezza del modulo di autenticazione' },
  { icon: Zap, title: 'Ottimizza processo', desc: 'Ottimizza il processo di deploy del microservizio auth' },
  { icon: Terminal, title: 'Piano di test', desc: 'Crea un piano di test per la nuova API REST' },
]

// =====================================================
// Main Component
// =====================================================

export function AgentConsole() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [executing, setExecuting] = useState(false)
  const [liveLog, setLiveLog] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { events } = useSensoriumLive()

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, liveLog])

  // Capture WS events during execution
  useEffect(() => {
    if (!executing) return
    const recent = events[0]
    if (!recent) return
    const line = `[P${recent.phase}] ${recent.agentId}: ${recent.event}`
    setLiveLog(prev => [...prev, line])
  }, [events, executing])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const send = async (task: string, planOnly = false) => {
    if (!task.trim() || executing) return
    setExecuting(true)
    setLiveLog([])

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: task,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')

    try {
      const r = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, mode: planOnly ? 'plan-only' : 'full' }),
      })
      const d = await r.json()

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: d.ok
          ? planOnly
            ? `Piano generato: ${d.result.summary.totalTasks} task in ${d.result.batches.length} batch.`
            : d.result.summary.failed > 0 || d.result.summary.blocked > 0
              ? `Task completato con problemi: ${d.result.summary.completed}/${d.result.summary.totalTasks} riusciti, ${d.result.summary.failed + d.result.summary.blocked} falliti.`
              : `Task completato in ${(d.result.summary.durationMs / 1000).toFixed(1)}s — ${d.result.summary.completed}/${d.result.summary.totalTasks} task completati.`
          : `Si è verificato un errore: ${d.error}`,
        timestamp: new Date().toISOString(),
        result: d.ok ? d.result : undefined,
        isPlanOnly: planOnly,
        error: d.ok ? undefined : d.error,
        errors: d.errors || (d.ok ? d.result?.errors : undefined),
      }
      setMessages(prev => [...prev, assistantMsg])

      if (!d.ok) toast.error(d.error)
      else if (!planOnly) toast.success(`${d.result.summary.completed}/${d.result.summary.totalTasks} task completati`)
    } catch (e: any) {
      toast.error(e.message)
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Errore di connessione: ${e.message}`,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setExecuting(false)
      setLiveLog([])
    }
  }

  // =====================================================
  // Render
  // =====================================================

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] md:h-[calc(100dvh-5.5rem)]">
      {/* Conversation thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {messages.length === 0 ? (
          <WelcomeScreen onSuggestion={(s) => send(s)} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {/* Live execution indicator */}
            {executing && (
              <div className="flex items-start gap-3">
                <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Loader2 className="size-4 animate-spin text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">Agente</span>
                    <span className="text-[10px] text-muted-foreground">esecuzione…</span>
                  </div>
                  {liveLog.length > 0 && (
                    <div className="rounded-lg bg-zinc-950 text-zinc-300 p-2.5 font-mono text-[10px] space-y-0.5 max-h-32 overflow-y-auto">
                      {liveLog.map((l, i) => (
                        <div key={i} className="text-zinc-400">{l}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t bg-background/95 backdrop-blur shrink-0">
        <div className="max-w-3xl mx-auto p-2 sm:p-3">
          <div className="relative flex items-end gap-2 rounded-2xl border bg-card px-2.5 sm:px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder="Descrivi il task…"
              rows={1}
              disabled={executing}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 py-1.5 min-w-0"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || executing}
              className={cn(
                'size-8 rounded-lg flex items-center justify-center shrink-0 transition-all',
                input.trim() && !executing
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {executing ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1 px-1">
            <p className="text-[10px] text-muted-foreground hidden sm:block">
              Invio per eseguire · Shift+Invio per nuova riga
            </p>
            <button
              onClick={() => input.trim() && send(input, true)}
              disabled={!input.trim() || executing}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 ml-auto"
            >
              Solo piano
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Welcome Screen
// =====================================================

function WelcomeScreen({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="max-w-2xl w-full text-center space-y-4 sm:space-y-6">
        <img src="/logo-sota.png" alt="SOTA" className="size-10 sm:size-12 mx-auto rounded-lg object-contain" />
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">Console Agentica</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 px-2">
            Invia un task all'agente. Il sistema genera un piano, esegue con steering cognitivo,
            verifica LTL, e impara dall'esperienza.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 sm:mt-8">
          {SUGGESTIONS.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.title}
                onClick={() => onSuggestion(s.desc)}
                className="text-left p-3 rounded-xl border hover:border-primary/30 hover:bg-accent/30 transition-all group"
              >
                <div className="flex items-start gap-2.5">
                  <div className="size-7 sm:size-8 rounded-lg bg-primary/5 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Icon className="size-3.5 sm:size-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-medium">{s.title}</div>
                    <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.desc}</div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Message Bubble
// =====================================================

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3">
      {/* Avatar */}
      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="size-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {/* Text content */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Agente</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className={cn('text-sm', msg.error ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{msg.content}</p>

        {/* Error details */}
        {msg.errors && msg.errors.length > 0 && (
          <ErrorList errors={msg.errors} />
        )}

        {/* Result card */}
        {msg.result && <ResultCard result={msg.result} planOnly={msg.isPlanOnly} />}
      </div>
    </div>
  )
}

// =====================================================
// Error List (mostra errori con dettagli e suggerimenti)
// =====================================================

const ERROR_ICONS: Record<string, any> = {
  plan_generation: Brain,
  steering: Compass,
  ltl_verification: Shield,
  task_execution: Zap,
  reflection: Sparkles,
  unknown: AlertTriangle,
}

function ErrorList({ errors }: { errors: ErrorDetail[] }) {
  return (
    <div className="space-y-2">
      {errors.map((err, i) => {
        const Icon = ERROR_ICONS[err.type] || AlertTriangle
        return (
          <div
            key={i}
            className={cn(
              'rounded-lg border p-3',
              err.recoverable
                ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/10'
                : 'border-red-500/30 bg-red-50 dark:bg-red-950/10'
            )}
          >
            <div className="flex items-start gap-2.5">
              <Icon className={cn(
                'size-4 shrink-0 mt-0.5',
                err.recoverable ? 'text-amber-500' : 'text-red-500'
              )} />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">{err.phase}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] py-0',
                      err.recoverable
                        ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                        : 'border-red-500 text-red-600 dark:text-red-400'
                    )}
                  >
                    {err.recoverable ? 'Ripristinabile' : 'Bloccante'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{err.message}</p>
                {err.suggestion && (
                  <p className="text-[11px] text-foreground/70 italic">
                    → {err.suggestion}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =====================================================
// Result Card
// =====================================================

function ResultCard({ result, planOnly }: { result: NonNullable<Message['result']>; planOnly?: boolean }) {
  const [showGraph, setShowGraph] = useState(false)
  const [showDetails, setShowDetails] = useState(!planOnly)
  const s = result.summary

  const allDone = s.completed === s.totalTasks && s.failed === 0 && s.blocked === 0
  const hasErrors = (result.errors?.length ?? 0) > 0 || s.failed > 0 || s.blocked > 0

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
        <div className={cn(
          'size-7 rounded-full flex items-center justify-center shrink-0',
          allDone ? 'bg-emerald-500/10' : s.blocked > 0 ? 'bg-amber-500/10' : 'bg-red-500/10'
        )}>
          {allDone ? <CheckCircle2 className="size-4 text-emerald-500" />
            : s.blocked > 0 ? <AlertTriangle className="size-4 text-amber-500" />
            : <XCircle className="size-4 text-red-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{result.goal}</div>
          <div className="text-[11px] text-muted-foreground">
            {s.completed}/{s.totalTasks} completati
            {s.failed > 0 && <span className="text-red-500"> · {s.failed} falliti</span>}
            {s.blocked > 0 && <span className="text-amber-500"> · {s.blocked} bloccati</span>}
            {!planOnly && ` · ${(s.durationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          {showDetails ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {showDetails && (
        <div className="p-4 space-y-3">
          {/* Task list */}
          <div className="space-y-1">
            {result.steps.map((step) => (
              <StepRow key={step.taskId} step={step} />
            ))}
          </div>

          {/* Per-step errors (inline, expandable) */}
          {result.steps.filter(s => s.error).map(step => (
            <div key={`err-${step.taskId}`} className="rounded-lg border border-red-500/20 bg-red-50 dark:bg-red-950/10 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="size-3.5 text-red-500 shrink-0" />
                <span className="text-xs font-medium">{step.taskId} — {step.error!.phase}</span>
                <Badge variant="outline" className={cn(
                  'text-[9px] py-0 ml-auto',
                  step.error!.recoverable
                    ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                    : 'border-red-500 text-red-600 dark:text-red-400'
                )}>
                  {step.error!.recoverable ? 'Ripristinabile' : 'Bloccante'}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{step.error!.message}</p>
              {step.error!.suggestion && (
                <p className="text-[11px] text-foreground/70 italic mt-1">→ {step.error!.suggestion}</p>
              )}
            </div>
          ))}

          {/* LTL violations detail */}
          {result.steps.filter(s => s.ltlViolations && s.ltlViolations.length > 0).map(step => (
            <div key={`ltl-${step.taskId}`} className="rounded-lg border border-amber-500/20 bg-amber-50 dark:bg-amber-950/10 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="size-3.5 text-amber-500 shrink-0" />
                <span className="text-xs font-medium">{step.taskId} — Regola LTL violata</span>
              </div>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-5">
                {step.ltlViolations!.map((v, i) => (
                  <li key={i} className="list-disc">{v}</li>
                ))}
              </ul>
            </div>
          ))}

          {/* Graph toggle */}
          {!planOnly && result.steps.length > 0 && (
            <>
              <button
                onClick={() => setShowGraph(!showGraph)}
                className="text-xs text-primary hover:underline"
              >
                {showGraph ? 'Nascondi grafo DAG' : 'Mostra grafo DAG'}
              </button>
              {showGraph && (
                <div className="h-64 border rounded-lg overflow-hidden">
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
            </>
          )}

          {/* Reflection */}
          {result.reflection && (
            <div className="flex items-start gap-2.5 pt-2 border-t">
              <div className={cn(
                'size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                result.reflection.approved ? 'bg-emerald-500/10' : 'bg-amber-500/10'
              )}>
                <Sparkles className={cn('size-3', result.reflection.approved ? 'text-emerald-500' : 'text-amber-500')} />
              </div>
              <div className="flex-1">
                <div className="text-xs font-medium">
                  {result.reflection.error ? 'Riflessione fallita' : result.reflection.approved ? 'Euristica estratta' : 'Red Line attivata'}
                </div>
                {result.reflection.heuristic && (
                  <p className="text-xs text-muted-foreground italic mt-0.5">"{result.reflection.heuristic}"</p>
                )}
                {result.reflection.error && (
                  <p className="text-[11px] text-red-500 mt-0.5">{result.reflection.error}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =====================================================
// Step Row
// =====================================================

const STEP_ICONS = {
  pending: { icon: Clock, color: 'text-muted-foreground' },
  running: { icon: Loader2, color: 'text-sky-500' },
  done: { icon: CheckCircle2, color: 'text-emerald-500' },
  failed: { icon: XCircle, color: 'text-red-500' },
  blocked: { icon: AlertTriangle, color: 'text-amber-500' },
}

const STRAT_ICONS: Record<string, any> = {
  PLAN: Brain, EXECUTE: Zap, CHECK: Shield, REFLECT: Sparkles, HALT: AlertTriangle,
}

function StepRow({ step }: { step: ExecStep }) {
  const config = STEP_ICONS[step.status]
  const Icon = config.icon
  const StratIcon = step.strategy ? STRAT_ICONS[step.strategy] : null
  const [expanded, setExpanded] = useState(false)
  const hasDetails = (step.result && step.status !== 'done') || step.error

  return (
    <div>
      <div
        className={cn('flex items-center gap-2.5 py-1', hasDetails && 'cursor-pointer hover:bg-accent/30 rounded')}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <Icon className={cn('size-3.5 shrink-0', config.color, step.status === 'running' && 'animate-spin')} />
        <span className="text-xs font-mono text-muted-foreground shrink-0 w-6">{step.taskId}</span>
        <span className="text-xs truncate flex-1">{step.description}</span>
        {step.strategy && StratIcon && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <StratIcon className="size-2.5" />
            {step.strategy}
          </span>
        )}
        {step.durationMs != null && (
          <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
            {(step.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {step.ltlVerdict && step.ltlVerdict !== 'accept' && (
          <span className={cn(
            'text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0',
            step.ltlVerdict === 'reject' ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          )}>
            LTL {step.ltlVerdict}
          </span>
        )}
        {hasDetails && (
          <ChevronDown className={cn('size-3 text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')} />
        )}
      </div>

      {/* Expanded details for failed/blocked tasks */}
      {expanded && hasDetails && (
        <div className="ml-6 mt-1 mb-2 p-2.5 rounded-lg bg-muted/30 text-xs space-y-1">
          {step.result && (
            <div>
              <span className="text-muted-foreground font-medium">Risultato: </span>
              <span className={cn(step.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                {step.result}
              </span>
            </div>
          )}
          {step.error && (
            <div className="text-muted-foreground">
              <span className="font-medium">Errore ({step.error.phase}): </span>
              {step.error.message}
            </div>
          )}
          {step.error?.suggestion && (
            <div className="text-foreground/70 italic">→ {step.error.suggestion}</div>
          )}
        </div>
      )}
    </div>
  )
}
