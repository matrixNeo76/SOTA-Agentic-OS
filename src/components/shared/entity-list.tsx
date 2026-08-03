/**
 * EntityList — Sprint 5.1
 *
 * Lista generica con search, empty state, render function.
 * Sostituisce le ~14 liste custom nei PhaseN.tsx.
 */

'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { EmptyState } from './empty-state'
import { Inbox } from 'lucide-react'

export function EntityList<T>({
  items,
  renderItem,
  searchKeys,
  searchPlaceholder = 'Cerca…',
  emptyTitle = 'Nessun elemento',
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  className,
  maxHeight = '400px',
}: {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  searchKeys?: (keyof T)[]
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
  emptyActionLabel?: string
  onEmptyAction?: () => void
  className?: string
  maxHeight?: string
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim() || !searchKeys) return items
    const q = search.toLowerCase()
    return items.filter(item =>
      searchKeys.some(key => {
        const val = item[key]
        return val != null && String(val).toLowerCase().includes(q)
      })
    )
  }, [items, search, searchKeys])

  return (
    <div className={cn('flex flex-col', className)}>
      {searchKeys && searchKeys.length > 0 && (
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 pr-8 h-8 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Pulisci ricerca"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="overflow-y-auto" style={{ maxHeight }}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={items.length === 0 ? emptyTitle : 'Nessun risultato'}
            description={items.length === 0 ? emptyDescription : 'Prova a modificare la ricerca.'}
            actionLabel={items.length === 0 ? emptyActionLabel : undefined}
            onAction={items.length === 0 ? onEmptyAction : undefined}
          />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((item, idx) => (
              <li key={idx}>{renderItem(item, idx)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
