/**
 * Tests for Memory Fabric (Fase 1.5)
 *
 * Verifica:
 *   1. I 4 strati (episodic, semantic, procedural, reasoning) sono scrivibili
 *   2. retrieveMemory filtra per layer e agent
 *   3. semanticMemorySearch trova contenuti simili via embedding
 *   4. consolidateMemory applica decay recency
 *   5. memoryStats aggrega correttamente
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  storeMemory, retrieveMemory, semanticMemorySearch,
  consolidateMemory, memoryStats,
  type MemoryLayer,
} from '@/lib/memory-fabric/fabric'
import { db } from '@/lib/db'
import { embed } from '@/lib/embeddings'

const AGENT_URI = 'agent://memory-test'

describe('Memory Fabric — storeMemory + retrieveMemory', () => {
  beforeAll(async () => {
    await db.memoryEntry.deleteMany({})
  })

  it('scrive nei 4 strati e recupera per layer', async () => {
    const layers: MemoryLayer[] = ['episodic', 'semantic', 'procedural', 'reasoning']

    for (const layer of layers) {
      await storeMemory({
        layer,
        agentUri: AGENT_URI,
        content: `memory content for ${layer}`,
        utilityScore: 0.8,
      })
    }

    for (const layer of layers) {
      const entries = await retrieveMemory({ layer, agentUri: AGENT_URI })
      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0].layer).toBe(layer)
      expect(entries[0].agentUri).toBe(AGENT_URI)
    }
  })

  it('retrieveMemory ordina per weight desc', async () => {
    await storeMemory({ layer: 'episodic', agentUri: AGENT_URI, content: 'low utility', utilityScore: 0.1 })
    await storeMemory({ layer: 'episodic', agentUri: AGENT_URI, content: 'high utility', utilityScore: 0.95 })

    const entries = await retrieveMemory({ layer: 'episodic', agentUri: AGENT_URI, limit: 10 })
    const weights = entries.map((e) => e.weight)
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1])
    }
  })

  it('retrieveMemory filtra per agentUri', async () => {
    await storeMemory({ layer: 'episodic', agentUri: 'agent://other', content: 'other agent', utilityScore: 0.5 })

    const mine = await retrieveMemory({ agentUri: AGENT_URI })
    const others = await retrieveMemory({ agentUri: 'agent://other' })

    expect(mine.every((e) => e.agentUri === AGENT_URI)).toBe(true)
    expect(others.every((e) => e.agentUri === 'agent://other')).toBe(true)
  })

  it('retrieveMemory aggiorna accessCount e lastAccessedAt', async () => {
    const { id } = await storeMemory({
      layer: 'episodic',
      agentUri: AGENT_URI,
      content: 'access counter test',
      utilityScore: 0.5,
    })

    const before = await db.memoryEntry.findUnique({ where: { id } })
    expect(before!.accessCount).toBe(0)
    expect(before!.lastAccessedAt).toBeNull()

    await retrieveMemory({ agentUri: AGENT_URI })

    const after = await db.memoryEntry.findUnique({ where: { id } })
    expect(after!.accessCount).toBeGreaterThan(0)
    expect(after!.lastAccessedAt).not.toBeNull()
  })
})

describe('Memory Fabric — semanticMemorySearch', () => {
  it('trova contenuti semanticamente simili', async () => {
    await storeMemory({
      layer: 'semantic',
      agentUri: AGENT_URI,
      content: 'piano di esecuzione del workflow di analisi',
      embedding: embed('piano di esecuzione del workflow di analisi'),
      utilityScore: 0.9,
    })

    const hits = await semanticMemorySearch('piano workflow analisi', AGENT_URI, 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].score).toBeGreaterThan(0.3)
    expect(hits[0].content).toContain('piano')
  })

  it('filtra risultati sotto threshold', async () => {
    await storeMemory({
      layer: 'semantic',
      agentUri: AGENT_URI,
      content: 'argomento completamente diverso astronomia',
      embedding: embed('argomento completamente diverso astronomia'),
      utilityScore: 0.5,
    })

    const hits = await semanticMemorySearch('piano workflow analisi', AGENT_URI, 10)
    const scores = hits.map((h) => h.score)
    expect(Math.min(...scores)).toBeGreaterThan(0.3)
  })
})

describe('Memory Fabric — consolidateMemory', () => {
  it('applica decay recency e aggiorna weight', async () => {
    const { id } = await storeMemory({
      layer: 'episodic',
      agentUri: AGENT_URI,
      content: 'old memory for consolidation',
      utilityScore: 0.5,
    })

    // Simula accesso vecchio (30+ giorni fa)
    await db.memoryEntry.update({
      where: { id },
      data: { lastAccessedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) },
    })

    const result = await consolidateMemory(AGENT_URI)
    expect(result.consolidated + result.archived).toBeGreaterThan(0)

    const updated = await db.memoryEntry.findUnique({ where: { id } })
    expect(updated!.recencyScore).toBeLessThan(0.2) // ~0 dopo 35 giorni
  })
})

describe('Memory Fabric — memoryStats', () => {
  it('ritorna conteggi per layer', async () => {
    const stats = await memoryStats(AGENT_URI)
    expect(typeof stats).toBe('object')
    // Almeno un layer deve essere presente
    const total = Object.values(stats).reduce((sum, s) => sum + (s.count || 0), 0)
    expect(total).toBeGreaterThan(0)
  })
})
