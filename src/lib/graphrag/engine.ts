/**
 * GraphRAG — Fase 1.4 (refactor Fase 1.1)
 *
 * Hybrid Retrieval Engine: unisce pgvector (somiglianza) + AGE/relazionale (relazioni).
 *
 * Pipeline: Query → Vector Search → Graph Expansion → Subgraph Ranking → Context Builder → DynAMO
 *
 * DynAMO riceve un sottografo contestuale, non chunk isolati.
 *
 * Fase 1.1: usa vector-store.ts (pgvector nativo su Postgres, JSON-string su SQLite)
 *           e graph-age.ts (Cypher su AGE, BFS via Prisma su SQLite).
 */

import { db } from '@/lib/db'
import { traverse, getNeighbors } from '@/lib/context-graph/graph'
import { searchSimilar } from '@/lib/vector-store'

// === Vector Search (pgvector se disponibile, fallback JSON) =========
export async function vectorSearch(query: string, options?: {
  topK?: number
  entityType?: string
}): Promise<Array<{ uri: string; entityType: string; score: number; content: string }>> {
  const { embed } = await import("@/lib/embeddings")
  const queryEmbedding = await embed(query)

  const hits = await searchSimilar(queryEmbedding, {
    topK: options?.topK,
    entityType: options?.entityType,
    minScore: 0.3,
  })

  // Arricchisce con content dal Context Graph
  return Promise.all(hits.map(async (h) => {
    const node = await db.graphNode.findUnique({ where: { uri: h.uri } })
    const attrs = node ? JSON.parse(node.attributes) : {}
    const content = attrs.description || attrs.name || node?.uri || ''
    return { uri: h.uri, entityType: h.entityType, score: h.score, content }
  }))
}

// === Graph Expansion (1-2 hop neighbors via AGE se disponibile) =====
export async function graphExpansion(uri: string, maxDepth: number = 2): Promise<{
  nodes: Array<{ uri: string; entityType: string; depth: number }>
  edges: Array<{ from: string; to: string; relation: string }>
}> {
  const traversal = await traverse(uri, { maxDepth, limit: 50 })
  const nodes = traversal.map(t => ({ uri: t.uri, entityType: t.entityType, depth: t.depth }))

  const edges: Array<{ from: string; to: string; relation: string }> = []
  for (const node of nodes) {
    const neighbors = await getNeighbors(node.uri, { direction: 'outgoing', limit: 20 })
    for (const n of neighbors) {
      edges.push({ from: node.uri, to: n.node.uri, relation: n.relation })
    }
  }

  return { nodes, edges: edges.slice(0, 100) }
}

// === Subgraph Ranking ================================================
export function rankSubgraph(
  nodes: Array<{ uri: string; entityType: string; depth: number }>,
  seedScores: Map<string, number>,
): Array<{ uri: string; score: number }> {
  const decay = 0.5
  return nodes
    .map(n => ({
      uri: n.uri,
      score: (seedScores.get(n.uri) || 0) * Math.pow(decay, n.depth),
    }))
    .sort((a, b) => b.score - a.score)
}

// === Context Builder =================================================
export function buildContext(
  rankedNodes: Array<{ uri: string; score: number }>,
  edges: Array<{ from: string; to: string; relation: string }>,
): string {
  const topNodes = rankedNodes.slice(0, 15)

  const nodeLines = topNodes.map((n, i) => `[${i + 1}] ${n.uri} (relevance: ${n.score.toFixed(2)})`)
  const edgeLines = edges
    .filter(e => topNodes.some(n => n.uri === e.from) && topNodes.some(n => n.uri === e.to))
    .map(e => `${e.from} --${e.relation}--> ${e.to}`)

  return `=== Context Subgraph ===
Nodes (top ${topNodes.length}):
${nodeLines.join('\n')}

Relations:
${edgeLines.join('\n')}
=== End Context ===`
}

// === Hybrid Retrieval (main entry point) =============================
export async function hybridRetrieval(query: string, options?: {
  topK?: number
  expansionDepth?: number
  entityType?: string
}): Promise<{
  context: string
  seedNodes: Array<{ uri: string; score: number }>
  subgraphNodes: number
  subgraphEdges: number
}> {
  // Step 1: Vector search (pgvector native se disponibile)
  const vectorResults = await vectorSearch(query, {
    topK: options?.topK || 5,
    entityType: options?.entityType,
  })
  if (vectorResults.length === 0) {
    return { context: 'No relevant context found.', seedNodes: [], subgraphNodes: 0, subgraphEdges: 0 }
  }

  // Step 2: Graph expansion (Cypher via AGE se disponibile, BFS via Prisma altrimenti)
  const seedScores = new Map<string, number>()
  for (const r of vectorResults) seedScores.set(r.uri, r.score)

  const allNodes: Array<{ uri: string; entityType: string; depth: number }> = []
  const allEdges: Array<{ from: string; to: string; relation: string }> = []

  for (const seed of vectorResults.slice(0, 3)) {
    const expansion = await graphExpansion(seed.uri, options?.expansionDepth || 2)
    allNodes.push(...expansion.nodes)
    allEdges.push(...expansion.edges)
  }

  const uniqueNodes = Array.from(new Map(allNodes.map(n => [n.uri, n])).values())

  // Step 3: Rank
  const ranked = rankSubgraph(uniqueNodes, seedScores)

  // Step 4: Build context for DynAMO
  const context = buildContext(ranked, allEdges)

  return {
    context,
    seedNodes: vectorResults.map(r => ({ uri: r.uri, score: r.score })),
    subgraphNodes: uniqueNodes.length,
    subgraphEdges: allEdges.length,
  }
}
