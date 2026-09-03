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
 Boxes, RefreshCw, Play, Lock, CheckCircle2, XCircle, AlertTriangle, Code2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Session = {
 id: string; agentId: string; taskGoal: string;
 contextInjected: string; modelOutput: string;
 parsedScript: string | null; sandboxResult: string | null;
 sandboxOk: boolean; retryCount: number; status: string; createdAt: string
}

export function Phase10() {
 const [sessions, setSessions] = useState<Session[]>([])
 const [stats, setStats] = useState<any>(null)
 const [agentId, setAgentId] = useState('orchestrator')
 const [taskGoal, setTaskGoal] = useState('Filtra e serializza i risultati della ricerca')
 const [contextData, setContextData] = useState('{"results":[{"id":1,"name":"test"},null,{"id":2,"name":"foo"}]}')

 const refresh = async () => {
 // B2 fix (Model Encapsulator audit Fase B): try/catch su refresh().
 // PRIMA: un fetch fallito (network error, server 500, body non JSON) faceva
 // throw unhandled rejection che rompeva il polling setInterval e lasciava
 // la UI in stato stale.
 // ORA: catch globale con toast.error user-friendly, preserva stato precedente
 // (non cancella i dati già caricati, evitando UI vuota lampeggiante).
 try {
 const [sessR, statsR] = await Promise.all([
 fetch('/api/grounded?action=sessions').then((r) => r.json()),
 fetch('/api/grounded?action=stats').then((r) => r.json()),
 ])
 setSessions(sessR.sessions || [])
 setStats(statsR)
 } catch (err) {
 // B2 — Network error o JSON parse error: mostra toast e lascia lo stato precedente
 toast.error('Caricamento Model Encapsulator fallito')
 // eslint-disable-next-line no-console
 console.error('[phase10] refresh failed:', err)
 }
 }

 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(() => {
   void refresh()
   // B7: adaptive polling with Page Visibility API
   const interval = setInterval(() => {
     if (!document.hidden) void refresh()
   }, 30_000) // 30s when visible
   return () => clearInterval(interval)
 }, [])

 const runCall = async () => {
 let ctx: unknown
 try { ctx = JSON.parse(contextData) } catch { toast.error('Context data non è JSON valido'); return }
 try {
 const r = await fetch('/api/grounded', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'encapsulated_call', agentId, taskGoal, contextData: ctx }),
 })
 // G3 fix (Model Encapsulator audit Fase C): parse-safe su r.json().
 // PRIMA: se la risposta non era JSON valido (es. 500 con body HTML, 502 gateway),
 // r.json() throwava e il catch esterno mostrava solo "Unexpected token <".
 // ORA: parse-safe con fallback a text() per logging migliore.
 let d: any
 try {
 d = await r.json()
 } catch {
 const text = await r.text().catch(() => '<no body>')
 // eslint-disable-next-line no-console
 console.error('[phase10] runCall: response not JSON', r.status, text.slice(0, 200))
 toast.error(`Risposta non valida dal server (status ${r.status})`)
 return
 }
 if (d.ok) {
 if (d.status === 'sandbox_blocked') toast.warning('Sandbox ha bloccato lo script')
 else if (d.parsedScript) toast.success('Script generato e eseguito in sandbox ✓')
 else toast.success('Chiamata incapsulata completata (no script)')
 refresh()
 } else toast.error(d.error)
 } catch (e: any) {
 // G3 — Network error o fetch throw (es. CORS, DNS failure)
 toast.error(e.message || 'Errore di rete')
 // eslint-disable-next-line no-console
 console.error('[phase10] runCall fetch failed:', e)
 }
 }

 return (
 <div className="p-4 md:p-6 space-y-4">
 <PhaseHeader phaseId="phase10" action={<Button variant="outline" size="sm" onClick={refresh} aria-label="Aggiorna dati Model Encapsulator"><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

 {stats && (
 <div className="grid grid-cols-2 md:grid-cols-7 gap-3" role="status" aria-live="polite" aria-label="Statistiche Model Encapsulator">
 <StatCard label="Sessioni" value={stats.sessions} />
 <StatCard label="Eseguite" value={stats.executed} highlight />
 <StatCard label="Sandbox block" value={stats.sandboxBlocked} warn={(stats.sandboxBlocked ?? 0) > 0} />
 {/* G4 — nuove stat card con metriche aggiuntive */}
 <StatCard label="Fallite" value={stats.failed ?? 0} warn={(stats.failed ?? 0) > 0} />
 <StatCard label="Pending" value={stats.pending ?? 0} warn={(stats.pending ?? 0) > 0} />
 <StatCard label="Sandbox OK" value={stats.sandboxOk ?? 0} highlight />
 <StatCard label="Policy" value={stats.policies} />
 </div>
 )}

 <Tabs defaultValue="call" className="w-full">
 <TabsList className="grid grid-cols-2 w-full">
 <TabsTrigger value="call"><Play className="size-3.5 mr-1.5" /> Encapsulated Call</TabsTrigger>
 <TabsTrigger value="history"><Code2 className="size-3.5 mr-1.5" /> Storico Sessioni</TabsTrigger>
 </TabsList>

 <TabsContent value="call" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Esegui Chiamata Incapsulata</CardTitle>
 <CardDescription>
 Il modello riceve solo il contesto minimale, non mantiene stato.
 Se genera uno script, viene eseguito in sandbox isolata (no accesso diretto ai dati).
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Agent ID</Label>
 <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
 </div>
 <div>
 <Label className="text-xs">Task goal</Label>
 <Input value={taskGoal} onChange={(e) => setTaskGoal(e.target.value)} />
 </div>
 </div>
 <div>
 <Label className="text-xs">Context data (JSON minimale)</Label>
 <Textarea value={contextData} onChange={(e) => setContextData(e.target.value)} rows={4} className="font-mono text-xs" />
 <p className="text-[10px] text-muted-foreground mt-1">
 Il contesto viene troncato al budget di token configurato (default 2000).
 </p>
 </div>
 <Button size="sm" onClick={runCall} aria-label="Esegui chiamata incapsulata LLM">
 <Play className="size-3.5 mr-1.5" /> Esegui Encapsulated Call
 </Button>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="history" className="space-y-4 mt-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Sessioni Incapsulate</CardTitle>
 <CardDescription>{sessions.length} sessioni totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-96 pr-2">
 {sessions.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessuna sessione. Esegui una chiamata incapsulata.</p>
 ) : (
 <ul className="space-y-2">
 {sessions.map((s) => (
 <li key={s.id} className="text-xs border rounded-md p-2.5">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="font-mono text-[10px]">{s.agentId}</Badge>
 {s.status === 'executed' && <CheckCircle2 className="size-3.5 text-status-ok" />}
 {s.status === 'sandbox_blocked' && <XCircle className="size-3.5 text-status-danger" />}
 {s.status === 'failed' && <AlertTriangle className="size-3.5 text-status-warn" />}
 <Badge variant="secondary" className="text-[10px]">{s.status}</Badge>
 {s.parsedScript && <Badge variant="outline" className="text-[10px]"><Lock className="size-2.5 mr-1" />sandbox</Badge>}
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(s.createdAt).toLocaleString('it-IT')}
 </span>
 </div>
 <div className="text-[11px] font-medium mb-1">{s.taskGoal}</div>
 <div className="text-[10px] text-muted-foreground mb-1 truncate">
 Output: {s.modelOutput.slice(0, 100)}...
 </div>
 {s.sandboxResult && (
 <div className="text-[10px] font-mono bg-muted/30 rounded p-1.5 mt-1">
 sandbox: {s.sandboxResult.slice(0, 150)}
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
 <RelatedPhases links={[link('phase6', 'Working context', 'Il contesto minimale deriva dal Context Manager'), link('phase14', 'Route modello', 'L\'encapsulator può usare il TimeRouter per scegliere il modello'), link('phase3', 'Steering injection', 'Le steering phrases sono iniettate nelle chiamate incapsulate'), link('phase4', 'Sandbox verificata', 'Gli script di parsing sono validati come Compiled AI (Fase 2)')]} />

 </div>
 )
}

function StatCard({ label, value, highlight, warn }: { label: string; value: number | string; highlight?: boolean; warn?: boolean }) {
 return (
 <Card>
 <CardContent className="pt-4" role="group" aria-label={`Statistica: ${label}`}>
 <div className="text-muted-foreground text-xs mb-1">{label}</div>
 <div className={cn('text-2xl font-bold font-mono', highlight && 'text-status-ok', warn && 'text-status-warn')} aria-label={`${label}: ${value}`}>{value}</div>
 </CardContent>
 </Card>
 )
}
