/**
 * Tests for vector-store.ts (Fase 1.1)
 *
 * Verifica che la façade funzioni correttamente in path SQLite (JSON-string).
 * In Postgres + pgvector gli stessi test passerebbero usando raw SQL.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  storeEmbedding, getEmbedding, listEmbeddings,
  searchSimilar, deleteEmbedding, parsePgvectorString,
} from '@/lib/vector-store'
import { db } from '@/lib/db'
import { embed } from '@/lib/embeddings'

describe('vector-store — parse helpers', () => {
  it('parsePgvectorString() parsa formato pgvector text', () => {
    expect(parsePgvectorString('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3])
  })

  it('parsePgvectorString() parsa array vuoto', () => {
    expect(parsePgvectorString('[]')).toEqual([])
  })

  it('parsePgvectorString() gestisce negativi', () => {
    expect(parsePgvectorString('[-0.5,0,0.5]')).toEqual([-0.5, 0, 0.5])
  })
})

describe('vector-store — CRUD (SQLite path)', () => {
  beforeAll(async () => {
    await db.embeddingVector.deleteMany({})
  })

  it('storeEmbedding + getEmbedding round-trip', async () => {
    const vec = embed('test di scrittura embedding')
    await storeEmbedding({
      entityUri: 'test://round-trip',
      entityType: 'Test',
      embedding: vec,
    })

    const retrieved = await getEmbedding('test://round-trip')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.length).toBe(vec.length)
    // I valori devono essere vicini (JSON round-trip)
    for (let i = 0; i < vec.length; i++) {
      expect(retrieved![i]).toBeCloseTo(vec[i], 5)
    }
  })

  it('storeEmbedding è idempotente (upsert)', async () => {
    const v1 = embed('versione 1 del documento')
    const v2 = embed('versione 2 del documento con modifiche')

    await storeEmbedding({ entityUri: 'doc://upsert', entityType: 'Document', embedding: v1 })
    await storeEmbedding({ entityUri: 'doc://upsert', entityType: 'Document', embedding: v2 })

    const count = await db.embeddingVector.count({
      where: { entityUri: 'doc://upsert' },
    })
    expect(count).toBe(1)

    const retrieved = await getEmbedding('doc://upsert')
    expect(retrieved![0]).toBeCloseTo(v2[0], 5)
  })

  it('listEmbeddings filtra per entityType', async () => {
    await storeEmbedding({ entityUri: 'task://a', entityType: 'Task', embedding: embed('task a') })
    await storeEmbedding({ entityUri: 'agent://b', entityType: 'Agent', embedding: embed('agent b') })

    const tasks = await listEmbeddings('Task')
    const agents = await listEmbeddings('Agent')

    expect(tasks.every((t) => t.entityType === 'Task')).toBe(true)
    expect(agents.every((a) => a.entityType === 'Agent')).toBe(true)
    expect(tasks.length).toBeGreaterThan(0)
    expect(agents.length).toBeGreaterThan(0)
  })

  it('searchSimilar ritorna risultati rilevanti ordinati per score', async () => {
    await storeEmbedding({
      entityUri: 'task://plan-1',
      entityType: 'Task',
      embedding: embed('genera piano JSON per workflow analisi'),
    })
    await storeEmbedding({
      entityUri: 'task://plan-2',
      entityType: 'Task',
      embedding: embed('esecuzione task orchestrator scheduler'),
    })

    const query = embed('piano workflow analisi')
    const hits = await searchSimilar(query, { topK: 10, minScore: 0.0 })

    expect(hits.length).toBeGreaterThan(0)
    // Score deve essere decrescente
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score)
    }
  })

  it('deleteEmbedding rimuove il record', async () => {
    await storeEmbedding({
      entityUri: 'task://delete-me',
      entityType: 'Task',
      embedding: embed('cancellami'),
    })
    expect(await getEmbedding('task://delete-me')).not.toBeNull()

    await deleteEmbedding('task://delete-me')
    expect(await getEmbedding('task://delete-me')).toBeNull()
  })

  it('getEmbedding ritorna null per URI sconosciuto', async () => {
    expect(await getEmbedding('non://existent')).toBeNull()
  })
})
