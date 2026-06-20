'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { useSensoriumLive } from './use-sensorium-live'
import { Activity, Cpu, Database, Radio, LogOut, User, Globe, Moon, Sun, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { ROLE_LABELS, type Role } from '@/lib/auth/rbac'
import { useI18n } from '@/lib/use-i18n'
import { useTheme } from 'next-themes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type AuthUser = {
  userId: string
  email: string
  name: string | null
  role: Role
  tenantId: string
} | null

const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-red-500/90',
  operator: 'bg-emerald-500/90',
  sovereign: 'bg-violet-500/90',
  viewer: 'bg-sky-500/90',
}

export function Topbar() {
  const { cycleId, systemLoad, queueDepth, activeThreads, setRuntime } = useStore()
  const { connected, sensorium } = useSensoriumLive()
  const [booted, setBooted] = useState(false)
  const [user, setUser] = useState<AuthUser>(null)
  const router = useRouter()
  const { lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
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
    <header className="border-b bg-background/95 backdrop-blur-xl sticky top-0 z-30">
      <div className="flex items-center h-12 px-3 gap-3">
        {/* System metrics */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <Activity className="size-3.5 text-emerald-500" />
            <span className="text-muted-foreground hidden sm:inline">Ciclo</span>
            <span className="font-mono font-medium tabular-nums">#{cycleId}</span>
          </div>
          <div className="hidden md:flex items-center gap-3 pl-3 border-l">
            <Metric icon={Database} label="Q" value={String(queueDepth)} />
            <Metric icon={Cpu} label="T" value={String(activeThreads)} />
            <Metric icon={Activity} label="L" value={`${(systemLoad * 100).toFixed(0)}%`} color={systemLoad > 0.7 ? 'text-amber-500' : 'text-emerald-500'} />
          </div>
        </div>

        <div className="flex-1" />

        {/* Right cluster */}
        <div className="flex items-center gap-2">
          {/* WS status */}
          <div className="hidden sm:flex items-center gap-1.5" title={connected ? 'WebSocket connesso' : 'WebSocket disconnesso'}>
            <Radio className={cn('size-3.5', connected ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground')} />
            <span className={cn('text-[10px] font-mono font-medium', connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
              {connected ? 'LIVE' : 'OFF'}
            </span>
          </div>

          {/* Status dot */}
          <div className={`size-2 rounded-full ${booted ? 'bg-emerald-500 animate-pulse' : 'bg-muted'}`} />

          {/* Language switcher */}
          <button
            onClick={() => setLang(lang === 'it' ? 'en' : 'it')}
            className="flex items-center gap-1 px-2 h-7 rounded-md text-[10px] font-medium hover:bg-accent transition-colors"
            title="Switch language"
          >
            <Globe className="size-3" />
            {lang.toUpperCase()}
          </button>

          {/* Dark mode toggle */}
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex items-center justify-center size-7 rounded-md hover:bg-accent transition-colors"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          )}

          {/* User menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 pl-2 pr-1.5 h-8 rounded-md hover:bg-accent transition-colors">
                  <div className="flex items-center gap-1.5">
                    <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="size-3.5 text-primary" />
                    </div>
                    <span className="text-xs font-medium hidden sm:inline">{user.name || user.email.split('@')[0]}</span>
                  </div>
                  <Badge className={cn('text-[9px] px-1.5 py-0 font-medium', ROLE_COLORS[user.role])}>
                    {ROLE_LABELS[user.role]}
                  </Badge>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <div className="text-sm font-medium">{user.name || user.email}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">Tenant: {user.tenantId}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-red-600 dark:text-red-400 cursor-pointer">
                  <LogOut className="size-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
}

function Metric({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <Icon className={`size-3 ${color || 'text-muted-foreground'}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium tabular-nums ${color || ''}`}>{value}</span>
    </div>
  )
}
