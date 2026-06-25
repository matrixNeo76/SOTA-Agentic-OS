'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
 Activity, Clock, Layers, Cpu, Gauge, ShieldAlert,
 CheckCircle2, AlertTriangle, XCircle, Zap,
} from 'lucide-react'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { useDataStore, startGlobalRefresh, stopGlobalRefresh } from '@/lib/stores/data-store'

// === Types ===
type DashboardData = {
 agentLogsTotal: number
 phase1: { episodic: number; semantic: number; logical: number }
 phase2: { plans: number; planTasks: number }
 phase4: { verificationEvents: number; verifRejects: number; blockedTaints: number }
 phase9: { pendingGates: number; auditEntries: number }
 phase11: { interventions: number; avgDesperation: number }
 phase14: { decisions: number; primary: number; ensemble: number; critic: number }
} | null

// === Main QuickStats ===
export function QuickStats() {
 const { sensorium, connected } = useSensoriumLive()
 const { dashboard, fetchDashboard } = useDataStore()

 useEffect(() => {
   startGlobalRefresh()
   fetchDashboard()
   return () => stopGlobalRefresh()
 }, [fetchDashboard, startGlobalRefresh, stopGlobalRefresh])

 const loading = !dashboard

 return (
 <div className="h-full flex flex-col">
 {/* Header */}
 <div className="shrink-0 px-3 py-2.5 border-b">
 <div className="flex items-center gap-2">
 <Activity className="size-4 text-primary" />
 <h2 className="text-sm font-semibold">Quick Stats</h2>
 <span className={cn(
 'ml-auto size-1.5 rounded-full',
 connected ? 'bg-status-ok animate-pulse' : 'bg-muted-foreground'
 )} />
 </div>
 <p className="text-[10px] text-muted-foreground mt-0.5">
 Snapshot real-time · seleziona un elemento per ispezionarlo
 </p>
 </div>

 {/* Body */}
 <div className="flex-1 overflow-y-auto p-3 space-y-3">
 {loading ? (
 <div className="space-y-3">
 {[1, 2, 3, 4].map((i) => (
 <div key={i} className="rounded-lg border bg-card/50">
 <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b bg-muted/30">
 <div className="size-3 rounded bg-muted animate-pulse" />
 <div className="h-3 w-20 bg-muted animate-pulse rounded" />
 </div>
 <div className="p-1.5 space-y-1.5">
 {[1, 2, 3].map((j) => (
 <div key={j} className="flex items-center gap-2 px-1.5 py-1">
 <div className="size-3 rounded bg-muted animate-pulse" />
 <div className="h-3 flex-1 bg-muted animate-pulse rounded" />
 <div className="h-3 w-8 bg-muted animate-pulse rounded" />
 </div>
 ))}
 </div>
 </div>
 ))}
 </div>
 ) : (
 <>
 {/* Sensorium runtime */}
 <Section title="Sensorium" icon={Cpu}>
 <StatRow icon={Clock} label="Ciclo" value={sensorium ? `#${sensorium.cycleId}` : '—'} />
 <StatRow icon={Layers} label="Queue" value={sensorium?.queueDepth ?? 0}
 tone={sensorium && sensorium.queueDepth >= 5 ? 'warn' : 'ok'} />
 <StatRow icon={Cpu} label="Threads" value={sensorium?.activeThreads ?? 0} />
 <StatRow icon={Gauge} label="Load"
 value={sensorium ? `${Math.round(sensorium.systemLoad * 100)}%` : '—'}
 tone={sensorium && sensorium.systemLoad >= 0.7 ? 'warn' : 'ok'} />
 </Section>

 {/* Memory & tasks */}
 <Section title="Memoria & Task" icon={Zap}>
 <StatRow icon={Activity} label="Episodi" value={dashboard?.phase1?.episodic ?? 0} />
 <StatRow icon={Layers} label="Entità" value={dashboard?.phase1?.semantic ?? 0} />
 <StatRow icon={Zap} label="Piani" value={dashboard?.phase2?.plans ?? 0} />
 <StatRow icon={CheckCircle2} label="Task totali" value={dashboard?.phase2?.planTasks ?? 0} />
 </Section>

 {/* Trust & safety */}
 <Section title="Trust & Safety" icon={ShieldAlert}>
 <StatRow icon={ShieldAlert} label="Verifiche LTL" value={dashboard?.phase4?.verificationEvents ?? 0} />
 <StatRow icon={XCircle} label="Reject" value={dashboard?.phase4?.verifRejects ?? 0}
 tone={(dashboard?.phase4?.verifRejects ?? 0) > 0 ? 'danger' : 'ok'} />
 <StatRow icon={AlertTriangle} label="Taint bloccati" value={dashboard?.phase4?.blockedTaints ?? 0}
 tone={(dashboard?.phase4?.blockedTaints ?? 0) > 0 ? 'warn' : 'ok'} />
 <StatRow icon={Clock} label="Gates pending" value={dashboard?.phase9?.pendingGates ?? 0}
 tone={(dashboard?.phase9?.pendingGates ?? 0) > 0 ? 'warn' : 'ok'} />
 </Section>

 {/* Cognitive */}
 <Section title="Cognitive & Affect" icon={Activity}>
 <StatRow icon={AlertTriangle} label="Interventi" value={dashboard?.phase11?.interventions ?? 0}
 tone={(dashboard?.phase11?.interventions ?? 0) > 0 ? 'danger' : 'ok'} />
 <StatRow icon={Activity} label="Avg desperation"
 value={dashboard?.phase11?.avgDesperation?.toFixed(2) ?? '—'}
 tone={(dashboard?.phase11?.avgDesperation ?? 0) >= 0.5 ? 'warn' : 'ok'} />
 <StatRow icon={Zap} label="Routing decisions" value={dashboard?.phase14?.decisions ?? 0} />
 </Section>

 {/* Activity log count */}
 <Section title="Activity Log" icon={Activity}>
 <StatRow icon={Activity} label="Eventi totali" value={dashboard?.agentLogsTotal ?? 0} />
 </Section>

 <div className="text-[10px] text-muted-foreground text-center pt-2 italic">
 Aggiornamento automatico ogni 5s
 </div>
 </>
 )}
 </div>
 </div>
 )
}

// === Section ===
function Section({ title, icon: Icon, children }: { title: string; icon: typeof Activity; children: React.ReactNode }) {
 return (
 <div className="rounded-lg border bg-card/50">
 <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b bg-muted/30">
 <Icon className="size-3 text-muted-foreground" />
 <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
 </div>
 <div className="p-1.5 space-y-0.5">{children}</div>
 </div>
 )
}

// === StatRow ===
function StatRow({
 icon: Icon,
 label,
 value,
 tone = 'muted',
}: {
 icon: typeof Activity
 label: string
 value: string | number
 tone?: 'ok' | 'warn' | 'danger' | 'muted'
}) {
 const toneClass = {
 ok: 'text-status-ok',
 warn: 'text-status-warn',
 danger: 'text-status-danger',
 muted: 'text-foreground',
 }[tone]

 return (
 <div className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/40 transition-colors">
 <Icon className={cn('size-3 shrink-0', toneClass)} />
 <span className="text-[11px] text-muted-foreground">{label}</span>
 <span className={cn('text-[11px] font-mono font-semibold tabular-nums ml-auto', toneClass)}>
 {value}
 </span>
 </div>
 )
}
