'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Clock, Cpu, Activity, AlertTriangle, Info, Zap,
  Brain, Shield, Sparkles, CheckCircle2, XCircle, Loader2, Hash,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

// === Types ===
type LogEntry = {
  id: string
  agentId: string
  phase: string
  event: string
  payload: string | null
  level: string  // info | warn | error
  timestamp: string
}

const LEVEL_STYLE: Record<string, { color: string; bg: string; icon: typeof Info }> = {
  info: { color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10', icon: Info },
  warn: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle },
  error: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', icon: XCircle },
}

const CATEGORY_STYLE: Record<string, { color: string; icon: typeof Info }> = {
  plan: { color: '#8b5cf6', icon: Brain },
  execute: { color: '#10b981', icon: Zap },
  verify: { color: '#ef4444', icon: Shield },
  block: { color: '#f59e0b', icon: AlertTriangle },
  resolve: { color: '#10b981', icon: CheckCircle2 },
  reflect: { color: '#ec4899', icon: Sparkles },
  info: { color: '#0ea5e9', icon: Info },
}

function categorizeEvent(event: string): { category: string; color: string; icon: typeof Info } {
  const e = event.toLowerCase()
  if (e.includes('plan') || e.includes('generate')) return { category: 'plan', ...CATEGORY_STYLE.plan }
  if (e.includes('exec') || e.includes('task_')) return { category: 'execute', ...CATEGORY_STYLE.execute }
  if (e.includes('verif') || e.includes('ltl') || e.includes('check')) return { category: 'verify', ...CATEGORY_STYLE.verify }
  if (e.includes('block') || e.includes('reject')) return { category: 'block', ...CATEGORY_STYLE.block }
  if (e.includes('resolv') || e.includes('approv')) return { category: 'resolve', ...CATEGORY_STYLE.resolve }
  if (e.includes('reflect') || e.includes('heuristic')) return { category: 'reflect', ...CATEGORY_STYLE.reflect }
  return { category: 'info', ...CATEGORY_STYLE.info }
}

// === Main LogInspector ===
export function LogInspector({ logId, defaultLog }: { logId: string; defaultLog?: LogEntry }) {
  const [log, setLog] = useState<LogEntry | null>(defaultLog || null)
  const [loading, setLoading] = useState(!defaultLog)

  useEffect(() => {
    if (defaultLog) {
      setLog(defaultLog)
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        // Fetch all logs and find the one with matching id
        const r = await fetch('/api/cockpit?tab=log')
        const d = await r.json()
        if (cancelled) return
        const found = (d.logs || []).find((l: LogEntry) => l.id === logId)
        if (found) setLog(found)
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [logId, defaultLog])

  const cat = log ? categorizeEvent(log.event) : null
  const levelStyle = log ? (LEVEL_STYLE[log.level] || LEVEL_STYLE.info) : null
  const CatIcon = cat?.icon || Info
  const LevelIcon = levelStyle?.icon || Info

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Log Inspector</h2>
          <Badge variant="outline" className="ml-auto text-[9px] py-0 font-mono">
            {cat?.category || 'event'}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
          {logId}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : !log ? (
          <div className="text-center text-xs text-muted-foreground italic py-8">
            Log non trovato. Potrebbe essere stato rimosso o essere troppo vecchio.
          </div>
        ) : (
          <>
            {/* Event name + category icon */}
            <div className={cn('rounded-md p-2.5', levelStyle?.bg)}>
              <div className="flex items-center gap-2 mb-1">
                <div className="size-7 rounded-md flex items-center justify-center"
                  style={{ backgroundColor: cat!.color + '20' }}>
                  <CatIcon className="size-3.5" style={{ color: cat!.color }} />
                </div>
                <span className="text-sm font-medium break-words">{log.event}</span>
              </div>
              <Badge variant="outline" className={cn('text-[10px] py-0', levelStyle!.color)}>
                <LevelIcon className="size-2.5 mr-1" />
                {log.level.toUpperCase()}
              </Badge>
            </div>

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Agente" icon={Cpu}>
                <span className="text-xs font-mono">{log.agentId}</span>
              </Field>
              <Field label="Fase" icon={Hash}>
                <span className="text-xs font-mono">P{log.phase}</span>
              </Field>
              <Field label="Categoria" icon={Activity}>
                <span className="text-xs capitalize">{cat!.category}</span>
              </Field>
              <Field label="Livello" icon={LevelIcon}>
                <span className={cn('text-xs capitalize', levelStyle!.color)}>{log.level}</span>
              </Field>
            </div>

            {/* Timestamp */}
            <Field label="Timestamp" icon={Clock}>
              <div className="text-xs font-mono">
                {new Date(log.timestamp).toLocaleString('it-IT')}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                epoch: {new Date(log.timestamp).getTime()}
              </div>
            </Field>

            {/* Payload */}
            {log.payload && (
              <Field label="Payload" icon={Activity}>
                <pre className="text-[10px] font-mono bg-zinc-950 text-zinc-300 p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap break-words">
                  {formatPayload(log.payload)}
                </pre>
              </Field>
            )}

            {/* Hint */}
            <div className="text-[10px] text-muted-foreground text-center italic pt-2">
              Questo evento è stato registrato nel log di sistema.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// === Helper: try to pretty-print JSON payloads ===
function formatPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return payload
  }
}

// === Field wrapper ===
function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: typeof Activity
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="size-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="ml-4">{children}</div>
    </div>
  )
}
