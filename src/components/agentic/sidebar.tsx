'use client'

import { useStore, type Phase } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
} from 'lucide-react'

const NAV: { id: Phase; label: string; sub: string; icon: any }[] = [
  { id: 'overview', label: 'Overview', sub: 'Dashboard generale', icon: LayoutDashboard },
  { id: 'phase1', label: 'Fase 1', sub: 'Stato & Memoria', icon: Database },
  { id: 'phase2', label: 'Fase 2', sub: 'Orchestrazione & Compiled AI', icon: Workflow },
  { id: 'phase3', label: 'Fase 3', sub: 'Steering (ACTS)', icon: Compass },
  { id: 'phase4', label: 'Fase 4', sub: 'Zero-Trust & Verifica', icon: ShieldCheck },
  { id: 'phase5', label: 'Fase 5', sub: 'Riflessione & Evoluzione', icon: Sparkles },
]

export function Sidebar() {
  const { activePhase, setActivePhase } = useStore()

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            SOTA
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">Agentic OS</div>
            <div className="text-xs text-muted-foreground mt-1">v0.1.0</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((n) => {
          const Icon = n.icon
          const active = activePhase === n.id
          return (
            <button
              key={n.id}
              onClick={() => setActivePhase(n.id)}
              className={cn(
                'w-full flex items-start gap-3 rounded-md px-3 py-2 text-left transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/50'
              )}
            >
              <Icon className={cn('size-4 mt-0.5 shrink-0', active && 'text-primary')} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{n.label}</div>
                <div className="text-xs text-muted-foreground truncate">{n.sub}</div>
              </div>
            </button>
          )
        })}
      </nav>
      <div className="p-3 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          Kernel attivo
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
        {NAV.map((n) => {
          const Icon = n.icon
          const active = activePhase === n.id
          return (
            <button
              key={n.id}
              onClick={() => setActivePhase(n.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs whitespace-nowrap',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <Icon className="size-3" />
              {n.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
