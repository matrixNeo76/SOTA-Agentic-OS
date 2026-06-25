/**
 * Context Graph — Fase 1.2
 *
 * Universal Context Graph su Apache AGE (PostgreSQL) con fallback relazionale (SQLite).
 *
 * Nodi iniziali: Agent, Task, Workflow, Document, Conversation, Decision,
 * Experience, Skill, Tool, Event, Claim, Evidence, Source, Conflict.
 *
 * Relazioni: EXECUTED, GENERATED, RESULTED_IN, LEARNED_FROM, RELATED_TO, TRIGGERED.
 *
 * Popola il grafo dagli eventi che il kernel già emette.
 */

import { db } from '@/lib/db'
import {
  buildUri, validateEntityCreation, validateUriForType,
  type EntityType, type LifecycleState,
} from '@/lib/governance'
import { createProvenance, type Provenance } from '@/lib/governance'

// === Create Node ===
export async function createNode(params: {
  type: EntityType
  identifier: string
  attributes?: Record<string, unknown>
  provenance: Provenance
  lifecycleState?: LifecycleState
}): Promise<{ id: string; uri: string }> {
  const uri = buildUri(params.type, params.identifier)
  const validation = validateUriForType(uri, params.type)
  if (!validation.valid) throw new Error(validation.reason!)

  const attrValidation = validateEntityCreation(params.type, params.attributes || {})
  if (!attrValidation.valid) throw new Error(`Missing required attributes: ${attrValidation.missing.join(', ')}`)

  const existing = await db.graphNode.findUnique({ where: { uri } })
  if (existing) throw new Error(`Node with URI ${uri} already exists`)

  const node = await db.graphNode.create({
    data: {
      uri,
      entityType: params.type,
      lifecycleState: params.lifecycleState || 'draft',
      attributes: JSON.stringify(params.attributes || {}),
      createdByAgent: params.provenance.createdByAgent,
      createdByModel: params.provenance.createdByModel || null,
      source: params.provenance.source,
      confidence: params.provenance.confidence,
      provenanceTs: new Date(params.provenance.timestamp),
    },
  })

  return { id: node.id, uri: node.uri }
}

// === Create Edge ===
export async function createEdge(params: {
  fromUri: string
  toUri: string
  relationType: string
  createdByAgent: string
  properties?: Record<string, unknown>
}): Promise<{ id: string }> {
  const fromNode = await db.graphNode.findUnique({ where: { uri: params.fromUri } })
  const toNode = await db.graphNode.findUnique({ where: { uri: params.toUri } })
  if (!fromNode) throw new Error(`Source node not found: ${params.fromUri}`)
  if (!toNode) throw new Error(`Target node not found: ${params.toUri}`)

  const edge = await db.graphEdge.create({
    data: {
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      relationType: params.relationType,
      properties: JSON.stringify(params.properties || {}),
      createdByAgent: params.createdByAgent,
    },
  })

  return { id: edge.id }
}

// === Get Node ===
export async function getNode(uri: string) {
  const node = await db.graphNode.findUnique({ where: { uri } })
  if (!node) return null
  return {
    id: node.id,
    uri: node.uri,
    entityType: node.entityType,
    lifecycleState: node.lifecycleState,
    attributes: JSON.parse(node.attributes),
    provenance: {
      createdByAgent: node.createdByAgent,
      createdByModel: node.createdByModel || undefined,
      source: node.source,
      confidence: node.confidence,
      timestamp: node.provenanceTs.toISOString(),
    },
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    version: node.version,
  }
}

