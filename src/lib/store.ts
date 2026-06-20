'use client'

import { create } from 'zustand'

export type Phase = 'overview' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'phase5'

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
