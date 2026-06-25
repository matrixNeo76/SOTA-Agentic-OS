/**
 * Tests for db-runtime.ts (Fase 1.1)
 *
 * Ambiente di test: SQLite (DATABASE_URL=file:...).
 * Verifichiamo:
 *   1. getProvider() ritorna "sqlite" in dev
 *   2. hasPgvector() / hasAge() ritornano false (non Postgres)
 *   3. toPgvector() produce stringhe valide
 *   4. cosineSimilarity() funziona per casi notevoli
 *   5. vectorSearch() usa il fallback SQLite (JSON parse + cosine in JS)
 *   6. upsertEmbedding() funziona su SQLite (write + read consistency)
 *   7. ageCypher() lancia errore controllato quando AGE non è disponibile
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  getProvider, hasPgvector, hasAge, toPgvector,
  cosineSimilarity, vectorSearch, upsertEmbedding, ageCypher,
} from '@/lib/db-runtime'
import { db } from '@/lib/db'
import { embed } from '@/lib/embeddings'

describe('db-runtime — provider detection', () => {
  it('getProvider() ritorna "sqlite" in ambiente di test', async () => {
    const provider = await getProvider()
    expect(provider).toBe('sqlite')
  })

  it('hasPgvector() ritorna false su SQLite', async () => {
    expect(await hasPgvector()).toBe(false)
  })

  it('hasAge() ritorna false su SQLite', async () => {
    expect(await hasAge()).toBe(false)
  })
})

describe('db-runtime — pgvector helpers', () => {
  it('toPgvector() formatta correttamente un array', () => {
    const vec = [0.1, 0.2, 0.3]
    expect(toPgvector(vec)).toBe('[0.1,0.2,0.3]')
  })

  it('toPgvector() gestisce array vuoto', () => {
    expect(toPgvector([])).toBe('[]')
  })

  it('toPgvector() gestisce valori negativi e decimali', () => {
    const vec = [-0.5, 0.0, 0.9999]
    expect(toPgvector(vec)).toBe('[-0.5,0,0.9999]')
  })
})

describe('db-runtime — cosineSimilarity', () => {
  it('vettori identici → similarity = 1.0', () => {
    const v = [1, 0, 0]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5)
  })

  it('vettori ortogonali → similarity = 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5)
  })

  it('vettori opposti → similarity = -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5)
  })

  it('lunghezze diverse → similarity = 0 (safe fallback)', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0)
  })

  it('vettori nulli → similarity = 0 (no NaN)', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0)
  })
})

describe('db-runtime — vectorSearch (fallback SQLite)', () => {
  beforeAll(async () => {
    // Pulisce eventuali record precedenti
    await db.embeddingVector.deleteMany({})
  })

  it('upsertEmbedding + vectorSearch round-trip ritrova il documento', async () => {
    const emb = embed('piano di esecuzione del task di analisi')
    await upsertEmbedding({
      entityUri: 'task://test-1',
      entityType: 'Task',
      embedding: emb,
    })

    const queryEmb = embed('esecuzione piano analisi task')
    const hits = await vectorSearch(queryEmb, { topK: 5, minScore: 0.0 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].uri).toBe('task://test-1')
  })

  it('vectorSearch filtra per entityType', async () => {
    await upsertEmbedding({
      entityUri: 'agent://planner',
      entityType: 'Agent',
      embedding: embed('piano di esecuzione del task di analisi'),
    })

    const queryEmb = embed('piano di esecuzione del task di analisi')
    const agentHits = await vectorSearch(queryEmb, { topK: 5, entityType: 'Agent', minScore: 0.0 })
    const taskHits = await vectorSearch(queryEmb, { topK: 5, entityType: 'Task', minScore: 0.0 })

    expect(agentHits.every((h) => h.entityType === 'Agent')).toBe(true)
    expect(taskHits.every((h) => h.entityType === 'Task')).toBe(true)
  })

  it('minScore threshold espelle risultati scarsi', async () => {
    await upsertEmbedding({
      entityUri: 'task://unrelated',
      entityType: 'Task',
      embedding: embed('argomento completamente diverso e distante'),
    })

    const queryEmb = embed('piano di esecuzione del task di analisi')
    const hits = await vectorSearch(queryEmb, { topK: 5, minScore: 0.95 })
    // Solo il task semanticamente vicino deve passare la soglia alta
    const uris = hits.map((h) => h.uri)
    expect(uris).not.toContain('task://unrelated')
  })
})

describe('db-runtime — ageCypher error handling', () => {
  it('ageCypher() lancia errore controllato su SQLite', async () => {
    await expect(ageCypher('MATCH (n) RETURN n')).rejects.toThrow(/Apache AGE non disponibile/)
  })
})
