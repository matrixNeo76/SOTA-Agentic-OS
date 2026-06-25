/**
 * Fase 22.1: Error Tracking — collector con deduplicazione
 *
 * Intercetta errori non gestiti (kernel, API, UI) con stack trace,
 * deduplica per fingerprint, arricchisce con contesto.
 */
import { db } from '@/lib/db'
import { createHash } from 'crypto'

export type ErrorInput = {
  message: string
  stack?: string
  source: 'kernel' | 'api' | 'ui'
  phase?: string
  userId?: string
  tenantId?: string
  context?: Record<string, unknown>
}

/**
 * Calcola fingerprint per deduplicazione: hash di message + source + phase.
 */
function computeFingerprint(input: ErrorInput): string {
  const data = `${input.message}|${input.source}|${input.phase || ''}`
  return createHash('sha256').update(data).digest('hex').slice(0, 32)
}

/**
 * Registra un errore. Se esiste già (stessa fingerprint), incrementa count e aggiorna lastSeen.
 */
export async function recordError(input: ErrorInput): Promise<{ errorId: string; isNew: boolean; count: number }> {
  const fingerprint = computeFingerprint(input)
  const existing = await db.errorRecord.findUnique({ where: { fingerprint } })

  if (existing) {
    const updated = await db.errorRecord.update({
      where: { id: existing.id },
      data: {
        count: existing.count + 1,
        lastSeen: new Date(),
        context: input.context ? JSON.stringify(input.context) : existing.context,
      },
    })
    return { errorId: updated.id, isNew: false, count: updated.count }
  }

  const error = await db.errorRecord.create({
    data: {
      fingerprint,
      message: input.message,
      stack: input.stack || null,
      source: input.source,
      phase: input.phase || null,
      userId: input.userId || null,
      tenantId: input.tenantId || null,
      context: input.context ? JSON.stringify(input.context) : null,
      status: 'open',
      count: 1,
    },
  })
  return { errorId: error.id, isNew: true, count: 1 }
}

/**
 * Risolvi un errore (cambia status).
 */
export async function resolveError(errorId: string, resolvedBy: string, status: 'acknowledged' | 'resolved' = 'resolved'): Promise<void> {
  await db.errorRecord.update({
    where: { id: errorId },
    data: {
      status,
      resolvedAt: new Date(),
      resolvedBy,
    },
  })
}

/**
 * Lista errori con filtri.
 */
export async function listErrors(filters?: {
  status?: string
  source?: string
  limit?: number
}): Promise<any[]> {
  return db.errorRecord.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.source ? { source: filters.source } : {}),
    },
    orderBy: { lastSeen: 'desc' },
    take: filters?.limit || 50,
  })
}

/**
 * Statistiche errori.
 */
