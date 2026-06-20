'use client'

import { useDashboard } from './use-dashboard'
import { useStore } from '@/lib/store'
import { LiveFeed } from './live-feed'
import { BrandingShowcase } from './branding-showcase'
import { ArchitectureMap } from './architecture-map'
import { CategoryKpis, QuickActions } from './category-kpis'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Rocket, Activity, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { toast } from 'sonner'

export function Overview() {
  const { data, loading, refresh } = useDashboard()
  const { setActivePhase } = useStore()
  const [seeding, setSeeding] = useState(false)

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
      toast.error(`Errore: ${e.message}`)
    } finally {
      setSeeding(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
      </div>
    )
  }

  const isEmpty =
    data.phase1?.episodic === 0 &&
    data.phase2?.plans === 0 &&
    data.phase4?.verificationEvents === 0

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Panoramica del sistema · 23 fasi operative · v0.6.0
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} className="h-8">
            <RefreshCw className="size-3.5 mr-1.5" />
            Aggiorna
          </Button>
          <Button size="sm" onClick={seed} disabled={seeding} className="h-8">
            <Rocket className="size-3.5 mr-1.5" />
            {seeding ? 'Inizializzazione…' : 'Inizializza'}
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/10 p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
            <Activity className="size-4 text-amber-500" />
          </div>
          <div className="text-sm">
            <strong>Sistema non inizializzato.</strong> Clicca <em>Inizializza</em> per
            caricare dati di esempio in tutte le fasi.
          </div>
        </div>
      )}

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <QuickStat label="Fasi" value="23" sub="+3 trasv." />
        <QuickStat label="Modelli DB" value={data.scalability?.database?.totalModels || 59} sub={data.scalability?.database?.provider} />
        <QuickStat label="Eventi" value={data.agentLogsTotal} sub="audit log" />
        <QuickStat label="Test" value="146" sub="52% cov." />
        <QuickStat label="Errori" value={data.observability?.errors?.open || 0} sub="open" warn={(data.observability?.errors?.open || 0) > 0} />
        <QuickStat label="Backup" value={data.observability?.backups?.total || 0} sub={data.observability?.backups?.lastBackupAt ? 'ultimo OK' : 'nessuno'} />
      </div>

      {/* Architecture Map */}
      <ArchitectureMap />

      {/* Category KPIs */}
      <CategoryKpis data={data} />

      {/* Quick Actions */}
      <QuickActions />

      {/* Live feed + Audit log in 2-column layout */}
      <div className="grid lg:grid-cols-2 gap-4">
        <LiveFeed />
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="size-4 text-primary" /> Kernel Audit Log
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{data.agentLogsTotal} totali</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-40 overflow-y-auto pr-2 space-y-1">
              {data.recentLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-8 text-center">Nessun evento</p>
              ) : (
                data.recentLogs.map((log) => (
                  <div key={log.id} className="text-xs flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] py-0 px-1.5 font-mono shrink-0',
                        log.level === 'warn' && 'border-amber-500 text-amber-700 dark:text-amber-400',
                        log.level === 'error' && 'border-red-500 text-red-700 dark:text-red-400'
                      )}
                    >
                      P{log.phase}
                    </Badge>
                    <span className="text-muted-foreground font-mono shrink-0 text-[10px]">{log.agentId}</span>
                    <span className="font-mono truncate text-[11px]">{log.event}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Branding */}
      <BrandingShowcase />
    </div>
  )
}

function QuickStat({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3 card-hover">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn(
        'text-xl font-bold font-mono tabular-nums mt-0.5',
        warn && 'text-amber-600 dark:text-amber-400'
      )}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}
