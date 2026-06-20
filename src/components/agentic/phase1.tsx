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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Database, Layers, Network, FileJson, Plus, RefreshCw, Send, Activity,
  CheckCircle2, XCircle, Clock, Brain, GitBranch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Episode = {
  id: string; observation: string; timestamp: string; decay: number;
  source: string | null; agentId: string | null; tags: string[];
}
type Stats = { episodic: number; semantic: number; logical: number; avgDecay: number }
type Entity = { id: string; name: string; type: string; description: string | null; decay: number }
type Rule = { id: string; ruleId: string; expression: string; dependencies: string; priority: number }
type Tx = {
  id: string; path: string; op: string; actor: string; authorized: boolean;
  status: string; reason: string; value: string | null; timestamp: string;
}

export function Phase1() {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [state, setState] = useState<Record<string, unknown>>({})
  const [txs, setTxs] = useState<Tx[]>([])
  const [sensoriumXml, setSensoriumXml] = useState<string>('')
  const [sensoriumData, setSensoriumData] = useState<any>(null)
  const [newObs, setNewObs] = useState('')
  const [newEntName, setNewEntName] = useState('')
  const [newEntType, setNewEntType] = useState('module')
  const [newEntDesc, setNewEntDesc] = useState('')
  const [patchActor, setPatchActor] = useState('orchestrator')
  const [patchPath, setPatchPath] = useState('/public/note')
  const [patchOp, setPatchOp] = useState<'add' | 'remove' | 'replace' | 'test'>('add')
  const [patchValue, setPatchValue] = useState('"hello"')

  const refreshAll = async () => {
    const [memR, pbR, sensR] = await Promise.all([
      fetch('/api/memory').then((r) => r.json()),
      fetch('/api/patchboard').then((r) => r.json()),
      fetch('/api/sensorium').then((r) => r.json()),
    ])
    setEpisodes(memR.episodes || [])
    setStats(memR.stats || null)
    setEntities(memR.entities || [])
    setRules(memR.rules || [])
    setState(pbR.state || {})
    setTxs(pbR.transactions || [])
    if (sensR.xml) {
      setSensoriumXml(sensR.xml)
      setSensoriumData(sensR.data)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshAll() }, [])

  const addEpisode = async () => {
    if (!newObs.trim()) return
    const r = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'episode', observation: newObs, source: 'user', agentId: 'user' }),
    })
    const d = await r.json()
    if (d.ok) { toast.success('Episodio registrato'); setNewObs(''); refreshAll() }
    else toast.error(d.error)
  }

  const addEntity = async () => {
    if (!newEntName.trim()) return
    const r = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'entity', name: newEntName, type: newEntType, description: newEntDesc }),
    })
    const d = await r.json()
    if (d.ok) { toast.success('Entità creata'); setNewEntName(''); setNewEntDesc(''); refreshAll() }
    else toast.error(d.error)
  }

  const sendPatch = async () => {
    let value: unknown
    try { value = JSON.parse(patchValue) }
    catch { toast.error('Valore non è JSON valido'); return }
    const r = await fetch('/api/patchboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: patchActor,
        ops: [{ op: patchOp, path: patchPath, value }],
      }),
    })
    const d = await r.json()
    if (d.accepted) toast.success('Transazione accettata')
    else toast.error(`Rifiutata: ${d.reason}`)
    refreshAll()
  }

  const refreshSensorium = async () => {
    const r = await fetch('/api/sensorium')
    const d = await r.json()
    if (d.xml) { setSensoriumXml(d.xml); setSensoriumData(d.data); toast.success(`Ciclo #${d.data.cycleId} compilato`) }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PhaseHeader phaseId="phase1" action={<Button variant="outline" size="sm" onClick={refreshAll}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Clock} label="Episodi" value={stats.episodic} />
          <StatCard icon={Network} label="Entità semantiche" value={stats.semantic} />
          <StatCard icon={GitBranch} label="Regole logiche" value={stats.logical} />
          <StatCard icon={Activity} label="EMA decay medio" value={stats.avgDecay.toFixed(3)} />
        </div>
      )}

      <Tabs defaultValue="memory" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          <TabsTrigger value="memory"><Brain className="size-3.5 mr-1.5" /> Memoria</TabsTrigger>
          <TabsTrigger value="patchboard"><FileJson className="size-3.5 mr-1.5" /> PatchBoard</TabsTrigger>
          <TabsTrigger value="sensorium"><Activity className="size-3.5 mr-1.5" /> Sensorium</TabsTrigger>
          <TabsTrigger value="logical"><Layers className="size-3.5 mr-1.5" /> DAG Logico</TabsTrigger>
        </TabsList>

        <TabsContent value="memory" className="space-y-4 mt-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Registra Episodio</CardTitle>
                <CardDescription>Osservazione timestampata con embedding vettoriale</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Es: Agente orchestrator ha schedulato 3 task paralleli"
                  value={newObs}
                  onChange={(e) => setNewObs(e.target.value)}
                  rows={3}
                />
                <Button size="sm" onClick={addEpisode} disabled={!newObs.trim()}>
                  <Plus className="size-3.5 mr-1.5" /> Registra
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Crea Entità Semantica</CardTitle>
                <CardDescription>Entry coerente nel livello semantico (vector DB)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Nome</Label>
                    <Input value={newEntName} onChange={(e) => setNewEntName(e.target.value)} placeholder="es: ModuloX" />
                  </div>
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Select value={newEntType} onValueChange={setNewEntType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="module">module</SelectItem>
                        <SelectItem value="agent">agent</SelectItem>
                        <SelectItem value="system">system</SelectItem>
                        <SelectItem value="concept">concept</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Input value={newEntDesc} onChange={(e) => setNewEntDesc(e.target.value)} placeholder="Descrizione" />
                <Button size="sm" onClick={addEntity} disabled={!newEntName.trim()}>
                  <Plus className="size-3.5 mr-1.5" /> Aggiungi
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Episodi Recenti</CardTitle>
              <CardDescription>Ultime 30 osservazioni con decay applicato</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-72 pr-2">
                {episodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessun episodio. Inizializza il sistema o registrane uno.</p>
                ) : (
                  <ul className="space-y-2">
                    {episodes.map((e) => (
                      <li key={e.id} className="text-xs border-l-2 border-primary/40 pl-3 py-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] py-0">
                            decay {e.decay.toFixed(2)}
                          </Badge>
                          {e.source && <span className="text-muted-foreground">via {e.source}</span>}
                          {e.tags?.map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px] py-0">#{t}</Badge>
                          ))}
                        </div>
                        <div>{e.observation}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {new Date(e.timestamp).toLocaleString('it-IT')}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Entità Semantiche</CardTitle>
              <CardDescription>Vector DB coerente, embedding EMA-aggiornato</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-60 pr-2">
                {entities.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessuna entità.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {entities.map((e) => (
                      <li key={e.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50">
                        <Badge variant="outline" className="text-[10px] py-0">{e.type}</Badge>
                        <span className="font-mono font-medium">{e.name}</span>
                        <span className="text-muted-foreground flex-1 truncate">{e.description}</span>
                        <Badge variant="secondary" className="text-[10px] py-0">EMA {e.decay.toFixed(2)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patchboard" className="space-y-4 mt-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Invia Transazione JSON Patch</CardTitle>
                <CardDescription>Validata dal kernel deterministico con scoping permessi</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Attore</Label>
                    <Select value={patchActor} onValueChange={setPatchActor}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kernel">kernel</SelectItem>
                        <SelectItem value="orchestrator">orchestrator</SelectItem>
                        <SelectItem value="curator">curator</SelectItem>
                        <SelectItem value="scheduler">scheduler</SelectItem>
                        <SelectItem value="reflective">reflective</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Operazione</Label>
                    <Select value={patchOp} onValueChange={(v: any) => setPatchOp(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="add">add</SelectItem>
                        <SelectItem value="replace">replace</SelectItem>
                        <SelectItem value="remove">remove</SelectItem>
                        <SelectItem value="test">test</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Path (JSON Pointer)</Label>
                  <Input value={patchPath} onChange={(e) => setPatchPath(e.target.value)} placeholder="/public/note" />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Prefissi validi: /system /agents /tasks /memory /metrics /public
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Valore (JSON)</Label>
                  <Input value={patchValue} onChange={(e) => setPatchValue(e.target.value)} placeholder='"test" o {"k":1}' />
                </div>
                <Button size="sm" onClick={sendPatch}>
                  <Send className="size-3.5 mr-1.5" /> Applica Transazione
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Stato Globale (Albero JSON)</CardTitle>
                <CardDescription>Risultato delle transazioni accettate</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-[11px] font-mono bg-muted/50 rounded-md p-3 max-h-72 overflow-auto">
                  {Object.keys(state).length === 0
                    ? '// vuoto'
                    : JSON.stringify(state, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Audit Trail Transazioni</CardTitle>
              <CardDescription>Log di ogni operazione (accepted/rejected) con replay snapshot</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 pr-2">
                {txs.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessuna transazione.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {txs.map((t) => (
                      <li key={t.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border">
                        {t.status === 'accepted'
                          ? <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                          : <XCircle className="size-3.5 text-red-500 shrink-0" />}
                        <Badge variant="outline" className="text-[10px] py-0 font-mono">{t.op}</Badge>
                        <span className="font-mono">{t.path}</span>
                        <span className="text-muted-foreground text-[10px]">by {t.actor}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(t.timestamp).toLocaleTimeString('it-IT')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sensorium" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Blocco Sensorium (XML)</CardTitle>
                  <CardDescription>Compilato dal Curator ad ogni ciclo cognitivo</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={refreshSensorium}>
                  <Activity className="size-3.5 mr-1.5" /> Nuovo Ciclo
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {sensoriumData && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <MiniStat label="Ciclo" value={`#${sensoriumData.cycleId}`} />
                  <MiniStat label="Queue" value={sensoriumData.queueDepth} />
                  <MiniStat label="Threads" value={sensoriumData.activeThreads} />
                  <MiniStat label="Load" value={`${(sensoriumData.systemLoad * 100).toFixed(0)}%`} />
                </div>
              )}
              <pre className="text-[11px] font-mono bg-zinc-950 text-zinc-100 rounded-md p-3 overflow-auto max-h-96">
{sensoriumXml || '// clicca "Nuovo Ciclo" per generare'}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logical" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Grafo DAG delle Regole Logiche</CardTitle>
              <CardDescription>Regole procedurali deterministiche con dipendenze acicliche</CardDescription>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nessuna regola.</p>
              ) : (
                <div className="space-y-2">
                  {rules.map((r) => {
                    const deps = r.dependencies ? JSON.parse(r.dependencies) : []
                    return (
                      <div key={r.id} className="text-xs border rounded-md p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="font-mono">{r.ruleId}</Badge>
                          <Badge variant="outline" className="text-[10px] py-0">P{r.priority}</Badge>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.expression}</code>
                        </div>
                        {deps.length > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            dipende da: {deps.join(' → ')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <RelatedPhases links={[link('phase6', 'Gestisci contesto', 'Le osservazioni episodiche alimentano il ring buffer del Context Manager'), link('phase13', 'Sincronizza belief', 'Replica le convinzioni semantiche tra agenti paralleli'), link('phase3', 'Ciclo cognitivo', 'Il Sensorium alimenta lo steering ACTS'), link('phase5', 'Rifletti', 'Dalla memoria episodica estrai euristiche ERL')]} />

    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
          <Icon className="size-3.5" />
          {label}
        </div>
        <div className="text-2xl font-bold font-mono">{value}</div>
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 rounded-md p-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-mono font-bold">{value}</div>
    </div>
  )
}
