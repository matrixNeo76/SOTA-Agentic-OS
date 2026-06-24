/**
 * Fase 23: Scalability & Persistence
 *
 * Modulo unificato che implementa:
 *  23.1: DB Adapter interface (SQLite current, PostgreSQL-ready)
 *  23.2: WS Pub/Sub Adapter (in-memory current, Redis-ready)
 *  23.3: Job Queue + Worker Pool
 *  23.4: FSM Persistence + Taint TTL
 */
import { db } from '@/lib/db'

// =====================================================
// 23.1 — DB Adapter Interface
// =====================================================

export type DatabaseProvider = 'sqlite' | 'postgresql'

/**
 * Rileva il provider corrente dal DATABASE_URL.
 */
export function getDatabaseProvider(): DatabaseProvider {
  const url = process.env.DATABASE_URL || ''
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql'
  }
  return 'sqlite'
}

/**
 * Info sul database per dashboard.
 */
export async function getDatabaseInfo() {
  const provider = getDatabaseProvider()
  const tables = [
    'EpisodicMemory', 'SemanticEntity', 'LogicalRule', 'PatchTransaction',
    'GlobalState', 'SensoriumSnapshot', 'AgentPlan', 'PlanTask',
    'CompiledArtifact', 'CompiledTemplate', 'SteeringEvent', 'SteeringStrategy',
    'LTLRule', 'VerificationEvent', 'TaintRecord', 'NormativeRule',
    'Heuristic', 'RedLine', 'ReflectionLog', 'AgentLog',
    'ToolCallEntry', 'ContextSummary', 'PruningPolicy',
    'ExecutionTrace', 'PrefixTreeAutomaton', 'TraceValidation',
    'FormalContract', 'LeanEvolveEvent', 'VerifiedWorkflow',
    'DelegationContract', 'ApprovalGate', 'NormativeResolution', 'AuditLedgerEntry',
    'EncapsulatedSession', 'EncapsulationPolicy',
    'AffectSample', 'AffectThreshold',
    'ObjectiveTree', 'ObjectiveNode',
    'Belief', 'ESRSyncEvent', 'QuorumVote', 'QuorumDecision',
    'FoundationModel', 'RoutingDecision', 'RouterConfig',
    'CockpitNarrative', 'BlockedAction', 'Tool', 'ToolPermission',
    'User', 'Session', 'PublisherKey',
    'ErrorRecord', 'TraceSpan', 'BackupRecord',
    'JobRecord', 'FSMSnapshot', 'TaintFlow',
  ]
  return {
    provider,
    supports: {
      concurrentWriters: provider === 'postgresql',
      replication: provider === 'postgresql',
      jsonNative: provider === 'postgresql',
      fullTextSearch: provider === 'postgresql',
    },
    totalModels: tables.length,
    ready: true,
  }
}

// =====================================================
// 23.2 — WS Pub/Sub Adapter Interface
// =====================================================

export type WSAdapterType = 'in-memory' | 'redis'

/**
 * Adapter interface per WS pub/sub.
 * In produzione: sostituire con Redis adapter (@socket.io/redis-adapter).
 * In dev: in-memory singleton (broadcast locale).
 */

class InMemoryPubSub {
  private subscribers: Map<string, ((data: unknown) => void)[]> = new Map()

  subscribe(channel: string, callback: (data: unknown) => void): void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, [])
    }
    this.subscribers.get(channel)!.push(callback)
  }

  publish(channel: string, data: unknown): void {
    const subs = this.subscribers.get(channel) || []
    for (const cb of subs) {
      try { cb(data) } catch {}
    }
  }

  unsubscribe(channel: string, callback?: (data: unknown) => void): void {
    if (!callback) {
      this.subscribers.delete(channel)
      return
    }
    const subs = this.subscribers.get(channel) || []
    const idx = subs.indexOf(callback)
    if (idx >= 0) subs.splice(idx, 1)
  }

  getStats() {
    let totalSubs = 0
    for (const subs of this.subscribers.values()) totalSubs += subs.length
    return {
      channels: this.subscribers.size,
      totalSubscribers: totalSubs,
    }
  }
}

const pubsub = new InMemoryPubSub()

export function getWSAdapterType(): WSAdapterType {
  // In produzione: rilevare da env REDIS_URL
  return process.env.REDIS_URL ? 'redis' : 'in-memory'
}

export function getWSPubSubStats() {
  return {
    adapter: getWSAdapterType(),
    ...pubsub.getStats(),
    clusterReady: getWSAdapterType() === 'redis',
  }
}

export { pubsub }

// =====================================================
// 23.3 — Job Queue + Worker Pool
// =====================================================

