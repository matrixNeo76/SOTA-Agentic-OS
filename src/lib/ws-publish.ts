/**
 * Helper per pubblicare eventi sul WebSocket bus.
 * Chiamato dalle API routes quando si verificano eventi significativi.
 * Fallisce silenziosamente se il WS service non è attivo (best-effort).
 */
const PUBLISH_URL = 'http://localhost:3004/publish'

export type WsChannel = 'sensorium' | 'agent_event' | 'state_diff'

export async function publishEvent<T = unknown>(channel: WsChannel, payload: T): Promise<void> {
  try {
    await fetch(PUBLISH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, payload }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // Best-effort: se il WS service non è attivo, ignora
  }
}

export async function publishSensorium(data: { cycleId: number; xml: string; queueDepth: number; activeThreads: number; systemLoad: number }) {
  return publishEvent('sensorium', data)
}

export async function publishAgentEvent(data: { agentId: string; phase: string; event: string; level?: 'info' | 'warn' | 'error'; payload?: unknown }) {
  return publishEvent('agent_event', data)
}

export async function publishStateDiff(data: { actor: string; ops: unknown[]; accepted: boolean; reason: string }) {
  return publishEvent('state_diff', data)
}
