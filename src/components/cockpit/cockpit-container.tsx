'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PhaseHeader } from '@/components/agentic/phase-header'
import { RelatedPhases, link } from '@/components/agentic/related-phases'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { useDataStore } from '@/lib/stores/data-store'
import { RefreshCw, Activity, Clock, ListChecks, History, AlertTriangle } from 'lucide-react'
import { SensoriumWidget, AffectGauge } from './widgets'
import { NarrativeTab, LogTab, SchedulerTab, CyclesTab, SafetyTab } from './tabs'
import type { Narrative, LogEntry, SchedulerTask, CycleSnapshot, SteeringEvent, SafetyItem, CockpitTab } from './types'

export function Cockpit() {
  const [tab, setTab] = useState<CockpitTab>('narrative')
  const [narratives, setNarratives] = useState<Narrative[]>([])
  
  const [tasks, setTasks] = useState<SchedulerTask[]>([])
  const [snapshots, setSnapshots] = useState<CycleSnapshot[]>([])
  const [steeringEvents, setSteeringEvents] = useState<SteeringEvent[]>([])
  const [safetyItems, setSafetyItems] = useState<SafetyItem[]>([])
  const { sensorium } = useSensoriumLive()
  const { affect, fetchAffect, logs: sharedLogs, fetchLogs } = useDataStore()

  const refresh = async (t?: string) => {
    const tabName = t || tab
    if (tabName === 'log') { await fetchLogs(true); return }
    const r = await fetch(`/api/cockpit?tab=${tabName}`); const d = await r.json()
    if (tabName === 'narrative') setNarratives(d.items || [])
    else if (tabName === 'scheduler') setTasks(d.tasks || [])
    else if (tabName === 'cycles') { setSnapshots(d.snapshots || []); setSteeringEvents(d.steeringEvents || []) }
    else if (tabName === 'safety') setSafetyItems(d.blockedActions || [])
  }

  useEffect(() => { fetchAffect() }, [fetchAffect])
  {/* eslint-disable react-hooks/set-state-in-effect */}
  useEffect(() => { void refresh(tab) }, [tab])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PhaseHeader phaseId="cockpit" action={<Button variant="outline" size="sm" onClick={() => refresh()}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><SensoriumWidget sensorium={sensorium} /><AffectGauge desperation={affect?.avgDesperation || 0} frustration={affect?.avgFrustration || 0} /></div>
      <Tabs value={tab} onValueChange={v => { setTab(v as CockpitTab); void refresh(v) }} className="w-full">
        <TabsList className="grid grid-cols-5 w-full"><TabsTrigger value="narrative"><Activity className="size-3.5 mr-1.5" />Narrative</TabsTrigger><TabsTrigger value="log"><History className="size-3.5 mr-1.5" />Log</TabsTrigger><TabsTrigger value="scheduler"><ListChecks className="size-3.5 mr-1.5" />Scheduler</TabsTrigger><TabsTrigger value="cycles"><Clock className="size-3.5 mr-1.5" />Cycles</TabsTrigger><TabsTrigger value="safety"><AlertTriangle className="size-3.5 mr-1.5" />Safety</TabsTrigger></TabsList>
        <TabsContent value="narrative" className="mt-4"><NarrativeTab narratives={narratives} /></TabsContent>
        <TabsContent value="log" className="mt-4"><LogTab logs={sharedLogs as any} /></TabsContent>
        <TabsContent value="scheduler" className="mt-4"><SchedulerTab tasks={tasks} /></TabsContent>
        <TabsContent value="cycles" className="mt-4"><CyclesTab snapshots={snapshots} steeringEvents={steeringEvents} /></TabsContent>
        <TabsContent value="safety" className="mt-4"><SafetyTab safetyItems={safetyItems} /></TabsContent>
      </Tabs>
      <RelatedPhases links={[link('phase11', 'Affect Monitor', 'Le metriche alimentano il gauge'), link('phase4', 'Dettagli LTL', 'Le violazioni LTL nel tab Safety'), link('phase9', 'Gates HITL', 'I gate pending come azioni bloccate'), link('phase2', 'Piani in scheduler', 'I piani DynAMO generano i task')]} />
    </div>
  )
}
