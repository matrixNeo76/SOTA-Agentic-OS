'use client'

import { useEffect, useState, useRef } from 'react'
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
}

export type StateDiffLive = {
  actor: string
  ops: unknown[]
  accepted: boolean
  reason: string
  ts: string
}

type LiveState = {
  connected: boolean
  sensorium: SensoriumLive | null
  events: AgentEventLive[]
  diffs: StateDiffLive[]
}

const MAX_EVENTS = 50
const MAX_DIFFS = 30

/**
 * Hook che si connette al WebSocket event-bus e espone
 * lo stato live del Sensorium + eventi agente + state diff.
 */
export function useSensoriumLive() {
  const [state, setState] = useState<LiveState>({
    connected: false,
    sensorium: null,
    events: [],
    diffs: [],
  })
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }))
      socket.emit('subscribe', ['sensorium', 'agent_event', 'state_diff'])
    })

    socket.on('disconnect', () => {
      setState((s) => ({ ...s, connected: false }))
    })

    socket.on('sensorium', (data: Omit<SensoriumLive, 'ts'>) => {
      setState((s) => ({
        ...s,
        sensorium: { ...data, ts: new Date().toISOString() },
      }))
    })

    socket.on('agent_event', (data: Omit<AgentEventLive, 'ts'>) => {
      setState((s) => ({
        ...s,
        events: [{ ...data, ts: new Date().toISOString() }, ...s.events].slice(0, MAX_EVENTS),
      }))
    })

    socket.on('state_diff', (data: Omit<StateDiffLive, 'ts'>) => {
      setState((s) => ({
        ...s,
        diffs: [{ ...data, ts: new Date().toISOString() }, ...s.diffs].slice(0, MAX_DIFFS),
      }))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  return state
}
