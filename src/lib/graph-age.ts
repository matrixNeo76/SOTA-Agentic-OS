/**
 * graph-age.ts — Fase 1.1 / 1.2
 *
 * Façade per le operazioni sul Context Graph.
 * Su PostgreSQL + Apache AGE usa Cypher nativo (performance + espressività).
 * Su SQLite ricade sulle tabelle relazionali GraphNode/GraphEdge via Prisma.
 *
 * Il path SQLite è quello già funzionante in src/lib/context-graph/graph.ts.
 * Questo modulo espone la stessa API ma instrada dinamicamente.
 */

import { db } from '@/lib/db'
import { ageCypher, hasAge } from '@/lib/db-runtime'
import {
  buildUri, validateEntityCreation, validateUriForType,
  validateProvenance,
  type EntityType, type LifecycleState,
  type Provenance,
} from '@/lib/governance'

export interface GraphNodeRecord {
  id: string
  uri: string
  entityType: string
  lifecycleState: string
  attributes: Record<string, unknown>
  provenance: Provenance
  createdAt: Date
  updatedAt: Date
  version: number
}

export interface GraphEdgeRecord {
  id: string
  fromUri: string
  toUri: string
  relationType: string
  properties: Record<string, unknown>
  createdByAgent: string
  createdAt: Date
}

// === Create Node =====================================================

export async function createNode(params: {
  type: EntityType
  identifier: string
  attributes?: Record<string, unknown>
  provenance: Provenance
  lifecycleState?: LifecycleState
}): Promise<{ id: string; uri: string }> {
  // Fase 1.3 — enforcement runtime della provenance.
  // La validazione è duplicata rispetto al type system perché i consumer
  // possono costruire params dinamicamente (es. da JSON di API request).
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  const uri = buildUri(params.type, params.identifier)
  const validation = validateUriForType(uri, params.type)
  if (!validation.valid) throw new Error(validation.reason!)

  const attrValidation = validateEntityCreation(params.type, params.attributes || {})
  if (!attrValidation.valid) {
    throw new Error(`Missing required attributes: ${attrValidation.missing.join(', ')}`)
  }

  // Path relazionale (SQLite o Postgres senza AGE) — stesso codice di graph.ts
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

  // Mirror su AGE se disponibile (best-effort — il grafo relazionale rimane
  // source of truth per governance/provenance; AGE serve solo per query Cypher).
  if (await hasAge()) {
    try {
      await ageCypher(`
        CREATE (n:${params.type} {
          uri: $uri,
          entityType: $entityType,
          lifecycleState: $lifecycleState,
          createdByAgent: $createdByAgent,
          source: $source,
          confidence: $confidence
        })
      `, {
        uri,
        entityType: params.type,
        lifecycleState: params.lifecycleState || 'draft',
        createdByAgent: params.provenance.createdByAgent,
        source: params.provenance.source,
        confidence: params.provenance.confidence,
      })
    } catch (err) {
      // Non bloccante: il grafo relazionale è già aggiornato.
      console.warn('[graph-age] AGE mirror failed (non-blocking):', err)
    }
  }

  return { id: node.id, uri: node.uri }
}

// === Create Edge =====================================================

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

  // Mirror su AGE
  if (await hasAge()) {
    try {
      await ageCypher(`
        MATCH (a {uri: $fromUri}), (b {uri: $toUri})
        CREATE (a)-[r:${params.relationType} {createdByAgent: $agent}]->(b)
      `, {
        fromUri: params.fromUri,
        toUri: params.toUri,
        agent: params.createdByAgent,
      })
    } catch (err) {
      console.warn('[graph-age] AGE edge mirror failed (non-blocking):', err)
    }
  }

  return { id: edge.id }
}

// === Get Node ========================================================

export async function getNode(uri: string): Promise<GraphNodeRecord | null> {
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
      source: node.source as Provenance['source'],
      confidence: node.confidence,
      timestamp: node.provenanceTs.toISOString(),
    },
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    version: node.version,
  }
}

// === Get Neighbors (1-hop) ===========================================

