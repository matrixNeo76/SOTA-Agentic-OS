/**
 * Instrumentation — WS1.5
 *
 * Entry point di Next.js per codice server-side eseguito una sola volta all'avvio.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Avvia:
 *   1. Integration Layer (Event Mesh bridges — Fase 4.2)
 *   2. Cognitive GC scheduler (Fase 2.9)
 *   3. Recovery boot (WS1.3 — riprende task running orfani)
 *
 * Il worker processa la coda JobRecord in background.
 */

export async function register() {
  // Solo in Node.js runtime (non edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[instrumentation] Starting SOTA Agentic OS server-side services...')

    try {
      // 1. Integration Layer — Event Mesh bridges
      const { startIntegrationLayer } = await import('@/lib/integration/bridges')
      const integrationResult = await startIntegrationLayer()
      console.log(`[instrumentation] Integration layer: ${integrationResult.bridges.length} bridges started`)

      // 2. Cognitive GC scheduler (daily + weekly jobs)
      const { startGCScheduler } = await import('@/lib/cognitive-gc/curator')
      startGCScheduler({
        dailyIntervalHours: 24,
        weeklyIntervalHours: 168,
      })
      console.log('[instrumentation] Cognitive GC scheduler started (daily: decay+consolidation, weekly: archival)')

      // 3. Recovery boot — riprende task running orfani (WS1.3)
      const { recoverOrphanedPlans } = await import('@/lib/runtime/executor')
      const recovery = await recoverOrphanedPlans().catch((err) => {
        console.warn('[instrumentation] Recovery boot failed (non-blocking):', err)
        return { recoveredPlans: 0, recoveredTasks: 0 }
      })
      if (recovery.recoveredPlans > 0) {
        console.log(`[instrumentation] Recovery: ${recovery.recoveredPlans} plans, ${recovery.recoveredTasks} tasks resumed`)
      } else {
        console.log('[instrumentation] Recovery: no orphaned plans found')
      }

      console.log('[instrumentation] All server-side services started successfully')
    } catch (err) {
      console.error('[instrumentation] Failed to start services:', err)
      // Non blocchiamo l'avvio del server — i servizi sono best-effort
    }
  }
}
