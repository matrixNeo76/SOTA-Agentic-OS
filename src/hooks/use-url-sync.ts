'use client'
import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore, type Phase, type WorkspaceView } from '@/lib/store'

const VALID_PHASES: Phase[] = ['overview', 'console', 'cockpit', 'domain-memory', 'domain-plan', 'domain-verify', 'domain-learn', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'phase6', 'phase7', 'phase8', 'phase9', 'phase10', 'phase11', 'phase12', 'phase13', 'phase14', 'tools']
const VALID_VIEWS: WorkspaceView[] = ['console', 'canvas', 'timeline', 'cockpit', 'sovereign', 'phase']
function isPhase(v: string | null): v is Phase { return v !== null && VALID_PHASES.includes(v as Phase) }
function isView(v: string | null): v is WorkspaceView { return v !== null && VALID_VIEWS.includes(v as WorkspaceView) }

export function useUrlSync() {
  const { activePhase, activeView, setActivePhase, setActiveView } = useStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const mounted = useRef(false)

  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    const phaseParam = searchParams.get('phase')
    const viewParam = searchParams.get('view')
    if (isPhase(phaseParam) && phaseParam !== activePhase) setActivePhase(phaseParam)
    else if (isView(viewParam) && viewParam !== activeView) setActiveView(viewParam)
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    let changed = false
    if (activePhase && activePhase !== 'overview') { if (url.searchParams.get('phase') !== activePhase) { url.searchParams.set('phase', activePhase); changed = true } }
    else { if (url.searchParams.has('phase')) { url.searchParams.delete('phase'); changed = true } }
    const expectedView = activePhase === 'console' ? 'console' : activePhase === 'cockpit' ? 'cockpit' : 'phase'
    if (activeView !== expectedView) { if (url.searchParams.get('view') !== activeView) { url.searchParams.set('view', activeView); changed = true } }
    else { if (url.searchParams.has('view')) { url.searchParams.delete('view'); changed = true } }
    if (changed) router.replace(url.pathname + (url.search || ''), { scroll: false })
  }, [activePhase, activeView, router])
}
