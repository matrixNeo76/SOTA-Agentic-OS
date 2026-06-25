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
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
 Shuffle, RefreshCw, Play, Cpu, Layers, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Decision = {
 id: string; agentId: string; inputHash: string;
 inputFeatures: string; primaryModel: string;
 confidence: number; margin: number; diversity: number;
 routedTo: string; ensembleModels: string | null;
 finalOutput: string | null; createdAt: string
}

const ROUTED_STYLE: Record<string, { color: string; bg: string; label: string }> = {
 primary: { color: 'text-status-ok', bg: 'bg-status-ok', label: 'PRIMARY' },
 ensemble: { color: 'text-status-warn', bg: 'bg-status-warn', label: 'ENSEMBLE' },
 critic: { color: 'text-cat-cognitive', bg: 'bg-cat-cognitive', label: 'CRITIC' },
}

export function Phase14() {
 const [decisions, setDecisions] = useState<Decision[]>([])
 const [stats, setStats] = useState<any>(null)
 const [features, setFeatures] = useState<any>(null)
 const [agentId, setAgentId] = useState('orchestrator')
 const [prompt, setPrompt] = useState(`Analizza questo codice JavaScript e trova i bug:

\`\`\`js
function sum(a, b) {
 return a - b; // bug: should be +
}
\`\`\`

Dimostra con un proof formale che la funzione è errata.`)

 const refresh = async () => {
 const [decR, statsR] = await Promise.all([
 fetch('/api/router?action=decisions').then((r) => r.json()),
 fetch('/api/router?action=stats').then((r) => r.json()),
 ])
 setDecisions(decR.decisions || [])
 setStats(statsR)
 }

 useEffect(() => {
 void (async () => { await refresh() })()
 // Also compute features live as user types
 const t = setTimeout(async () => {
 const r = await fetch(`/api/router?action=features&prompt=${encodeURIComponent(prompt)}`)
 const d = await r.json()
 setFeatures(d.features)
 }, 400)
 return () => clearTimeout(t)
 }, [prompt])

 const route = async () => {
 const r = await fetch('/api/router', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'route', agentId, prompt }),
 })
 const d = await r.json()
 if (d.ok) {
 const style = ROUTED_STYLE[d.routedTo] || ROUTED_STYLE.primary
 if (d.routedTo === 'primary') toast.success(`Routed to PRIMARY: ${d.primaryModel} (conf=${d.confidence.toFixed(2)})`)
 else toast.warning(`Routed to ${style.label}: ${d.ensembleModels?.join(', ')}`)
 refresh()
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase14" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
 <StatCard label="Decisioni" value={stats.decisions} />
 <StatCard label="Primary" value={stats.primary} highlight />
 <StatCard label="Ensemble" value={stats.ensemble} warn={stats.ensemble > 0} />
 <StatCard label="Critic" value={stats.critic} warn={stats.critic > 0} />
 <StatCard label="Top model" value={stats.topModel.slice(0, 12)} small />
 </div>
 )}

 <Tabs defaultValue="route" className="w-full">
 <TabsList className="grid grid-cols-2 w-full">
 <TabsTrigger value="route"><Play className="size-3.5 mr-1.5" /> Route Prompt</TabsTrigger>
 <TabsTrigger value="history">Storico Decisioni</TabsTrigger>
 </TabsList>

 <TabsContent value="route" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Route Prompt</CardTitle>
 <CardDescription>
 Feature extraction → score modelli → Gate Selettivo → Primary/Ensemble/Critic
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <Label className="text-xs">Agent ID</Label>
 <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Prompt</Label>
 <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="font-mono text-xs" />
 </div>

 {features && (
 <div className="border rounded-md p-3 bg-muted/20">
 <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
 <Cpu className="size-3" /> Feature Estratte
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
 <Feat label="Domain" value={features.domain} />
 <Feat label="Length" value={features.length} />
 <Feat label="Tokens" value={features.tokenEstimate} />
 <Feat label="Complexity" value={features.complexity.toFixed(2)} />
 <Feat label="hasCode" value={features.hasCode ? '✓' : '✗'} />
 <Feat label="hasMath" value={features.hasMath ? '✓' : '✗'} />
 <Feat label="hasLogic" value={features.hasLogic ? '✓' : '✗'} />
 </div>
 <div className="mt-2">
 <div className="flex justify-between text-[10px] mb-0.5">
 <span className="text-muted-foreground">Complessità</span>
 <span className="font-mono">{(features.complexity * 100).toFixed(0)}%</span>
 </div>
 <Progress value={features.complexity * 100} className="h-1.5" />
 </div>
 </div>
 )}

 <Button size="sm" onClick={route}>
 <Play className="size-3.5 mr-1.5" /> Route
 </Button>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="history" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Storico Routing</CardTitle>
 <CardDescription>{decisions.length} decisioni totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-96 pr-2">
 {decisions.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessuna decisione. Route un prompt.</p>
 ) : (
 <ul className="space-y-2">
 {decisions.map((d) => {
 const style = ROUTED_STYLE[d.routedTo] || ROUTED_STYLE.primary
 const ensembleModels = d.ensembleModels ? JSON.parse(d.ensembleModels) : []
 return (
 <li key={d.id} className={cn('text-xs border rounded-md p-2.5', style.bg)}>
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="text-[10px] font-mono">{d.agentId}</Badge>
 <Badge variant="secondary" className={cn('text-[10px]', style.color)}>{style.label}</Badge>
 {d.routedTo === 'primary' && (
 <Badge variant="outline" className="text-[10px] font-mono">{d.primaryModel}</Badge>
 )}
 {ensembleModels.length > 0 && (
 <div className="flex gap-1">
 {ensembleModels.map((m: string) => (
 <Badge key={m} variant="outline" className="text-[9px] py-0 font-mono">{m}</Badge>
 ))}
 </div>
 )}
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(d.createdAt).toLocaleTimeString('it-IT')}
 </span>
 </div>
 <div className="grid grid-cols-3 gap-2 text-[10px]">
 <div>
 <span className="text-muted-foreground">conf:</span> <span className="font-mono">{d.confidence.toFixed(2)}</span>
 </div>
 <div>
 <span className="text-muted-foreground">margin:</span> <span className="font-mono">{d.margin.toFixed(2)}</span>
 </div>
 <div>
 <span className="text-muted-foreground">diversity:</span> <span className="font-mono">{d.diversity.toFixed(2)}</span>
 </div>
 </div>
 {d.finalOutput && (
 <div className="text-[10px] text-muted-foreground mt-1 italic truncate">
 → {d.finalOutput.slice(0, 100)}...
 </div>
 )}
 </li>
 )
 })}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 <RelatedPhases links={[link('phase10', 'Encapsulator consumer', 'Il Model Encapsulator usa il modello scelto dal router'), link('phase3', 'Steering model choice', 'Le strategie ACTS possono usare modelli diversi'), link('phase11', 'Affect influences routing', 'Disperazione alta può forzare ensemble (più cautela)'), link('phase4', 'Safety routing', 'Modelli per task sensibili sono validati da LTL/Taint')]} />

 </div>
 )
}

function StatCard({ label, value, highlight, warn, small }: { label: string; value: number | string; highlight?: boolean; warn?: boolean; small?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4">
 <div className="text-muted-foreground text-xs mb-1">{label}</div>
 <div className={cn('font-bold font-mono', small ? 'text-sm' : 'text-2xl', highlight && 'text-status-ok', warn && 'text-status-warn')}>{value}</div>
 </CardContent>
 </Card>
 )
}

function Feat({ label, value }: { label: string; value: any }) {
 return (
 <div className="bg-muted/30 rounded p-1.5">
 <div className="text-[9px] text-muted-foreground uppercase">{label}</div>
 <div className="font-mono font-medium">{String(value)}</div>
 </div>
 )
}
