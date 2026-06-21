'use client'

import { useMemo } from 'react'
import {
  Activity, Layers, Cpu, Gauge, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

// === Status pill (single metric) ===
type Tone = 'ok' | 'warn' | 'danger' | 'muted'

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
  muted: 'text-muted-foreground',
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
  muted: 'bg-muted-foreground/40',
}

function StatusPill({
  icon: Icon,
  label,
  value,
  tone = 'muted',
  title,
  onClick,
}: {
  icon: typeof Activity
  label: string
  value: string | number
  tone?: Tone
  title?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title || `${label}: ${value}`}
      className={cn(
        'group flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-mono transition-colors',
        onClick ? 'hover:bg-accent/60 cursor-pointer' : 'cursor-default'
      )}
    >
      <span className={cn('size-1.5 rounded-full shrink-0', TONE_DOT[tone])} />
      <Icon className={cn('size-3 shrink-0', TONE_CLASSES[tone])} />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold tabular-nums', TONE_CLASSES[tone])}>{value}</span>
    </button>
  )
}

// === Main StatusBar ===
export function StatusBar() {
  const { sensorium, connected } = useSensoriumLive()
  const { setActiveView, setCommandPaletteOpen } = useStore()

  // Derive metrics from Sensorium snapshot
  const metrics = useMemo(() => {
    const cycleId = sensorium?.cycleId ?? 0
    const queueDepth = sensorium?.queueDepth ?? 0
    const activeThreads = sensorium?.activeThreads ?? 0
    const systemLoad = sensorium?.systemLoad ?? 0

    return {
      cycleId,
      queueDepth,
      activeThreads,
      systemLoad: Math.round(systemLoad * 100),
    }
  }, [sensorium])

  // Tone computation
  const loadTone: Tone =
    metrics.systemLoad >= 90 ? 'danger'
    : metrics.systemLoad >= 70 ? 'warn'
    : 'ok'

  const queueTone: Tone =
    metrics.queueDepth >= 10 ? 'danger'
    : metrics.queueDepth >= 5 ? 'warn'
    : 'ok'

  const connTone: Tone = connected ? 'ok' : 'danger'
  const connLabel = connected ? 'Online' : 'Offline'
  const ConnIcon = connected ? CheckCircle2 : XCircle

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
      {/* Connection status — first thing, sets the tone */}
      <StatusPill
        icon={ConnIcon}
        label=""
        value={connLabel}
        tone={connTone}
        title={connected ? 'WebSocket Sensorium connesso' : 'WebSocket disconnesso — dati non in tempo reale'}
      />

      <Separator />

      {/* Cycle ID */}
      <StatusPill
        icon={Activity}
        label="Ciclo"
        value={`#${metrics.cycleId}`}
        tone="muted"
        title="ID del ciclo cognitivo corrente"
        onClick={() => {
          // Future: open cycle history modal
          setCommandPaletteOpen(true)
        }}
      />

      {/* Queue depth */}
      <StatusPill
        icon={Layers}
        label="Queue"
        value={metrics.queueDepth}
        tone={queueTone}
        title="Profondità della coda Sensorium"
        onClick={() => setActiveView('cockpit')}
      />

      {/* Active threads */}
      <StatusPill
        icon={Cpu}
        label="Threads"
        value={metrics.activeThreads}
        tone={metrics.activeThreads > 0 ? 'ok' : 'muted'}
        title="Thread attivi"
        onClick={() => setActiveView('cockpit')}
      />

      {/* System load */}
      <StatusPill
        icon={Gauge}
        label="Load"
        value={`${metrics.systemLoad}%`}
        tone={loadTone}
        title="Carico di sistema"
        onClick={() => setActiveView('cockpit')}
      />

      {/* Cost placeholder — coming in 1.1 */}
      <Separator />
      <StatusPill
        icon={AlertTriangle}
        label="Cost"
        value="—"
        tone="muted"
        title="Cost tracking in arrivo nella Release 1.1"
      />
    </div>
  )
}

function Separator() {
  return <span className="h-4 w-px bg-border mx-1 shrink-0" aria-hidden />
}
