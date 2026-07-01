import { create } from 'zustand'

type TransferState = {
  pendingTabSwitch: { phase: string; tab: string; timestamp: number } | null
  setPendingTabSwitch: (phase: string, tab: string) => void
  clearPendingTabSwitch: () => void
  pendingStepping: { phase: string; timestamp: number } | null
  setPendingStepping: (phase: string) => void
  clearPendingStepping: () => void
  shortcutsVisible: boolean
  setShortcutsVisible: (visible: boolean) => void
  toggleShortcuts: () => void
}

export const useTransferStore = create<TransferState>((set) => ({
  pendingTabSwitch: null,
  setPendingTabSwitch: (phase, tab) => set({ pendingTabSwitch: { phase, tab, timestamp: Date.now() } }),
  clearPendingTabSwitch: () => set({ pendingTabSwitch: null }),
  pendingStepping: null,
  setPendingStepping: (phase) => set({ pendingStepping: { phase, timestamp: Date.now() } }),
  clearPendingStepping: () => set({ pendingStepping: null }),
  shortcutsVisible: false,
  setShortcutsVisible: (visible) => set({ shortcutsVisible: visible }),
  toggleShortcuts: () => set((s) => ({ shortcutsVisible: !s.shortcutsVisible })),
}))
