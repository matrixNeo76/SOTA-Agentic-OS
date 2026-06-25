/**
 * Tests for World Model Layer (Fase 3.1)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  captureWorldState, getLatestWorldState,
  createPrediction, verifyPrediction, listPendingPredictions,
  identifyRisk, mitigateRisk,
  identifyOpportunity, exploitOpportunity,
  runRuleBasedPredictor, worldModelStats,
} from '@/lib/world-model/engine'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

describe('World Model — captureWorldState', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    await db.embeddingVector.deleteMany({})
    _resetEventMeshForTests()
  })

  it('cattura uno snapshot dello stato corrente', async () => {
    const { uri, worldState } = await captureWorldState({ provenance: VALID_PROV })

    expect(uri).toMatch(/^world-state:\/\//)
    expect(worldState.timestamp).toBeTruthy()
    expect(worldState.snapshot).toBeDefined()
    expect(worldState.snapshot.graphNodes).toBeGreaterThanOrEqual(0)
    expect(worldState.snapshot.memoryEntries).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(worldState.snapshot.anomalies)).toBe(true)
    expect(Array.isArray(worldState.snapshot.dominantDomains)).toBe(true)
  })

  it('salva embedding per similarity search tra world states', async () => {
    const { uri } = await captureWorldState({ provenance: VALID_PROV })
    const embedding = await db.embeddingVector.findUnique({ where: { entityUri: uri } })
    expect(embedding).not.toBeNull()
    expect(embedding!.entityType).toBe('WorldState')
  })

  it('rileva anomalie quando errorRate alto', async () => {
    // Inietta dati per simulare errori
    await db.traceSpan.create({
      data: {
        traceId: 'trace-test',
        spanId: `span-${Date.now()}`,
        operation: 'failing-op',
        status: 'error',
        durationMs: 100,
      },
    })

    const { worldState } = await captureWorldState({ provenance: VALID_PROV })
    // Se abbiamo tracce con errori, errorRate > 0 e anomaly presente
    if (worldState.snapshot.errorRate > 0.2) {
      expect(worldState.snapshot.anomalies.some((a) => a.includes('error rate'))).toBe(true)
    }
  })
})

describe('World Model — getLatestWorldState', () => {
  it('ritorna l\'ultimo WorldState catturato', async () => {
    const { uri } = await captureWorldState({ provenance: VALID_PROV })
    const latest = await getLatestWorldState()
    expect(latest).not.toBeNull()
    expect(latest!.uri).toBe(uri)
  })

  it('ritorna null se nessun WorldState esiste', async () => {
    await db.graphNode.deleteMany({ where: { entityType: 'WorldState' } })
    const latest = await getLatestWorldState()
    expect(latest).toBeNull()
  })
})

describe('World Model — createPrediction + verifyPrediction', () => {
  beforeAll(async () => {
    // Pulisci solo Prediction nodes (mantieni WorldState)
    await db.graphEdge.deleteMany({ where: { relationType: 'BASED_ON' } })
    await db.graphNode.deleteMany({ where: { entityType: 'Prediction' } })
  })

  it('crea una predizione valida', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri, prediction } = await createPrediction({
      statement: 'System will remain stable for next 24h',
      probability: 0.85,
      horizon: '24h',
      basedOnWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^prediction:\/\//)
    expect(prediction.probability).toBe(0.85)
    expect(prediction.horizon).toBe('24h')
    expect(prediction.status).toBe('pending')
    expect(prediction.expiresAt).toBeTruthy()
  })

  it('rifiuta probability fuori range', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    await expect(
      createPrediction({
        statement: 'test',
        probability: 1.5,
        horizon: '24h',
        basedOnWorldStateUri: wsUri,
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/Probability/)
  })

  it('verifica una predizione con outcome verified', async () => {
    const { uri: wsUri1 } = await captureWorldState({ provenance: VALID_PROV })
    const { uri: predUri } = await createPrediction({
      statement: 'test prediction',
      probability: 0.7,
      horizon: '24h',
      basedOnWorldStateUri: wsUri1,
      provenance: VALID_PROV,
    })
    const { uri: wsUri2 } = await captureWorldState({ provenance: VALID_PROV })

    await verifyPrediction({
      predictionUri: predUri,
      verifyingWorldStateUri: wsUri2,
      outcome: 'verified',
      reason: 'System remained stable',
      provenance: VALID_PROV,
    })

    const updated = await db.graphNode.findUnique({ where: { uri: predUri } })
    const attrs = JSON.parse(updated!.attributes)
    expect(attrs.status).toBe('verified')
    expect(attrs.verifiedByWorldStateUri).toBe(wsUri2)
  })

  it('crea edge BASED_ON tra prediction e world state', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri: predUri } = await createPrediction({
      statement: 'edge test',
      probability: 0.6,
      horizon: '1h',
      basedOnWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    const wsNode = await db.graphNode.findUnique({ where: { uri: wsUri } })
    const edges = await db.graphEdge.findMany({
      where: { fromNodeId: (await db.graphNode.findUnique({ where: { uri: predUri } }))!.id, relationType: 'BASED_ON' },
    })
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.some((e) => e.toNodeId === wsNode!.id)).toBe(true)
  })
})

describe('World Model — listPendingPredictions', () => {
  it('ritorna predizioni con status=pending e non scadute', async () => {
    const pending = await listPendingPredictions()
    for (const p of pending) {
      expect(p.status).toBe('pending')
      expect(new Date(p.expiresAt).getTime()).toBeGreaterThan(Date.now())
    }
  })
})

describe('World Model — identifyRisk + mitigateRisk', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({ where: { relationType: 'MITIGATED_BY' } })
    await db.graphNode.deleteMany({ where: { entityType: 'Risk' } })
  })

  it('identifica un rischio', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri, risk } = await identifyRisk({
      description: 'Database connection pool exhaustion',
      severity: 'high',
      probability: 0.7,
      observedInWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^risk:\/\//)
    expect(risk.severity).toBe('high')
    expect(risk.status).toBe('identified')
  })

  it('mitiga un rischio collegandolo a una Decision', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri: riskUri } = await identifyRisk({
      description: 'Test risk for mitigation',
      severity: 'medium',
      probability: 0.5,
      observedInWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    // Crea un nodo Decision per la mitigazione
    const { createNode } = await import('@/lib/graph-age')
    const { uri: decisionUri } = await createNode({
      type: 'Decision',
      identifier: 'mitigation-decision',
      attributes: {
        rationale: 'Mitigate test risk',
        decidedBy: 'agent://test',
      },
      provenance: VALID_PROV,
    })

    await mitigateRisk({
      riskUri,
      mitigationUri: decisionUri,
      provenance: VALID_PROV,
    })

    const updated = await db.graphNode.findUnique({ where: { uri: riskUri } })
    const attrs = JSON.parse(updated!.attributes)
    expect(attrs.mitigatedByUris).toContain(decisionUri)
    expect(attrs.status).toBe('mitigating')

    // Edge MITIGATED_BY deve esistere
    const edges = await db.graphEdge.findMany({
      where: { relationType: 'MITIGATED_BY', fromNodeId: (await db.graphNode.findUnique({ where: { uri: riskUri } }))!.id },
    })
    expect(edges.length).toBeGreaterThan(0)
  })
})

describe('World Model — identifyOpportunity + exploitOpportunity', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({ where: { relationType: 'EXPLOITED_BY' } })
    await db.graphNode.deleteMany({ where: { entityType: 'Opportunity' } })
  })

  it('identifica un\'opportunità', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri, opportunity } = await identifyOpportunity({
      description: 'Opportunity to consolidate 100 episodic memories',
      potential: 'medium',
      estimatedGain: 0.4,
      observedInWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^opportunity:\/\//)
    expect(opportunity.potential).toBe('medium')
    expect(opportunity.status).toBe('identified')
  })

  it('sfrutta un\'opportunità', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri: oppUri } = await identifyOpportunity({
      description: 'Test opportunity',
      potential: 'low',
      estimatedGain: 0.2,
      observedInWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    const { createNode } = await import('@/lib/graph-age')
    const { uri: skillUri } = await createNode({
      type: 'Skill',
      identifier: 'exploit-skill@test',
      attributes: {
        name: 'Exploit Skill',
        description: 'Skill to exploit opportunity',
        promptTemplate: 'You are an exploit skill.',
      },
      provenance: VALID_PROV,
    })

    await exploitOpportunity({
      opportunityUri: oppUri,
      exploitUri: skillUri,
      provenance: VALID_PROV,
    })

    const updated = await db.graphNode.findUnique({ where: { uri: oppUri } })
    const attrs = JSON.parse(updated!.attributes)
    expect(attrs.exploitedByUris).toContain(skillUri)
    expect(attrs.status).toBe('exploiting')
  })
})

describe('World Model — runRuleBasedPredictor', () => {
  it('genera predizioni/risks/opportunities basate su regole', async () => {
    const { uri, worldState } = await captureWorldState({ provenance: VALID_PROV })
    const result = await runRuleBasedPredictor({ uri, ...worldState, basedOnWorldStateUri: uri } as any)

    expect(result).toHaveProperty('predictions')
    expect(result).toHaveProperty('risks')
    expect(result).toHaveProperty('opportunities')
    expect(Array.isArray(result.predictions)).toBe(true)
    expect(Array.isArray(result.risks)).toBe(true)
    expect(Array.isArray(result.opportunities)).toBe(true)
  })
})

describe('World Model — worldModelStats', () => {
  it('ritorna conteggi aggregati', async () => {
    const stats = await worldModelStats()
    expect(stats).toHaveProperty('worldStates')
    expect(stats).toHaveProperty('predictions')
    expect(stats).toHaveProperty('pendingPredictions')
    expect(stats).toHaveProperty('risks')
    expect(stats).toHaveProperty('opportunities')
    expect(stats.worldStates).toBeGreaterThan(0)
  })
})
