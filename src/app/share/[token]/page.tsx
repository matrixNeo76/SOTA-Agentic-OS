'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  ArrowUp, CheckCircle2, XCircle, AlertTriangle,
  Sparkles, Brain, Shield, Zap, Clock, Compass,
  ChevronDown, ChevronRight, Loader2, Link2, Eye,
} from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  result?: any
  isPlanOnly?: boolean
  error?: string
  errors?: any[]
}

type SharedData = {
  ok: boolean
  title: string
  messages: Message[]
  expiresAt: string | null
  viewCount: number
  createdAt: string
}

const STEP_ICONS: Record<string, { icon: any; color: string }> = {
  pending: { icon: Clock, color: 'text-muted-foreground' },
  running: { icon: Loader2, color: 'text-sky-500' },
  done: { icon: CheckCircle2, color: 'text-emerald-500' },
  failed: { icon: XCircle, color: 'text-red-500' },
  blocked: { icon: AlertTriangle, color: 'text-amber-500' },
}

export default function SharedConversationPage() {
  const params = useParams()
  const token = params.token as string
  const [data, setData] = useState<SharedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/conversation/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'view', token }),
        })
        const d = await r.json()
        if (cancelled) return
        if (d.error) {
          setError(d.error)
        } else {
          setData(d)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md space-y-3">
          <div className="size-12 mx-auto rounded-xl bg-red-500/10 flex items-center justify-center">
            <XCircle className="size-6 text-red-500" />
          </div>
          <h1 className="text-lg font-semibold">Link non valido</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src="/logo-transparent.png" alt="SOTA" className="size-7 rounded-lg object-contain" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{data.title}</h1>
            <p className="text-[10px] text-muted-foreground">
              Conversazione condivisa · {data.viewCount} visualizzazioni
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            <Link2 className="size-2.5 mr-1" />
            Shared
          </Badge>
        </div>
      </header>

      {/* Messages */}
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {data.messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30 mt-12">
        <div className="max-w-3xl mx-auto px-4 py-3 text-center text-[10px] text-muted-foreground">
          <p>SOTA Agentic OS · Conversazione condivisa</p>
          {data.expiresAt && (
            <p className="mt-1">Scade il {new Date(data.expiresAt).toLocaleString('it-IT')}</p>
          )}
          <p className="mt-1">Creata il {new Date(data.createdAt).toLocaleString('it-IT')}</p>
        </div>
      </footer>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3">
      <img src="/avatar.png" alt="" className="size-8 rounded-full object-cover shrink-0 border border-border" />
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Agente</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(msg.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className={cn('text-sm break-words', msg.error ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
          {msg.content}
        </p>
        {msg.result && (
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 text-xs font-medium">
              {msg.result.goal || 'Risultato task'}
            </div>
            {msg.result.steps && (
              <div className="p-3 space-y-1">
                {msg.result.steps.map((step: any) => {
                  const config = STEP_ICONS[step.status] || STEP_ICONS.pending
                  const Icon = config.icon
                  return (
                    <div key={step.taskId} className="flex items-center gap-2 py-1">
                      <Icon className={cn('size-3.5 shrink-0', config.color, step.status === 'running' && 'animate-spin')} />
                      <span className="text-xs font-mono text-muted-foreground shrink-0 w-6">{step.taskId}</span>
                      <span className="text-xs truncate flex-1 min-w-0">{step.description}</span>
                      {step.durationMs != null && (
                        <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                          {(step.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
