'use client'

import { useStore, PHASES, CATEGORY_COLORS, type Phase } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { cn } from '@/lib/utils'

export function ArchitectureMap() {
 const { setActivePhase, activePhase } = useStore()

 const categories = PHASES.reduce((acc, p) => {
 if (!acc[p.category]) acc[p.category] = []
 acc[p.category].push(p)
 return acc
 }, {} as Record<string, typeof PHASES>)

 const catOrder = ['foundation', 'orchestration', 'cognitive', 'trust', 'learning', 'governance', 'infrastructure']
 const catLabels: Record<string, string> = {
 foundation: 'Foundation', orchestration: 'Orchestration', cognitive: 'Cognitive',
 trust: 'Trust', learning: 'Learning', governance: 'Governance', infrastructure: 'Infra',
 }

 return (
 <div>
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
 {catOrder.map((cat) => {
 const phases = categories[cat] || []
 return (
 <div key={cat} className="space-y-1.5">
 <div className={cn(
 'text-[10px] font-medium uppercase tracking-wide pb-1.5 border-b',
 CATEGORY_COLORS[cat]
 )}>
 {catLabels[cat]}
 </div>
 {phases.map((p) => {
 const Icon = getIcon(p.icon)
 const active = activePhase === p.id
 return (
 <button
 key={p.id}
 onClick={() => setActivePhase(p.id as Phase)}
 className={cn(
 'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all',
 active
 ? 'bg-primary/10 ring-1 ring-primary/20'
 : 'hover:bg-accent/50'
 )}
 >
 <Icon className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
 <span className={cn('text-xs leading-tight truncate', active && 'font-medium')}>
 {p.name}
 </span>
 </button>
 )
 })}
 </div>
 )
 })}
 </div>
 </div>
 )
}
