'use client'

import { useState } from 'react'
import { useStore, PHASES, CATEGORY_LABELS, CATEGORY_COLORS, type PhaseCategory } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { cn } from '@/lib/utils'
import { useDashboard } from './use-dashboard'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CATEGORY_ORDER: (PhaseCategory | 'core')[] = [
  'core', 'foundation', 'orchestration', 'cognitive', 'trust', 'learning', 'governance', 'infrastructure',
]

export function Sidebar() {
  const { activePhase, setActivePhase } = useStore()
  const { data } = useDashboard()
  const [collapsed, setCollapsed] = useState(false)

  const grouped: Record<string, typeof PHASES> = {}
  for (const p of PHASES) {
    const cat = p.category
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }

  return (
    <aside className={cn(
      'hidden md:flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Header con logo */}
      <div className="p-3 border-b sticky top-0 bg-sidebar z-10">
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-2.5')}>
          <img
            src="/logo-sota.png"
            alt="SOTA Agentic OS"
            className="size-9 rounded-lg object-contain shrink-0"
          />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">SOTA Agentic OS</div>
              <div className="text-[9px] text-muted-foreground mt-0.5 tracking-[0.15em] uppercase">
                Intelligent · Secure
              </div>
            </div>
          )}
        </div>
      </div>

      <nav className={cn('flex-1 overflow-y-auto py-2', collapsed ? 'px-1' : 'px-2')}>
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat] || []
          if (items.length === 0) return null
          const isCore = cat === 'core'
          return (
            <div key={cat} className="mb-2">
              {!isCore && !collapsed && (
                <div className={cn(
                  'text-[9px] font-bold uppercase tracking-[0.1em] px-2.5 py-1.5 mt-1',
                  CATEGORY_COLORS[cat]
                )}>
                  {CATEGORY_LABELS[cat]}
                </div>
              )}
              {isCore && !collapsed && (
                <div className="h-px bg-border mx-2 my-1.5" />
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
                      'w-full flex items-center rounded-lg transition-all group relative',
                      collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-2.5 py-1.5',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'hover:bg-sidebar-accent/50'
                    )}
                    title={collapsed ? p.name : undefined}
                  >
                    {/* Active indicator bar */}
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                    )}
                    <Icon className={cn(
                      'shrink-0 transition-colors',
                      collapsed ? 'size-5' : 'size-4 mt-px',
                      active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    )} />
                    {!collapsed && (
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'text-[13px] leading-tight truncate',
                            active ? 'font-semibold' : 'font-medium'
                          )}>{p.name}</span>
                          {badge && (
                            <span className={cn(
                              'text-[9px] px-1.5 py-0 rounded-full font-mono font-bold shrink-0',
                              badge.tone === 'warn' && 'bg-amber-500 text-white',
                              badge.tone === 'danger' && 'bg-red-500 text-white',
                              badge.tone === 'info' && 'bg-sky-500 text-white',
                              badge.tone === 'ok' && 'bg-emerald-500 text-white',
                            )}>
                              {badge.value}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{p.subtitle}</div>
                      </div>
                    )}
                    {/* Collapsed badge */}
                    {collapsed && badge && (
                      <span className={cn(
                        'absolute top-1 right-1 size-2 rounded-full',
                        badge.tone === 'warn' && 'bg-amber-500',
                        badge.tone === 'danger' && 'bg-red-500',
                        badge.tone === 'info' && 'bg-sky-500',
                        badge.tone === 'ok' && 'bg-emerald-500',
                      )} />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t p-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className={cn('w-full h-8 text-xs text-muted-foreground hover:text-foreground', collapsed && 'px-0')}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-3.5 mr-1" /> Collapse</>}
        </Button>
      </div>
    </aside>
  )
}

export function MobileNav() {
  const { activePhase, setActivePhase } = useStore()
  return (
    <div className="md:hidden border-b bg-sidebar sticky top-0 z-40 max-h-14 overflow-hidden">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-2 scrollbar-none">
        {PHASES.map((p) => {
          const Icon = getIcon(p.icon)
          const active = activePhase === p.id
          return (
            <button
              key={p.id}
              onClick={() => setActivePhase(p.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap shrink-0 transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground/60'
              )}
              title={p.name}
            >
              <Icon className="size-3.5" />
              {p.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getLiveBadge(phaseId: string, data: any): { value: string | number; tone: 'warn' | 'danger' | 'info' | 'ok' } | null {
  if (!data) return null
  try {
    switch (phaseId) {
      case 'phase9': {
        const pending = data.phase9?.pendingGates || 0
        if (pending > 0) return { value: pending, tone: 'warn' }
        return null
      }
      case 'phase11': {
        const interventions = data.phase11?.interventions || 0
        if (interventions > 0) return { value: interventions, tone: 'danger' }
        return null
      }
      case 'phase4': {
        const rejects = data.phase4?.verifRejects || 0
        if (rejects > 0) return { value: rejects, tone: 'danger' }
        return null
      }
      case 'phase13': {
        const conflicts = data.phase13?.conflicts || 0
        if (conflicts > 0) return { value: conflicts, tone: 'warn' }
        return null
      }
      case 'phase14': {
        const ensemble = data.phase14?.ensemble || 0
        if (ensemble > 0) return { value: ensemble, tone: 'info' }
        return null
      }
      case 'phase2': {
        const plans = data.phase2?.plans || 0
        if (plans > 0) return { value: plans, tone: 'info' }
        return null
      }
      case 'phase1': {
        const ep = data.phase1?.episodic || 0
        if (ep > 0) return { value: ep, tone: 'info' }
        return null
      }
      case 'cockpit': {
        const pending = data.blocked?.pending || 0
        if (pending > 0) return { value: pending, tone: 'danger' }
        return null
      }
      case 'tools': {
        const active = data.tools?.active || 0
        if (active > 0) return { value: active, tone: 'info' }
        return null
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
