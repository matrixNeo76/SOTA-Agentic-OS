'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { StreamingText } from '@/components/workbench/streaming-text'
import { InlineActions } from '@/components/workbench/inline-actions'
import { AttachmentPreview } from '@/components/workbench/attachment-preview'
import { Badge } from '@/components/ui/badge'
import { DynAMODagVisualizer } from '@/components/agentic/dag-visualizers'
import { CheckCircle2, XCircle, AlertTriangle, Shield, Sparkles, ChevronDown, ChevronRight, Clock, Loader2, Brain, Zap, Compass } from 'lucide-react'
import type { Message, ExecStep, ErrorDetail, StepStatus } from './types'

const SI: Record<StepStatus, { icon: typeof Clock; color: string }> = {
  pending: { icon: Clock, color: 'text-muted-foreground' }, running: { icon: Loader2, color: 'text-status-info' },
  done: { icon: CheckCircle2, color: 'text-status-ok' }, failed: { icon: XCircle, color: 'text-status-danger' },
  blocked: { icon: AlertTriangle, color: 'text-status-warn' },
}
const STR: Record<string, typeof Brain> = { PLAN: Brain, EXECUTE: Zap, CHECK: Shield, REFLECT: Sparkles, HALT: AlertTriangle }
const EI: Record<string, typeof Brain> = { plan_generation: Brain, steering: Compass, ltl_verification: Shield, task_execution: Zap, reflection: Sparkles, unknown: AlertTriangle }

export function MessageBubble({ msg, allMessages, onRetry, onEdit }: { msg: Message; allMessages: Message[]; onRetry?: () => void; onEdit?: () => void }) {
  if (msg.role === 'user') {
    return (
      <div className="group relative flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5 shadow-sm">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
          <AttachmentPreview text={msg.content} />
        </div>
        <InlineActions content={msg.content} isUser messageId={msg.id} messages={allMessages} onRetry={onRetry} onEdit={onEdit} />
      </div>
    )
  }
  return (
    <div className="group relative flex items-start gap-3">
      <div className="size-8 rounded-full bg-gradient-to-br from-primary to-primary-active flex items-center justify-center ring-2 ring-border shrink-0"><span className="text-xs font-bold text-primary-foreground">S</span></div>
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2"><span className="text-sm font-semibold">SOTA</span><span className="text-[10px] text-muted-foreground">{new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span></div>
        {msg.error ? <p className={cn('text-sm break-words text-status-danger')}>{msg.content}</p> : <StreamingText text={msg.content} className="text-muted-foreground" speed={12} charsPerTick={3} />}
        <AttachmentPreview text={msg.content} />
        {msg.errors && msg.errors.length > 0 && <ErrorList errors={msg.errors} />}
        {msg.result && <ResultCard result={msg.result} planOnly={msg.isPlanOnly} />}
      </div>
      <InlineActions content={msg.content} isUser={false} messageId={msg.id} messages={allMessages} />
    </div>
  )
}

function ErrorList({ errors }: { errors: ErrorDetail[] }) {
  return <div className="space-y-2">{errors.map((err, i) => { const Icon = EI[err.type] || AlertTriangle; return (
    <div key={i} className={cn('rounded-lg border p-3 shadow-sm', err.recoverable ? 'border-status-warn/30 bg-status-warn/5' : 'border-status-danger/30 bg-status-danger/5')}>
      <div className="flex items-start gap-2.5"><Icon className={cn('size-4 shrink-0 mt-0.5', err.recoverable ? 'text-status-warn' : 'text-status-danger')} />
        <div className="flex-1 min-w-0 space-y-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-xs font-medium">{err.phase}</span><Badge variant={err.recoverable ? 'warning' : 'destructive'} className="text-[9px] py-0">{err.recoverable ? 'Ripristinabile' : 'Bloccante'}</Badge></div>
        <p className="text-xs text-muted-foreground break-words">{err.message}</p>{err.suggestion && <p className="text-[11px] text-foreground/70 italic">→ {err.suggestion}</p>}</div></div>
    </div>) })}</div>
}

