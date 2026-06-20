/**
 * API: /api/dashboard
 * Aggrega metriche per il dashboard overview (9 fasi).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { memoryStats } from '@/lib/kernel/ns-mem'
import { contextStats } from '@/lib/kernel/context-engineering'
import { dominatorStats } from '@/lib/kernel/dominator-tree'
import { leanStats } from '@/lib/kernel/lean4-agent'
import { retainerStats } from '@/lib/kernel/artificial-retainer'

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
    phase6Stats, phase7Stats, phase8Stats, phase9Stats,
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
    contextStats(),
    dominatorStats(),
    leanStats(),
    retainerStats(),
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
    phase6: phase6Stats,
    phase7: phase7Stats,
    phase8: phase8Stats,
    phase9: phase9Stats,
    recentLogs,
    agentLogsTotal: agentLogs,
    memoryStats: await memoryStats(),
  })
}
