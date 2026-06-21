'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import {
  RefreshCw, Loader2, ChevronDown, Filter, Clock,
  CheckCircle2, XCircle, AlertTriangle, Info, Zap, Brain, Shield, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

// === Types ===
type LogEntry = {
  id: string
  agentId: string
  phase: string
  event: string
  payload: string | null
  level: string  // info | warn | error
  timestamp: string
}

type FilterKey = 'all' | string

const PHASES_AVAILABLE = [
  { id: 'all', label: 'Tutte le fasi' },
  { id: '1', label: 'P1 · Memory' },
  { id: '2', label: 'P2 · Planner' },
  { id: '3', label: 'P3 · Steering' },
  { id: '4', label: 'P4 · Verify' },
  { id: '5', label: 'P5 · Reflect' },
  { id: '6', label: 'P6 · Context' },
  { id: '7', label: 'P7 · Trace' },
  { id: '8', label: 'P8 · Lean' },
  { id: '9', label: 'P9 · Retainer' },
  { id: '10', label: 'P10 · Encapsulator' },
  { id: '11', label: 'P11 · Affect' },
  { id: '12', label: 'P12 · Objective' },
  { id: '13', label: 'P13 · Swarm' },
  { id: '14', label: 'P14 · Router' },
]

const LEVELS = [
  { id: 'all', label: 'Tutti', color: 'bg-muted-foreground' },
  { id: 'info', label: 'Info', color: 'bg-sky-500' },
  { id: 'warn', label: 'Warn', color: 'bg-amber-500' },
  { id: 'error', label: 'Error', color: 'bg-red-500' },
]

// Event type categorization (for icon + color)
function categorizeEvent(event: string): { icon: typeof Info; color: string; category: string } {
  const e = event.toLowerCase()
  if (e.includes('plan') || e.includes('generate')) return { icon: Brain, color: '#8b5cf6', category: 'plan' }
  if (e.includes('exec') || e.includes('task_')) return { icon: Zap, color: '#10b981', category: 'execute' }
  if (e.includes('verif') || e.includes('ltl') || e.includes('check')) return { icon: Shield, color: '#ef4444', category: 'verify' }
  if (e.includes('block') || e.includes('reject')) return { icon: AlertTriangle, color: '#f59e0b', category: 'block' }
  if (e.includes('resolv') || e.includes('approv')) return { icon: CheckCircle2, color: '#10b981', category: 'resolve' }
  if (e.includes('reflect') || e.includes('heuristic')) return { icon: Sparkles, color: '#ec4899', category: 'reflect' }
  return { icon: Info, color: '#0ea5e9', category: 'info' }
}

const LEVEL_COLOR: Record<string, string> = {
  info: '#0ea5e9',
  warn: '#f59e0b',
  error: '#ef4444',
}

