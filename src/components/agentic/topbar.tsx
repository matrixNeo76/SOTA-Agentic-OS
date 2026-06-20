'use client'

import { useEffect, useState } from 'react'
import { useStore, PHASES } from '@/lib/store'
import { LogOut, Moon, Sun, ChevronDown } from 'lucide-react'
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

type AuthUser = {
  userId: string
  email: string
  name: string | null
  role: string
  tenantId: string
} | null

export function Topbar() {
  const { activePhase } = useStore()
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
    <header className="h-14 border-b flex items-center justify-between px-4 shrink-0">
      {/* Page title as breadcrumb */}
      <h2 className="text-sm font-semibold text-muted-foreground truncate">{pageTitle}</h2>

      {/* Right: only essential controls */}
      <div className="flex items-center gap-1">
        {mounted && (
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        )}

        <button
          onClick={() => setLang(lang === 'it' ? 'en' : 'it')}
          className="h-8 px-2 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-xs font-medium text-muted-foreground"
        >
          {lang.toUpperCase()}
        </button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 h-8 pl-2 pr-1.5 rounded-lg hover:bg-accent transition-colors">
                <span className="text-xs font-medium">{user.name || user.email.split('@')[0]}</span>
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
