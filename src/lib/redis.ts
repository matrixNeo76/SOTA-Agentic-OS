/**
 * Redis Client — Shared connection for pub/sub, job queue, rate limiting, caching.
 *
 * Uses ioredis with connection pooling and automatic reconnection.
 * Connection string from REDIS_URL env var (Railway.com Redis 7.4.7).
 */
import Redis, { type Redis as RedisType } from 'ioredis'

const globalForRedis = globalThis as unknown as {
  __redisClient: RedisType | undefined
  __redisSubscriber: RedisType | undefined
}

function createClient(): RedisType {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL not set. Add it to .env')
  }
  return new Redis(url, {
    connectTimeout: 10000,
    retryStrategy: (times) => {
      if (times > 5) {
        console.error('[redis] Max reconnection attempts reached')
        return null
      }
      return Math.min(times * 500, 3000)
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  })
}

// === Main client (for commands: get/set/publish/etc.) ===
if (!globalForRedis.__redisClient) {
  globalForRedis.__redisClient = createClient()
  globalForRedis.__redisClient.on('connect', () => {
    console.log('[redis] Connected to Redis')
  })
  globalForRedis.__redisClient.on('error', (e) => {
    console.error('[redis] Error:', e.message)
  })
}

// === Subscriber client (for pub/sub subscriptions) ===
// Redis requires a separate connection for subscriptions
if (!globalForRedis.__redisSubscriber) {
  globalForRedis.__redisSubscriber = createClient()
  globalForRedis.__redisSubscriber.on('connect', () => {
    console.log('[redis-sub] Subscriber connected')
  })
  globalForRedis.__redisSubscriber.on('error', (e) => {
    console.error('[redis-sub] Error:', e.message)
  })
}

export const redis = globalForRedis.__redisClient
export const redisSub = globalForRedis.__redisSubscriber

// === Pub/Sub helpers ===

/**
 * Publish a message to a Redis channel.
 * Best-effort: silently fails if Redis is unavailable.
 */
export async function publish(channel: string, message: unknown): Promise<void> {
  try {
    const payload = typeof message === 'string' ? message : JSON.stringify(message)
    await redis.publish(channel, payload)
  } catch (e) {
    // Silent fail — pub/sub is best-effort
    console.error(`[redis] publish failed on ${channel}:`, (e as Error).message)
  }
}

/**
 * Subscribe to a Redis channel.
 * Returns an unsubscribe function.
 */
export function subscribe(
  channel: string,
  handler: (message: string) => void
): () => void {
  redisSub.subscribe(channel).catch(() => {})

  const listener = (ch: string, message: string) => {
    if (ch === channel) handler(message)
  }

  redisSub.on('message', listener)

  return () => {
    redisSub.unsubscribe(channel).catch(() => {})
    redisSub.off('message', listener)
  }
}

// === Cache helpers (for Track 6 rate limiting + general caching) ===

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const val = await redis.get(key)
    if (!val) return null
    return JSON.parse(val) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const payload = JSON.stringify(value)
    if (ttlSeconds) {
      await redis.set(key, payload, 'EX', ttlSeconds)
    } else {
      await redis.set(key, payload)
    }
  } catch (e) {
    console.error('[redis] cacheSet failed:', (e as Error).message)
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key)
  } catch {
    // silent
  }
}

export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number> {
  try {
    const count = await redis.incr(key)
    if (count === 1 && ttlSeconds) {
      await redis.expire(key, ttlSeconds)
    }
    return count
  } catch {
    return 0
  }
}