export async function getNeighbors(uri: string, options?: {
  relationType?: string
  direction?: 'outgoing' | 'incoming' | 'both'
  limit?: number
}): Promise<Array<{ node: GraphNodeRecord; relation: string; direction: 'out' | 'in' }>> {
  // Sempre via Prisma (le relazioni sono poche, non serve Cypher)
  const node = await db.graphNode.findUnique({
    where: { uri },
    include: {
      edgesFrom: { include: { toNode: true }, take: options?.limit || 50 },
      edgesTo: { include: { fromNode: true }, take: options?.limit || 50 },
    },
  })
  if (!node) return []

  const results: Array<{ node: GraphNodeRecord; relation: string; direction: 'out' | 'in' }> = []
  const dir = options?.direction || 'both'
  const relFilter = options?.relationType

  if (dir === 'outgoing' || dir === 'both') {
    for (const edge of node.edgesFrom) {
      if (relFilter && edge.relationType !== relFilter) continue
      results.push({
        node: (await getNode(edge.toNode.uri))!,
        relation: edge.relationType,
        direction: 'out',
      })
    }
  }

  if (dir === 'incoming' || dir === 'both') {
    for (const edge of node.edgesTo) {
      if (relFilter && edge.relationType !== relFilter) continue
      results.push({
        node: (await getNode(edge.fromNode.uri))!,
        relation: edge.relationType,
        direction: 'in',
      })
    }
  }

  return results
}

// === Multi-hop traversal (BFS) — Cypher se disponibile ===============

export async function traverse(uri: string, options: {
  maxDepth: number
  relationType?: string
  limit?: number
}): Promise<Array<{ uri: string; entityType: string; depth: number; path: string[] }>> {
  // Path AGE: variabile di lunghezza path Cypher (efficiente)
  if (await hasAge() && !options.relationType) {
    try {
      const rows = await ageCypher<{ uri: string; entityType: string; depth: number; path: string[] }>(`
        MATCH p = (n {uri: $uri})-[*1..${Math.min(options.maxDepth, 5)}]->(m)
        WITH m, length(p) AS depth, [x IN nodes(p) | x.uri] AS path
        RETURN m.uri AS uri, m.entityType AS entityType, depth, path
        LIMIT ${options.limit || 100}
      `, { uri })

      // Aggiungi il nodo seed come depth 0
      const seed = await getNode(uri)
      const result: Array<{ uri: string; entityType: string; depth: number; path: string[] }> = []
      if (seed) result.push({ uri, entityType: seed.entityType, depth: 0, path: [uri] })
      result.push(...rows)
      return result.slice(0, options.limit || 100)
    } catch (err) {
      console.warn('[graph-age] AGE traversal failed, fallback to BFS:', err)
    }
  }

  // Fallback BFS via Prisma (path esistente in context-graph/graph.ts)
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

// === Pattern matching via Cypher (solo AGE) ==========================

/**
 * Esegue una query Cypher arbitraria sul grafo.
 *
 * ATTENZIONE: il parametro `cypher` NON deve mai contenere input utente
 * non sanitizzato. Il chiamante è responsabile di costruire il Cypher
 * con i parametri `$xxx` (passati in `params`).
 */
export async function cypherQuery<T = unknown>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  return ageCypher<T>(cypher, params)
}

// === Update Node Lifecycle ===========================================

export async function updateNodeLifecycle(
  uri: string,
  newState: LifecycleState,
  actor: string,
  reason?: string,
): Promise<void> {
  const node = await db.graphNode.findUnique({ where: { uri } })
  if (!node) throw new Error(`Node not found: ${uri}`)

  const { validateLifecycleTransition } = await import('@/lib/governance')
  const transition = validateLifecycleTransition(node.lifecycleState as LifecycleState, newState)
  if (!transition.valid) throw new Error(transition.reason!)

  const history = JSON.parse(node.attributes)
  const lifecycleHistory = (history._lifecycleHistory as any[]) || []
  lifecycleHistory.push({
    from: node.lifecycleState,
    to: newState,
    timestamp: new Date().toISOString(),
    actor,
    reason,
  })

  await db.graphNode.update({
    where: { uri },
    data: {
      lifecycleState: newState,
      attributes: JSON.stringify({ ...history, _lifecycleHistory: lifecycleHistory }),
      updatedAt: new Date(),
    },
  })

  // Mirror su AGE (best-effort)
  if (await hasAge()) {
    try {
      await ageCypher(`
        MATCH (n {uri: $uri})
        SET n.lifecycleState = $state
      `, { uri, state: newState })
    } catch (err) {
      console.warn('[graph-age] AGE lifecycle mirror failed (non-blocking):', err)
    }
  }
}

// === Query Nodes (filter by type/state) ==============================

export async function queryNodes(params: {
  entityType?: string
  lifecycleState?: string
  limit?: number
  offset?: number
}): Promise<Array<{
  id: string
  uri: string
  entityType: string
  lifecycleState: string
  attributes: string
  createdAt: Date
  updatedAt: Date
}>> {
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

// === Stats ===========================================================

export async function graphStats(): Promise<{
  totalNodes: number
  totalEdges: number
  nodesByType: Record<string, number>
}> {
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
