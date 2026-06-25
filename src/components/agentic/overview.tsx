'use client'

import { useDashboard } from './use-dashboard'
import { LiveFeed } from './live-feed'
import { ArchitectureMap } from './architecture-map'
import { Button } from '@/components/ui/button'
import { RefreshCw, Rocket } from 'lucide-react'
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
 if (d.ok) { toast.success('Sistema inizializzato'); refresh() }
 else toast.error(`Errore: ${d.error}`)
 } catch (e: any) { toast.error(e.message) }
 finally { setSeeding(false) }
 }

 if (loading || !data) {
 return (
 <div className="p-8 space-y-6">
 <div className="h-6 w-32 bg-muted animate-pulse rounded" />
 <div className="h-48 bg-muted animate-pulse rounded-lg" />
 </div>
 )
 }

 const isEmpty =
 data.phase1?.episodic === 0 &&
 data.phase2?.plans === 0 &&
 data.phase4?.verificationEvents === 0

 return (
 <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 max-w-7xl mx-auto">
 {/* Minimal header */}
 <div className="flex items-center justify-between">
 <p className="text-sm text-muted-foreground">
 {isEmpty ? 'Sistema non inizializzato' : `${data.agentLogsTotal} eventi registrati`}
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

 {/* Architecture map — primary navigation */}
 <ArchitectureMap />

 {/* Live feed — real-time events */}
 <LiveFeed />
 </div>
 )
}
