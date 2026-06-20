/**
 * API: /api/dashboard
 * Aggrega metriche per il dashboard overview (14 fasi).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { memoryStats } from '@/lib/kernel/ns-mem'
import { contextStats } from '@/lib/kernel/context-engineering'
import { dominatorStats } from '@/lib/kernel/dominator-tree'
import { leanStats } from '@/lib/kernel/lean4-agent'
import { retainerStats } from '@/lib/kernel/artificial-retainer'
import { groundingStats } from '@/lib/kernel/grounded-inference'
import { affectStats } from '@/lib/kernel/affect-subsystem'
import { objectiveStats } from '@/lib/kernel/agent-objective'
import { esrStats } from '@/lib/kernel/esr-quorum'
import { routerStats } from '@/lib/kernel/time-router'
import { toolStats } from '@/lib/kernel/tool-registry'
import { blockedStats } from '@/lib/kernel/sovereign-translator'
import { errorStats, traceStats, backupStats, metricStats } from '@/lib/kernel/observability'
import { scalabilityStats } from '@/lib/kernel/scalability'

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
    phase10Stats, phase11Stats, phase12Stats, phase13Stats, phase14Stats,
    toolStatsData, blockedStatsData,
    errorStatsData, traceStatsData, backupStatsData, metricStatsData,
    scalabilityStatsData,
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
    groundingStats(),
    affectStats(),
    objectiveStats(),
    esrStats(),
    routerStats(),
    toolStats(),
    blockedStats(),
    errorStats(),
    traceStats(),
    backupStats(),
    Promise.resolve(metricStats()),
    scalabilityStats(),
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
    phase10: phase10Stats,
    phase11: phase11Stats,
    phase12: phase12Stats,
    phase13: phase13Stats,
    phase14: phase14Stats,
    tools: toolStatsData,
    blocked: blockedStatsData,
    observability: {
      errors: errorStatsData,
      traces: traceStatsData,
      backups: backupStatsData,
      metrics: metricStatsData,
    },
    scalability: scalabilityStatsData,
    recentLogs,
    agentLogsTotal: agentLogs,
    memoryStats: await memoryStats(),
  })
}
