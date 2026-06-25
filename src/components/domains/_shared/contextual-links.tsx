'use client'
import { cn } from '@/lib/utils'
import { useStore, type Phase } from '@/lib/store'
import { ARCHITECTURE_FLOWS } from '@/components/agentic/related-phases'
import { ArrowRight, Workflow } from 'lucide-react'

const DOMAIN_TO_PHASES: Record<string, Phase[]> = {
 'domain-memory': ['phase1', 'phase6', 'phase10'],
 'domain-plan': ['phase2', 'phase3', 'phase12'],
 'domain-verify': ['phase4', 'phase7', 'phase8', 'phase13'],
 'domain-learn': ['phase5', 'phase11', 'phase14', 'phase9'],
}
const PHASE_TO_DOMAIN: Record<string, string> = {}
for (const [d, ps] of Object.entries(DOMAIN_TO_PHASES)) { for (const p of ps) PHASE_TO_DOMAIN[p] = d }

export function getContextualLinks(currentPhase: Phase): Array<{ targetDomain: Phase; flowName: string; flowColor: string; description: string }> {
 const currentPhases = DOMAIN_TO_PHASES[currentPhase] || [currentPhase]
 if (currentPhases.length === 0) return []
 const links: Array<{ targetDomain: Phase; flowName: string; flowColor: string; description: string }> = []
 const seen = new Set<string>()
 for (const flow of ARCHITECTURE_FLOWS) {
 if (!flow.phases.some(p => currentPhases.includes(p))) continue
 for (const p of flow.phases) {
 const td = (PHASE_TO_DOMAIN[p] || p) as Phase
 if (td === currentPhase || seen.has(td)) continue
 seen.add(td)
 links.push({ targetDomain: td, flowName: flow.name, flowColor: flow.color, description: `Flusso: ${flow.name}` })
 }
 }
 return links
}

const DOMAIN_META: Record<string, { name: string }> = {
 'domain-memory': { name: 'Memory & Context' }, 'domain-plan': { name: 'Plan & Execute' },
 'domain-verify': { name: 'Verify & Trust' }, 'domain-learn': { name: 'Learn & Route' },
 tools: { name: 'Tool Manager' }, phase1: { name: 'Memory & State' }, phase2: { name: 'Planner' },
 phase3: { name: 'Steering' }, phase4: { name: 'Verification' }, phase5: { name: 'Reflective' },
 phase6: { name: 'Context Manager' }, phase7: { name: 'Trace Validator' }, phase8: { name: 'Formal Verifier' },
 phase9: { name: 'Human Retainer' }, phase10: { name: 'Model Encapsulator' }, phase11: { name: 'Affect Monitor' },
 phase12: { name: 'Objective Builder' }, phase13: { name: 'Swarm Coherence' }, phase14: { name: 'Model Router' },
}

export function ContextualLinks({ className }: { className?: string }) {
 const { activePhase, setActivePhase } = useStore()
 const links = getContextualLinks(activePhase)
 if (links.length === 0) return null
 return (
 <div className={cn('pt-4 border-t', className)}>
 <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Workflow className="size-3" />Collegati nei flussi</div>
 <div className="flex flex-wrap gap-1.5">
 {links.map((l, i) => {
 const meta = DOMAIN_META[l.targetDomain]
 if (!meta) return null
 return <button key={i} onClick={() => setActivePhase(l.targetDomain)} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] hover:bg-accent transition-colors group" title={l.description} style={{ borderColor: `${l.flowColor}40` }}><span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: l.flowColor }} /><span className="font-medium">{meta.name}</span><ArrowRight className="size-2.5 text-muted-foreground group-hover:text-foreground transition-colors" /></button>
 })}
 </div>
 </div>
 )
}
