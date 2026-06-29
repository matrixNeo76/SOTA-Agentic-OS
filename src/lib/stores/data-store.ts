import { create } from 'zustand'

// === C6.3 — Error handling helpers ==================================
//
// Centralised error handling for all data-store fetches. Three behaviours:
//   1. HTTP 401 → redirect to /login?next=<current> (session expired)
//   2. HTTP 403 → toast.error('Insufficient permissions')
//   3. HTTP 5xx / network error → toast.error('Failed to load <endpoint>')
//
// We keep the silent fallback for stale-data-return (so the UI doesn't
// blank out on transient errors), but now the user is always told.

let toastFn: ((msg: string, opts?: { description?: string; duration?: number }) => void) | null = null
let errorFn: ((msg: string, opts?: { description?: string; duration?: number }) => void) | null = null

/**
 * Lazy-register the toast functions. We can't import sonner directly here
 * because data-store.ts is also imported server-side (zusta­nd is isomorphic).
 * The Topbar/Overview registers these on mount so the store can call them.
 */
export function registerToastHandlers(opts: {
  toast?: typeof import('sonner').toast
}) {
  if (opts.toast) {
    toastFn = opts.toast.info.bind(opts.toast)
    errorFn = opts.toast.error.bind(opts.toast)
  }
}

function redirectToLogin() {
  if (typeof window === 'undefined') return
  const next = window.location.pathname + window.location.search
  window.location.href = `/login?next=${encodeURIComponent(next)}`
}

async function handleFetchError(
  res: Response | null,
  endpoint: string,
  context: string,
): Promise<boolean> {
  // Returns true if the error was handled (caller should fall back to stale data).
  if (res === null) {
    // Network error / fetch threw
    errorFn?.(`Failed to load ${context}`, {
      description: `Network error on ${endpoint}`,
      duration: 5000,
    })
    return true
  }
  if (res.status === 401) {
    // Session expired — redirect to login (no toast, the redirect is enough)
    redirectToLogin()
    return true
  }
  if (res.status === 403) {
    errorFn?.(`Insufficient permissions for ${context}`, {
      description: `HTTP 403 on ${endpoint}`,
      duration: 5000,
    })
    return true
  }
  if (res.status >= 500) {
    errorFn?.(`Server error loading ${context}`, {
      description: `HTTP ${res.status} on ${endpoint}`,
      duration: 5000,
    })
    return true
  }
  // 4xx other than 401/403 — likely a bug, log but don't toast (too noisy)
  if (typeof console !== 'undefined') {
    console.warn(`[data-store] ${endpoint} returned HTTP ${res.status}`)
  }
  return true
}

