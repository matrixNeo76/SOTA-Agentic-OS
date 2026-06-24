'use client'
import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { MessageBubble } from './message-bubble'
import { ConsoleWelcome } from './console-welcome'
import type { Message } from './types'

export function MessageList({ messages, liveLog, executing, onSuggestion, onRetry, onEdit }: { messages: Message[]; liveLog: string[]; executing: boolean; onSuggestion: (s: string) => void; onRetry?: (msg: Message, idx: number) => void; onEdit?: (msg: Message, idx: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [messages, liveLog, executing])
  if (messages.length === 0) return <div ref={ref} className="flex-1 overflow-y-auto overscroll-contain min-h-0"><ConsoleWelcome onSuggestion={onSuggestion} /></div>
  return (
    <div ref={ref} className="flex-1 overflow-y-auto overscroll-contain min-h-0">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-12 space-y-6 sm:space-y-8">
        {messages.map((msg, idx) => { const r = msg.role === 'user' && onRetry ? () => onRetry(msg, idx) : undefined; const e = msg.role === 'user' && onEdit ? () => onEdit(msg, idx) : undefined; return <MessageBubble key={msg.id} msg={msg} allMessages={messages} onRetry={r} onEdit={e} /> })}
        {executing && (<div className="flex items-start gap-3">
          <div className="relative shrink-0"><div className="size-8 rounded-full bg-gradient-to-br from-primary to-primary-active flex items-center justify-center ring-2 ring-border"><span className="text-xs font-bold text-primary-foreground">S</span></div><div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-background border-2 border-background flex items-center justify-center"><Loader2 className="size-2 animate-spin text-primary" /></div></div>
          <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1"><span className="text-sm font-semibold">SOTA</span><span className="text-[10px] text-muted-foreground">esecuzione…</span></div>{liveLog.length > 0 && <div className="rounded-md bg-surface-code text-surface-code-foreground p-2.5 font-mono text-[10px] space-y-0.5 max-h-32 overflow-y-auto">{liveLog.map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}</div>}</div>
        </div>)}
      </div>
    </div>
  )
}
