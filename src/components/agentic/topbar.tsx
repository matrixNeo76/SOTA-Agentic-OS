'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { useSensoriumLive } from './use-sensorium-live'
import { Activity, Cpu, Database, Gauge, Radio, LogOut, User, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { ROLE_LABELS, type Role } from '@/lib/auth/rbac'
import { useI18n } from '@/lib/use-i18n'
import { Button } from '@/components/ui/button'

type AuthUser = {
  userId: string
  email: string
  name: string | null
  role: Role
  tenantId: string
} | null

const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-red-500',
  operator: 'bg-emerald-500',
  sovereign: 'bg-violet-500',
  viewer: 'bg-sky-500',
}

export function Topbar() {
  const { cycleId, systemLoad, queueDepth, activeThreads, setRuntime } = useStore()
  const { connected, sensorium } = useSensoriumLive()
  const [booted, setBooted] = useState(false)
  const [user, setUser] = useState<AuthUser>(null)
  const router = useRouter()
  const { lang, setLang } = useI18n()

  useEffect(() => {
    fetch('/api/sensorium')
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) {
          setRuntime({
            cycleId: d.data.cycleId,
            systemLoad: d.data.systemLoad,
            queueDepth: d.data.queueDepth,
            activeThreads: d.data.activeThreads,
          })
          setBooted(true)
        }
      })
      .catch(() => {})
    // Check auth
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.authenticated) setUser(d.user)
    })
  }, [setRuntime])

  useEffect(() => {
    if (sensorium) {
      setRuntime({
        cycleId: sensorium.cycleId,
        systemLoad: sensorium.systemLoad,
        queueDepth: sensorium.queueDepth,
        activeThreads: sensorium.activeThreads,
      })
    }
  }, [sensorium, setRuntime])

  const logout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    })
    setUser(null)
    router.push('/login')
  }

  return (
    <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-30">
      <div className="flex items-center gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-emerald-500" />
          <span className="text-sm font-medium hidden sm:inline">Ciclo</span>
          <span className="text-sm font-mono text-muted-foreground">#{cycleId}</span>
        </div>
        <div className="flex-1" />
        <Metric icon={Gauge} label="Load" value={`${(systemLoad * 100).toFixed(0)}%`} color={systemLoad > 0.7 ? 'text-amber-500' : 'text-emerald-500'} />
        <Metric icon={Database} label="Queue" value={String(queueDepth)} />
        <Metric icon={Cpu} label="Threads" value={String(activeThreads)} />
        <div className="flex items-center gap-1.5" title={connected ? 'WebSocket connesso' : 'WebSocket disconnesso'}>
          <Radio className={cn('size-3.5', connected ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground')} />
          <span className={cn('text-xs font-mono hidden sm:inline', connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {connected ? 'LIVE' : 'OFF'}
          </span>
        </div>
        <div className={`size-2 rounded-full ${booted ? 'bg-emerald-500 animate-pulse' : 'bg-muted'}`} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setLang(lang === 'it' ? 'en' : 'it')}
          title="Switch language"
        >
          <Globe className="size-3" />
          {lang.toUpperCase()}
        </Button>
        {user && (
          <div className="flex items-center gap-2 pl-3 border-l">
            <div className="flex items-center gap-1.5">
              <User className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium hidden sm:inline">{user.name || user.email}</span>
            </div>
            <Badge variant="secondary" className={cn('text-[10px] gap-1', ROLE_COLORS[user.role])}>
              {ROLE_LABELS[user.role]}
            </Badge>
            <button onClick={logout} title="Logout" className="text-muted-foreground hover:text-red-500 transition-colors">
              <LogOut className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

function Metric({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className={`size-3.5 ${color || 'text-muted-foreground'}`} />
      <span className="text-muted-foreground hidden md:inline">{label}</span>
      <span className={`font-mono font-medium ${color || ''}`}>{value}</span>
    </div>
  )
}
