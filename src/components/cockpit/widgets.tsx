'use client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Activity, Clock, Cpu, Database, Gauge as GaugeIcon, Flame, AlertTriangle } from 'lucide-react'

export function SensoriumWidget({ sensorium }: { sensorium: any }) {
  const cycle = sensorium?.cycleId ?? 0; const queue = sensorium?.queueDepth ?? 0; const threads = sensorium?.activeThreads ?? 0; const load = sensorium?.systemLoad ?? 0
  return (
    <Card className="hover:shadow-md transition-shadow duration-200"><CardHeader><CardTitle className="flex items-center gap-2"><GaugeIcon className="size-4 text-primary" />Sensorium Ambientale</CardTitle><CardDescription>Stato del sistema in tempo reale</CardDescription></CardHeader>
      <CardContent><div className="grid grid-cols-4 gap-2"><Widget icon={Clock} label="Ciclo" value={`#${cycle}`} /><Widget icon={Database} label="Queue" value={queue} /><Widget icon={Cpu} label="Threads" value={threads} /><Widget icon={Activity} label="Load" value={`${(load * 100).toFixed(0)}%`} warn={load > 0.7} /></div></CardContent></Card>
  )
}

function Widget({ icon: Icon, label, value, warn }: { icon: any; label: string; value: string | number; warn?: boolean }) {
  return <div className="bg-muted/30 rounded-md p-2.5 text-center hover:bg-muted/50 transition-colors"><Icon className={cn('size-4 mx-auto mb-1', warn ? 'text-status-warn' : 'text-muted-foreground')} /><div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div><div className={cn('text-base font-bold font-mono tabular-nums', warn && 'text-status-warn')}>{value}</div></div>
}

export function AffectGauge({ desperation, frustration }: { desperation: number; frustration: number }) {
  const dc = desperation >= 0.7 ? 'bg-status-danger' : desperation >= 0.4 ? 'bg-status-warn' : 'bg-status-ok'
  const fc = frustration >= 0.7 ? 'bg-status-danger' : frustration >= 0.4 ? 'bg-status-warn' : 'bg-status-ok'
  const crit = desperation >= 0.7 || frustration >= 0.7
  return (
    <Card className={cn('hover:shadow-md transition-shadow duration-200', crit && 'border-status-danger/40')}><CardHeader><CardTitle className="flex items-center gap-2"><Flame className={cn('size-4', crit ? 'text-status-danger' : 'text-muted-foreground')} />Telemetria Affettiva</CardTitle><CardDescription>{crit ? 'Stato critico — intervento richiesto' : 'Stato emotivo funzionale'}</CardDescription></CardHeader>
      <CardContent className="space-y-3"><Gauge label="Desperazione" value={desperation} color={dc} icon={Flame} /><Gauge label="Frustrazione" value={frustration} color={fc} icon={AlertTriangle} /></CardContent></Card>
  )
}

function Gauge({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: any }) {
  const pct = Math.min(100, value * 100)
  return <div><div className="flex items-center justify-between text-xs mb-1"><span className="flex items-center gap-1.5"><Icon className="size-3 text-muted-foreground" />{label}</span><span className="font-mono font-medium">{value.toFixed(2)}</span></div><div className="h-2.5 bg-muted rounded-full overflow-hidden"><div className={cn('h-full rounded-full transition-all duration-500 shadow-sm', color)} style={{ width: `${pct}%` }} /></div></div>
}