function ResultCard({ result, planOnly }: { result: NonNullable<Message['result']>; planOnly?: boolean }) {
  const [showGraph, setShowGraph] = useState(false); const [showDetails, setShowDetails] = useState(!planOnly)
  const s = result.summary; const allDone = s.completed === s.totalTasks && s.failed === 0 && s.blocked === 0
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button onClick={() => setShowDetails(!showDetails)} className="w-full flex items-center gap-3 px-4 py-3 border-b bg-muted/30 hover:bg-muted/50 transition-colors">
        <div className={cn('size-8 rounded-full flex items-center justify-center shrink-0', allDone ? 'bg-status-ok/10' : s.blocked > 0 ? 'bg-status-warn/10' : 'bg-status-danger/10')}>
          {allDone ? <CheckCircle2 className="size-4 text-status-ok" /> : s.blocked > 0 ? <AlertTriangle className="size-4 text-status-warn" /> : <XCircle className="size-4 text-status-danger" />}
        </div>
        <div className="flex-1 min-w-0 text-left"><div className="text-sm font-medium truncate">{result.goal}</div>
          <div className="text-[11px] text-muted-foreground">{s.completed}/{s.totalTasks} completati{s.failed > 0 && <span className="text-status-danger"> · {s.failed} falliti</span>}{s.blocked > 0 && <span className="text-status-warn"> · {s.blocked} bloccati</span>}{!planOnly && ` · ${(s.durationMs / 1000).toFixed(1)}s`}</div></div>
        {showDetails ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
      </button>
      {showDetails && (
        <div className="p-4 space-y-3">
          <div className="space-y-1">{result.steps.map(step => <StepRow key={step.taskId} step={step} />)}</div>
          {result.steps.filter(st => st.error).map(step => (
            <div key={`e-${step.taskId}`} className="rounded-md border border-status-danger/20 bg-status-danger/5 p-2.5">
              <div className="flex items-center gap-2 mb-1"><XCircle className="size-3.5 text-status-danger shrink-0" /><span className="text-xs font-medium">{step.taskId} — {step.error!.phase}</span><Badge variant="destructive" className="text-[9px] py-0 ml-auto">{step.error!.recoverable ? 'Ripristinabile' : 'Bloccante'}</Badge></div>
              <p className="text-[11px] text-muted-foreground break-words">{step.error!.message}</p>{step.error!.suggestion && <p className="text-[11px] text-foreground/70 italic mt-1">→ {step.error!.suggestion}</p>}
            </div>))}
          {result.steps.filter(st => st.ltlViolations && st.ltlViolations.length > 0).map(step => (
            <div key={`l-${step.taskId}`} className="rounded-md border border-status-warn/20 bg-status-warn/5 p-2.5">
              <div className="flex items-center gap-2 mb-1"><Shield className="size-3.5 text-status-warn shrink-0" /><span className="text-xs font-medium">{step.taskId} — Regola LTL violata</span></div>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-5">{step.ltlViolations!.map((v, i) => <li key={i} className="list-disc break-words">{v}</li>)}</ul>
            </div>))}
          {!planOnly && result.steps.length > 0 && (<><button onClick={() => setShowGraph(!showGraph)} className="text-xs text-primary hover:underline">{showGraph ? 'Nascondi DAG' : 'Mostra DAG'}</button>{showGraph && <div className="h-48 sm:h-64 border rounded-md overflow-hidden bg-background"><DynAMODagVisualizer tasks={result.steps.map(st => ({ taskId: st.taskId, agentId: st.agentId, description: st.description, dependencies: [], status: st.status }))} batches={result.batches} /></div>}</>)}
          {result.reflection && (<div className="flex items-start gap-2.5 pt-3 border-t"><div className={cn('size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5', result.reflection.approved ? 'bg-status-ok/10' : 'bg-status-warn/10')}><Sparkles className={cn('size-3', result.reflection.approved ? 'text-status-ok' : 'text-status-warn')} /></div><div className="flex-1 min-w-0"><div className="text-xs font-medium">{result.reflection.error ? 'Riflessione fallita' : result.reflection.approved ? 'Euristica estratta' : 'Red Line attivata'}</div>{result.reflection.heuristic && <p className="text-xs text-muted-foreground italic mt-0.5 break-words">"{result.reflection.heuristic}"</p>}{result.reflection.error && <p className="text-[11px] text-status-danger mt-0.5">{result.reflection.error}</p>}</div></div>)}
        </div>
      )}
    </div>
  )
}

function StepRow({ step }: { step: ExecStep }) {
  const cfg = SI[step.status] || SI.pending; const Icon = cfg.icon; const StratIcon = step.strategy ? STR[step.strategy] : null
  const [exp, setExp] = useState(false); const has = (step.result && step.status !== 'done') || !!step.error
  return (<div><div className={cn('flex items-center gap-2 py-1 px-1', has && 'cursor-pointer hover:bg-muted/30 rounded-sm transition-colors')} onClick={() => has && setExp(!exp)}>
    <Icon className={cn('size-3.5 shrink-0', cfg.color, step.status === 'running' && 'animate-spin')} />
    <span className="text-xs font-mono text-muted-foreground shrink-0 w-6">{step.taskId}</span><span className="text-xs truncate flex-1 min-w-0">{step.description}</span>
    {step.strategy && StratIcon && <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"><StratIcon className="size-2.5" />{step.strategy}</span>}
    {step.durationMs != null && <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{(step.durationMs / 1000).toFixed(1)}s</span>}
    {step.ltlVerdict && step.ltlVerdict !== 'accept' && <span className={cn('text-[9px] px-1.5 py-0.5 rounded-xs font-medium shrink-0', step.ltlVerdict === 'reject' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-warn/10 text-status-warn')}>LTL {step.ltlVerdict}</span>}
    {has && <ChevronDown className={cn('size-3 text-muted-foreground shrink-0 transition-transform', exp && 'rotate-180')} />}
  </div>{exp && has && <div className="ml-6 mt-1 mb-2 p-2.5 rounded-md bg-muted/30 text-xs space-y-1 break-words">{step.result && <div><span className="text-muted-foreground font-medium">Risultato: </span><span className={cn(step.status === 'failed' ? 'text-status-danger' : 'text-status-warn')}>{step.result}</span></div>}{step.error && <div className="text-muted-foreground"><span className="font-medium">Errore: </span>{step.error.message}</div>}{step.error?.suggestion && <div className="text-foreground/70 italic">→ {step.error.suggestion}</div>}</div>}</div>)
}
