'use client'

/**
 * LiveFeed — C6.3 with WS fallback
 *
 * When the Sensorium WebSocket is connected, shows real-time events.
 * When offline, falls back to the recentLogs from /api/dashboard (already
 * polled by useDashboard every 5-30s), so the feed is never empty.
 *
 * Also explains how to enable WS if the user wants real-time updates.
 */

import { useSensoriumLive } from './use-sensorium-live'
import { useDashboard } from './use-dashboard'
import { Radio, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function LiveFeed() {
  const { connected, events } = useSensoriumLive()
  const { data } = useDashboard()
  const [showHelp, setShowHelp] = useState(false)

  // Use WS events if connected, otherwise fall back to recentLogs
  const source = connected
    ? events.slice(0, 15).map((e) => ({
        id: `${e.ts}-${e.event}`,
        phase: e.phase,
        agentId: e.agentId,
        event: e.event,
        level: e.level ?? 'info',
        ts: e.ts,
      }))
    : (data?.recentLogs ?? []).slice(0, 15).map((log) => ({
        id: log.id,
        phase: log.phase,
        agentId: log.agentId,
        event: log.event,
        level: log.level,
        ts: log.timestamp,
      }))

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {connected ? (
          <Radio className="size-3.5 text-status-ok" aria-hidden />
        ) : (
          <WifiOff className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <span className="text-xs font-medium text-muted-foreground">
          {connected ? 'Live Events (WebSocket)' : 'Recent Events (polling fallback)'}
        </span>
        {!connected && (
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

      {!connected && showHelp && (
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

      {source.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4">
          {connected ? 'In attesa di eventi…' : 'No recent events'}
        </p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto" role="log" aria-live="polite">
          {source.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-xs py-1">
              <span
                className={cn(
                  'size-1.5 rounded-full shrink-0',
                  e.level === 'warn' || e.level === 'error'
                    ? 'bg-status-warn'
                    : 'bg-status-ok',
                )}
                aria-hidden
              />
              <span className="text-muted-foreground font-mono text-[10px] shrink-0">
                {e.phase}
              </span>
              <span className="font-mono text-[10px] shrink-0 text-muted-foreground">
                {e.agentId.split('/').pop() || e.agentId}
              </span>
              <span className="font-mono text-[11px] truncate flex-1">{e.event}</span>
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                {new Date(e.ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