export async function errorStats() {
  const [total, open, acknowledged, resolved, recent] = await Promise.all([
    db.errorRecord.count(),
    db.errorRecord.count({ where: { status: 'open' } }),
    db.errorRecord.count({ where: { status: 'acknowledged' } }),
    db.errorRecord.count({ where: { status: 'resolved' } }),
    db.errorRecord.count({
      where: { lastSeen: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ])
  return { total, open, acknowledged, resolved, recent24h: recent }
}

// =====================================================
// Fase 22.2: Metrics
// =====================================================

type MetricEntry = {
  name: string
  value: number
  labels: Record<string, string>
  timestamp: number
}

const metricsBuffer: MetricEntry[] = []
const MAX_BUFFER = 1000

/**
 * Registra una metrica (in-memory buffer per poi esportare).
 */
export function recordMetric(name: string, value: number, labels: Record<string, string> = {}) {
  metricsBuffer.push({ name, value, labels, timestamp: Date.now() })
  if (metricsBuffer.length > MAX_BUFFER) {
    metricsBuffer.splice(0, metricsBuffer.length - MAX_BUFFER)
  }
}

/**
 * Esporta metriche in formato Prometheus text.
 */
export function exportMetricsPrometheus(): string {
  const lines: string[] = []
  const grouped = new Map<string, MetricEntry[]>()

  for (const m of metricsBuffer) {
    const key = m.name
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(m)
  }

  for (const [name, entries] of grouped) {
    // HELP line
    lines.push(`# HELP ${name} Metric from SOTA Agentic OS`)
    lines.push(`# TYPE ${name} gauge`)

    // Ultimo valore per ogni combinazione di labels
    const latest = new Map<string, MetricEntry>()
    for (const e of entries) {
      const labelKey = JSON.stringify(e.labels)
      if (!latest.has(labelKey) || e.timestamp > latest.get(labelKey)!.timestamp) {
        latest.set(labelKey, e)
      }
    }

    for (const [, e] of latest) {
      const labelStr = Object.entries(e.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      lines.push(labelStr ? `${name}{${labelStr}} ${e.value}` : `${name} ${e.value}`)
    }
  }

  return lines.join('\n')
}

/**
 * Statistiche metriche per dashboard.
 */
export function metricStats() {
  const names = new Set(metricsBuffer.map(m => m.name))
  return {
    totalMetrics: metricsBuffer.length,
    uniqueNames: names.size,
    names: Array.from(names),
  }
}

// =====================================================
// Fase 22.3: Distributed Tracing
// =====================================================

import { randomBytes as cryptoRandomBytes } from 'crypto'

/**
 * Genera un traceId unico.
 */
export function generateTraceId(): string {
  return cryptoRandomBytes(16).toString('hex')
}

/**
 * Genera uno spanId unico.
 */
export function generateSpanId(): string {
  return cryptoRandomBytes(8).toString('hex')
}

/**
 * Crea e registra uno span.
 */
export async function recordSpan(params: {
  traceId: string
  spanId: string
  parentSpanId?: string
  operation: string
  phase?: string
  userId?: string
  status?: 'ok' | 'error'
  durationMs: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  await db.traceSpan.create({
    data: {
      traceId: params.traceId,
      spanId: params.spanId,
      parentSpanId: params.parentSpanId || null,
      operation: params.operation,
      phase: params.phase || null,
      userId: params.userId || null,
      status: params.status || 'ok',
      durationMs: params.durationMs,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}

/**
 * Helper: misura il tempo di un'operazione e registra lo span.
 */
export async function traced<T>(
  operation: string,
  fn: (spanId: string, traceId: string) => Promise<T>,
  options?: {
    traceId?: string
    parentSpanId?: string
    phase?: string
    userId?: string
  }
): Promise<T> {
  const traceId = options?.traceId || generateTraceId()
  const spanId = generateSpanId()
  const start = Date.now()
  let status: 'ok' | 'error' = 'ok'
  try {
    const result = await fn(spanId, traceId)
    return result
  } catch (e) {
    status = 'error'
    throw e
  } finally {
    const durationMs = Date.now() - start
    await recordSpan({
      traceId,
      spanId,
      parentSpanId: options?.parentSpanId,
      operation,
      phase: options?.phase,
      userId: options?.userId,
      status,
      durationMs,
    })
    // Registra anche metrica
    recordMetric(`trace_${operation}_duration_ms`, durationMs, { status })
  }
}

/**
 * Recupera trace complete per un traceId.
 */
export async function getTrace(traceId: string) {
  return db.traceSpan.findMany({
    where: { traceId },
    orderBy: { timestamp: 'asc' },
  })
}

/**
 * Lista trace recenti.
 */
export async function listTraces(limit = 20) {
  // Group by traceId, prendi il primo span di ogni trace
  const spans = await db.traceSpan.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit * 10, // prendi più span per poi raggruppare
  })
  const traceMap = new Map<string, { traceId: string; spanCount: number; status: string; durationMs: number; firstOp: string; timestamp: Date }>()
  for (const s of spans) {
    if (!traceMap.has(s.traceId)) {
      traceMap.set(s.traceId, {
        traceId: s.traceId,
        spanCount: 1,
        status: s.status,
        durationMs: s.durationMs,
        firstOp: s.operation,
        timestamp: s.timestamp,
      })
    } else {
      const t = traceMap.get(s.traceId)!
      t.spanCount++
      t.durationMs += s.durationMs
      if (s.status === 'error') t.status = 'error'
    }
  }
  return Array.from(traceMap.values()).slice(0, limit)
}

/**
 * Statistiche tracing.
 */
export async function traceStats() {
  const [totalSpans, totalTraces, errorSpans] = await Promise.all([
    db.traceSpan.count(),
    db.traceSpan.groupBy({ by: ['traceId'], _count: true }),
    db.traceSpan.count({ where: { status: 'error' } }),
  ])
  return {
    totalSpans,
    totalTraces: totalTraces.length,
    errorSpans,
  }
}

// =====================================================
// Fase 22.4: Backup Scheduler
// =====================================================

import * as fs from 'fs'
import * as path from 'path'

// C0 — Derive from cwd instead of hardcoded /home/z/my-project.
const DB_PATH = path.join(process.cwd(), 'db', 'custom.db')
const BACKUP_DIR = path.join(process.cwd(), 'db', 'backups')

/**
 * Crea un backup del database.
 */
export async function createBackup(trigger: 'manual' | 'scheduled' = 'manual'): Promise<{
  backupId: string
  filePath: string
  sizeBytes: number
  checksum: string
}> {
  // Assicura directory backup
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `custom-${timestamp}.db`
  const filePath = path.join(BACKUP_DIR, fileName)

  // Copia DB
  fs.copyFileSync(DB_PATH, filePath)

  // Calcola checksum
  const fileBuffer = fs.readFileSync(filePath)
  const checksum = createHash('sha256').update(fileBuffer).digest('hex')
  const sizeBytes = fs.statSync(filePath).size

  // Registra nel DB
  const record = await db.backupRecord.create({
    data: {
      filePath,
      sizeBytes,
      checksum,
      status: 'created',
      trigger,
    },
  })

  // Verifica (apri e controlla)
  try {
    // Test: leggi primi 100 bytes per verificare che non sia corrotto
    const testBuf = Buffer.alloc(100)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, testBuf, 0, 100, 0)
    fs.closeSync(fd)
    await db.backupRecord.update({
      where: { id: record.id },
      data: { status: 'verified', verifiedAt: new Date() },
    })
  } catch (e) {
    await db.backupRecord.update({
      where: { id: record.id },
      data: { status: 'failed' },
    })
    throw e
  }

  // Retention: mantieni solo gli ultimi 7 backup
  const backups = await db.backupRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const toDelete = backups.slice(7)
  for (const b of toDelete) {
    try {
      if (fs.existsSync(b.filePath)) fs.unlinkSync(b.filePath)
      await db.backupRecord.delete({ where: { id: b.id } })
    } catch {}
  }

  return {
    backupId: record.id,
    filePath,
    sizeBytes,
    checksum,
  }
}

/**
 * Lista backup.
 */
export async function listBackups() {
  return db.backupRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}

/**
 * Statistiche backup.
 */
export async function backupStats() {
  const [total, verified, failed, lastBackup] = await Promise.all([
    db.backupRecord.count(),
    db.backupRecord.count({ where: { status: 'verified' } }),
    db.backupRecord.count({ where: { status: 'failed' } }),
    db.backupRecord.findFirst({ orderBy: { createdAt: 'desc' } }),
  ])
  return {
    total,
    verified,
    failed,
    lastBackupAt: lastBackup?.createdAt || null,
    lastBackupSize: lastBackup?.sizeBytes || 0,
  }
}

/**
 * Scheduler: avvia backup automatici ogni 6 ore.
 * Da chiamare all'avvio del server.
 */
let backupInterval: NodeJS.Timeout | null = null

export function startBackupScheduler(intervalHours = 6): void {
  if (backupInterval) clearInterval(backupInterval)
  const intervalMs = intervalHours * 60 * 60 * 1000
  backupInterval = setInterval(async () => {
    try {
      console.log('[backup] Scheduled backup starting...')
      await createBackup('scheduled')
      console.log('[backup] Scheduled backup completed')
    } catch (e) {
      console.error('[backup] Scheduled backup failed:', e)
    }
  }, intervalMs)
  console.log(`[backup] Scheduler started: every ${intervalHours}h`)
}

export function stopBackupScheduler(): void {
  if (backupInterval) {
    clearInterval(backupInterval)
    backupInterval = null
    console.log('[backup] Scheduler stopped')
  }
}
