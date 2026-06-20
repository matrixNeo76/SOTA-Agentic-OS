'use client'

import { useDashboard } from './use-dashboard'
import { useStore } from '@/lib/store'
import { LiveFeed } from './live-feed'
import { BrandingShowcase } from './branding-showcase'
import { ArchitectureMap } from './architecture-map'
import { CategoryKpis, QuickActions } from './category-kpis'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Rocket, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { toast } from 'sonner'

export function Overview() {
  const { data, loading, refresh } = useDashboard()
  const [seeding, setSeeding] = useState(false)

  const seed = async () => {
    setSeeding(true)
    try {
      const r = await fetch('/api/seed', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        toast.success('Sistema inizializzato con dati di esempio')
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
      <div className="p-8 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="h-96 bg-muted animate-pulse rounded-lg" />
      </div>
    )
  }

  const isEmpty =
    data.phase1?.episodic === 0 &&
    data.phase2?.plans === 0 &&
    data.phase4?.verificationEvents === 0

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SOTA Agentic OS</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Sistema Operativo Agentico · 14 micro-fasi · kernel transazionale + LTL + ERL + Dominators + Lean4 + Retainer + Grounded + Affect + Objective + ESR + TimeRouter
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5 mr-1.5" />
            Aggiorna
          </Button>
          <Button size="sm" onClick={seed} disabled={seeding}>
            <Rocket className="size-3.5 mr-1.5" />
            {seeding ? 'Inizializzazione…' : 'Inizializza Sistema'}
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <Card className="border-dashed border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <Activity className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong>Sistema non inizializzato.</strong> Clicca <em>Inizializza Sistema</em> per
              caricare dati di esempio in tutte le 14 fasi (memoria, regole LTL, assiomi, template, euristiche).
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1. Architecture Map */}
      <ArchitectureMap />

      {/* 2. Category KPIs */}
      <CategoryKpis data={data} />

      {/* 3. Quick Actions */}
      <QuickActions />

      {/* 4. LiveFeed (eventi WS) */}
      <LiveFeed />

      {/* 5. Kernel Audit Log (compact) */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="size-4" /> Kernel Audit Log
            </CardTitle>
            <Badge variant="outline" className="text-xs">{data.agentLogsTotal} totali</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-32 overflow-y-auto pr-2">
            {data.recentLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nessun evento registrato.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.recentLogs.map((log) => (
                  <li key={log.id} className="text-xs flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] py-0 px-1.5 font-mono shrink-0',
                        log.level === 'warn' && 'border-amber-500 text-amber-700 dark:text-amber-400',
                        log.level === 'error' && 'border-red-500 text-red-700 dark:text-red-400'
                      )}
                    >
                      P{log.phase}
                    </Badge>
                    <span className="text-muted-foreground font-mono shrink-0">{log.agentId}</span>
                    <span className="font-mono truncate">{log.event}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 6. Branding Kit */}
      <BrandingShowcase />
    </div>
  )
}
