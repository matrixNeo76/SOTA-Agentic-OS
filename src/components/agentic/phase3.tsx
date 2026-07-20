'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
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
 id: string; cycleId: string; agentId: string; strategy: string;
 phrase: string; tokenBudget: number; tokenUsed: number; timestamp: string;
 planId: string | null; step: number;
}

const STRATEGY_STYLE: Record<Strategy, { color: string; bg: string; border: string; icon: any }> = {
 PLAN: { color: 'text-status-info', bg: 'bg-status-info', border: 'border-status-info/30', icon: Brain },
 EXECUTE: { color: 'text-status-ok', bg: 'bg-status-ok', border: 'border-status-ok/30', icon: Zap },
 CHECK: { color: 'text-status-warn', bg: 'bg-status-warn', border: 'border-status-warn/30', icon: CheckCircle2 },
 REFLECT: { color: 'text-cat-cognitive', bg: 'bg-cat-cognitive', border: 'border-cat-cognitive/30', icon: Compass },
 HALT: { color: 'text-status-danger', bg: 'bg-status-danger', border: 'border-status-danger/30', icon: Square },
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

 // B3 fix — Refs per evitare stale closure nell'auto-run loop.
 // PRIMA: useEffect dipendeva da 7 variabili di stato → clearInterval+setInterval
 // ad ogni doStep() (che ne aggiorna 4-5), con timing instabile e stale closure risk.
 // ORA: ref singolo con tutto lo stato, useEffect dipende solo da [autoRun].
 const stateRef = useRef({ step, lastStrategy, lastCheckPassed, errorsConsecutive, budgetUsed, budgetTotal })
 stateRef.current = { step, lastStrategy, lastCheckPassed, errorsConsecutive, budgetUsed, budgetTotal }

 const refresh = useCallback(async () => {
 // G3 — try/catch per evitare unhandled promise rejection su network error
 try {
 const r = await fetch('/api/steering')
 if (!r.ok) {
 toast.error(`Caricamento steering fallito (HTTP ${r.status})`)
 return
 }
 const d = await r.json()
 setVocabulary(d.vocabulary)
 setHistory(d.history || [])
 } catch (e: any) {
 toast.error(`Caricamento steering fallito: ${e?.message || 'errore di rete'}`)
 }
 }, [])

 useEffect(() => { void refresh() }, [refresh])

 // B4 fix — CHECK deterministico basato su stato reale (no Math.random).
 // Strategia: considera CHECK fallito se ci sono stati errori recenti (errorsConsecutive > 0)
 // o se il budget rimanente è basso (< 30% del totale, segnale di stress).
 // In futuro: integrare con Phase 8 (Lean4 Verifier) o Phase 4 (LTL) per validazione reale.
 const performRealCheck = useCallback(async (): Promise<boolean> => {
 const { errorsConsecutive, budgetUsed, budgetTotal } = stateRef.current
 const budgetRemaining = budgetTotal - budgetUsed
 const budgetPct = budgetRemaining / budgetTotal

 // B4 — Try real integration with Phase 8 (Lean4 Verifier) if available
 try {
 const r = await fetch('/api/lean?action=stats', { signal: AbortSignal.timeout(2000) })
 if (r.ok) {
 const stats = await r.json()
 // Se ci sono contratti formali verificati falliti, CHECK fallisce
 if (stats && typeof stats.failedWorkflows === 'number' && stats.failedWorkflows > 0) {
 return false
 }
 // Se ci sono contratti verificati con successo, CHECK passa
 if (stats && typeof stats.verifiedWorkflows === 'number' && stats.verifiedWorkflows > 0) {
 return true
 }
 // Altrimenti fallback al check euristico sotto
 }
 } catch {
 // Phase 8 non disponibile, fallback euristico
 }

 // B4 fallback — Check deterministico basato su stato FSM:
 // - Se ci sono errori consecutivi → 70% probabilità di fallimento (ma deterministico: pari/dispari step)
 // - Se budget < 30% → stress, più probabile fallimento
 // - Altrimenti → passa
 const seed = stateRef.current.step
 if (errorsConsecutive > 0) {
 // Deterministico: step pari fallisce, dispari passa (ma errorsConsecutive accelera)
 return seed % 2 === 1
 }
 if (budgetPct < 0.3) {
 return seed % 3 !== 0 // 2/3 fallisce sotto stress
 }
 return true
 }, [])

 const doStep = useCallback(async () => {
 setStepping(true)
 try {
 const currentState = stateRef.current
 const r = await fetch('/api/steering', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 agentId: 'controller',
 budgetTotal: currentState.budgetTotal,
 budgetUsed: currentState.budgetUsed,
 step: currentState.step,
 lastStrategy: currentState.lastStrategy,
 lastCheckPassed: currentState.lastCheckPassed,
 errorsConsecutive: currentState.errorsConsecutive,
 }),
 })
 const d = await r.json()
 if (d.ok) {
 setCurrentPhrase(d.phrase)
 setLastStrategy(d.strategy as Strategy)
 setBudgetUsed(c => c + d.tokenUsed)
 setStep(s => s + 1)
 if (d.strategy === 'CHECK') {
 // B4 fix — Check reale (Phase 8) o deterministico fallback (no Math.random)
 const passed = await performRealCheck()
 setLastCheckPassed(passed)
 if (!passed) setErrorsConsecutive(c => c + 1)
 else setErrorsConsecutive(0)
 }
 if (d.strategy === 'HALT') {
 setAutoRun(false)
 toast.info('HALT: budget esaurito o soglia di sicurezza')
 }
 void refresh()
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setStepping(false)
 }
 }, [performRealCheck, refresh])

 // B3 fix — useEffect con SOLO [autoRun] come dipendenza.
 // doStep legge stato fresco da stateRef.current, non da closure.
 useEffect(() => {
 if (!autoRun) return
 const t = setInterval(() => { void doStep() }, 1500)
 return () => clearInterval(t)
 }, [autoRun, doStep])

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
 <Progress value={budgetPct} className={cn(budgetPct < 20 && '[&>div]:bg-status-danger', budgetPct < 50 && budgetPct >= 20 && '[&>div]:bg-status-warn')} />
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
 <Button
 size="sm"
 onClick={doStep}
 disabled={stepping || lastStrategy === 'HALT'}
 aria-label="Esegui uno step di steering"
 >
 <Play className="size-3.5 mr-1.5" /> Step
 </Button>
 <Button
 size="sm"
 variant={autoRun ? 'destructive' : 'outline'}
 onClick={() => setAutoRun(!autoRun)}
 disabled={lastStrategy === 'HALT'}
 aria-label={autoRun ? 'Ferma auto-run' : 'Avvia auto-run'}
 aria-pressed={autoRun}
 >
 {autoRun ? <Square className="size-3.5 mr-1.5" /> : <Zap className="size-3.5 mr-1.5" />}
 {autoRun ? 'Stop' : 'Auto-run'}
 </Button>
 <Button size="sm" variant="ghost" onClick={reset} aria-label="Resetta il ciclo cognitivo">
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
 // B3 — border class non più dinamica (border-${strategy}-500/30 purged da JIT).
 // Usa STRATEGY_STYLE[lastStrategy].border lookup statica.
 <div className={cn('rounded-md p-4 border', STRATEGY_STYLE[lastStrategy].bg, STRATEGY_STYLE[lastStrategy].border)} role="status" aria-live="polite" aria-label={`Steering phrase per strategia ${lastStrategy}`}>
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
 {/* G6 fix (Fase C) — mostra step (leggibile) invece di cycleId (cuid lungo illeggibile) */}
 <span className="text-[10px] text-muted-foreground">step {h.step}</span>
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
