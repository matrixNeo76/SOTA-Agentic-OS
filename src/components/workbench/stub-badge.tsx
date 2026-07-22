'use client'

import { cn } from '@/lib/utils'
import { AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

/**
 * StubBadge — Visual indicator for modules that use stub/partial implementations
 * instead of real LLM intelligence.
 *
 * Status types:
 * - 'stub': completely deterministic, should use LLM (red)
 * - 'partial': real but with limitations (amber)
 *
 * Click to toggle details tooltip.
 */
export function StubBadge({
  status,
  label,
  detail,
  className,
}: {
  status: 'stub' | 'partial'
  label: string
  detail?: string
  className?: string
}) {
  const [showDetail, setShowDetail] = useState(false)

  const styles = {
    stub: {
      bg: 'bg-red-500/10 border-red-500/30',
      text: 'text-red-600 dark:text-red-400',
      icon: AlertTriangle,
      tag: 'STUB',
    },
    partial: {
      bg: 'bg-amber-500/10 border-amber-500/30',
      text: 'text-amber-600 dark:text-amber-400',
      icon: AlertTriangle,
      tag: 'PARTIAL',
    },
  }[status]

  const Icon = styles.icon

  return (
    <div className={cn('relative inline-flex', className)}>
      <button
        onClick={() => setShowDetail(!showDetail)}
        className={cn(
          'inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[9px] font-bold uppercase tracking-wide transition-all active:scale-95',
          styles.bg,
          styles.text
        )}
        title={detail || label}
      >
        <Icon className="size-2.5" />
        <span>{styles.tag}</span>
        <span className="hidden sm:inline opacity-70">· {label}</span>
        {detail && (showDetail ? <EyeOff className="size-2.5" /> : <Eye className="size-2.5" />)}
      </button>
      {showDetail && detail && (
        <div className="absolute top-full left-0 mt-1 w-64 p-2.5 rounded-md border bg-popover shadow-lg z-50 text-left">
          <div className={cn('text-[10px] font-bold uppercase mb-1', styles.text)}>
            {styles.tag}: {label}
          </div>
          <p className="text-[11px] text-muted-foreground break-words">{detail}</p>
          <p className="text-[10px] text-muted-foreground italic mt-1.5">
            Track 1 (Settimana 16) sostituirà questo stub con LLM reale.
          </p>
        </div>
      )}
    </div>
  )
}
