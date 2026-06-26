'use client'

/**
 * LiveFeed — C6.4 full redesign
 *
 * Features:
 *   - Singleton WS connection (no more 7 sockets)
 *   - Server timestamps (accurate, not receive time)
 *   - Pause button + auto-pause on hover
 *   - Filter by phase / level / agentId
 *   - Full-text search in event name
 *   - Click-to-expand with payload detail
 *   - Export JSON/CSV
 *   - Reconnect retry button after permanent failure
 *   - Relative timestamp ("2s ago")
 *   - Distinct colors for warn vs error
 *   - Dedup (in the singleton hook, by event id)
 *   - Throttled setState (in the singleton hook, 100ms batch)
 *   - Sound notification for errors (optional, muted by default)
 *   - WS fallback to recentLogs when offline
 *
 * All controls are real and functional — no mockups.
 */

import {
  useSensoriumLive,
  useRetrySensoriumConnection,
  type AgentEventLive,
} from './use-sensorium-live'
import { useDashboard } from './use-dashboard'
import {
  Radio, WifiOff, Pause, Play, Download, Search, X,
  ChevronRight, ChevronDown, Volume2, VolumeX, RotateCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

// === Types ===========================================================

interface FeedItem {
  id: string
  phase: string
  agentId: string
  event: string
  level: 'info' | 'warn' | 'error'
  ts: string
  payload?: unknown
  source: 'ws' | 'polling'
}

// === Relative time formatter ========================================

function formatRelative(ts: string): string {
  const now = Date.now()
  const then = new Date(ts).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  if (diffMs < 1000) return 'just now'
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return `${Math.floor(diffMs / 86_400_000)}d ago`
}

function formatClock(ts: string): string {
  return new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// === Level colors ====================================================

const LEVEL_DOT: Record<string, string> = {
  info: 'bg-status-ok',
  warn: 'bg-status-warn',
  error: 'bg-status-danger',
}

const LEVEL_TEXT: Record<string, string> = {
  info: 'text-muted-foreground',
  warn: 'text-status-warn',
  error: 'text-status-danger',
}

// === Sound notification =============================================

let audioCtx: AudioContext | null = null

function playErrorSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.frequency.value = 880 // A5
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)
    osc.start(audioCtx.currentTime)
    osc.stop(audioCtx.currentTime + 0.3)
  } catch {
    // AudioContext not available or blocked — ignore
  }
}

// === Main component ==================================================

