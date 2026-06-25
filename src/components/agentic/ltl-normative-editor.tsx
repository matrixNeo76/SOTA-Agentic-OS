'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
 Plus, Trash2, Eye, Save, Shield, CheckCircle2, XCircle, AlertTriangle,
 Lightbulb, GitBranch, ArrowRight, Play, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type LTLRule = { id: string; ruleId: string; ltlFormula: string; description: string | null; severity: string; active: boolean }
type Axiom = { id: string; axiom: string; priority: number; active: boolean }
type FSMPreview = {
 valid: boolean
 error?: string
 pattern?: string
 states?: { name: string; type: 'initial' | 'accepting' | 'violating' | 'pending' }[]
 description?: string
}

const PATTERNS = [
 { label: 'G(p)', formula: 'G(prop_name)', desc: 'Safety: p sempre vero' },
 { label: 'F(p)', formula: 'F(prop_name)', desc: 'Liveness: p appare almeno una volta' },
 { label: 'X(p)', formula: 'X(prop_name)', desc: 'Next: p vero al prossimo step' },
 { label: 'G(a -> X b)', formula: 'G(a -> X b)', desc: 'Ogni a seguito da b al prossimo' },
 { label: 'G(a -> !b)', formula: 'G(a -> !b)', desc: 'Dopo a, b non deve apparire' },
 { label: 'G(a -> F b)', formula: 'G(a -> F b)', desc: 'Ogni a seguito eventualmente da b' },
 { label: 'p U q', formula: 'p U q', desc: 'p fino a q' },
 { label: 'G(p && q)', formula: 'G(p && q)', desc: 'p e q sempre veri insieme' },
 { label: 'G(!p || q)', formula: 'G(!p || q)', desc: 'Safety: p implica q (forma alternativa)' },
]

const STATE_STYLE: Record<string, string> = {
 initial: 'border-status-info bg-status-info text-status-info dark:text-status-info',
 accepting: 'border-status-ok bg-status-ok  dark:text-status-ok',
 violating: 'border-status-danger bg-status-danger text-status-danger dark:text-status-danger',
 pending: 'border-status-warn bg-status-warn text-status-warn dark:text-status-warn',
}

const STATE_LABEL: Record<string, string> = {
 initial: 'iniziale',
 accepting: 'accettante',
 violating: 'violazione',
 pending: 'in attesa',
}

const PRIORITY_LABEL: Record<number, { label: string; color: string }> = {
 1: { label: 'Legale', color: 'bg-status-danger' },
 2: { label: 'Operativo', color: 'bg-status-warn' },
 3: { label: 'Efficienza', color: 'bg-status-info' },
}

