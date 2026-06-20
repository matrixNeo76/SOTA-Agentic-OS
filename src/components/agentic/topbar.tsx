'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { useSensoriumLive } from './use-sensorium-live'
import { Activity, Cpu, Database, Gauge, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Topbar: mostra metriche live di sistema (Sensorium + WS status).
 */
export function Topbar() {
  const { cycleId, systemLoad, queueDepth, activeThreads, setRuntime } = useStore()
  const { connected, sensorium } = useSensoriumLive()
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    // bootstrap: carica un sensorium iniziale via HTTP
    fetch('/api/sensorium')
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) {
          setRuntime({
            cycleId: d.data.cycleId,
            systemLoad: d.data.systemLoad,
            queueDepth: d.data.queueDepth,
            activeThreads: d.data.activeThreads,
          })
          setBooted(true)
        }
      })
      .catch(() => {})
  }, [setRuntime])

  // Aggiorna dalle WS live se disponibili
  useEffect(() => {
    if (sensorium) {
      setRuntime({
        cycleId: sensorium.cycleId,
        systemLoad: sensorium.systemLoad,
        queueDepth: sensorium.queueDepth,
        activeThreads: sensorium.activeThreads,
      })
    }
  }, [sensorium, setRuntime])

  return (
    <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-30">
      <div className="flex items-center gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-emerald-500" />
          <span className="text-sm font-medium">Ciclo Cognitivo</span>
          <span className="text-sm font-mono text-muted-foreground">#{cycleId}</span>
        </div>
        <div className="flex-1" />
        <Metric icon={Gauge} label="Load" value={`${(systemLoad * 100).toFixed(0)}%`} color={systemLoad > 0.7 ? 'text-amber-500' : 'text-emerald-500'} />
        <Metric icon={Database} label="Queue" value={String(queueDepth)} />
        <Metric icon={Cpu} label="Threads" value={String(activeThreads)} />
        <div className="flex items-center gap-1.5" title={connected ? 'WebSocket connesso' : 'WebSocket disconnesso'}>
          <Radio className={cn('size-3.5', connected ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground')} />
          <span className={cn('text-xs font-mono', connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {connected ? 'LIVE' : 'OFF'}
          </span>
        </div>
        <div className={`size-2 rounded-full ${booted ? 'bg-emerald-500 animate-pulse' : 'bg-muted'}`} />
      </div>
    </header>
  )
}

function Metric({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className={`size-3.5 ${color || 'text-muted-foreground'}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium ${color || ''}`}>{value}</span>
    </div>
  )
}
