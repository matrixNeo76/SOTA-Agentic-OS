/**
 * Tests for Digital Twin Engine (Fase 3.2)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createScenario, getScenario, listScenarios,
  forkRuntimeState, runSimulation, compareScenarios,
  runWhatIf, WHAT_IF_PRESETS, digitalTwinStats,
  digitalTwinProvenance,
} from '@/lib/digital-twin/engine'
import { captureWorldState } from '@/lib/world-model/engine'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = digitalTwinProvenance()

describe('Digital Twin — createScenario', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    await db.embeddingVector.deleteMany({})
    _resetEventMeshForTests()
  })

  it('crea uno scenario di simulazione', async () => {
    const { uri, scenario } = await createScenario({
      name: 'test-scenario',
      description: 'A test simulation scenario',
      parameters: {
        agentConcurrency: 2,
        simulationHorizon: '24h',
      },
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^document:\/\//)
    expect(scenario.name).toBe('test-scenario')
    expect(scenario.status).toBe('drafted')
    expect(scenario.parameters.agentConcurrency).toBe(2)
  })

  it('rifiuta name < 3 caratteri', async () => {
    await expect(
      createScenario({
        name: 'ab',
        description: 'too short',
        parameters: { simulationHorizon: '1h' },
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/name must be at least 3 characters/)
  })

  it('crea edge BASED_ON se baseWorldStateUri specificato', async () => {
    const { uri: wsUri } = await captureWorldState({ provenance: VALID_PROV })
    const { uri: scenarioUri } = await createScenario({
      name: 'with-base-ws',
      description: 'Scenario with base world state',
      parameters: { simulationHorizon: '1h' },
      baseWorldStateUri: wsUri,
      provenance: VALID_PROV,
    })

    const edges = await db.graphEdge.findMany({
      where: { relationType: 'BASED_ON', fromNodeId: (await db.graphNode.findUnique({ where: { uri: scenarioUri } }))!.id },
    })
    expect(edges.length).toBeGreaterThan(0)
  })
})

describe('Digital Twin — getScenario + listScenarios', () => {
  it('recupera scenario per URI', async () => {
    const { uri } = await createScenario({
      name: 'get-test-scenario',
      description: 'For getScenario test',
      parameters: { simulationHorizon: '24h' },
      provenance: VALID_PROV,
    })

    const scenario = await getScenario(uri)
    expect(scenario).not.toBeNull()
    expect(scenario!.name).toBe('get-test-scenario')
  })

  it('ritorna null per URI non digital-twin', async () => {
    const { createNode } = await import('@/lib/graph-age')
    const { uri } = await createNode({
      type: 'Document',
      identifier: 'not-a-scenario',
      attributes: {
        title: 'not a scenario',
        source: 'code-analysis', // non digital-twin
        mimeType: 'text/plain',
      },
      provenance: VALID_PROV,
    })

    expect(await getScenario(uri)).toBeNull()
  })

  it('listScenarios ritorna solo documenti digital-twin', async () => {
    const scenarios = await listScenarios()
    expect(scenarios.length).toBeGreaterThan(0)
    expect(scenarios.every((s) => s.name)).toBe(true)
  })
})

describe('Digital Twin — forkRuntimeState', () => {
  it('crea un checkpoint di fork marcato come simulation', async () => {
    const { uri: scenarioUri } = await createScenario({
      name: 'fork-test',
      description: 'For fork test',
      parameters: { simulationHorizon: '1h' },
      provenance: VALID_PROV,
    })

    const { forkCheckpointId } = await forkRuntimeState({
      scenarioUri,
      provenance: VALID_PROV,
    })

    expect(forkCheckpointId).toBeTruthy()

    // Verify checkpoint is marked with simulation agent
    const checkpoint = await db.agentCheckpoint.findUnique({ where: { id: forkCheckpointId } })
    expect(checkpoint).not.toBeNull()
    expect(checkpoint!.agentUri).toBe('agent://simulation-twin')
    expect(checkpoint!.taskId).toBe('simulation-fork')
  })
})

describe('Digital Twin — runSimulation', () => {
  it('esegue simulazione e ritorna projected metrics', async () => {
    // Capture a fresh WorldState (in case other tests deleted them)
    await captureWorldState({ provenance: VALID_PROV })

    const { uri: scenarioUri } = await createScenario({
      name: `sim-test-${Date.now()}`,
      description: 'For runSimulation test',
      parameters: {
        agentConcurrency: 3,
        simulationHorizon: '24h',
      },
      provenance: VALID_PROV,
    })

    const result = await runSimulation({ scenarioUri, provenance: VALID_PROV })

    expect(result.success).toBe(true)
    expect(result.scenarioUri).toBe(scenarioUri)
    expect(result.projectedMetrics).toBeDefined()
    expect(result.projectedMetrics.expectedSuccessRate).toBeGreaterThan(0)
    expect(result.projectedMetrics.expectedSuccessRate).toBeLessThanOrEqual(1)
    expect(result.projectedMetrics.successRateCI).toHaveLength(2)
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('proietta correttamente l\'effetto del concurrency', async () => {
    await captureWorldState({ provenance: VALID_PROV })

    const { uri: baselineUri } = await createScenario({
      name: 'baseline',
      description: 'Baseline scenario',
      parameters: { simulationHorizon: '24h' },
      provenance: VALID_PROV,
    })
    const { uri: highConcurrencyUri } = await createScenario({
      name: 'high-concurrency',
      description: 'High concurrency scenario',
      parameters: { agentConcurrency: 5, simulationHorizon: '24h' },
      provenance: VALID_PROV,
    })

    const baseline = await runSimulation({ scenarioUri: baselineUri, provenance: VALID_PROV })
    const highConcurrency = await runSimulation({ scenarioUri: highConcurrencyUri, provenance: VALID_PROV })

    // High concurrency should project higher throughput
    expect(highConcurrency.projectedMetrics.expectedThroughput).toBeGreaterThan(baseline.projectedMetrics.expectedThroughput)
  })

  it('proietta correttamente l\'effetto del routing local-only', async () => {
    await captureWorldState({ provenance: VALID_PROV })

    const { uri: localUri } = await createScenario({
      name: 'local-routing',
      description: 'Local-only routing',
      parameters: { forceRoutingMode: 'local', simulationHorizon: '24h' },
      provenance: VALID_PROV,
    })
    const { uri: apiUri } = await createScenario({
      name: 'api-routing',
      description: 'API-only routing',
      parameters: { forceRoutingMode: 'api', simulationHorizon: '24h' },
      provenance: VALID_PROV,
    })

    const local = await runSimulation({ scenarioUri: localUri, provenance: VALID_PROV })
    const api = await runSimulation({ scenarioUri: apiUri, provenance: VALID_PROV })

    // Local should be cheaper than API
    expect(local.projectedMetrics.expectedCost).toBeLessThan(api.projectedMetrics.expectedCost)
  })

  it('fallisce graceful se nessun WorldState disponibile', async () => {
    await db.graphNode.deleteMany({ where: { entityType: 'WorldState' } })

    const { uri: scenarioUri } = await createScenario({
      name: 'no-ws-test',
      description: 'Test without WorldState',
      parameters: { simulationHorizon: '1h' },
      provenance: VALID_PROV,
    })

    const result = await runSimulation({ scenarioUri, provenance: VALID_PROV })
    expect(result.success).toBe(false)
    expect(result.error).toContain('WorldState')
  })
})

describe('Digital Twin — compareScenarios', () => {
  it('identifica il vincitore tra due scenari', async () => {
    await captureWorldState({ provenance: VALID_PROV })

    const resultA: any = {
      scenarioUri: 'a',
      projectedMetrics: { expectedSuccessRate: 0.9 },
    }
    const resultB: any = {
      scenarioUri: 'b',
      projectedMetrics: { expectedSuccessRate: 0.7 },
    }

    const comparison = compareScenarios(resultA, resultB, 'expectedSuccessRate')
    expect(comparison.winner).toBe('A')
    expect(comparison.deltaA).toBe(0.9)
    expect(comparison.deltaB).toBe(0.7)
  })

  it('tie se differenza < 0.01', () => {
    const resultA: any = {
      scenarioUri: 'a',
      projectedMetrics: { expectedSuccessRate: 0.85 },
    }
    const resultB: any = {
      scenarioUri: 'b',
      projectedMetrics: { expectedSuccessRate: 0.855 },
    }

    const comparison = compareScenarios(resultA, resultB, 'expectedSuccessRate')
    expect(comparison.winner).toBe('tie')
  })

  it('significance alta se differenza relativa > 20%', () => {
    const resultA: any = {
      scenarioUri: 'a',
      projectedMetrics: { expectedCost: 10 },
    }
    const resultB: any = {
      scenarioUri: 'b',
      projectedMetrics: { expectedCost: 50 },
    }

    const comparison = compareScenarios(resultA, resultB, 'expectedCost')
    expect(comparison.significance).toBe('high')
  })
})

describe('Digital Twin — runWhatIf presets', () => {
  it('esegue un preset what-if valido', async () => {
    await captureWorldState({ provenance: VALID_PROV })

    const { scenario, result } = await runWhatIf('double-concurrency', VALID_PROV)
    expect(scenario.name).toContain('what-if-double-concurrency')
    expect(result.success).toBe(true)
  })

  it('rifiuta preset sconosciuto', async () => {
    await expect(
      runWhatIf('nonexistent-preset', VALID_PROV),
    ).rejects.toThrow(/Unknown preset/)
  })

  it('WHAT_IF_PRESETS contiene almeno 6 preset', () => {
    expect(WHAT_IF_PRESETS.length).toBeGreaterThanOrEqual(6)
    expect(WHAT_IF_PRESETS.some((p) => p.name === 'double-concurrency')).toBe(true)
    expect(WHAT_IF_PRESETS.some((p) => p.name === 'local-only-routing')).toBe(true)
    expect(WHAT_IF_PRESETS.some((p) => p.name === 'remove-reflective-agent')).toBe(true)
  })
})

describe('Digital Twin — digitalTwinStats', () => {
  it('ritorna aggregati', async () => {
    const stats = await digitalTwinStats()
    expect(stats.totalScenarios).toBeGreaterThan(0)
    expect(typeof stats.byStatus).toBe('object')
    expect(stats.availablePresets).toBeGreaterThanOrEqual(6)
  })
})
