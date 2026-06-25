/**
 * Tests for Cognitive Garbage Collection (Fase 2.9)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  consolidateEpisodicToProcedural, updateDecayScores, archiveColdMemories,
  classifyTier, gcStats, startGCScheduler, stopGCScheduler,
  gcProvenance,
} from '@/lib/cognitive-gc/curator'
import { storeMemory } from '@/lib/memory-fabric/fabric'
import { db } from '@/lib/db'
import { embed } from '@/lib/embeddings'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const AGENT_URI = 'agent://gc-test'

describe('Cognitive GC — classifyTier', () => {
  it('weight >= 0.3 → hot', () => {
    expect(classifyTier(0.5)).toBe('hot')
    expect(classifyTier(0.3)).toBe('hot')
  })

  it('weight 0.05-0.3 → warm', () => {
    expect(classifyTier(0.1)).toBe('warm')
    expect(classifyTier(0.05)).toBe('warm')
  })

  it('weight < 0.05 → cold', () => {
    expect(classifyTier(0.04)).toBe('cold')
    expect(classifyTier(0)).toBe('cold')
  })
})

describe('Cognitive GC — consolidateEpisodicToProcedural', () => {
  beforeAll(async () => {
    await db.memoryEntry.deleteMany({})
    _resetEventMeshForTests()
  })

  it('consolida cluster di memorie episodic simili in procedural', async () => {
    // Crea 5 memorie episodic semanticamente simili (stesso argomento)
    const similarContent = 'piano di esecuzione workflow analisi dati'
    for (let i = 0; i < 5; i++) {
      await storeMemory({
        layer: 'episodic',
        agentUri: AGENT_URI,
        content: `${similarContent} - variant ${i}`,
        embedding: embed(similarContent),
        utilityScore: 0.7,
      })
    }

    const result = await consolidateEpisodicToProcedural({
      agentUri: AGENT_URI,
      minClusterSize: 3,
      similarityThreshold: 0.5, // più permissivo per il test
    })

    expect(result.inputMemories).toBeGreaterThanOrEqual(5)
    expect(result.consolidatedMemories).toBeGreaterThan(0)
    expect(result.newProceduralMemories).toBeGreaterThan(0)
    expect(result.archivedMemories).toBeGreaterThan(0)
  })

  it('non consolida memorie con similarity bassa', async () => {
    await db.memoryEntry.deleteMany({ where: { agentUri: 'agent://gc-different' } })

    // Crea memorie semanticamente distanti
    await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://gc-different',
      content: 'argomento astronomia stelle galassie',
      embedding: embed('astronomia stelle galassie'),
      utilityScore: 0.5,
    })
    await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://gc-different',
      content: 'programmazione typescript react nextjs',
      embedding: embed('typescript react nextjs'),
      utilityScore: 0.5,
    })

    const result = await consolidateEpisodicToProcedural({
      agentUri: 'agent://gc-different',
      minClusterSize: 3, // richiede 3 simili, ma ne abbiamo solo 2 distanti
      similarityThreshold: 0.7,
    })

    expect(result.newProceduralMemories).toBe(0)
    expect(result.consolidatedMemories).toBe(0)
  })

  it('applica decay alle memorie non consolidate', async () => {
    await db.memoryEntry.deleteMany({ where: { agentUri: 'agent://gc-decay' } })

    await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://gc-decay',
      content: 'memoria per test decay',
      embedding: embed('memoria test decay'),
      utilityScore: 0.5,
    })

    const before = await db.memoryEntry.findFirst({
      where: { agentUri: 'agent://gc-decay' },
    })
    expect(before!.recencyScore).toBe(1.0) // initial value

    await consolidateEpisodicToProcedural({
      agentUri: 'agent://gc-decay',
      minClusterSize: 10, // nessun cluster possibile
    })

    const after = await db.memoryEntry.findFirst({
      where: { agentUri: 'agent://gc-decay' },
    })
    // recencyScore deve essere diminuito
    expect(after!.recencyScore).toBeLessThan(1.0)
  })
})

describe('Cognitive GC — updateDecayScores', () => {
  beforeAll(async () => {
    await db.memoryEntry.deleteMany({ where: { agentUri: 'agent://decay-test' } })
  })

  it('aggiorna recencyScore basato su lastAccessedAt', async () => {
    const { id } = await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://decay-test',
      content: 'old memory',
      embedding: embed('old memory'),
      utilityScore: 0.8,
    })

    // Simula lastAccessedAt di 15 giorni fa E updatedAt vecchio
    const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    await db.memoryEntry.update({
      where: { id },
      data: {
        lastAccessedAt: oldDate,
        updatedAt: oldDate,
      },
    })

    const result = await updateDecayScores({ agentUri: 'agent://decay-test', olderThanDays: 0 })
    expect(result.updated).toBeGreaterThan(0)

    const updated = await db.memoryEntry.findUnique({ where: { id } })
    // 15 giorni / 30 = 0.5, recency = 1 - 0.5 = 0.5
    expect(updated!.recencyScore).toBeCloseTo(0.5, 1)
    expect(updated!.weight).toBeCloseTo(0.8 * 0.5, 1) // utility × recency
  })

  it('recencyScore = 0 per memorie > 30 giorni', async () => {
    const { id } = await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://decay-test',
      content: 'very old memory',
      embedding: embed('very old memory'),
      utilityScore: 0.9,
    })

    const veryOldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    await db.memoryEntry.update({
      where: { id },
      data: {
        lastAccessedAt: veryOldDate,
        updatedAt: veryOldDate,
      },
    })

    await updateDecayScores({ agentUri: 'agent://decay-test', olderThanDays: 0 })

    const updated = await db.memoryEntry.findUnique({ where: { id } })
    expect(updated!.recencyScore).toBe(0)
    expect(updated!.weight).toBe(0)
  })
})

describe('Cognitive GC — archiveColdMemories', () => {
  beforeAll(async () => {
    await db.memoryEntry.deleteMany({ where: { agentUri: 'agent://archive-test' } })
  })

  it('archivia memorie con weight < 0.05 e lastAccessedAt > 30gg', async () => {
    const { id } = await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://archive-test',
      content: 'cold candidate',
      embedding: embed('cold candidate'),
      utilityScore: 0.1, // basso
    })

    // Simula weight basso + lastAccessedAt > 30gg
    await db.memoryEntry.update({
      where: { id },
      data: {
        weight: 0.02,
        recencyScore: 0.05,
        lastAccessedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      },
    })

    const result = await archiveColdMemories({ agentUri: 'agent://archive-test' })
    expect(result.archived).toBeGreaterThan(0)
    expect(result.freedBytes).toBeGreaterThan(0)
    expect(result.archivedUris).toContain(id)

    // Verifica che l'embedding sia stato rimosso (size optimization)
    const archived = await db.memoryEntry.findUnique({ where: { id } })
    expect(archived!.embedding).toBeNull()
    expect(archived!.weight).toBe(0)
  })

  it('non archivia memorie recenti', async () => {
    await storeMemory({
      layer: 'episodic',
      agentUri: 'agent://archive-test',
      content: 'recent memory',
      embedding: embed('recent memory'),
      utilityScore: 0.5,
    })

    const result = await archiveColdMemories({ agentUri: 'agent://archive-test' })
    // La memoria recente non deve essere tra quelle archiviate
    const recent = await db.memoryEntry.findFirst({
      where: { agentUri: 'agent://archive-test', content: 'recent memory' },
    })
    expect(recent!.weight).toBeGreaterThan(0)
  })
})

describe('Cognitive GC — gcStats', () => {
  it('ritorna aggregati per layer e tier', async () => {
    const stats = await gcStats()
    expect(stats.totalMemories).toBeGreaterThan(0)
    expect(typeof stats.byLayer).toBe('object')
    expect(typeof stats.byTier).toBe('object')
    expect(stats.byTier).toHaveProperty('hot')
    expect(stats.byTier).toHaveProperty('warm')
    expect(stats.byTier).toHaveProperty('cold')
    expect(typeof stats.avgWeight).toBe('number')
  })
})

describe('Cognitive GC — scheduler', () => {
  it('startGCScheduler + stopGCScheduler non throwano', () => {
    expect(() => {
      startGCScheduler({ dailyIntervalHours: 1, weeklyIntervalHours: 24 })
      stopGCScheduler()
    }).not.toThrow()
  })

  it('stopGCScheduler è idempotente', () => {
    expect(() => {
      stopGCScheduler()
      stopGCScheduler()
    }).not.toThrow()
  })
})
