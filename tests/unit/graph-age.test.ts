/**
 * Tests for graph-age.ts (Fase 1.1)
 *
 * Verifica che la façade instradi correttamente sul path SQLite (Prisma).
 * I test AGE nativo sono skippati in dev (PostgreSQL + AGE non disponibile).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createNode, createEdge, getNode, getNeighbors, traverse, graphStats,
  cypherQuery, updateNodeLifecycle,
} from '@/lib/graph-age'
import { db } from '@/lib/db'
import { createProvenance } from '@/lib/governance'

const VALID_PROVENANCE = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

// Helper: attributi minimi validi per ogni tipo (vedi ENTITY_REGISTRY)
const ATTRS = {
  Agent: { name: 'test-agent', role: 'planner' },
  Task: { goal: 'test goal', status: 'pending' },
  Workflow: { name: 'test-wf', steps: ['a', 'b'] },
  Decision: { rationale: 'test', decidedBy: 'agent://test' },
  Experience: { outcome: 'success', context: 'test' },
  Document: { title: 'test', source: 'test', mimeType: 'text/plain' },
}

describe('graph-age — createNode + getNode', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
  })

  it('crea un nodo con provenance valida', async () => {
    const { id, uri } = await createNode({
      type: 'Agent',
      identifier: 'planner-test',
      attributes: ATTRS.Agent,
      provenance: VALID_PROVENANCE,
    })

    expect(id).toBeTruthy()
    expect(uri).toBe('agent://planner-test')

    const node = await getNode(uri)
    expect(node).not.toBeNull()
    expect(node!.entityType).toBe('Agent')
    expect(node!.lifecycleState).toBe('draft')
    expect(node!.attributes).toMatchObject(ATTRS.Agent)
    expect(node!.provenance.createdByAgent).toBe('agent://test')
    expect(node!.provenance.source).toBe('system-event')
  })

  it('rifiuta nodo duplicato (URI collision)', async () => {
    await createNode({
      type: 'Agent',
      identifier: 'dup-agent',
      attributes: ATTRS.Agent,
      provenance: VALID_PROVENANCE,
    })

    await expect(
      createNode({
        type: 'Agent',
        identifier: 'dup-agent',
        attributes: ATTRS.Agent,
        provenance: VALID_PROVENANCE,
      }),
    ).rejects.toThrow(/already exists/)
  })

  it('rifiuta tipo non valido', async () => {
    await expect(
      createNode({
        type: 'InvalidType' as any,
        identifier: 'bad',
        provenance: VALID_PROVENANCE,
      }),
    ).rejects.toThrow()
  })

  it('rifiuta attributi mancanti', async () => {
    await expect(
      createNode({
        type: 'Agent',
        identifier: 'no-attrs',
        attributes: {}, // mancano name e role
        provenance: VALID_PROVENANCE,
      }),
    ).rejects.toThrow(/Missing required attributes/)
  })
})

describe('graph-age — createEdge + getNeighbors', () => {
  it('crea edge tra due nodi esistenti', async () => {
    await createNode({ type: 'Agent', identifier: 'src', attributes: ATTRS.Agent, provenance: VALID_PROVENANCE })
    await createNode({ type: 'Task', identifier: 'dst', attributes: ATTRS.Task, provenance: VALID_PROVENANCE })

    const { id } = await createEdge({
      fromUri: 'agent://src',
      toUri: 'task://dst',
      relationType: 'EXECUTED',
      createdByAgent: 'agent://src',
    })

    expect(id).toBeTruthy()
  })

  it('rifiuta edge se source node non esiste', async () => {
    await expect(
      createEdge({
        fromUri: 'agent://missing',
        toUri: 'task://dst',
        relationType: 'EXECUTED',
        createdByAgent: 'agent://x',
      }),
    ).rejects.toThrow(/Source node not found/)
  })

  it('getNeighbors ritorna sia out che in', async () => {
    const neighbors = await getNeighbors('agent://src', { direction: 'both' })
    expect(neighbors.length).toBeGreaterThan(0)
    const out = neighbors.filter((n) => n.direction === 'out')
    expect(out.some((n) => n.node.uri === 'task://dst')).toBe(true)
  })

  it('getNeighbors filtra per direction', async () => {
    const outgoing = await getNeighbors('agent://src', { direction: 'outgoing' })
    const incoming = await getNeighbors('agent://src', { direction: 'incoming' })

    expect(outgoing.every((n) => n.direction === 'out')).toBe(true)
    expect(incoming.every((n) => n.direction === 'in')).toBe(true)
    expect(outgoing.length).toBeGreaterThan(0)
  })
})

describe('graph-age — traverse (BFS fallback)', () => {
  it('traverse ritorna nodi a profondità crescente', async () => {
    // Costruisce: a -> b -> c
    await createNode({ type: 'Agent', identifier: 'chain-a', attributes: ATTRS.Agent, provenance: VALID_PROVENANCE })
    await createNode({ type: 'Task', identifier: 'chain-b', attributes: ATTRS.Task, provenance: VALID_PROVENANCE })
    await createNode({ type: 'Workflow', identifier: 'chain-c', attributes: ATTRS.Workflow, provenance: VALID_PROVENANCE })
    await createEdge({ fromUri: 'agent://chain-a', toUri: 'task://chain-b', relationType: 'EXECUTED', createdByAgent: 'agent://chain-a' })
    await createEdge({ fromUri: 'task://chain-b', toUri: 'workflow://chain-c', relationType: 'RESULTED_IN', createdByAgent: 'task://chain-b' })

    const result = await traverse('agent://chain-a', { maxDepth: 3, limit: 50 })
    expect(result.length).toBeGreaterThanOrEqual(3)
    expect(result[0].uri).toBe('agent://chain-a')
    expect(result[0].depth).toBe(0)

    const depths = result.map((r) => r.depth)
    expect(Math.max(...depths)).toBeGreaterThan(0)
  })

  it('traverse respect maxDepth', async () => {
    const result = await traverse('agent://chain-a', { maxDepth: 1, limit: 50 })
    expect(result.every((r) => r.depth <= 1)).toBe(true)
  })

  it('traverse su nodo inesistente ritorna array vuoto', async () => {
    const result = await traverse('agent://nope', { maxDepth: 2 })
    expect(result).toEqual([])
  })
})

describe('graph-age — cypherQuery (AGE non disponibile)', () => {
  it('cypherQuery lancia errore controllato su SQLite', async () => {
    await expect(cypherQuery('MATCH (n) RETURN n')).rejects.toThrow(/Apache AGE non disponibile/)
  })
})

describe('graph-age — graphStats', () => {
  it('graphStats ritorna conteggi coerenti', async () => {
    const stats = await graphStats()
    expect(stats.totalNodes).toBeGreaterThan(0)
    expect(stats.totalEdges).toBeGreaterThan(0)
    expect(typeof stats.nodesByType).toBe('object')
    expect(stats.nodesByType.Agent).toBeGreaterThan(0)
  })
})

describe('graph-age — Fase 1.3: provenance enforcement', () => {
  it('rifiuta nodo con provenance mancante', async () => {
    await expect(
      createNode({
        type: 'Agent',
        identifier: 'no-prov',
        attributes: ATTRS.Agent,
        provenance: { } as any, // manca tutto
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('rifiuta nodo con source non valido', async () => {
    await expect(
      createNode({
        type: 'Agent',
        identifier: 'bad-source',
        attributes: ATTRS.Agent,
        provenance: {
          createdByAgent: 'agent://test',
          source: 'invalid-source' as any,
          confidence: 1.0,
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('rifiuta nodo con confidence fuori range', async () => {
    await expect(
      createNode({
        type: 'Agent',
        identifier: 'bad-conf',
        attributes: ATTRS.Agent,
        provenance: {
          createdByAgent: 'agent://test',
          source: 'system-event',
          confidence: 1.5, // > 1.0 non valido
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('rifiuta nodo con timestamp non ISO', async () => {
    await expect(
      createNode({
        type: 'Agent',
        identifier: 'bad-ts',
        attributes: ATTRS.Agent,
        provenance: {
          createdByAgent: 'agent://test',
          source: 'system-event',
          confidence: 1.0,
          timestamp: 'not-a-date',
        },
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('rifiuta nodo senza createdByAgent', async () => {
    await expect(
      createNode({
        type: 'Agent',
        identifier: 'no-agent',
        attributes: ATTRS.Agent,
        provenance: {
          source: 'system-event',
          confidence: 1.0,
          timestamp: new Date().toISOString(),
        } as any,
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('updateNodeLifecycle applica transizione valida', async () => {
    const { uri } = await createNode({
      type: 'Agent',
      identifier: 'lifecycle-test',
      attributes: ATTRS.Agent,
      provenance: VALID_PROVENANCE,
    })

    await updateNodeLifecycle(uri, 'active', 'agent://test', 'activation test')

    const updated = await getNode(uri)
    expect(updated!.lifecycleState).toBe('active')
  })

  it('updateNodeLifecycle rifiuta transizione non valida', async () => {
    const { uri } = await createNode({
      type: 'Agent',
      identifier: 'bad-transition',
      attributes: ATTRS.Agent,
      provenance: VALID_PROVENANCE,
      lifecycleState: 'active',
    })

    // active → draft non è una transizione valida (vedi LIFECYCLE_TRANSITIONS)
    await expect(
      updateNodeLifecycle(uri, 'draft', 'agent://test'),
    ).rejects.toThrow(/Transition.*not allowed/)
  })
})
