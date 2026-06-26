'use client'

/**
 * Overview (Dashboard) — C6.3 redesign
 *
 * Layout:
 *   1. Header with refresh + seed (when empty)
 *   2. Alert banner (blocked actions, approval gates, LTL violations, errors, budget)
 *   3. KPI row (6 cards: plans, cost, errors, blocked, LLM calls, agents)
 *   4. Charts row (cost trend, token usage, LLM calls, errors — from timeseries API)
 *   5. Bottom row: Recent Activity timeline + System Health card
 *   6. Architecture map (navigation, kept from before)
 *   7. Live feed (real-time WS events, with fallback to recent activity when offline)
 *
 * All sections degrade gracefully:
 *   - Charts show skeleton while loading
 *   - Alert banner shows "All systems nominal" when no alerts
 *   - Recent Activity shows "No recent activity" when empty
 *   - System Health shows "—" when data missing
 */

import { useDashboard } from './use-dashboard'
import { LiveFeed } from './live-feed'
import { ArchitectureMap } from './architecture-map'
import { KpiRow, AlertBanner, RecentActivity, SystemHealth } from './dashboard-widgets'
import { DashboardCharts } from './dashboard-charts'
import { Button } from '@/components/ui/button'
import { RefreshCw, Rocket } from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { registerToastHandlers } from '@/lib/stores/data-store'

export function Overview() {
  const { data, loading, refresh } = useDashboard()
  const [seeding, setSeeding] = useState(false)

  // Register toast handlers so the data-store can show error toasts
  useEffect(() => {
    registerToastHandlers({ toast })
  }, [])

  const seed = async () => {
    setSeeding(true)
    try {
      const r = await fetch('/api/seed', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        toast.success('Sistema inizializzato')
        refresh()
      } else {
        toast.error(`Errore: ${d.error}`)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSeeding(false)
    }
  }

  // === Loading state — skeleton that matches the final layout ===
  if (loading || !data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" aria-busy="true">
        <div className="h-6 w-32 bg-muted animate-pulse rounded" />
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[260px] bg-muted animate-pulse rounded-lg" />
          <div className="h-[260px] bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    )
  }

  // === Empty state — system not initialised, offer seed ===
  // C6.3 — broader isEmpty check: uses 6 indicators instead of 3
  const isEmpty =
    (data.phase1?.episodic ?? 0) === 0 &&
    (data.phase2?.plans ?? 0) === 0 &&
    (data.phase4?.verificationEvents ?? 0) === 0 &&
    (data.phase5?.heuristics ?? 0) === 0 &&
    (data.tools?.total ?? 0) === 0 &&
    (data.agentLogsTotal ?? 0) === 0

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {isEmpty
            ? 'Sistema non inizializzato'
            : `${data.agentLogsTotal.toLocaleString()} eventi registrati`}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} className="h-8 text-xs">
            <RefreshCw className="size-3.5 mr-1.5" />
            Aggiorna
          </Button>
          {isEmpty && (
            <Button size="sm" onClick={seed} disabled={seeding} className="h-8 text-xs">
              <Rocket className="size-3.5 mr-1.5" />
              {seeding ? 'Inizializzazione…' : 'Inizializza'}
            </Button>
          )}
        </div>
      </div>

      {/* Alert banner */}
      <AlertBanner />

      {/* KPI row */}
      <KpiRow />

      {/* Charts row */}
      <DashboardCharts range="24h" />

      {/* Bottom row: recent activity + system health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RecentActivity />
        <SystemHealth />
      </div>

      {/* Architecture map — navigation */}
      <div>
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Architecture
        </h2>
        <ArchitectureMap />
      </div>

      {/* Live feed — real-time events (kept for users with WS enabled) */}
      <div>
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          Live Feed
        </h2>
        <LiveFeed />
      </div>
    </div>
  )
}
