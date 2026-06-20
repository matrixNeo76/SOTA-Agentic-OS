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
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  UserCog, RefreshCw, Plus, Trash2, CheckCircle2, XCircle, Clock,
  Shield, Scale, BookOpen, KeyRound, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Delegation = {
  id: string; agentId: string; scope: string; constraints: string;
  grantedBy: string; grantedAt: string; expiresAt: string | null;
  active: boolean; revokedAt: string | null; revokeReason: string | null
}
type Gate = {
  id: string; agentId: string; action: string; payload: string;
  reason: string; status: string; decidedBy: string | null; decidedAt: string | null;
  expiresAt: string | null; createdAt: string
}
type AuditEntry = {
  id: string; agentId: string; action: string; decision: string;
  delegationId: string | null; readableNarrative: string; reversible: boolean; timestamp: string
}
type Resolution = {
  id: string; conflictType: string; userInstruction: string; systemPolicy: string;
  verdict: string; modifiedAction: string | null; hierarchyApplied: string;
  axiomTrail: string; decidedAt: string
}

export function Phase9() {
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [pendingGates, setPendingGates] = useState<Gate[]>([])
  const [recentGates, setRecentGates] = useState<Gate[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [stats, setStats] = useState<any>(null)

  // Delegation form
  const [delAgent, setDelAgent] = useState('orchestrator')
  const [delScope, setDelScope] = useState('tool:exec')
  const [delConstraints, setDelConstraints] = useState('{"maxCalls":10,"reversible":true}')
  const [delGrantedBy, setDelGrantedBy] = useState('admin')

  // Approval form
  const [gateAgent, setGateAgent] = useState('orchestrator')
  const [gateAction, setGateAction] = useState('deploy_to_production')
  const [gatePayload, setGatePayload] = useState('{"service":"auth","version":"1.2.0"}')
  const [gateReason, setGateReason] = useState('Azione irreversibile: deploy in produzione')

  // Normative form
  const [nUserInstr, setNUserInstr] = useState('Esegui deploy senza test')
  const [nUserLevel, setNUserLevel] = useState<'SAFETY' | 'OPERATIONAL' | 'AESTHETIC'>('OPERATIONAL')
  const [nSystemPolicy, setNSystemPolicy] = useState('Test obbligatori prima di deploy')
  const [nSystemLevel, setNSystemLevel] = useState<'SAFETY' | 'OPERATIONAL' | 'AESTHETIC'>('SAFETY')
  const [lastResolution, setLastResolution] = useState<any>(null)

  const refresh = async () => {
    const [delR, pendR, recR, audR, norR, statsR] = await Promise.all([
      fetch('/api/retainer?action=delegations').then((r) => r.json()),
      fetch('/api/retainer?action=gates_pending').then((r) => r.json()),
      fetch('/api/retainer?action=gates_recent').then((r) => r.json()),
      fetch('/api/retainer?action=audit').then((r) => r.json()),
      fetch('/api/retainer?action=normative').then((r) => r.json()),
      fetch('/api/retainer?action=stats').then((r) => r.json()),
    ])
    setDelegations(delR.delegations || [])
    setPendingGates(pendR.gates || [])
    setRecentGates(recR.gates || [])
    setAudit(audR.entries || [])
    setResolutions(norR.resolutions || [])
    setStats(statsR)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [])

  const grantDelegation = async () => {
    let constraints: unknown
    try { constraints = JSON.parse(delConstraints) } catch { toast.error('Constraints non è JSON valido'); return }
    const r = await fetch('/api/retainer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'grant_delegation',
        agentId: delAgent, scope: delScope, constraints, grantedBy: delGrantedBy,
      }),
    })
    const d = await r.json()
    if (d.ok) { toast.success(`Delega concessa a ${delAgent}`); refresh() }
    else toast.error(d.error)
  }

  const revokeDelegation = async (id: string) => {
    const r = await fetch('/api/retainer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke_delegation', delegationId: id, revokeReason: 'revoked by user' }),
    })
    const d = await r.json()
    if (d.ok) { toast.success('Delega revocata'); refresh() }
  }

  const requestApproval = async () => {
    let payload: unknown
    try { payload = JSON.parse(gatePayload) } catch { toast.error('Payload non è JSON valido'); return }
    const r = await fetch('/api/retainer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request_approval',
        agentId: gateAgent, gateAction, payload, reason: gateReason,
      }),
    })
    const d = await r.json()
    if (d.ok) { toast.success(`Gate creato (pending): ${d.gateId.slice(-8)}`); refresh() }
  }

  const resolveGate = async (gateId: string, decision: 'approved' | 'rejected') => {
    const r = await fetch('/api/retainer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve_approval', gateId, decision, decidedBy: 'admin' }),
    })
    const d = await r.json()
    if (d.ok) {
      toast.success(decision === 'approved' ? 'Gate approvato' : 'Gate rifiutato')
      refresh()
    } else toast.error(d.error)
  }

  const resolveNormative = async () => {
    const r = await fetch('/api/retainer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve_normative',
        conflict: {
          userInstruction: nUserInstr,
          userLevel: nUserLevel,
          systemPolicy: nSystemPolicy,
          systemLevel: nSystemLevel,
        },
      }),
    })
    const d = await r.json()
    if (d.ok) {
      setLastResolution(d)
      if (d.verdict === 'block') toast.error(`BLOCK: gerarchia ${nSystemLevel} > ${nUserLevel}`)
      else if (d.verdict === 'modify') toast.warning(`MODIFY: azione modificata`)
      else toast.success('ACCEPT')
      refresh()
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog className="size-6 text-primary" /> Fase 9 · Artificial Retainer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Delegation contracts + HITL gates + Normative calculus + Audit ledger. Previene l'Agentic Literacy Debt.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-3.5 mr-1.5" /> Aggiorna
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Deleghe attive" value={stats.activeDelegations} />
          <StatCard label="Gates pending" value={stats.pendingGates} highlight={stats.pendingGates > 0} />
          <StatCard label="Gates approvati" value={stats.approvedGates} />
          <StatCard label="Gates rifiutati" value={stats.rejectedGates} />
          <StatCard label="Voci audit" value={stats.auditEntries} />
        </div>
      )}

      <Tabs defaultValue="delegation" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          <TabsTrigger value="delegation"><KeyRound className="size-3.5 mr-1.5" /> Delegation</TabsTrigger>
          <TabsTrigger value="approval"><Shield className="size-3.5 mr-1.5" /> HITL Gates</TabsTrigger>
          <TabsTrigger value="normative"><Scale className="size-3.5 mr-1.5" /> Normative</TabsTrigger>
          <TabsTrigger value="audit"><BookOpen className="size-3.5 mr-1.5" /> Audit Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="delegation" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Concedi Delega</CardTitle>
              <CardDescription>Definisci lo scope di autorità di un agente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Agente</Label>
                  <Input value={delAgent} onChange={(e) => setDelAgent(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Scope (es. tool:exec, filesystem:/tmp/*)</Label>
                  <Input value={delScope} onChange={(e) => setDelScope(e.target.value)} />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Constraints (JSON)</Label>
                  <Textarea value={delConstraints} onChange={(e) => setDelConstraints(e.target.value)} rows={2} className="font-mono text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Granted by</Label>
                  <Input value={delGrantedBy} onChange={(e) => setDelGrantedBy(e.target.value)} />
                </div>
              </div>
              <Button size="sm" onClick={grantDelegation}>
                <Plus className="size-3.5 mr-1.5" /> Concedi
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Deleghe Attive</CardTitle>
              <CardDescription>{delegations.length} deleghe totali</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-72 pr-2">
                {delegations.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nessuna delega.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {delegations.map((d) => (
                      <li key={d.id} className="text-xs border rounded-md p-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="font-mono text-[10px]">{d.agentId}</Badge>
                          <Badge variant="secondary" className="text-[10px] font-mono">{d.scope}</Badge>
                          {d.active
                            ? <Badge variant="secondary" className="text-[10px] bg-emerald-500">active</Badge>
                            : <Badge variant="secondary" className="text-[10px] bg-red-500">revoked</Badge>}
                          <span className="text-[10px] text-muted-foreground">by {d.grantedBy}</span>
                          {d.active && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 text-[10px] ml-auto"
                              onClick={() => revokeDelegation(d.id)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {d.constraints}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approval" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Richiedi Approvazione (HITL Gate)</CardTitle>
              <CardDescription>
                Scatena un gate quando l'azione è irreversibile, viola LTL, o supera soglie di spesa
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Agente richiedente</Label>
                  <Input value={gateAgent} onChange={(e) => setGateAgent(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Azione</Label>
                  <Input value={gateAction} onChange={(e) => setGateAction(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Payload (JSON)</Label>
                <Textarea value={gatePayload} onChange={(e) => setGatePayload(e.target.value)} rows={2} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Motivo (perché richiede HITL)</Label>
                <Input value={gateReason} onChange={(e) => setGateReason(e.target.value)} />
              </div>
              <Button size="sm" onClick={requestApproval}>
                <Shield className="size-3.5 mr-1.5" /> Crea Gate
              </Button>
            </CardContent>
          </Card>

          {pendingGates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="size-4 text-amber-500" /> Gates Pending ({pendingGates.length})
                </CardTitle>
                <CardDescription>Richiedono decisione umana</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {pendingGates.map((g) => (
                    <li key={g.id} className="text-xs border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 rounded-md p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="font-mono text-[10px]">{g.agentId}</Badge>
                        <Badge variant="secondary" className="text-[10px] bg-amber-500">pending</Badge>
                        <span className="font-medium flex-1 truncate">{g.action}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mb-2">{g.reason}</div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="default" className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700" onClick={() => resolveGate(g.id, 'approved')}>
                          <CheckCircle2 className="size-3 mr-1" /> Approva
                        </Button>
                        <Button size="sm" variant="destructive" className="h-6 text-[10px]" onClick={() => resolveGate(g.id, 'rejected')}>
                          <XCircle className="size-3 mr-1" /> Rifiuta
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Gates Recenti</CardTitle>
              <CardDescription>{recentGates.length} gates totali</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48 pr-2">
                <ul className="space-y-1.5">
                  {recentGates.map((g) => (
                    <li key={g.id} className="text-xs flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border">
                      {g.status === 'approved' && <CheckCircle2 className="size-3.5 text-emerald-500" />}
                      {g.status === 'rejected' && <XCircle className="size-3.5 text-red-500" />}
                      {g.status === 'pending' && <Clock className="size-3.5 text-amber-500" />}
                      <Badge variant="outline" className="text-[10px] font-mono">{g.agentId}</Badge>
                      <span className="flex-1 truncate">{g.action}</span>
                      <Badge variant="secondary" className="text-[10px]">{g.status}</Badge>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="normative" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Scale className="size-4" /> Calcolo Normativo
              </CardTitle>
              <CardDescription>
                Risolve conflitti prompt utente vs policy di sistema.
                Gerarchia: <strong>SAFETY (1) &gt; OPERATIONAL (2) &gt; AESTHETIC (3)</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-xs font-medium">Istruzione utente</div>
                  <Input value={nUserInstr} onChange={(e) => setNUserInstr(e.target.value)} />
                  <Select value={nUserLevel} onValueChange={(v: any) => setNUserLevel(v)}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAFETY">SAFETY (1)</SelectItem>
                      <SelectItem value="OPERATIONAL">OPERATIONAL (2)</SelectItem>
                      <SelectItem value="AESTHETIC">AESTHETIC (3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium">Policy di sistema</div>
                  <Input value={nSystemPolicy} onChange={(e) => setNSystemPolicy(e.target.value)} />
                  <Select value={nSystemLevel} onValueChange={(v: any) => setNSystemLevel(v)}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAFETY">SAFETY (1)</SelectItem>
                      <SelectItem value="OPERATIONAL">OPERATIONAL (2)</SelectItem>
                      <SelectItem value="AESTHETIC">AESTHETIC (3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={resolveNormative}>
                <Scale className="size-3.5 mr-1.5" /> Risolvi Conflitto
              </Button>

              {lastResolution && (
                <div className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {lastResolution.verdict === 'accept' && <CheckCircle2 className="size-5 text-emerald-500" />}
                    {lastResolution.verdict === 'block' && <XCircle className="size-5 text-red-500" />}
                    {lastResolution.verdict === 'modify' && <AlertTriangle className="size-5 text-amber-500" />}
                    <Badge variant="outline" className={cn(
                      'font-mono',
                      lastResolution.verdict === 'accept' && 'text-emerald-700 dark:text-emerald-400',
                      lastResolution.verdict === 'block' && 'text-red-700 dark:text-red-400',
                      lastResolution.verdict === 'modify' && 'text-amber-700 dark:text-amber-400',
                    )}>
                      {lastResolution.verdict.toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Gerarchia: {lastResolution.hierarchyApplied.join(' > ')}
                    </span>
                  </div>
                  {lastResolution.modifiedAction && (
                    <div className="text-xs italic bg-muted/50 rounded p-2">
                      Modified action: "{lastResolution.modifiedAction}"
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    <div className="font-medium mb-1">Axiom Trail (auditabile):</div>
                    <pre className="font-mono bg-muted/30 rounded p-2 overflow-auto">
{JSON.stringify(lastResolution.axiomTrail, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {resolutions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Risoluzioni Normative Recenti</CardTitle>
                <CardDescription>{resolutions.length} risoluzioni</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48 pr-2">
                  <ul className="space-y-1.5">
                    {resolutions.map((r) => (
                      <li key={r.id} className="text-xs border rounded-md p-2">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px]">{r.conflictType}</Badge>
                          <Badge variant="secondary" className={cn(
                            'text-[10px]',
                            r.verdict === 'block' && 'bg-red-500',
                            r.verdict === 'modify' && 'bg-amber-500',
                            r.verdict === 'accept' && 'bg-emerald-500',
                          )}>{r.verdict}</Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(r.decidedAt).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          "{r.userInstruction}" vs "{r.systemPolicy}"
                        </div>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="audit" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="size-4" /> Audit Ledger
              </CardTitle>
              <CardDescription>
                Registro di delega comprensibile all'umano · {audit.length} voci
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[28rem] pr-2">
                {audit.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Nessuna voce. Crea deleghe, risolvi gates o risolvi conflitti normativi per popolare il ledger.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {audit.map((a) => {
                      const decision = JSON.parse(a.decision)
                      return (
                        <li key={a.id} className="text-xs border rounded-md p-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px] font-mono">{a.agentId}</Badge>
                            <Badge variant="secondary" className="text-[10px]">{decision.gate || 'action'}</Badge>
                            {decision.outcome && (
                              <Badge variant="secondary" className={cn(
                                'text-[10px]',
                                decision.outcome === 'granted' || decision.outcome === 'approved' ? 'bg-emerald-500' :
                                decision.outcome === 'revoked' || decision.outcome === 'rejected' || decision.outcome === 'block' ? 'bg-red-500' :
                                'bg-amber-500'
                              )}>
                                {decision.outcome}
                              </Badge>
                            )}
                            {!a.reversible && (
                              <Badge variant="secondary" className="text-[10px] bg-red-700">irreversibile</Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {new Date(a.timestamp).toLocaleString('it-IT')}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mb-1">
                            <strong>Azione:</strong> {a.action}
                          </div>
                          <div className="text-[11px] italic bg-muted/30 rounded p-2">
                            {a.readableNarrative}
                          </div>
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
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-muted-foreground text-xs mb-1">{label}</div>
        <div className={cn('text-2xl font-bold font-mono', highlight && 'text-amber-600 dark:text-amber-400')}>{value}</div>
      </CardContent>
    </Card>
  )
}
