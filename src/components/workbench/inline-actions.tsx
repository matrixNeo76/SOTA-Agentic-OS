'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Copy, Check, RotateCcw, Pencil,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * Inline actions toolbar shown on hover over each message bubble.
 *
 * Actions:
 * - Copy: copies the message text to clipboard
 * - Retry: re-submits the most recent user message (only shown on user messages)
 * - Edit: loads the message text into the input box and truncates history after it (only user messages)
 *
 * Branch and Share are deferred to Release 1.1 per architecture decision.
 */
export function InlineActions({
  content,
  isUser,
  onRetry,
  onEdit,
  className,
}: {
  content: string
  isUser: boolean
  onRetry?: () => void
  onEdit?: () => void
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast.success('Testo copiato')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback for non-secure contexts (Preview Panel without HTTPS)
      try {
        const ta = document.createElement('textarea')
        ta.value = content
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        toast.success('Testo copiato')
        setTimeout(() => setCopied(false), 1500)
      } catch {
        toast.error('Impossibile copiare')
      }
    }
  }

  return (
    <div
      className={cn(
        'absolute opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
        'flex items-center gap-0.5 z-10',
        isUser
          ? 'left-2 -bottom-7'  // below-left of user bubble (right-aligned)
          : 'right-0 -bottom-7', // below-right of assistant bubble (left-aligned)
        className
      )}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="Copia testo"
        aria-label="Copia testo"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>

      {isUser && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Riprova"
          aria-label="Riproda invio"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}

      {isUser && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="size-7 inline-flex items-center justify-center rounded-md bg-background border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Modifica e reinvia"
          aria-label="Modifica messaggio"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  )
}
