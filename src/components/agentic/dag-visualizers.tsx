'use client'

import { useMemo, useCallback } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  type Node, type Edge, type NodeProps,
  Handle, Position,
  BackgroundVariant,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// =====================================================
// 1. DAG Visualizer per piani DynAMO (Fase 2)
// =====================================================

type DynAMOTask = {
  taskId: string
  agentId: string
  description: string
  dependencies: string[]
  status?: string
}

type DynAMODagVisualizerProps = {
  tasks: DynAMOTask[]
  batches?: string[][]  // batch topologici
}

const STATUS_COLOR: Record<string, string> = {
  done: '#10b981',
  running: '#0ea5e9',
  failed: '#ef4444',
  pending: '#a3a3a3',
  ready: '#f59e0b',
}

const AGENT_COLOR: Record<string, string> = {
  orchestrator: '#10b981',
  curator: '#0ea5e9',
  controller: '#8b5cf6',
  verifier: '#f59e0b',
  reflective: '#ec4899',
}

function DynAMONode({ data }: NodeProps<any>) {
  const { taskId, agentId, description, status } = data
  const color = STATUS_COLOR[status || 'pending'] || '#a3a3a3'
  return (
    <div
      className="rounded-md border-2 bg-card p-2 shadow-sm min-w-[160px]"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-mono font-bold">{taskId}</span>
        <span
          className="size-1.5 rounded-full ml-auto"
          style={{ backgroundColor: AGENT_COLOR[agentId] || '#a3a3a3' }}
          title={agentId}
        />
      </div>
      <div className="text-[10px] text-muted-foreground line-clamp-2">{description}</div>
      {status && (
        <Badge variant="outline" className="text-[9px] mt-1 py-0" style={{ borderColor: color, color }}>
          {status}
        </Badge>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { dynamo: DynAMONode }

export function DynAMODagVisualizer({ tasks, batches }: DynAMODagVisualizerProps) {
  const { nodes, edges } = useMemo(() => {
    if (!tasks || tasks.length === 0) return { nodes: [], edges: [] }

    // Posiziona i task per batch (orizzontale) e ordine nel batch (verticale)
    const batchMap = new Map<string, number>() // taskId → batch index
    if (batches) {
      batches.forEach((batch, i) => {
        batch.forEach((tid) => batchMap.set(tid, i))
      })
    } else {
      // Se non ci sono batch, usa le dipendenze per livelli
      tasks.forEach((t) => {
        if (t.dependencies.length === 0) batchMap.set(t.taskId, 0)
        else {
          const maxDep = Math.max(...t.dependencies.map((d) => batchMap.get(d) ?? 0))
          batchMap.set(t.taskId, maxDep + 1)
        }
      })
    }

    // Conta task per batch per posizionamento verticale
    const batchCount = new Map<number, number>()
    tasks.forEach((t) => {
      const b = batchMap.get(t.taskId) ?? 0
      batchCount.set(b, (batchCount.get(b) || 0) + 1)
    })
    const batchCursor = new Map<number, number>()

    const nodes: Node[] = tasks.map((t) => {
      const b = batchMap.get(t.taskId) ?? 0
      const cursor = batchCursor.get(b) || 0
      batchCursor.set(b, cursor + 1)
      const total = batchCount.get(b) || 1
      const x = b * 220
      const y = (cursor - total / 2) * 120
      return {
        id: t.taskId,
        type: 'dynamo',
        position: { x, y },
        data: { taskId: t.taskId, agentId: t.agentId, description: t.description, status: t.status },
      }
    })

    const edges: Edge[] = []
    tasks.forEach((t) => {
      t.dependencies.forEach((dep) => {
        edges.push({
          id: `${dep}-${t.taskId}`,
          source: dep,
          target: t.taskId,
          animated: t.status === 'running',
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        })
      })
    })

    return { nodes, edges }
  }, [tasks, batches])

  if (tasks.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
        Nessun task da visualizzare. Genera un piano DynAMO.
      </div>
    )
  }

  return (
    <div className="h-96 border rounded-md bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => STATUS_COLOR[(n.data as any)?.status || 'pending'] || '#a3a3a3'}
          className="!bg-muted/30"
        />
      </ReactFlow>
    </div>
  )
}

// =====================================================
// 2. Objective Tree Visualizer (Fase 12)
// =====================================================

type ObjectiveNodeData = {
  id: string
  description: string
  depth: number
  weight: number
  contextTier: string  // strategic|methodological|implementation
  status: string       // pending|pass|fail|skipped
  parentId: string | null
}

const TIER_NODE_COLOR: Record<string, string> = {
  strategic: '#0ea5e9',
  methodological: '#8b5cf6',
  implementation: '#10b981',
}

const OBJ_STATUS_COLOR: Record<string, string> = {
  pass: '#10b981',
  fail: '#ef4444',
  skipped: '#a3a3a3',
  pending: '#6366f1',
}

function ObjectiveTreeNode({ data }: NodeProps<any>) {
  const { description, depth, weight, contextTier, status } = data
  const tierColor = TIER_NODE_COLOR[contextTier] || '#a3a3a3'
  const statusColor = OBJ_STATUS_COLOR[status] || '#6366f1'
  return (
    <div
      className="rounded-md border-2 bg-card p-2 shadow-sm min-w-[180px] max-w-[240px]"
      style={{ borderColor: status === 'pending' ? tierColor : statusColor }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 mb-1">
        <Badge variant="outline" className="text-[9px] py-0">L{depth}</Badge>
        <Badge variant="outline" className="text-[9px] py-0" style={{ borderColor: tierColor, color: tierColor }}>
          {contextTier}
        </Badge>
        <span className="text-[9px] font-mono text-muted-foreground ml-auto">w={weight.toFixed(3)}</span>
      </div>
      <div className="text-[10px] line-clamp-2 mb-1">{description}</div>
      {status !== 'pending' && (
        <Badge variant="outline" className="text-[9px] py-0" style={{ borderColor: statusColor, color: statusColor }}>
          {status}
        </Badge>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const objNodeTypes = { objective: ObjectiveTreeNode }

export function ObjectiveTreeVisualizer({ nodes: objNodes }: { nodes: ObjectiveNodeData[] }) {
  const { nodes, edges } = useMemo(() => {
    if (!objNodes || objNodes.length === 0) return { nodes: [], edges: [] }

    // Layout gerarchico: conta figli per livello
    const childrenCount = new Map<string, number>()
    objNodes.forEach((n) => {
      if (n.parentId) {
        childrenCount.set(n.parentId, (childrenCount.get(n.parentId) || 0) + 1)
      }
    })
    const childCursor = new Map<string, number>()

    const nodes: Node[] = objNodes.map((n) => {
      const x = n.depth * 240
      let y: number
      if (!n.parentId) {
        y = 0
      } else {
        const total = childrenCount.get(n.parentId) || 1
        const cursor = childCursor.get(n.parentId) || 0
        childCursor.set(n.parentId, cursor + 1)
        y = (cursor - total / 2) * 100
      }
      return {
        id: n.id,
        type: 'objective',
        position: { x, y },
        data: {
          description: n.description,
          depth: n.depth,
          weight: n.weight,
          contextTier: n.contextTier,
          status: n.status,
        },
      }
    })

    const edges: Edge[] = objNodes
      .filter((n) => n.parentId)
      .map((n) => ({
        id: `${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      }))

    return { nodes, edges }
  }, [objNodes])

  if (objNodes.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
        Nessun nodo. Crea un albero in Objective Builder.
      </div>
    )
  }

  return (
    <div className="h-96 border rounded-md bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={objNodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls showInteractive={false} />
        <MiniMap className="!bg-muted/30" />
      </ReactFlow>
    </div>
  )
}

// =====================================================
// 3. Lean4 Workflow Visualizer (Fase 8)
// =====================================================

type LeanContract = {
  taskId: string
  verified: boolean
  preconditions: string[]
  postconditions: string[]
}

function LeanNode({ data }: NodeProps<any>) {
  const { taskId, verified, preCount, postCount } = data
  const color = verified ? '#10b981' : '#ef4444'
  return (
    <div
      className="rounded-md border-2 bg-card p-2 shadow-sm min-w-[140px]"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-mono font-bold">{taskId}</span>
      </div>
      <div className="text-[9px] text-muted-foreground">
        pre: {preCount} · post: {postCount}
      </div>
      <Badge
        variant="outline"
        className="text-[9px] mt-1 py-0"
        style={{ borderColor: color, color }}
      >
        {verified ? 'verified' : 'failed'}
      </Badge>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const leanNodeTypes = { lean: LeanNode }

export function LeanWorkflowVisualizer({
  contracts,
  dependencies,
}: {
  contracts: LeanContract[]
  dependencies: Record<string, string[]>  // taskId → deps
}) {
  const { nodes, edges } = useMemo(() => {
    if (!contracts || contracts.length === 0) return { nodes: [], edges: [] }
    // Ordina per dipendenze topologiche
    const ordered: string[] = []
    const visited = new Set<string>()
    const visit = (tid: string) => {
      if (visited.has(tid)) return
      visited.add(tid)
      const deps = dependencies[tid] || []
      deps.forEach(visit)
      ordered.push(tid)
    }
    contracts.forEach((c) => visit(c.taskId))

    const nodes: Node[] = contracts.map((c, i) => {
      const idx = ordered.indexOf(c.taskId)
      return {
        id: c.taskId,
        type: 'lean',
        position: { x: idx * 200, y: 0 },
        data: {
          taskId: c.taskId,
          verified: c.verified,
          preCount: c.preconditions.length,
          postCount: c.postconditions.length,
        },
      }
    })

    const edges: Edge[] = []
    contracts.forEach((c) => {
      const deps = dependencies[c.taskId] || []
      deps.forEach((dep) => {
        edges.push({
          id: `${dep}-${c.taskId}`,
          source: dep,
          target: c.taskId,
          animated: !c.verified,
          style: { stroke: c.verified ? '#10b981' : '#ef4444', strokeWidth: 1.5 },
        })
      })
    })

    return { nodes, edges }
  }, [contracts, dependencies])

  if (contracts.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
        Nessun contratto. Genera e verifica un workflow in Formal Verifier.
      </div>
    )
  }

  return (
    <div className="h-80 border rounded-md bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={leanNodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls showInteractive={false} />
        <MiniMap className="!bg-muted/30" />
      </ReactFlow>
    </div>
  )
}
