/**
 * API: /api/sensorium
 * GET  - produce e ritorna il Sensorium per il ciclo corrente
 */
import { NextResponse } from 'next/server'
import { produceSensorium } from '@/lib/kernel/curator'
import { db } from '@/lib/db'

export async function GET() {
  const { data, xml } = await produceSensorium()
  await db.agentLog.create({
    data: {
      agentId: 'curator',
      phase: '1',
      event: 'sensorium_compiled',
      payload: JSON.stringify({ cycleId: data.cycleId }),
    },
  })
  return NextResponse.json({ data, xml })
}

export async function DELETE() {
  await db.sensoriumSnapshot.deleteMany({})
  return NextResponse.json({ ok: true })
}
