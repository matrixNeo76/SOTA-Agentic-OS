/**
 * API: /api/cockpit (Fase 15 - Plancia di comando)
 * Aggrega dati per i 5 tab del Cockpit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listNarratives } from '@/lib/kernel/sovereign-translator'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tab = searchParams.get('tab') || 'all'

  if (tab === 'narrative') {
    const items = await listNarratives(50)
    return NextResponse.json({ items })
  }

  if (tab === 'log') {
    const logs = await db.agentLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100,
    })
    return NextResponse.json({ logs })
  }

  if (tab === 'scheduler') {
    const tasks = await db.planTask.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { plan: true },
    })
    return NextResponse.json({ tasks })
  }

  if (tab === 'cycles') {
    const [snapshots, steeringEvents] = await Promise.all([
      db.sensoriumSnapshot.findMany({ orderBy: { timestamp: 'desc' }, take: 20 }),
      db.steeringEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 30 }),
    ])
    return NextResponse.json({ snapshots, steeringEvents })
  }

  if (tab === 'safety') {
    const [ltlRules, pendingGates, taintRecords, blockedActions] = await Promise.all([
      db.lTLRule.findMany({ where: { active: true } }),
      db.approvalGate.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      db.taintRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      db.blockedAction.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ])
    return NextResponse.json({ ltlRules, pendingGates, taintRecords, blockedActions })
  }

  // default: aggregate all tabs (compact)
  const [narratives, recentLogs, schedulerTasks, recentSnapshots, safetyPending] = await Promise.all([
    listNarratives(10),
    db.agentLog.findMany({ orderBy: { timestamp: 'desc' }, take: 20 }),
    db.planTask.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { plan: true } }),
    db.sensoriumSnapshot.findMany({ orderBy: { timestamp: 'desc' }, take: 5 }),
    db.blockedAction.count({ where: { status: 'pending' } }),
  ])

  return NextResponse.json({
    narratives,
    recentLogs,
    schedulerTasks,
    recentSnapshots,
    safetyPendingCount: safetyPending,
  })
}
