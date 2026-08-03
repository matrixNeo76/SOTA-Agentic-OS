/**
 * Graceful Shutdown Handler — Track 2.5
 *
 * Gestisce la chiusura pulita di tutte le connessioni:
 * - Prisma (PostgreSQL)
 * - Redis
 * - Server HTTP
 *
 * Evita data loss e connessioni zombie su crash/restart.
 */
import { db } from '@/lib/db'
import { redis, redisSub } from '@/lib/redis'

let shuttingDown = false

export function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[shutdown] ${signal} received, closing connections...`)

    const timeout = setTimeout(() => {
      console.error('[shutdown] Force exit after 10s timeout')
      process.exit(1)
    }, 10000)

    // Close Prisma
    try {
      await db.$disconnect()
      console.log('[shutdown] Prisma disconnected')
    } catch (e) {
      console.error('[shutdown] Prisma disconnect error:', e)
    }

    // Close Redis
    try {
      redis.disconnect()
      redisSub?.disconnect()
      console.log('[shutdown] Redis disconnected')
    } catch (e) {
      console.error('[shutdown] Redis disconnect error:', e)
    }

    clearTimeout(timeout)
    console.log('[shutdown] All connections closed. Exiting.')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGUSR2', () => shutdown('SIGUSR2')) // nodemon restart

  // Uncaught errors — log but don't crash
  process.on('uncaughtException', (err) => {
    console.error('[shutdown] Uncaught exception:', err.message)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[shutdown] Unhandled rejection:', reason)
  })

  console.log('[shutdown] Graceful shutdown handler registered')
}