// Build a fetch wrapper that returns null on error (after handling) or the Response on success.
async function safeFetch(
  url: string,
  endpoint: string,
  context: string,
): Promise<Response | null> {
  try {
    const r = await fetch(url)
    return r
  } catch (err) {
    await handleFetchError(null, endpoint, context)
    return null
  }
}

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
  recentLogs: { id: string; agentId: string; phase: string; event: string; payload: string | null; level: string; timestamp: string }[]
  agentLogsTotal: number
  memoryStats: { episodic: number; semantic: number; logical: number; avgDecay: number }
  // === C6.3 — Campi già ritornati dall'API ma prima mancanti dal type ===
  tools: { total: number; active: number; revoked: number; totalPerms: number; grantedPerms: number }
  blocked: { total: number; pending: number; approved: number; rejected: number; modified: number; downgraded: number }
  observability: {
    errors: { total: number; open: number; acknowledged: number; resolved: number; recent24h: number }
    traces: { totalSpans: number; totalTraces: number; errorSpans: number }
    backups: { total: number; recent24h?: number; lastBackupAt?: string }
    metrics: { total?: number; recent24h?: number }
  }
  scalability: {
    database: {
      provider: string
      supports: { concurrentWriters: boolean; replication: boolean; jsonNative: boolean; fullTextSearch: boolean }
      totalModels: number
      totalRows?: number
    }
  }
  cost: {
    total: number
    today: number
    week: number
    byAgent: { agentId: string; cost: number; calls: number }[]
    byModel: { model: string; cost: number; calls: number }[]
    byPhase: { phase: string; cost: number; calls: number }[]
    totalTokensIn: number
    totalTokensOut: number
    totalCalls: number
    budget?: { warn: number; danger: number }
  }
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
    const r = await safeFetch('/api/dashboard', '/api/dashboard', 'dashboard')
    if (!r || !r.ok) {
      if (r) await handleFetchError(r, '/api/dashboard', 'dashboard')
      set({ dashboardLoading: false })
      return s.dashboard
    }
    try {
      const d = await r.json() as DashboardData
      set({ dashboard: d, dashboardLastFetch: Date.now(), dashboardLoading: false })
      return d
    } catch (err) {
      await handleFetchError(null, '/api/dashboard', 'dashboard (parse)')
      set({ dashboardLoading: false })
      return s.dashboard
    }
  },
  blockedPending: [], blockedRecent: [], blockedLoading: false, blockedLastFetch: 0,
  fetchBlocked: async (force = false) => {
    const s = get()
    if (!force && s.blockedLastFetch > 0 && isFresh(s.blockedLastFetch, TTL.blocked)) return { pending: s.blockedPending, recent: s.blockedRecent }
    if (s.blockedLoading) { await new Promise(r => setTimeout(r, 100)); return { pending: get().blockedPending, recent: get().blockedRecent } }
    set({ blockedLoading: true })
    // C2/C3 fix: API returns { items: [...] } (not .actions), and
    // 'all' is not a valid action — use 'recent' which returns last 30.
    const [p, a] = await Promise.all([
      safeFetch('/api/blocked-actions?action=pending', '/api/blocked-actions', 'blocked actions'),
      safeFetch('/api/blocked-actions?action=recent', '/api/blocked-actions', 'blocked actions'),
    ])
    if ((p && !p.ok) || (a && !a.ok)) {
      if (p) await handleFetchError(p, '/api/blocked-actions', 'blocked actions')
      if (a) await handleFetchError(a, '/api/blocked-actions', 'blocked actions')
      set({ blockedLoading: false })
      return { pending: s.blockedPending, recent: s.blockedRecent }
    }
    try {
      const pending = p ? ((await p.json()).items || []) : []
      const all = a ? ((await a.json()).items || []) : []
      set({ blockedPending: pending, blockedRecent: all, blockedLastFetch: Date.now(), blockedLoading: false })
      return { pending, recent: all }
    } catch (err) {
      await handleFetchError(null, '/api/blocked-actions', 'blocked actions (parse)')
      set({ blockedLoading: false })
      return { pending: s.blockedPending, recent: s.blockedRecent }
    }
  },
  cost: null, costLoading: false, costLastFetch: 0,
  fetchCost: async (force = false) => {
    const s = get()
    if (!force && s.cost && isFresh(s.costLastFetch, TTL.cost)) return s.cost
    if (s.costLoading) { await new Promise(r => setTimeout(r, 100)); return get().cost }
    set({ costLoading: true })
    const r = await safeFetch('/api/cost?action=stats', '/api/cost', 'cost stats')
    if (!r || !r.ok) {
      if (r) await handleFetchError(r, '/api/cost', 'cost stats')
      set({ costLoading: false })
      return s.cost
    }
    try {
      const d = await r.json()
      set({ cost: d, costLastFetch: Date.now(), costLoading: false })
      return d
    } catch (err) {
      await handleFetchError(null, '/api/cost', 'cost stats (parse)')
      set({ costLoading: false })
      return s.cost
    }
  },
  affect: null, affectLoading: false, affectLastFetch: 0,
  fetchAffect: async (force = false) => {
    const s = get()
    if (!force && s.affect && isFresh(s.affectLastFetch, TTL.affect)) return s.affect
    if (s.affectLoading) { await new Promise(r => setTimeout(r, 100)); return get().affect }
    set({ affectLoading: true })
    const r = await safeFetch('/api/affect?action=stats', '/api/affect', 'affect stats')
    if (!r || !r.ok) {
      if (r) await handleFetchError(r, '/api/affect', 'affect stats')
      set({ affectLoading: false })
      return s.affect
    }
    try {
      const d = await r.json()
      set({ affect: { avgDesperation: d.avgDesperation ?? 0, avgFrustration: d.avgFrustration ?? 0, samples: d.samples ?? 0, agents: d.agents ?? 0, interventions: d.interventions ?? 0 }, affectLastFetch: Date.now(), affectLoading: false })
      return get().affect
    } catch (err) {
      await handleFetchError(null, '/api/affect', 'affect stats (parse)')
      set({ affectLoading: false })
      return s.affect
    }
  },
  logs: [], logsLoading: false, logsLastFetch: 0,
  fetchLogs: async (force = false) => {
    const s = get()
    if (!force && s.logsLastFetch > 0 && isFresh(s.logsLastFetch, TTL.logs)) return s.logs
    if (s.logsLoading) { await new Promise(r => setTimeout(r, 100)); return get().logs }
    set({ logsLoading: true })
    const r = await safeFetch('/api/cockpit?tab=log', '/api/cockpit', 'logs')
    if (!r || !r.ok) {
      if (r) await handleFetchError(r, '/api/cockpit', 'logs')
      set({ logsLoading: false })
      return s.logs
    }
    try {
      const d = await r.json()
      const logs = (d.logs || []) as LogEntry[]
      set({ logs, logsLastFetch: Date.now(), logsLoading: false })
      return logs
    } catch (err) {
      await handleFetchError(null, '/api/cockpit', 'logs (parse)')
      set({ logsLoading: false })
      return s.logs
    }
  },
  refreshAll: async () => { await Promise.all([get().fetchDashboard(true), get().fetchBlocked(true), get().fetchCost(true), get().fetchAffect(true), get().fetchLogs(true)]) },
}))

