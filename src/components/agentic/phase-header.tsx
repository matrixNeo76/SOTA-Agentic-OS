'use client'

import { PHASES, CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/store'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
  Scissors, GitFork, FunctionSquare, UserCog,
  Boxes, HeartPulse, Target, Network, Shuffle,
  Gauge, Package,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
  Scissors, GitFork, FunctionSquare, UserCog,
  Boxes, HeartPulse, Target, Network, Shuffle,
  Gauge, Package,
}

export function PhaseHeader({
  phaseId,
  action,
}: {
  phaseId: string
  action?: React.ReactNode
}) {
  const meta = PHASES.find((p) => p.id === phaseId)
  if (!meta) return null

  const Icon = ICON_MAP[meta.icon] || LayoutDashboard
  const catColor = CATEGORY_COLORS[meta.category] || 'text-primary'

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b">
      <div className="flex items-center gap-3">
        <div className={cn(
          'size-11 rounded-xl flex items-center justify-center shrink-0 border',
          'bg-primary/5 border-primary/10'
        )}>
          <Icon className={cn('size-5', catColor)} />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight">{meta.name}</h1>
            <Badge variant="outline" className="text-[10px] font-mono px-1.5">F{meta.number}</Badge>
            <Badge variant="secondary" className={cn('text-[9px] px-1.5', catColor)}>
              {CATEGORY_LABELS[meta.category]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.subtitle}</p>
        </div>
      </div>
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  )
}

export function PhaseKpi({
  label,
  value,
  highlight,
  warn,
  danger,
}: {
  label: string
  value: number | string
  highlight?: boolean
  warn?: boolean
  danger?: boolean
}) {
  return (
    <div className="rounded-xl border bg-card p-3 card-hover">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className={cn(
        'text-xl font-bold font-mono tabular-nums',
        highlight && 'text-emerald-600 dark:text-emerald-400',
        warn && 'text-amber-600 dark:text-amber-400',
        danger && 'text-red-600 dark:text-red-400',
      )}>
        {value}
      </div>
    </div>
  )
}

export function PhaseKpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {children}
    </div>
  )
}
