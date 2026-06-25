'use client'

import { useState, useEffect } from 'react'
import { useStore, type Phase } from '@/lib/store'
import { getIcon } from '@/lib/phase-icons'
import { cn } from '@/lib/utils'
import { useDashboard } from './use-dashboard'
import { PanelLeftClose, PanelLeft, ChevronDown } from 'lucide-react'
import { DynamicIcon } from '@/components/shared/dynamic-icon'

type SectionId = 'action' | 'inspect' | 'ecosystem'

type NavItem = {
 phaseId: Phase
 label: string
 icon: string
 badgeKey?: 'phase9' | 'phase11' | 'phase4' | 'cockpit'
}

type Section = {
 id: SectionId
 label: string
 items: NavItem[]
}

const SECTIONS: Section[] = [
 {
 id: 'action',
 label: 'Action',
 items: [
 { phaseId: 'overview', label: 'Dashboard', icon: 'LayoutDashboard' },
 { phaseId: 'console', label: 'Console', icon: 'Terminal' },
 { phaseId: 'cockpit', label: 'Cockpit', icon: 'Gauge', badgeKey: 'cockpit' },
 ],
 },
 {
 id: 'inspect',
 label: 'Inspect',
 items: [
 { phaseId: 'domain-memory', label: 'Memory & Context', icon: 'Database' },
 { phaseId: 'domain-plan', label: 'Plan & Execute', icon: 'Workflow' },
 { phaseId: 'domain-verify', label: 'Verify & Trust', icon: 'ShieldCheck', badgeKey: 'phase4' },
 { phaseId: 'domain-learn', label: 'Learn & Route', icon: 'Sparkles' },
 ],
 },
 {
 id: 'ecosystem',
 label: 'Ecosystem',
 items: [
 { phaseId: 'tools', label: 'Tool Manager', icon: 'Package' },
 { phaseId: 'phase9', label: 'Human Retainer', icon: 'UserCog', badgeKey: 'phase9' },
 ],
 },
]

const DEFAULT_EXPANDED: SectionId[] = ['action', 'inspect', 'ecosystem']