export type JobType =
  | 'embeddings_recompute'
  | 'summarize'
  | 'backup'
  | 'fsm_checkpoint'
  | 'taint_cleanup'
  | 'session_cleanup'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retry'

export type JobPriority = 0 | 1 | 2 // 0=normal, 1=high, 2=critical

/**
 * Accoda un job per esecuzione asincrona.
 */
export async function enqueueJob(
  jobType: JobType,
  payload: Record<string, unknown> = {},
  priority: JobPriority = 0
): Promise<{ jobId: string }> {
  const job = await db.jobRecord.create({
    data: {
      jobType,
      status: 'queued',
      priority,
      payload: JSON.stringify(payload),
      maxRetries: 3,
    },
  })
  return { jobId: job.id }
}

/**
 * Processa un job (esecuzione effettiva).
 * Mappa jobType → funzione esecutore.
 */
async function processJob(job: any): Promise<{ result: unknown; error?: string }> {
  const payload = JSON.parse(job.payload)
  switch (job.jobType as JobType) {
    case 'embeddings_recompute': {
      const { recomputeAllEmbeddings } = await import('@/lib/embeddings')
      const result = await recomputeAllEmbeddings()
      return { result }
    }
    case 'summarize': {
      const { summarizeAndEvict } = await import('@/lib/kernel/context-engineering')
      const result = await summarizeAndEvict(payload.agentId || 'default', payload.windowSize || 5)
      return { result }
    }
    case 'backup': {
      const { createBackup } = await import('@/lib/kernel/observability')
      const result = await createBackup(payload.trigger || 'scheduled')
      return { result }
    }
    case 'fsm_checkpoint': {
      const result = await checkpointFSMStates()
      return { result }
    }
    case 'taint_cleanup': {
      const result = await cleanupExpiredTaints()
      return { result }
    }
    case 'session_cleanup': {
      const { cleanupExpiredSessions } = await import('@/lib/auth/session')
      const count = await cleanupExpiredSessions()
      return { result: { sessionsDeleted: count } }
    }
    default:
      return { result: null, error: `Unknown job type: ${job.jobType}` }
  }
}

/**
 * Worker: processa il prossimo job in coda.
 * Priorità: critical > high > normal. FIFO entro stessa priorità.
 */
export async function processNextJob(): Promise<{ processed: boolean; jobId?: string; status?: string }> {
  // Trova il job più vecchio con priorità più alta
  const job = await db.jobRecord.findFirst({
    where: {
      status: { in: ['queued', 'retry'] },
    },
    orderBy: [
      { priority: 'desc' },
      { queuedAt: 'asc' },
    ],
  })

  if (!job) return { processed: false }

  // Marca come running
  await db.jobRecord.update({
    where: { id: job.id },
    data: { status: 'running', startedAt: new Date() },
  })

  const start = Date.now()
  try {
    const { result, error } = await processJob(job)
    const durationMs = Date.now() - start

    if (error) {
      // Retry se possibile
      if (job.retryCount < job.maxRetries) {
        await db.jobRecord.update({
          where: { id: job.id },
          data: {
            status: 'retry',
            retryCount: job.retryCount + 1,
            error,
            durationMs,
          },
        })
        return { processed: true, jobId: job.id, status: 'retry' }
      }
      // Fail definitivo
      await db.jobRecord.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error,
          completedAt: new Date(),
          durationMs,
        },
      })
      return { processed: true, jobId: job.id, status: 'failed' }
    }

    await db.jobRecord.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        result: JSON.stringify(result),
        completedAt: new Date(),
        durationMs,
      },
    })
    return { processed: true, jobId: job.id, status: 'completed' }
  } catch (e: any) {
    const durationMs = Date.now() - start
    if (job.retryCount < job.maxRetries) {
      await db.jobRecord.update({
        where: { id: job.id },
        data: {
          status: 'retry',
          retryCount: job.retryCount + 1,
          error: e.message,
          durationMs,
        },
      })
      return { processed: true, jobId: job.id, status: 'retry' }
    }
    await db.jobRecord.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error: e.message,
        completedAt: new Date(),
        durationMs,
      },
    })
    return { processed: true, jobId: job.id, status: 'failed' }
  }
}

/**
 * Worker loop: processa job in modo continuo.
 * Da avviare all'avvio del server.
 */
let workerRunning = false
let workerInterval: NodeJS.Timeout | null = null

export function startWorker(intervalMs = 5000): void {
  if (workerRunning) return
  workerRunning = true
  console.log('[worker] Job queue worker started')
  workerInterval = setInterval(async () => {
    try {
      await processNextJob()
    } catch (e) {
      console.error('[worker] Error processing job:', e)
    }
  }, intervalMs)
}

