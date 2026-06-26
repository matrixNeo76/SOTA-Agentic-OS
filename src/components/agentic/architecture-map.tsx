'use client'

/**
 * ArchitectureMap — C6.4 redesign
 *
 * Shows the system's phases grouped by category, with:
 *   - Live count badges (from /api/dashboard data)
 *   - Alert dots (warn/danger) when a phase has pending issues
 *   - Collapsible "advanced" group (22 internal phases)
 *   - Search filter by name
 *   - Adaptive layout (flex-wrap, not fixed grid-cols-7)
 *   - Active phase scroll-into-view
 *   - Tooltip with subtitle on hover
 *
 * Categories are aligned with the real PhaseCategory type:
 *   core | memory | agents | governance | insights | ecosystem | advanced
 * (the old catOrder had 7 wrong categories — only 'governance' matched,
 *  leaving 6 empty columns and 22 advanced phases invisible.)
 */

import { useStore, PHASES, CATEGORY_COLORS, type Phase, type PhaseCategory } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { cn } from '@/lib/utils'
import { useDashboard } from './use-dashboard'
import { useDataStore } from '@/lib/stores/data-store'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useState, useEffect, useRef, useMemo } from 'react'

// === Categories (aligned with PhaseCategory type) ===================

const CAT_ORDER: PhaseCategory[] = [
  'core',
  'memory',
  'agents',
  'governance',
  'insights',
  'ecosystem',
  'advanced',
]

const CAT_LABELS: Record<PhaseCategory, string> = {
  core: 'Core',
  memory: 'Memory',
  agents: 'Agents',
  governance: 'Governance',
  insights: 'Insights',
  ecosystem: 'Ecosystem',
  advanced: 'Advanced / Internals',
  foundation: 'Foundation',
  orchestration: 'Orchestration',
  cognitive: 'Cognitive',
  trust: 'Trust',
  learning: 'Learning',
  infrastructure: 'Infra',
}

// === Phase metric mapping ===========================================
//
// Maps each phase id to a function that extracts a count + optional
// alert tone from the dashboard data. Returns null if no metric applies.

interface PhaseMetric {
  count: number
  tone?: 'ok' | 'warn' | 'danger'
  label?: string
}

