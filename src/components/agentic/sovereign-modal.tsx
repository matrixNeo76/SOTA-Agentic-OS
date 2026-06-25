'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useSensoriumLive } from './use-sensorium-live'
import { toast } from 'sonner'
import {
 AlertTriangle, ShieldAlert, CheckCircle2, XCircle, Wrench, ArrowDownCircle, Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type BlockedAction = {
 id: string
 agentId: string
 action: string
 source: string
 axiomTrail: string
 readableExplanation: string
 status: string
 createdAt: string
}

const SOURCE_STYLE: Record<string, { color: string; icon: any; label: string }> = {
 ltl: { color: 'text-status-danger', icon: ShieldAlert, label: 'LTL Violation' },
 taint: { color: 'text-status-warn', icon: AlertTriangle, label: 'Taint Tracking' },
 normative: { color: 'text-cat-cognitive', icon: ShieldAlert, label: 'Normative Calculus' },
 hitl_gate: { color: 'text-cat-governance', icon: AlertTriangle, label: 'HITL Gate' },
}

/**
 * Container che ascolta eventi WebSocket e mostra il modale Sovereign
 * quando un'azione viene bloccata dai cancelli di sicurezza.
 *
 * Si auto-apre quando arriva un evento 'agent_event' con event='action_blocked'.
 * Inoltre, polling su /api/blocked-actions per recuperare pending actions.
 */
export function SovereignModalContainer() {
 const { events } = useSensoriumLive()
 const [pending, setPending] = useState<BlockedAction[]>([])
 const [currentIdx, setCurrentIdx] = useState(0)
 const [resolutionNote, setResolutionNote] = useState('')
 const [resolving, setResolving] = useState(false)

 // Polling blocked actions pending
 useEffect(() => {
 const load = async () => {
 try {
 const r = await fetch('/api/blocked-actions?action=pending')
 const d = await r.json()
 setPending(d.items || [])
 } catch {}
 }
 load()
 const t = setInterval(load, 5000)
 return () => clearInterval(t)
 }, [])

 // Quando arriva un evento WS di action_blocked, forza refresh
 useEffect(() => {
 const lastBlocked = events.find((e) => e.event === 'action_blocked')
 if (lastBlocked) {
 // refresh pending
 fetch('/api/blocked-actions?action=pending')
 .then((r) => r.json())
 .then((d) => setPending(d.items || []))
 }
 }, [events])

 const current = pending[currentIdx]

 const resolve = async (choice: 'approved' | 'modified' | 'downgraded' | 'rejected') => {
 if (!current) return
 setResolving(true)
 try {
 const r = await fetch('/api/blocked-actions', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'resolve',
 blockedId: current.id,
 choice,
 resolvedBy: 'admin',
 resolutionDetails: { note: resolutionNote },
 }),
 })
 const d = await r.json()
 if (d.ok) {
 toast.success(`Azione ${choice}: ${current.action.slice(0, 50)}`)
 setResolutionNote('')
 // Aggiorna pending
 const r2 = await fetch('/api/blocked-actions?action=pending')
 const d2 = await r2.json()
 setPending(d2.items || [])
 setCurrentIdx(0)
 }
 } catch (e: any) {
 toast.error(e.message)
 } finally {
 setResolving(false)
 }
 }

 if (!current) return null

 const style = SOURCE_STYLE[current.source] || SOURCE_STYLE.ltl
 const Icon = style.icon
 let trail: { step: string; rule: string; result: string }[] = []
 try { trail = JSON.parse(current.axiomTrail) } catch {}

 return (
 <Dialog open={!!current} onOpenChange={() => {}}>
 <DialogContent className="max-w-2xl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <Icon className={cn('size-5', style.color)} />
 Azione bloccata dai cancelli di sicurezza
 </DialogTitle>
 <DialogDescription>
 L'agente ha tentato un'azione che richiede la tua validazione come Sovereign Validator.
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4">
 {/* Action attempted */}
 <div className="border rounded-md p-3 bg-muted/30">
 <div className="flex items-center gap-2 mb-1">
 <Badge variant="outline" className={cn('font-mono text-[10px]', style.color)}>
 {style.label}
 </Badge>
 <Badge variant="outline" className="text-[10px] font-mono">{current.agentId}</Badge>
 <span className="text-[10px] text-muted-foreground ml-auto">
 {new Date(current.createdAt).toLocaleString('it-IT')}
 </span>
 </div>
 <div className="text-xs">
 <span className="text-muted-foreground">Azione tentata:</span>{' '}
 <strong>"{current.action}"</strong>
 </div>
 </div>

 {/* Readable explanation */}
 <div>
 <Label className="text-xs font-medium">Spiegazione</Label>
 <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded-md p-3 mt-1 max-h-32 overflow-auto">
{current.readableExplanation}
 </pre>
 </div>

 {/* Axiom Trail */}
 {trail.length > 0 && (
 <div>
 <Label className="text-xs font-medium">Axiom Trail (catena logica)</Label>
 <div className="mt-1 space-y-1.5">
 {trail.map((step, i) => (
 <div key={i} className="text-xs border-l-2 border-primary/40 pl-2 py-1">
 <div className="flex items-center gap-1.5">
 <Badge variant="outline" className="text-[9px] py-0 font-mono">{step.step}</Badge>
 <span className="font-mono text-[10px]">{step.rule}</span>
 </div>
 {step.result && (
 <div className="text-[10px] text-muted-foreground mt-0.5">→ {step.result}</div>
 )}
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Resolution note */}
 <div>
 <Label className="text-xs font-medium">Nota di risoluzione (opzionale)</Label>
 <Textarea
 value={resolutionNote}
 onChange={(e) => setResolutionNote(e.target.value)}
 placeholder="Es. Approvato dopo verifica manuale del file di log"
 rows={2}
 className="text-xs"
 />
 </div>

 {/* Pending count */}
 {pending.length > 1 && (
 <div className="text-[10px] text-muted-foreground text-center">
 {currentIdx + 1} di {pending.length} azioni in attesa
 </div>
 )}
 </div>

 <DialogFooter className="flex-wrap gap-2">
 <Button
 variant="default"
 size="sm"
 onClick={() => resolve('approved')}
 disabled={resolving}
 className="bg-status-ok hover:bg-status-ok/90"
 >
 <CheckCircle2 className="size-3.5 mr-1.5" />
 Approva (assumi responsabilità)
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => resolve('modified')}
 disabled={resolving}
 >
 <Wrench className="size-3.5 mr-1.5" />
 Modifica parametri
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => resolve('downgraded')}
 disabled={resolving}
 >
 <ArrowDownCircle className="size-3.5 mr-1.5" />
 Declassa task
 </Button>
 <Button
 variant="destructive"
 size="sm"
 onClick={() => resolve('rejected')}
 disabled={resolving}
 >
 <Ban className="size-3.5 mr-1.5" />
 Rifiuta
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 )
}
