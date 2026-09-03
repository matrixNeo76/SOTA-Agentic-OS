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
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

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
 // B1 fix (Affect Monitor audit Fase B): try/catch su refresh().
 // PRIMA: un fetch fallito (network error, server 500, body non JSON) faceva
 // throw unhandled rejection che rompeva il polling setInterval e lasciava
 // la UI in stato stale.
 // ORA: catch globale con toast.error user-friendly, preserva stato precedente
 // (non cancella i dati già caricati, evitando UI vuota lampeggiante).
 try {
 const [histR, statsR] = await Promise.all([
 fetch(`/api/affect?action=history&agentId=${agentId}`).then((r) => r.json()),
 fetch('/api/affect?action=stats').then((r) => r.json()),
 ])
 setHistory(histR.history || [])
 setStats(statsR)
 } catch (err) {
 // B1 — Network error o JSON parse error: mostra toast e lascia lo stato precedente
 toast.error('Caricamento Affect Monitor fallito')
 // eslint-disable-next-line no-console
 console.error('[phase11] refresh failed:', err)
 }
 }

 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(() => {
   void refresh()
   // N10: adaptive polling with Page Visibility API
   const interval = setInterval(() => {
     if (!document.hidden) void refresh()
   }, 30_000)
   return () => clearInterval(interval)
 }, [agentId])

 const compute = async () => {
 // B2 fix (Affect Monitor audit Fase B): parse-safe + error handling completo.
 // PRIMA: r.json() poteva throware su risposta non JSON (500 con body HTML),
 // e nessun toast.error se d.ok === false (errore silente).
 // ORA: try/catch esterno per network error + parse-safe interno su r.json()
 // + toast.error esplicito su !d.ok.
 try {
 const r = await fetch('/api/affect', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'compute',
 agentId,
 toolFailures, toolCalls, gateRejects, gateAttempts, repeatedToolCalls,
 }),
 })
 // B2 — parse-safe su r.json() (come G3 del Model Encapsulator Fase C)
 let d: any
 try {
 d = await r.json()
 } catch {
 const text = await r.text().catch(() => '<no body>')
 // eslint-disable-next-line no-console
 console.error('[phase11] compute: response not JSON', r.status, text.slice(0, 200))
 toast.error(`Risposta non valida dal server (status ${r.status})`)
 return
 }
 if (d.ok) {
 if (d.intervention) {
 toast.warning(`Intervento Meta-Observer: ${d.intervention.slice(0, 80)}`)
 } else {
 toast.success(`Metriche calcolate: desp=${d.desperation.toFixed(2)} frust=${d.frustration.toFixed(2)}`)
 }
 refresh()
 } else {
 // B2 — toast.error esplicito su !d.ok (prima era silente)
 toast.error(d.error || 'Errore calcolo metriche affettive')
 }
 } catch (e: any) {
 // B2 — Network error o fetch throw (es. CORS, DNS failure)
 toast.error(e.message || 'Errore di rete')
 // eslint-disable-next-line no-console
 console.error('[phase11] compute fetch failed:', e)
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase11" action={<Button variant="outline" size="sm" onClick={refresh} aria-label="Aggiorna dati Affect Monitor"><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="status" aria-live="polite" aria-label="Statistiche Affect Monitor">
 <StatCard label="Samples" value={stats.samples} />
 <StatCard label="Agenti monitorati" value={stats.agents} />
 <StatCard label="Interventi" value={stats.interventions} warn={stats.interventions > 0} />
 <StatCard label="Avg desperation" value={(stats.avgDesperation || 0).toFixed(2)} warn={stats.avgDesperation > 0.5} />
 {/* G4 — nuove stat card con metriche aggiuntive */}
 <StatCard label="Intervention rate" value={((stats.interventionRate ?? 0) * 100).toFixed(1) + '%'} warn={(stats.interventionRate ?? 0) > 0.1} />
 <StatCard label="Peak desperation" value={(stats.peakDesperation ?? 0).toFixed(2)} warn={(stats.peakDesperation ?? 0) > 0.7} />
 <StatCard label="Peak frustration" value={(stats.peakFrustration ?? 0).toFixed(2)} warn={(stats.peakFrustration ?? 0) > 0.7} />
 <StatCard label="Agenti critici" value={stats.agentsInCriticalState ?? 0} warn={(stats.agentsInCriticalState ?? 0) > 0} />
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
 <Button size="sm" onClick={compute} aria-label="Calcola metriche affettive dall'input telemetria">
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
 <Badge variant="secondary" className="text-[10px] bg-status-danger">
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
 <span className="flex items-center gap-1"><Flame className="size-2.5 text-status-danger" /> Desperation</span>
 <span className="font-mono">{s.desperation.toFixed(2)}</span>
 </div>
 <Progress value={s.desperation * 100} className={cn('h-1.5', s.desperation > 0.7 && '[&>div]:bg-status-danger', s.desperation > 0.4 && s.desperation <= 0.7 && '[&>div]:bg-status-warn')} />
 </div>
 <div>
 <div className="flex justify-between text-[10px] mb-0.5">
 <span className="flex items-center gap-1"><Snowflake className="size-2.5 text-status-info" /> Frustration</span>
 <span className="font-mono">{s.frustration.toFixed(2)}</span>
 </div>
 <Progress value={s.frustration * 100} className={cn('h-1.5', s.frustration > 0.7 && '[&>div]:bg-status-danger', s.frustration > 0.4 && s.frustration <= 0.7 && '[&>div]:bg-status-warn')} />
 </div>
 </div>
 {s.intervention && (
 <div className="text-[10px] bg-status-danger border border-status-danger rounded p-1.5 font-mono">
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
 <RelatedPhases links={[link('phase4', 'Fonte: gate rejects', 'I rifiuti LTL/Taint alimentano la disperazione'), link('phase9', 'Interventi → HITL', 'Il Meta-Observer può forzare gate HITL'), link('phase3', 'HALT steering', 'Gli interventi HALT fermano il ciclo cognitivo'), link('phase5', 'Rifletti su stress', 'Le metriche affettive alimentano euristiche ERL')]} />

 </div>
 )
}

function StatCard({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4" role="group" aria-label={`Statistica: ${label}`}>
 <div className="text-muted-foreground text-xs mb-1">{label}</div>
 <div className={cn('text-2xl font-bold font-mono', warn && 'text-status-warn')} aria-label={`${label}: ${value}`}>{value}</div>
 </CardContent>
 </Card>
 )
}
