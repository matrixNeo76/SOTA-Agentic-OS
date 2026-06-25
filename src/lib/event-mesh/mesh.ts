/**
 * Event Mesh — Fase 2.1
 *
 * Astrazione per pub/sub con 3 backend:
 *   1. NATS JetStream (produzione, raccomandato)
 *   2. Redis Streams (alternativa se NATS non disponibile)
 *   3. In-memory emitter (dev + test, zero dipendenze)
 *
 * Selezione automatica in base a env vars:
 *   - NATS_URL=nats://localhost:4222  → NATS JetStream
 *   - REDIS_URL=redis://localhost:6379 → Redis Streams
 *   - altrimenti                       → In-memory
 *
 * Tutti i 3 backend espongono la stessa interfaccia:
 *   - publish(subject, event): Promise<void>
 *   - subscribe(subject, handler): Promise<Subscription>
 *   - health(): Promise<HealthStatus>
 *
 * Eventi validati contro event-taxonomy.ts (Fase 0.5.4).
 */

import { validateEvent, type SystemEvent, type EventType } from '@/lib/governance'
import { db } from '@/lib/db'

// === Tipi condivisi =================================================

export interface EventMeshBackend {
  name: 'nats' | 'redis' | 'memory'
  publish(subject: string, event: SystemEvent): Promise<void>
  subscribe(subject: string, handler: EventHandler): Promise<Subscription>
  health(): Promise<HealthStatus>
}

export type EventHandler = (event: SystemEvent) => Promise<void> | void

export interface Subscription {
  subject: string
  unsubscribe(): Promise<void>
}

export interface HealthStatus {
  backend: string
  healthy: boolean
  details?: Record<string, unknown>
}

// === Selection logic ================================================

let _backend: EventMeshBackend | null = null
let _subscribers: Map<string, Set<EventHandler>> = new Map()

export function getEventMeshBackend(): EventMeshBackend {
  if (_backend) return _backend

  const natsUrl = process.env.NATS_URL
  const redisUrl = process.env.REDIS_URL

  if (natsUrl) {
    _backend = createNatsBackend(natsUrl)
  } else if (redisUrl) {
    _backend = createRedisBackend(redisUrl)
  } else {
    _backend = createMemoryBackend()
  }

  console.log(`[event-mesh] Backend attivo: ${_backend.name}`)
  return _backend
}

// === In-memory backend (default per dev) ============================

function createMemoryBackend(): EventMeshBackend {
  // Persistenza opzionale su DB per audit trail (best-effort)
  const backend: EventMeshBackend = {
    name: 'memory',

    async publish(subject: string, event: SystemEvent): Promise<void> {
      // 1. Validazione (event-taxonomy)
      const validation = validateEvent(event)
      if (!validation.valid) {
        throw new Error(`Invalid event: ${validation.error}`)
      }

      // 2. Best-effort persistence su AgentLog (audit trail)
      try {
        await db.agentLog.create({
          data: {
            agentId: (event.provenance as any)?.createdByAgent || (event.payload as any)?.agentId || (event.payload as any)?.assignedAgent || 'system',
            phase: 'event-mesh',
            event: event.type,
            payload: JSON.stringify({ subject, ...event }),
            level: 'info',
          },
        })
      } catch {
        // Non bloccante — l'audit trail è best-effort
      }

      // 3. Dispatch sincrono ai subscriber locali
      const handlers = _subscribers.get(subject) || new Set()
      const wildcardHandlers = _subscribers.get('>') || new Set() // NATS-style wildcard
      const allHandlers = new Set([...handlers, ...wildcardHandlers])

      const errors: Error[] = []
      for (const handler of allHandlers) {
        try {
          await handler(event)
        } catch (err) {
          errors.push(err as Error)
          console.error(`[event-mesh] Handler error for ${subject}:`, err)
        }
      }

      if (errors.length > 0) {
        // Non blocchiamo il publisher, ma logghiamo
        console.warn(`[event-mesh] ${errors.length} handler errors for ${subject}`)
      }
    },

    async subscribe(subject: string, handler: EventHandler): Promise<Subscription> {
      if (!_subscribers.has(subject)) {
        _subscribers.set(subject, new Set())
      }
      _subscribers.get(subject)!.add(handler)

      return {
        subject,
        async unsubscribe(): Promise<void> {
          _subscribers.get(subject)?.delete(handler)
        },
      }
    },

    async health(): Promise<HealthStatus> {
      return {
        backend: 'memory',
        healthy: true,
        details: {
          subscribers: _subscribers.size,
          totalHandlers: Array.from(_subscribers.values()).reduce((s, h) => s + h.size, 0),
        },
      }
    },
  }

  return backend
}

// === NATS JetStream backend (lazy-loaded) ===========================

