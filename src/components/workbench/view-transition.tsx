'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '@/lib/store'

/**
 * Animated view transition wrapper.
 *
 * Uses AnimatePresence to fade+slide the active view content when
 * the user switches between Console/Canvas/Timeline/Cockpit/Sovereign/Phase.
 *
 * Keyed by `activeView` (+ `activePhase` for the phase view) so React
 * remounts on view change, triggering the enter/exit animations.
 *
 * Animation spec (subtle, professional — not flashy):
 * - Initial: opacity 0, slight upward slide (8px)
 * - Animate: opacity 1, slide 0
 * - Exit: opacity 0, slight downward slide (8px)
 * - Duration: 0.2s with ease-out
 * - Mode: wait (exit completes before enter starts) to avoid overlap
 */
export function ViewTransition({ children }: { children: React.ReactNode }) {
  const { activeView, activePhase } = useStore()
  // Composite key so switching phases within "phase" view also re-animates
  const transitionKey = activeView === 'phase' ? `phase:${activePhase}` : activeView

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={transitionKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="h-full min-h-0"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * Animated context panel transition.
 * Slides in from right when opening, fades out when closing.
 */
export function ContextPanelTransition({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {isOpen && (
        <motion.div
          key="context-panel"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="h-full"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Animated content fade for context panel inspector changes.
 * Use when selectedItem changes to fade between QuickStats/NodeInspector/etc.
 */
export function InspectorTransition({ children, itemKey }: { children: React.ReactNode; itemKey: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={itemKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
