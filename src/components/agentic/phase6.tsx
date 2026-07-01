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
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
 Scissors, RefreshCw, Plus, FileStack, BookOpen, Search, Coins, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type ToolCall = {
 id: string
 toolName: string
 callPayload: unknown
 responsePayload: unknown
 tokenCost: number
 createdAt: string
}

type Context = {
 summary: { narrative: string; cycleId: number; coveredCount: number } | null
 recentCalls: ToolCall[]
 totalTokenCost: number
}

type Stats = {
 activeCalls: number
 evictedCalls: number
 summaries: number
 totalTokensSaved: number
}

export function Phase6() {
 const [context, setContext] = useState<Context | null>(null)
 const [stats, setStats] = useState<Stats | null>(null)
 const [agentId, setAgentId] = useState('orchestrator')
 const [toolName, setToolName] = useState('search_api')
 const [callPayload, setCallPayload] = useState('{"q":"test query"}')
 const [responsePayload, setResponsePayload] = useState('{"results":[1,2,3],"count":3}')
 const [tokenCost, setTokenCost] = useState(150)
 const [windowSize, setWindowSize] = useState(5)
 const [threshold, setThreshold] = useState(10)
 const [autoSummarize, setAutoSummarize] = useState(true)
 const [searchQuery, setSearchQuery] = useState('')
 const [searchResults, setSearchResults] = useState<any[]>([])

 const refresh = async () => {
 const [ctxR, statsR] = await Promise.all([
 fetch(`/api/context?action=assemble&agentId=${agentId}`).then((r) => r.json()),
 fetch('/api/context?action=stats').then((r) => r.json()),
 ])
 setContext(ctxR)
 setStats(statsR)
 }

 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(() => {
   void refresh()
   // B7: adaptive polling with Page Visibility API
   const interval = setInterval(() => {
     if (!document.hidden) void refresh()
   }, 30_000) // 30s when visible
   return () => clearInterval(interval)
 }, [agentId])

 const recordCall = async () => {
 let callP: unknown, respP: unknown
 try { callP = JSON.parse(callPayload) } catch { toast.error('callPayload non è JSON valido'); return }
 try { respP = JSON.parse(responsePayload) } catch { toast.error('responsePayload non è JSON valido'); return }
 const r = await fetch('/api/context', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'record_tool_call',
 agentId, toolName, callPayload: callP, responsePayload: respP, tokenCost,
 }),
 })
 const d = await r.json()
 if (d.ok) {
 if (d.evicted > 0) {
 toast.success(`${d.evicted} tool call evicted e riassunti (token risparmiati)`)
 } else {
 toast.success('Tool call registrato')
 }
 refresh()
 } else toast.error(d.error)
 }

 const forceSummarize = async () => {
 const r = await fetch('/api/context', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'summarize_now', agentId, windowSize }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Summarization: ${d.evictedCount} evicted, ${d.tokenSaved} token salvati`)
 refresh()
 }
 }

 const updatePolicy = async () => {
 const r = await fetch('/api/context', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'update_policy',
 agentId, windowSize, summarizeThreshold: threshold, autoSummarize,
 }),
 })
 const d = await r.json()
 if (d.ok) toast.success('Policy aggiornata')
 }

 const searchHistory = async () => {
 const r = await fetch(`/api/context?action=search&agentId=${agentId}&q=${encodeURIComponent(searchQuery)}`)
 const d = await r.json()
 setSearchResults(d.results || [])
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase6" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <StatCard label="Active calls" value={stats.activeCalls} />
 <StatCard label="Evicted calls" value={stats.evictedCalls} />
 <StatCard label="Summaries" value={stats.summaries} />
 <StatCard label="Token salvati" value={stats.totalTokensSaved} icon={Coins} highlight />
 </div>
 )}

 <Tabs defaultValue="working" className="w-full">
 <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
 <TabsTrigger value="working"><FileStack className="size-3.5 mr-1.5" /> Working Context</TabsTrigger>
 <TabsTrigger value="record"><Plus className="size-3.5 mr-1.5" /> Registra</TabsTrigger>
 <TabsTrigger value="policy">Policy</TabsTrigger>
 <TabsTrigger value="search"><Search className="size-3.5 mr-1.5" /> RAG Storico</TabsTrigger>
 </TabsList>

 <TabsContent value="working" className="space-y-4 mt-4">
 {context?.summary && (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2">
 <BookOpen className="size-4" /> Summary (Contesto Compatto)
 </CardTitle>
 <CardDescription>
 Ciclo #{context.summary.cycleId} · {context.summary.coveredCount} tool call riassunti
 </CardDescription>
 </CardHeader>
 <CardContent>
 <pre className="text-[11px] font-mono bg-muted/50 rounded-md p-3 max-h-64 overflow-auto whitespace-pre-wrap">
{context.summary.narrative}
 </pre>
 </CardContent>
 </Card>
 )}

 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2">
 <FileStack className="size-4" /> Ultime N coppie Tool Call/Response
 </CardTitle>
 <CardDescription>
 Ring buffer attivo · {context?.recentCalls.length || 0} entry · costo totale {context?.totalTokenCost || 0} token
 </CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-80 pr-2">
 {(context?.recentCalls || []).length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessun tool call nel ring buffer.</p>
 ) : (
 <ul className="space-y-2">
 {(context?.recentCalls || []).map((c) => (
 <li key={c.id} className="text-xs border rounded-md p-2.5">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="font-mono text-[10px]">{c.toolName}</Badge>
 <Badge variant="secondary" className="text-[10px]">{c.tokenCost} tok</Badge>
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(c.createdAt).toLocaleTimeString('it-IT')}
 </span>
 </div>
 <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
 <div>
 <span className="text-muted-foreground">CALL:</span>
 <pre className="bg-muted/30 rounded p-1 mt-0.5 max-h-20 overflow-auto">{JSON.stringify(c.callPayload, null, 2)}</pre>
 </div>
 <div>
 <span className="text-muted-foreground">RESP:</span>
 <pre className="bg-muted/30 rounded p-1 mt-0.5 max-h-20 overflow-auto">{JSON.stringify(c.responsePayload, null, 2)}</pre>
 </div>
 </div>
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>

 <Button size="sm" variant="outline" onClick={forceSummarize}>
 <Scissors className="size-3.5 mr-1.5" /> Forza Summarization ora
 </Button>
 </TabsContent>

 <TabsContent value="record" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Registra Tool Call</CardTitle>
 <CardDescription>Simula l\'esecuzione di un tool da parte di un agente</CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Agent ID</Label>
 <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Tool name</Label>
 <Input value={toolName} onChange={(e) => setToolName(e.target.value)} />
 </div>
 </div>
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Call payload (JSON)</Label>
 <Textarea value={callPayload} onChange={(e) => setCallPayload(e.target.value)} rows={3} className="font-mono text-xs" />
 </div>
 <div>
 <Label className="text-xs">Response payload (JSON)</Label>
 <Textarea value={responsePayload} onChange={(e) => setResponsePayload(e.target.value)} rows={3} className="font-mono text-xs" />
 </div>
 </div>
 <div className="flex items-end gap-3">
 <div>
 <Label className="text-xs">Token cost</Label>
 <Input type="number" value={tokenCost} onChange={(e) => setTokenCost(Number(e.target.value))} className="w-32" />
 </div>
 <Button size="sm" onClick={recordCall}>
 <Plus className="size-3.5 mr-1.5" /> Registra
 </Button>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="policy" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Policy di Pruning</CardTitle>
 <CardDescription>Configura il comportamento del ring buffer per l\'agente</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div>
 <Label className="text-xs">Window size (N coppie recenti mantenute)</Label>
 <Input type="number" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} min={1} max={50} />
 </div>
 <div>
 <Label className="text-xs">Summarize threshold (trigger quando le entry attive superano questo numero)</Label>
 <Input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} min={1} />
 </div>
 <div className="flex items-center gap-3">
 <Switch checked={autoSummarize} onCheckedChange={setAutoSummarize} />
 <div>
 <div className="text-sm font-medium">Auto-summarize</div>
 <div className="text-xs text-muted-foreground">Genera automaticamente un riassunto quando si supera la threshold</div>
 </div>
 </div>
 <Button size="sm" onClick={updatePolicy}>
 Salva Policy per {agentId}
 </Button>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="search" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">RAG su Contesto Storico</CardTitle>
 <CardDescription>Cerca nei summary generati (narrative compresse)</CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="flex gap-2">
 <Input
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Es: search_api risultati query"
 onKeyDown={(e) => e.key === 'Enter' && searchHistory()}
 />
 <Button size="sm" onClick={searchHistory}>
 <Search className="size-3.5 mr-1.5" /> Cerca
 </Button>
 </div>
 <div className="space-y-2">
 {searchResults.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Esegui una query per cercare nei summary.</p>
 ) : (
 searchResults.map((r) => (
 <div key={r.id} className="border rounded-md p-2.5 text-xs">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="font-mono text-[10px]">
 sim {r.similarity.toFixed(3)}
 </Badge>
 <Badge variant="secondary" className="text-[10px]">cycle #{r.cycleId}</Badge>
 </div>
 <pre className="text-[10px] font-mono whitespace-pre-wrap text-muted-foreground max-h-32 overflow-auto">
{r.narrative.slice(0, 500)}{r.narrative.length > 500 ? '...' : ''}
 </pre>
 </div>
 ))
 )}
 </div>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 <RelatedPhases links={[link('phase1', 'Fonte: Sensorium', 'Il contesto riassemblato è iniettato dal Curator (Fase 1)'), link('phase10', 'Encapsulated call', 'Il working context alimenta il Model Encapsulator'), link('phase14', 'Routing basato su size', 'La lunghezza del contesto influenza il Model Router'), link('phase3', 'Steering aware', 'Le sterzate ACTS consumano contesto working memory')]} />

 </div>
 )
}

function StatCard({ label, value, icon: Icon, highlight }: { label: string; value: number | string; icon?: any; highlight?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4">
 <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
 {Icon && <Icon className={cn('size-3.5', highlight && 'text-status-ok')} />}
 {label}
 </div>
 <div className={cn('text-2xl font-bold font-mono', highlight && 'text-status-ok')}>{value}</div>
 </CardContent>
 </Card>
 )
}