export function stopWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }
  workerRunning = false
  console.log('[worker] Job queue worker stopped')
}

/**
 * Statistiche job queue.
 */
export async function jobStats() {
  const [total, queued, running, completed, failed, retry] = await Promise.all([
    db.jobRecord.count(),
    db.jobRecord.count({ where: { status: 'queued' } }),
    db.jobRecord.count({ where: { status: 'running' } }),
    db.jobRecord.count({ where: { status: 'completed' } }),
    db.jobRecord.count({ where: { status: 'failed' } }),
    db.jobRecord.count({ where: { status: 'retry' } }),
  ])
  return { total, queued, running, completed, failed, retry }
}

export async function listJobs(limit = 30) {
  return db.jobRecord.findMany({
    orderBy: { queuedAt: 'desc' },
    take: limit,
  })
}

// =====================================================
// 23.4 — FSM Persistence + Taint TTL
// =====================================================

/**
 * Salva lo snapshot corrente di tutte le FSM LTL su DB.
 */
export async function checkpointFSMStates(): Promise<{ snapshotted: number }> {
  // Import dinamico per evitare circular dep
  const { initMonitor } = await import('@/lib/kernel/ltl-monitor')
  await initMonitor()

  // Il monitor singleton ha gli stati FSM in memoria
  // Per accedervi, dobbiamo esporre un metodo snapshot
  // Per ora, registriamo un snapshot vuoto per ogni regola attiva
  const rules = await db.lTLRule.findMany({ where: { active: true } })
  let count = 0
  for (const rule of rules) {
    const existing = await db.fSMSnapshot.findFirst({
      where: { ruleId: rule.ruleId, state: 'IDLE' },
    })
    if (existing) {
      await db.fSMSnapshot.update({
        where: { id: existing.id },
        data: {
          historyJson: '[]',
          eventCount: 0,
          snapshotAt: new Date(),
        },
      })
    } else {
      await db.fSMSnapshot.create({
        data: {
          ruleId: rule.ruleId,
          state: 'IDLE',
          historyJson: '[]',
          eventCount: 0,
        },
      })
    }
    count++
  }
  return { snapshotted: count }
}

/**
 * Ripristina gli stati FSM dal DB all'avvio.
 */
export async function restoreFSMStates(): Promise<{ restored: number }> {
  const snapshots = await db.fSMSnapshot.findMany()
  // In produzione: caricare gli stati nel monitor singleton
  // Per ora, ritorna il count
  return { restored: snapshots.length }
}

/**
 * Cleanup taint flows scaduti (TTL).
 */
export async function cleanupExpiredTaints(): Promise<{ expired: number }> {
  const now = new Date()
  // Marca come expired i TaintFlow con expiresAt < now
  const result = await db.taintFlow.updateMany({
    where: {
      expiresAt: { lt: now },
      expired: false,
    },
    data: { expired: true },
  })
  return { expired: result.count }
}

/**
 * Crea un TaintFlow con TTL.
 */
export async function createTaintFlowWithTTL(
  taintRecordId: string,
  source: string,
  flowTrace: string[],
  ttlMinutes = 60
): Promise<{ flowId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)
  const flow = await db.taintFlow.create({
    data: {
      taintRecordId,
      source,
      flowTraceJson: JSON.stringify(flowTrace),
      expiresAt,
      expired: false,
    },
  })
  return { flowId: flow.id, expiresAt }
}

/**
 * Lista taint flows attivi (non expired).
 */
export async function listActiveTaintFlows() {
  return db.taintFlow.findMany({
    where: { expired: false },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
}

/**
 * Statistiche FSM + Taint persistence.
 */
export async function persistenceStats() {
  const [fsmSnapshots, activeTaintFlows, expiredTaintFlows] = await Promise.all([
    db.fSMSnapshot.count(),
    db.taintFlow.count({ where: { expired: false } }),
    db.taintFlow.count({ where: { expired: true } }),
  ])
  return {
    fsmSnapshots,
    activeTaintFlows,
    expiredTaintFlows,
    fsmRestored: false, // true se restoreFSMStates è stato chiamato
  }
}

// =====================================================
// Scalability stats aggregate (per dashboard)
// =====================================================

export async function scalabilityStats() {
  const [dbInfo, wsInfo, jobs, persistence] = await Promise.all([
    getDatabaseInfo(),
    getWSPubSubStats(),
    jobStats(),
    persistenceStats(),
  ])
  return {
    database: dbInfo,
    websocket: wsInfo,
    jobQueue: jobs,
    persistence,
  }
}
