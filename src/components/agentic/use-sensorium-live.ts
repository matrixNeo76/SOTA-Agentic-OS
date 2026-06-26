'use client'

/**
 * useSensoriumLive — C6.4 singleton pattern
 *
 * BEFORE: every component calling useSensoriumLive() opened a NEW
 * socket.io connection (forceNew: true). With 5+ subscribers mounted
 * simultaneously (LiveFeed, StatusBar, SovereignModal, WorkspaceViews,
 * Cockpit, QuickStats, ConsoleStream), that meant 5+ WebSocket
 * connections to the same server — each doing its own handshake,
 * subscribe, and receiving duplicate events.
 *
 * NOW: a single module-level socket is shared by all subscribers via
 * ref counting. The socket is created on first mount and disconnected
 * when the last subscriber unmounts. State is broadcast to all
 * subscribers via a listener set.
 *
 * Also fixes the timestamp bug: the server now includes `timestamp` in
 * the payload, and the client uses it instead of `new Date().toISOString()`
 * (which was inaccurate — represented receive time, not event time).
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'

export type SensoriumLive = {
  cycleId: number
  xml: string
  queueDepth: number
  activeThreads: number
  systemLoad: number
  ts: string
}

export type AgentEventLive = {
  agentId: string
  phase: string
  event: string
  level?: 'info' | 'warn' | 'error'
  payload?: unknown
  ts: string
  id: string // dedup key (server-provided or generated)
}

export type StateDiffLive = {
  actor: string
  ops: unknown[]
  accepted: boolean
  reason: string
  ts: string
  id: string
}

type LiveState = {
  connected: boolean
  sensorium: SensoriumLive | null
  events: AgentEventLive[]
  diffs: StateDiffLive[]
  reconnecting: boolean
  failed: boolean // true after reconnectionAttempts exhausted
}

const MAX_EVENTS = 200
const MAX_DIFFS = 50

// === Singleton socket + state =======================================

let socket: Socket | null = null
let subscriberCount = 0
let currentState: LiveState = {
  connected: false,
  sensorium: null,
  events: [],
  diffs: [],
  reconnecting: false,
  failed: false,
}
const listeners = new Set<(s: LiveState) => void>()

// Event buffer for throttled flush (C6.4 — prevents UI freeze on event storm)
let pendingEvents: AgentEventLive[] = []
let pendingDiffs: StateDiffLive[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_INTERVAL = 100 // ms — batch setState every 100ms max

function setState(updater: (s: LiveState) => LiveState) {
  currentState = updater(currentState)
  for (const listener of listeners) {
    listener(currentState)
  }
}

function flushPending() {
  flushTimer = null
  if (pendingEvents.length === 0 && pendingDiffs.length === 0) return

  setState((s) => {
    const newEvents = [...pendingEvents.reverse(), ...s.events].slice(0, MAX_EVENTS)
    // pendingEvents.reverse() because we push to pendingEvents in order,
    // but the display is newest-first
    const newDiffs = [...pendingDiffs.reverse(), ...s.diffs].slice(0, MAX_DIFFS)
    pendingEvents = []
    pendingDiffs = []
    return { ...s, events: newEvents, diffs: newDiffs }
  })
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(flushPending, FLUSH_INTERVAL)
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function connect() {
  if (socket) return

  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    forceNew: false, // C6.4 — reuse connection (was true, causing leaks)
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1500,
    timeout: 10000,
  })

  socket.on('connect', () => {
    setState((s) => ({ ...s, connected: true, reconnecting: false, failed: false }))
    socket?.emit('subscribe', ['sensorium', 'agent_event', 'state_diff'])
  })

  socket.on('disconnect', () => {
    setState((s) => ({ ...s, connected: false, reconnecting: true, failed: false }))
  })

  socket.on('reconnect_failed', () => {
    setState((s) => ({ ...s, connected: false, reconnecting: false, failed: true }))
  })

  socket.on('reconnect_attempt', (attempt: number) => {
    setState((s) => ({ ...s, reconnecting: true, failed: false }))
  })

  socket.on('sensorium', (data: Omit<SensoriumLive, 'ts'> & { timestamp?: string }) => {
    setState((s) => ({
      ...s,
      sensorium: { ...data, ts: data.timestamp || new Date().toISOString() },
    }))
  })

  socket.on('agent_event', (data: Omit<AgentEventLive, 'ts' | 'id'> & { timestamp?: string; id?: string }) => {
    const event: AgentEventLive = {
      ...data,
      ts: data.timestamp || new Date().toISOString(),
      id: data.id || generateId(),
    }
    // Dedup: skip if we already have this event id
    if (currentState.events.some((e) => e.id === event.id)) return
    pendingEvents.push(event)
    scheduleFlush()
  })

  socket.on('state_diff', (data: Omit<StateDiffLive, 'ts' | 'id'> & { timestamp?: string; id?: string }) => {
    const diff: StateDiffLive = {
      ...data,
      ts: data.timestamp || new Date().toISOString(),
      id: data.id || generateId(),
    }
    if (currentState.diffs.some((d) => d.id === diff.id)) return
    pendingDiffs.push(diff)
    scheduleFlush()
  })
}

function disconnect() {
  if (!socket) return
  socket.disconnect()
  socket = null
  // Reset state for next connection
  currentState = {
    connected: false,
    sensorium: null,
    events: [],
    diffs: [],
    reconnecting: false,
    failed: false,
  }
  pendingEvents = []
  pendingDiffs = []
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

/**
 * Force a reconnection attempt (used by the "Retry" button in the UI
 * after reconnectionAttempts is exhausted).
 */
function retryConnection() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  setState((s) => ({ ...s, failed: false, reconnecting: true }))
  connect()
}

// === Hook ============================================================

export function useSensoriumLive() {
  const [state, setLocalState] = useState<LiveState>(currentState)

  useEffect(() => {
    // Subscribe to state updates
    const listener = (s: LiveState) => setLocalState(s)
    listeners.add(listener)

    // Increment subscriber count and connect if first
    subscriberCount++
    if (subscriberCount === 1) {
      connect()
    }

    return () => {
      listeners.delete(listener)
      subscriberCount = Math.max(0, subscriberCount - 1)
      if (subscriberCount === 0) {
        disconnect()
      }
    }
  }, [])

  return state
}

/**
 * Expose retryConnection for the UI to call when the socket fails
 * permanently (after reconnectionAttempts exhausted).
 */
export function useRetrySensoriumConnection() {
  return useCallback(() => {
    retryConnection()
  }, [])
}
