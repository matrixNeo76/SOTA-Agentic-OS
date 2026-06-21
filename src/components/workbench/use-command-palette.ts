'use client'

import { useEffect } from 'react'
import { useStore } from '@/lib/store'

/**
 * Global hook that wires up the Cmd+K (and Ctrl+K) keyboard shortcut
 * to toggle the command palette. Mount this once at the app root.
 *
 * Also handles:
 * - Escape to close the palette
 * - Cmd+\ to toggle context panel (bonus shortcut for power users)
 */
export function useCommandPalette() {
  const { toggleCommandPalette, setCommandPaletteOpen, commandPaletteOpen, toggleContextPanel } = useStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K → toggle command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        toggleCommandPalette()
        return
      }

      // Escape → close palette if open
      if (e.key === 'Escape' && commandPaletteOpen) {
        e.preventDefault()
        setCommandPaletteOpen(false)
        return
      }

      // Cmd+\ / Ctrl+\ → toggle context panel
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        e.stopPropagation()
        toggleContextPanel()
        return
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true } as EventListenerOptions)
  }, [toggleCommandPalette, setCommandPaletteOpen, commandPaletteOpen, toggleContextPanel])
}
