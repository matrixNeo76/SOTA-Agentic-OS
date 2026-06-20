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
  Sparkles, RefreshCw, Brain, Search, AlertTriangle, CheckCircle2, XCircle,
  Plus, Send, BookOpen, Shield, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Heuristic = {
  id: string; trigger: string; action: string; context: string;
  source: string | null; appliedCount: number; successRate: number;
  redLineOk: boolean; createdAt: string;
}
type Reflection = {
  id: string; operationId: string | null; outcome: string;
  analysis: string; extractedHeuristic: string | null; redLineFlag: boolean; timestamp: string;
}
type RedLine = {
  id: string; description: string; rationale: string; severity: string; active: boolean;
}

export function Phase5() {
  const [heuristics, setHeuristics] = useState<Heuristic[]>([])
  const [reflections, setReflections] = useState<Reflection[]>([])
  const [redLines, setRedLines] = useState<RedLine[]>([])

  // RAG search
  const [query, setQuery] = useState('')
  const [retrieved, setRetrieved] = useState<any[]>([])

  // Reflection form
  const [reflGoal, setReflGoal] = useState('Completare il deploy del microservizio auth')
  const [reflOutcome, setReflOutcome] = useState<'success' | 'failure' | 'partial'>('partial')
  const [reflSteps, setReflSteps] = useState('build;test;deploy\nbuild: OK\ntest: 3 falliti\ndeploy: rollback')
  const [reflContext, setReflContext] = useState('ambiente di staging')

  const refresh = async () => {
    const r = await fetch('/api/reflect')
    const d = await r.json()
    setHeuristics(d.heuristics || [])
    setReflections(d.reflections || [])
    const rl = await fetch('/api/reflect?action=redlines').then((r) => r.json())
    setRedLines(rl.redLines || [])
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [])

  const runReflection = async () => {
    const steps = reflSteps.split('\n').filter(Boolean).map((line) => {
      const [action, ...rest] = line.split(':')
      return { action: action.trim(), result: rest.join(':').trim() }
    })
    const r = await fetch('/api/reflect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reflect',
        input: {
          operationId: `ui-${Date.now()}`,
          goal: reflGoal,
          outcome: reflOutcome,
          steps,
          context: reflContext,
        },
      }),
    })
    const d = await r.json()
    if (d.ok) {
      if (d.approved) toast.success('Euristica estratta e memorizzata')
      else toast.warning(`Red Line: ${d.reviewReason}`)
      refresh()
    } else {
      toast.error(d.error)
    }
  }

  const runRAG = async () => {
    if (!query.trim()) return
    const r = await fetch(`/api/reflect?action=retrieve&q=${encodeURIComponent(query)}&k=5`)
    const d = await r.json()
    setRetrieved(d.heuristics || [])
    if (d.heuristics?.length === 0) toast.info('Nessuna euristica rilevante')
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PhaseHeader phaseId="phase5" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

      <Tabs defaultValue="reflect" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          <TabsTrigger value="reflect"><Brain className="size-3.5 mr-1.5" /> Riflessione</TabsTrigger>
          <TabsTrigger value="rag"><Search className="size-3.5 mr-1.5" /> RAG Euristiche</TabsTrigger>
          <TabsTrigger value="library"><BookOpen className="size-3.5 mr-1.5" /> Libreria</TabsTrigger>
          <TabsTrigger value="redline"><Shield className="size-3.5 mr-1.5" /> Red Lines</TabsTrigger>
        </TabsList>

        <TabsContent value="reflect" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Esegui Riflessione su Operazione</CardTitle>
              <CardDescription>
                L'ERL analizza l'operazione, estrae un'euristica, e AutoSOTA verifica le Red Lines prima di memorizzarla.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Obiettivo dell'operazione</Label>
                  <Input value={reflGoal} onChange={(e) => setReflGoal(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Esito</Label>
                  <Select value={reflOutcome} onValueChange={(v: any) => setReflOutcome(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="success">success</SelectItem>
                      <SelectItem value="failure">failure</SelectItem>
                      <SelectItem value="partial">partial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Passi (formato "azione: risultato", uno per riga)</Label>
                <Textarea
                  value={reflSteps}
                  onChange={(e) => setReflSteps(e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Contesto</Label>
                <Input value={reflContext} onChange={(e) => setReflContext(e.target.value)} />
              </div>
              <Button size="sm" onClick={runReflection}>
                <Send className="size-3.5 mr-1.5" /> Rifletti ed Estrai Euristica
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Log Riflessioni Recenti</CardTitle>
              <CardDescription>{reflections.length} riflessioni totali</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-72 pr-2">
                {reflections.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessuna riflessione.</p>
                ) : (
                  <ul className="space-y-2">
                    {reflections.map((r) => (
                      <li key={r.id} className="text-xs border rounded-md p-2.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          {r.redLineFlag
                            ? <XCircle className="size-3.5 text-red-500" />
                            : <CheckCircle2 className="size-3.5 text-emerald-500" />}
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] py-0',
                              r.outcome === 'success' && 'border-emerald-500 text-emerald-700 dark:text-emerald-400',
                              r.outcome === 'failure' && 'border-red-500 text-red-700 dark:text-red-400',
                              r.outcome === 'partial' && 'border-amber-500 text-amber-700 dark:text-amber-400'
                            )}
                          >
                            {r.outcome}
                          </Badge>
                          {r.redLineFlag && <Badge variant="destructive" className="text-[10px] py-0">RED LINE</Badge>}
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(r.timestamp).toLocaleString('it-IT')}
                          </span>
                        </div>
                        {r.extractedHeuristic && (
                          <div className="text-[11px] italic mb-1 text-muted-foreground">
                            "{r.extractedHeuristic}"
                          </div>
                        )}
                        <pre className="text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
{r.analysis}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rag" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">RAG Semantico su Euristiche</CardTitle>
              <CardDescription>
                Recupera le top-k euristiche rilevanti per un nuovo task (cosine similarity su embedding vettoriale).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Es: come gestire un deploy fallito"
                  onKeyDown={(e) => e.key === 'Enter' && runRAG()}
                />
                <Button size="sm" onClick={runRAG}>
                  <Search className="size-3.5 mr-1.5" /> Recupera
                </Button>
              </div>
              <div className="space-y-2">
                {retrieved.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Esegui una query per recuperare euristiche.</p>
                ) : (
                  retrieved.map((h) => (
                    <div key={h.id} className="border rounded-md p-3 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          sim {h.similarity.toFixed(3)}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          usata {h.appliedCount}× · {((h.successRate || 0) * 100).toFixed(0)}% ok
                        </Badge>
                      </div>
                      <div className="text-[11px] mb-1"><strong>Trigger:</strong> {h.trigger}</div>
                      <div className="text-[11px]"><strong>Action:</strong> {h.action}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="library" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Libreria Euristiche</CardTitle>
              <CardDescription>{heuristics.length} euristiche memorizzate</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96 pr-2">
                {heuristics.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessuna euristica. Esegui una riflessione.</p>
                ) : (
                  <ul className="space-y-2">
                    {heuristics.map((h) => (
                      <li key={h.id} className="border rounded-md p-3 text-xs">
                        <div className="flex items-center gap-2 mb-1.5">
                          <CheckCircle2 className="size-3.5 text-emerald-500" />
                          <Badge variant="outline" className="text-[10px] py-0">Red Line OK</Badge>
                          <Badge variant="secondary" className="text-[10px] py-0">
                            usata {h.appliedCount}× · {((h.successRate || 0) * 100).toFixed(0)}% ok
                          </Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(h.createdAt).toLocaleDateString('it-IT')}
                          </span>
                        </div>
                        <div className="text-[11px] mb-1"><strong>Quando:</strong> {h.trigger}</div>
                        <div className="text-[11px] mb-1"><strong>Allora:</strong> {h.action}</div>
                        <div className="text-[10px] text-muted-foreground">Contesto: {h.context}</div>
                        {h.source && (
                          <div className="text-[10px] text-muted-foreground font-mono mt-1">src: {h.source}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="redline" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="size-4" /> Red Line System (AutoSOTA)
              </CardTitle>
              <CardDescription>
                Linee rosse non negoziabili valutate ad ogni euristica proposta.
                Qualsiasi violazione blocca la memorizzazione dell'euristica.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {redLines.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nessuna Red Line.</p>
              ) : (
                <ul className="space-y-2">
                  {redLines.map((r) => (
                    <li key={r.id} className="border-l-4 border-red-500 pl-3 py-1">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="size-3.5 text-red-500" />
                        <Badge
                          variant={r.severity === 'absolute' ? 'destructive' : 'secondary'}
                          className="text-[10px] py-0"
                        >
                          {r.severity}
                        </Badge>
                        <span className="text-xs font-medium">{r.description}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground pl-5">{r.rationale}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <RelatedPhases links={[link('phase2', 'Applica a nuovo piano', 'Le euristiche ERL vengono iniettate nel prompt di pianificazione'), link('phase8', 'LeanEvolve', 'Le euristiche guidano il recovery dei workflow falliti'), link('phase12', 'Valuta obiettivo', 'Le euristiche valutano i nodi della rubric tree'), link('phase1', 'Memorizza in NS-Mem', 'Le euristiche sono entità semantiche con embedding')]} />

    </div>
  )
}
