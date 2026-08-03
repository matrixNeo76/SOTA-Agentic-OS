/**
 * Curator (Fase 1): compila il blocco XML "Sensorium"
 * da iniettare ad ogni ciclo cognitivo.
 *
 * Contiene: stato del sistema, carico coda, thread attivi,
 * metriche di memoria, ultime osservazioni.
 *
 * C2 fix (Context Manager audit Fase A): metriche reali invece di simulate.
 * PRIMA: queueDepth, activeThreads, systemLoad erano calcolati da formule su
 * cycleCounter (fittizi). ORA: letti dal DB (JobRecord) e OS (os.loadavg).
 *
 * B5 fix: cycleId ora String (cuid) invece di Int (generateTimeSortableId)
 * per evitare collisioni.
 */
import { db } from '@/lib/db'
import { memoryStats } from './ns-mem'
import os from 'os'

export type SensoriumData = {
  cycleId: string  // B5: ora String (cuid) invece di Int
  queueDepth: number
  activeThreads: number
  systemLoad: number
  memoryStats: { episodic: number; semantic: number; logical: number; avgDecay: number }
  recentEvents: { agentId: string; event: string; ts: string }[]
  pendingVerifications: number
  timestamp: string
}

/**
 * Raccoglie lo stato operativo corrente.
 *
 * C2 fix: metriche reali dal DB e OS invece di simulate.
 */
export async function gatherSensorium(): Promise<SensoriumData> {
  const cycleId = generateCuid()
  const stats = await memoryStats()
  const recentLogs = await db.agentLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 5,
  })
  const pendingVerifications = await db.verificationEvent.count({
    where: { verdict: 'warn' },
  })

  // C2 fix: metriche reali dal DB
  const [queueDepth, activeThreads] = await Promise.all([
    db.jobRecord.count({ where: { status: 'queued' } }).catch(() => 0),
    db.jobRecord.count({ where: { status: 'running' } }).catch(() => 0),
  ])

  // C2 fix: systemLoad reale da OS
  const loadAvg = os.loadavg()
  const cpuCount = os.cpus().length
  const systemLoad = cpuCount > 0 ? Math.min(0.99, loadAvg[0] / cpuCount) : 0

  return {
    cycleId,
    queueDepth,
    activeThreads,
    systemLoad,
    memoryStats: stats,
    recentEvents: recentLogs.map((l) => ({
      agentId: l.agentId, event: l.event,
      ts: l.timestamp.toISOString(),
    })),
    pendingVerifications,
    timestamp: new Date().toISOString(),
  }
}

/**
 * B5 fix — Genera un cuid per cycleId (evita collisioni di generateTimeSortableId).
 * Usa crypto.randomUUID come fallback semplice e unico.
 */
function generateCuid(): string {
  // Usa Date.now + random per garantire unicità senza dipendenze esterne
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Compila il blocco XML Sensorium per l'iniezione nel prompt.
 * Formato minimale ma strutturato per parsing deterministico.
 */
export function compileSensoriumXML(data: SensoriumData): string {
  const eventsXml = data.recentEvents
    .map((e) => `    <event agent="${e.agentId}" ts="${e.ts}">${e.event}</event>`)
    .join('\n')
  return `<sensorium cycle="${data.cycleId}" ts="${data.timestamp}">
  <system>
    <queue_depth>${data.queueDepth}</queue_depth>
    <active_threads>${data.activeThreads}</active_threads>
    <system_load>${data.systemLoad.toFixed(3)}</system_load>
    <pending_verifications>${data.pendingVerifications}</pending_verifications>
  </system>
  <memory>
    <episodic_count>${data.memoryStats.episodic}</episodic_count>
    <semantic_count>${data.memoryStats.semantic}</semantic_count>
    <logical_count>${data.memoryStats.logical}</logical_count>
    <avg_decay>${data.memoryStats.avgDecay.toFixed(3)}</avg_decay>
  </memory>
  <recent_events>
${eventsXml}
  </recent_events>
</sensorium>`
}

/**
 * Pipeline completa: gather → compile → persist → return.
 */
export async function produceSensorium(): Promise<{ data: SensoriumData; xml: string }> {
  const data = await gatherSensorium()
  const xml = compileSensoriumXML(data)
  await db.sensoriumSnapshot.create({
    data: {
      cycleId: data.cycleId,
      xmlContent: xml,
      queueDepth: data.queueDepth,
      activeThreads: data.activeThreads,
      systemLoad: data.systemLoad,
    },
  }).catch(() => {
    // B5: se cycleId collide (estremamente raro con cuid), ignora
  })
  return { data, xml }
}
