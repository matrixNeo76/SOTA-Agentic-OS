'use client'

import { useEffect, useState } from 'react'
import { useStore, PHASES } from '@/lib/store'
import { LogOut, Moon, Sun, ChevronDown, Command } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/use-i18n'
import { useTheme } from 'next-themes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBar } from '@/components/workbench/status-bar'

type AuthUser = {
  userId: string
  email: string
  name: string | null
  role: string
  tenantId: string
} | null

export function Topbar() {
  const { activePhase, toggleCommandPalette } = useStore()
  const [user, setUser] = useState<AuthUser>(null)
  const router = useRouter()
  const { lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  const currentPhase = PHASES.find(p => p.id === activePhase)
  const pageTitle = activePhase === 'overview' ? 'Dashboard' : currentPhase?.name || 'Dashboard'

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.authenticated) setUser(d.user)
    })
  }, [])

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
    <header className="h-14 border-b flex items-center justify-between gap-3 px-3 sm:px-4 shrink-0">
      {/* === Left: page title (mobile-only, since desktop has tab bar) + StatusBar (desktop) === */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Mobile: page title */}
        <h2 className="text-sm font-semibold text-muted-foreground truncate md:hidden">
          {pageTitle}
        </h2>

        {/* Desktop: persistent status bar with real-time metrics */}
        <div className="hidden md:flex items-center min-w-0 flex-1">
          <StatusBar />
        </div>
      </div>

      {/* === Right: Cmd+K trigger + theme + lang + user === */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Command palette trigger — visible on all screens */}
        <button
          onClick={toggleCommandPalette}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2 rounded-lg',
            'hover:bg-accent transition-colors text-muted-foreground'
          )}
          title="Apri command palette (Cmd+K)"
          aria-label="Apri command palette"
        >
          <Command className="size-3.5" />
          <kbd className="hidden sm:inline text-[10px] font-mono">K</kbd>
        </button>

        {mounted && (
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground"
            aria-label="Cambia tema"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        )}

        <button
          onClick={() => setLang(lang === 'it' ? 'en' : 'it')}
          className="h-8 px-2 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-xs font-medium text-muted-foreground"
          aria-label="Cambia lingua"
        >
          {lang.toUpperCase()}
        </button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 h-8 pl-2 pr-1.5 rounded-lg hover:bg-accent transition-colors">
                <img src="/avatar.png" alt="" className="size-6 rounded-full object-cover" />
                <span className="text-xs font-medium hidden sm:inline">{user.name || user.email.split('@')[0]}</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <div className="text-sm font-medium">{user.name || user.email}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
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
    </header>
  )
}
