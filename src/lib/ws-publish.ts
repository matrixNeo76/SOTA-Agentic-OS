/**
 * Helper per pubblicare eventi sul WebSocket bus.
 * Chiamato dalle API routes quando si verificano eventi significativi.
 * Fallisce silenziosamente se il WS service non è attivo (best-effort).
 *
 * C6.4 — Now includes `timestamp` and `id` in the payload so the client
 * can display accurate event time (not receive time) and dedup events.
 */
import { randomUUID } from 'crypto'

const PUBLISH_URL = 'http://localhost:3004/publish'

export type WsChannel = 'sensorium' | 'agent_event' | 'state_diff'

export async function publishEvent<T = unknown>(channel: WsChannel, payload: T & { timestamp?: string; id?: string }): Promise<void> {
  try {
    const enrichedPayload = {
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
      id: payload.id || randomUUID(),
    }
    await fetch(PUBLISH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, payload: enrichedPayload }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // Best-effort: se il WS service non è attivo, ignora
  }
}

export async function publishSensorium(data: {
  cycleId: number
  xml: string
  queueDepth: number
  activeThreads: number
  systemLoad: number
  timestamp?: string
}) {
  return publishEvent('sensorium', data)
}

export async function publishAgentEvent(data: {
  agentId: string
  phase: string
  event: string
  level?: 'info' | 'warn' | 'error'
  payload?: unknown
  timestamp?: string
  id?: string
}) {
  return publishEvent('agent_event', data)
}

export async function publishStateDiff(data: {
  actor: string
  ops: unknown[]
  accepted: boolean
  reason: string
  timestamp?: string
  id?: string
}) {
  return publishEvent('state_diff', data)
}