let mainInterval: ReturnType<typeof setInterval> | null = null
let costInterval: ReturnType<typeof setInterval> | null = null
let subscriberCount = 0

// === C6.3 — Adaptive refresh policy ================================
//
// Instead of a fixed 5s polling, we adapt:
//   - 5s when there are running plans or pending blocked actions (active)
//   - 30s when idle (no active work)
//   - Paused entirely when the tab is in the background (Page Visibility API)
//
// This reduces DB load when idle (~720 query/min → ~24 query/min) while
// keeping the dashboard responsive when the user is actively working.

const ACTIVE_INTERVAL = 5000   // 5s when there's work in flight
const IDLE_INTERVAL = 30000    // 30s when nothing is running
const COST_INTERVAL = 30000    // cost is always 30s (less volatile)

let currentInterval = IDLE_INTERVAL
let visibilityHandler: (() => void) | null = null

function computeInterval(): number {
  const s = useDataStore.getState()
  const d = s.dashboard
  if (!d) return ACTIVE_INTERVAL // first load — fetch fast
  const hasRunningPlans = (d.phase2?.plans ?? 0) > 0
  const hasPendingBlocked = (s.blockedPending?.length ?? 0) > 0
  const hasPendingGates = (d.phase9?.pendingGates ?? 0) > 0
  const hasErrors24h = (d.observability?.errors?.recent24h ?? 0) > 0
  if (hasRunningPlans || hasPendingBlocked || hasPendingGates || hasErrors24h) {
    return ACTIVE_INTERVAL
  }
  return IDLE_INTERVAL
}

function rescheduleMain() {
  if (!mainInterval) return
  clearInterval(mainInterval)
  const next = computeInterval()
  if (next !== currentInterval) {
    currentInterval = next
  }
  mainInterval = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Tab hidden — skip this tick, will catch up on visibilitychange
      return
    }
    useDataStore.getState().fetchDashboard()
    useDataStore.getState().fetchBlocked()
    useDataStore.getState().fetchAffect()
    // After each fetch, re-evaluate the interval (active → idle transition)
    const newInterval = computeInterval()
    if (newInterval !== currentInterval) {
      rescheduleMain()
    }
  }, currentInterval)
}

export function startGlobalRefresh() {
  subscriberCount++
  if (mainInterval) return
  useDataStore.getState().fetchDashboard(); useDataStore.getState().fetchBlocked(); useDataStore.getState().fetchCost()
  currentInterval = computeInterval()
  mainInterval = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    useDataStore.getState().fetchDashboard()
    useDataStore.getState().fetchBlocked()
    useDataStore.getState().fetchAffect()
    const newInterval = computeInterval()
    if (newInterval !== currentInterval) {
      rescheduleMain()
    }
  }, currentInterval)
  costInterval = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    useDataStore.getState().fetchCost()
  }, COST_INTERVAL)

  // Page Visibility — refresh on tab focus after being hidden
  if (typeof document !== 'undefined' && !visibilityHandler) {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // Force refresh on tab return — the user wants fresh data
        useDataStore.getState().fetchDashboard(true)
        useDataStore.getState().fetchBlocked(true)
        useDataStore.getState().fetchCost(true)
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }
}

export function stopGlobalRefresh() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount > 0) return
  if (mainInterval) { clearInterval(mainInterval); mainInterval = null }
  if (costInterval) { clearInterval(costInterval); costInterval = null }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
}
