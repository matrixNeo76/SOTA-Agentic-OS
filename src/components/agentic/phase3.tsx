'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  Compass, RefreshCw, Brain, Zap, CheckCircle2, AlertCircle, Square,
  Play, RotateCcw, Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhaseHeader } from './phase-header'
import { RelatedPhases, link } from './related-phases'

type Strategy = 'PLAN' | 'EXECUTE' | 'CHECK' | 'REFLECT' | 'HALT'
type Vocab = Record<Strategy, { phrase: string; budgetCost: number; description: string }>
type HistoryItem = {
  id: string; cycleId: number; agentId: string; strategy: string;
  phrase: string; tokenBudget: number; tokenUsed: number; timestamp: string;
}

const STRATEGY_STYLE: Record<Strategy, { color: string; bg: string; icon: any }> = {
  PLAN:     { color: 'text-sky-600 dark:text-sky-400',     bg: 'bg-sky-100 dark:bg-sky-950/40',     icon: Brain },
  EXECUTE:  { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-950/40', icon: Zap },
  CHECK:    { color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-950/40',  icon: CheckCircle2 },
  REFLECT:  { color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-950/40', icon: Compass },
  HALT:     { color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-100 dark:bg-red-950/40',      icon: Square },
}

export function Phase3() {
  const [vocabulary, setVocabulary] = useState<Vocab | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [budgetTotal, setBudgetTotal] = useState(1000)
  const [budgetUsed, setBudgetUsed] = useState(0)
  const [step, setStep] = useState(0)
  const [lastStrategy, setLastStrategy] = useState<Strategy>('PLAN')
  const [lastCheckPassed, setLastCheckPassed] = useState<boolean | null>(null)
  const [errorsConsecutive, setErrorsConsecutive] = useState(0)
  const [currentPhrase, setCurrentPhrase] = useState<string>('')
  const [stepping, setStepping] = useState(false)
  const [autoRun, setAutoRun] = useState(false)

  const refresh = async () => {
    const r = await fetch('/api/steering')
    const d = await r.json()
    setVocabulary(d.vocabulary)
    setHistory(d.history || [])
  }

  useEffect(() => { refresh() }, [])

  // Auto-run loop
  useEffect(() => {
    if (!autoRun) return
    const t = setInterval(() => doStep(), 1500)
    return () => clearInterval(t)
  }, [autoRun, step, lastStrategy, lastCheckPassed, errorsConsecutive, budgetUsed, budgetTotal])

  const doStep = async () => {
    setStepping(true)
    try {
      const r = await fetch('/api/steering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'controller',
          budgetTotal,
          budgetUsed,
          step,
          lastStrategy,
          lastCheckPassed,
          errorsConsecutive,
        }),
      })
      const d = await r.json()
      if (d.ok) {
        setCurrentPhrase(d.phrase)
        setLastStrategy(d.strategy as Strategy)
        setBudgetUsed(budgetUsed + d.tokenUsed)
        setStep(step + 1)
        if (d.strategy === 'CHECK') {
          // simulate check result
          const passed = Math.random() > 0.3
          setLastCheckPassed(passed)
          if (!passed) setErrorsConsecutive(errorsConsecutive + 1)
          else setErrorsConsecutive(0)
        }
        if (d.strategy === 'HALT') {
          setAutoRun(false)
          toast.info('HALT: budget esaurito o soglia di sicurezza')
        }
        refresh()
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStepping(false)
    }
  }

  const reset = () => {
    setBudgetUsed(0); setStep(0); setLastStrategy('PLAN')
    setLastCheckPassed(null); setErrorsConsecutive(0); setCurrentPhrase('')
    setAutoRun(false)
  }

  const budgetRemaining = budgetTotal - budgetUsed
  const budgetPct = (budgetRemaining / budgetTotal) * 100

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PhaseHeader phaseId="phase3" action={<Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5 mr-1.5" />Aggiorna</Button>} />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Controller State</CardTitle>
            <CardDescription>Stato corrente del ciclo cognitivo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Budget token</span>
                <span className="font-mono">{budgetRemaining} / {budgetTotal}</span>
              </div>
              <Progress value={budgetPct} className={cn(budgetPct < 20 && '[&>div]:bg-red-500', budgetPct < 50 && budgetPct >= 20 && '[&>div]:bg-amber-500')} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Step</div>
                <div className="text-lg font-mono font-bold">{step}</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Errori consec.</div>
                <div className="text-lg font-mono font-bold">{errorsConsecutive}</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Ultima strategia</div>
                <div className="text-sm font-mono font-bold">{lastStrategy}</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Check passato</div>
                <div className="text-sm font-mono font-bold">
                  {lastCheckPassed === null ? '—' : lastCheckPassed ? 'SÌ' : 'NO'}
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Budget totale (token)</Label>
              <Input
                type="number"
                value={budgetTotal}
                onChange={(e) => setBudgetTotal(Math.max(100, Number(e.target.value)))}
                disabled={step > 0}
              />
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={doStep} disabled={stepping || lastStrategy === 'HALT'}>
                <Play className="size-3.5 mr-1.5" /> Step
              </Button>
              <Button
                size="sm"
                variant={autoRun ? 'destructive' : 'outline'}
                onClick={() => setAutoRun(!autoRun)}
                disabled={lastStrategy === 'HALT'}
              >
                {autoRun ? <Square className="size-3.5 mr-1.5" /> : <Zap className="size-3.5 mr-1.5" />}
                {autoRun ? 'Stop' : 'Auto-run'}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                <RotateCcw className="size-3.5 mr-1.5" /> Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Steering Phrase Corrente</CardTitle>
            <CardDescription>Iniettata nel motore principale per innescare deterministicamente il comportamento</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentPhrase ? (
              <div className={cn('rounded-md p-4 border', STRATEGY_STYLE[lastStrategy].bg, `border-${lastStrategy.toLowerCase()}-500/30`)}>
                <div className="flex items-center gap-2 mb-2">
                  {(() => {
                    const Icon = STRATEGY_STYLE[lastStrategy].icon
                    return <Icon className={cn('size-5', STRATEGY_STYLE[lastStrategy].color)} />
                  })()}
                  <Badge variant="outline" className={cn('font-mono', STRATEGY_STYLE[lastStrategy].color)}>
                    {lastStrategy}
                  </Badge>
                </div>
                <p className="text-sm italic">"{currentPhrase}"</p>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic p-4 text-center">
                Clicca "Step" per avviare il primo steering.
              </div>
            )}

            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                <Cpu className="size-3.5" /> Vocabolario di Sterzate
              </h4>
              {vocabulary && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {(Object.entries(vocabulary) as [Strategy, { phrase: string; budgetCost: number; description: string }][]).map(([name, info]) => {
                    const Icon = STRATEGY_STYLE[name].icon
                    return (
                      <div key={name} className={cn(
                        'border rounded-md p-2.5 text-xs',
                        lastStrategy === name && cn('border-2', STRATEGY_STYLE[name].bg)
                      )}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className={cn('size-3.5', STRATEGY_STYLE[name].color)} />
                          <span className={cn('font-mono font-bold', STRATEGY_STYLE[name].color)}>{name}</span>
                          <Badge variant="secondary" className="text-[10px] py-0 ml-auto">{info.budgetCost} tok</Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mb-1">{info.description}</p>
                        <p className="text-[10px] italic">"{info.phrase}"</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Storia degli Steering Event</CardTitle>
          <CardDescription>Log audit di ogni decisione del Controller</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64 pr-2">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nessun evento. Clicca Step.</p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((h) => {
                  const style = STRATEGY_STYLE[h.strategy as Strategy] || STRATEGY_STYLE.HALT
                  const Icon = style.icon
                  return (
                    <li key={h.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border">
                      <Icon className={cn('size-3.5 shrink-0', style.color)} />
                      <Badge variant="outline" className="text-[10px] py-0 font-mono">{h.strategy}</Badge>
                      <span className="text-[10px] text-muted-foreground">#{h.cycleId}</span>
                      <span className="flex-1 truncate italic">"{h.phrase}"</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{h.tokenUsed} tok</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
      <RelatedPhases links={[link('phase1', 'Stato & memoria', 'Lo steering consulta stato globale e Sensorium'), link('phase10', 'Modello incapsulato', 'Le steering phrases vengono iniettate nel Model Encapsulator'), link('phase14', 'Route steering', 'Le decisioni PLAN/EXECUTE possono usare modelli specializzati'), link('phase11', 'Monitora affetti', 'Le sterzate ripetute aumentano la frustrazione')]} />

    </div>
  )
}
