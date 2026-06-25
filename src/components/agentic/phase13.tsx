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
import { toast } from 'sonner'
import {
 Network, RefreshCw, Plus, GitBranch, CheckCircle2, XCircle, Users, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Belief = {
 id: string; agentId: string; content: string; beliefType: string;
 confidence: number; superseded: boolean; version: number; createdAt: string
}

type SyncEvent = {
 id: string; sourceAgentId: string; targetAgentId: string;
 beliefId: string; syncStatus: string; conflictReason: string | null; timestamp: string
}

type QuorumDecision = {
 id: string; workflowJoinId: string; action: string;
 requiredQuorum: number; acceptCount: number; rejectCount: number;
 verdict: string; decidedAt: string | null; createdAt: string
}

export function Phase13() {
 const [beliefs, setBeliefs] = useState<Belief[]>([])
 const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([])
 const [decisions, setDecisions] = useState<QuorumDecision[]>([])
 const [stats, setStats] = useState<any>(null)

 // Belief form
 const [bAgent, setBAgent] = useState('orchestrator')
 const [bContent, setBContent] = useState('Il deploy del servizio auth è completo e verificato')
 const [bType, setBType] = useState<'summary' | 'evidence' | 'plan' | 'observation'>('summary')

 // Sync form
 const [syncSource, setSyncSource] = useState('orchestrator')
 const [syncTarget, setSyncTarget] = useState('curator')
 const [syncBeliefId, setSyncBeliefId] = useState('')

 // Quorum form
 const [qJoin, setQJoin] = useState('join-deploy-auth')
 const [qAction, setQAction] = useState('promuovi build in produzione')
 const [qRequired, setQRequired] = useState(2)

 const refresh = async () => {
 const [bR, sR, qR, statsR] = await Promise.all([
 fetch('/api/esr?action=beliefs').then((r) => r.json()),
 fetch('/api/esr?action=sync_events').then((r) => r.json()),
 fetch('/api/esr?action=quorum_decisions').then((r) => r.json()),
 fetch('/api/esr?action=stats').then((r) => r.json()),
 ])
 setBeliefs(bR.beliefs || [])
 setSyncEvents(sR.events || [])
 setDecisions(qR.decisions || [])
 setStats(statsR)
 }

 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(() => { void refresh() }, [])

 const recordBelief = async () => {
 if (!bContent.trim()) return
 const r = await fetch('/api/esr', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'record_belief', agentId: bAgent, content: bContent, beliefType: bType }),
 })
 const d = await r.json()
 if (d.ok) {
 if (d.supersededId) toast.info('Convinzione precedente marcata come superseded')
 else toast.success('Belief registrato')
 refresh()
 }
 }

 const syncBelief = async () => {
 if (!syncBeliefId) {
 // Take first belief ID as default
 if (beliefs.length > 0) setSyncBeliefId(beliefs[0].id)
 return
 }
 const r = await fetch('/api/esr', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'sync_belief', sourceAgentId: syncSource, targetAgentId: syncTarget, beliefId: syncBeliefId }),
 })
 const d = await r.json()
 if (d.ok) {
 if (d.syncStatus === 'conflict') toast.warning(`Conflitto ESR: ${d.reason}`)
 else toast.success('Belief sincronizzato (coerenza eventuale)')
 refresh()
 }
 }

 const proposeQuorum = async () => {
 const r = await fetch('/api/esr', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'propose_quorum', workflowJoinId: qJoin, quorumAction: qAction, requiredQuorum: qRequired }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Quorum proposto (req=${qRequired})`)
 refresh()
 }
 }

 const voteQuorum = async (decisionId: string, voter: string, vote: 'accept' | 'reject') => {
 const r = await fetch('/api/esr', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'vote_quorum', decisionId, voterAgentId: voter, vote }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Voto ${vote} → verdict: ${d.verdict}`)
 refresh()
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase13" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
 <StatCard label="Beliefs" value={stats.beliefs} />
 <StatCard label="Sync events" value={stats.syncEvents} />
 <StatCard label="Conflitti" value={stats.conflicts} warn={stats.conflicts > 0} />
 <StatCard label="Quorum" value={stats.quorumDecisions} />
 <StatCard label="Accepted" value={stats.acceptedQuorum} highlight />
 </div>
 )}

 <Tabs defaultValue="beliefs" className="w-full">
 <TabsList className="grid grid-cols-3 w-full">
 <TabsTrigger value="beliefs"><Plus className="size-3.5 mr-1.5" /> Beliefs</TabsTrigger>
 <TabsTrigger value="sync"><GitBranch className="size-3.5 mr-1.5" /> ESR Sync</TabsTrigger>
 <TabsTrigger value="quorum"><Users className="size-3.5 mr-1.5" /> Quorum</TabsTrigger>
 </TabsList>

 <TabsContent value="beliefs" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Registra Belief</CardTitle>
 <CardDescription>Convinzione di un agente (riassunto, prova, piano, osservazione)</CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Agent ID</Label>
 <Input value={bAgent} onChange={(e) => setBAgent(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Tipo</Label>
 <Select value={bType} onValueChange={(v: any) => setBType(v)}>
 <SelectTrigger><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="summary">summary</SelectItem>
 <SelectItem value="evidence">evidence</SelectItem>
 <SelectItem value="plan">plan</SelectItem>
 <SelectItem value="observation">observation</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 <div>
 <Label className="text-xs">Content</Label>
 <Input value={bContent} onChange={(e) => setBContent(e.target.value)} />
 </div>
 <Button size="sm" onClick={recordBelief}>
 <Plus className="size-3.5 mr-1.5" /> Registra Belief
 </Button>
 </CardContent>
 </Card>

 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Beliefs Attivi</CardTitle>
 <CardDescription>{beliefs.length} convinzioni non superseded</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-64 pr-2">
 {beliefs.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessun belief.</p>
 ) : (
 <ul className="space-y-1.5">
 {beliefs.map((b) => (
 <li key={b.id} className="text-xs border rounded-md p-2">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="text-[10px] font-mono">{b.agentId}</Badge>
 <Badge variant="secondary" className="text-[10px]">{b.beliefType}</Badge>
 <Badge variant="outline" className="text-[10px]">v{b.version}</Badge>
 <Badge variant="outline" className="text-[10px]">conf={b.confidence.toFixed(2)}</Badge>
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(b.createdAt).toLocaleTimeString('it-IT')}
 </span>
 </div>
 <div className="text-[11px]">{b.content}</div>
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="sync" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Sincronizza Belief (ESR)</CardTitle>
 <CardDescription>Replica convinzioni tra agenti con coerenza eventuale</CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-3 gap-3">
 <div>
 <Label className="text-xs">Source agent</Label>
 <Input value={syncSource} onChange={(e) => setSyncSource(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Target agent</Label>
 <Input value={syncTarget} onChange={(e) => setSyncTarget(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Belief ID</Label>
 <Input value={syncBeliefId} onChange={(e) => setSyncBeliefId(e.target.value)} placeholder="auto: primo belief" />
 </div>
 </div>
 <Button size="sm" onClick={syncBelief}>
 <GitBranch className="size-3.5 mr-1.5" /> Sincronizza
 </Button>
 </CardContent>
 </Card>

 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Sync Events</CardTitle>
 <CardDescription>{syncEvents.length} eventi totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-64 pr-2">
 {syncEvents.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessun sync event.</p>
 ) : (
 <ul className="space-y-1.5">
 {syncEvents.map((s) => (
 <li key={s.id} className="text-xs flex items-center gap-2 border rounded-md p-2">
 {s.syncStatus === 'synced'
 ? <CheckCircle2 className="size-3.5 text-status-ok" />
 : <AlertTriangle className="size-3.5 text-status-danger" />}
 <Badge variant="outline" className="text-[10px] font-mono">{s.sourceAgentId}→{s.targetAgentId}</Badge>
 <Badge variant="secondary" className={cn('text-[10px]', s.syncStatus === 'conflict' && 'bg-status-danger')}>{s.syncStatus}</Badge>
 <span className="flex-1 truncate text-[10px] text-muted-foreground">{s.conflictReason || 'OK'}</span>
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="quorum" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Proponi Quorum</CardTitle>
 <CardDescription>Azione da certificare con N validatori indipendenti</CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-3 gap-3">
 <div>
 <Label className="text-xs">Workflow join ID</Label>
 <Input value={qJoin} onChange={(e) => setQJoin(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Action</Label>
 <Input value={qAction} onChange={(e) => setQAction(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Required quorum</Label>
 <Input type="number" value={qRequired} onChange={(e) => setQRequired(Number(e.target.value))} min={1} max={5} />
 </div>
 </div>
 <Button size="sm" onClick={proposeQuorum}>
 <Users className="size-3.5 mr-1.5" /> Proponi
 </Button>
 </CardContent>
 </Card>

 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Decisioni Quorum</CardTitle>
 <CardDescription>{decisions.length} proposte</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-72 pr-2">
 {decisions.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessuna proposta.</p>
 ) : (
 <ul className="space-y-2">
 {decisions.map((d) => (
 <li key={d.id} className="text-xs border rounded-md p-2.5">
 <div className="flex items-center gap-2 mb-1.5">
 <Badge variant="outline" className="text-[10px] font-mono">{d.workflowJoinId}</Badge>
 <Badge variant="secondary" className={cn(
 'text-[10px]',
 d.verdict === 'accepted' && 'bg-status-ok',
 d.verdict === 'rejected' && 'bg-status-danger',
 d.verdict === 'pending' && 'bg-status-warn',
 )}>{d.verdict}</Badge>
 <span className="flex-1 truncate">{d.action}</span>
 </div>
 <div className="flex items-center gap-2 text-[10px] mb-1.5">
 <span className="text-status-ok">accept: {d.acceptCount}</span>
 <span className="text-status-danger">reject: {d.rejectCount}</span>
 <span className="text-muted-foreground">required: {d.requiredQuorum}</span>
 </div>
 {d.verdict === 'pending' && (
 <div className="flex gap-1.5">
 <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px] bg-status-ok hover:bg-status-ok/20 " onClick={() => voteQuorum(d.id, 'verifier-1', 'accept')}>
 <CheckCircle2 className="size-3 mr-1" /> Accept (v1)
 </Button>
 <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px] bg-status-ok hover:bg-status-ok/20 " onClick={() => voteQuorum(d.id, 'verifier-2', 'accept')}>
 <CheckCircle2 className="size-3 mr-1" /> Accept (v2)
 </Button>
 <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px] bg-status-danger hover:bg-status-danger/20 text-status-danger" onClick={() => voteQuorum(d.id, 'verifier-1', 'reject')}>
 <XCircle className="size-3 mr-1" /> Reject
 </Button>
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
 <RelatedPhases links={[link('phase2', 'Join dei piani', 'Il quorum semantico è il meccanismo di Join dei DAG'), link('phase1', 'Replica in memoria', 'I belief sincronizzati diventano entità semantiche'), link('phase5', 'Riflessione swarm', 'I conflitti ESR attivano riflessione ERL'), link('phase9', 'Quorum = delega multipla', 'Il quorum sostituisce HITL singolo per azioni delegate')]} />

 </div>
 )
}

function StatCard({ label, value, highlight, warn }: { label: string; value: number | string; highlight?: boolean; warn?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4">
 <div className="text-muted-foreground text-xs mb-1">{label}</div>
 <div className={cn('text-2xl font-bold font-mono', highlight && 'text-status-ok', warn && 'text-status-warn')}>{value}</div>
 </CardContent>
 </Card>
 )
}
