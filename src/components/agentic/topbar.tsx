'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { Activity, Cpu, Database, Gauge } from 'lucide-react'

/**
 * Topbar: mostra metriche live di sistema (Sensorium compattato).
 */
export function Topbar() {
  const { cycleId, systemLoad, queueDepth, activeThreads, setRuntime } = useStore()
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    // bootstrap: carica un sensorium iniziale
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
