'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
 Activity, Layers, Cpu, Gauge, DollarSign, CheckCircle2, XCircle,
} from 'lucide-react'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { useDataStore } from '@/lib/stores/data-store'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { CostBreakdownModal } from './cost-breakdown-modal'

// === Status pill (single metric) ===
type Tone = 'ok' | 'warn' | 'danger' | 'muted'

const TONE_CLASSES: Record<Tone, string> = {
 ok: 'text-status-ok',
 warn: 'text-status-warn',
 danger: 'text-status-danger',
 muted: 'text-muted-foreground',
}

const TONE_DOT: Record<Tone, string> = {
 ok: 'bg-status-ok',
 warn: 'bg-status-warn',
 danger: 'bg-status-danger',
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
 'group flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-mono transition-all active:scale-95',
 onClick ? 'hover:bg-muted/60 cursor-pointer' : 'cursor-default'
 )}
 >
 <span className={cn('size-1.5 rounded-full shrink-0', TONE_DOT[tone])} />
 <Icon className={cn('size-3 shrink-0', TONE_CLASSES[tone])} />
 <span className="text-muted-foreground">{label}</span>
 <span className={cn('font-semibold tabular-nums', TONE_CLASSES[tone])}>{value}</span>
 </button>
 )
}

// === Format cost for display ===
function formatCost(cost: number): string {
 if (cost === 0) return '$0.00'
 if (cost < 0.01) return `$${cost.toFixed(4)}`
 return `$${cost.toFixed(2)}`
}

// === Main StatusBar ===
export function StatusBar() {
 const { sensorium, connected } = useSensoriumLive()
 const { setActiveView, setCommandPaletteOpen } = useStore()
 const { cost: costData, fetchCost } = useDataStore()
 const [showCostModal, setShowCostModal] = useState(false)
 const lastAlertRef = useRef<{ level: 'warn' | 'danger' | null; cost: number }>({ level: null, cost: 0 })

 const costToday = costData?.today ?? 0
 const budget = costData?.budget ?? { warn: 1, danger: 5 }

 useEffect(() => {
   fetchCost()
 }, [fetchCost])

 // Budget alerts (reagisce a cambiamenti di costToday)
 useEffect(() => {
   if (!costData) return
   const prev = lastAlertRef.current
   if (costToday >= budget.danger && prev.level !== 'danger') {
     toast.error(`🚨 Budget danger superato: $${costToday.toFixed(4)} / $${budget.danger}`, {
       description: 'Le chiamate LLM hanno superato la soglia di spesa giornaliera critica.',
       duration: 10000,
     })
     lastAlertRef.current = { level: 'danger', cost: costToday }
   } else if (costToday >= budget.warn && costToday < budget.danger && prev.level !== 'warn' && prev.level !== 'danger') {
     toast.warning(`⚠️ Budget warning: $${costToday.toFixed(4)} / $${budget.warn}`, {
       description: 'Stai superando la soglia di spesa giornaliera consigliata.',
       duration: 8000,
     })
     lastAlertRef.current = { level: 'warn', cost: costToday }
   } else if (costToday < budget.warn && prev.level !== null) {
     lastAlertRef.current = { level: null, cost: costToday }
   }
 }, [costData, costToday, budget.danger, budget.warn])

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

 // Cost tone: warn if > $1, danger if > $10
 const costTone: Tone =
 !costData ? 'muted'
 : costToday >= 10 ? 'danger'
 : costToday >= 1 ? 'warn'
 : 'ok'

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

 {/* Cost — click to open breakdown modal */}
 <Separator />
 <StatusPill
 icon={DollarSign}
 label="Cost"
 value={!costData ? '—' : formatCost(costToday)}
 tone={costTone}
 title={!costData
 ? 'Cost tracking non disponibile'
 : `Spesa LLM totale di oggi: ${formatCost(costToday)} USD · Click per dettagli`
 }
 onClick={() => setShowCostModal(true)}
 />

 {/* Cost breakdown modal */}
 {showCostModal && <CostBreakdownModal onClose={() => setShowCostModal(false)} />}
 </div>
 )
}

function Separator() {
 return <span className="h-4 w-px bg-border/60 mx-0.5 shrink-0" aria-hidden />
}
