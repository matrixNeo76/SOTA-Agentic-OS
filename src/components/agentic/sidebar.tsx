'use client'

import { useState, useEffect } from 'react'
import { useStore, CORE_AREAS, ADMIN_AREAS, ADVANCED_PHASES, PHASES, type Phase } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useDashboard } from './use-dashboard'
import { PanelLeftClose, PanelLeft, ChevronDown, MoreHorizontal } from 'lucide-react'
import { DynamicIcon } from '@/components/shared/dynamic-icon'

type NavItem = {
  phaseId: Phase
  label: string
  icon: string
  badgeKey?: string
}

type Section = {
  id: string
  label: string
  items: NavItem[]
}

// UX-1: 6 aree per obiettivo + Admin + Advanced
const SECTIONS: Section[] = [
  {
    id: 'main',
    label: 'Main',
    items: CORE_AREAS.map((a) => ({ phaseId: a.id, label: a.name, icon: a.icon })),
  },
  {
    id: 'admin',
    label: 'System',
    items: ADMIN_AREAS.map((a) => ({ phaseId: a.id, label: a.name, icon: a.icon })),
  },
  {
    id: 'advanced',
    label: 'Advanced / Internals',
    items: ADVANCED_PHASES.filter(p => p.id.startsWith('phase') || p.id === 'tools' || p.id.startsWith('domain')).map((a) => ({ phaseId: a.id, label: a.name, icon: a.icon })),
  },
]

export function Sidebar() {
  const { activePhase, setActivePhase } = useStore()
  const { data } = useDashboard()
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<string[]>(['main'])
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sota_sidebar_sections')
    if (saved) {
      try { setExpanded(JSON.parse(saved)) } catch {}
    }
    const savedCollapsed = localStorage.getItem('sota_sidebar_collapsed')
    if (savedCollapsed === 'true') setCollapsed(true)
  }, [])

  useEffect(() => {
    localStorage.setItem('sota_sidebar_sections', JSON.stringify(expanded))
  }, [expanded])

  useEffect(() => {
    localStorage.setItem('sota_sidebar_collapsed', String(collapsed))
  }, [collapsed])

  const toggleSection = (id: string) => {
    setExpanded((prev) => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  // Badge counts from dashboard data
  const badgeCounts: Record<string, number> = {
    governance: data?.phase9?.pendingGates || 0,
    agents: 0, // populated from autonomous-org API if needed
  }

  if (collapsed) {
    return (
      <aside className="w-14 border-r bg-card flex flex-col items-center py-3 gap-2 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-md hover:bg-accent transition-colors"
          title="Expand sidebar"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
        {SECTIONS[0]!.items.map((item) => (
          <button
            key={item.phaseId}
            onClick={() => setActivePhase(item.phaseId)}
            className={cn(
              'p-2 rounded-md transition-colors relative',
              activePhase === item.phaseId ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground',
            )}
            title={item.label}
          >
            <DynamicIcon name={item.icon} className="w-4 h-4" />
            {badgeCounts[item.phaseId] > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-xs rounded-full bg-destructive text-destructive-foreground flex items-center justify-center">
                {badgeCounts[item.phaseId]}
              </span>
            )}
          </button>
        ))}
      </aside>
    )
  }

  return (
    <aside className="w-60 border-r bg-card flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-3 border-b">
        <span className="text-sm font-semibold">SOTA Agentic OS</span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5">
        {/* Main sections */}
        {SECTIONS.filter(s => s.id !== 'advanced').map((section) => (
          <div key={section.id} className="mb-2">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>{section.label}</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', expanded.includes(section.id) ? '' : '-rotate-90')} />
            </button>
            {(expanded.includes(section.id)) && section.items.map((item) => (
              <button
                key={item.phaseId}
                onClick={() => setActivePhase(item.phaseId)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors mt-0.5 relative',
                  activePhase === item.phaseId
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )}
              >
                <DynamicIcon name={item.icon} className="w-4 h-4 shrink-0" />
                <span className="truncate flex-1 text-left">{item.label}</span>
                {badgeCounts[item.phaseId] > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-destructive text-destructive-foreground font-medium">
                    {badgeCounts[item.phaseId]}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}

        {/* Advanced / Internals (collapsible) */}
        <div className="mb-2 mt-4">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="w-full flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <MoreHorizontal className="w-3 h-3" />
              Advanced / Internals
            </span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', advancedOpen ? '' : '-rotate-90')} />
          </button>
          {advancedOpen && (
            <div className="mt-1 space-y-0.5">
              {SECTIONS.find(s => s.id === 'advanced')?.items.map((item) => (
                <button
                  key={item.phaseId}
                  onClick={() => setActivePhase(item.phaseId)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-xs transition-colors',
                    activePhase === item.phaseId
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <DynamicIcon name={item.icon} className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1 text-left">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
    </aside>
  )
}

// === Mobile Navigation (bottom sheet) ===
export function MobileNav() {
  const { activePhase, setActivePhase } = useStore()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile bottom bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-card h-14 flex items-center justify-around z-40">
        {CORE_AREAS.slice(0, 5).map((area) => (
          <button
            key={area.id}
            onClick={() => setActivePhase(area.id)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 p-1 rounded-md transition-colors flex-1 h-full',
              activePhase === area.id ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <DynamicIcon name={area.icon} className="w-4 h-4" />
            <span className="text-[10px] truncate">{area.name.split(' ')[0]}</span>
          </button>
        ))}
        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 p-1 text-muted-foreground flex-1 h-full"
        >
          <MoreHorizontal className="w-4 h-4" />
          <span className="text-[10px]">More</span>
        </button>
      </div>

      {/* More sheet */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full bg-card rounded-t-xl border-t p-4 pb-8 max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-muted rounded-full mx-auto mb-4" />
            <div className="grid grid-cols-2 gap-2">
              {PHASES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setActivePhase(p.id); setOpen(false) }}
                  className={cn(
                    'flex items-center gap-2 p-2.5 rounded-lg text-sm transition-colors',
                    activePhase === p.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground',
                  )}
                >
                  <DynamicIcon name={p.icon} className="w-4 h-4 shrink-0" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
