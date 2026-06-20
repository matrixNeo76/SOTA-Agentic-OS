'use client'

import { PHASES, CATEGORY_COLORS } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
  Scissors, GitFork, FunctionSquare, UserCog,
  Boxes, HeartPulse, Target, Network, Shuffle,
  Gauge, Package, Terminal,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, Database, Workflow, Compass, ShieldCheck, Sparkles,
  Scissors, GitFork, FunctionSquare, UserCog,
  Boxes, HeartPulse, Target, Network, Shuffle,
  Gauge, Package, Terminal,
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

  return (
    <div className="flex items-center justify-between gap-4 pb-5">
      <div className="flex items-center gap-3">
        <Icon className={cn('size-5', CATEGORY_COLORS[meta.category] || 'text-primary')} />
        <div>
          <h1 className="text-lg font-semibold tracking-tight leading-tight">{meta.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.subtitle}</p>
        </div>
      </div>
      {action}
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
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className={cn(
        'text-lg font-semibold font-mono tabular-nums',
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
      {children}
    </div>
  )
}
