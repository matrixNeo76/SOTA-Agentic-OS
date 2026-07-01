/**
 * Tests for Knowledge Extraction Engine (Fase 2.2)
 *
 * Verifica:
 *   1. chunkText produce chunks con overlap e target size rispettati
 *   2. extractEntities trova entità note (Agent, Tool, Concept)
 *   3. extractRelations trova relazioni esplicite e co-occorrenze
 *   4. extractDocument pipeline end-to-end crea nodi Document + Claim nel grafo
 *   5. Embeddings dei chunk vengono persistiti
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  chunkText, extractEntities, extractRelations, extractDocument,
  extractionProvenance,
} from '@/lib/knowledge-extraction/extractor'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const SAMPLE_TEXT = `# Memory Fabric

The Memory Fabric has 4 layers: episodic, semantic, procedural, reasoning.

The orchestrator agent uses the curator to manage memory.
The planner agent generates tasks that depend on the orchestrator.

The ERL module extracts heuristics from experiences.
The ACTS module steers cognitive task execution.

Memory is essential for context. The context graph stores nodes and edges.
Embeddings represent semantic similarity in the vector store.

The verifier checks task results. The controller enforces policies.
The reflective agent learns from failures.
`

const SHORT_TEXT = 'This is a single paragraph without complex structure.'

describe('Knowledge Extraction — chunkText', () => {
  it('produce chunks con dimensione vicino al target', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 64, overlapTokens: 8 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      // Ogni chunk non deve sforare troppo il target (target * 4 chars)
      expect(c.content.length).toBeLessThanOrEqual(64 * 4 * 1.2)
    }
  })

  it('rispetta maxChunks safety cap', () => {
    const longText = SAMPLE_TEXT.repeat(50)
    const chunks = chunkText(longText, { targetTokens: 32, maxChunks: 5 })
    expect(chunks.length).toBeLessThanOrEqual(5)
  })

  it('testo breve produce un singolo chunk', () => {
    const chunks = chunkText(SHORT_TEXT, { targetTokens: 256 })
    expect(chunks.length).toBe(1)
  })

  it('i chunk hanno indici sequenziali', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 64 })
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i)
    }
  })

  it('tokenEstimate è coerente con la lunghezza', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 128 })
    for (const c of chunks) {
      expect(c.tokenEstimate).toBeGreaterThan(0)
      expect(c.tokenEstimate).toBeCloseTo(Math.ceil(c.content.length / 4), 0)
    }
  })
})

describe('Knowledge Extraction — extractEntities', () => {
  it('trova entità Agent note (orchestrator, planner, curator)', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 256 })
    const wrapped = chunks.map((c, i) => ({
      id: `doc://test#chunk-${i}`,
      documentUri: 'doc://test',
      index: i,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenEstimate: c.tokenEstimate,
    }))
    const entities = extractEntities(wrapped)

    const agents = entities.filter((e) => e.type === 'Agent')
    expect(agents.length).toBeGreaterThan(0)

    const names = agents.map((a) => a.name)
    expect(names).toEqual(expect.arrayContaining(['orchestrator', 'planner', 'curator']))
  })

  it('trova entità Concept (memory, context, embeddings)', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 256 })
    const wrapped = chunks.map((c, i) => ({
      id: `doc://test#chunk-${i}`,
      documentUri: 'doc://test',
      index: i,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenEstimate: c.tokenEstimate,
    }))
    const entities = extractEntities(wrapped)

    const concepts = entities.filter((e) => e.type === 'Concept')
    const names = concepts.map((c) => c.name)
    // 'embeddings' (plurale) viene matchato dal pattern embeddings?
    expect(names).toEqual(expect.arrayContaining(['memory', 'context', 'embeddings']))
  })

  it('ordina per menzioni decrescenti', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 256 })
    const wrapped = chunks.map((c, i) => ({
      id: `doc://test#chunk-${i}`,
      documentUri: 'doc://test',
      index: i,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenEstimate: c.tokenEstimate,
    }))
    const entities = extractEntities(wrapped)
    for (let i = 1; i < entities.length; i++) {
      expect(entities[i]!.mentions).toBeLessThanOrEqual(entities[i - 1]!.mentions)
    }
  })
})

describe('Knowledge Extraction — extractRelations', () => {
  it('trova relazioni esplicite (USES, GENERATES, DEPENDS_ON)', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 256 })
    const wrapped = chunks.map((c, i) => ({
      id: `doc://test#chunk-${i}`,
      documentUri: 'doc://test',
      index: i,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenEstimate: c.tokenEstimate,
    }))
    const entities = extractEntities(wrapped)
    const relations = extractRelations(wrapped, entities)

    const types = relations.map((r) => r.relationType)
    // Almeno una relazione esplicita deve essere trovata
    expect(types.length).toBeGreaterThan(0)
    expect(types.some((t) => ['USES', 'GENERATES', 'DEPENDS_ON', 'EXECUTES', 'IS_A', 'RELATED_TO'].includes(t))).toBe(true)
  })

  it('relazioni hanno evidence non vuota', () => {
    const chunks = chunkText(SAMPLE_TEXT, { targetTokens: 256 })
    const wrapped = chunks.map((c, i) => ({
      id: `doc://test#chunk-${i}`,
      documentUri: 'doc://test',
      index: i,
      content: c.content,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenEstimate: c.tokenEstimate,
    }))
    const entities = extractEntities(wrapped)
    const relations = extractRelations(wrapped, entities)

    for (const r of relations) {
      expect(r.evidence.length).toBeGreaterThan(0)
      expect(r.confidence).toBeGreaterThan(0)
      expect(r.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('Knowledge Extraction — extractDocument (pipeline end-to-end)', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    await db.embeddingVector.deleteMany({})
    _resetEventMeshForTests()
  })

  it('pipeline completa: text → chunks → entities → graph → embeddings', async () => {
    const result = await extractDocument({
      uri: 'doc://test-extraction',
      content: Buffer.from(SAMPLE_TEXT, 'utf-8'),
      mimeType: 'text/plain',
      source: 'upload',
      provenance: extractionProvenance(),
      chunking: { targetTokens: 64, overlapTokens: 8 },
    })

    expect(result.document.rawText.length).toBeGreaterThan(0)
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.graphNodesCreated).toBeGreaterThan(0) // Document + Claims
    expect(result.embeddingsStored).toBeGreaterThan(0)
    expect(result.embeddingsStored).toBeLessThanOrEqual(result.chunks.length)
  })

  it('embeddings dei chunk sono ricercabili', async () => {
    // Verifica che almeno un embedding sia stato salvato
    const embeddings = await db.embeddingVector.findMany({
      where: { entityUri: { contains: 'chunk-' } },
    })
    expect(embeddings.length).toBeGreaterThan(0)
  })

  it('nodi Document e Claim sono nel grafo', async () => {
    const docs = await db.graphNode.findMany({ where: { entityType: 'Document' } })
    const claims = await db.graphNode.findMany({ where: { entityType: 'Claim' } })
    expect(docs.length).toBeGreaterThan(0)
    expect(claims.length).toBeGreaterThan(0)
  })
})
