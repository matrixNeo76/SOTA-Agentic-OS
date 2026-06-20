/**
 * API: /api/dashboard
 * Aggrega metriche per il dashboard overview.
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { memoryStats } from '@/lib/kernel/ns-mem'

export async function GET() {
  const [
    episodic, semantic, logical,
    patches, accepted, rejected,
    plans, planTasks,
    compiledArtifacts, deployedArtifacts,
    steeringEvents,
    verificationEvents, verifRejects, verifWarns,
    taintRecords, blockedTaints,
    heuristics, reflections, redLineFlags,
    agentLogs,
  ] = await Promise.all([
    db.episodicMemory.count(),
    db.semanticEntity.count(),
    db.logicalRule.count(),
    db.patchTransaction.count(),
    db.patchTransaction.count({ where: { status: 'accepted' } }),
    db.patchTransaction.count({ where: { status: 'rejected' } }),
    db.agentPlan.count(),
    db.planTask.count(),
    db.compiledArtifact.count(),
    db.compiledArtifact.count({ where: { deployed: true } }),
    db.steeringEvent.count(),
    db.verificationEvent.count(),
    db.verificationEvent.count({ where: { verdict: 'reject' } }),
    db.verificationEvent.count({ where: { verdict: 'warn' } }),
    db.taintRecord.count(),
    db.taintRecord.count({ where: { blocked: true } }),
    db.heuristic.count(),
    db.reflectionLog.count(),
    db.reflectionLog.count({ where: { redLineFlag: true } }),
    db.agentLog.count(),
  ])

  const recentLogs = await db.agentLog.findMany({
    orderBy: { timestamp: 'desc' }, take: 10,
  })

  return NextResponse.json({
    phase1: { episodic, semantic, logical, patches, accepted, rejected },
    phase2: { plans, planTasks, compiledArtifacts, deployedArtifacts },
    phase3: { steeringEvents },
    phase4: { verificationEvents, verifRejects, verifWarns, taintRecords, blockedTaints },
    phase5: { heuristics, reflections, redLineFlags },
    recentLogs,
    agentLogsTotal: agentLogs,
    memoryStats: await memoryStats(),
  })
}
