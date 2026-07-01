'use client'

/**
 * Runs View — UX-3: Superficie di Esecuzione + HITL live
 *
 * Due livelli:
 *   1. Runs list: workflow passati/in corso con stato, durata, costo
 *   2. Run detail: timeline batch/step + ReAct loop + checkpoint + HITL
 *
 * Allineata a PLAN.md WS1 (executor durevole):
 *   - Mostra topologicalBatches come timeline
 *   - Per ogni step: pensiero → tool-call → osservazione (da ExecutionTrace)
 *   - Controlli durabilità: pausa/riprendi, checkpoint con resume/rollback
 *   - HITL: approvazione inline (collega Sovereign)
 *   - Badge "ripreso dopo interruzione" quando resumed=true
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useSearchParams } from 'next/navigation'
import { ModulePage, EmptyState } from '@/components/module-pages/module-page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play, ArrowLeft, RotateCcw, CheckCircle2, XCircle, Clock, AlertTriangle, ChevronDown, ChevronRight, History, DollarSign, Pause, Square, Search, X, ChevronLeft, Users, Download, Copy, Archive, Trash2, Tag, ArchiveRestore } from 'lucide-react'
import { useSensoriumLive } from '@/components/agentic/use-sensorium-live'
import { cn } from '@/lib/utils'

// === Tipi ============================================================

interface RunTask {
  taskId: string
  agentId: string
  description: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  result?: string | null
  // C6.7 — LTL verdict + violations (populated by /api/runs/detail)
  ltlVerdict?: string
  ltlViolations?: string[]
}

interface Run {
  planId: string
  goal: string
  status: string
  createdAt: string
  updatedAt: string
  taskCount: number
  tasksCompleted: number
  tasksFailed: number
  tasksBlocked: number
  tasksRunning: number
  totalDurationMs: number
  agentCount: number
  agents: string[]
  batches: string[][]
  tasks: RunTask[]
  tags: string[]       // C6.8
  archived: boolean    // C6.8
}

interface RunDetail {
  plan: {
    id: string
    goal: string
    status: string
    planJson: any
    batches: string[][]
    agentCount: number
    createdAt: string
    updatedAt: string
    tags: string[]    // C6.8
    archived: boolean // C6.8
  }
  tasks: Array<RunTask & { dependencies: string[]; id: string }>
  checkpoints: Array<{
    id: string
    agentUri: string
    taskId: string | null
    checkpointType: string
    cycleId: number | null
    createdAt: string
    state: any
  }>
  traces: Array<{
    id: string
    traceLabel: string
    states: any[]
    actions: any[]
    outcome: string
    capturedAt: string
  }>
  costs: {
    total: number
    tokensIn: number
    tokensOut: number
    entries: any[]
  }
}

// === Main component ===================================================

export function RunsView() {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // C6.7 — Filter + pagination state
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [availableAgents, setAvailableAgents] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [totalRuns, setTotalRuns] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const pageSize = 50

  // C6.6 — Real-time updates via Sensorium WS singleton.
  const { connected: wsConnected, events: wsEvents } = useSensoriumLive()

  // C6.6 — Deep-linking: read ?planId= from URL on mount.
  const searchParams = useSearchParams()
  const initialPlanId = searchParams.get('planId')

  // C6.7 — Build query string from filters
  const buildQuery = useCallback((offset: number) => {
    const params = new URLSearchParams()
    params.set('limit', String(pageSize))
    params.set('offset', String(offset))
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (agentFilter !== 'all') params.set('agent', agentFilter)
    if (tagFilter !== 'all') params.set('tag', tagFilter)
    if (searchQuery) params.set('search', searchQuery)
    return params.toString()
  }, [statusFilter, agentFilter, tagFilter, searchQuery])

  // C6.7 — Fetch runs with filters + pagination
  const fetchRuns = useCallback(async (append = false) => {
    if (!append) setLoading(true)
    try {
      const offset = append ? runs.length : 0
      const res = await fetch(`/api/runs/list?${buildQuery(offset)}`).then((r) => r.json())
      if (append) {
        setRuns(prev => [...prev, ...(res.runs || [])])
      } else {
        setRuns(res.runs || [])
      }
      setTotalRuns(res.total || 0)
      setHasMore(res.hasMore || false)
      if (res.agents) setAvailableAgents(res.agents)
      if (res.tags) setAvailableTags(res.tags)
    } catch (err: any) {
      toast.error(`Failed to load runs: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [buildQuery, runs.length])

  // C6.7 — Refetch when filters change (debounced for search)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRuns(false)
    }, searchQuery ? 300 : 0) // debounce search 300ms
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, agentFilter, tagFilter, searchQuery])

  // C6.6 — Auto-open detail if ?planId= is in the URL on first mount.
  useEffect(() => {
    if (initialPlanId && !selectedPlanId) {
      openDetail(initialPlanId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlanId])

  // C6.6 — Real-time: silent refresh on WS events (throttled)
  const lastWsRefreshRef = useRef(0)
  useEffect(() => {
    if (!wsConnected || wsEvents.length === 0) return
    const hasActiveRuns = runs.some(r => r.status === 'running' || r.status === 'scheduled' || r.status === 'paused')
    if (!hasActiveRuns) return
    const now = Date.now()
    if (now - lastWsRefreshRef.current < 2000) return
    lastWsRefreshRef.current = now
    // Silent refresh of the first page only (preserves filters)
    fetch(`/api/runs/list?${buildQuery(0)}`)
      .then(r => r.json())
      .then(d => {
        if (d.runs) {
          setRuns(d.runs)
          setTotalRuns(d.total || 0)
          setHasMore(d.hasMore || false)
        }
      })
      .catch(() => {})
  }, [wsEvents, wsConnected, runs, buildQuery])

  const openDetail = useCallback(async (planId: string) => {
    setSelectedPlanId(planId)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/runs/detail?planId=${planId}`).then((r) => r.json())
      setDetail(res)
    } catch (err: any) {
      toast.error(`Failed to load run detail: ${err.message}`)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // === Run Detail View ===
  if (selectedPlanId) {
    return (
      <RunDetailView
        planId={selectedPlanId}
        detail={detail}
        loading={detailLoading}
        wsConnected={wsConnected}
        onBack={() => {
          setSelectedPlanId(null)
          setDetail(null)
          fetchRuns(false)
          if (window.location.search.includes('planId=')) {
            window.history.replaceState({}, '', window.location.pathname)
          }
        }}
        onRefresh={() => openDetail(selectedPlanId)}
      />
    )
  }

  // === Runs List View ===
  const runningCount = runs.filter(r => r.status === 'running' || r.status === 'scheduled').length
  const completedCount = runs.filter(r => r.status === 'completed').length
  const failedCount = runs.filter(r => r.status === 'failed').length

  return (
    <ModulePage
      title="Runs"
      description="Workflow executions — past and in-progress"
      icon="Play"
      loading={loading}
      onRefresh={() => fetchRuns(false)}
      stats={[
        { label: 'Total', value: totalRuns, icon: 'Play' },
        { label: 'Running', value: runningCount, tone: 'warn' as const, icon: 'Activity' },
        { label: 'Completed', value: completedCount, tone: 'ok' as const, icon: 'CheckCircle2' },
        { label: 'Failed', value: failedCount, tone: 'danger' as const, icon: 'XCircle' },
      ]}
    >
      {/* C6.7 — Filter bar */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search by goal…"
            aria-label="Search runs by goal"
            className="w-full h-8 pl-7 pr-7 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="h-8 text-xs border rounded-md bg-background px-2"
        >
          <option value="all">all statuses</option>
          <option value="running">running</option>
          <option value="scheduled">scheduled</option>
          <option value="paused">paused</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="partial">partial</option>
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          aria-label="Filter by agent"
          className="h-8 text-xs border rounded-md bg-background px-2"
          disabled={availableAgents.length === 0}
        >
          <option value="all">all agents</option>
          {availableAgents.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {/* C6.8 — Tag filter */}
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label="Filter by tag"
          className="h-8 text-xs border rounded-md bg-background px-2"
          disabled={availableTags.length === 0}
        >
          <option value="all">all tags</option>
          {availableTags.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {(statusFilter !== 'all' || agentFilter !== 'all' || tagFilter !== 'all' || searchQuery) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setStatusFilter('all'); setAgentFilter('all'); setTagFilter('all'); setSearchQuery('') }}
            className="h-8 text-xs"
          >
            <X className="size-3 mr-0.5" /> Clear filters
          </Button>
        )}
      </div>

      {/* C6.6 — Live indicator */}
      {wsConnected && runningCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-status-ok mb-3 px-1">
          <span className="size-1.5 rounded-full bg-status-ok animate-pulse" />
          <span>Live — auto-refreshing on agent events</span>
        </div>
      )}

      {/* C6.7 — Result count */}
      <div className="text-xs text-muted-foreground mb-2 px-1">
        {runs.length === 0
          ? 'No runs found'
          : `${runs.length} of ${totalRuns} run${totalRuns === 1 ? '' : 's'}`
        }
        {(statusFilter !== 'all' || agentFilter !== 'all' || tagFilter !== 'all' || searchQuery) && ' (filtered)'}
      </div>

      {runs.length > 0 ? (
        <>
          <div className="space-y-2">
            {runs.map((run) => (
              <RunRow key={run.planId} run={run} onClick={() => openDetail(run.planId)} onManaged={() => fetchRuns(false)} />
            ))}
          </div>
          {/* C6.7 — Load more pagination */}
          {hasMore && (
            <div className="flex justify-center mt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchRuns(true)}
                disabled={loading}
              >
                {loading ? (
                  <RotateCcw className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : null}
                Load more ({totalRuns - runs.length} remaining)
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon="Play"
          title={searchQuery || statusFilter !== 'all' || agentFilter !== 'all' || tagFilter !== 'all' ? 'No runs match your filters' : 'No runs yet'}
          description={
            searchQuery || statusFilter !== 'all' || agentFilter !== 'all' || tagFilter !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Execute a workflow from the Console to see it appear here. Runs are persistent — they survive crashes and can be resumed.'
          }
        />
      )}
    </ModulePage>
  )
}

// === Run Row (list item) ==============================================

function RunRow({ run, onClick, onManaged }: { run: Run; onClick: () => void; onManaged: () => void }) {
  const statusBadge = (status: string) => {
    const variant = status === 'completed' ? 'success' : status === 'failed' ? 'destructive' : status === 'running' ? 'warning' : status === 'paused' ? 'secondary' : 'secondary'
    return <Badge variant={variant as any}>{status}</Badge>
  }

  // C6.8 — Manage actions (duplicate, archive, delete)
  const [managing, setManaging] = useState<string | null>(null)

  const handleManage = async (e: React.MouseEvent, action: string) => {
    e.stopPropagation() // prevent row click (openDetail)
    if (action === 'delete') {
      if (!confirm(`Delete run "${run.goal}"?\n\nThis will permanently remove the plan and all its tasks. This cannot be undone.`)) return
    }
    setManaging(action)
    try {
      const res = await fetch('/api/runs/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, planId: run.planId }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`${action} failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      if (action === 'duplicate') {
        toast.success(`Run duplicated as ${body.planId}`, { description: body.message, duration: 5000 })
      } else if (action === 'archive') {
        toast.success('Run archived')
      } else if (action === 'unarchive') {
        toast.success('Run restored')
      } else if (action === 'delete') {
        toast.success('Run deleted permanently')
      }
      onManaged()
    } catch (err: any) {
      toast.error(`${action} failed: ${err.message}`)
    } finally {
      setManaging(null)
    }
  }

  return (
    <div
      onClick={onClick}
      className="border rounded-lg p-4 cursor-pointer hover:bg-accent/30 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {statusBadge(run.status)}
            {run.archived && <Badge variant="outline" className="text-[10px]"><Archive className="w-2.5 h-2.5 mr-0.5" />archived</Badge>}
            <span className="text-sm font-medium truncate">{run.goal}</span>
            {/* C6.8 — Tags */}
            {run.tags?.map(tag => (
              <Badge key={tag} variant="secondary" className="text-[9px]">{tag}</Badge>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="font-mono">{run.planId}</span>
            <span>{run.tasksCompleted}/{run.taskCount} done</span>
            {run.tasksFailed > 0 && <span className="text-destructive">{run.tasksFailed} failed</span>}
            {run.tasksBlocked > 0 && <span className="text-status-warn">{run.tasksBlocked} blocked</span>}
            <span><Clock className="w-3 h-3 inline mr-0.5" />{formatDuration(run.totalDurationMs)}</span>
            <span>{new Date(run.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* C6.8 — Quick actions */}
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={(e) => handleManage(e, 'duplicate')}
            disabled={managing !== null}
            title="Duplicate run"
            aria-label="Duplicate run"
          >
            {managing === 'duplicate' ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          {run.archived ? (
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={(e) => handleManage(e, 'unarchive')}
              disabled={managing !== null}
              title="Restore from archive"
              aria-label="Restore from archive"
            >
              {managing === 'unarchive' ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
            </Button>
          ) : (
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0"
              onClick={(e) => handleManage(e, 'archive')}
              disabled={managing !== null}
              title="Archive run"
              aria-label="Archive run"
            >
              {managing === 'archive' ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-destructive"
            onClick={(e) => handleManage(e, 'delete')}
            disabled={managing !== null || ['running', 'scheduled', 'paused'].includes(run.status)}
            title="Delete run permanently"
            aria-label="Delete run permanently"
          >
            {managing === 'delete' ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground ml-1" />
        </div>
      </div>

      {/* Mini progress bar */}
      <div className="mt-2 flex gap-0.5 h-1">
        {run.tasks.map((t) => (
          <div
            key={t.taskId}
            className={cn(
              'flex-1 rounded-full',
              t.status === 'done' && 'bg-status-ok',
              t.status === 'failed' && 'bg-status-danger',
              t.status === 'blocked' && 'bg-status-warn',
              t.status === 'running' && 'bg-status-info animate-pulse',
              t.status === 'pending' && 'bg-muted',
            )}
          />
        ))}
      </div>
    </div>
  )
}

// === Run Detail View ==================================================

function RunDetailView({ planId, detail, loading, wsConnected, onBack, onRefresh }: {
  planId: string
  detail: RunDetail | null
  loading: boolean
  wsConnected: boolean
  onBack: () => void
  onRefresh: () => void
}) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [showCheckpoints, setShowCheckpoints] = useState(false)
  const [controlLoading, setControlLoading] = useState<string | null>(null)
  // C6.10 — Keyboard navigation state
  const [focusedTaskIdx, setFocusedTaskIdx] = useState<number>(-1)
  const taskRefs = useRef<(HTMLButtonElement | null)[]>([])

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  // C6.6 — Auto-refresh every 3s when the plan is in an active status.
  const isActive = detail?.plan?.status &&
    ['running', 'scheduled', 'paused', 'partial'].includes(detail.plan.status)

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      onRefresh()
    }, 3000)
    return () => clearInterval(interval)
  }, [isActive, onRefresh])

  // C6.10 — Keyboard navigation: Arrow Up/Down to move between tasks,
  // Enter to expand/collapse, Escape to close detail.
  useEffect(() => {
    if (!detail) return
    // Flatten all taskIds from batches for keyboard nav
    const allTaskIds = detail.plan.batches.flat()
    if (allTaskIds.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input/textarea/select
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedTaskIdx(prev => {
          const next = Math.min(prev + 1, allTaskIds.length - 1)
          taskRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          return next
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedTaskIdx(prev => {
          const next = Math.max(prev - 1, 0)
          taskRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          return next
        })
      } else if (e.key === 'Enter' && focusedTaskIdx >= 0) {
        e.preventDefault()
        const taskId = allTaskIds[focusedTaskIdx]
        if (taskId) toggleTask(taskId)
      } else if (e.key === 'Escape') {
        // If a task is expanded, collapse it first; otherwise go back
        if (focusedTaskIdx >= 0 && expandedTasks.has(allTaskIds[focusedTaskIdx])) {
          e.preventDefault()
          toggleTask(allTaskIds[focusedTaskIdx])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [detail, focusedTaskIdx, expandedTasks])

  // C6.10 — Browser notification when run transitions to terminal state
  const prevStatusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!detail) return
    const currentStatus = detail.plan.status
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = currentStatus

    // Only notify if status transitioned FROM active TO terminal
    if (!prevStatus) return // skip initial load
    const wasActive = ['running', 'scheduled', 'paused'].includes(prevStatus)
    const isTerminal = ['completed', 'failed'].includes(currentStatus)
    if (!wasActive || !isTerminal) return

    // Try browser notification
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const icon = currentStatus === 'completed' ? '✅' : '❌'
      const title = `${icon} Run ${currentStatus}: ${detail.plan.goal}`
      const body = `Plan ${planId.slice(0, 20)}… — ${detail.tasks.filter(t => t.status === 'done').length}/${detail.tasks.length} tasks completed`
      try {
        new Notification(title, { body, tag: planId })
      } catch {}
    }

    // Also show a toast as fallback
    if (currentStatus === 'completed') {
      toast.success(`Run completed: ${detail.plan.goal}`, {
        description: `${detail.tasks.filter(t => t.status === 'done').length}/${detail.tasks.length} tasks done`,
        duration: 8000,
      })
    } else if (currentStatus === 'failed') {
      toast.error(`Run failed: ${detail.plan.goal}`, {
        description: `${detail.tasks.filter(t => t.status === 'failed').length} tasks failed`,
        duration: 8000,
      })
    }
  }, [detail?.plan?.status, detail, planId])

  // C6.10 — Request notification permission when user opens an active run
  useEffect(() => {
    if (isActive && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [isActive])

  // C6.6 — Update URL with planId for deep-linking when detail opens.
  useEffect(() => {
    if (planId && !window.location.search.includes(`planId=${planId}`)) {
      const url = `${window.location.pathname}?planId=${planId}`
      window.history.replaceState({}, '', url)
    }
  }, [planId])

  // C6.6 — Run control handler (pause/resume/abort).
  const handleControl = async (action: 'pause' | 'resume' | 'abort') => {
    setControlLoading(action)
    try {
      const res = await fetch('/api/runs/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, planId }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`${action} failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      // Action-specific success messages
      if (action === 'pause') {
        toast.success(`Plan paused`, { description: body.message, duration: 5000 })
      } else if (action === 'resume') {
        toast.success(`Plan resumed`, { description: body.message, duration: 5000 })
      } else if (action === 'abort') {
        toast.success(`Plan aborted`, { description: `${body.affectedTasks} task(s) cancelled`, duration: 6000 })
      }
      onRefresh()
    } catch (err: any) {
      toast.error(`${action} failed: ${err.message}`)
    } finally {
      setControlLoading(null)
    }
  }

  if (loading || !detail) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Runs
        </Button>
        <div className="flex justify-center py-12">
          <RotateCcw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const { plan, tasks, checkpoints, traces, costs } = detail

  // C6.6 — Determine which control buttons to show based on plan status.
  const canPause = ['running', 'scheduled'].includes(plan.status)
  const canResume = plan.status === 'paused'
  const canAbort = ['running', 'scheduled', 'paused', 'partial'].includes(plan.status)

  return (
    <div className="space-y-4 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{plan.goal}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span className="font-mono">{plan.id}</span>
              <Badge variant={plan.status === 'completed' ? 'success' : plan.status === 'failed' ? 'destructive' : plan.status === 'paused' ? 'secondary' : 'warning'}>
                {plan.status}
              </Badge>
              <span>{new Date(plan.createdAt).toLocaleString()}</span>
              {/* C6.6 — Live indicator when WS connected and plan is active */}
              {wsConnected && isActive && (
                <span className="flex items-center gap-1 text-status-ok">
                  <span className="size-1.5 rounded-full bg-status-ok animate-pulse" />
                  live
                </span>
              )}
              {/* C6.6 — Auto-refresh indicator */}
              {isActive && (
                <span className="text-muted-foreground/70">· auto-refresh 3s</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* C6.6 — Run control buttons */}
          {canPause && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleControl('pause')}
              disabled={controlLoading !== null}
            >
              {controlLoading === 'pause' ? (
                <RotateCcw className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Pause className="w-4 h-4 mr-1" />
              )}
              {controlLoading === 'pause' ? 'Pausing…' : 'Pause'}
            </Button>
          )}
          {canResume && (
            <Button
              size="sm"
              variant="default"
              onClick={() => handleControl('resume')}
              disabled={controlLoading !== null}
            >
              {controlLoading === 'resume' ? (
                <RotateCcw className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-1" />
              )}
              {controlLoading === 'resume' ? 'Resuming…' : 'Resume'}
            </Button>
          )}
          {canAbort && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (confirm(`Abort this run?\n\nAll pending and running tasks will be marked as failed. This cannot be undone.`)) {
                  handleControl('abort')
                }
              }}
              disabled={controlLoading !== null}
            >
              {controlLoading === 'abort' ? (
                <RotateCcw className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Square className="w-4 h-4 mr-1" />
              )}
              {controlLoading === 'abort' ? 'Aborting…' : 'Abort'}
            </Button>
          )}
          {/* C6.8 — Export JSON */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `run-${planId}-${new Date().toISOString().slice(0, 10)}.json`
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)
              toast.success('Run detail exported as JSON')
            }}
            title="Export run detail as JSON"
          >
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RotateCcw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* C6.6 — Paused banner */}
      {plan.status === 'paused' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-status-warn/10 border border-status-warn/20 text-xs text-status-warn">
          <Pause className="w-3.5 shrink-0" />
          <span className="font-medium">Plan paused.</span>
          <span className="text-muted-foreground">In-flight tasks have completed. Click Resume to continue with the next batch.</span>
        </div>
      )}

      {/* C6.8 — Tags management */}
      <TagsManager planId={planId} tags={plan.tags || []} onTagsChanged={onRefresh} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Tasks" value={tasks.length} />
        <StatBox label="Done" value={tasks.filter(t => t.status === 'done').length} tone="ok" />
        <StatBox label="Failed" value={tasks.filter(t => t.status === 'failed').length} tone="danger" />
        <StatBox label="Cost" value={`$${costs.total.toFixed(4)}`} icon="dollar" />
        <StatBox label="Tokens" value={`${costs.tokensIn + costs.tokensOut}`} />
      </div>

      {/* C6.7 — Agent-level breakdown */}
      {tasks.length > 0 && (
        <AgentBreakdown tasks={tasks} costs={costs.entries || []} />
      )}

      {/* Timeline by batch */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Play className="w-4 h-4" /> Execution Timeline
          </CardTitle>
          <CardDescription>
            {plan.batches.length} batches (topological order) — click a task to expand
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {plan.batches.map((batch, batchIdx) => (
              <div key={batchIdx}>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Batch {batchIdx + 1} — {batch.length} task{batch.length > 1 ? 's' : ''}
                </div>
                <div className="space-y-1">
                  {batch.map((taskId) => {
                    const task = tasks.find(t => t.taskId === taskId)
                    if (!task) return null
                    const isExpanded = expandedTasks.has(taskId)
                    // C6.10 — Compute flat index for keyboard navigation
                    const flatIdx = detail.plan.batches.flat().indexOf(taskId)
                    const isFocused = focusedTaskIdx === flatIdx
                    return (
                      <TaskStep
                        key={taskId}
                        task={task}
                        isExpanded={isExpanded}
                        isFocused={isFocused}
                        onToggle={() => toggleTask(taskId)}
                        traces={traces.filter(t => t.traceLabel.includes(taskId))}
                        refCallback={(el) => { taskRefs.current[flatIdx] = el }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Checkpoints (UX-3c) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4" /> Checkpoints ({checkpoints.length})
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowCheckpoints(!showCheckpoints)}>
              {showCheckpoints ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </CardHeader>
        {showCheckpoints && (
          <CardContent>
            {checkpoints.length > 0 ? (
              <div className="space-y-1">
                {checkpoints.map((cp) => (
                  <CheckpointRow key={cp.id} cp={cp} onRefresh={onRefresh} />
                ))}
              </div>
            ) : (
              <EmptyState icon="History" title="No checkpoints" description="Checkpoints are created automatically during task execution" />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

// === Task Step (expandable) ===========================================

function TaskStep({ task, isExpanded, isFocused, onToggle, traces, refCallback }: {
  task: RunTask & { dependencies?: string[]; id?: string; ltlVerdict?: string; ltlViolations?: string[] }
  isExpanded: boolean
  isFocused?: boolean
  onToggle: () => void
  traces: any[]
  refCallback?: (el: HTMLButtonElement | null) => void
}) {
  const statusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 className="w-4 h-4 text-status-ok" />
      case 'failed': return <XCircle className="w-4 h-4 text-status-danger" />
      case 'blocked': return <AlertTriangle className="w-4 h-4 text-status-warn" />
      case 'running': return <RotateCcw className="w-4 h-4 text-status-info animate-spin" />
      default: return <Clock className="w-4 h-4 text-muted-foreground" />
    }
  }

  // C6.7 — LTL verdict badge
  const ltlBadge = (verdict?: string) => {
    if (!verdict) return null
    const variant = verdict === 'accept' ? 'success' : verdict === 'reject' ? 'destructive' : verdict === 'warn' ? 'warning' : 'secondary'
    return <Badge variant={variant as any} className="text-[10px]">LTL: {verdict}</Badge>
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        ref={refCallback}
        onClick={onToggle}
        aria-label={`Task ${task.taskId}: ${task.description}${isExpanded ? ' (expanded)' : ''}`}
        aria-expanded={isExpanded}
        className={cn(
          'w-full flex items-center gap-3 p-3 transition-colors text-left',
          isFocused ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent/30',
        )}
      >
        {statusIcon(task.status)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono">{task.taskId}</span>
            <Badge variant="outline" className="text-[10px]">{task.agentId}</Badge>
            {ltlBadge(task.ltlVerdict)}
          </div>
          <div className="text-sm truncate">{task.description}</div>
        </div>
        {task.durationMs !== null && (
          <span className="text-xs text-muted-foreground shrink-0">{formatDuration(task.durationMs)}</span>
        )}
        {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
      </button>

      {isExpanded && (
        <div className="border-t bg-muted/20 p-3 space-y-2">
          {/* C6.7 — LTL verdict + violations */}
          {task.ltlVerdict && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">LTL Verification</div>
              <div className="flex items-center gap-2 text-xs">
                {ltlBadge(task.ltlVerdict)}
                {task.ltlViolations && task.ltlViolations.length > 0 && (
                  <span className="text-destructive">{task.ltlViolations.length} violation{task.ltlViolations.length === 1 ? '' : 's'}</span>
                )}
              </div>
              {task.ltlViolations && task.ltlViolations.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {task.ltlViolations.map((v, i) => (
                    <li key={i} className="text-[11px] text-destructive font-mono border-l-2 border-destructive/30 pl-2">
                      {v}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Task result */}
          {task.result && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Result</div>
              <pre className="text-xs bg-card border rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap">{task.result}</pre>
            </div>
          )}

          {/* ReAct loop traces (UX-3b) */}
          {traces.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">ReAct Loop Trace</div>
              <div className="space-y-1">
                {traces.map((trace) => {
                  const actions = trace.actions || []
                  return actions.map((action: any, i: number) => (
                    <div key={i} className="text-xs border-l-2 border-primary/30 pl-2">
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-[10px]">action</Badge>
                        <span className="font-mono">{action.action || 'execute'}</span>
                      </div>
                      {action.output && (
                        <pre className="text-xs mt-0.5 bg-card border rounded p-1 overflow-auto max-h-32 whitespace-pre-wrap">
                          {typeof action.output === 'string' ? action.output.slice(0, 500) : JSON.stringify(action.output, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                })}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {task.startedAt && <span>Started: {new Date(task.startedAt).toLocaleTimeString()}</span>}
            {task.finishedAt && <span>Finished: {new Date(task.finishedAt).toLocaleTimeString()}</span>}
            {task.dependencies && task.dependencies.length > 0 && (
              <span>Deps: {task.dependencies.join(', ')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// === Checkpoint Row (C6.5 — stateful rollback with toast feedback) ===

function CheckpointRow({
  cp,
  onRefresh,
}: {
  cp: {
    id: string
    agentUri: string
    taskId: string | null
    checkpointType: string
    cycleId: number | null
    createdAt: string
  }
  onRefresh: () => void
}) {
  const [rolling, setRolling] = useState(false)

  const handleRollback = async () => {
    if (
      !confirm(
        `Rollback to checkpoint ${cp.id.slice(0, 12)}…?\n\n` +
        `This will restore the agent state to when this checkpoint was created ` +
        `(${new Date(cp.createdAt).toLocaleString()}). ` +
        `Any progress made after this checkpoint will be lost.`,
      )
    ) {
      return
    }

    setRolling(true)
    try {
      const res = await fetch('/api/runs/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback',
          agentUri: cp.agentUri,
          checkpointId: cp.id,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`Rollback failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      toast.success(`Rolled back to checkpoint ${cp.id.slice(0, 12)}…`, {
        description: `Agent ${cp.agentUri} state restored to ${new Date(cp.createdAt).toLocaleString()}`,
        duration: 6000,
      })
      onRefresh()
    } catch (err: any) {
      toast.error(`Rollback failed: ${err.message}`)
    } finally {
      setRolling(false)
    }
  }

  return (
    <div className="flex items-center justify-between border rounded p-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono shrink-0">{cp.id.slice(0, 12)}…</span>
        <Badge variant="outline" className="shrink-0">{cp.checkpointType}</Badge>
        {cp.taskId && (
          <span className="font-mono text-[10px] text-muted-foreground truncate" title={cp.taskId}>
            {cp.taskId}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-muted-foreground">{new Date(cp.createdAt).toLocaleTimeString()}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRollback}
          disabled={rolling}
          className="h-6 text-xs"
        >
          {rolling ? (
            <RotateCcw className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <RotateCcw className="w-3 h-3 mr-1" />
          )}
          {rolling ? 'Rolling back…' : 'Rollback'}
        </Button>
      </div>
    </div>
  )
}

// === Tags Manager (C6.8) =============================================

function TagsManager({ planId, tags, onTagsChanged }: {
  planId: string
  tags: string[]
  onTagsChanged: () => void
}) {
  const [newTag, setNewTag] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const addTag = async () => {
    if (!newTag.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/runs/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-tag', planId, tag: newTag }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`Add tag failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      toast.success(`Tag "${newTag}" added`)
      setNewTag('')
      onTagsChanged()
    } catch (err: any) {
      toast.error(`Add tag failed: ${err.message}`)
    } finally {
      setAdding(false)
    }
  }

  const removeTag = async (tag: string) => {
    setRemoving(tag)
    try {
      const res = await fetch('/api/runs/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-tag', planId, tag }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast.error(`Remove tag failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      toast.success(`Tag "${tag}" removed`)
      onTagsChanged()
    } catch (err: any) {
      toast.error(`Remove tag failed: ${err.message}`)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      {tags.length > 0 ? (
        tags.map(tag => (
          <Badge key={tag} variant="secondary" className="text-xs gap-0.5">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              disabled={removing !== null}
              className="ml-0.5 hover:text-destructive"
              aria-label={`Remove tag ${tag}`}
            >
              {removing === tag ? <RotateCcw className="w-2.5 h-2.5 animate-spin" /> : <X className="w-2.5 h-2.5" />}
            </button>
          </Badge>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">No tags</span>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag()}
          placeholder="add tag…"
          className="h-6 w-20 text-xs border rounded px-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={adding}
          aria-label="Add new tag"
        />
        {newTag.trim() && (
          <Button size="sm" variant="ghost" onClick={addTag} disabled={adding} className="h-6 px-1.5 text-xs">
            {adding ? <RotateCcw className="w-3 h-3 animate-spin" /> : '+'}
          </Button>
        )}
      </div>
    </div>
  )
}

// === Agent Breakdown (C6.7) ===========================================

function AgentBreakdown({
  tasks,
  costs,
}: {
  tasks: Array<RunTask & { durationMs: number | null }>
  costs: Array<{ agentId: string; model: string; cost: number; tokensIn: number; tokensOut: number }>
}) {
  // Group tasks by agentId
  const byAgent = new Map<string, {
    taskCount: number
    done: number
    failed: number
    running: number
    blocked: number
    pending: number
    totalDurationMs: number
    cost: number
    tokensIn: number
    tokensOut: number
  }>()

  for (const task of tasks) {
    const agent = task.agentId
    if (!byAgent.has(agent)) {
      byAgent.set(agent, { taskCount: 0, done: 0, failed: 0, running: 0, blocked: 0, pending: 0, totalDurationMs: 0, cost: 0, tokensIn: 0, tokensOut: 0 })
    }
    const a = byAgent.get(agent)!
    a.taskCount++
    if (task.status === 'done') a.done++
    else if (task.status === 'failed') a.failed++
    else if (task.status === 'running') a.running++
    else if (task.status === 'blocked') a.blocked++
    else a.pending++
    if (task.durationMs) a.totalDurationMs += task.durationMs
  }

  // Aggregate costs by agent
  for (const c of costs) {
    const a = byAgent.get(c.agentId)
    if (a) {
      a.cost += c.cost
      a.tokensIn += c.tokensIn
      a.tokensOut += c.tokensOut
    }
  }

  const agents = Array.from(byAgent.entries()).sort((a, b) => b[1].taskCount - a[1].taskCount)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4" /> Agent Breakdown
        </CardTitle>
        <CardDescription>
          {agents.length} agent{agents.length === 1 ? '' : 's'} worked on this run
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {agents.map(([agentId, stats]) => (
            <div key={agentId} className="border rounded p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Users className="size-3 shrink-0 text-muted-foreground" />
                  <code className="text-xs font-mono truncate">{agentId}</code>
                </div>
                <Badge variant="outline" className="text-[9px] shrink-0">{stats.taskCount} task{stats.taskCount === 1 ? '' : 's'}</Badge>
              </div>
              {/* Status breakdown */}
              <div className="flex gap-1.5 text-[10px] flex-wrap">
                {stats.done > 0 && <span className="text-status-ok">✓ {stats.done}</span>}
                {stats.running > 0 && <span className="text-status-info">↻ {stats.running}</span>}
                {stats.failed > 0 && <span className="text-status-danger">✗ {stats.failed}</span>}
                {stats.blocked > 0 && <span className="text-status-warn">⚠ {stats.blocked}</span>}
                {stats.pending > 0 && <span className="text-muted-foreground">○ {stats.pending}</span>}
              </div>
              {/* Metrics */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                {stats.totalDurationMs > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-2.5" />
                    {formatDuration(stats.totalDurationMs)}
                  </span>
                )}
                {stats.cost > 0 && (
                  <span className="flex items-center gap-0.5">
                    <DollarSign className="size-2.5" />
                    ${stats.cost.toFixed(4)}
                  </span>
                )}
                {(stats.tokensIn + stats.tokensOut) > 0 && (
                  <span>{(stats.tokensIn + stats.tokensOut).toLocaleString()} tok</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// === Helpers ==========================================================

function StatBox({ label, value, tone, icon }: { label: string; value: string | number; tone?: 'ok' | 'danger'; icon?: string }) {
  const colorClass = tone === 'ok' ? 'text-status-ok' : tone === 'danger' ? 'text-status-danger' : ''
  return (
    <div className="border rounded p-3 text-center">
      <div className={`text-2xl font-bold ${colorClass}`}>
        {icon === 'dollar' && '$'}
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}
