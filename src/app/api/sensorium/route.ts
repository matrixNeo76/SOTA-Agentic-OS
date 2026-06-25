/**
 * API: /api/sensorium
 * GET  - produce e ritorna il Sensorium per il ciclo corrente (e pubblica su WS)
 */
import { NextRequest, NextResponse } from 'next/server'
import { produceSensorium } from '@/lib/kernel/curator'
import { db } from '@/lib/db'
import { publishSensorium, publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { data, xml } = await produceSensorium()
  await db.agentLog.create({
    data: {
      agentId: 'curator',
      phase: '1',
      event: 'sensorium_compiled',
      payload: JSON.stringify({ cycleId: data.cycleId }),
    },
  })
  // Broadcast live via WebSocket
  await publishSensorium({
    cycleId: data.cycleId,
    xml,
    queueDepth: data.queueDepth,
    activeThreads: data.activeThreads,
    systemLoad: data.systemLoad,
  })
  await publishAgentEvent({
    agentId: 'curator', phase: '1',
    event: 'sensorium_compiled',
    payload: { cycleId: data.cycleId },
  })
  return NextResponse.json({ data, xml })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  await db.sensoriumSnapshot.deleteMany({})
  return NextResponse.json({ ok: true })
}
