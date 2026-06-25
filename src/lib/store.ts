'use client'

import { create } from 'zustand'

// === UX-1: Information Architecture ridisegnata ===
// 6 aree per obiettivo utente (non per fase di sviluppo).
// Le vecchie "fasi" 1-14 diventano "Advanced / Internals".

export type Phase =
  // Core areas (6 aree per obiettivo)
  | 'dashboard'
  | 'runs'           // UX-3: Console + esecuzione workflow + HITL
  | 'memory'         // Context Graph, memoria, knowledge extraction
  | 'agents'         // Mesh multi-agente, lifecycle, autonomous-org, skill
  | 'governance'     // LTL/verify, conflict, sovereign/HITL, audit
  | 'insights'       // world-model, digital-twin, evaluation, cost, observability
  // Admin
  | 'admin'
  // Advanced / Internals (vecchie fasi, come vista debug)
  | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'phase5'
  | 'phase6' | 'phase7' | 'phase8' | 'phase9' | 'phase10'
  | 'phase11' | 'phase12' | 'phase13' | 'phase14'
  | 'tools' | 'domain-memory' | 'domain-plan' | 'domain-verify' | 'domain-learn'
  // Legacy compat
  | 'overview' | 'console' | 'cockpit'

export type PhaseCategory = 'core' | 'memory' | 'agents' | 'governance' | 'insights' | 'ecosystem' | 'advanced' | 'foundation' | 'orchestration' | 'cognitive' | 'trust' | 'learning' | 'infrastructure'

export type PhaseMeta = {
  id: Phase
  name: string        // nome descrittivo
  subtitle: string    // sottotitolo funzionale
  category: PhaseCategory
  icon: string        // nome icona (risolta nel componente)
  number: number      // fase originale (1-14), 0 per core
}

// Re-export da design-tokens (singola fonte di verita)
export { CATEGORY_COLORS, CATEGORY_LABELS } from '@/lib/design-tokens'

// === 6 Aree principali per obiettivo utente ===
export const CORE_AREAS: PhaseMeta[] = [
  { id: 'dashboard', name: 'Dashboard', subtitle: 'Overview · KPI · Activity', category: 'core', icon: 'LayoutDashboard', number: 0 },
  { id: 'runs', name: 'Runs', subtitle: 'Esegui workflow · Console · HITL', category: 'core', icon: 'Play', number: 0 },
  { id: 'memory', name: 'Memory & Knowledge', subtitle: 'Context Graph · Memoria · Extraction', category: 'memory', icon: 'Database', number: 0 },
  { id: 'agents', name: 'Agents & Org', subtitle: 'Mesh · Lifecycle · Skills · Autonomous', category: 'agents', icon: 'Users', number: 0 },
  { id: 'governance', name: 'Trust & Governance', subtitle: 'LTL · Conflicts · Sovereign · Audit', category: 'governance', icon: 'ShieldCheck', number: 0 },
  { id: 'insights', name: 'Insights', subtitle: 'World Model · Digital Twin · Evaluation', category: 'insights', icon: 'TrendingUp', number: 0 },
]

// === Admin ===
export const ADMIN_AREAS: PhaseMeta[] = [
  { id: 'admin', name: 'Admin & Settings', subtitle: 'Config · Tools · Users · Governance', category: 'ecosystem', icon: 'Settings', number: 0 },
]

// === Advanced / Internals (vecchie fasi, come vista debug) ===
export const ADVANCED_PHASES: PhaseMeta[] = [
  { id: 'domain-memory', name: 'Memory Domain', subtitle: 'Phase 1 + 6 + 10', category: 'advanced', icon: 'Layers', number: 1 },
  { id: 'domain-plan', name: 'Plan Domain', subtitle: 'Phase 2 + 7 + 12', category: 'advanced', icon: 'ListChecks', number: 2 },
  { id: 'domain-verify', name: 'Verify Domain', subtitle: 'Phase 4 + 7 + 8 + 13', category: 'advanced', icon: 'BadgeCheck', number: 4 },
  { id: 'domain-learn', name: 'Learn Domain', subtitle: 'Phase 5 + 11 + 14 + 9', category: 'advanced', icon: 'Lightbulb', number: 5 },
  { id: 'phase1', name: 'NS-Mem · PatchBoard', subtitle: 'F1: Memory & State', category: 'advanced', icon: 'Save', number: 1 },
  { id: 'phase2', name: 'DynAMO · Compiled AI', subtitle: 'F2: Planner & Compiler', category: 'advanced', icon: 'Code2', number: 2 },
  { id: 'phase3', name: 'ACTS Controller', subtitle: 'F3: Cognitive Steering', category: 'advanced', icon: 'Compass', number: 3 },
  { id: 'phase4', name: 'LTL · Taint · Normative', subtitle: 'F4: Verification & Taint', category: 'advanced', icon: 'Lock', number: 4 },
  { id: 'phase5', name: 'ERL · Red Lines', subtitle: 'F5: Reflective Learning', category: 'advanced', icon: 'BookOpen', number: 5 },
  { id: 'phase6', name: 'Context Manager', subtitle: 'F6: Ring buffer · Summaries', category: 'advanced', icon: 'Scissors', number: 6 },
  { id: 'phase7', name: 'PTA · Dominators', subtitle: 'F7: Trace Validator', category: 'advanced', icon: 'GitFork', number: 7 },
  { id: 'phase8', name: 'Lean4 · LeanEvolve', subtitle: 'F8: Formal Verifier', category: 'advanced', icon: 'FunctionSquare', number: 8 },
  { id: 'phase9', name: 'Delegation · HITL · Audit', subtitle: 'F9: Human Retainer', category: 'advanced', icon: 'UserCog', number: 9 },
  { id: 'phase10', name: 'Model Encapsulator', subtitle: 'F10: Stateless LLM · Sandbox', category: 'advanced', icon: 'Boxes', number: 10 },
  { id: 'phase11', name: 'Affect Monitor', subtitle: 'F11: Desperation · Frustration', category: 'advanced', icon: 'HeartPulse', number: 11 },
  { id: 'phase12', name: 'Objective Builder', subtitle: 'F12: BFS Rubric Tree', category: 'advanced', icon: 'Target', number: 12 },
  { id: 'phase13', name: 'Swarm Coherence', subtitle: 'F13: Belief sync · Quorum', category: 'advanced', icon: 'Network', number: 13 },
  { id: 'phase14', name: 'Model Router', subtitle: 'F14: Adaptive routing · Ensemble', category: 'advanced', icon: 'Shuffle', number: 14 },
  { id: 'tools', name: 'Tool Manager', subtitle: 'Package manager · Permessi', category: 'advanced', icon: 'Package', number: 18 },
  { id: 'overview', name: 'Legacy Dashboard', subtitle: 'Old overview (compat)', category: 'advanced', icon: 'LayoutDashboard', number: 0 },
  { id: 'console', name: 'Legacy Console', subtitle: 'Old console (compat)', category: 'advanced', icon: 'Terminal', number: 0 },
  { id: 'cockpit', name: 'Legacy Cockpit', subtitle: 'Old cockpit (compat)', category: 'advanced', icon: 'Gauge', number: 15 },
]