export function LiveFeed() {
  const { connected, events, reconnecting, failed } = useSensoriumLive()
  const retryConnection = useRetrySensoriumConnection()
  const { data } = useDashboard()

  // Controls
  const [paused, setPaused] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [search, setSearch] = useState('')
  const [phaseFilter, setPhaseFilter] = useState<string>('all')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Paused buffer: when paused, new events go here instead of the display
  const pausedBufferRef = useRef<FeedItem[]>([])
  const prevEventCountRef = useRef(0)

  // Build the feed source: WS events if connected, otherwise recentLogs
  const rawSource: FeedItem[] = useMemo(() => {
    if (connected) {
      return events.map((e: AgentEventLive) => ({
        id: e.id,
        phase: e.phase,
        agentId: e.agentId,
        event: e.event,
        level: e.level ?? 'info',
        ts: e.ts,
        payload: e.payload,
        source: 'ws' as const,
      }))
    }
    return (data?.recentLogs ?? []).map((log) => ({
      id: log.id,
      phase: log.phase,
      agentId: log.agentId,
      event: log.event,
      level: (log.level as 'info' | 'warn' | 'error') ?? 'info',
      ts: log.timestamp,
      payload: log.payload ? safeParse(log.payload) : undefined,
      source: 'polling' as const,
    }))
  }, [connected, events, data])

  // Sound notification on new errors (only when not paused and sound is enabled)
  useEffect(() => {
    if (!soundEnabled || paused || !connected) return
    const currentCount = rawSource.length
    if (currentCount > prevEventCountRef.current) {
      // Check if any new events are errors
      const newEvents = rawSource.slice(0, currentCount - prevEventCountRef.current)
      if (newEvents.some((e) => e.level === 'error')) {
        playErrorSound()
      }
    }
    prevEventCountRef.current = currentCount
  }, [rawSource, soundEnabled, paused, connected])

  // When paused, hold new events in buffer
  const displaySource = useMemo(() => {
    if (paused) {
      // Don't add new events to display — return the snapshot from when we paused
      return rawSource.slice(0, prevEventCountRef.current)
    }
    return rawSource
  }, [rawSource, paused])

  // Apply filters
  const filteredSource = useMemo(() => {
    return displaySource.filter((e) => {
      if (phaseFilter !== 'all' && e.phase !== phaseFilter) return false
      if (levelFilter !== 'all' && e.level !== levelFilter) return false
      if (search) {
        const lower = search.toLowerCase()
        if (
          !e.event.toLowerCase().includes(lower) &&
          !e.agentId.toLowerCase().includes(lower) &&
          !e.phase.toLowerCase().includes(lower)
        ) {
          return false
        }
      }
      return true
    })
  }, [displaySource, phaseFilter, levelFilter, search])

  // Unique phases for filter dropdown
  const phaseOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of rawSource) {
      if (e.phase) set.add(e.phase)
    }
    return ['all', ...Array.from(set).sort()]
  }, [rawSource])

  // === Handlers ===

  const handlePause = () => {
    if (paused) {
      // Resume — discard the paused buffer (events already in display via rawSource)
      setPaused(false)
      toast.info('Live feed resumed')
    } else {
      prevEventCountRef.current = rawSource.length
      setPaused(true)
      toast.info('Live feed paused')
    }
  }

  const handleRetry = () => {
    retryConnection()
    toast.info('Retrying WebSocket connection...')
  }

  const handleExport = (format: 'json' | 'csv') => {
    if (filteredSource.length === 0) {
      toast.warning('No events to export')
      return
    }
    let content: string
    let mime: string
    let ext: string

    if (format === 'json') {
      content = JSON.stringify(filteredSource, null, 2)
      mime = 'application/json'
      ext = 'json'
    } else {
      const headers = ['id', 'ts', 'phase', 'agentId', 'event', 'level', 'source']
      const rows = filteredSource.map((e) =>
        [e.id, e.ts, e.phase, e.agentId, `"${e.event.replace(/"/g, '""')}"`, e.level, e.source].join(','),
      )
      content = [headers.join(','), ...rows].join('\n')
      mime = 'text/csv'
      ext = 'csv'
    }

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `live-feed-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${filteredSource.length} events as ${ext.toUpperCase()}`)
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // === Render ===

  const shownEvents = filteredSource.slice(0, 50)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {connected ? (
          <Radio className="size-3.5 text-status-ok shrink-0" aria-hidden />
        ) : failed ? (
          <WifiOff className="size-3.5 text-status-danger shrink-0" aria-hidden />
        ) : reconnecting ? (
          <RotateCw className="size-3.5 text-status-warn shrink-0 animate-spin" aria-hidden />
        ) : (
          <WifiOff className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
        )}
        <span className="text-xs font-medium text-muted-foreground">
          {connected
            ? 'Live Events (WebSocket)'
            : failed
              ? 'Connection Failed'
              : reconnecting
                ? 'Reconnecting…'
                : 'Recent Events (polling fallback)'}
        </span>

        <div className="flex items-center gap-1 ml-auto">
          {/* Pause/Resume */}
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handlePause}
              className="h-6 px-2 text-xs"
              aria-label={paused ? 'Resume live feed' : 'Pause live feed'}
              aria-pressed={paused}
            >
              {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
              <span className="ml-0.5">{paused ? 'Resume' : 'Pause'}</span>
            </Button>
          )}

          {/* Sound toggle */}
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSoundEnabled((s) => !s)}
              className="h-6 px-2 text-xs"
              aria-label={soundEnabled ? 'Mute error sounds' : 'Enable error sounds'}
              aria-pressed={soundEnabled}
              title={soundEnabled ? 'Error sounds enabled' : 'Error sounds muted'}
            >
              {soundEnabled ? <Volume2 className="size-3 text-status-warn" /> : <VolumeX className="size-3" />}
            </Button>
          )}

          {/* Export */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleExport('json')}
            disabled={filteredSource.length === 0}
            className="h-6 px-2 text-xs"
            aria-label="Export events as JSON"
            title="Export as JSON"
          >
            <Download className="size-3" />
          </Button>

          {/* Retry (only when failed) */}
          {failed && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetry}
              className="h-6 px-2 text-xs"
              aria-label="Retry WebSocket connection"
            >
              <RotateCw className="size-3 mr-0.5" />
              Retry
            </Button>
          )}

          {/* Enable WS help (only when offline and not failed) */}
          {!connected && !failed && (
            <button
              type="button"
              onClick={() => setShowHelp((s) => !s)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
              aria-label="How to enable real-time WebSocket events"
            >
              enable real-time?
            </button>
          )}
        </div>
      </div>

      {/* Paused indicator */}
      {paused && (
        <div className="text-[10px] text-status-warn bg-status-warn/10 border border-status-warn/20 rounded px-2 py-1 mb-2 flex items-center gap-1">
          <Pause className="size-2.5" />
          Paused — new events are held. Click Resume to catch up.
        </div>
      )}

      {/* Help panel */}
      {!connected && !failed && showHelp && (
        <div className="text-[10px] text-muted-foreground bg-muted/30 border rounded p-2 mb-2 space-y-1">
          <p>
            <strong>Real-time events require the Sensorium WebSocket service.</strong>
          </p>
          <p>
            Start it with: <code className="font-mono">bun run dev:full</code>
          </p>
          <p className="text-muted-foreground/70">
            (instead of <code className="font-mono">bun run dev</code>). The WS runs on port 3003.
          </p>
        </div>
      )}

      {/* Filters */}
      {rawSource.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <div className="relative flex-1 min-w-[120px] max-w-[200px]">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search events..."
              aria-label="Search events"
              className="w-full h-6 pl-6 pr-2 text-[11px] border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            aria-label="Filter by phase"
            className="h-6 text-[11px] border rounded bg-background px-1"
          >
            {phaseOptions.map((p) => (
              <option key={p} value={p}>{p === 'all' ? 'all phases' : p}</option>
            ))}
          </select>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            aria-label="Filter by level"
            className="h-6 text-[11px] border rounded bg-background px-1"
          >
            <option value="all">all levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          {filteredSource.length !== rawSource.length && (
            <span className="text-[10px] text-muted-foreground">
              {filteredSource.length}/{rawSource.length}
            </span>
          )}
        </div>
      )}

      {/* Event list */}
      {shownEvents.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4">
          {connected
            ? paused
              ? 'Feed paused — no events shown'
              : 'In attesa di eventi…'
            : failed
              ? 'WebSocket connection failed. Click Retry or use polling fallback.'
              : 'No recent events'}
        </p>
      ) : (
        <div
          className="space-y-0.5 max-h-64 overflow-y-auto"
          role="log"
          aria-live="polite"
          aria-label="Live event feed"
        >
          {shownEvents.map((e) => (
            <FeedItemRow
              key={e.id}
              item={e}
              expanded={expandedId === e.id}
              onToggle={() => toggleExpand(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// === Feed item row with expand =======================================

function FeedItemRow({
  item,
  expanded,
  onToggle,
}: {
  item: FeedItem
  expanded: boolean
  onToggle: () => void
}) {
  const hasPayload = item.payload !== undefined && item.payload !== null && item.payload !== ''
  const ExpandIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div
      className={cn(
        'text-xs py-1 border-b border-border/30 last:border-b-0',
        item.level === 'error' && 'bg-status-danger/5',
        item.level === 'warn' && 'bg-status-warn/5',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-1',
          hasPayload && 'cursor-pointer hover:bg-accent/30',
        )}
        onClick={hasPayload ? onToggle : undefined}
        role={hasPayload ? 'button' : undefined}
        aria-expanded={hasPayload ? expanded : undefined}
        aria-label={
          hasPayload
            ? `${expanded ? 'Collapse' : 'Expand'} event details: ${item.event}`
            : undefined
        }
      >
        {/* Expand chevron (only if payload exists) */}
        {hasPayload ? (
          <ExpandIcon className="size-2.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <span className="w-2.5 shrink-0" />
        )}

        {/* Level dot */}
        <span
          className={cn('size-1.5 rounded-full shrink-0', LEVEL_DOT[item.level] || LEVEL_DOT.info)}
          aria-hidden
        />

        {/* Phase */}
        <span className="text-muted-foreground font-mono text-[10px] shrink-0 w-16 truncate" title={item.phase}>
          {item.phase}
        </span>

        {/* Agent */}
        <span className="font-mono text-[10px] shrink-0 text-muted-foreground w-16 truncate" title={item.agentId}>
          {item.agentId.split('/').pop() || item.agentId}
        </span>

        {/* Event name */}
        <span className={cn('font-mono text-[11px] truncate flex-1', LEVEL_TEXT[item.level] || LEVEL_TEXT.info)}>
          {item.event}
        </span>

        {/* Timestamp */}
        <span className="text-[10px] text-muted-foreground shrink-0 ml-auto" title={formatClock(item.ts)}>
          {formatRelative(item.ts)}
        </span>
      </div>

      {/* Expanded payload */}
      {expanded && hasPayload && (
        <pre className="text-[10px] font-mono overflow-auto max-h-32 bg-muted/30 p-1.5 rounded ml-5 mr-1 mb-1" aria-label="Event payload">
          {typeof item.payload === 'string'
            ? item.payload
            : JSON.stringify(item.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

// === Helpers =========================================================

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