// === Get Neighbors (1-hop traversal) ===
export async function getNeighbors(uri: string, options?: {
  relationType?: string
  direction?: 'outgoing' | 'incoming' | 'both'
  limit?: number
}): Promise<Array<{ node: any; relation: string; direction: 'out' | 'in' }>> {
  const node = await db.graphNode.findUnique({
    where: { uri },
    include: {
      edgesFrom: { include: { toNode: true }, take: options?.limit || 50 },
      edgesTo: { include: { fromNode: true }, take: options?.limit || 50 },
    },
  })
  if (!node) return []

  const results: Array<{ node: any; relation: string; direction: 'out' | 'in' }> = []
  const dir = options?.direction || 'both'
  const relFilter = options?.relationType

  if (dir === 'outgoing' || dir === 'both') {
    for (const edge of node.edgesFrom) {
      if (relFilter && edge.relationType !== relFilter) continue
      results.push({
        node: { uri: edge.toNode.uri, entityType: edge.toNode.entityType, attributes: JSON.parse(edge.toNode.attributes) },
        relation: edge.relationType,
        direction: 'out',
      })
    }
  }

  if (dir === 'incoming' || dir === 'both') {
    for (const edge of node.edgesTo) {
      if (relFilter && edge.relationType !== relFilter) continue
      results.push({
        node: { uri: edge.fromNode.uri, entityType: edge.fromNode.entityType, attributes: JSON.parse(edge.fromNode.attributes) },
        relation: edge.relationType,
        direction: 'in',
      })
    }
  }

  return results
}

// === Multi-hop traversal (BFS) ===
export async function traverse(uri: string, options: {
  maxDepth: number
  relationType?: string
  limit?: number
}): Promise<Array<{ uri: string; entityType: string; depth: number; path: string[] }>> {
  const visited = new Set<string>()
  const results: Array<{ uri: string; entityType: string; depth: number; path: string[] }> = []
  const queue: Array<{ uri: string; depth: number; path: string[] }> = [{ uri, depth: 0, path: [uri] }]
  const limit = options.limit || 100

  while (queue.length > 0 && results.length < limit) {
    const current = queue.shift()!
    if (visited.has(current.uri)) continue
    visited.add(current.uri)

    const node = await db.graphNode.findUnique({ where: { uri: current.uri } })
    if (!node) continue

    results.push({ uri: current.uri, entityType: node.entityType, depth: current.depth, path: current.path })

    if (current.depth >= options.maxDepth) continue

    const neighbors = await getNeighbors(current.uri, { relationType: options.relationType, direction: 'outgoing' })
    for (const n of neighbors) {
      if (!visited.has(n.node.uri)) {
        queue.push({ uri: n.node.uri, depth: current.depth + 1, path: [...current.path, n.node.uri] })
      }
    }
  }

  return results
}

// === Update Node Lifecycle ===
export async function updateNodeLifecycle(uri: string, newState: LifecycleState, actor: string, reason?: string) {
  const node = await db.graphNode.findUnique({ where: { uri } })
  if (!node) throw new Error(`Node not found: ${uri}`)

  const { validateLifecycleTransition } = await import('@/lib/governance')
  const transition = validateLifecycleTransition(node.lifecycleState as LifecycleState, newState)
  if (!transition.valid) throw new Error(transition.reason)

  const history = JSON.parse(node.attributes)
  const lifecycleHistory = (history._lifecycleHistory as any[]) || []
  lifecycleHistory.push({ from: node.lifecycleState, to: newState, timestamp: new Date().toISOString(), actor, reason })

  return db.graphNode.update({
    where: { uri },
    data: {
      lifecycleState: newState,
      attributes: JSON.stringify({ ...history, _lifecycleHistory: lifecycleHistory }),
      updatedAt: new Date(),
    },
  })
}

// === Query by entity type ===
export async function queryNodes(params: {
  entityType?: string
  lifecycleState?: string
  limit?: number
  offset?: number
}) {
  return db.graphNode.findMany({
    where: {
      ...(params.entityType && { entityType: params.entityType }),
      ...(params.lifecycleState && { lifecycleState: params.lifecycleState }),
    },
    take: params.limit || 50,
    skip: params.offset || 0,
    orderBy: { createdAt: 'desc' },
  })
}

// === Graph Stats ===
export async function graphStats() {
  const [totalNodes, totalEdges, nodesByType] = await Promise.all([
    db.graphNode.count(),
    db.graphEdge.count(),
    db.graphNode.groupBy({ by: ['entityType'], _count: true }),
  ])

  return {
    totalNodes,
    totalEdges,
    nodesByType: nodesByType.reduce((acc, n) => ({ ...acc, [n.entityType]: n._count }), {} as Record<string, number>),
  }
}