export function Sidebar() {
 const { activePhase, setActivePhase } = useStore()
 const { data } = useDashboard()
 const [collapsed, setCollapsed] = useState(false)
 const [expanded, setExpanded] = useState<SectionId[]>(() => {
 if (typeof window === 'undefined') return DEFAULT_EXPANDED
 try {
 const saved = localStorage.getItem('sota_sidebar_sections')
 return saved ? JSON.parse(saved) : DEFAULT_EXPANDED
 } catch {
 return DEFAULT_EXPANDED
 }
 })

 useEffect(() => {
 try {
 localStorage.setItem('sota_sidebar_sections', JSON.stringify(expanded))
 } catch { /* ignore */ }
 }, [expanded])

 const toggleSection = (id: SectionId) => {
 setExpanded(prev =>
 prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
 )
 }

 return (
 <aside className={cn(
 'hidden md:flex shrink-0 flex-col border-r bg-sidebar transition-all duration-200',
 collapsed ? 'w-14' : 'w-60'
 )}>
 {/* Logo bar premium */}
 <div className="h-16 flex items-center border-b px-3 shrink-0">
 <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
 <img src="/logo-transparent.png" alt="SOTA" className="size-6 rounded object-contain" />
 </div>
 {!collapsed && (
 <div className="ml-2.5">
 <div className="text-sm font-semibold tracking-tight leading-none">SOTA OS</div>
 <div className="text-[10px] text-muted-foreground mt-0.5 tracking-wider uppercase">Agentic</div>
 </div>
 )}
 </div>

 <nav className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-1.5' : 'px-2.5')}>
 {SECTIONS.map((section) => {
 const isExpanded = expanded.includes(section.id)
 return (
 <div key={section.id} className="mb-2">
 {/* Section header */}
 {!collapsed && (
 <button
 onClick={() => toggleSection(section.id)}
 className="w-full flex items-center gap-1.5 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors"
 >
 <ChevronDown className={cn('size-3 transition-transform', !isExpanded && '-rotate-90')} />
 <span>{section.label}</span>
 <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">
 {section.items.length}
 </span>
 </button>
 )}
 {collapsed && (
 <div className="h-px bg-border mx-1 my-2" />
 )}

 {/* Items */}
 {(isExpanded || collapsed) && section.items.map((item) => {
 const Icon = getIcon(item.icon)
 const active = activePhase === item.phaseId
 const badge = item.badgeKey ? getLiveBadge(item.badgeKey, data) : null
 return (
 <button
 key={item.phaseId}
 onClick={() => setActivePhase(item.phaseId)}
 className={cn(
 'w-full flex items-center rounded-md transition-all group relative',
 collapsed ? 'justify-center p-2' : 'gap-2.5 px-3 py-2',
 active
 ? 'bg-primary/8 text-primary font-medium'
 : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
 )}
 title={collapsed ? item.label : undefined}
 >
 {/* Active accent bar */}
 {active && !collapsed && (
 <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-primary" />
 )}
 <Icon className={cn('size-4 shrink-0 transition-colors', active && 'text-primary')} />
 {!collapsed && (
 <span className="text-[13px] leading-tight truncate">
 {item.label}
 </span>
 )}
 {/* Badge premium */}
 {!collapsed && badge && (
 <span className={cn(
 'ml-auto text-[10px] px-1.5 py-0.5 rounded-xs font-mono font-bold shrink-0 text-white',
 badge.tone === 'warn' && 'bg-status-warn',
 badge.tone === 'danger' && 'bg-status-danger',
 badge.tone === 'info' && 'bg-status-info',
 badge.tone === 'ok' && 'bg-status-ok',
 )}>
 {badge.value}
 </span>
 )}
 {collapsed && badge && (
 <span className={cn(
 'absolute top-1 right-1 size-1.5 rounded-full',
 badge.tone === 'warn' && 'bg-status-warn',
 badge.tone === 'danger' && 'bg-status-danger',
 badge.tone === 'info' && 'bg-status-info',
 )} />
 )}
 </button>
 )
 })}
 </div>
 )
 })}
 </nav>

 {/* Collapse button */}
 <div className="border-t p-2 shrink-0">
 <button
 onClick={() => setCollapsed(!collapsed)}
 className="w-full h-8 flex items-center justify-center rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
 title={collapsed ? 'Espandi sidebar' : 'Comprimi sidebar'}
 aria-label={collapsed ? 'Espandi sidebar' : 'Comprimi sidebar'}
 >
 {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
 </button>
 </div>
 </aside>
 )
}

/**
 * MobileNav Premium
 */
export function MobileNav() {
 const { activePhase, setActivePhase } = useStore()
 const [open, setOpen] = useState(false)

 const currentItem = SECTIONS.flatMap(s => s.items).find(i => i.phaseId === activePhase)
 const currentSection = SECTIONS.find(s => s.items.some(i => i.phaseId === activePhase))
 const currentIconName = currentItem?.icon

 return (
 <div className="md:hidden border-b bg-sidebar sticky top-0 z-40">
 <button
 onClick={() => setOpen(!open)}
 className="w-full flex items-center gap-2.5 px-4 py-3"
 aria-label="Apri menu di navigazione"
 aria-expanded={open}
 >
 <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
 {currentIconName && <DynamicIcon name={currentIconName} className="size-4 text-primary" />}
 </div>
 <span className="text-sm font-medium flex-1 text-left">
 {currentSection && (
 <span className="text-[10px] text-muted-foreground uppercase tracking-wider block leading-none mb-0.5">
 {currentSection.label}
 </span>
 )}
 {currentItem?.label || 'Dashboard'}
 </span>
 <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
 </button>

 {open && (
 <>
 <div className="fixed inset-0 top-0 z-30" onClick={() => setOpen(false)} />
 <div className="absolute left-0 right-0 bg-popover border-b shadow-lg z-40 max-h-[70vh] overflow-y-auto animate-in fade-in-0 slide-in-from-top-2 duration-200">
 {SECTIONS.map((section) => (
 <div key={section.id} className="py-1.5">
 <div className="text-[11px] font-semibold uppercase tracking-wider px-4 py-1.5 text-muted-foreground/70">
 {section.label}
 </div>
 {section.items.map((item) => {
 const Icon = getIcon(item.icon)
 const active = activePhase === item.phaseId
 return (
 <button
 key={item.phaseId}
 onClick={() => { setActivePhase(item.phaseId); setOpen(false) }}
 className={cn(
 'w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors relative',
 active ? 'bg-primary/8 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
 )}
 >
 {active && (
 <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-primary" />
 )}
 <Icon className={cn('size-4 shrink-0', active && 'text-primary')} />
 <span className="text-sm">{item.label}</span>
 </button>
 )
 })}
 </div>
 ))}
 </div>
 </>
 )}
 </div>
 )
}

function getLiveBadge(phaseId: string, data: any): { value: string | number; tone: 'warn' | 'danger' | 'info' | 'ok' } | null {
 if (!data) return null
 try {
 switch (phaseId) {
 case 'phase9': { const v = data.phase9?.pendingGates || 0; return v > 0 ? { value: v, tone: 'warn' } : null }
 case 'phase11': { const v = data.phase11?.interventions || 0; return v > 0 ? { value: v, tone: 'danger' } : null }
 case 'phase4': { const v = data.phase4?.verifRejects || 0; return v > 0 ? { value: v, tone: 'danger' } : null }
 case 'cockpit': { const v = data.blocked?.pending || 0; return v > 0 ? { value: v, tone: 'danger' } : null }
 default: return null
 }
 } catch { return null }
}
