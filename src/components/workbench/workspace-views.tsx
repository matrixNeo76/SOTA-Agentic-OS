'use client'

import { useStore, Phase, WorkspaceView } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Terminal, GitFork, Clock, Gauge, ShieldAlert } from 'lucide-react'
import { AgentConsole } from '@/components/agentic/agent-console'
import { Cockpit } from '@/components/agentic/cockpit'
import { Phase1 } from '@/components/agentic/phase1'
import { Phase2 } from '@/components/agentic/phase2'
import { Phase3 } from '@/components/agentic/phase3'
import { Phase4 } from '@/components/agentic/phase4'
import { Phase5 } from '@/components/agentic/phase5'
import { Phase6 } from '@/components/agentic/phase6'
import { Phase7 } from '@/components/agentic/phase7'
import { Phase8 } from '@/components/agentic/phase8'
import { Phase9 } from '@/components/agentic/phase9'
import { Phase10 } from '@/components/agentic/phase10'
import { Phase11 } from '@/components/agentic/phase11'
import { Phase12 } from '@/components/agentic/phase12'
import { Phase13 } from '@/components/agentic/phase13'
import { Phase14 } from '@/components/agentic/phase14'
import { ToolManager } from '@/components/agentic/tool-manager'
import { Overview } from '@/components/agentic/overview'
import { PHASES } from '@/lib/store'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { CanvasView } from '@/components/workbench/canvas-view'
import { TimelineView } from '@/components/workbench/timeline-view'
import { SovereignView } from '@/components/workbench/sovereign-view'
import { ViewTransition } from '@/components/workbench/view-transition'

// === View metadata ===
type ViewMeta = {
  id: WorkspaceView
  label: string
  icon: typeof Terminal
  alwaysVisible: boolean
  badgeKey?: 'sovereign'
}

const VIEWS: ViewMeta[] = [
  { id: 'console', label: 'Console', icon: Terminal, alwaysVisible: true },
  { id: 'canvas', label: 'Canvas', icon: GitFork, alwaysVisible: true },
  { id: 'timeline', label: 'Timeline', icon: Clock, alwaysVisible: true },
  { id: 'cockpit', label: 'Cockpit', icon: Gauge, alwaysVisible: true },
  { id: 'sovereign', label: 'Sovereign', icon: ShieldAlert, alwaysVisible: true, badgeKey: 'sovereign' },
]

// === Phase renderer ===
function PhaseView() {
  const { activePhase } = useStore()

  switch (activePhase) {
    case 'overview': return <Overview />
    case 'phase1': return <Phase1 />
    case 'phase2': return <Phase2 />
    case 'phase3': return <Phase3 />
    case 'phase4': return <Phase4 />
    case 'phase5': return <Phase5 />
    case 'phase6': return <Phase6 />
    case 'phase7': return <Phase7 />
    case 'phase8': return <Phase8 />
    case 'phase9': return <Phase9 />
    case 'phase10': return <Phase10 />
    case 'phase11': return <Phase11 />
    case 'phase12': return <Phase12 />
    case 'phase13': return <Phase13 />
    case 'phase14': return <Phase14 />
    case 'tools': return <ToolManager />
    default: return <Overview />
  }
}

// === Main WorkspaceViews container ===
export function WorkspaceViews() {
  const { activeView, activePhase, setActiveView, setActivePhase } = useStore()
  const { events } = useSensoriumLive()

  // Count pending blocked actions for Sovereign badge
  // (looking at recent action_blocked events in the live stream)
  const blockedCount = events.filter(
    (e) => e.event === 'action_blocked'
  ).length

  // Show Phase tab when activePhase is a real phase
  const isPhaseActive = activePhase !== 'overview' && activePhase !== 'console' && activePhase !== 'cockpit'

  const handlePhaseTabClick = () => {
    // Switch to phase view, keeping current activePhase
    setActiveView('phase')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="shrink-0 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center overflow-x-auto no-scrollbar h-9">
          {VIEWS.map((view) => (
            <ViewTab
              key={view.id}
              view={view}
              active={activeView === view.id}
              badge={view.badgeKey === 'sovereign' ? blockedCount : undefined}
              onClick={() => {
                if (view.id === 'phase') {
                  handlePhaseTabClick()
                } else {
                  setActiveView(view.id)
                }
              }}
            />
          ))}
          {isPhaseActive && (
            <PhaseTab
              active={activeView === 'phase'}
              onClick={handlePhaseTabClick}
            />
          )}
          {/* Spacer to push right-aligned content if needed in future */}
          <div className="flex-1" />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden min-h-0">
        <ViewTransition>
          <div className={cn(
            'h-full',
            // Console needs full-height flex layout
            (activeView === 'console' || (activeView === 'phase' && activePhase === 'console')) && 'flex flex-col'
          )}>
            {activeView === 'console' && <AgentConsole />}
            {activeView === 'canvas' && <CanvasView />}
            {activeView === 'timeline' && <TimelineView />}
            {activeView === 'cockpit' && <Cockpit />}
            {activeView === 'sovereign' && <SovereignView />}
            {activeView === 'phase' && (
              <div className="h-full overflow-y-auto">
                <PhaseView />
              </div>
            )}
          </div>
        </ViewTransition>
      </div>
    </div>
  )
}

// === Tab button ===
function ViewTab({
  view,
  active,
  badge,
  onClick,
}: {
  view: ViewMeta
  active: boolean
  badge?: number
  onClick: () => void
}) {
  const Icon = view.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-all',
        'border-b-2 active:scale-95',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40'
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className={cn('size-3.5 shrink-0 transition-colors', active && 'text-primary')} />
      <span className="truncate max-w-[120px]">{view.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold font-mono">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// === Dynamic Phase tab ===
function PhaseTab({ active, onClick }: { active: boolean; onClick: () => void }) {
  const { activePhase } = useStore()
  if (activePhase === 'overview' || activePhase === 'console' || activePhase === 'cockpit') return null

  const phase = PHASES.find((p) => p.id === activePhase)
  if (!phase) return null

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-all border-b-2 active:scale-95',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40'
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span className={cn('size-1.5 rounded-full', active ? 'bg-primary' : 'bg-muted-foreground/40')} />
      <span className="truncate max-w-[180px]">
        {phase.number > 0 ? `P${phase.number} ` : ''}{phase.name}
      </span>
    </button>
  )
}

// Re-export for convenience
export type { WorkspaceView, Phase }
