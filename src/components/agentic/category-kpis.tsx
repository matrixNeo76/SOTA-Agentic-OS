'use client'

import { useStore, type PhaseCategory } from '@/lib/store'
import { cn } from '@/lib/utils'

type CategoryKpi = {
  category: PhaseCategory
  label: string
  color: string
  metrics: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'danger' }[]
  primaryPhase: string
}

export function CategoryKpis({ data }: { data: any }) {
  const { setActivePhase } = useStore()

  if (!data) return null

  const categories: CategoryKpi[] = [
    {
      category: 'foundation', label: 'Foundation', color: 'text-sky-600 dark:text-sky-400',
      primaryPhase: 'phase1',
      metrics: [
        { label: 'Episodi', value: data.phase1?.episodic || 0 },
        { label: 'Context', value: data.phase6?.activeCalls || 0 },
        { label: 'Tok salvati', value: data.phase6?.totalTokensSaved || 0, tone: 'ok' },
      ],
    },
    {
      category: 'orchestration', label: 'Orchestration', color: 'text-emerald-600 dark:text-emerald-400',
      primaryPhase: 'phase2',
      metrics: [
        { label: 'Piani', value: data.phase2?.plans || 0 },
        { label: 'Tracce', value: data.phase7?.traces || 0 },
        { label: 'Alberi', value: data.phase12?.trees || 0 },
      ],
    },
    {
      category: 'cognitive', label: 'Cognitive', color: 'text-violet-600 dark:text-violet-400',
      primaryPhase: 'phase3',
      metrics: [
        { label: 'Steering', value: data.phase3?.steeringEvents || 0 },
        { label: 'Sessioni', value: data.phase10?.sessions || 0 },
        { label: 'Allerte', value: data.phase11?.interventions || 0, tone: data.phase11?.interventions ? 'danger' : 'ok' },
      ],
    },
    {
      category: 'trust', label: 'Trust', color: 'text-red-600 dark:text-red-400',
      primaryPhase: 'phase4',
      metrics: [
        { label: 'LTL ev', value: data.phase4?.verificationEvents || 0 },
        { label: 'Contratti', value: data.phase8?.contracts || 0 },
        { label: 'Quorum', value: data.phase13?.acceptedQuorum || 0, tone: 'ok' },
      ],
    },
    {
      category: 'learning', label: 'Learning', color: 'text-amber-600 dark:text-amber-400',
      primaryPhase: 'phase5',
      metrics: [
        { label: 'Euristiche', value: data.phase5?.heuristics || 0 },
        { label: 'Riflessioni', value: data.phase5?.reflections || 0 },
      ],
    },
    {
      category: 'governance', label: 'Governance', color: 'text-pink-600 dark:text-pink-400',
      primaryPhase: 'phase9',
      metrics: [
        { label: 'Deleghe', value: data.phase9?.activeDelegations || 0 },
        { label: 'Gates', value: data.phase9?.pendingGates || 0, tone: data.phase9?.pendingGates ? 'warn' : 'ok' },
        { label: 'Tool', value: data.tools?.active || 0 },
      ],
    },
    {
      category: 'infrastructure', label: 'Infra', color: 'text-cyan-600 dark:text-cyan-400',
      primaryPhase: 'phase14',
      metrics: [
        { label: 'Routing', value: data.phase14?.decisions || 0 },
        { label: 'Primary', value: data.phase14?.primary || 0, tone: 'ok' },
        { label: 'Errors', value: data.observability?.errors?.open || 0, tone: data.observability?.errors?.open ? 'danger' : 'ok' },
      ],
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {categories.map((c) => (
        <div
          key={c.category}
          onClick={() => setActivePhase(c.primaryPhase as any)}
          className="cursor-pointer group"
        >
          <div className={cn('text-[10px] font-medium uppercase tracking-wide mb-2', c.color)}>
            {c.label}
          </div>
          <div className="space-y-1.5">
            {c.metrics.map((m) => (
              <div key={m.label} className="flex items-baseline justify-between">
                <span className="text-[11px] text-muted-foreground">{m.label}</span>
                <span className={cn(
                  'text-sm font-mono font-semibold tabular-nums',
                  m.tone === 'ok' && m.value > 0 && 'text-emerald-600 dark:text-emerald-400',
                  m.tone === 'warn' && 'text-amber-600 dark:text-amber-400',
                  m.tone === 'danger' && 'text-red-600 dark:text-red-400',
                  !m.tone && 'text-foreground',
                )}>
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