function getPhaseMetric(phaseId: string, data: any, blockedPending: number): PhaseMetric | null {
  if (!data) return null

  switch (phaseId) {
    // Core
    case 'dashboard':
      return { count: data.agentLogsTotal ?? 0, label: 'events' }
    case 'runs':
      return {
        count: data.phase2?.plans ?? 0,
        tone: (data.phase2?.plans ?? 0) > 0 ? 'warn' : 'ok',
        label: 'plans',
      }
    // Memory
    case 'memory':
      return {
        count: (data.memoryStats?.episodic ?? 0) + (data.memoryStats?.semantic ?? 0) + (data.memoryStats?.logical ?? 0),
        label: 'entries',
      }
    // Agents
    case 'agents':
      return { count: data.phase11?.agents ?? 0, label: 'agents' }
    // Governance
    case 'governance':
      return {
        count: blockedPending + (data.phase9?.pendingGates ?? 0),
        tone: (blockedPending + (data.phase9?.pendingGates ?? 0)) > 0 ? 'warn' : 'ok',
        label: 'pending',
      }
    // Insights
    case 'insights':
      return { count: data.phase12?.trees ?? 0, label: 'trees' }
    // Ecosystem
    case 'admin':
      return { count: data.tools?.total ?? 0, label: 'tools' }

    // Advanced (phase1-14)
    case 'phase1':
      return { count: (data.phase1?.episodic ?? 0) + (data.phase1?.semantic ?? 0) + (data.phase1?.logical ?? 0), label: 'items' }
    case 'phase2':
      return { count: data.phase2?.plans ?? 0, label: 'plans' }
    case 'phase3':
      return { count: data.phase3?.steeringEvents ?? 0, label: 'events' }
    case 'phase4':
      return {
        count: data.phase4?.verificationEvents ?? 0,
        tone: (data.phase4?.verifRejects ?? 0) > 0 ? 'danger' : 'ok',
        label: 'verifs',
      }
    case 'phase5':
      return {
        count: data.phase5?.heuristics ?? 0,
        tone: (data.phase5?.redLineFlags ?? 0) > 0 ? 'danger' : 'ok',
        label: 'heuristics',
      }
    case 'phase6':
      return { count: data.phase6?.activeCalls ?? 0, label: 'calls' }
    case 'phase7':
      return { count: data.phase7?.traces ?? 0, label: 'traces' }
    case 'phase8':
      return { count: data.phase8?.contracts ?? 0, label: 'contracts' }
    case 'phase9':
      return {
        count: data.phase9?.activeDelegations ?? 0,
        tone: (data.phase9?.pendingGates ?? 0) > 0 ? 'warn' : 'ok',
        label: 'delegations',
      }
    case 'phase10':
      return { count: data.phase10?.sessions ?? 0, label: 'sessions' }
    case 'phase11':
      return {
        count: data.phase11?.samples ?? 0,
        tone: (data.phase11?.interventions ?? 0) > 0 ? 'warn' : 'ok',
        label: 'samples',
      }
    case 'phase12':
      return { count: data.phase12?.trees ?? 0, label: 'trees' }
    case 'phase13':
      return {
        count: data.phase13?.beliefs ?? 0,
        tone: (data.phase13?.conflicts ?? 0) > 0 ? 'warn' : 'ok',
        label: 'beliefs',
      }
    case 'phase14':
      return { count: data.phase14?.decisions ?? 0, label: 'decisions' }

    // Domains
    case 'domain-memory':
      return { count: (data.phase1?.episodic ?? 0) + (data.phase6?.summaries ?? 0) + (data.phase10?.sessions ?? 0), label: 'items' }
    case 'domain-plan':
      return { count: data.phase2?.plans ?? 0, label: 'plans' }
    case 'domain-verify':
      return {
        count: data.phase4?.verificationEvents ?? 0,
        tone: (data.phase4?.verifRejects ?? 0) > 0 ? 'danger' : 'ok',
        label: 'verifs',
      }
    case 'domain-learn':
      return {
        count: data.phase5?.heuristics ?? 0,
        tone: (data.phase5?.redLineFlags ?? 0) > 0 ? 'danger' : 'ok',
        label: 'heuristics',
      }

    default:
      return null
  }
}

// === Main component ==================================================

