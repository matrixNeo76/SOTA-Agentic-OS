'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
 GitFork, RefreshCw, Plus, CheckCircle2, XCircle, AlertTriangle,
 Layers, Target, Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Trace = {
 id: string
 workflowId: string
 traceLabel: string
 statesJson: string
 actionsJson: string
 outcome: string
 capturedAt: string
}

type PTA = {
 nodes: Record<string, any>
 startNodeId: string
 acceptNodeIds: string[]
 dominators: string[]
} | null

const VERDICT_STYLE = {
 accept: { color: 'text-status-ok', icon: CheckCircle2, label: 'ACCEPT' },
 warn: { color: 'text-status-warn', icon: AlertTriangle, label: 'WARN' },
 reject: { color: 'text-status-danger', icon: XCircle, label: 'REJECT' },
}

export function Phase7() {
 const [traces, setTraces] = useState<Trace[]>([])
 const [pta, setPta] = useState<PTA>(null)
 const [stats, setStats] = useState<any>(null)
 const [workflowId, setWorkflowId] = useState('wf-ui-login')
 const [traceLabel, setTraceLabel] = useState('Trace 1')
 const [statesInput, setStatesInput] = useState('start,login_form,submit,loading,dashboard')
 const [actionsInput, setActionsInput] = useState('open_url,fill_form,click_submit,wait,verify_dashboard')
 const [outcome, setOutcome] = useState<'success' | 'failure' | 'partial'>('success')
 const [validateStates, setValidateStates] = useState('start,login_form,submit,dashboard')
 const [lastValidation, setLastValidation] = useState<any>(null)

 const refresh = async () => {
 const [tracesR, ptaR, statsR] = await Promise.all([
 fetch(`/api/dominator?action=traces&workflowId=${workflowId}`).then((r) => r.json()),
 fetch(`/api/dominator?action=pta&workflowId=${workflowId}`).then((r) => r.json()),
 fetch('/api/dominator?action=stats').then((r) => r.json()),
 ])
 setTraces(tracesR.traces || [])
 setPta(ptaR.pta || null)
 setStats(statsR)
 }

 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(() => { void refresh() }, [workflowId])

 const capture = async () => {
 const states = statesInput.split(',').map((s) => s.trim()).filter(Boolean)
 const actions = actionsInput.split(',').map((s) => s.trim()).filter(Boolean)
 if (states.length === 0) {
 toast.error('Inserisci almeno uno stato')
 return
 }
 const r = await fetch('/api/dominator', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'capture_trace',
 workflowId, traceLabel, states, actions, outcome,
 }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Traccia catturata: ${states.length} stati`)
 refresh()
 } else toast.error(d.error)
 }

 const buildPta = async () => {
 try {
 const r = await fetch('/api/dominator', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'build_pta', workflowId }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`PTA costruito: ${d.traceCount} tracce fuse, ${d.dominators} dominatori, ${d.nodeCount} nodi`)
 refresh()
 } else toast.error(d.error)
 } catch (e: any) {
 toast.error(e.message)
 }
 }

 const validate = async () => {
 const states = validateStates.split(',').map((s) => s.trim()).filter(Boolean)
 const r = await fetch('/api/dominator', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'validate_trace', workflowId, states }),
 })
 const d = await r.json()
 setLastValidation(d)
 if (d.verdict === 'accept') toast.success(`Trace ACCEPT · coverage ${d.dominatorCoverage.toFixed(2)}`)
 else if (d.verdict === 'warn') toast.warning(`Trace WARN · coverage ${d.dominatorCoverage.toFixed(2)}`)
 else toast.error(`Trace REJECT · coverage ${d.dominatorCoverage.toFixed(2)}`)
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase7" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <StatCard label="Tracce catturate" value={stats.traces} />
 <StatCard label="PTA costruiti" value={stats.ptas} />
 <StatCard label="Validazioni" value={stats.validations} />
 <StatCard label="Avg coverage" value={(stats.avgCoverage || 0).toFixed(2)} highlight={stats.avgCoverage >= 0.7} />
 </div>
 )}

 <Tabs defaultValue="capture" className="w-full">
 <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
 <TabsTrigger value="capture"><Plus className="size-3.5 mr-1.5" /> Cattura Tracce</TabsTrigger>
 <TabsTrigger value="pta"><Network className="size-3.5 mr-1.5" /> PTA + Dominators</TabsTrigger>
 <TabsTrigger value="validate"><Target className="size-3.5 mr-1.5" /> Validazione</TabsTrigger>
 <TabsTrigger value="traces"><Layers className="size-3.5 mr-1.5" /> Storico</TabsTrigger>
 </TabsList>

 <TabsContent value="capture" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Cattura Traccia di Esecuzione</CardTitle>
 <CardDescription>
 2-10 tracce positive necessarie per costruire il PTA. Le tracce verranno fuse in un grafo unificato.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Workflow ID</Label>
 <Input value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} placeholder="wf-ui-login" />
 </div>
 <div>
 <Label className="text-xs">Trace label</Label>
 <Input value={traceLabel} onChange={(e) => setTraceLabel(e.target.value)} />
 </div>
 </div>
 <div>
 <Label className="text-xs">Stati (separati da virgola)</Label>
 <Input value={statesInput} onChange={(e) => setStatesInput(e.target.value)} />
 <p className="text-[10px] text-muted-foreground mt-1">
 Es: start,login_form,submit,loading,dashboard
 </p>
 </div>
 <div>
 <Label className="text-xs">Azioni (separati da virgola, opzionale)</Label>
 <Input value={actionsInput} onChange={(e) => setActionsInput(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Esito</Label>
 <div className="flex gap-2 mt-1">
 {(['success', 'partial', 'failure'] as const).map((o) => (
 <Button
 key={o}
 size="sm"
 variant={outcome === o ? 'default' : 'outline'}
 onClick={() => setOutcome(o)}
 >
 {o}
 </Button>
 ))}
 </div>
 </div>
 <Button size="sm" onClick={capture}>
 <Plus className="size-3.5 mr-1.5" /> Cattura Traccia
 </Button>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="pta" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between">
 <div>
 <CardTitle className="text-sm">Prefix Tree Automaton + Dominators</CardTitle>
 <CardDescription>
 Fonde le tracce positive in un grafo ed estrae gli stati essenziali (dominatori)
 </CardDescription>
 </div>
 <Button size="sm" onClick={buildPta}>
 <GitFork className="size-3.5 mr-1.5" /> Costruisci PTA
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 {!pta ? (
 <p className="text-xs text-muted-foreground italic">
 Nessun PTA per workflow &ldquo;{workflowId}&rdquo;. Cattura almeno 2 tracce e costruisci il PTA.
 </p>
 ) : (
 <div className="space-y-3">
 <div className="flex flex-wrap gap-2">
 <Badge variant="outline">{Object.keys(pta.nodes).length} nodi</Badge>
 <Badge variant="outline">{pta.acceptNodeIds.length} accept</Badge>
 <Badge variant="default" className="bg-cat-cognitive">
 {pta.dominators.length} dominatori essenziali
 </Badge>
 </div>

 <div>
 <div className="text-xs font-medium mb-1.5">Dominatori (checkpoint obbligatori):</div>
 <div className="flex flex-wrap gap-1.5">
 {pta.dominators.length === 0 ? (
 <span className="text-xs text-muted-foreground italic">Nessuno (workflow banale o singola traccia)</span>
 ) : (
 pta.dominators.map((id) => (
 <Badge key={id} className="bg-cat-cognitive text-[10px] font-mono">
 {pta.nodes[id]?.state || id}
 </Badge>
 ))
 )}
 </div>
 </div>

 <div>
 <div className="text-xs font-medium mb-1.5">Grafo PTA:</div>
 <ScrollArea className="h-64 pr-2">
 <div className="space-y-1.5">
 {Object.values(pta.nodes).map((n: any) => {
 const isStart = n.id === pta.startNodeId
 const isAccept = pta.acceptNodeIds.includes(n.id)
 const isDom = pta.dominators.includes(n.id)
 return (
 <div key={n.id} className={cn(
 'text-xs border rounded-md p-2',
 isDom && 'border-cat-cognitive bg-cat-cognitive',
 isStart && 'border-status-info',
 isAccept && 'border-status-ok',
 )}>
 <div className="flex items-center gap-1.5">
 <Badge variant="outline" className="text-[9px] font-mono py-0">{n.id}</Badge>
 <span className="font-mono text-xs">{n.state}</span>
 {isStart && <Badge variant="secondary" className="text-[9px] py-0">start</Badge>}
 {isAccept && <Badge variant="secondary" className="text-[9px] py-0 bg-status-ok">accept</Badge>}
 {isDom && <Badge variant="secondary" className="text-[9px] py-0 bg-cat-cognitive">DOM</Badge>}
 <span className="text-[10px] text-muted-foreground ml-auto">depth {n.depth}</span>
 </div>
 {Object.keys(n.children || {}).length > 0 && (
 <div className="text-[10px] text-muted-foreground mt-1 pl-2">
 → {Object.entries(n.children).map(([s, id]: any) => `${s}→${id}`).join(' ')}
 </div>
 )}
 </div>
 )
 })}
 </div>
 </ScrollArea>
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="validate" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Valida Nuova Traccia</CardTitle>
 <CardDescription>
 Calcola la dominator coverage: 1.0 = ACCEPT, &ge;0.7 = WARN, &lt;0.7 = REJECT
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <Label className="text-xs">Traccia da validare (stati separati da virgola)</Label>
 <Input value={validateStates} onChange={(e) => setValidateStates(e.target.value)} />
 <p className="text-[10px] text-muted-foreground mt-1">
 Prova a saltare uno stato (es. ometti &ldquo;loading&rdquo;) per vedere il verdict cambiare
 </p>
 </div>
 <Button size="sm" onClick={validate}>
 <Target className="size-3.5 mr-1.5" /> Valida
 </Button>

 {lastValidation && (
 <div className="border rounded-md p-3 space-y-2">
 {(() => {
 const style = VERDICT_STYLE[lastValidation.verdict as keyof typeof VERDICT_STYLE] || VERDICT_STYLE.reject
 const Icon = style.icon
 return (
 <div className="flex items-center gap-2">
 <Icon className={cn('size-5', style.color)} />
 <Badge variant="outline" className={cn('font-mono', style.color)}>
 {style.label}
 </Badge>
 <Badge variant="secondary" className="font-mono">
 coverage {lastValidation.dominatorCoverage.toFixed(2)}
 </Badge>
 <Badge variant="outline" className="text-[10px]">
 path {lastValidation.pathValid ? 'valid' : 'deviated'}
 </Badge>
 </div>
 )
 })()}
 <p className="text-xs text-muted-foreground">{lastValidation.reason}</p>
 {lastValidation.passedDominatorIds && (
 <div className="text-[10px] text-muted-foreground">
 Dominatori raggiunti: {lastValidation.passedDominatorIds.length} / {(pta?.dominators || []).length}
 </div>
 )}
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="traces" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Tracce Catturate · Workflow {workflowId}</CardTitle>
 <CardDescription>{traces.length} tracce totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-80 pr-2">
 {traces.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessuna traccia.</p>
 ) : (
 <ul className="space-y-2">
 {traces.map((t) => (
 <li key={t.id} className="text-xs border rounded-md p-2.5">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="text-[10px] font-mono">{t.workflowId}</Badge>
 <Badge variant="secondary" className="text-[10px]">{t.outcome}</Badge>
 <span className="font-medium">{t.traceLabel}</span>
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(t.capturedAt).toLocaleString('it-IT')}
 </span>
 </div>
 <div className="text-[11px] font-mono text-muted-foreground">
 states: {JSON.parse(t.statesJson).join(' → ')}
 </div>
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 <RelatedPhases links={[link('phase2', 'Tracce da piano', 'Le esecuzioni dei piani DynAMO generano tracce da validare'), link('phase8', 'Verifica formale', 'Le tracce valide possono essere certificate formalmente'), link('phase12', 'Confronta con rubric', 'Le tracce Pass/Fail allineano con la rubric tree'), link('phase9', 'Audit esecuzione', 'Le esecuzioni validate diventano voci Audit Ledger')]} />

 </div>
 )
}

function StatCard({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4">
 <div className="text-muted-foreground text-xs mb-1">{label}</div>
 <div className={cn('text-2xl font-bold font-mono', highlight && 'text-status-ok')}>{value}</div>
 </CardContent>
 </Card>
 )
}