// Compat: PHASES = tutte le aree
export const PHASES: PhaseMeta[] = [...CORE_AREAS, ...ADMIN_AREAS, ...ADVANCED_PHASES]

// === Workspace Views (SOTA Workbench v2) ===
export type WorkspaceView = 'console' | 'canvas' | 'timeline' | 'cockpit' | 'sovereign' | 'phase' | 'dashboard' | 'runs' | 'memory' | 'agents' | 'governance' | 'insights' | 'admin'

export type SelectedItem =
  | { type: 'node'; view: 'canvas'; id: string; meta?: Record<string, unknown> }
  | { type: 'message'; view: 'console'; id: string; meta?: Record<string, unknown> }
  | { type: 'artifact'; view: 'console'; id: string; meta?: Record<string, unknown> }
  | { type: 'log'; view: 'timeline'; id: string; meta?: Record<string, unknown> }
  | { type: 'blocked'; view: 'sovereign'; id: string; meta?: Record<string, unknown> }
  | null

export type ContextPanelMode = 'quickstats' | 'phase' | 'inspector' | 'help'

type State = {
  activePhase: Phase
  activeView: WorkspaceView
  contextPanelOpen: boolean
  contextPanelMode: ContextPanelMode
  selectedItem: SelectedItem
  commandPaletteOpen: boolean
  sensoriumLive: boolean
  cycleId: number
  systemLoad: number
  queueDepth: number
  activeThreads: number
  setActivePhase: (p: Phase) => void
  setActiveView: (v: WorkspaceView) => void
  setContextPanelOpen: (open: boolean) => void
  setContextPanelMode: (mode: ContextPanelMode) => void
  toggleContextPanel: () => void
  setSelectedItem: (item: SelectedItem) => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  toggleSensorium: () => void
  setRuntime: (s: { cycleId?: number; systemLoad?: number; queueDepth?: number; activeThreads?: number }) => void
}

// Map phase → view
function phaseToView(p: Phase): WorkspaceView {
  switch (p) {
    case 'dashboard': case 'overview': return 'dashboard'
    case 'runs': case 'console': return 'runs'
    case 'memory': case 'domain-memory': return 'memory'
    case 'agents': return 'agents'
    case 'governance': return 'governance'
    case 'insights': return 'insights'
    case 'admin': return 'admin'
    case 'cockpit': return 'cockpit'
    default: return 'phase' // advanced phases
  }
}

export const useStore = create<State>((set) => ({
  activePhase: 'dashboard',
  activeView: 'dashboard',
  contextPanelOpen: false,
  contextPanelMode: 'quickstats',
  selectedItem: null,
  commandPaletteOpen: false,
  sensoriumLive: false,
  cycleId: 0,
  systemLoad: 0,
  queueDepth: 0,
  activeThreads: 0,
  setActivePhase: (p) => set({
    activePhase: p,
    activeView: phaseToView(p),
    selectedItem: null,
  }),
  setActiveView: (v) => set({
    activeView: v,
    // Sync activePhase based on view
    activePhase: v === 'dashboard' ? 'dashboard'
      : v === 'runs' ? 'runs'
      : v === 'memory' ? 'memory'
      : v === 'agents' ? 'agents'
      : v === 'governance' ? 'governance'
      : v === 'insights' ? 'insights'
      : v === 'admin' ? 'admin'
      : v === 'console' ? 'console'
      : v === 'cockpit' ? 'cockpit'
      : 'phase1',
    selectedItem: null,
  }),
  setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
  setContextPanelMode: (mode) => set({ contextPanelMode: mode }),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  setSelectedItem: (item) => set((state) => ({
    selectedItem: item,
    contextPanelOpen: item !== null ? true : state.contextPanelOpen,
  })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  toggleSensorium: () => set((s) => ({ sensoriumLive: !s.sensoriumLive })),
  setRuntime: (s) => set((state) => ({ ...state, ...s })),
}))
