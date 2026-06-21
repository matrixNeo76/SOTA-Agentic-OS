'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useSensoriumLive } from './use-sensorium-live'
import { DynAMODagVisualizer } from './dag-visualizers'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { StreamingText } from '@/components/workbench/streaming-text'
import { InlineActions } from '@/components/workbench/inline-actions'
import { AttachmentPreview } from '@/components/workbench/attachment-preview'
import {
  ArrowUp, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Sparkles, Brain, Shield, Zap, Clock, Terminal, Compass,
  ChevronDown, ChevronRight,
} from 'lucide-react'

// Types
type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

type ErrorDetail = {
  type: string
  message: string
  phase: string
  recoverable: boolean
  suggestion?: string
}

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

const SUGGESTIONS = [
  { icon: Brain, title: 'Analizza e reportizza', desc: 'Analizza le metriche di vendita Q3 e produci un report esecutivo' },
  { icon: Shield, title: 'Verifica conformità', desc: 'Verifica la conformità di sicurezza del modulo di autenticazione' },
  { icon: Zap, title: 'Ottimizza processo', desc: 'Ottimizza il processo di deploy del microservizio auth' },
  { icon: Terminal, title: 'Piano di test', desc: 'Crea un piano di test per la nuova API REST' },
]

let idCounter = 0
function genId() {
  idCounter++
  return `msg-${Date.now()}-${idCounter}`
}

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

const ERROR_ICONS: Record<string, any> = {
  plan_generation: Brain, steering: Compass, ltl_verification: Shield,
  task_execution: Zap, reflection: Sparkles, unknown: AlertTriangle,
}

