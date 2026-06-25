/**
 * GraphRAG — Fase 1.4
 *
 * Hybrid Retrieval Engine: unisce pgvector (somiglianza) + AGE/relazionale (relazioni).
 *
 * Pipeline: Query → Vector Search → Graph Expansion → Subgraph Ranking → Context Builder → DynAMO
 *
 * DynAMO riceve un sottografo contestuale, non chunk isolati.
 */

import { db } from '@/lib/db'
import { traverse, getNeighbors } from '@/lib/context-graph/graph'

// === Vector Search (cosine similarity su embedding) ===
export async function vectorSearch(query: string, options?: {
  topK?: number
  entityType?: string
}): Promise<Array<{ uri: string; entityType: string; score: number; content: string }>> {
  // Generate embedding for query (riusa embeddings esistente)
  const { embed } = await import("@/lib/embeddings")
  const queryEmbedding = await embed(query)

  // Get all embeddings (in produzione: pgvector con <=> operator)
  const embeddings = await db.embeddingVector.findMany({
    where: options?.entityType ? { entityType: options.entityType } : undefined,
    take: 1000, // limit per performance
  })

  // Compute cosine similarity
  const scored = embeddings.map(e => {
    const vec = JSON.parse(e.embedding) as number[]
    const score = cosineSimilarity(queryEmbedding, vec)
    return { uri: e.entityUri, entityType: e.entityType, score, content: '' }
  })

  // Sort by score, take top K
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, options?.topK || 5)
    .filter(r => r.score > 0.3) // threshold
}

// === Graph Expansion (1-2 hop neighbors) ===
export async function graphExpansion(uri: string, maxDepth: number = 2): Promise<{
  nodes: Array<{ uri: string; entityType: string; depth: number }>
  edges: Array<{ from: string; to: string; relation: string }>
}> {
  const traversal = await traverse(uri, { maxDepth, limit: 50 })
  const nodes = traversal.map(t => ({ uri: t.uri, entityType: t.entityType, depth: t.depth }))

  // Collect edges
  const edges: Array<{ from: string; to: string; relation: string }> = []
  for (const node of nodes) {
    const neighbors = await getNeighbors(node.uri, { direction: 'outgoing', limit: 20 })
    for (const n of neighbors) {
      edges.push({ from: node.uri, to: n.node.uri, relation: n.relation })
    }
  }

  return { nodes, edges: edges.slice(0, 100) } // cap edges
}

// === Subgraph Ranking ===
export function rankSubgraph(nodes: Array<{ uri: string; entityType: string; depth: number }>, seedScores: Map<string, number>): Array<{ uri: string; score: number }> {
  // Personalized PageRank approximation:
  // score(node) = seedScore(node) * decay^depth + incomingNeighborsContribution
  const decay = 0.5
  const scored = nodes.map(n => {
    const seedScore = seedScores.get(n.uri) || 0
    const depthPenalty = Math.pow(decay, n.depth)
    return { uri: n.uri, score: seedScore * depthPenalty }
  })

  return scored.sort((a, b) => b.score - a.score)
}

// === Context Builder (assembla il sottografo per DynAMO) ===
export function buildContext(rankedNodes: Array<{ uri: string; score: number }>, edges: Array<{ from: string; to: string; relation: string }>): string {
  const topNodes = rankedNodes.slice(0, 15) // top 15 nodes

  // Build a structured context string
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

// === Hybrid Retrieval (main entry point) ===
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
  // Step 1: Vector search
  const vectorResults = await vectorSearch(query, { topK: options?.topK || 5, entityType: options?.entityType })
  if (vectorResults.length === 0) {
    return { context: 'No relevant context found.', seedNodes: [], subgraphNodes: 0, subgraphEdges: 0 }
  }

  // Step 2: Graph expansion from top seed nodes
  const seedScores = new Map<string, number>()
  for (const r of vectorResults) {
    seedScores.set(r.uri, r.score)
  }

  const allNodes: Array<{ uri: string; entityType: string; depth: number }> = []
  const allEdges: Array<{ from: string; to: string; relation: string }> = []

  for (const seed of vectorResults.slice(0, 3)) { // expand from top 3 seeds
    const expansion = await graphExpansion(seed.uri, options?.expansionDepth || 2)
    allNodes.push(...expansion.nodes)
    allEdges.push(...expansion.edges)
  }

  // Deduplicate nodes
  const uniqueNodes = Array.from(new Map(allNodes.map(n => [n.uri, n])).values())

  // Step 3: Rank subgraph
  const ranked = rankSubgraph(uniqueNodes, seedScores)

  // Step 4: Build context
  const context = buildContext(ranked, allEdges)

  return {
    context,
    seedNodes: vectorResults.map(r => ({ uri: r.uri, score: r.score })),
    subgraphNodes: uniqueNodes.length,
    subgraphEdges: allEdges.length,
  }
}

// === Cosine Similarity ===
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
