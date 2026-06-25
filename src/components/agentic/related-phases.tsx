'use client'

import { useStore, type Phase } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type RelatedLink = {
 phase: Phase
 /** Label del bottone (es. "Verifica formalmente") */
 label: string
 /** Cosa fa la fase target in relazione a quella corrente */
 reason: string
 /** Stato opzionale da passare alla fase target (es. planId pre-caricato) */
 transferState?: Record<string, unknown>
}

/**
 * Pannello che mostra le fasi collegate a quella corrente, con bottoni
 * contestuali per navigare nel flusso end-to-end.
 *
 * Da integrare in fondo a ogni phase component.
 */
export function RelatedPhases({ links }: { links: RelatedLink[] }) {
 const { setActivePhase } = useStore()

 if (links.length === 0) return null

 const handleClick = (link: RelatedLink) => {
 // Salva lo stato di transfer in sessionStorage per la fase target
 if (link.transferState) {
 try {
 sessionStorage.setItem(
 `phase_transfer_${link.phase}`,
 JSON.stringify({ ...link.transferState, _ts: Date.now() })
 )
 } catch {
 // sessionStorage non disponibile (SSR o privacy mode) — fallback: naviga e basta
 }
 }
 setActivePhase(link.phase)
 }

 return (
 <Card className="border-dashed">
 <CardHeader className="pb-3">
 <CardTitle className="text-sm flex items-center gap-2">
 <Link2 className="size-4 text-muted-foreground" />
 Fasi collegate
 </CardTitle>
 <CardDescription className="text-xs">
 Naviga nel flusso end-to-end dell'architettura
 </CardDescription>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
 {links.map((link) => {
 const Icon = getIcon(getPhaseIconName(link.phase))
 return (
 <Button
 key={link.phase}
 variant="outline"
 size="sm"
 onClick={() => handleClick(link)}
 className="h-auto p-3 flex items-start gap-2 justify-start text-left"
 >
 <Icon className="size-4 shrink-0 mt-0.5 text-primary" />
 <div className="flex-1 min-w-0">
 <div className="text-xs font-medium flex items-center gap-1">
 {link.label}
 <ArrowRight className="size-3 text-muted-foreground" />
 </div>
 <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
 {link.reason}
 </div>
 </div>
 </Button>
 )
 })}
 </div>
 </CardContent>
 </Card>
 )
}

/**
 * Recupera lo stato transfer dalla sessionStorage (chiamato dalla fase target).
 * Auto-pulisce dopo la lettura.
 */
export function consumeTransferState(phase: Phase): Record<string, unknown> | null {
 if (typeof window === 'undefined') return null
 try {
 const key = `phase_transfer_${phase}`
 const raw = sessionStorage.getItem(key)
 if (!raw) return null
 sessionStorage.removeItem(key)
 const parsed = JSON.parse(raw)
 if (parsed._ts && Date.now() - parsed._ts > 60_000) return null // expire dopo 60s
 delete parsed._ts
 return parsed
 } catch {
 return null
 }
}

/**
 * Mappa phase ID → nome icona (per evitare import circolari).
 */
function getPhaseIconName(phase: Phase): string {
 const map: Record<string, string> = {
 overview: 'LayoutDashboard',
 console: 'Terminal',
 cockpit: 'Gauge',
 phase1: 'Database',
 phase2: 'Workflow',
 phase3: 'Compass',
 phase4: 'ShieldCheck',
 phase5: 'Sparkles',
 phase6: 'Scissors',
 phase7: 'GitFork',
 phase8: 'FunctionSquare',
 phase9: 'UserCog',
 phase10: 'Boxes',
 phase11: 'HeartPulse',
 phase12: 'Target',
 phase13: 'Network',
 phase14: 'Shuffle',
 tools: 'Package',
 }
 return map[phase] || 'LayoutDashboard'
}

/**
 * Helper per costruire link rapidamente.
 */
export const link = (
 phase: Phase,
 label: string,
 reason: string,
 transferState?: Record<string, unknown>
): RelatedLink => ({ phase, label, reason, transferState })

/**
 * Definizione dei flussi end-to-end dell'architettura SOTA.
 * Usata dalla ArchitectureMap nella Dashboard.
 */
export const ARCHITECTURE_FLOWS: { name: string; color: string; phases: Phase[] }[] = [
 { name: 'Plan → Verify → Deploy', color: '#10b981', phases: ['phase2', 'phase8', 'phase7', 'phase9'] },
 { name: 'Cognitive Cycle', color: '#8b5cf6', phases: ['phase1', 'phase6', 'phase10', 'phase14', 'phase3'] },
 { name: 'Open Objective', color: '#f59e0b', phases: ['phase12', 'phase2', 'phase5'] },
 { name: 'Trust Enforcement', color: '#ef4444', phases: ['phase4', 'phase11', 'phase9'] },
 { name: 'Swarm Consensus', color: '#06b6d4', phases: ['phase2', 'phase13', 'phase1'] },
 { name: 'Failure Recovery', color: '#ec4899', phases: ['phase5', 'phase8', 'phase2'] },
]
