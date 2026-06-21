'use client'

import { Sidebar, MobileNav } from '@/components/agentic/sidebar'
import { Topbar } from '@/components/agentic/topbar'
import { SovereignModalContainer } from '@/components/agentic/sovereign-modal'
import { WorkspaceViews } from '@/components/workbench/workspace-views'
import { CommandPalette } from '@/components/workbench/command-palette'
import { useCommandPalette } from '@/components/workbench/use-command-palette'
import { useStore } from '@/lib/store'
import { Toaster } from 'sonner'

export default function Home() {
  // Wire up global Cmd+K listener
  useCommandPalette()
  const { activeView, activePhase } = useStore()

  // Console-like views hide the footer to maximize vertical space
  const hideFooter = activeView === 'console' ||
    (activeView === 'phase' && activePhase === 'console')

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <MobileNav />
        <Topbar />
        <main className="flex-1 overflow-hidden min-h-0">
          <WorkspaceViews />
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
      <SovereignModalContainer />
      <CommandPalette />
      <Toaster richColors position="top-right" />
    </div>
  )
}
