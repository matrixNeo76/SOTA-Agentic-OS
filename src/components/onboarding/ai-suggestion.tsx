'use client'

/**
 * AI Suggestion — UX-6a
 *
 * Primitive UI ricorrente per suggerimenti/azioni AI contestuali.
 * Pattern: icona + testo + bottone di azione, con animazione entrance.
 *
 * Usage:
 * <AISuggestion
 *   icon="Sparkles"
 *   text="Risolvi questo conflitto con la strategia higher-confidence"
 *   actionLabel="Risolvi"
 *   onAction={() => resolveConflict(...)}
 * />
 */

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DynamicIcon } from '@/components/shared/dynamic-icon'
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'

export interface AISuggestionProps {
  icon?: string
  text: string
  actionLabel?: string
  onAction?: () => void | Promise<void>
  dismissible?: boolean
  variant?: 'info' | 'success' | 'warning'
}

export function AISuggestion({
  icon = 'Sparkles',
  text,
  actionLabel,
  onAction,
  dismissible = true,
  variant = 'info',
}: AISuggestionProps) {
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)

  if (dismissed) return null

  const variantClasses = {
    info: 'border-primary/20 bg-primary/5',
    success: 'border-status-ok/20 bg-status-ok/5',
    warning: 'border-status-warn/20 bg-status-warn/5',
  }

  const iconColor = {
    info: 'text-primary',
    success: 'text-status-ok',
    warning: 'text-status-warn',
  }

  const handleAction = async () => {
    if (!onAction) return
    setLoading(true)
    try {
      await onAction()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className={`${variantClasses[variant]} animate-slide-in-up`}>
      <div className="flex items-center gap-3 p-3">
        <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center shrink-0">
          <DynamicIcon name={icon} className={`w-4 h-4 ${iconColor[variant]}`} />
        </div>
        <p className="text-xs text-foreground flex-1">{text}</p>
        {actionLabel && onAction && (
          <Button size="sm" variant="outline" onClick={handleAction} disabled={loading} className="shrink-0 text-xs h-7">
            {loading ? '...' : actionLabel}
          </Button>
        )}
        {dismissible && (
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Dismiss suggestion"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </Card>
  )
}

// === AI Suggestion Group (multiple suggestions) ======================

export function AISuggestionGroup({ suggestions }: {
  suggestions: Array<AISuggestionProps>
}) {
  if (suggestions.length === 0) return null

  return (
    <div className="space-y-2">
      {suggestions.map((s, i) => (
        <AISuggestion key={i} {...s} />
      ))}
    </div>
  )
}