// === Main TimelineView ===
export function TimelineView() {
  const { setSelectedItem } = useStore()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [phaseFilter, setPhaseFilter] = useState<FilterKey>('all')
  const [agentFilter, setAgentFilter] = useState<FilterKey>('all')
  const [levelFilter, setLevelFilter] = useState<FilterKey>('all')
  const [selectedLog, setSelectedLog] = useState<string | null>(null)

  // === Load logs ===
  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/cockpit?tab=log')
      const d = await r.json()
      setLogs(d.logs || [])
    } catch {
      toast.error('Errore caricamento log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // === Available agents (derived from logs) ===
  const agents = useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => set.add(l.agentId))
    return ['all', ...Array.from(set).sort()]
  }, [logs])

  // === Apply filters ===
  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (phaseFilter !== 'all' && l.phase !== phaseFilter) return false
      if (agentFilter !== 'all' && l.agentId !== agentFilter) return false
      if (levelFilter !== 'all' && l.level !== levelFilter) return false
      return true
    })
  }, [logs, phaseFilter, agentFilter, levelFilter])

  // === Compute timeline layout ===
  // We render events chronologically (oldest left, newest right) on a horizontal SVG.
  const layout = useMemo(() => {
    if (filtered.length === 0) return { points: [], minTime: 0, maxTime: 1, lanes: [] as string[] }

    // Reverse to chronological order (oldest first)
    const chronological = [...filtered].reverse()

    // Group by agentId for lane assignment
    const laneSet = new Set<string>()
    chronological.forEach((l) => laneSet.add(l.agentId))
    const lanes = Array.from(laneSet).sort()

    const times = chronological.map((l) => new Date(l.timestamp).getTime())
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const span = Math.max(maxTime - minTime, 1) // avoid divide by 0

    const points = chronological.map((l, i) => {
      const t = new Date(l.timestamp).getTime()
      const x = ((t - minTime) / span) * 100 // 0-100% horizontal position
      const lane = lanes.indexOf(l.agentId)
      const y = lane / Math.max(lanes.length - 1, 1) // 0-1 vertical position
      const cat = categorizeEvent(l.event)
      return {
        log: l,
        x,
        y,
        color: cat.color,
        category: cat.category,
      }
    })

    return { points, minTime, maxTime, lanes }
  }, [filtered])

  // === Time scale ticks ===
  const timeTicks = useMemo(() => {
    if (filtered.length === 0) return []
    const span = layout.maxTime - layout.minTime
    const tickCount = 5
    return Array.from({ length: tickCount + 1 }, (_, i) => {
      const t = layout.minTime + (span * i) / tickCount
      return {
        x: (i / tickCount) * 100,
        label: new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }
    })
  }, [layout, filtered.length])

  const handleRefresh = () => {
    load()
    toast.success('Timeline aggiornata')
  }

  const handleClickPoint = (log: LogEntry) => {
    setSelectedLog(log.id)
    setSelectedItem({ type: 'log', view: 'timeline', id: log.id, meta: { event: log.event, agentId: log.agentId, phase: log.phase } })
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="flex items-center gap-3">
          <Clock className="size-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Timeline</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Eventi agent scrubbable · click su un evento per ispezionarlo
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs hover:bg-accent transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Aggiorna
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
        <Filter className="size-3.5 text-muted-foreground" />
        <FilterDropdown
          label="Fase"
          value={phaseFilter}
          options={PHASES_AVAILABLE.map((p) => ({ id: p.id, label: p.label }))}
          onChange={setPhaseFilter}
        />
        <FilterDropdown
          label="Agente"
          value={agentFilter}
          options={agents.map((a) => ({ id: a, label: a === 'all' ? 'Tutti gli agenti' : a }))}
          onChange={setAgentFilter}
        />
        <FilterDropdown
          label="Livello"
          value={levelFilter}
          options={LEVELS.map((l) => ({ id: l.id, label: l.label }))}
          onChange={setLevelFilter}
        />
        <div className="ml-auto text-[10px] text-muted-foreground font-mono">
          {filtered.length} eventi · {layout.lanes.length} agenti · span {Math.round((layout.maxTime - layout.minTime) / 1000)}s
        </div>
      </div>

      {/* Timeline canvas */}
      <div className="flex-1 min-h-0 mt-3 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-md space-y-3">
              <div className="size-12 mx-auto rounded-xl bg-muted flex items-center justify-center">
                <Clock className="size-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold">Nessun evento</h3>
              <p className="text-xs text-muted-foreground">
                {logs.length === 0
                  ? 'Esegui task nella Console per popolare la timeline.'
                  : 'Nessun evento corrisponde ai filtri selezionati.'}
              </p>
            </div>
          </div>
        ) : (
          <TimelineSVG
            layout={layout}
            timeTicks={timeTicks}
            selectedLog={selectedLog}
            onPointClick={handleClickPoint}
          />
        )}
      </div>

      {/* Detail panel (selected event) */}
      {selectedLog && (
        <div className="shrink-0 border-t pt-3 mt-2">
          {(() => {
            const log = filtered.find((l) => l.id === selectedLog)
            if (!log) return null
            const cat = categorizeEvent(log.event)
            const Icon = cat.icon
            const levelColor = LEVEL_COLOR[log.level] || LEVEL_COLOR.info
            return (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="size-6 rounded-md flex items-center justify-center" style={{ backgroundColor: cat.color + '20' }}>
                    <Icon className="size-3.5" style={{ color: cat.color }} />
                  </div>
                  <span className="text-sm font-medium">{log.event}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold uppercase"
                    style={{ backgroundColor: levelColor + '20', color: levelColor }}
                  >
                    {log.level}
                  </span>
                  <button
                    onClick={() => setSelectedLog(null)}
                    className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    ✕ chiudi
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Agente</div>
                    <div className="font-mono">{log.agentId}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Fase</div>
                    <div className="font-mono">P{log.phase}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Timestamp</div>
                    <div className="font-mono">{new Date(log.timestamp).toLocaleString('it-IT')}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Categoria</div>
                    <div className="font-mono capitalize">{cat.category}</div>
                  </div>
                </div>
                {log.payload && (
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Payload</div>
                    <pre className="text-[10px] font-mono bg-zinc-950 text-zinc-300 p-2 rounded max-h-32 overflow-auto">
                      {log.payload}
                    </pre>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// === Timeline SVG (custom, no library) ===
function TimelineSVG({
  layout,
  timeTicks,
  selectedLog,
  onPointClick,
}: {
  layout: { points: Array<{ log: LogEntry; x: number; y: number; color: string; category: string }>; lanes: string[] }
  timeTicks: Array<{ x: number; label: string }>
  selectedLog: string | null
  onPointClick: (log: LogEntry) => void
}) {
  const lanes = layout.lanes
  const laneHeight = lanes.length > 0 ? 100 / Math.max(lanes.length, 1) : 100
  const padding = { top: 20, right: 20, bottom: 30, left: 80 }

  return (
    <div className="relative flex-1 min-h-0 border rounded-md bg-card overflow-hidden">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        style={{ vectorEffect: 'non-scaling-stroke' }}
      >
        {/* Lane separators (horizontal lines for each agent) */}
        {lanes.map((lane, i) => {
          const y = padding.top + (i * laneHeight)
          return (
            <line
              key={`lane-${lane}`}
              x1={padding.left}
              y1={y}
              x2={100 - padding.right}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={0.2}
            />
          )
        })}

        {/* Lane labels (agent IDs) */}
        {lanes.map((lane, i) => {
          const y = padding.top + (i * laneHeight) + laneHeight / 2
          return (
            <text
              key={`lane-label-${lane}`}
              x={padding.left - 4}
              y={y}
              fontSize={2.5}
              fill="currentColor"
              fillOpacity={0.6}
              textAnchor="end"
              dominantBaseline="middle"
              fontFamily="monospace"
            >
              {lane.slice(0, 12)}
            </text>
          )
        })}

        {/* Time axis */}
        <line
          x1={padding.left}
          y1={100 - padding.bottom}
          x2={100 - padding.right}
          y2={100 - padding.bottom}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={0.3}
        />

        {/* Time ticks */}
        {timeTicks.map((tick, i) => (
          <g key={`tick-${i}`}>
            <line
              x1={padding.left + (tick.x / 100) * (100 - padding.left - padding.right)}
              y1={100 - padding.bottom}
              x2={padding.left + (tick.x / 100) * (100 - padding.left - padding.right)}
              y2={100 - padding.bottom + 1}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeWidth={0.2}
            />
            <text
              x={padding.left + (tick.x / 100) * (100 - padding.left - padding.right)}
              y={100 - padding.bottom + 4}
              fontSize={2}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="middle"
              fontFamily="monospace"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Connecting line through all events in chronological order */}
        {layout.points.length > 1 && (
          <polyline
            points={layout.points.map((p) => {
              const x = padding.left + (p.x / 100) * (100 - padding.left - padding.right)
              const y = padding.top + p.y * (100 - padding.top - padding.bottom)
              return `${x},${y}`
            }).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={0.3}
          />
        )}

        {/* Event points */}
        {layout.points.map((p) => {
          const x = padding.left + (p.x / 100) * (100 - padding.left - padding.right)
          const y = padding.top + p.y * (100 - padding.top - padding.bottom)
          const isSelected = p.log.id === selectedLog
          return (
            <g key={p.log.id} className="cursor-pointer" onClick={() => onPointClick(p.log)}>
              {/* Halo for selected */}
              {isSelected && (
                <circle
                  cx={x}
                  cy={y}
                  r={2.5}
                  fill={p.color}
                  fillOpacity={0.2}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 1.6 : 1.1}
                fill={p.color}
                stroke="white"
                strokeWidth={0.2}
                className="transition-all"
              />
            </g>
          )
        })}
      </svg>

      {/* HTML overlay for hover tooltips (more reliable than SVG text on hover) */}
      <div className="absolute inset-0 pointer-events-none">
        {layout.points.map((p) => {
          const x = `${padding.left + (p.x / 100) * (100 - padding.left - padding.right)}%`
          const y = `${padding.top + p.y * (100 - padding.top - padding.bottom)}%`
          const isSelected = p.log.id === selectedLog
          return (
            <div
              key={`tip-${p.log.id}`}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-popover border shadow-sm',
                'text-[10px] font-mono whitespace-nowrap',
                'pointer-events-auto cursor-pointer',
                'transition-opacity',
                isSelected ? 'opacity-100 z-10' : 'opacity-0 hover:opacity-100'
              )}
              style={{ left: x, top: y, transform: 'translate(-50%, -150%)' }}
              onClick={() => onPointClick(p.log)}
            >
              <span className="text-muted-foreground">P{p.log.phase}</span>{' '}
              <span className="font-medium">{p.log.event}</span>
              <div className="text-[9px] text-muted-foreground">
                {new Date(p.log.timestamp).toLocaleTimeString('it-IT')}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// === Filter dropdown ===
function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.id === value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] hover:bg-accent transition-colors"
      >
        <span className="text-muted-foreground">{label}:</span>
        <span className="font-medium truncate max-w-[120px]">{selected?.label || 'Tutti'}</span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-56 max-h-72 overflow-y-auto bg-popover border rounded-md shadow-lg z-20 p-1">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors',
                  o.id === value && 'bg-primary/10 font-medium'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
