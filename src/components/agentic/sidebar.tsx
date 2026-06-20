'use client'

import { useState } from 'react'
import { useStore, PHASES, CATEGORY_LABELS, CATEGORY_COLORS, type PhaseCategory } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { cn } from '@/lib/utils'
import { useDashboard } from './use-dashboard'
import { PanelLeftClose, PanelLeft, ChevronDown } from 'lucide-react'

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
      'hidden md:flex shrink-0 flex-col border-r bg-sidebar transition-all duration-200',
      collapsed ? 'w-14' : 'w-56'
    )}>
      {/* Logo */}
      <div className="h-14 flex items-center border-b px-3 shrink-0">
        <img src="/logo-sota.png" alt="SOTA" className="size-7 rounded object-contain shrink-0" />
        {!collapsed && (
          <span className="ml-2.5 text-sm font-semibold tracking-tight">SOTA OS</span>
        )}
      </div>

      <nav className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-1.5' : 'px-2')}>
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat] || []
          if (items.length === 0) return null
          return (
            <div key={cat} className="mb-3">
              {items.map((p) => {
                const Icon = getIcon(p.icon)
                const active = activePhase === p.id
                const badge = getLiveBadge(p.id, data)
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePhase(p.id)}
                    className={cn(
                      'w-full flex items-center rounded-lg transition-colors group',
                      collapsed ? 'justify-center p-2' : 'gap-2.5 px-2.5 py-1.5',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    )}
                    title={collapsed ? p.name : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && (
                      <span className={cn('text-[13px] leading-tight truncate', active && 'font-medium')}>
                        {p.name}
                      </span>
                    )}
                    {!collapsed && badge && (
                      <span className={cn(
                        'ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0 text-white',
                        badge.tone === 'warn' && 'bg-amber-500',
                        badge.tone === 'danger' && 'bg-red-500',
                        badge.tone === 'info' && 'bg-sky-500',
                        badge.tone === 'ok' && 'bg-emerald-500',
                      )}>
                        {badge.value}
                      </span>
                    )}
                    {collapsed && badge && (
                      <span className={cn(
                        'absolute top-1 right-1 size-1.5 rounded-full',
                        badge.tone === 'warn' && 'bg-amber-500',
                        badge.tone === 'danger' && 'bg-red-500',
                        badge.tone === 'info' && 'bg-sky-500',
                      )} />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="border-t p-1.5 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full h-8 flex items-center justify-center rounded-lg hover:bg-accent/50 text-muted-foreground transition-colors"
        >
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
    </aside>
  )
}

export function MobileNav() {
  const { activePhase, setActivePhase } = useStore()
  const [open, setOpen] = useState(false)
  const current = PHASES.find(p => p.id === activePhase)
  const currentIcon = current ? getIcon(current.icon) : null

  return (
    <div className="md:hidden border-b bg-sidebar sticky top-0 z-40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3"
      >
        {currentIcon && <currentIcon className="size-4 text-primary" />}
        <span className="text-sm font-medium flex-1 text-left">{current?.name || 'Dashboard'}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 top-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 bg-sidebar border-b shadow-lg z-40 max-h-[70vh] overflow-y-auto">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped_phases(cat)
              if (items.length === 0) return null
              return (
                <div key={cat} className="py-1">
                  {cat !== 'core' && (
                    <div className={cn('text-[9px] font-bold uppercase tracking-wide px-4 py-1.5', CATEGORY_COLORS[cat])}>
                      {CATEGORY_LABELS[cat]}
                    </div>
                  )}
                  {items.map((p) => {
                    const Icon = getIcon(p.icon)
                    const active = activePhase === p.id
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setActivePhase(p.id); setOpen(false) }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors',
                          active ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className={cn('text-sm', active && 'font-medium')}>{p.name}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function grouped_phases(cat: string) {
  return PHASES.filter(p => p.category === cat)
}

function getLiveBadge(phaseId: string, data: any): { value: string | number; tone: 'warn' | 'danger' | 'info' | 'ok' } | null {
  if (!data) return null
  try {
    switch (phaseId) {
      case 'phase9': { const v = data.phase9?.pendingGates || 0; return v > 0 ? { value: v, tone: 'warn' } : null }
      case 'phase11': { const v = data.phase11?.interventions || 0; return v > 0 ? { value: v, tone: 'danger' } : null }
      case 'phase4': { const v = data.phase4?.verifRejects || 0; return v > 0 ? { value: v, tone: 'danger' } : null }
      case 'cockpit': { const v = data.blocked?.pending || 0; return v > 0 ? { value: v, tone: 'danger' } : null }
      default: return null
    }
  } catch { return null }
}
