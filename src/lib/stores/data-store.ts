import { create } from 'zustand'

export type DashboardData = {
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

export type LogEntry = { id: string; agentId: string; phase: string; event: string; payload: string | null; level: string; timestamp: string }

const TTL = { dashboard: 5000, blocked: 10000, cost: 30000, affect: 5000, logs: 10000 } as const
function isFresh(last: number, ttl: number): boolean { return Date.now() - last < ttl }

type DataState = {
  dashboard: DashboardData | null; dashboardLoading: boolean; dashboardLastFetch: number
  fetchDashboard: (force?: boolean) => Promise<DashboardData | null>
  blockedPending: any[]; blockedRecent: any[]; blockedLoading: boolean; blockedLastFetch: number
  fetchBlocked: (force?: boolean) => Promise<any>
  cost: any; costLoading: boolean; costLastFetch: number
  fetchCost: (force?: boolean) => Promise<any>
  affect: any; affectLoading: boolean; affectLastFetch: number
  fetchAffect: (force?: boolean) => Promise<any>
  logs: LogEntry[]; logsLoading: boolean; logsLastFetch: number
  fetchLogs: (force?: boolean) => Promise<LogEntry[] | null>
  refreshAll: () => Promise<void>
}

export const useDataStore = create<DataState>((set, get) => ({
  dashboard: null, dashboardLoading: false, dashboardLastFetch: 0,
  fetchDashboard: async (force = false) => {
    const s = get()
    if (!force && s.dashboard && isFresh(s.dashboardLastFetch, TTL.dashboard)) return s.dashboard
    if (s.dashboardLoading) { await new Promise(r => setTimeout(r, 100)); return get().dashboard }
    set({ dashboardLoading: true })
    try { const r = await fetch('/api/dashboard'); if (!r.ok) throw new Error(); const d = await r.json() as DashboardData; set({ dashboard: d, dashboardLastFetch: Date.now(), dashboardLoading: false }); return d }
    catch { set({ dashboardLoading: false }); return s.dashboard }
  },
  blockedPending: [], blockedRecent: [], blockedLoading: false, blockedLastFetch: 0,
  fetchBlocked: async (force = false) => {
    const s = get()
    if (!force && s.blockedLastFetch > 0 && isFresh(s.blockedLastFetch, TTL.blocked)) return { pending: s.blockedPending, recent: s.blockedRecent }
    if (s.blockedLoading) { await new Promise(r => setTimeout(r, 100)); return { pending: get().blockedPending, recent: get().blockedRecent } }
    set({ blockedLoading: true })
    try { const [p, a] = await Promise.all([fetch('/api/blocked-actions?action=pending'), fetch('/api/blocked-actions?action=all')]); const pending = (await p.json()).actions || []; const all = (await a.json()).actions || []; set({ blockedPending: pending, blockedRecent: all, blockedLastFetch: Date.now(), blockedLoading: false }); return { pending, recent: all } }
    catch { set({ blockedLoading: false }); return { pending: s.blockedPending, recent: s.blockedRecent } }
  },
  cost: null, costLoading: false, costLastFetch: 0,
  fetchCost: async (force = false) => {
    const s = get()
    if (!force && s.cost && isFresh(s.costLastFetch, TTL.cost)) return s.cost
    if (s.costLoading) { await new Promise(r => setTimeout(r, 100)); return get().cost }
    set({ costLoading: true })
    try { const r = await fetch('/api/cost?action=stats'); if (!r.ok) throw new Error(); const d = await r.json(); set({ cost: d, costLastFetch: Date.now(), costLoading: false }); return d }
    catch { set({ costLoading: false }); return s.cost }
  },
  affect: null, affectLoading: false, affectLastFetch: 0,
  fetchAffect: async (force = false) => {
    const s = get()
    if (!force && s.affect && isFresh(s.affectLastFetch, TTL.affect)) return s.affect
    if (s.affectLoading) { await new Promise(r => setTimeout(r, 100)); return get().affect }
    set({ affectLoading: true })
    try { const r = await fetch('/api/affect?action=stats'); if (!r.ok) throw new Error(); const d = await r.json(); set({ affect: { avgDesperation: d.avgDesperation ?? 0, avgFrustration: d.avgFrustration ?? 0, samples: d.samples ?? 0, agents: d.agents ?? 0, interventions: d.interventions ?? 0 }, affectLastFetch: Date.now(), affectLoading: false }); return get().affect }
    catch { set({ affectLoading: false }); return s.affect }
  },
  logs: [], logsLoading: false, logsLastFetch: 0,
  fetchLogs: async (force = false) => {
    const s = get()
    if (!force && s.logsLastFetch > 0 && isFresh(s.logsLastFetch, TTL.logs)) return s.logs
    if (s.logsLoading) { await new Promise(r => setTimeout(r, 100)); return get().logs }
    set({ logsLoading: true })
    try { const r = await fetch('/api/cockpit?tab=log'); if (!r.ok) throw new Error(); const d = await r.json(); const logs = (d.logs || []) as LogEntry[]; set({ logs, logsLastFetch: Date.now(), logsLoading: false }); return logs }
    catch { set({ logsLoading: false }); return s.logs }
  },
  refreshAll: async () => { await Promise.all([get().fetchDashboard(true), get().fetchBlocked(true), get().fetchCost(true), get().fetchAffect(true), get().fetchLogs(true)]) },
}))

let mainInterval: ReturnType<typeof setInterval> | null = null
let costInterval: ReturnType<typeof setInterval> | null = null
let subscriberCount = 0

export function startGlobalRefresh() {
  subscriberCount++
  if (mainInterval) return
  useDataStore.getState().fetchDashboard(); useDataStore.getState().fetchBlocked(); useDataStore.getState().fetchCost()
  mainInterval = setInterval(() => { useDataStore.getState().fetchDashboard(); useDataStore.getState().fetchBlocked(); useDataStore.getState().fetchAffect() }, 5000)
  costInterval = setInterval(() => { useDataStore.getState().fetchCost() }, 30000)
}

export function stopGlobalRefresh() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount > 0) return
  if (mainInterval) { clearInterval(mainInterval); mainInterval = null }
  if (costInterval) { clearInterval(costInterval); costInterval = null }
}
