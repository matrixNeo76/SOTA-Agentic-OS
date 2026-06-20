'use client'

import { useEffect, useState } from 'react'

type DashboardData = {
  phase1: { episodic: number; semantic: number; logical: number; patches: number; accepted: number; rejected: number }
  phase2: { plans: number; planTasks: number; compiledArtifacts: number; deployedArtifacts: number }
  phase3: { steeringEvents: number }
  phase4: { verificationEvents: number; verifRejects: number; verifWarns: number; taintRecords: number; blockedTaints: number }
  phase5: { heuristics: number; reflections: number; redLineFlags: number }
  phase6: { activeCalls: number; evictedCalls: number; summaries: number; totalTokensSaved: number }
  phase7: { traces: number; ptas: number; validations: number; avgCoverage: number; acceptRate: number }
  phase8: { contracts: number; verifiedContracts: number; verifiedWorkflows: number; deployedWorkflows: number; evolveEvents: number; successfulEvolve: number }
  phase9: { activeDelegations: number; totalDelegations: number; pendingGates: number; resolvedGates: number; approvedGates: number; rejectedGates: number; auditEntries: number; normativeResolutions: number; blockedResolutions: number }
  phase10: { sessions: number; executed: number; sandboxBlocked: number; policies: number }
  phase11: { samples: number; agents: number; interventions: number; avgDesperation: number; avgFrustration: number }
  phase12: { trees: number; nodes: number; completedTrees: number; passNodes: number; failNodes: number }
  phase13: { beliefs: number; syncEvents: number; conflicts: number; quorumDecisions: number; acceptedQuorum: number; rejectedQuorum: number }
  phase14: { decisions: number; ensemble: number; critic: number; primary: number; topModel: string; topModelPct: number }
  recentLogs: { id: string; agentId: string; phase: string; event: string; level: string; timestamp: string }[]
  agentLogsTotal: number
  memoryStats: { episodic: number; semantic: number; logical: number; avgDecay: number }
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const r = await fetch('/api/dashboard')
      const d = await r.json()
      setData(d)
    } catch (e) {
      console.error('dashboard fetch failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])

  return { data, loading, refresh }
}
