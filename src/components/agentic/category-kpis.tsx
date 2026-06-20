'use client'

import { useStore, type PhaseCategory } from '@/lib/store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

type CategoryKpi = {
  category: PhaseCategory
  label: string
  color: string
  metrics: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'danger' }[]
  primaryPhase: string  // fase principale della categoria (per Quick Action)
  primaryLabel: string  // etichetta bottone
}

/**
 * KPI compatti per categoria tematica.
 */
export function CategoryKpis({ data }: { data: any }) {
  const { setActivePhase } = useStore()

  if (!data) return null

  const categories: CategoryKpi[] = [
    {
      category: 'foundation',
      label: 'Foundation',
      color: 'text-sky-600 dark:text-sky-400',
      primaryPhase: 'phase1',
      primaryLabel: 'Gestisci memoria',
      metrics: [
        { label: 'Episodi', value: data.phase1?.episodic || 0 },
        { label: 'Entità', value: data.phase1?.semantic || 0 },
        { label: 'Active calls', value: data.phase6?.activeCalls || 0 },
        { label: 'Tok salvati', value: data.phase6?.totalTokensSaved || 0, tone: 'ok' },
      ],
    },
    {
      category: 'orchestration',
      label: 'Orchestration',
      color: 'text-emerald-600 dark:text-emerald-400',
      primaryPhase: 'phase2',
      primaryLabel: 'Crea piano',
      metrics: [
        { label: 'Piani', value: data.phase2?.plans || 0 },
        { label: 'Tracce', value: data.phase7?.traces || 0 },
        { label: 'Alberi obj', value: data.phase12?.trees || 0 },
        { label: 'Avg coverage', value: ((data.phase7?.avgCoverage || 0) * 100).toFixed(0) + '%', tone: 'ok' },
      ],
    },
    {
      category: 'cognitive',
      label: 'Cognitive',
      color: 'text-violet-600 dark:text-violet-400',
      primaryPhase: 'phase3',
      primaryLabel: 'Steering step',
      metrics: [
        { label: 'Steering ev', value: data.phase3?.steeringEvents || 0 },
        { label: 'Sessioni', value: data.phase10?.sessions || 0 },
        { label: 'Affect samp', value: data.phase11?.samples || 0 },
        { label: 'Interventi', value: data.phase11?.interventions || 0, tone: data.phase11?.interventions ? 'danger' : 'ok' },
      ],
    },
    {
      category: 'trust',
      label: 'Trust',
      color: 'text-red-600 dark:text-red-400',
      primaryPhase: 'phase4',
      primaryLabel: 'Verifica evento',
      metrics: [
        { label: 'LTL ev', value: data.phase4?.verificationEvents || 0 },
        { label: 'Reject', value: data.phase4?.verifRejects || 0, tone: data.phase4?.verifRejects ? 'danger' : 'ok' },
        { label: 'Contratti', value: data.phase8?.contracts || 0 },
        { label: 'Quorum ok', value: data.phase13?.acceptedQuorum || 0, tone: 'ok' },
      ],
    },
    {
      category: 'learning',
      label: 'Learning',
      color: 'text-amber-600 dark:text-amber-400',
      primaryPhase: 'phase5',
      primaryLabel: 'Estrai euristica',
      metrics: [
        { label: 'Euristiche', value: data.phase5?.heuristics || 0 },
        { label: 'Riflessioni', value: data.phase5?.reflections || 0 },
        { label: 'Red line', value: data.phase5?.redLineFlags || 0, tone: data.phase5?.redLineFlags ? 'warn' : 'ok' },
      ],
    },
    {
      category: 'governance',
      label: 'Governance',
      color: 'text-pink-600 dark:text-pink-400',
      primaryPhase: 'phase9',
      primaryLabel: 'Gestisci deleghe',
      metrics: [
        { label: 'Deleghe', value: data.phase9?.activeDelegations || 0 },
        { label: 'Gates pend', value: data.phase9?.pendingGates || 0, tone: data.phase9?.pendingGates ? 'warn' : 'ok' },
        { label: 'Audit', value: data.phase9?.auditEntries || 0 },
        { label: 'Block norm', value: data.phase9?.blockedResolutions || 0, tone: data.phase9?.blockedResolutions ? 'danger' : 'ok' },
      ],
    },
    {
      category: 'infrastructure',
      label: 'Infrastructure',
      color: 'text-cyan-600 dark:text-cyan-400',
      primaryPhase: 'phase14',
      primaryLabel: 'Route prompt',
      metrics: [
        { label: 'Decisioni', value: data.phase14?.decisions || 0 },
        { label: 'Primary', value: data.phase14?.primary || 0, tone: 'ok' },
        { label: 'Ensemble', value: data.phase14?.ensemble || 0, tone: data.phase14?.ensemble ? 'warn' : 'ok' },
        { label: 'Critic', value: data.phase14?.critic || 0, tone: data.phase14?.critic ? 'warn' : 'ok' },
      ],
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {categories.map((c) => (
        <Card key={c.category} className="overflow-hidden hover:border-primary/30 transition-colors cursor-pointer group" onClick={() => setActivePhase(c.primaryPhase as any)}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className={cn('text-xs font-bold uppercase tracking-wide', c.color)}>
                {c.label}
              </CardTitle>
              <ArrowRight className="size-3 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-transform" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-1.5">
              {c.metrics.map((m) => (
                <div key={m.label} className="text-center">
                  <div className={cn(
                    'text-base font-bold font-mono',
                    m.tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
                    m.tone === 'warn' && 'text-amber-600 dark:text-amber-400',
                    m.tone === 'danger' && 'text-red-600 dark:text-red-400',
                  )}>
                    {m.value}
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground flex items-center gap-1">
              <Zap className="size-2.5" />
              {c.primaryLabel}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * Quick Actions: flussi comuni one-click.
 */
export function QuickActions() {
  const { setActivePhase } = useStore()

  const actions = [
    {
      label: 'Pianifica nuovo task',
      desc: 'Genera piano JSON via LLM e DAG topologico',
      phase: 'phase2' as const,
      color: 'border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/20',
    },
    {
      label: 'Verifica traccia esecuzione',
      desc: 'Valida con dominator coverage score',
      phase: 'phase7' as const,
      color: 'border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/20',
    },
    {
      label: 'Richiedi approvazione umana',
      desc: 'HITL gate per azioni irreversibili',
      phase: 'phase9' as const,
      color: 'border-pink-500/40 hover:bg-pink-50 dark:hover:bg-pink-950/20',
    },
    {
      label: 'Route prompt intelligente',
      desc: 'Ensemble fallback adattivo',
      phase: 'phase14' as const,
      color: 'border-cyan-500/40 hover:bg-cyan-50 dark:hover:bg-cyan-950/20',
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          Quick Actions
        </CardTitle>
        <CardDescription className="text-xs">Flussi comuni one-click</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => setActivePhase(a.phase)}
              className={cn(
                'text-left p-3 rounded-md border bg-card transition-colors',
                a.color
              )}
            >
              <div className="text-xs font-medium mb-0.5">{a.label}</div>
              <div className="text-[10px] text-muted-foreground line-clamp-2">{a.desc}</div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
