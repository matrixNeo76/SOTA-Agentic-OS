'use client'
import { Suspense } from 'react'

import { Sidebar, MobileNav } from '@/components/agentic/sidebar'
import { Topbar } from '@/components/agentic/topbar'
import { SovereignModalContainer } from '@/components/agentic/sovereign-modal'
import { WorkspaceViews } from '@/components/workbench/workspace-views'
import { CommandPalette } from '@/components/workbench/command-palette'
import { useCommandPalette } from '@/components/workbench/use-command-palette'
import { ContextPanel, MobileContextSheet } from '@/components/workbench/context-panel'
import { useStore } from '@/lib/store'
import { useUrlSync } from '@/hooks/use-url-sync'
import { OnboardingTour } from '@/components/onboarding/onboarding-tour'
import { OnboardingTourV2 } from '@/components/onboarding/onboarding-tour-v2'
import { Toaster } from 'sonner'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'

function HomeContent() {
  // Wire up global Cmd+K listener
  useCommandPalette()
  useUrlSync()
  const { activeView, activePhase, contextPanelOpen, selectedItem } = useStore()

  // Console-like views hide the footer to maximize vertical space
  const hideFooter = activeView === 'console' ||
    (activeView === 'phase' && activePhase === 'console')

  // Context panel is shown when explicitly open AND (there's a selection OR user toggled it manually).
  // On mobile we hide the desktop panel and rely on MobileContextSheet (FAB + sheet).
  const showContextPanel = contextPanelOpen

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <MobileNav />
        <Topbar />
        <main className="flex-1 overflow-hidden min-h-0">
          {/* Desktop: 2-zone resizable (workspace | context panel)
              Context panel can be hidden (collapses to 0). */}
          <div className="hidden md:flex h-full">
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={showContextPanel ? 70 : 100} minSize={40}>
                <WorkspaceViews />
              </ResizablePanel>
              {showContextPanel && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
                    <ContextPanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>

          {/* Mobile: workspace full-width, context panel via FAB + sheet */}
          <div className="md:hidden h-full">
            <WorkspaceViews />
          </div>
        </main>
        {!hideFooter && (
          <footer className="border-t px-4 py-2 text-[10px] text-muted-foreground bg-background/50">
            <div className="flex items-center justify-between gap-4">
              <span>SOTA Agentic OS · 23 fasi + 3 trasversali</span>
              <span className="font-mono">v0.7.0 · Workbench v2</span>
            </div>
          </footer>
        )}
      </div>
      {/* Mobile context panel (FAB + sheet) */}
      <MobileContextSheet />
      <SovereignModalContainer />
      <CommandPalette />
      <OnboardingTour />
      <OnboardingTourV2 />
      <Toaster richColors position="top-right" />
    </div>
  )
}


export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  )
}
