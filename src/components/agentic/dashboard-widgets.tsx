'use client'

/**
 * Dashboard Widgets — C6.3
 *
 * KPI cards, alert banner, recent activity timeline, and system health card.
 * All data comes from the existing /api/dashboard response via useDashboard().
 * No new API calls — we use what's already being polled.
 */

import { useDashboard } from './use-dashboard'
import { useDataStore } from '@/lib/stores/data-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity, DollarSign, AlertTriangle, ShieldAlert, CheckCircle2,
  XCircle, Clock, Database, HardDrive, Cpu, Zap, TrendingUp, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import type { LucideIcon } from 'lucide-react'

// === KPI Card ========================================================

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  sublabel?: string
  tone?: 'ok' | 'warn' | 'danger' | 'muted'
  onClick?: () => void
}

function KpiCard({ icon: Icon, label, value, sublabel, tone = 'muted', onClick }: KpiCardProps) {
  const toneClass = {
    ok: 'text-status-ok',
    warn: 'text-status-warn',
    danger: 'text-status-danger',
    muted: 'text-foreground',
  }[tone]
  return (
    <Card
      className={cn('transition-all', onClick && 'cursor-pointer hover:ring-1 hover:ring-primary/20')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={`${label}: ${value}`}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] sm:text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className={cn('text-xl sm:text-2xl font-bold tabular-nums mt-1', toneClass)}>
              {value}
            </div>
            {sublabel && (
              <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">
                {sublabel}
              </div>
            )}
          </div>
          <Icon className={cn('size-4 sm:size-5 shrink-0', toneClass)} aria-hidden />
        </div>
      </CardContent>
    </Card>
  )
}

// === KPI Row =========================================================

export function KpiRow() {
  const { data } = useDashboard()
  const { setActiveView, setActivePhase } = useStore()

  if (!data) return null

  const runningPlans = data.phase2?.plans ?? 0
  const totalTasks = data.phase2?.planTasks ?? 0
  const costToday = data.cost?.today ?? 0
  const errors24h = data.observability?.errors?.recent24h ?? 0
  const blockedPending = data.blocked?.pending ?? 0
  const llmCalls = data.cost?.totalCalls ?? 0
  const openErrors = data.observability?.errors?.open ?? 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
      <KpiCard
        icon={Activity}
        label="Plans"
        value={runningPlans}
        sublabel={runningPlans > 0 ? `${totalTasks} tasks total` : 'no active plans'}
        tone={runningPlans > 0 ? 'warn' : 'muted'}
        onClick={() => setActiveView('phase')}
      />
      <KpiCard
        icon={DollarSign}
        label="Cost Today"
        value={costToday === 0 ? '$0' : costToday < 0.01 ? `$${costToday.toFixed(4)}` : `$${costToday.toFixed(2)}`}
        sublabel={`week: $${(data.cost?.week ?? 0).toFixed(2)}`}
        tone={costToday >= 10 ? 'danger' : costToday >= 1 ? 'warn' : 'ok'}
        onClick={() => setActiveView('phase')}
      />
      <KpiCard
        icon={AlertTriangle}
        label="Errors 24h"
        value={errors24h}
        sublabel={openErrors > 0 ? `${openErrors} still open` : 'all resolved'}
        tone={errors24h > 0 ? 'danger' : 'ok'}
      />
      <KpiCard
        icon={ShieldAlert}
        label="Blocked"
        value={blockedPending}
        sublabel={blockedPending > 0 ? 'awaiting HITL' : 'no blocks'}
        tone={blockedPending > 0 ? 'warn' : 'muted'}
        onClick={() => setActivePhase('governance' as any)}
      />
      <KpiCard
        icon={Zap}
        label="LLM Calls"
        value={llmCalls.toLocaleString()}
        sublabel={`tokens: ${((data.cost?.totalTokensIn ?? 0) + (data.cost?.totalTokensOut ?? 0)).toLocaleString()}`}
        tone="muted"
      />
      <KpiCard
        icon={Users}
        label="Agents"
        value={data.phase11?.agents ?? 0}
        sublabel={`logs: ${data.agentLogsTotal.toLocaleString()}`}
        tone="muted"
        onClick={() => setActivePhase('agents' as any)}
      />
    </div>
  )
}

