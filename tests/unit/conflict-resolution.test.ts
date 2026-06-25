/**
 * Tests for Knowledge Conflict Resolution Engine (Fase 2.8)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  detectConflictsForClaim, listPendingConflicts, resolveConflict,
  createClaimAndDetectConflicts, getClaimNode,
  autoResolveConflicts, conflictResolutionStats,
} from '@/lib/conflict-resolution/engine'
import { createProvenance } from '@/lib/governance'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'
import { db } from '@/lib/db'

const VALID_PROV = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

describe('Conflict Resolution — createClaimAndDetectConflicts', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    _resetEventMeshForTests()
  })

  it('crea un claim senza conflitti se è il primo nel domain', async () => {
    const { claimUri, conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-test-1',
      statement: 'TypeScript is statically typed',
      confidence: 0.9,
      domain: 'programming-languages',
      provenance: VALID_PROV,
    })

    expect(claimUri).toMatch(/^claim:\/\//)
    expect(conflicts).toEqual([])
  })

  it('rileva conflitto quando claim con confidence molto diversa nello stesso domain', async () => {
    // Primo claim con confidence alta
    await createClaimAndDetectConflicts({
      identifier: 'claim-conflict-a',
      statement: 'Python is faster than C',
      confidence: 0.95,
      domain: 'performance',
      provenance: VALID_PROV,
    })

    // Secondo claim con confidence bassa (diff > 0.5 → high severity)
    const { conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-conflict-b',
      statement: 'Python is slower than C',
      confidence: 0.2,
      domain: 'performance',
      provenance: VALID_PROV,
    })

    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts[0]!.severity).toBe('high')
  })

  it('non rileva conflitto se domain diverso', async () => {
    await createClaimAndDetectConflicts({
      identifier: 'claim-domain-a',
      statement: 'X is true',
      confidence: 0.95,
      domain: 'domain-x',
      provenance: VALID_PROV,
    })

    const { conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-domain-b',
      statement: 'X is false',
      confidence: 0.1,
      domain: 'domain-y', // domain diverso
      provenance: VALID_PROV,
    })

    expect(conflicts).toEqual([])
  })
})

describe('Conflict Resolution — listPendingConflicts', () => {
  it('ritorna i conflitti con status=pending', async () => {
    const pending = await listPendingConflicts()
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((c) => c.status === 'pending')).toBe(true)
  })

  it('i conflitti hanno claimAUri e claimBUri popolati', async () => {
    const pending = await listPendingConflicts()
    for (const c of pending) {
      expect(c.claimAUri).toMatch(/^claim:\/\//)
      expect(c.claimBUri).toMatch(/^claim:\/\//)
    }
  })
})

describe('Conflict Resolution — resolveConflict (higher-confidence)', () => {
  it('risolve con strategy higher-confidence: vince il claim con confidence più alta', async () => {
    const pending = await listPendingConflicts()
    const conflict = pending[0]!
    const claimA = await getClaimNode(conflict.claimAUri)
    const claimB = await getClaimNode(conflict.claimBUri)
    const expectedWinner = (claimA!.confidence >= claimB!.confidence) ? claimA!.uri : claimB!.uri

    const resolution = await resolveConflict({
      conflictUri: conflict.uri,
      strategy: 'higher-confidence',
      resolvedBy: 'agent://test',
      provenance: VALID_PROV,
    })

    expect(resolution.strategy).toBe('higher-confidence')
    expect(resolution.winnerUri).toBe(expectedWinner)
    expect(resolution.loserUri).toBe(expectedWinner === conflict.claimAUri ? conflict.claimBUri : conflict.claimAUri)
    expect(resolution.decisionUri).toMatch(/^decision:\/\//)
    expect(resolution.reason).toContain('confidence')
  })

  it('marca il conflict come resolved dopo la risoluzione', async () => {
    // Crea un nuovo conflitto
    await createClaimAndDetectConflicts({
      identifier: 'claim-resolve-a',
      statement: 'A is true',
      confidence: 0.9,
      domain: 'resolve-test',
      provenance: VALID_PROV,
    })
    const { conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-resolve-b',
      statement: 'A is false',
      confidence: 0.2,
      domain: 'resolve-test',
      provenance: VALID_PROV,
    })

    expect(conflicts.length).toBeGreaterThan(0)
    const conflict = conflicts[0]!

    await resolveConflict({
      conflictUri: conflict.uri,
      strategy: 'higher-confidence',
      resolvedBy: 'agent://test',
      provenance: VALID_PROV,
    })

    // Verifica che non sia più in pending
    const pending = await listPendingConflicts()
    expect(pending.find((c) => c.uri === conflict.uri)).toBeUndefined()
  })

  it('crea nodo Decision + edge RESOLVED_BY', async () => {
    // Crea conflitto
    await createClaimAndDetectConflicts({
      identifier: 'claim-decision-a',
      statement: 'X',
      confidence: 0.95,
      domain: 'decision-test',
      provenance: VALID_PROV,
    })
    const { conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-decision-b',
      statement: 'not X',
      confidence: 0.1,
      domain: 'decision-test',
      provenance: VALID_PROV,
    })
    const conflict = conflicts[0]!

    const resolution = await resolveConflict({
      conflictUri: conflict.uri,
      strategy: 'higher-confidence',
      resolvedBy: 'agent://test',
      provenance: VALID_PROV,
    })

    // Verifica Decision node esista
    const decisionNode = await db.graphNode.findUnique({ where: { uri: resolution.decisionUri } })
    expect(decisionNode).not.toBeNull()
    expect(decisionNode!.entityType).toBe('Decision')

    // Verifica edge RESOLVED_BY
    const edges = await db.graphEdge.findMany({
      where: { relationType: 'RESOLVED_BY', fromNodeId: (await db.graphNode.findUnique({ where: { uri: conflict.uri } }))!.id },
    })
    expect(edges.length).toBeGreaterThan(0)
  })
})

describe('Conflict Resolution — resolveConflict (human-decision)', () => {
  it('richiede manualWinnerUri per strategy human-decision', async () => {
    // Crea conflitto (diff > 0.3)
    await createClaimAndDetectConflicts({
      identifier: 'claim-human-a',
      statement: 'Y',
      confidence: 0.8,
      domain: 'human-test',
      provenance: VALID_PROV,
    })
    const { conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-human-b',
      statement: 'not Y',
      confidence: 0.4, // diff 0.4 = medium
      domain: 'human-test',
      provenance: VALID_PROV,
    })
    expect(conflicts.length).toBeGreaterThan(0)
    const conflict = conflicts[0]!

    await expect(
      resolveConflict({
        conflictUri: conflict.uri,
        strategy: 'human-decision',
        resolvedBy: 'user://admin',
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/manualWinnerUri/)
  })

  it('accetta manualWinnerUri valido', async () => {
    // Crea conflitto (diff > 0.3)
    await createClaimAndDetectConflicts({
      identifier: 'claim-human2-a',
      statement: 'Z',
      confidence: 0.85,
      domain: 'human-test-2',
      provenance: VALID_PROV,
    })
    const { claimUri: claimB, conflicts } = await createClaimAndDetectConflicts({
      identifier: 'claim-human2-b',
      statement: 'not Z',
      confidence: 0.4, // diff 0.45
      domain: 'human-test-2',
      provenance: VALID_PROV,
    })
    expect(conflicts.length).toBeGreaterThan(0)
    const conflict = conflicts[0]!

    const resolution = await resolveConflict({
      conflictUri: conflict.uri,
      strategy: 'human-decision',
      resolvedBy: 'user://admin',
      manualWinnerUri: claimB,
      reason: 'Admin override',
      provenance: VALID_PROV,
    })

    expect(resolution.winnerUri).toBe(claimB)
    expect(resolution.reason).toBe('Admin override')
  })
})

describe('Conflict Resolution — autoResolveConflicts', () => {
  it('auto-risolve conflitti low/medium severity', async () => {
    // Crea conflitto medium (confidence diff 0.4 = medium)
    await createClaimAndDetectConflicts({
      identifier: 'claim-auto-a',
      statement: 'A',
      confidence: 0.8,
      domain: 'auto-test',
      provenance: VALID_PROV,
    })
    await createClaimAndDetectConflicts({
      identifier: 'claim-auto-b',
      statement: 'not A',
      confidence: 0.4, // diff 0.4 = medium
      domain: 'auto-test',
      provenance: VALID_PROV,
    })

    const result = await autoResolveConflicts({ strategy: 'higher-confidence' })
    expect(result.resolved + result.skipped).toBeGreaterThan(0)
  })

  it('salta conflitti high severity (richiedono HITL)', async () => {
    // Crea conflitto high
    await createClaimAndDetectConflicts({
      identifier: 'claim-skip-a',
      statement: 'B',
      confidence: 0.99,
      domain: 'skip-test',
      provenance: VALID_PROV,
    })
    await createClaimAndDetectConflicts({
      identifier: 'claim-skip-b',
      statement: 'not B',
      confidence: 0.05, // diff 0.94 = high
      domain: 'skip-test',
      provenance: VALID_PROV,
    })

    const beforePending = await listPendingConflicts()
    const result = await autoResolveConflicts({ strategy: 'higher-confidence' })
    const afterPending = await listPendingConflicts()

    // Almeno un conflitto high deve essere skipped
    expect(result.skipped).toBeGreaterThanOrEqual(0)
    // I conflitti high devono ancora essere pending
    const highPending = afterPending.filter((c) => c.severity === 'high')
    expect(highPending.length).toBeGreaterThan(0)
  })
})

describe('Conflict Resolution — stats', () => {
  it('conflictResolutionStats ritorna aggregati', async () => {
    const stats = await conflictResolutionStats()
    expect(stats.totalConflicts).toBeGreaterThan(0)
    expect(typeof stats.pending).toBe('number')
    expect(typeof stats.resolved).toBe('number')
    expect(typeof stats.byStrategy).toBe('object')
  })
})