export function LTLNormativeEditor() {
 const [rules, setRules] = useState<LTLRule[]>([])
 const [axioms, setAxioms] = useState<Axiom[]>([])

 // LTL editor state
 const [newRuleId, setNewRuleId] = useState('LTL-007')
 const [newFormula, setNewFormula] = useState('G(plan -> F execute)')
 const [newDescription, setNewDescription] = useState('Dopo un PLAN deve eventualmente seguire un EXECUTE')
 const [newSeverity, setNewSeverity] = useState<'block' | 'warn' | 'log'>('warn')
 const [preview, setPreview] = useState<FSMPreview | null>(null)
 const [validating, setValidating] = useState(false)

 // Axiom editor state
 const [newAxiomText, setNewAxiomText] = useState('')
 const [newAxiomPriority, setNewAxiomPriority] = useState(2)

 const refresh = async () => {
 const [ltlR, axR] = await Promise.all([
 fetch('/api/verify?section=ltl').then((r) => r.json()),
 fetch('/api/verify?section=normative').then((r) => r.json()),
 ])
 setRules(ltlR.rules || [])
 setAxioms(axR.axioms || [])
 }

 useEffect(() => { void refresh() }, [])

 // Live validation & FSM preview quando cambia la formula
 useEffect(() => {
 if (!newFormula.trim()) {
 setPreview(null)
 return
 }
 setValidating(true)
 const t = setTimeout(async () => {
 try {
 const r = await fetch('/api/verify', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'preview_fsm', formula: newFormula }),
 })
 const d = await r.json()
 setPreview(d)
 } catch (e: any) {
 setPreview({ valid: false, error: e.message })
 } finally {
 setValidating(false)
 }
 }, 400)
 return () => clearTimeout(t)
 }, [newFormula])

 const addRule = async () => {
 if (!newRuleId.trim() || !newFormula.trim()) {
 toast.error('ruleId e formula obbligatori')
 return
 }
 if (!preview?.valid) {
 toast.error('Formula non valida, correggi prima di salvare')
 return
 }
 try {
 const r = await fetch('/api/verify', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'add_ltl',
 spec: {
 ruleId: newRuleId,
 formula: newFormula,
 description: newDescription,
 severity: newSeverity,
 },
 }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Regola ${newRuleId} aggiunta`)
 // Incrementa ruleId suggestion
 const num = parseInt(newRuleId.replace(/\D/g, '')) + 1
 setNewRuleId(`LTL-${String(num).padStart(3, '0')}`)
 refresh()
 } else {
 toast.error(d.error || 'Errore salvataggio')
 }
 } catch (e: any) {
 toast.error(e.message)
 }
 }

 const deleteRule = async (ruleId: string) => {
 try {
 await fetch('/api/verify', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'delete_ltl', ruleId }),
 })
 toast.success(`Regola ${ruleId} disattivata`)
 refresh()
 } catch (e: any) {
 toast.error(e.message)
 }
 }

 const addAxiom = async () => {
 if (!newAxiomText.trim()) {
 toast.error('Testo assioma obbligatorio')
 return
 }
 try {
 const r = await fetch('/api/verify', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'add_axiom', axiom: newAxiomText, priority: newAxiomPriority }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success('Assioma aggiunto')
 setNewAxiomText('')
 refresh()
 } else {
 toast.error(d.error)
 }
 } catch (e: any) {
 toast.error(e.message)
 }
 }

 const deleteAxiom = async (id: string) => {
 try {
 await fetch('/api/verify', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action: 'delete_axiom', id }),
 })
 toast.success('Assioma disattivato')
 refresh()
 } catch (e: any) {
 toast.error(e.message)
 }
 }

 return (
 <div className="space-y-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2">
 <GitBranch className="size-4" /> Editor Visuale Regole LTL
 </CardTitle>
 <CardDescription>
 Costruisci regole con sintassi LTL estesa (G, F, X, U, &&#124;||, !, -&gt;). Preview live della FSM compilata.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label className="text-xs">Rule ID</Label>
 <Input value={newRuleId} onChange={(e) => setNewRuleId(e.target.value)} placeholder="LTL-007" />
 </div>
 <div>
 <Label className="text-xs">Severity</Label>
 <Select value={newSeverity} onValueChange={(v: any) => setNewSeverity(v)}>
 <SelectTrigger><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="block">block (rifiuta azione)</SelectItem>
 <SelectItem value="warn">warn (solo avviso)</SelectItem>
 <SelectItem value="log">log (silenzioso)</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>

 <div>
 <Label className="text-xs">Formula LTL</Label>
 <Input
 value={newFormula}
 onChange={(e) => setNewFormula(e.target.value)}
 placeholder="G(high_risk -> X human_approval)"
 className={cn(
 'font-mono',
 preview?.valid === true && 'border-status-ok',
 preview?.valid === false && 'border-status-danger',
 )}
 />
 <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-2">
 {validating ? (
 <><RefreshCw className="size-3 animate-spin" /> validazione…</>
 ) : preview?.valid ? (
 <><CheckCircle2 className="size-3 text-status-ok" /> pattern: <code className="font-mono">{preview.pattern}</code></>
 ) : preview?.error ? (
 <><XCircle className="size-3 text-status-danger" /> {preview.error}</>
 ) : null}
 </div>
 </div>

 <div>
 <Label className="text-xs">Descrizione</Label>
 <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
 </div>

 {/* Pattern shortcuts */}
 <div>
 <Label className="text-xs flex items-center gap-1.5"><Lightbulb className="size-3" /> Pattern predefiniti</Label>
 <div className="flex flex-wrap gap-1.5 mt-1">
 {PATTERNS.map((p) => (
 <button
 key={p.label}
 onClick={() => setNewFormula(p.formula)}
 title={p.desc}
 className="text-[10px] font-mono px-2 py-1 rounded-md border bg-muted/50 hover:bg-muted hover:border-primary/50 transition-colors"
 >
 {p.label}
 </button>
 ))}
 </div>
 </div>

 {/* FSM preview */}
 {preview?.valid && preview.states && (
 <div className="border rounded-md p-3 bg-muted/20">
 <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
 <Eye className="size-3" /> FSM Compilata
 <Badge variant="outline" className="text-[10px] py-0 ml-auto">{preview.pattern}</Badge>
 </div>
 {preview.description && (
 <p className="text-[11px] text-muted-foreground mb-2">{preview.description}</p>
 )}
 <div className="flex flex-wrap gap-2">
 {preview.states.map((s) => (
 <div
 key={s.name}
 className={cn(
 'px-3 py-1.5 rounded-md border-2 text-xs font-mono',
 STATE_STYLE[s.type],
 )}
 >
 <div className="font-bold">{s.name}</div>
 <div className="text-[9px] uppercase opacity-70">{STATE_LABEL[s.type]}</div>
 </div>
 ))}
 </div>
 <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
 <span className="size-2 rounded-full bg-status-info" /> iniziale
 <span className="size-2 rounded-full bg-status-ok ml-2" /> accettante
 <span className="size-2 rounded-full bg-status-warn ml-2" /> in attesa
 <span className="size-2 rounded-full bg-status-danger ml-2" /> violazione
 </div>
 </div>
 )}

 <div className="flex gap-2">
 <Button size="sm" onClick={addRule} disabled={!preview?.valid}>
 <Save className="size-3.5 mr-1.5" /> Salva Regola
 </Button>
 <Button size="sm" variant="outline" onClick={() => setNewFormula('')}>
 <Trash2 className="size-3.5 mr-1.5" /> Pulisci
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Lista regole esistenti */}
 <Card>
 <CardHeader>
 <CardTitle className="text-sm">Regole LTL Attive</CardTitle>
 <CardDescription>{rules.length} regole totali</CardDescription>
 </CardHeader>
 <CardContent>
 <ScrollArea className="h-72 pr-2">
 {rules.length === 0 ? (
 <p className="text-xs text-muted-foreground italic">Nessuna regola.</p>
 ) : (
 <ul className="space-y-2">
 {rules.map((r) => (
 <li key={r.id} className="border rounded-md p-2.5 text-xs">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className="font-mono">{r.ruleId}</Badge>
 <Badge
 className={cn(
 'text-[10px] py-0',
 r.severity === 'block' && 'bg-status-danger text-status-danger border-status-danger/50 dark:bg-status-danger dark:text-status-danger',
 r.severity === 'warn' && 'bg-status-warn text-status-warn border-status-warn/50 dark:bg-status-warn dark:text-status-warn',
 r.severity === 'log' && 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300',
 )}
 >
 {r.severity}
 </Badge>
 <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono flex-1 truncate">
 {r.ltlFormula}
 </code>
 <Button
 size="sm"
 variant="ghost"
 className="h-6 px-2 text-[10px]"
 onClick={() => deleteRule(r.ruleId)}
 >
 <Trash2 className="size-3" />
 </Button>
 </div>
 {r.description && (
 <p className="text-muted-foreground text-[11px]">{r.description}</p>
 )}
 </li>
 ))}
 </ul>
 )}
 </ScrollArea>
 </CardContent>
 </Card>

 {/* Editor Assiomi Normativi */}
 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2">
 <Shield className="size-4" /> Editor Assiomi Normativi
 </CardTitle>
 <CardDescription>
 Gerarchia di priorità: legale (1) &gt; operativo (2) &gt; efficienza (3). Le violazioni di priorità più alta bloccano.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-[1fr,200px,auto] gap-2 items-end">
 <div>
 <Label className="text-xs">Testo assioma</Label>
 <Input
 value={newAxiomText}
 onChange={(e) => setNewAxiomText(e.target.value)}
 placeholder="Es: Non divulgare dati personali senza consenso"
 />
 </div>
 <div>
 <Label className="text-xs">Priorità</Label>
 <Select value={String(newAxiomPriority)} onValueChange={(v) => setNewAxiomPriority(Number(v))}>
 <SelectTrigger><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="1">1 - Legale</SelectItem>
 <SelectItem value="2">2 - Operativo</SelectItem>
 <SelectItem value="3">3 - Efficienza</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <Button size="sm" onClick={addAxiom} disabled={!newAxiomText.trim()}>
 <Plus className="size-3.5 mr-1.5" /> Aggiungi
 </Button>
 </div>

 <div className="space-y-2 mt-3">
 {[1, 2, 3].map((p) => (
 <div key={p} className="border-l-4 pl-3 py-1" style={{ borderColor: PRIORITY_LABEL[p]?.color.replace('bg-', '') }}>
 <div className="flex items-center gap-2 mb-1">
 <span className={cn('size-2 rounded-full', PRIORITY_LABEL[p].color)} />
 <span className="text-xs font-medium">Priorità {p} · {PRIORITY_LABEL[p].label}</span>
 <Badge variant="outline" className="text-[10px] py-0 ml-auto">
 {axioms.filter((a) => a.priority === p).length} assiomi
 </Badge>
 </div>
 <ul className="space-y-1">
 {axioms.filter((a) => a.priority === p).map((a) => (
 <li key={a.id} className="text-xs flex items-center gap-2 pl-3 group">
 <span className="text-muted-foreground flex-1">• {a.axiom}</span>
 {a.id.startsWith('default-') && (
 <Badge variant="secondary" className="text-[9px] py-0">default</Badge>
 )}
 {!a.id.startsWith('default-') && (
 <Button
 size="sm"
 variant="ghost"
 className="h-5 px-1.5 text-[10px] opacity-0 group-hover:opacity-100"
 onClick={() => deleteAxiom(a.id)}
 >
 <Trash2 className="size-3" />
 </Button>
 )}
 </li>
 ))}
 {axioms.filter((a) => a.priority === p).length === 0 && (
 <li className="text-[10px] text-muted-foreground italic pl-3">nessuno</li>
 )}
 </ul>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 </div>
 )
}
