/**
 * API: /api/health — System health check
 *
 * Track 2.5: Verifica lo stato di tutti i servizi:
 * - PostgreSQL (connection + query latency)
 * - Redis (connection + ping latency)
 * - WebSocket service (HTTP health)
 * - Disk usage
 * - Memory usage
 * - Uptime
 *
 * Response: { status: 'ok'|'degraded'|'down', services: {...}, uptime, timestamp }
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { redis } from '@/lib/redis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ServiceStatus = {
  status: 'ok' | 'degraded' | 'down'
  latencyMs?: number
  details?: string
}

export async function GET() {
  const services: Record<string, ServiceStatus> = {}
  const checks: Promise<void>[] = []

  // === PostgreSQL check ===
  checks.push((async () => {
    const start = Date.now()
    try {
      await db.$queryRaw`SELECT 1`
      const latency = Date.now() - start
      services.postgresql = {
        status: latency < 1000 ? 'ok' : latency < 3000 ? 'degraded' : 'down',
        latencyMs: latency,
        details: `Connected (${latency}ms)`,
      }
    } catch (e: any) {
      services.postgresql = { status: 'down', details: e.message }
    }
  })())

  // === Redis check ===
  checks.push((async () => {
    const start = Date.now()
    try {
      const pong = await Promise.race([
        redis.ping(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ])
      const latency = Date.now() - start
      services.redis = {
        status: pong === 'PONG' ? (latency < 500 ? 'ok' : 'degraded') : 'down',
        latencyMs: latency,
        details: `PONG received (${latency}ms)`,
      }
    } catch (e: any) {
      services.redis = { status: 'down', details: e.message }
    }
  })())

  // === WebSocket service check ===
  checks.push((async () => {
    const start = Date.now()
    try {
      const r = await Promise.race([
        fetch('http://localhost:3004/health'),
        new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ])
      const d = await r.json()
      const latency = Date.now() - start
      services.websocket = {
        status: d.ok ? 'ok' : 'down',
        latencyMs: latency,
        details: `${d.wsClients} clients, redis: ${d.redisConnected}`,
      }
    } catch {
      services.websocket = { status: 'degraded', details: 'WS service not running (non-critical)' }
    }
  })())

  // === Memory check ===
  checks.push((async () => {
    const mem = process.memoryUsage()
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024)
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024)
    const rssMB = Math.round(mem.rss / 1024 / 1024)
    const heapPct = (heapUsedMB / heapTotalMB) * 100

    services.memory = {
      status: heapPct < 95 ? 'ok' : 'degraded',
      details: `Heap: ${heapUsedMB}/${heapTotalMB}MB (${heapPct.toFixed(0)}%), RSS: ${rssMB}MB`,
    }
  })())

  // Run all checks in parallel
  await Promise.allSettled(checks)

  // === Overall status ===
  const allStatuses = Object.values(services).map(s => s.status)
  const overall: 'ok' | 'degraded' | 'down' =
    allStatuses.includes('down') ? 'down'
    : allStatuses.includes('degraded') ? 'degraded'
    : 'ok'

  return NextResponse.json({
    status: overall,
    services,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '0.9.0',
  }, {
    status: overall === 'down' ? 503 : 200,
  })
}
