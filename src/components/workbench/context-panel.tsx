'use client'

import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { X, ChevronRight } from 'lucide-react'
import { QuickStats } from './quick-stats'
import { NodeInspector } from './node-inspector'
import { LogInspector } from './log-inspector'
import { BlockedInspector } from './blocked-inspector'

// === Main ContextPanel ===
export function ContextPanel({ className }: { className?: string }) {
  const { selectedItem, setContextPanelOpen, setSelectedItem } = useStore()

  return (
    <div className={cn('flex flex-col h-full bg-card border-l', className)}>
      {/* Top bar with close button */}
      <div className="shrink-0 flex items-center justify-end px-2 py-1.5 border-b bg-muted/30">
        <button
          onClick={() => {
            setSelectedItem(null)
            setContextPanelOpen(false)
          }}
          className="size-6 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Chiudi context panel"
          title="Chiudi (Cmd+\)"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Content (fills remaining height) */}
      <div className="flex-1 min-h-0">
        {!selectedItem ? (
          <QuickStats />
        ) : selectedItem.type === 'node' ? (
          <NodeInspector
            nodeId={selectedItem.id}
            dagType={(selectedItem.meta?.dagType as 'dynamo' | 'objective' | 'lean') || 'dynamo'}
            planId={selectedItem.meta?.planId as string | undefined}
            treeId={selectedItem.meta?.treeId as string | undefined}
            workflowId={selectedItem.meta?.workflowId as string | undefined}
          />
        ) : selectedItem.type === 'log' ? (
          <LogInspector logId={selectedItem.id} />
        ) : selectedItem.type === 'blocked' ? (
          <BlockedInspector blockedId={selectedItem.id} />
        ) : (
          <QuickStats />
        )}
      </div>
    </div>
  )
}

// === Mobile Sheet version ===
// On mobile, the context panel becomes a slide-up sheet triggered by a FAB.
// We render the FAB only when there's a selectedItem (something to inspect).
export function MobileContextSheet() {
  const { selectedItem, contextPanelOpen, setContextPanelOpen, setSelectedItem } = useStore()

  // Show FAB only on mobile (md:hidden) and when there's something to inspect
  if (!selectedItem) return null

  return (
    <>
      {/* FAB */}
      {!contextPanelOpen && (
        <button
          onClick={() => setContextPanelOpen(true)}
          className="md:hidden fixed bottom-4 right-4 z-30 size-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          aria-label="Apri dettagli elemento selezionato"
        >
          <ChevronRight className="size-5 rotate-[-90deg]" />
        </button>
      )}

      {/* Sheet */}
      {contextPanelOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in-0 duration-150"
            onClick={() => setContextPanelOpen(false)}
            aria-hidden
          />
          {/* Sheet content */}
          <div className="relative max-h-[85vh] bg-card border-t rounded-t-xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-200">
            {/* Drag handle */}
            <div className="shrink-0 pt-2 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ContextPanel />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
