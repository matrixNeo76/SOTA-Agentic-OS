'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  HeartPulse, RefreshCw, Play, AlertTriangle, Flame, Snowflake, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Sample = {
  id: string; agentId: string; desperation: number; frustration: number;
  toolFailureRate: number; gateRejectRate: number; repeatedToolCalls: number;
  intervention: string | null; cycleId: number; timestamp: string
}

export function Phase11() {
  const [history, setHistory] = useState<Sample[]>([])
  const [stats, setStats] = useState<any>(null)
  const [agentId, setAgentId] = useState('orchestrator')
  const [toolFailures, setToolFailures] = useState(2)
  const [toolCalls, setToolCalls] = useState(5)
  const [gateRejects, setGateRejects] = useState(3)
  const [gateAttempts, setGateAttempts] = useState(4)
  const [repeatedToolCalls, setRepeatedToolCalls] = useState(2)

  const refresh = async () => {
    const [histR, statsR] = await Promise.all([
      fetch(`/api/affect?action=history&agentId=${agentId}`).then((r) => r.json()),
      fetch('/api/affect?action=stats').then((r) => r.json()),
    ])
    setHistory(histR.history || [])
    setStats(statsR)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [agentId])

  const compute = async () => {
    const r = await fetch('/api/affect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'compute',
        agentId,
        toolFailures, toolCalls, gateRejects, gateAttempts, repeatedToolCalls,
      }),
    })
    const d = await r.json()
    if (d.ok) {
      if (d.intervention) {
        toast.warning(`Intervento Meta-Observer: ${d.intervention.slice(0, 80)}`)
      } else {
        toast.success(`Metriche calcolate: desp=${d.desperation.toFixed(2)} frust=${d.frustration.toFixed(2)}`)
      }
      refresh()
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HeartPulse className="size-6 text-primary" /> Fase 11 · Affect Subsystem
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Telemetria affettiva: Disperazione + Frustrazione → Meta-Observer interviene con cooldown/tightening.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-3.5 mr-1.5" /> Aggiorna
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Samples" value={stats.samples} />
          <StatCard label="Agenti monitorati" value={stats.agents} />
          <StatCard label="Interventi" value={stats.interventions} warn={stats.interventions > 0} />
          <StatCard label="Avg desperation" value={(stats.avgDesperation || 0).toFixed(2)} warn={stats.avgDesperation > 0.5} />
        </div>
      )}

      <Tabs defaultValue="compute" className="w-full">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="compute"><Play className="size-3.5 mr-1.5" /> Calcola Metriche</TabsTrigger>
          <TabsTrigger value="history">Storico</TabsTrigger>
        </TabsList>

        <TabsContent value="compute" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Input Telemetria Ciclo</CardTitle>
              <CardDescription>
                Disperazione = gateRejects × 0.35 (decay 5%/ciclo)<br/>
                Frustrazione = toolFailures × 0.20 + repeatedCalls × 0.15
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Agent ID</Label>
                <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <Label className="text-xs">Tool failures</Label>
                  <Input type="number" value={toolFailures} onChange={(e) => setToolFailures(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Tool calls</Label>
                  <Input type="number" value={toolCalls} onChange={(e) => setToolCalls(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Gate rejects</Label>
                  <Input type="number" value={gateRejects} onChange={(e) => setGateRejects(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Gate attempts</Label>
                  <Input type="number" value={gateAttempts} onChange={(e) => setGateAttempts(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Repeated calls</Label>
                  <Input type="number" value={repeatedToolCalls} onChange={(e) => setRepeatedToolCalls(Number(e.target.value))} />
                </div>
              </div>
              <Button size="sm" onClick={compute}>
                <Play className="size-3.5 mr-1.5" /> Calcola Metriche Affettive
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Storico Telemetria · {agentId}</CardTitle>
              <CardDescription>{history.length} samples</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 pr-2">
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessun sample. Calcola le metriche.</p>
                ) : (
                  <ul className="space-y-2">
                    {history.map((s) => (
                      <li key={s.id} className="text-xs border rounded-md p-2.5">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-[10px] font-mono">#{s.cycleId}</Badge>
                          {s.intervention ? (
                            <Badge variant="secondary" className="text-[10px] bg-red-500">
                              <AlertTriangle className="size-2.5 mr-1" /> INTERVENTION
                            </Badge>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(s.timestamp).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="flex items-center gap-1"><Flame className="size-2.5 text-red-500" /> Desperation</span>
                              <span className="font-mono">{s.desperation.toFixed(2)}</span>
                            </div>
                            <Progress value={s.desperation * 100} className={cn('h-1.5', s.desperation > 0.7 && '[&>div]:bg-red-500', s.desperation > 0.4 && s.desperation <= 0.7 && '[&>div]:bg-amber-500')} />
                          </div>
                          <div>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="flex items-center gap-1"><Snowflake className="size-2.5 text-sky-500" /> Frustration</span>
                              <span className="font-mono">{s.frustration.toFixed(2)}</span>
                            </div>
                            <Progress value={s.frustration * 100} className={cn('h-1.5', s.frustration > 0.7 && '[&>div]:bg-red-500', s.frustration > 0.4 && s.frustration <= 0.7 && '[&>div]:bg-amber-500')} />
                          </div>
                        </div>
                        {s.intervention && (
                          <div className="text-[10px] bg-red-50 dark:bg-red-950/20 border border-red-500/30 rounded p-1.5 font-mono">
                            <Shield className="size-2.5 inline mr-1" />
                            {s.intervention}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-muted-foreground text-xs mb-1">{label}</div>
        <div className={cn('text-2xl font-bold font-mono', warn && 'text-amber-600 dark:text-amber-400')}>{value}</div>
      </CardContent>
    </Card>
  )
}
