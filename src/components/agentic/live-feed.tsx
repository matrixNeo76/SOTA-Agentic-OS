'use client'

import { useSensoriumLive } from './use-sensorium-live'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Radio, Activity, GitBranch, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Pannello live che mostra il flusso di eventi WebSocket in tempo reale:
 *  - Sensorium corrente (cycleId, load, queue, threads)
 *  - Eventi agente (ultimi 50)
 *  - State diff (ultime 30 transazioni PatchBoard)
 */
export function LiveFeed() {
  const { connected, sensorium, events, diffs } = useSensoriumLive()

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className={cn('size-4', connected ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground')} />
              Live Event Bus
            </CardTitle>
            <CardDescription className="text-xs">
              WebSocket real-time · {connected ? 'connesso' : 'disconnesso'}
            </CardDescription>
          </div>
          <Badge variant={connected ? 'default' : 'secondary'} className="text-[10px]">
            {connected ? 'LIVE' : 'OFF'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sensorium && (
          <div className="grid grid-cols-4 gap-2">
            <LiveMetric label="Ciclo" value={`#${sensorium.cycleId}`} />
            <LiveMetric label="Queue" value={sensorium.queueDepth} />
            <LiveMetric label="Threads" value={sensorium.activeThreads} />
            <LiveMetric label="Load" value={`${(sensorium.systemLoad * 100).toFixed(0)}%`} />
          </div>
        )}

        <div>
          <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
            <Activity className="size-3" /> Eventi Agente
          </div>
          <ScrollArea className="h-40 pr-2">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                In attesa di eventi… generane uno da una qualsiasi fase.
              </p>
            ) : (
              <ul className="space-y-1">
                {events.map((e, i) => (
                  <li key={i} className="text-xs flex items-center gap-1.5">
                    {e.level === 'warn' || e.level === 'error'
                      ? <AlertTriangle className="size-3 text-amber-500 shrink-0" />
                      : <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />}
                    <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono shrink-0">
                      P{e.phase}
                    </Badge>
                    <span className="text-muted-foreground font-mono shrink-0 text-[10px]">{e.agentId}</span>
                    <span className="font-mono truncate text-[10px]">{e.event}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                      {new Date(e.ts).toLocaleTimeString('it-IT')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        <div>
          <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
            <GitBranch className="size-3" /> State Diff (PatchBoard)
          </div>
          <ScrollArea className="h-32 pr-2">
            {diffs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nessuna transazione live.</p>
            ) : (
              <ul className="space-y-1">
                {diffs.map((d, i) => (
                  <li key={i} className="text-xs flex items-center gap-1.5">
                    {d.accepted
                      ? <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                      : <XCircle className="size-3 text-red-500 shrink-0" />}
                    <span className="text-muted-foreground font-mono shrink-0 text-[10px]">{d.actor}</span>
                    <span className={cn('text-[10px] truncate', d.accepted ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {d.accepted ? 'accept' : 'reject'}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate flex-1">{d.reason}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(d.ts).toLocaleTimeString('it-IT')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  )
}

function LiveMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 rounded-md p-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-mono font-bold">{value}</div>
    </div>
  )
}