export function ArchitectureMap() {
  const { setActivePhase, activePhase } = useStore()
  const { data } = useDashboard()
  const { blockedPending } = useDataStore()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [search, setSearch] = useState('')
  const activeRef = useRef<HTMLButtonElement>(null)

  // Group phases by category
  const categories = useMemo(() => {
    const acc: Record<string, typeof PHASES> = {}
    for (const p of PHASES) {
      if (!acc[p.category]) acc[p.category] = []
      acc[p.category].push(p)
    }
    return acc
  }, [])

  // Filter phases by search
  const searchLower = search.trim().toLowerCase()
  const matchesSearch = (p: typeof PHASES[number]) => {
    if (!searchLower) return true
    return (
      p.name.toLowerCase().includes(searchLower) ||
      p.id.toLowerCase().includes(searchLower) ||
      (p.subtitle?.toLowerCase().includes(searchLower) ?? false)
    )
  }

  // Scroll active phase into view when it changes
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activePhase])

  const visibleCats = CAT_ORDER.filter((cat) => {
    const phases = (categories[cat] || []).filter(matchesSearch)
    return phases.length > 0
  })

  return (
    <div className="space-y-3">
      {/* Search + advanced toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search phases..."
            aria-label="Search phases by name"
            className="w-full h-7 pl-7 pr-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="h-7 text-xs"
          aria-expanded={advancedOpen}
          aria-label={advancedOpen ? 'Hide internal phases' : 'Show internal phases'}
        >
          {advancedOpen ? <ChevronDown className="size-3 mr-1" /> : <ChevronRight className="size-3 mr-1" />}
          Internals ({(categories['advanced'] || []).length})
        </Button>
      </div>

      {/* Categories — flex-wrap adaptive layout */}
      <div className="flex flex-wrap gap-3">
        {visibleCats.map((cat) => {
          // Skip advanced if collapsed (unless searching)
          if (cat === 'advanced' && !advancedOpen && !search) return null

          const phases = (categories[cat] || []).filter(matchesSearch)
          if (phases.length === 0) return null

          return (
            <div key={cat} className="space-y-1.5 min-w-[140px] flex-1">
              <div
                className={cn(
                  'text-[10px] font-medium uppercase tracking-wide pb-1.5 border-b',
                  CATEGORY_COLORS[cat],
                )}
                role="heading"
                aria-level={3}
              >
                {CAT_LABELS[cat]}
              </div>
              {phases.map((p) => {
                const Icon = getIcon(p.icon)
                const active = activePhase === p.id
                const metric = getPhaseMetric(p.id, data, blockedPending?.length ?? 0)
                return (
                  <PhaseButton
                    key={p.id}
                    phase={p}
                    icon={Icon}
                    active={active}
                    metric={metric}
                    onClick={() => setActivePhase(p.id as Phase)}
                    ref={active ? activeRef : undefined}
                  />
                )
              })}
            </div>
          )
        })}
      </div>

      {/* No results */}
      {visibleCats.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-4 text-center">
          No phases match &ldquo;{search}&rdquo;
        </p>
      )}
    </div>
  )
}

// === Phase button with tooltip + metric badge =======================

import { forwardRef } from 'react'

interface PhaseButtonProps {
  phase: typeof PHASES[number]
  icon: ReturnType<typeof getIcon>
  active: boolean
  metric: PhaseMetric | null
  onClick: () => void
}

const PhaseButton = forwardRef<HTMLButtonElement, PhaseButtonProps>(
  ({ phase, icon: Icon, active, metric, onClick }, ref) => {
    const toneDotClass = {
      ok: 'bg-status-ok',
      warn: 'bg-status-warn',
      danger: 'bg-status-danger',
    }

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={ref}
              onClick={onClick}
              aria-label={`${active ? 'Active: ' : ''}${phase.name}${phase.subtitle ? ` — ${phase.subtitle}` : ''}${metric ? ` (${metric.count} ${metric.label})` : ''}`}
              aria-pressed={active}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all',
                active
                  ? 'bg-primary/10 ring-1 ring-primary/20'
                  : 'hover:bg-accent/50',
              )}
            >
              <Icon className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              <span className={cn('text-xs leading-tight truncate flex-1', active && 'font-medium')}>
                {phase.name}
              </span>
              {/* Alert dot */}
              {metric?.tone && metric.tone !== 'ok' && (
                <span
                  className={cn('size-1.5 rounded-full shrink-0', toneDotClass[metric.tone])}
                  aria-label={`${metric.tone} alert`}
                />
              )}
              {/* Count badge */}
              {metric && metric.count > 0 && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 tabular-nums shrink-0">
                  {metric.count > 999 ? `${(metric.count / 1000).toFixed(1)}k` : metric.count}
                </Badge>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="text-xs space-y-0.5">
              <div className="font-medium">{phase.name}</div>
              {phase.subtitle && <div className="text-muted-foreground">{phase.subtitle}</div>}
              {metric && (
                <div className="text-muted-foreground">
                  {metric.count} {metric.label}
                  {metric.tone && metric.tone !== 'ok' && (
                    <span className={cn('ml-1', metric.tone === 'danger' ? 'text-status-danger' : 'text-status-warn')}>
                      · {metric.tone}
                    </span>
                  )}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
)
PhaseButton.displayName = 'PhaseButton'