// === Alert Banner ====================================================

interface Alert {
  level: 'danger' | 'warn' | 'info'
  icon: LucideIcon
  message: string
  action?: { label: string; onClick: () => void }
}

export function AlertBanner() {
  const { data } = useDashboard()
  const { blockedPending } = useDataStore()
  const { setActivePhase, setActiveView } = useStore()

  if (!data) return null

  const alerts: Alert[] = []

  const pendingBlocked = blockedPending?.length ?? data.blocked?.pending ?? 0
  if (pendingBlocked > 0) {
    alerts.push({
      level: 'warn',
      icon: ShieldAlert,
      message: `${pendingBlocked} blocked action${pendingBlocked === 1 ? '' : 's'} awaiting HITL resolution`,
      action: { label: 'Review', onClick: () => setActivePhase('governance' as any) },
    })
  }

  const pendingGates = data.phase9?.pendingGates ?? 0
  if (pendingGates > 0) {
    alerts.push({
      level: 'warn',
      icon: ShieldAlert,
      message: `${pendingGates} approval gate${pendingGates === 1 ? '' : 's'} pending decision`,
      action: { label: 'Review', onClick: () => setActivePhase('governance' as any) },
    })
  }

  const ltlViolations = data.phase4?.verifRejects ?? 0
  if (ltlViolations > 0) {
    alerts.push({
      level: 'danger',
      icon: AlertTriangle,
      message: `${ltlViolations} LTL violation${ltlViolations === 1 ? '' : 's'} detected`,
      action: { label: 'Review', onClick: () => setActivePhase('governance' as any) },
    })
  }

  const redLineFlags = data.phase5?.redLineFlags ?? 0
  if (redLineFlags > 0) {
    alerts.push({
      level: 'danger',
      icon: AlertTriangle,
      message: `${redLineFlags} red line flag${redLineFlags === 1 ? '' : 's'} raised by ERL`,
      action: { label: 'Review', onClick: () => setActivePhase('governance' as any) },
    })
  }

  const openErrors = data.observability?.errors?.open ?? 0
  if (openErrors > 0) {
    alerts.push({
      level: 'danger',
      icon: XCircle,
      message: `${openErrors} open error${openErrors === 1 ? '' : 's'} require attention`,
    })
  }

  const costToday = data.cost?.today ?? 0
  const budget = data.cost?.budget
  if (budget && costToday >= budget.danger) {
    alerts.push({
      level: 'danger',
      icon: DollarSign,
      message: `Budget danger: $${costToday.toFixed(4)} / $${budget.danger} today`,
    })
  } else if (budget && costToday >= budget.warn) {
    alerts.push({
      level: 'warn',
      icon: DollarSign,
      message: `Budget warning: $${costToday.toFixed(4)} / $${budget.warn} today`,
    })
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-status-ok/10 border border-status-ok/20 text-xs">
        <CheckCircle2 className="size-3.5 text-status-ok" />
        <span className="text-status-ok font-medium">All systems nominal</span>
        <span className="text-muted-foreground">· no alerts</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5" role="alert" aria-live="polite">
      {alerts.map((alert, i) => {
        const alertClass = {
          danger: 'bg-status-danger/10 border-status-danger/20 text-status-danger',
          warn: 'bg-status-warn/10 border-status-warn/20 text-status-warn',
          info: 'bg-primary/10 border-primary/20 text-primary',
        }[alert.level]
        return (
          <div
            key={i}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-md border text-xs', alertClass)}
          >
            <alert.icon className="size-3.5 shrink-0" aria-hidden />
            <span className="font-medium flex-1 truncate">{alert.message}</span>
            {alert.action && (
              <Button
                size="sm"
                variant="ghost"
                onClick={alert.action.onClick}
                className="h-6 px-2 text-xs shrink-0"
              >
                {alert.action.label}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// === Recent Activity Timeline ========================================

export function RecentActivity() {
  const { data } = useDashboard()

  if (!data?.recentLogs || data.recentLogs.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4">
            No recent activity
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="size-3.5" aria-hidden />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5 max-h-72 overflow-y-auto" role="log" aria-live="polite">
          {data.recentLogs.slice(0, 15).map((log) => {
            const tone = log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warn' : 'muted'
            const dotClass = {
              danger: 'bg-status-danger',
              warn: 'bg-status-warn',
              muted: 'bg-muted-foreground/40',
            }[tone]
            return (
              <li key={log.id} className="flex items-start gap-2 text-xs py-1">
                <span className={cn('size-1.5 rounded-full shrink-0 mt-1.5', dotClass)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[10px] text-muted-foreground shrink-0">
                      {log.phase}
                    </code>
                    <span className="font-medium truncate">{log.event}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    <code className="font-mono truncate">{log.agentId}</code>
                    <span className="shrink-0 ml-auto">
                      {new Date(log.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

// === System Health Card =============================================

export function SystemHealth() {
  const { data } = useDashboard()

  if (!data) return null

  const db = data.scalability?.database
  const errors = data.observability?.errors
  const traces = data.observability?.traces
  const backups = data.observability?.backups

  const healthItems = [
    {
      icon: Database,
      label: 'Database',
      value: db?.provider ?? 'unknown',
      detail: db ? `${db.totalModels} models` : '',
      tone: db?.provider === 'sqlite' ? 'warn' : 'ok',
    },
    {
      icon: HardDrive,
      label: 'Backups',
      value: backups?.total ?? 0,
      detail: backups?.lastBackupAt
        ? `last: ${new Date(backups.lastBackupAt).toLocaleDateString()}`
        : 'no backups',
      tone: (backups?.total ?? 0) === 0 ? 'danger' : 'ok',
    },
    {
      icon: AlertTriangle,
      label: 'Errors',
      value: errors?.total ?? 0,
      detail: errors ? `${errors.open} open · ${errors.recent24h} last 24h` : '',
      tone: (errors?.open ?? 0) > 0 ? 'warn' : 'ok',
    },
    {
      icon: Cpu,
      label: 'Traces',
      value: traces?.totalTraces ?? 0,
      detail: traces ? `${traces.errorSpans} error spans` : '',
      tone: (traces?.errorSpans ?? 0) > 0 ? 'warn' : 'ok',
    },
    {
      icon: TrendingUp,
      label: 'Tools',
      value: data.tools?.total ?? 0,
      detail: data.tools ? `${data.tools.active} active · ${data.tools.grantedPerms} perms` : '',
      tone: 'muted',
    },
    {
      icon: Activity,
      label: 'Memory',
      value: data.memoryStats ? (data.memoryStats.episodic + data.memoryStats.semantic + data.memoryStats.logical) : 0,
      detail: data.memoryStats ? `avg decay: ${(data.memoryStats.avgDecay ?? 0).toFixed(2)}` : '',
      tone: 'muted',
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle2 className="size-3.5" aria-hidden />
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {healthItems.map((item) => {
            const toneClass = {
              ok: 'text-status-ok',
              warn: 'text-status-warn',
              danger: 'text-status-danger',
              muted: 'text-foreground',
            }[item.tone]
            return (
              <div key={item.label} className="border rounded p-2">
                <div className="flex items-center gap-1.5">
                  <item.icon className={cn('size-3 shrink-0', toneClass)} aria-hidden />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <div className={cn('text-sm font-bold tabular-nums mt-0.5', toneClass)}>
                  {item.value}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {item.detail}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
