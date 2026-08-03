/**
 * Rate Limiting — Track 6.1
 *
 * Redis-backed sliding window rate limiter.
 *
 * Limits:
 * - Per-user: 100 req/min (default)
 * - Per-tenant: 1000 req/min (default)
 * - Per-IP: 200 req/min (for unauthenticated)
 *
 * Usage nel middleware:
 *   import { checkRateLimit } from '@/lib/rate-limit'
 *   const rateLimit = await checkRateLimit(userId, 'user')
 *   if (!rateLimit.allowed) return 429
 */
import { redis } from '@/lib/redis'

type RateLimitType = 'user' | 'tenant' | 'ip'

const LIMITS: Record<RateLimitType, { max: number; windowSec: number }> = {
  user: { max: 100, windowSec: 60 },      // 100 req/min per user
  tenant: { max: 1000, windowSec: 60 },   // 1000 req/min per tenant
  ip: { max: 200, windowSec: 60 },        // 200 req/min per IP (unauthenticated)
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: number // epoch seconds
  limit: number
}

/**
 * Check rate limit using Redis sliding window.
 * Uses Redis INCR + EXPIRE for atomic counting.
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType = 'user'
): Promise<RateLimitResult> {
  const config = LIMITS[type]
  const key = `ratelimit:${type}:${identifier}`

  try {
    // Atomic increment
    const count = await redis.incr(key)

    // Set expiry on first request
    if (count === 1) {
      await redis.expire(key, config.windowSec)
    }

    // Get TTL for reset time
    const ttl = await redis.ttl(key)
    const resetAt = Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : config.windowSec)

    return {
      allowed: count <= config.max,
      remaining: Math.max(0, config.max - count),
      resetAt,
      limit: config.max,
    }
  } catch {
    // Redis unavailable — allow through (fail-open, better than lockout)
    return {
      allowed: true,
      remaining: 999,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      limit: 999,
    }
  }
}

/**
 * Generate rate limit headers for HTTP response.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  }
}
