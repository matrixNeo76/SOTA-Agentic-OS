'use client'

import { create } from 'zustand'

export type Phase = 'overview' | 'cockpit' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'phase5' | 'phase6' | 'phase7' | 'phase8' | 'phase9' | 'phase10' | 'phase11' | 'phase12' | 'phase13' | 'phase14' | 'tools'

export type PhaseCategory = 'foundation' | 'orchestration' | 'cognitive' | 'trust' | 'learning' | 'governance' | 'infrastructure'

export type PhaseMeta = {
  id: Phase
  name: string        // nome descrittivo
  subtitle: string    // sottotitolo funzionale
  category: PhaseCategory | 'core'
  icon: string        // nome icona (risolta nel componente)
  number: number      // fase originale (1-14), 0 per overview
}

export const CATEGORY_LABELS: Record<string, string> = {
  core: 'CORE',
  foundation: 'FOUNDATION',
  orchestration: 'ORCHESTRATION',
  cognitive: 'COGNITIVE CONTROL',
  trust: 'TRUST & VERIFY',
  learning: 'LEARNING',
  governance: 'GOVERNANCE',
  infrastructure: 'INFRASTRUCTURE',
}

export const CATEGORY_COLORS: Record<string, string> = {
  core: 'text-primary',
  foundation: 'text-sky-600 dark:text-sky-400',
  orchestration: 'text-emerald-600 dark:text-emerald-400',
  cognitive: 'text-violet-600 dark:text-violet-400',
  trust: 'text-red-600 dark:text-red-400',
  learning: 'text-amber-600 dark:text-amber-400',
  governance: 'text-pink-600 dark:text-pink-400',
  infrastructure: 'text-cyan-600 dark:text-cyan-400',
}

export const PHASES: PhaseMeta[] = [
  { id: 'overview', name: 'Dashboard', subtitle: 'Mappa architetturale + KPI + activity feed', category: 'core', icon: 'LayoutDashboard', number: 0 },
  { id: 'cockpit', name: 'Cockpit', subtitle: 'Plancia di comando · 5 tab', category: 'core', icon: 'Gauge', number: 15 },
  { id: 'phase1', name: 'Memory & State', subtitle: 'NS-Mem · PatchBoard · Sensorium', category: 'foundation', icon: 'Database', number: 1 },
  { id: 'phase6', name: 'Context Manager', subtitle: 'Ring buffer · Summaries', category: 'foundation', icon: 'Scissors', number: 6 },
  { id: 'phase2', name: 'Planner & Compiler', subtitle: 'DynAMO · Compiled AI', category: 'orchestration', icon: 'Workflow', number: 2 },
  { id: 'phase7', name: 'Trace Validator', subtitle: 'PTA · Dominators', category: 'orchestration', icon: 'GitFork', number: 7 },
  { id: 'phase12', name: 'Objective Builder', subtitle: 'BFS Rubric Tree', category: 'orchestration', icon: 'Target', number: 12 },
  { id: 'phase3', name: 'Cognitive Steering', subtitle: 'ACTS Controller', category: 'cognitive', icon: 'Compass', number: 3 },
  { id: 'phase10', name: 'Model Encapsulator', subtitle: 'Stateless LLM · Sandbox', category: 'cognitive', icon: 'Boxes', number: 10 },
  { id: 'phase11', name: 'Affect Monitor', subtitle: 'Desperation · Frustration', category: 'cognitive', icon: 'HeartPulse', number: 11 },
  { id: 'phase4', name: 'Verification & Taint', subtitle: 'LTL · Taint · Normative', category: 'trust', icon: 'ShieldCheck', number: 4 },
  { id: 'phase8', name: 'Formal Verifier', subtitle: 'Lean4 · LeanEvolve', category: 'trust', icon: 'FunctionSquare', number: 8 },
  { id: 'phase13', name: 'Swarm Coherence', subtitle: 'Belief sync · Quorum', category: 'trust', icon: 'Network', number: 13 },
  { id: 'phase5', name: 'Reflective Learning', subtitle: 'ERL · Red Lines', category: 'learning', icon: 'Sparkles', number: 5 },
  { id: 'phase9', name: 'Human Retainer', subtitle: 'Delegation · HITL · Audit', category: 'governance', icon: 'UserCog', number: 9 },
  { id: 'tools', name: 'Tool Manager', subtitle: 'Package manager · Permessi', category: 'governance', icon: 'Package', number: 18 },
  { id: 'phase14', name: 'Model Router', subtitle: 'Adaptive routing · Ensemble', category: 'infrastructure', icon: 'Shuffle', number: 14 },
]

type State = {
  activePhase: Phase
  sensoriumLive: boolean
  cycleId: number
  systemLoad: number
  queueDepth: number
  activeThreads: number
  setActivePhase: (p: Phase) => void
  toggleSensorium: () => void
  setRuntime: (s: { cycleId?: number; systemLoad?: number; queueDepth?: number; activeThreads?: number }) => void
}

export const useStore = create<State>((set) => ({
  activePhase: 'overview',
  sensoriumLive: false,
  cycleId: 0,
  systemLoad: 0,
  queueDepth: 0,
  activeThreads: 0,
  setActivePhase: (p) => set({ activePhase: p }),
  toggleSensorium: () => set((s) => ({ sensoriumLive: !s.sensoriumLive })),
  setRuntime: (s) => set((state) => ({ ...state, ...s })),
}))
