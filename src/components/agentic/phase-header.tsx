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
  LayoutDashboard,
  Database,
  Workflow,
  Compass,
  ShieldCheck,
  Sparkles,
  Scissors,
  GitFork,
  FunctionSquare,
  UserCog,
  Boxes,
  HeartPulse,
  Target,
  Network,
  Shuffle,
  Gauge,
  Package,
}

/**
 * Header uniforme per tutte le pagine di fase.
 * Mostra:
 *  - Icona grande + nome descrittivo
 *  - Sottotitolo funzionale
 *  - Badge categoria con colore tematico
 *  - Numero fase originale (F1-F14) come riferimento
 *  - Azione personalizzabile (es. bottone "Aggiorna")
 */
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
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3">
        <div className={cn(
          'size-12 rounded-lg flex items-center justify-center shrink-0',
          'bg-primary/10'
        )}>
          <Icon className={cn('size-6', catColor)} />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{meta.name}</h1>
            <Badge variant="outline" className="text-[10px] font-mono">F{meta.number}</Badge>
            <Badge variant="secondary" className={cn('text-[10px]', catColor)}>
              {CATEGORY_LABELS[meta.category]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{meta.subtitle}</p>
        </div>
      </div>
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  )
}

/**
 * KPI card standardizzata per l'header delle pagine di fase.
 */
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
    <div className="bg-card border rounded-md p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
      <div className={cn(
        'text-2xl font-bold font-mono',
        highlight && 'text-emerald-600 dark:text-emerald-400',
        warn && 'text-amber-600 dark:text-amber-400',
        danger && 'text-red-600 dark:text-red-400',
      )}>
        {value}
      </div>
    </div>
  )
}

/**
 * Griglia di KPI card (uso tipico: 4 metriche in riga).
 */
export function PhaseKpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {children}
    </div>
  )
}
