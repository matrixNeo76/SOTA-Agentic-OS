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
 FunctionSquare, RefreshCw, FileCode, CheckCircle2, XCircle, AlertTriangle,
 Sparkles, History, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'
import { LeanWorkflowVisualizer } from './dag-visualizers'

type Plan = { id: string; taskGoal: string; status: string; agentCount: number }
type Workflow = {
 id: string; planId: string; verified: boolean; deployed: boolean; version: number;
 leanSource: string; createdAt: string
}
type EvolveEvent = {
 id: string; planId: string; failedTaskId: string; failureReason: string;
 leanFeedback: string; rewrittenInstruction: string; revalidated: boolean; cycle: number;
 createdAt: string
}

export function Phase8() {
 const [plans, setPlans] = useState<Plan[]>([])
 const [stats, setStats] = useState<any>(null)
 const [workflows, setWorkflows] = useState<Workflow[]>([])
 const [evolveEvents, setEvolveEvents] = useState<EvolveEvent[]>([])
 const [selectedPlan, setSelectedPlan] = useState('')
 const [verification, setVerification] = useState<any>(null)
 const [verifying, setVerifying] = useState(false)
 const [generating, setGenerating] = useState(false)
 const [evolving, setEvolving] = useState(false)
 const [failedTaskId, setFailedTaskId] = useState('T1')
 const [failureReason, setFailureReason] = useState('timeout su dipendenza esterna')

 const refresh = async () => {
 const [plansR, statsR, wfR, evR] = await Promise.all([
 fetch('/api/plan').then((r) => r.json()),
 fetch('/api/lean?action=stats').then((r) => r.json()),
 fetch('/api/lean?action=workflows').then((r) => r.json()),
 fetch('/api/lean?action=evolve_events').then((r) => r.json()),
 ])
 setPlans(plansR.plans || [])
 setStats(statsR)
 setWorkflows(wfR.workflows || [])
 setEvolveEvents(evR.events || [])
 if (!selectedPlan && (plansR.plans || []).length > 0) {
 setSelectedPlan(plansR.plans[0].id)
 }
 }

 useEffect(() => { void refresh() }, [])

 const generateContracts = async () => {
 if (!selectedPlan) {
 toast.error('Seleziona un piano prima')
 return
 }
 setGenerating(true)
 try {
 const r = await fetch('/api/lean', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'auto_contracts', planId: selectedPlan }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`${d.count} contratti formali generati`)
 refresh()
 } else toast.error(d.error)
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setGenerating(false)
 }
 }

 const verify = async () => {
 if (!selectedPlan) return
 setVerifying(true)
 setVerification(null)
 try {
 const r = await fetch('/api/lean', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'verify', planId: selectedPlan }),
 })
 const d = await r.json()
 if (d.ok) {
 setVerification(d)
 if (d.verified) toast.success('Workflow verificato formalmente ✓')
 else toast.warning(`Verifica fallita: ${d.results.reduce((s: number, r: any) => s + r.errors.length, 0)} errori`)
 refresh()
 } else toast.error(d.error)
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setVerifying(false)
 }
 }

 const evolve = async () => {
 if (!selectedPlan) return
 setEvolving(true)
 try {
 const r = await fetch('/api/lean', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'evolve',
 planId: selectedPlan,
 failedTaskId,
 failureReason,
 }),
 })
 const d = await r.json()
 if (d.ok) {
 if (d.revalidated) toast.success(`LeanEvolve ciclo ${d.cycle}: riscritta istruzione, ri-verificata OK`)
 else toast.warning(`LeanEvolve ciclo ${d.cycle}: riscritta ma non ancora validata`)
 refresh()
 } else toast.error(d.error)
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setEvolving(false)
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase8" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <StatCard label="Contratti" value={stats.contracts} />
 <StatCard label="Verificati" value={stats.verifiedContracts} highlight />
 <StatCard label="Workflow verificati" value={stats.verifiedWorkflows} />
 <StatCard label="LeanEvolve success" value={`${stats.successfulEvolve}/${stats.evolveEvents}`} />
 </div>
 )}

 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Seleziona Piano DynAMO</CardTitle>
 <CardDescription>Scegli un piano generato dalla Fase 2 per verificare formalmente i suoi task</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="flex gap-2 flex-wrap">
 {plans.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">
 Nessun piano disponibile. Genera un piano nella Fase 2 prima.
 </p>
 ) : (
 plans.map((p) => (
 <button
 key={p.id}
 onClick={() => setSelectedPlan(p.id)}
 className={cn(
 'text-xs border rounded-md px-3 py-2 text-left transition-colors',
 selectedPlan === p.id
 ? 'border-primary bg-primary/10'
 : 'hover:bg-muted/50'
 )}
 >
 <div className="font-medium truncate max-w-xs">{p.taskGoal}</div>
 <div className="text-[10px] text-muted-foreground mt-0.5">
 {p.status} · {p.agentCount} agenti · {p.id.slice(-8)}
 </div>
 </button>
 ))
 )}
 </div>
 </CardContent>
 </Card>

 <Tabs defaultValue="verify" className="w-full">
 <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full">
 <TabsTrigger value="verify"><CheckCircle2 className="size-3.5 mr-1.5" /> Verifica</TabsTrigger>
 <TabsTrigger value="graph">Grafo</TabsTrigger>
 <TabsTrigger value="lean"><FileCode className="size-3.5 mr-1.5" /> Sorgente Lean4</TabsTrigger>
 <TabsTrigger value="evolve"><Sparkles className="size-3.5 mr-1.5" /> LeanEvolve</TabsTrigger>
 <TabsTrigger value="history"><History className="size-3.5 mr-1.5" /> Storico</TabsTrigger>
 </TabsList>

 <TabsContent value="verify" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Pipeline di Verifica Formale</CardTitle>
 <CardDescription>
 1. Auto-genera contratti (pre/post conditions) dai task del piano<br/>
 2. Verifica simbolica: type consistency, dependency closure, postcondition ben formata
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="flex gap-2">
 <Button size="sm" onClick={generateContracts} disabled={generating || !selectedPlan}>
 {generating ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <FileCode className="size-3.5 mr-1.5" />}
 {generating ? 'Generazione…' : '1. Auto-genera Contratti'}
 </Button>
 <Button size="sm" onClick={verify} disabled={verifying || !selectedPlan}>
 {verifying ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1.5" />}
 {verifying ? 'Verifica…' : '2. Verifica Workflow'}
 </Button>
 </div>

 {verification && (
 <div className="space-y-3">
 <div className={cn(
 'border rounded-md p-3',
 verification.verified
 ? 'border-status-ok bg-status-ok'
 : 'border-status-danger bg-status-danger'
 )}>
 <div className="flex items-center gap-2 mb-2">
 {verification.verified
 ? <CheckCircle2 className="size-5 text-status-ok" />
 : <XCircle className="size-5 text-status-danger" />}
 <Badge variant="outline" className={verification.verified ? ' dark:text-status-ok' : 'text-status-danger'}>
 {verification.verified ? 'VERIFICATO' : 'FALLITO'}
 </Badge>
 <span className="text-xs text-muted-foreground">
 Workflow ID: {verification.workflowId.slice(-8)}
 </span>
 </div>
 </div>

 <div className="space-y-2">
 {verification.results.map((r: any) => (
 <div key={r.taskId} className={cn(
 'text-xs border rounded-md p-2',
 r.verified ? 'border-status-ok' : 'border-status-danger'
 )}>
 <div className="flex items-center gap-2 mb-1">
 {r.verified
 ? <CheckCircle2 className="size-3.5 text-status-ok" />
 : <XCircle className="size-3.5 text-status-danger" />}
 <Badge variant="outline" className="font-mono text-[10px]">{r.taskId}</Badge>
 {r.warnings.length > 0 && (
 <Badge variant="secondary" className="text-[10px] bg-status-warn">
 <AlertTriangle className="size-2.5 mr-1" />{r.warnings.length} warn
 </Badge>
 )}
 {r.errors.length > 0 && (
 <Badge variant="secondary" className="text-[10px] bg-status-danger">
 {r.errors.length} errori
 </Badge>
 )}
 </div>
 {r.errors.length > 0 && (
 <ul className="text-[11px] text-status-danger pl-4 list-disc">
 {r.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
 </ul>
 )}
 {r.warnings.length > 0 && (
 <ul className="text-[11px] text-status-warn pl-4 list-disc mt-1">
 {r.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
 </ul>
 )}
 </div>
 ))}
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="graph" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Grafo Workflow Formale</CardTitle>
 <CardDescription>Visualizzazione React Flow dei contratti Lean4 con pre/post conditions</CardDescription>
 </CardHeader>
 <CardContent>
 {verification?.results ? (
 <LeanWorkflowVisualizer
 contracts={verification.results.map((r: any) => ({
 taskId: r.taskId,
 verified: r.verified,
 preconditions: r.warnings || [],
 postconditions: r.errors || [],
 }))}
 dependencies={{}}
 />
 ) : (
 <div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
 Esegui la verifica formale nel tab "Verifica" per visualizzare il grafo del workflow.
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="lean" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Sorgente Lean4 Auto-generato</CardTitle>
 <CardDescription>
 Pseudo-Lean4 emulato. In produzione: integrare runtime Lean4 per verifica reale.
 </CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-96 pr-2">
 <pre className="text-[11px] font-mono bg-zinc-950 text-zinc-100 rounded-md p-3 overflow-auto">
{verification?.leanSource || '// Esegui la verifica per generare il sorgente Lean4'}
 </pre>
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="evolve" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">LeanEvolve — Recovery da Failure</CardTitle>
 <CardDescription>
 Quando un task fallisce, localizza il nodo problematico usando il feedback formale,
 riscrive l'istruzione via LLM e ri-valida prima del deploy.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Task ID fallito</Label>
 <Input value={failedTaskId} onChange={(e) => setFailedTaskId(e.target.value)} placeholder="T1" />
 </div>
 <div>
 <Label className="text-xs">Motivo del fallimento</Label>
 <Input value={failureReason} onChange={(e) => setFailureReason(e.target.value)} />
 </div>
 </div>
 <Button size="sm" onClick={evolve} disabled={evolving || !selectedPlan}>
 {evolving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
 {evolving ? 'Evoluzione…' : 'Esegui LeanEvolve'}
 </Button>
 </CardContent>
 </Card>

 {evolveEvents.length > 0 && (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Eventi LeanEvolve</CardTitle>
 <CardDescription>{evolveEvents.length} eventi totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-64 pr-2">
 <ul className="space-y-2">
 {evolveEvents.map((e) => (
 <li key={e.id} className="text-xs border rounded-md p-2.5">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="text-[10px] font-mono">cycle {e.cycle}</Badge>
 <Badge variant="outline" className="text-[10px]">{e.failedTaskId}</Badge>
 {e.revalidated
 ? <Badge variant="secondary" className="text-[10px] bg-status-ok">re-verified</Badge>
 : <Badge variant="secondary" className="text-[10px] bg-status-warn">pending</Badge>}
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(e.createdAt).toLocaleString('it-IT')}
 </span>
 </div>
 <div className="text-[11px] text-muted-foreground mb-1">
 Failure: {e.failureReason}
 </div>
 <div className="text-[11px] italic">
 New: "{e.rewrittenInstruction.slice(0, 100)}..."
 </div>
 </li>
 ))}
 </ul>
 </ScrollArea>
 </CardContent>
 </Card>
 )}
 </TabsContent>

 <TabsContent value="history" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Workflow Verificati</CardTitle>
 <CardDescription>{workflows.length} snapshot totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-64 pr-2">
 {workflows.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessun workflow verificato.</p>
 ) : (
 <ul className="space-y-1.5">
 {workflows.map((w) => (
 <li key={w.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border">
 {w.verified
 ? <CheckCircle2 className="size-3.5 text-status-ok" />
 : <XCircle className="size-3.5 text-status-danger" />}
 <Badge variant="outline" className="text-[10px] font-mono">v{w.version}</Badge>
 <span className="font-mono text-[10px] text-muted-foreground">{w.planId.slice(-12)}</span>
 {w.deployed && <Badge variant="secondary" className="text-[10px] bg-status-ok">deployed</Badge>}
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(w.createdAt).toLocaleString('it-IT')}
 </span>
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 <RelatedPhases links={[link('phase2', 'Verifica piano DynAMO', 'I contratti formali derivano dal DAG della Fase 2'), link('phase5', 'LeanEvolve → ERL', 'Dopo evolve, rifletti sull\'esperienza di recovery'), link('phase7', 'Valida post-evolve', 'Dopo LeanEvolve, valida l\'esecuzione con dominator trees'), link('phase4', 'Verifica runtime LTL', 'Lean4 pre-execution + LTL runtime formano trust stratificato')]} />

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
