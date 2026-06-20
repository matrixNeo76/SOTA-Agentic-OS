'use client'

import { useDashboard } from './use-dashboard'
import { useStore } from '@/lib/store'
import { LiveFeed } from './live-feed'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Database, Workflow, Compass, ShieldCheck, Sparkles, CheckCircle2, XCircle,
  AlertTriangle, Cpu, Layers, Activity, Zap, RefreshCw, Rocket,
  Scissors, GitFork, FunctionSquare, UserCog,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { toast } from 'sonner'

export function Overview() {
  const { data, loading, refresh } = useDashboard()
  const { setActivePhase } = useStore()
  const [seeding, setSeeding] = useState(false)

  const seed = async () => {
    setSeeding(true)
    try {
      const r = await fetch('/api/seed', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        toast.success('Sistema inizializzato con dati di esempio')
        refresh()
      } else {
        toast.error(`Errore: ${d.error}`)
      }
    } catch (e: any) {
      toast.error(`Errore: ${e.message}`)
    } finally {
      setSeeding(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const isEmpty =
    data.phase1.episodic === 0 &&
    data.phase2.plans === 0 &&
    data.phase4.verificationEvents === 0

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sistema Operativo Agentico SOTA</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Implementazione ingegneristica del blueprint: 5 micro-fasi operative, kernel transazionale,
            memoria persistente a 3 livelli, verifica formale LTL, apprendimento riflessivo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5 mr-1.5" />
            Aggiorna
          </Button>
          <Button size="sm" onClick={seed} disabled={seeding}>
            <Rocket className="size-3.5 mr-1.5" />
            {seeding ? 'Inizializzazione…' : 'Inizializza Sistema'}
          </Button>
        </div>
      </div>

      {isEmpty && (
        <Card className="border-dashed border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong>Sistema non inizializzato.</strong> Clicca <em>Inizializza Sistema</em> per
              caricare dati di esempio in tutte le 5 fasi (memoria, regole LTL, assiomi, template, euristiche).
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <PhaseCard
          phase="1"
          title="Stato & Memoria"
          subtitle="NS-Mem · PatchBoard · Sensorium"
          icon={Database}
          onClick={() => setActivePhase('phase1')}
          stats={[
            { label: 'Episodi', value: data.phase1.episodic },
            { label: 'Entità', value: data.phase1.semantic },
            { label: 'Regole', value: data.phase1.logical },
            { label: 'Patch', value: data.phase1.patches, tone: data.phase1.rejected > 0 ? 'warn' : 'ok' },
          ]}
          description="Memoria a 3 livelli (episodico, semantico, logico) con EMA anti-drift. Stato globale come albero JSON, mutato solo tramite transazioni validate."
        />
        <PhaseCard
          phase="2"
          title="Orchestrazione"
          subtitle="DynAMO · Topological Scheduler · Compiled AI"
          icon={Workflow}
          onClick={() => setActivePhase('phase2')}
          stats={[
            { label: 'Piani', value: data.phase2.plans },
            { label: 'Task', value: data.phase2.planTasks },
            { label: 'Artefatti', value: data.phase2.compiledArtifacts },
            { label: 'Deployed', value: data.phase2.deployedArtifacts, tone: 'ok' },
          ]}
          description="Piani JSON-Schema-validati → DAG topologico per parallelismo sicuro. Codice LLM validato a 4 stadi (Safety, Syntax, Execution, Accuracy)."
        />
        <PhaseCard
          phase="3"
          title="Steering"
          subtitle="ACTS Controller · Budget Token"
          icon={Compass}
          onClick={() => setActivePhase('phase3')}
          stats={[
            { label: 'Eventi', value: data.phase3.steeringEvents },
            { label: 'Strategie', value: 5 },
          ]}
          description="Controller ultraleggero decide PLAN/EXECUTE/CHECK/REFLECT e invia steering phrase. Budget O(1) per decisione, no catene di pensiero non strutturate."
        />
        <PhaseCard
          phase="4"
          title="Zero-Trust & Verifica"
          subtitle="AgentVerify · LTL · Taint · Normative"
          icon={ShieldCheck}
          onClick={() => setActivePhase('phase4')}
          stats={[
            { label: 'Eventi', value: data.phase4.verificationEvents },
            { label: 'Reject', value: data.phase4.verifRejects, tone: data.phase4.verifRejects > 0 ? 'danger' : 'ok' },
            { label: 'Warn', value: data.phase4.verifWarns, tone: data.phase4.verifWarns > 0 ? 'warn' : 'ok' },
            { label: 'Taint bloccati', value: data.phase4.blockedTaints, tone: data.phase4.blockedTaints > 0 ? 'danger' : 'ok' },
          ]}
          description="Monitor FSM con regole LTL compilate (overhead O(1)). Taint tracking per input ostili. Cancello Normativo Stoico con gerarchia di priorità assiomatica."
        />
        <PhaseCard
          phase="5"
          title="Riflessione & Evoluzione"
          subtitle="ERL · AutoSOTA · Red Lines"
          icon={Sparkles}
          onClick={() => setActivePhase('phase5')}
          stats={[
            { label: 'Euristiche', value: data.phase5.heuristics },
            { label: 'Riflessioni', value: data.phase5.reflections },
            { label: 'Red Line rifiuti', value: data.phase5.redLineFlags, tone: data.phase5.redLineFlags > 0 ? 'warn' : 'ok' },
          ]}
          description="Dopo ogni operazione: analisi causale → estrazione euristica → valutazione Red Line → memorizzazione. RAG semantico recupera euristiche rilevanti per nuovi task."
        />
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="size-4" /> Kernel Audit Log
              </CardTitle>
              <Badge variant="outline" className="text-xs">{data.agentLogsTotal} totali</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="h-44 pr-2">
              {data.recentLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nessun evento registrato.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.recentLogs.map((log) => (
                    <li key={log.id} className="text-xs flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] py-0 px-1.5 font-mono shrink-0',
                          log.level === 'warn' && 'border-amber-500 text-amber-700 dark:text-amber-400',
                          log.level === 'error' && 'border-red-500 text-red-700 dark:text-red-400'
                        )}
                      >
                        P{log.phase}
                      </Badge>
                      <span className="text-muted-foreground font-mono shrink-0">{log.agentId}</span>
                      <span className="font-mono truncate">{log.event}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Fasi 6-9 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <PhaseCard
          phase="6"
          title="Context Engineering"
          subtitle="Ring buffer · Summarization · Anti context-rot"
          icon={Scissors}
          onClick={() => setActivePhase('phase6')}
          stats={[
            { label: 'Active', value: data.phase6?.activeCalls || 0 },
            { label: 'Evicted', value: data.phase6?.evictedCalls || 0 },
            { label: 'Summary', value: data.phase6?.summaries || 0 },
            { label: 'Tok salvati', value: data.phase6?.totalTokensSaved || 0, tone: 'ok' },
          ]}
          description="Ring buffer N coppie Tool Call/Response + summarization asincrona. Previene il context rot mantenendo consapevolezza situazionale globale."
        />
        <PhaseCard
          phase="7"
          title="Dominator Trees"
          subtitle="PTA · Dominator Extraction · Coverage"
          icon={GitFork}
          onClick={() => setActivePhase('phase7')}
          stats={[
            { label: 'Tracce', value: data.phase7?.traces || 0 },
            { label: 'PTA', value: data.phase7?.ptas || 0 },
            { label: 'Validazioni', value: data.phase7?.validations || 0 },
            { label: 'Avg cov', value: ((data.phase7?.avgCoverage || 0) * 100).toFixed(0) + '%', tone: (data.phase7?.avgCoverage || 0) >= 0.7 ? 'ok' : 'warn' },
          ]}
          description="Fonde tracce positive in PTA, estrae dominatori (stati essenziali), calcola coverage per tollerare deviazioni non critiche."
        />
        <PhaseCard
          phase="8"
          title="Lean4 Formal Verify"
          subtitle="Contratti · Verifica · LeanEvolve"
          icon={FunctionSquare}
          onClick={() => setActivePhase('phase8')}
          stats={[
            { label: 'Contratti', value: data.phase8?.contracts || 0 },
            { label: 'Verificati', value: data.phase8?.verifiedContracts || 0, tone: 'ok' },
            { label: 'Workflow', value: data.phase8?.verifiedWorkflows || 0 },
            { label: 'Evolve', value: data.phase8?.evolveEvents || 0 },
          ]}
          description="Traduce DAG in contratti formali (pre/post conditions). Verifica simbolica. LeanEvolve: recovery localizzata su failure con ri-validazione."
        />
        <PhaseCard
          phase="9"
          title="Artificial Retainer"
          subtitle="Delegation · HITL · Normative · Audit"
          icon={UserCog}
          onClick={() => setActivePhase('phase9')}
          stats={[
            { label: 'Deleghe', value: data.phase9?.activeDelegations || 0 },
            { label: 'Gates pend', value: data.phase9?.pendingGates || 0, tone: (data.phase9?.pendingGates || 0) > 0 ? 'warn' : 'ok' },
            { label: 'Audit', value: data.phase9?.auditEntries || 0 },
            { label: 'Block norm', value: data.phase9?.blockedResolutions || 0, tone: (data.phase9?.blockedResolutions || 0) > 0 ? 'danger' : 'ok' },
          ]}
          description="Delegation contracts, HITL gates per azioni irreversibili, Normative Calculus per conflitti prompt vs policy, Audit Ledger comprensibile all'umano."
        />
      </div>

      <LiveFeed />
    </div>
  )
}

function PhaseCard({
  phase, title, subtitle, icon: Icon, onClick, stats, description,
}: {
  phase: string
  title: string
  subtitle: string
  icon: any
  onClick: () => void
  stats: { label: string; value: number; tone?: 'ok' | 'warn' | 'danger' }[]
  description: string
}) {
  return (
    <Card
      className="overflow-hidden cursor-pointer hover:border-primary/50 transition-colors group"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Icon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {title}
                <Badge variant="secondary" className="text-[10px]">Fase {phase}</Badge>
              </CardTitle>
              <CardDescription className="text-xs">{subtitle}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        <div className="grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="text-center p-2 rounded-md bg-muted/50">
              <div className={cn(
                'text-lg font-bold font-mono',
                s.tone === 'warn' && 'text-amber-600 dark:text-amber-400',
                s.tone === 'danger' && 'text-red-600 dark:text-red-400',
                s.tone === 'ok' && s.value > 0 && 'text-emerald-600 dark:text-emerald-400'
              )}>
                {s.value}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