function createNatsBackend(url: string): EventMeshBackend {
  // Lazy import per evitare dipendenza hard in dev (NATS non installato di default).
  // In produzione: `bun add nats` e il modulo viene caricato.
  let natsClient: any = null
  let js: any = null
  const subscriptions: Map<string, any> = new Map()

  const backend: EventMeshBackend = {
    name: 'nats',

    async publish(subject: string, event: SystemEvent): Promise<void> {
      const validation = validateEvent(event)
      if (!validation.valid) throw new Error(`Invalid event: ${validation.error}`)

      if (!natsClient) {
        const { connect } = await import('nats').catch(() => ({ connect: null }))
        if (!connect) throw new Error('nats package not installed. Run: bun add nats')
        natsClient = await connect({ servers: url })
        js = natsClient.jetstream()
      }

      await js.publish(subject, JSON.stringify(event))
    },

    async subscribe(subject: string, handler: EventHandler): Promise<Subscription> {
      if (!natsClient) {
        const { connect } = await import('nats').catch(() => ({ connect: null }))
        if (!connect) throw new Error('nats package not installed. Run: bun add nats')
        natsClient = await connect({ servers: url })
        js = natsClient.jetstream()
      }

      // Consumer durable per JetStream (persistenza + replay)
      const consumer = await js.consumers.get('EVENT_MESH', {
        filter_subject: subject,
      }).catch(async () => {
        // Se il consumer non esiste, crealo
        return await js.consumers.add('EVENT_MESH', {
          filter_subject: subject,
          durable_name: `consumer-${subject.replace(/[^a-zA-Z0-9]/g, '_')}`,
        })
      })

      const sub = await consumer.consume({
        callback: async (msg: any) => {
          try {
            const event = JSON.parse(new TextDecoder().decode(msg.data)) as SystemEvent
            await handler(event)
            await msg.ack()
          } catch (err) {
            console.error(`[event-mesh: NATS] Handler error for ${subject}:`, err)
            await msg.nak()
          }
        },
      })

      subscriptions.set(subject, sub)

      return {
        subject,
        async unsubscribe(): Promise<void> {
          await sub.drain()
          subscriptions.delete(subject)
        },
      }
    },

    async health(): Promise<HealthStatus> {
      try {
        if (!natsClient) {
          return { backend: 'nats', healthy: false, details: { reason: 'not connected yet' } }
        }
        return {
          backend: 'nats',
          healthy: !natsClient.closed(),
          details: { server: url },
        }
      } catch (err) {
        return { backend: 'nats', healthy: false, details: { error: String(err) } }
      }
    },
  }

  return backend
}

// === Redis Streams backend (lazy-loaded) ============================

function createRedisBackend(url: string): EventMeshBackend {
  let redisClient: any = null

  const backend: EventMeshBackend = {
    name: 'redis',

    async publish(subject: string, event: SystemEvent): Promise<void> {
      const validation = validateEvent(event)
      if (!validation.valid) throw new Error(`Invalid event: ${validation.error}`)

      if (!redisClient) {
        const { createClient } = await import('redis').catch(() => ({ createClient: null }))
        if (!createClient) throw new Error('redis package not installed. Run: bun add redis')
        redisClient = createClient({ url })
        await redisClient.connect()
      }

      await redisClient.xAdd(`events:${subject}`, '*', {
        event: JSON.stringify(event),
      })
    },

    async subscribe(subject: string, handler: EventHandler): Promise<Subscription> {
      if (!redisClient) {
        const { createClient } = await import('redis').catch(() => ({ createClient: null }))
        if (!createClient) throw new Error('redis package not installed. Run: bun add redis')
        redisClient = createClient({ url })
        await redisClient.connect()
      }

      // Consumer group per durability
      try {
        await redisClient.xGroupCreate(`events:${subject}`, 'event-mesh', '$')
      } catch {
        // Group già esiste
      }

      let running = true
      const poll = async () => {
        while (running) {
          try {
            const entries = await redisClient.xReadGroup(
              'event-mesh',
              `consumer-${subject.replace(/[^a-zA-Z0-9]/g, '_')}`,
              [{ key: `events:${subject}`, id: '>' }],
              { COUNT: 10, BLOCK: 1000 },
            )

            if (!entries || entries.length === 0) continue

            for (const stream of entries) {
              for (const message of stream.messages) {
                try {
                  const event = JSON.parse(message.message.event) as SystemEvent
                  await handler(event)
                  await redisClient.xAck(`events:${subject}`, 'event-mesh', message.id)
                } catch (err) {
                  console.error(`[event-mesh: Redis] Handler error for ${subject}:`, err)
                }
              }
            }
          } catch (err) {
            console.error(`[event-mesh: Redis] Poll error:`, err)
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
      }

      poll()

      return {
        subject,
        async unsubscribe(): Promise<void> {
          running = false
        },
      }
    },

    async health(): Promise<HealthStatus> {
      try {
        if (!redisClient) {
          return { backend: 'redis', healthy: false, details: { reason: 'not connected yet' } }
        }
        const pong = await redisClient.ping()
        return {
          backend: 'redis',
          healthy: pong === 'PONG',
          details: { url },
        }
      } catch (err) {
        return { backend: 'redis', healthy: false, details: { error: String(err) } }
      }
    },
  }

  return backend
}

// === Public API (façade) ============================================

/**
 * Pubblica un evento sul mesh.
 * Il subject è derivato dal tipo (eventToSubject in event-taxonomy.ts)
 * ma può essere override per casi speciali.
 */
export async function publishEvent(
  event: SystemEvent,
  subjectOverride?: string,
): Promise<void> {
  const { eventToSubject } = await import('@/lib/governance')
  const subject = subjectOverride || eventToSubject(event)
  const backend = getEventMeshBackend()
  await backend.publish(subject, event)
}

/**
 * Sottoscrivi a un subject (o wildcard `>` per tutti).
 */
export async function subscribeEvent(
  subject: string,
  handler: EventHandler,
): Promise<Subscription> {
  const backend = getEventMeshBackend()
  return backend.subscribe(subject, handler)
}

/**
 * Health check per il mesh.
 */
export async function eventMeshHealth(): Promise<HealthStatus> {
  const backend = getEventMeshBackend()
  return backend.health()
}

/**
 * Reset per test (solo memory backend).
 */
export function _resetEventMeshForTests(): void {
  _subscribers = new Map()
  _backend = null
}
