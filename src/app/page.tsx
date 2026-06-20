'use client'

import { Sidebar, MobileNav } from '@/components/agentic/sidebar'
import { Topbar } from '@/components/agentic/topbar'
import { Overview } from '@/components/agentic/overview'
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
import { useStore } from '@/lib/store'
import { Toaster } from 'sonner'

export default function Home() {
  const { activePhase } = useStore()

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav />
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          {activePhase === 'overview' && <Overview />}
          {activePhase === 'phase1' && <Phase1 />}
          {activePhase === 'phase2' && <Phase2 />}
          {activePhase === 'phase3' && <Phase3 />}
          {activePhase === 'phase4' && <Phase4 />}
          {activePhase === 'phase5' && <Phase5 />}
          {activePhase === 'phase6' && <Phase6 />}
          {activePhase === 'phase7' && <Phase7 />}
          {activePhase === 'phase8' && <Phase8 />}
          {activePhase === 'phase9' && <Phase9 />}
          {activePhase === 'phase10' && <Phase10 />}
          {activePhase === 'phase11' && <Phase11 />}
          {activePhase === 'phase12' && <Phase12 />}
          {activePhase === 'phase13' && <Phase13 />}
          {activePhase === 'phase14' && <Phase14 />}
        </main>
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground bg-background">
          <div className="flex items-center justify-between gap-4">
            <span>SOTA Agentic OS · 14 micro-fasi · Grounded · Affect · Objective · ESR · TimeRouter</span>
            <span className="font-mono">v0.4.0</span>
          </div>
        </footer>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  )
}
