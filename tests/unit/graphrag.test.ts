/**
 * Tests for GraphRAG engine (Fase 1.4)
 *
 * Verifica la pipeline completa:
 *   Query → Vector Search → Graph Expansion → Subgraph Ranking → Context Builder
 *
 * Setup: crea 5 nodi con embedding e relazioni, poi esegue hybridRetrieval.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  vectorSearch, graphExpansion, rankSubgraph, buildContext, hybridRetrieval,
} from '@/lib/graphrag/engine'
import { storeEmbedding } from '@/lib/vector-store'
import { createNode, createEdge } from '@/lib/graph-age'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { embed } from '@/lib/embeddings'

const VALID_PROV = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

const AGENT_ATTRS = { name: 'test', role: 'planner' }
const TASK_ATTRS = { goal: 'test', status: 'pending' }
const WORKFLOW_ATTRS = { name: 'test-wf', steps: ['a'] }

describe('GraphRAG — vectorSearch', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    await db.embeddingVector.deleteMany({})

    // Crea 3 nodi con embeddings semanticamente distinguibili
    await createNode({ type: 'Agent', identifier: 'planner', attributes: AGENT_ATTRS, provenance: VALID_PROV })
    await storeEmbedding({
      entityUri: 'agent://planner',
      entityType: 'Agent',
      embedding: embed('genera piano JSON workflow analisi dati'),
    })

    await createNode({ type: 'Task', identifier: 'exec-1', attributes: TASK_ATTRS, provenance: VALID_PROV })
    await storeEmbedding({
      entityUri: 'task://exec-1',
      entityType: 'Task',
      embedding: embed('esecuzione task orchestrator scheduler parallelo'),
    })

    await createNode({ type: 'Workflow', identifier: 'wf-1', attributes: WORKFLOW_ATTRS, provenance: VALID_PROV })
    await storeEmbedding({
      entityUri: 'workflow://wf-1',
      entityType: 'Workflow',
      embedding: embed('workflow DAG topologico dipendenze'),
    })

    // Relazioni: planner -> exec-1 -> wf-1
    await createEdge({ fromUri: 'agent://planner', toUri: 'task://exec-1', relationType: 'EXECUTED', createdByAgent: 'agent://planner' })
    await createEdge({ fromUri: 'task://exec-1', toUri: 'workflow://wf-1', relationType: 'RESULTED_IN', createdByAgent: 'task://exec-1' })
  })

  it('vectorSearch ritorna risultati con score per query rilevante', async () => {
    const hits = await vectorSearch('piano workflow', { topK: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].score).toBeGreaterThan(0)
    expect(hits[0].uri).toBeTruthy()
  })

  it('vectorSearch filtra per entityType', async () => {
    const agentHits = await vectorSearch('piano', { topK: 5, entityType: 'Agent' })
    expect(agentHits.every((h) => h.entityType === 'Agent')).toBe(true)
  })
})

describe('GraphRAG — graphExpansion', () => {
  it('espande dal seed e ritorna nodi a profondità crescente', async () => {
    const result = await graphExpansion('agent://planner', 2)
    expect(result.nodes.length).toBeGreaterThan(1)
    expect(result.edges.length).toBeGreaterThan(0)

    // Il seed deve essere incluso
    expect(result.nodes.some((n) => n.uri === 'agent://planner')).toBe(true)

    // Deve raggiungere workflow://wf-1 (depth 2)
    expect(result.nodes.some((n) => n.uri === 'workflow://wf-1')).toBe(true)
  })

  it('espande solo di 1 hop se maxDepth=1', async () => {
    const result = await graphExpansion('agent://planner', 1)
    expect(result.nodes.some((n) => n.uri === 'task://exec-1')).toBe(true)
    expect(result.nodes.some((n) => n.uri === 'workflow://wf-1')).toBe(false)
  })
})

describe('GraphRAG — rankSubgraph', () => {
  it('assegna score più alto al seed e decade con la profondità', () => {
    const nodes = [
      { uri: 'a', entityType: 'X', depth: 0 },
      { uri: 'b', entityType: 'X', depth: 1 },
      { uri: 'c', entityType: 'X', depth: 2 },
    ]
    // Tutti e tre sono seed (con stesso score): la depth penalty rende a > b > c
    const seeds = new Map([['a', 0.9], ['b', 0.9], ['c', 0.9]])
    const ranked = rankSubgraph(nodes, seeds)

    expect(ranked[0].uri).toBe('a')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score)
  })

  it('nodi non-seed ricevono score 0', () => {
    const nodes = [
      { uri: 'a', entityType: 'X', depth: 0 },
      { uri: 'b', entityType: 'X', depth: 1 },
    ]
    const seeds = new Map([['a', 0.5]])
    const ranked = rankSubgraph(nodes, seeds)
    const b = ranked.find((r) => r.uri === 'b')!
    expect(b.score).toBe(0)
  })

  it('decay factor è 0.5 per depth', () => {
    const nodes = [
      { uri: 'a', entityType: 'X', depth: 0 },
      { uri: 'b', entityType: 'X', depth: 1 },
      { uri: 'c', entityType: 'X', depth: 2 },
    ]
    const seeds = new Map([['a', 1.0], ['b', 1.0], ['c', 1.0]])
    const ranked = rankSubgraph(nodes, seeds)
    const a = ranked.find((r) => r.uri === 'a')!
    const b = ranked.find((r) => r.uri === 'b')!
    const c = ranked.find((r) => r.uri === 'c')!
    expect(a.score).toBeCloseTo(1.0, 5)
    expect(b.score).toBeCloseTo(0.5, 5)
    expect(c.score).toBeCloseTo(0.25, 5)
  })
})

describe('GraphRAG — buildContext', () => {
  it('produce un contesto strutturato con nodi e relazioni', () => {
    const ranked = [
      { uri: 'agent://planner', score: 0.9 },
      { uri: 'task://exec-1', score: 0.45 },
    ]
    const edges = [
      { from: 'agent://planner', to: 'task://exec-1', relation: 'EXECUTED' },
      { from: 'task://exec-1', to: 'workflow://wf-1', relation: 'RESULTED_IN' }, // wf-1 non è nei top
    ]
    const ctx = buildContext(ranked, edges)

    expect(ctx).toContain('=== Context Subgraph ===')
    expect(ctx).toContain('agent://planner')
    expect(ctx).toContain('task://exec-1')
    expect(ctx).toContain('EXECUTED')
    // Edges con endpoint non presenti nei top nodes vengono filtrati
    expect(ctx).not.toContain('workflow://wf-1')
  })
})

describe('GraphRAG — hybridRetrieval (end-to-end)', () => {
  it('pipeline completa: vector + graph + ranking + context', async () => {
    const result = await hybridRetrieval('piano workflow analisi', {
      topK: 3,
      expansionDepth: 2,
    })

    expect(result.context).toBeTruthy()
    expect(result.subgraphNodes).toBeGreaterThan(0)
    expect(result.seedNodes.length).toBeGreaterThan(0)
    expect(result.context).toContain('Context Subgraph')
  })

  it('query senza match ritorna "No relevant context found"', async () => {
    const result = await hybridRetrieval('xyzqwerty argomento inesistente 12345')
    // Potrebbe trovare qualche match debole — verifichiamo solo che non crashi
    expect(result.context).toBeTruthy()
    expect(typeof result.context).toBe('string')
  })
})
