'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'
import { useSensoriumLive } from './use-sensorium-live'
import { toast } from 'sonner'
import {
  RefreshCw, Activity, Clock, Cpu, Database, Gauge as GaugeIcon,
  Flame, AlertTriangle, CheckCircle2, XCircle, ListChecks, History,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Narrative = {
  id: string; agentId: string; narrative: string;
  level: string; cycleId: number | null; relatedPhase: string | null; timestamp: string
}
type LogEntry = {
  id: string; agentId: string; phase: string; event: string;
  payload: string; level: string; timestamp: string
}
type SchedulerTask = {
  id: string; taskId: string; agentId: string; description: string;
  dependencies: string; status: string; plan: { taskGoal: string }
}
type CycleSnapshot = {
  id: string; cycleId: number; xmlContent: string;
  queueDepth: number; activeThreads: number; systemLoad: number; timestamp: string
}
type SteeringEvent = {
  id: string; cycleId: number; agentId: string; strategy: string;
  phrase: string; tokenBudget: number; tokenUsed: number; timestamp: string
}
type SafetyItem = {
  id: string; agentId: string; action: string; source: string;
  axiomTrail: string; readableExplanation: string; status: string; createdAt: string
}

export function Cockpit() {
  const [tab, setTab] = useState('narrative')
  const [narratives, setNarratives] = useState<Narrative[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [tasks, setTasks] = useState<SchedulerTask[]>([])
  const [snapshots, setSnapshots] = useState<CycleSnapshot[]>([])
  const [steeringEvents, setSteeringEvents] = useState<SteeringEvent[]>([])
  const [safetyItems, setSafetyItems] = useState<SafetyItem[]>([])
  const [affectData, setAffectData] = useState<{ desperation: number; frustration: number } | null>(null)
  const { sensorium } = useSensoriumLive()

  const refresh = async (tabName?: string) => {
    const t = tabName || tab
    const r = await fetch(`/api/cockpit?tab=${t}`)
    const d = await r.json()
    if (t === 'narrative') setNarratives(d.items || [])
    else if (t === 'log') setLogs(d.logs || [])
    else if (t === 'scheduler') setTasks(d.tasks || [])
    else if (t === 'cycles') {
      setSnapshots(d.snapshots || [])
      setSteeringEvents(d.steeringEvents || [])
    }
    else if (t === 'safety') setSafetyItems(d.blockedActions || [])
  }

  // Carica affect data in polling leggero
  useEffect(() => {
    const loadAffect = async () => {
      try {
        const r = await fetch('/api/affect?action=stats')
        const d = await r.json()
        setAffectData({
          desperation: d.avgDesperation || 0,
          frustration: d.avgFrustration || 0,
        })
      } catch {}
    }
    loadAffect()
    const t = setInterval(loadAffect, 5000)
    return () => clearInterval(t)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(tab) }, [tab])

  const onTabChange = (t: string) => {
    setTab(t)
    void refresh(t)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PhaseHeader
        phaseId="cockpit"
        action={<Button variant="outline" size="sm" onClick={() => refresh()}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>}
      />

      {/* Sensorium Widget persistente + Affect Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SensoriumWidget sensorium={sensorium} />
        <AffectGauge desperation={affectData?.desperation || 0} frustration={affectData?.frustration || 0} />
      </div>

      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="narrative"><Activity className="size-3.5 mr-1.5" /> Narrative</TabsTrigger>
          <TabsTrigger value="log"><History className="size-3.5 mr-1.5" /> Log</TabsTrigger>
          <TabsTrigger value="scheduler"><ListChecks className="size-3.5 mr-1.5" /> Scheduler</TabsTrigger>
          <TabsTrigger value="cycles"><Clock className="size-3.5 mr-1.5" /> Cycles</TabsTrigger>
          <TabsTrigger value="safety"><AlertTriangle className="size-3.5 mr-1.5" /> Safety</TabsTrigger>
        </TabsList>

        {/* TAB: NARRATIVE */}
        <TabsContent value="narrative" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Narrativa ad alto livello</CardTitle>
              <CardDescription>Dialogo dell'agente comprensibile all'umano</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 pr-2">
                {narratives.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessuna narrativa. Le azioni dell'agente appariranno qui.</p>
                ) : (
                  <ul className="space-y-2">
                    {narratives.map((n) => (
                      <li key={n.id} className={cn(
                        'text-xs border-l-2 pl-3 py-1.5',
                        n.level === 'critical' && 'border-red-500',
                        n.level === 'warn' && 'border-amber-500',
                        n.level === 'info' && 'border-sky-500',
                      )}>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] font-mono">{n.agentId}</Badge>
                          {n.relatedPhase && <Badge variant="secondary" className="text-[10px]">F{n.relatedPhase}</Badge>}
                          {n.cycleId && <Badge variant="outline" className="text-[10px] font-mono">#{n.cycleId}</Badge>}
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(n.timestamp).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <div className="text-xs">{n.narrative}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: LOG */}
        <TabsContent value="log" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Traccia tecnica di esecuzione</CardTitle>
              <CardDescription>{logs.length} eventi · filtri per fase/agente/livello</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 pr-2">
                <ul className="space-y-1">
                  {logs.map((l) => (
                    <li key={l.id} className="text-xs flex items-center gap-2 py-1 border-b border-border/50">
                      <Badge variant="outline" className={cn(
                        'text-[9px] font-mono shrink-0',
                        l.level === 'warn' && 'border-amber-500 text-amber-700 dark:text-amber-400',
                        l.level === 'error' && 'border-red-500 text-red-700 dark:text-red-400',
                      )}>P{l.phase}</Badge>
                      <span className="text-muted-foreground font-mono shrink-0 text-[10px]">{l.agentId}</span>
                      <span className="font-mono text-[11px] truncate flex-1">{l.event}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(l.timestamp).toLocaleTimeString('it-IT')}
                      </span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: SCHEDULER */}
        <TabsContent value="scheduler" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Task in background</CardTitle>
              <CardDescription>{tasks.length} task totali · stato esecuzione</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 pr-2">
                {tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessun task. Genera un piano in Planner & Compiler.</p>
                ) : (
                  <ul className="space-y-2">
                    {tasks.map((t) => (
                      <li key={t.id} className="text-xs border rounded-md p-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="font-mono">{t.taskId}</Badge>
                          <Badge variant="secondary" className={cn(
                            'text-[10px]',
                            t.status === 'done' && 'bg-emerald-500',
                            t.status === 'running' && 'bg-sky-500',
                            t.status === 'failed' && 'bg-red-500',
                            t.status === 'pending' && 'bg-zinc-400',
                          )}>{t.status}</Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">{t.agentId}</span>
                        </div>
                        <div className="text-[11px]">{t.description}</div>
                        <div className="text-[10px] text-muted-foreground mt-1 truncate">
                          Piano: {t.plan?.taskGoal}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: CYCLES */}
        <TabsContent value="cycles" className="mt-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cicli cognitivi (Sensorium)</CardTitle>
                <CardDescription>{snapshots.length} snapshot</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-80 pr-2">
                  <ul className="space-y-1.5">
                    {snapshots.map((s) => (
                      <li key={s.id} className="text-xs border rounded-md p-2">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="font-mono">#{s.cycleId}</Badge>
                          <Badge variant="secondary" className="text-[10px]">load {(s.systemLoad * 100).toFixed(0)}%</Badge>
                          <Badge variant="secondary" className="text-[10px]">Q{s.queueDepth}</Badge>
                          <Badge variant="secondary" className="text-[10px]">T{s.activeThreads}</Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(s.timestamp).toLocaleTimeString('it-IT')}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Steering events</CardTitle>
                <CardDescription>{steeringEvents.length} eventi ACTS</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-80 pr-2">
                  <ul className="space-y-1.5">
                    {steeringEvents.map((e) => (
                      <li key={e.id} className="text-xs border rounded-md p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[10px]">{e.strategy}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{e.tokenUsed} tok</Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(e.timestamp).toLocaleTimeString('it-IT')}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB: SAFETY */}
        <TabsContent value="safety" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                Azioni bloccate in attesa di risoluzione
              </CardTitle>
              <CardDescription>
                L'agente ha tentato azioni che hanno violato i cancelli di sicurezza.
                Risolvi come Sovereign Validator.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 pr-2">
                {safetyItems.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="size-12 text-emerald-500 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Nessuna azione bloccata. Il sistema è in salute.</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {safetyItems.map((s) => (
                      <li key={s.id} className="border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 rounded-md p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <XCircle className="size-4 text-amber-500" />
                          <Badge variant="outline" className="font-mono text-[10px]">{s.source}</Badge>
                          <Badge variant="secondary" className="text-[10px] bg-amber-500">{s.status}</Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(s.createdAt).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <div className="text-xs font-medium mb-1">Azione tentata: "{s.action}"</div>
                        <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded p-2">
{s.readableExplanation}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RelatedPhases links={[
        link('phase11', 'Vedi Affect Monitor', 'Le metriche affettive alimentano il gauge nel Cockpit'),
        link('phase4', 'Dettagli LTL', 'Le violazioni LTL sono mostrate nel tab Safety'),
        link('phase9', 'Gates HITL', 'I gate pending appaiono come azioni bloccate'),
        link('phase2', 'Piani in scheduler', 'I piani DynAMO generano i task nel tab Scheduler'),
      ]} />
    </div>
  )
}

/**
 * Widget persistente del Sensorium: sempre visibile in cima al Cockpit.
 */
function SensoriumWidget({ sensorium }: { sensorium: any }) {
  const cycle = sensorium?.cycleId || 0
  const queue = sensorium?.queueDepth || 0
  const threads = sensorium?.activeThreads || 0
  const load = sensorium?.systemLoad || 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <GaugeIcon className="size-4 text-primary" />
          Sensorium Ambientale
        </CardTitle>
        <CardDescription className="text-xs">Stato del sistema in tempo reale</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3">
          <Widget icon={Clock} label="Ciclo" value={`#${cycle}`} />
          <Widget icon={Database} label="Queue" value={queue} />
          <Widget icon={Cpu} label="Threads" value={threads} />
          <Widget icon={Activity} label="Load" value={`${(load * 100).toFixed(0)}%`} warn={load > 0.7} />
        </div>
      </CardContent>
    </Card>
  )
}

function Widget({ icon: Icon, label, value, warn }: { icon: any; label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-md p-2.5 text-center">
      <Icon className={cn('size-4 mx-auto mb-1', warn ? 'text-amber-500' : 'text-muted-foreground')} />
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn('text-base font-bold font-mono', warn && 'text-amber-600 dark:text-amber-400')}>{value}</div>
    </div>
  )
}

/**
 * Affect Gauge: barra orizzontale animata con soglie colorate.
 * Verde < 0.4, Ambra < 0.7, Rosso ≥ 0.7
 */
function AffectGauge({ desperation, frustration }: { desperation: number; frustration: number }) {
  const despColor = desperation >= 0.7 ? 'bg-red-500' : desperation >= 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
  const frustColor = frustration >= 0.7 ? 'bg-red-500' : frustration >= 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
  const critical = desperation >= 0.7 || frustration >= 0.7

  return (
    <Card className={cn(critical && 'border-red-500/40')}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className={cn('size-4', critical ? 'text-red-500' : 'text-muted-foreground')} />
          Telemetria Affettiva
        </CardTitle>
        <CardDescription className="text-xs">
          {critical ? '⚠ Stato critico rilevato — intervento richiesto' : 'Stato emotivo funzionale dell\'agente'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Gauge label="Desperazione" value={desperation} color={despColor} icon={Flame} />
        <Gauge label="Frustrazione" value={frustration} color={frustColor} icon={AlertTriangle} />
      </CardContent>
    </Card>
  )
}

function Gauge({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: any }) {
  const pct = Math.min(100, value * 100)
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3 text-muted-foreground" />
          {label}
        </span>
        <span className="font-mono font-medium">{value.toFixed(2)}</span>
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
