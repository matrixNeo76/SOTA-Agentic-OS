'use client'

import { useStore, PHASES, CATEGORY_LABELS, CATEGORY_COLORS, type PhaseCategory } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { cn } from '@/lib/utils'
import { useDashboard } from './use-dashboard'

// Ordine delle categorie nella sidebar
const CATEGORY_ORDER: (PhaseCategory | 'core')[] = [
  'core',
  'foundation',
  'orchestration',
  'cognitive',
  'trust',
  'learning',
  'governance',
  'infrastructure',
]

export function Sidebar() {
  const { activePhase, setActivePhase } = useStore()
  const { data } = useDashboard()

  // Raggruppa fasi per categoria
  const grouped: Record<string, typeof PHASES> = {}
  for (const p of PHASES) {
    const cat = p.category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground overflow-y-auto">
      {/* Header con logo */}
      <div className="p-4 border-b sticky top-0 bg-sidebar z-10">
        <div className="flex items-center gap-2">
          <img
            src="/logo-sota.png"
            alt="SOTA Agentic OS"
            className="size-10 rounded-md object-contain"
          />
          <div>
            <div className="text-sm font-semibold leading-none">SOTA Agentic OS</div>
            <div className="text-[10px] text-muted-foreground mt-1 tracking-wider">
              INTELLIGENT · SECURE · AUTONOMOUS
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-3">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat] || []
          if (items.length === 0) return null
          const isCore = cat === 'core'
          return (
            <div key={cat} className="space-y-1">
              {!isCore && (
                <div className={cn(
                  'text-[10px] font-bold uppercase tracking-wider px-2 pt-2',
                  CATEGORY_COLORS[cat]
                )}>
                  {CATEGORY_LABELS[cat]}
                </div>
              )}
              {items.map((p) => {
                const Icon = getIcon(p.icon)
                const active = activePhase === p.id
                const badge = getLiveBadge(p.id, data)
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePhase(p.id)}
                    className={cn(
                      'w-full flex items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors group',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'hover:bg-sidebar-accent/50'
                    )}
                    title={p.subtitle}
                  >
                    <Icon className={cn(
                      'size-4 mt-0.5 shrink-0',
                      active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium leading-tight truncate">{p.name}</span>
                        {badge && (
                          <span className={cn(
                            'text-[9px] px-1 py-0 rounded-full font-mono shrink-0',
                            badge.tone === 'warn' && 'bg-amber-500 text-white',
                            badge.tone === 'danger' && 'bg-red-500 text-white',
                            badge.tone === 'info' && 'bg-sky-500 text-white',
                            badge.tone === 'ok' && 'bg-emerald-500 text-white',
                          )}>
                            {badge.value}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">{p.subtitle}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="p-3 border-t text-xs text-muted-foreground sticky bottom-0 bg-sidebar">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          Kernel attivo · v0.4.0
        </div>
      </div>
    </aside>
  )
}

export function MobileNav() {
  const { activePhase, setActivePhase } = useStore()
  return (
    <div className="md:hidden border-b bg-background sticky top-0 z-40">
      <div className="flex items-center gap-2 overflow-x-auto px-2 py-2">
        {PHASES.map((p) => {
          const Icon = getIcon(p.icon)
          const active = activePhase === p.id
          return (
            <button
              key={p.id}
              onClick={() => setActivePhase(p.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
              title={p.name}
            >
              <Icon className="size-3" />
              {p.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Calcola badge live per ogni fase in base alle metriche dashboard.
 */
function getLiveBadge(phaseId: string, data: any): { value: string | number; tone: 'warn' | 'danger' | 'info' | 'ok' } | null {
  if (!data) return null
  try {
    switch (phaseId) {
      case 'phase9': {
        // Human Retainer: pending gates
        const pending = data.phase9?.pendingGates || 0
        if (pending > 0) return { value: pending, tone: 'warn' }
        return null
      }
      case 'phase11': {
        // Affect Monitor: critical states
        const interventions = data.phase11?.interventions || 0
        if (interventions > 0) return { value: interventions, tone: 'danger' }
        return null
      }
      case 'phase4': {
        // Verification: rejects
        const rejects = data.phase4?.verifRejects || 0
        if (rejects > 0) return { value: rejects, tone: 'danger' }
        return null
      }
      case 'phase13': {
        // Swarm Coherence: conflicts
        const conflicts = data.phase13?.conflicts || 0
        if (conflicts > 0) return { value: conflicts, tone: 'warn' }
        return null
      }
      case 'phase14': {
        // Model Router: ensemble fallback count
        const ensemble = data.phase14?.ensemble || 0
        if (ensemble > 0) return { value: ensemble, tone: 'info' }
        return null
      }
      case 'phase2': {
        // Planner: plans count
        const plans = data.phase2?.plans || 0
        if (plans > 0) return { value: plans, tone: 'info' }
        return null
      }
      case 'phase1': {
        // Memory: episodic count
        const ep = data.phase1?.episodic || 0
        if (ep > 0) return { value: ep, tone: 'info' }
        return null
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
