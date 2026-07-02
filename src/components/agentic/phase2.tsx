'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
 Workflow, Sparkles, RefreshCw, Loader2, GitBranch, ArrowRight, CheckCircle2,
 ShieldCheck, FileCode, Code2, Rocket, Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'
import { DynAMODagVisualizer } from './dag-visualizers'

type TaskSpec = { taskId: string; agentId: string; description: string; dependencies: string[] }
type Plan = { goal: string; tasks: TaskSpec[] }

const AGENT_COLORS: Record<string, string> = {
 orchestrator: 'bg-status-ok',
 curator: 'bg-status-info',
 controller: 'bg-cat-cognitive',
 verifier: 'bg-status-warn',
 reflective: 'bg-cat-governance',
}

export function Phase2() {
 const [goal, setGoal] = useState('Analizza le metriche di vendita Q3 e producimi un report esecutivo')
 const [generating, setGenerating] = useState(false)
 const [plan, setPlan] = useState<Plan | null>(null)
 const [batches, setBatches] = useState<string[][]>([])
 const [plans, setPlans] = useState<any[]>([])
 const [templates, setTemplates] = useState<any[]>([])
 const [artifacts, setArtifacts] = useState<any[]>([])
 const [selTemplate, setSelTemplate] = useState('compliance_check')
 const [requirement, setRequirement] = useState('Verifica che input.status sia "approved" e input.signature non sia null')
 const [compiling, setCompiling] = useState(false)
 const [lastResult, setLastResult] = useState<any>(null)

 const refreshAll = async () => {
 const [planR, compR] = await Promise.all([
 fetch('/api/plan').then((r) => r.json()),
 fetch('/api/compiled').then((r) => r.json()),
 ])
 setPlans(planR.plans || [])
 setTemplates(compR.templates || [])
 setArtifacts(compR.artifacts || [])
 }

 useEffect(() => {
   void refreshAll()
   // G1: adaptive polling with Page Visibility API
   const interval = setInterval(() => {
     if (!document.hidden) void refreshAll()
   }, 30_000) // 30s when visible
   return () => clearInterval(interval)
 }, [])

 const generatePlan = async () => {
 setGenerating(true)
 setPlan(null); setBatches([])
 try {
 const r = await fetch('/api/plan', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ mode: 'generate', goal }),
 })
 const d = await r.json()
 if (d.ok) {
 setPlan(d.plan)
 setBatches(d.batches)
 toast.success(`Piano generato: ${d.plan.tasks.length} task in ${d.batches.length} batch`)
 refreshAll()
 } else {
 toast.error(d.error || 'Generazione fallita')
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setGenerating(false)
 }
 }

 const generateCode = async () => {
 setCompiling(true)
 setLastResult(null)
 try {
 const r = await fetch('/api/compiled', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ mode: 'generate', templateId: selTemplate, requirement }),
 })
 const d = await r.json()
 if (d.ok) {
 setLastResult(d)
 if (d.deployed) toast.success('Artefatto validato e deployato!')
 else toast.warning('Codice generato ma non deployato (validazione fallita)')
 refreshAll()
 } else {
 toast.error(d.error || 'Compilazione fallita')
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setCompiling(false)
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase2" action={<Button variant="outline" size="sm" onClick={refreshAll}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 <Tabs defaultValue="plan" className="w-full">
 <TabsList className="grid grid-cols-3 w-full">
 <TabsTrigger value="plan"><GitBranch className="size-3.5 mr-1.5" /> DynAMO Planner</TabsTrigger>
 <TabsTrigger value="graph">Grafo DAG</TabsTrigger>
 <TabsTrigger value="compiled"><Code2 className="size-3.5 mr-1.5" /> Compiled AI</TabsTrigger>
 </TabsList>

 <TabsContent value="plan" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Genera Piano Strutturato</CardTitle>
 <CardDescription>
 L'LLM è forzato a produrre JSON-Schema-validato. Validazione aciclicità + dipendenze, conversione in DAG.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <Label className="text-xs">Obiettivo del task</Label>
 <Textarea
 value={goal}
 onChange={(e) => setGoal(e.target.value)}
 rows={2}
 placeholder="Es: Pianifica il deploy di un nuovo microservizio"
 />
 </div>
 <Button size="sm" onClick={generatePlan} disabled={generating || !goal.trim()}>
 {generating ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
 {generating ? 'Generazione…' : 'Genera Piano via LLM'}
 </Button>
 </CardContent>
 </Card>

 {plan && (
 <div className="grid lg:grid-cols-2 gap-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Piano JSON Validato</CardTitle>
 <CardDescription>{plan.tasks.length} task · {new Set(plan.tasks.map((t) => t.agentId)).size} agenti</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-80 pr-2">
 <div className="space-y-2">
 {plan.tasks.map((t) => (
 <div key={t.taskId} className="text-xs border rounded-md p-2.5">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="secondary" className="font-mono">{t.taskId}</Badge>
 <span className={cn('size-2 rounded-full', AGENT_COLORS[t.agentId] || 'bg-muted-foreground/40')} />
 <span className="font-mono text-[10px] text-muted-foreground">{t.agentId}</span>
 </div>
 <p className="text-xs">{t.description}</p>
 {t.dependencies.length > 0 && (
 <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
 <ArrowRight className="size-3" />
 dipende: {t.dependencies.join(', ')}
 </div>
 )}
 </div>
 ))}
 </div>
 </ScrollArea>
 </CardContent>
 </Card>

 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Schedulazione Topologica</CardTitle>
 <CardDescription>{batches.length} batch paralleli</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 {batches.map((batch, i) => (
 <div key={i} className="border-l-2 border-primary/40 pl-3">
 <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
 <Badge variant="outline">Batch {i + 1}</Badge>
 <span className="text-[10px] text-muted-foreground">{batch.length} task in parallelo</span>
 </div>
 <div className="flex flex-wrap gap-1.5">
 {batch.map((tid) => {
 const task = plan.tasks.find((t) => t.taskId === tid)
 return (
 <Badge key={tid} variant="secondary" className="text-[10px]">
 <span className={cn('size-1.5 rounded-full mr-1', AGENT_COLORS[task?.agentId || ''] || 'bg-muted-foreground/40')} />
 {tid}
 </Badge>
 )
 })}
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 </div>
 )}

 {plans.length > 0 && (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Piani Storici</CardTitle>
 <CardDescription>{plans.length} piani totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-48 pr-2">
 <ul className="space-y-1.5">
 {plans.map((p) => (
 <li key={p.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50">
 <Badge variant="outline" className="text-[10px] py-0">{p.status}</Badge>
 <span className="flex-1 truncate">{p.taskGoal}</span>
 <span className="text-[10px] text-muted-foreground">{p.agentCount} agenti</span>
 </li>
 ))}
 </ul>
 </ScrollArea>
 </CardContent>
 </Card>
 )}
 </TabsContent>

 <TabsContent value="graph" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Grafo DAG Interattivo</CardTitle>
 <CardDescription>Visualizzazione React Flow del piano generato · batch paralleli, dipendenze, stati task</CardDescription>
 </CardHeader>
 <CardContent>
 {plan ? (
 <DynAMODagVisualizer tasks={plan.tasks} batches={batches} />
 ) : (
 <div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
 Genera un piano nel tab "DynAMO Planner" per visualizzare il grafo DAG interattivo.
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="compiled" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Compila Codice via LLM</CardTitle>
 <CardDescription>
 Genera codice dentro un template pre-validato, poi passalo nei 4 stadi: Safety → Syntax → Execution → Accuracy.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Template</Label>
 <Select value={selTemplate} onValueChange={setSelTemplate}>
 <SelectTrigger><SelectValue /></SelectTrigger>
 <SelectContent>
 {templates.map((t) => (
 <SelectItem key={t.templateId} value={t.templateId}>
 {t.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div>
 <Label className="text-xs">Requisito</Label>
 <Input value={requirement} onChange={(e) => setRequirement(e.target.value)} />
 </div>
 </div>
 <Button size="sm" onClick={generateCode} disabled={compiling || !requirement.trim()}>
 {compiling ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Code2 className="size-3.5 mr-1.5" />}
 {compiling ? 'Compilazione…' : 'Genera e Valida'}
 </Button>
 </CardContent>
 </Card>

 {lastResult && (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2">
 {lastResult.deployed ? <Rocket className="size-4 text-status-ok" /> : <ShieldCheck className="size-4 text-status-warn" />}
 Pipeline Result {lastResult.deployed && <Badge variant="default" className="text-[10px]">DEPLOYED</Badge>}
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <div className="text-xs font-mono mb-1 text-muted-foreground">Codice generato:</div>
 <pre className="text-[11px] font-mono bg-muted text-foreground rounded-md p-3 overflow-auto border">
{`(input) => {
${lastResult.code.split('\n').map((l: string) => ' ' + l).join('\n')}
}`}
 </pre>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 {lastResult.results.map((r: any, i: number) => {
 const stages = ['Safety', 'Syntax', 'Execution', 'Accuracy']
 const icons = [ShieldCheck, FileCode, Code2, CheckCircle2]
 const Icon = icons[i]
 return (
 <div key={i} className={cn(
 'border rounded-md p-2 text-center',
 r.passed ? 'border-status-ok bg-status-ok' : 'border-status-danger bg-status-danger'
 )}>
 <Icon className={cn('size-4 mx-auto mb-1', r.passed ? 'text-status-ok' : 'text-status-danger')} />
 <div className="text-xs font-medium">{stages[i]}</div>
 <div className="text-[10px] text-muted-foreground mt-0.5">{r.passed ? 'PASS' : 'FAIL'}</div>
 </div>
 )
 })}
 </div>
 <div className="text-xs space-y-1">
 {lastResult.results.map((r: any, i: number) => (
 <div key={i} className="flex items-start gap-2">
 <Badge variant="outline" className="text-[10px] py-0 font-mono">{r.stage}</Badge>
 <span className={r.passed ? 'text-status-ok' : 'text-status-danger'}>
 {r.reason}
 </span>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 {artifacts.length > 0 && (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Artefatti Compilati</CardTitle>
 <CardDescription>{artifacts.length} artefatti totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-48 pr-2">
 <ul className="space-y-1.5">
 {artifacts.map((a) => (
 <li key={a.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border">
 {a.deployed ? <Rocket className="size-3.5 text-status-ok" /> : <Layers className="size-3.5 text-muted-foreground" />}
 <span className="font-mono flex-1 truncate">{a.name}</span>
 <Badge variant="outline" className="text-[10px] py-0">
 {a.validationSafety ? '✓' : '✗'} S
 </Badge>
 <Badge variant="outline" className="text-[10px] py-0">
 {a.validationSyntax ? '✓' : '✗'} Y
 </Badge>
 <Badge variant="outline" className="text-[10px] py-0">
 {a.validationExec ? '✓' : '✗'} E
 </Badge>
 <Badge variant="outline" className="text-[10px] py-0">
 {a.validationAcc ? '✓' : '✗'} A
 </Badge>
 </li>
 ))}
 </ul>
 </ScrollArea>
 </CardContent>
 </Card>
 )}
 </TabsContent>
 </Tabs>
 <RelatedPhases links={[link('phase8', 'Verifica formalmente', 'Traduci il DAG in contratti Lean4 e verifica pre/post conditions'), link('phase7', 'Valida traccia', 'Confronta l\'esecuzione del piano con tracce PTA'), link('phase5', 'Rifletti su esito', 'Dopo il piano, estrai euristiche dall\'esperienza'), link('phase9', 'Richiedi approvazione', 'Azioni del piano irreversibili richiedono HITL gate')]} />

 </div>
 )
}
