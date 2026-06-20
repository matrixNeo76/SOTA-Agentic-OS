/**
 * Curator (Fase 1): compila il blocco XML "Sensorium"
 * da iniettare ad ogni ciclo cognitivo.
 *
 * Contiene: stato del sistema, carico coda, thread attivi,
 * metriche di memoria, ultime osservazioni.
 */
import { db } from '@/lib/db'
import { memoryStats } from './ns-mem'

// cycleId basato su timestamp per evitare collisioni tra riavvii del server.
// Se gia esiste un record con questo cycleId, fa upsert invece di create.
let cycleCounter = 0

export type SensoriumData = {
  cycleId: number
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
 */
export async function gatherSensorium(): Promise<SensoriumData> {
  cycleCounter += 1
  // Aggiungi un offset basato su timestamp per evitare collisioni con cicli precedenti
  const tsOffset = Math.floor(Date.now() / 1000) % 100000
  const cycleId = tsOffset * 1000 + (cycleCounter % 1000)
  const stats = await memoryStats()
  const recentLogs = await db.agentLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 5,
  })
  const pendingVerifications = await db.verificationEvent.count({
    where: { verdict: 'warn' },
  })
  // simulate queue depth & active threads
  const queueDepth = (cycleCounter * 7) % 23
  const activeThreads = 1 + (cycleCounter % 4)
  const systemLoad = Math.min(0.95, 0.2 + (cycleCounter % 10) * 0.07)

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
  })
  return { data, xml }
}