export function AgentConsole() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [executing, setExecuting] = useState(false)
  const [liveLog, setLiveLog] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const executingRef = useRef(false) // ref to prevent stale closure
  const { events } = useSensoriumLive()

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, liveLog, executing])

  // Capture WS events during execution
  useEffect(() => {
    if (!executing) return
    const recent = events[0]
    if (!recent) return
    const line = `[P${recent.phase}] ${recent.agentId}: ${recent.event}`
    setLiveLog(prev => prev.length < 50 ? [...prev, line] : prev)
  }, [events, executing])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const send = async (taskText: string, planOnly = false) => {
    const trimmed = taskText.trim()
    if (!trimmed || executingRef.current) return

    executingRef.current = true
    setExecuting(true)
    setLiveLog([])

    const userMsg: Message = {
      id: genId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    try {
      const r = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: trimmed, mode: planOnly ? 'plan-only' : 'full' }),
      })

      if (!r.ok) {
        const text = await r.text()
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`)
      }

      const d = await r.json()

      const assistantMsg: Message = {
        id: genId(),
        role: 'assistant',
        content: d.ok
          ? planOnly
            ? `Piano generato: ${d.result.summary.totalTasks} task in ${d.result.batches.length} batch.`
            : d.result.summary.failed > 0 || d.result.summary.blocked > 0
              ? `Task completato con problemi: ${d.result.summary.completed}/${d.result.summary.totalTasks} riusciti, ${d.result.summary.failed + d.result.summary.blocked} falliti.`
              : `Task completato in ${(d.result.summary.durationMs / 1000).toFixed(1)}s — ${d.result.summary.completed}/${d.result.summary.totalTasks} task completati.`
          : `Si è verificato un errore: ${d.error || 'Errore sconosciuto'}`,
        timestamp: new Date().toISOString(),
        result: d.ok ? d.result : undefined,
        isPlanOnly: planOnly,
        error: d.ok ? undefined : d.error,
        errors: d.errors || (d.ok ? d.result?.errors : undefined),
      }
      setMessages(prev => [...prev, assistantMsg])

      if (!d.ok) toast.error(d.error || 'Errore')
      else if (!planOnly) toast.success(`${d.result.summary.completed}/${d.result.summary.totalTasks} task completati`)
    } catch (e: any) {
      const errorMsg = e.message || 'Errore sconosciuto'
      toast.error(errorMsg)
      setMessages(prev => [...prev, {
        id: genId(),
        role: 'assistant',
        content: `Errore di connessione: ${errorMsg}`,
        timestamp: new Date().toISOString(),
        error: errorMsg,
        errors: [{ type: 'unknown', message: errorMsg, phase: 'network', recoverable: true, suggestion: 'Riprova tra qualche secondo.' }],
      }])
    } finally {
      executingRef.current = false
      setExecuting(false)
      setLiveLog([])
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Conversation thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain min-h-0">
        {messages.length === 0 ? (
          <WelcomeScreen onSuggestion={(s) => send(s)} />
        ) : (
          <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-12 space-y-6 sm:space-y-8">
            {messages.map((msg, idx) => {
              // Find the next user message after this one (for retry)
              const handleRetry = msg.role === 'user'
                ? () => {
                    if (executingRef.current) return
                    // Truncate everything after this user message, then re-send
                    setMessages(prev => prev.slice(0, idx))
                    void send(msg.content)
                  }
                : undefined

              const handleEdit = msg.role === 'user'
                ? () => {
                    if (executingRef.current) return
                    // Load content into input and truncate history after this message
                    setInput(msg.content)
                    setMessages(prev => prev.slice(0, idx))
                    // Focus the input
                    setTimeout(() => {
                      inputRef.current?.focus()
                      // Place cursor at end
                      const len = msg.content.length
                      inputRef.current?.setSelectionRange(len, len)
                    }, 0)
                  }
                : undefined

              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onRetry={handleRetry}
                  onEdit={handleEdit}
                />
              )
            })}

            {/* Live execution indicator */}
            {executing && (
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <img src="/avatar.png" alt="" className="size-8 rounded-full object-cover border border-border" />
                  <div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-primary border-2 border-background flex items-center justify-center">
                    <Loader2 className="size-2 animate-spin text-primary-foreground" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">Agente</span>
                    <span className="text-[10px] text-muted-foreground">esecuzione in corso…</span>
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
          <div className="flex items-end gap-2 rounded-2xl border bg-card px-2.5 sm:px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
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
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 py-1.5 min-w-0"
            />
            <button
              onClick={() => send(input)}
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
              onClick={() => send(input, true)}
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

function WelcomeScreen({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="max-w-2xl w-full text-center space-y-4 sm:space-y-6">
        <img src="/logo-transparent.png" alt="SOTA" className="size-10 sm:size-12 mx-auto rounded-lg object-contain" />
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

function MessageBubble({
  msg,
  onRetry,
  onEdit,
}: {
  msg: Message
  onRetry?: () => void
  onEdit?: () => void
}) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <div className="group relative flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
          <AttachmentPreview text={msg.content} />
        </div>
        <InlineActions
          content={msg.content}
          isUser
          onRetry={onRetry}
          onEdit={onEdit}
        />
      </div>
    )
  }
  return (
    <div className="group relative flex items-start gap-3">
      <img src="/avatar.png" alt="" className="size-8 rounded-full object-cover shrink-0 border border-border" />
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Agente</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {msg.error ? (
          <p className={cn('text-sm break-words text-red-600 dark:text-red-400')}>{msg.content}</p>
        ) : (
          <StreamingText
            text={msg.content}
            className="text-muted-foreground"
            speed={12}
            charsPerTick={3}
          />
        )}
        <AttachmentPreview text={msg.content} />
        {msg.errors && msg.errors.length > 0 && <ErrorList errors={msg.errors} />}
        {msg.result && <ResultCard result={msg.result} planOnly={msg.isPlanOnly} />}
      </div>
      <InlineActions
        content={msg.content}
        isUser={false}
      />
    </div>
  )
}

function ErrorList({ errors }: { errors: ErrorDetail[] }) {
  return (
    <div className="space-y-2">
      {errors.map((err, i) => {
        const Icon = ERROR_ICONS[err.type] || AlertTriangle
        return (
          <div key={i} className={cn('rounded-lg border p-3', err.recoverable ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/10' : 'border-red-500/30 bg-red-50 dark:bg-red-950/10')}>
            <div className="flex items-start gap-2.5">
              <Icon className={cn('size-4 shrink-0 mt-0.5', err.recoverable ? 'text-amber-500' : 'text-red-500')} />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">{err.phase}</span>
                  <Badge variant="outline" className={cn('text-[9px] py-0', err.recoverable ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-red-500 text-red-600 dark:text-red-400')}>
                    {err.recoverable ? 'Ripristinabile' : 'Bloccante'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground break-words">{err.message}</p>
                {err.suggestion && <p className="text-[11px] text-foreground/70 italic">→ {err.suggestion}</p>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ResultCard({ result, planOnly }: { result: NonNullable<Message['result']>; planOnly?: boolean }) {
  const [showGraph, setShowGraph] = useState(false)
  const [showDetails, setShowDetails] = useState(!planOnly)
  const s = result.summary
  const allDone = s.completed === s.totalTasks && s.failed === 0 && s.blocked === 0

  return (
    <div className="rounded-xl border overflow-hidden">
      <button onClick={() => setShowDetails(!showDetails)} className="w-full flex items-center gap-3 px-4 py-3 border-b bg-muted/30 hover:bg-muted/50 transition-colors">
        <div className={cn('size-7 rounded-full flex items-center justify-center shrink-0', allDone ? 'bg-emerald-500/10' : s.blocked > 0 ? 'bg-amber-500/10' : 'bg-red-500/10')}>
          {allDone ? <CheckCircle2 className="size-4 text-emerald-500" /> : s.blocked > 0 ? <AlertTriangle className="size-4 text-amber-500" /> : <XCircle className="size-4 text-red-500" />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium truncate">{result.goal}</div>
          <div className="text-[11px] text-muted-foreground">
            {s.completed}/{s.totalTasks} completati
            {s.failed > 0 && <span className="text-red-500"> · {s.failed} falliti</span>}
            {s.blocked > 0 && <span className="text-amber-500"> · {s.blocked} bloccati</span>}
            {!planOnly && ` · ${(s.durationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
        {showDetails ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
      </button>
      {showDetails && (
        <div className="p-3 sm:p-4 space-y-3">
          <div className="space-y-1">
            {result.steps.map((step) => <StepRow key={step.taskId} step={step} />)}
          </div>
          {result.steps.filter(st => st.error).map(step => (
            <div key={`err-${step.taskId}`} className="rounded-lg border border-red-500/20 bg-red-50 dark:bg-red-950/10 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="size-3.5 text-red-500 shrink-0" />
                <span className="text-xs font-medium">{step.taskId} — {step.error!.phase}</span>
                <Badge variant="outline" className={cn('text-[9px] py-0 ml-auto', step.error!.recoverable ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-red-500 text-red-600 dark:text-red-400')}>
                  {step.error!.recoverable ? 'Ripristinabile' : 'Bloccante'}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground break-words">{step.error!.message}</p>
              {step.error!.suggestion && <p className="text-[11px] text-foreground/70 italic mt-1">→ {step.error!.suggestion}</p>}
            </div>
          ))}
          {result.steps.filter(st => st.ltlViolations && st.ltlViolations.length > 0).map(step => (
            <div key={`ltl-${step.taskId}`} className="rounded-lg border border-amber-500/20 bg-amber-50 dark:bg-amber-950/10 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="size-3.5 text-amber-500 shrink-0" />
                <span className="text-xs font-medium">{step.taskId} — Regola LTL violata</span>
              </div>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-5">
                {step.ltlViolations!.map((v, i) => <li key={i} className="list-disc break-words">{v}</li>)}
              </ul>
            </div>
          ))}
          {!planOnly && result.steps.length > 0 && (
            <>
              <button onClick={() => setShowGraph(!showGraph)} className="text-xs text-primary hover:underline">{showGraph ? 'Nascondi grafo DAG' : 'Mostra grafo DAG'}</button>
              {showGraph && (
                <div className="h-48 sm:h-64 border rounded-lg overflow-hidden">
                  <DynAMODagVisualizer tasks={result.steps.map(st => ({ taskId: st.taskId, agentId: st.agentId, description: st.description, dependencies: [], status: st.status }))} batches={result.batches} />
                </div>
              )}
            </>
          )}
          {result.reflection && (
            <div className="flex items-start gap-2.5 pt-2 border-t">
              <div className={cn('size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5', result.reflection.approved ? 'bg-emerald-500/10' : 'bg-amber-500/10')}>
                <Sparkles className={cn('size-3', result.reflection.approved ? 'text-emerald-500' : 'text-amber-500')} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{result.reflection.error ? 'Riflessione fallita' : result.reflection.approved ? 'Euristica estratta' : 'Red Line attivata'}</div>
                {result.reflection.heuristic && <p className="text-xs text-muted-foreground italic mt-0.5 break-words">"{result.reflection.heuristic}"</p>}
                {result.reflection.error && <p className="text-[11px] text-red-500 mt-0.5 break-words">{result.reflection.error}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepRow({ step }: { step: ExecStep }) {
  const config = STEP_ICONS[step.status] || STEP_ICONS.pending
  const Icon = config.icon
  const StratIcon = step.strategy ? STRAT_ICONS[step.strategy] : null
  const [expanded, setExpanded] = useState(false)
  const hasDetails = (step.result && step.status !== 'done') || !!step.error

  return (
    <div>
      <div className={cn('flex items-center gap-2 py-1', hasDetails && 'cursor-pointer hover:bg-accent/30 rounded')} onClick={() => hasDetails && setExpanded(!expanded)}>
        <Icon className={cn('size-3.5 shrink-0', config.color, step.status === 'running' && 'animate-spin')} />
        <span className="text-xs font-mono text-muted-foreground shrink-0 w-6">{step.taskId}</span>
        <span className="text-xs truncate flex-1 min-w-0">{step.description}</span>
        {step.strategy && StratIcon && <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"><StratIcon className="size-2.5" />{step.strategy}</span>}
        {step.durationMs != null && <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{(step.durationMs / 1000).toFixed(1)}s</span>}
        {step.ltlVerdict && step.ltlVerdict !== 'accept' && <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0', step.ltlVerdict === 'reject' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400')}>LTL {step.ltlVerdict}</span>}
        {hasDetails && <ChevronDown className={cn('size-3 text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')} />}
      </div>
      {expanded && hasDetails && (
        <div className="ml-6 mt-1 mb-2 p-2.5 rounded-lg bg-muted/30 text-xs space-y-1 break-words">
          {step.result && <div><span className="text-muted-foreground font-medium">Risultato: </span><span className={cn(step.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>{step.result}</span></div>}
          {step.error && <div className="text-muted-foreground"><span className="font-medium">Errore ({step.error.phase}): </span>{step.error.message}</div>}
          {step.error?.suggestion && <div className="text-foreground/70 italic">→ {step.error.suggestion}</div>}
        </div>
      )}
    </div>
  )
}
