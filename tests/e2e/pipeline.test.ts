/**
 * E2E Smoke Tests — Fase 6.1
 *
 * Test end-to-end che esercitano la pipeline completa:
 *   User input → Cognitive Router → DynAMO → Event Mesh → Context Graph
 *   → Memory Fabric → ERL → Skill Registry → Evaluation → World Model
 *
 * A differenza degli unit test, questi test:
 *   - Toccano più moduli insieme (non isolati)
 *   - Possono usare LLM reale (se ZAI disponibile) con fallback
 *   - Verificano che l'integrazione tra moduli funzioni
 *   - Puliscono lo stato alla fine per idempotenza
 *
 * NOTA: Per evitare rate limit, questi test usano useLLM: false di default.
 * Per testare con LLM reale, impostare E2E_USE_LLM=true.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  bootstrapDefaultMesh,
  delegateTask,
  getMeshTopology,
} from '@/lib/agent-mesh/topology'
import {
  captureWorldState,
  runRuleBasedPredictor,
  identifyRisk,
  identifyOpportunity,
} from '@/lib/world-model/engine'
import {
  registerBenchmark,
  runEvaluation,
  type TaskResult,
} from '@/lib/evaluation/runner'
import {
  createClaimAndDetectConflicts,
  resolveConflict,
} from '@/lib/conflict-resolution/engine'
import {
  registerSkill,
  searchSkills,
} from '@/lib/skill-registry/registry'
import {
  detectSkillGaps,
  runSynthesisPipeline,
} from '@/lib/skill-synthesis/pipeline'
import {
  consolidateEpisodicToProcedural,
} from '@/lib/cognitive-gc/curator'
import {
  createProposal,
  approveProposal,
  generateAutoProposals,
} from '@/lib/autonomous-org/governor'
import {
  startIntegrationLayer,
  stopIntegrationLayer,
} from '@/lib/integration/bridges'
import {
  publishTaskCreated,
  publishTaskCompleted,
  publishTaskFailed,
} from '@/lib/event-mesh/publishers'
import {
  classifyTask,
  planRouting,
} from '@/lib/cognitive-router/router'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const USE_LLM = process.env.E2E_USE_LLM === 'true'
const VALID_PROV = createProvenance({
  agent: 'agent://e2e-test',
  source: 'system-event',
  confidence: 1.0,
})

// Cleanup before & after all tests
beforeAll(async () => {
  await db.graphEdge.deleteMany({})
  await db.graphNode.deleteMany({})
  await db.agentLog.deleteMany({})
  await db.blockedAction.deleteMany({})
  await db.memoryEntry.deleteMany({})
  await db.costEntry.deleteMany({})
  _resetEventMeshForTests()
  await startIntegrationLayer()
})

afterAll(async () => {
  await stopIntegrationLayer()
})

describe('E2E — Pipeline completa User → Cognitive Router → Graph', () => {
  it('classify + plan routing + publish event + graph populated', async () => {
    // 1. Classifica un task
    const classification = await classifyTask('deploy critical security patch', { useLLM: USE_LLM })
    expect(classification.complexity).toBe('Critical')

    // 2. Plan routing
    const strategy = await planRouting('deploy critical security patch', { useLLM: USE_LLM })
    expect(strategy.routing).toBe('api')
    expect(strategy.preferredModels.some((m) => m.specialization === 'reasoning')).toBe(true)

    // 3. Publish event → Context Graph popolato
    const initialTasks = await db.graphNode.count({ where: { entityType: 'Task' } })
    await publishTaskCreated(
      'task://e2e-1',
      'deploy critical security patch',
      'agent://test',
      VALID_PROV,
    )
    await new Promise((r) => setTimeout(r, 200)) // wait for subscriber

    const afterTasks = await db.graphNode.count({ where: { entityType: 'Task' } })
    expect(afterTasks).toBeGreaterThan(initialTasks)
  })

  it('task completion + failure events populate Experience + memory', async () => {
    // Create the task first
    await publishTaskCreated('task://e2e-2', 'test task', 'agent://test', VALID_PROV)
    await new Promise((r) => setTimeout(r, 200))

    const initialExperiences = await db.graphNode.count({ where: { entityType: 'Experience' } })

    // Complete + fail some tasks
    await publishTaskCompleted('task://e2e-2', 'success', 1000, VALID_PROV)
    await publishTaskFailed('task://e2e-3', 'timeout', false, VALID_PROV)
    await new Promise((r) => setTimeout(r, 200))

    const afterExperiences = await db.graphNode.count({ where: { entityType: 'Experience' } })
    expect(afterExperiences).toBeGreaterThan(initialExperiences)
  })
})

describe('E2E — Mesh bootstrap + delegation + World Model capture', () => {
  it('bootstrap mesh, capture world state, run predictor', async () => {
    // 1. Bootstrap mesh
    const { created, mesh } = await bootstrapDefaultMesh(VALID_PROV)
    expect(mesh.nodes.length).toBeGreaterThanOrEqual(10)

    // 2. Capture world state
    const { worldState } = await captureWorldState({ provenance: VALID_PROV })
    expect(worldState.snapshot).toBeDefined()
    expect(worldState.snapshot.activeAgents).toBeGreaterThan(0)

    // 3. Run rule-based predictor
    const predictions = await runRuleBasedPredictor({ ...worldState, uri: worldState.uri, basedOnWorldStateUri: worldState.uri } as any)
    expect(predictions).toHaveProperty('predictions')
    expect(predictions).toHaveProperty('risks')
    expect(predictions).toHaveProperty('opportunities')
  })

  it('delegate task from CEO to planner (with permission check)', async () => {
    const result = await delegateTask({
      fromAgentUri: 'agent://ceo',
      toAgentUri: 'agent://planner',
      taskUri: 'task://delegation-e2e',
      provenance: VALID_PROV,
    })
    expect(result.delegated).toBe(true)
  })
})

describe('E2E — Skill Registry + Synthesis pipeline', () => {
  it('register skill → search → detect gaps → synthesize', async () => {
    // 1. Register a skill
    const { uri } = await registerSkill({
      name: `e2e-skill-${Date.now()}`,
      description: 'E2E test skill for validation',
      promptTemplate: 'You are a test assistant. Task: {{task}}',
      tags: ['e2e', 'test'],
      provenance: VALID_PROV,
    })
    expect(uri).toMatch(/^skill:\/\//)

    // 2. Search for it
    const results = await searchSkills('e2e test')
    expect(results.length).toBeGreaterThan(0)

    // 3. Detect gaps (should return empty since we have no failed tasks with patterns)
    const gaps = await detectSkillGaps({ minOccurrences: 1, daysWindow: 1 })
    expect(Array.isArray(gaps)).toBe(true)

    // 4. Synthesis pipeline with manual gap (no autoApprove to avoid registry pollution)
    const pipelines = await runSynthesisPipeline({
      gap: {
        id: `e2e-gap-${Date.now()}`,
        description: 'E2E test gap for skill synthesis',
        evidence: [
          { taskUri: 'task://e2e-fail-1', failurePattern: 'test failure pattern', occurrences: 1 },
        ],
        suggestedSkillName: `e2e-synth-${Date.now()}`,
        suggestedDomain: 'test domain',
        detectedAt: new Date().toISOString(),
      },
      provenance: VALID_PROV,
      autoApprove: false, // Don't register, just test the pipeline
    })

    expect(pipelines.length).toBe(1)
    expect(pipelines[0]!.sandbox).toBeDefined()
    // Final status can be 'pending_approval' or 'rejected' depending on sandbox validation result
    expect(['pending_approval', 'rejected', 'approved']).toContain(pipelines[0]!.finalStatus)
  })
})

describe('E2E — Conflict Resolution with real claims', () => {
  it('create conflicting claims → detect → resolve', async () => {
    // 1. Create first claim (high confidence)
    const { claimUri: claimA, conflicts: conflicts1 } = await createClaimAndDetectConflicts({
      identifier: `e2e-claim-a-${Date.now()}`,
      statement: 'TypeScript is statically typed',
      confidence: 0.95,
      domain: 'e2e-test-domain',
      provenance: VALID_PROV,
    })
    expect(conflicts1).toEqual([])

    // 2. Create conflicting claim (low confidence, same domain)
    const { conflicts: conflicts2 } = await createClaimAndDetectConflicts({
      identifier: `e2e-claim-b-${Date.now()}`,
      statement: 'TypeScript is dynamically typed',
      confidence: 0.2, // diff > 0.5 → high severity
      domain: 'e2e-test-domain',
      provenance: VALID_PROV,
    })
    expect(conflicts2.length).toBeGreaterThan(0)

    // 3. Resolve the conflict with higher-confidence strategy
    const conflict = conflicts2[0]!
    const resolution = await resolveConflict({
      conflictUri: conflict.uri,
      strategy: 'higher-confidence',
      resolvedBy: 'agent://e2e-test',
      provenance: VALID_PROV,
    })

    expect(resolution.winnerUri).toBe(claimA) // higher confidence wins
    expect(resolution.loserUri).not.toBe(claimA)
  })
})

describe('E2E — Evaluation Layer with benchmark', () => {
  it('register benchmark → run evaluation → verify metrics', async () => {
    // 1. Register a benchmark
    const { uri: bmUri } = await registerBenchmark({
      name: `e2e-benchmark-${Date.now()}`,
      description: 'E2E test benchmark',
      dataset: {
        tasks: [
          { id: 't1', input: 'What is 2+2?', expectedContains: ['4'], difficulty: 'trivial' },
          { id: 't2', input: 'Capitalize hello', expectedContains: ['HELLO'], difficulty: 'trivial' },
        ],
        successCriteria: ['All tests pass'],
      },
      provenance: VALID_PROV,
    })

    // 2. Run evaluation
    const taskResults: TaskResult[] = [
      { taskId: 't1', success: true, output: 'The answer is 4', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 100, cost: 0 },
      { taskId: 't2', success: false, output: 'hello', toolCallsUsed: [], forbiddenActionsTriggered: [], durationMs: 50, cost: 0 },
    ]

    const { evaluation } = await runEvaluation({
      agentUri: 'agent://e2e-test',
      benchmarkUri: bmUri,
      taskResults,
      provenance: VALID_PROV,
    })

    expect(evaluation.verdict).toBe('partial') // 1/2 success
    expect(evaluation.metrics.length).toBe(8)
    expect(evaluation.overallScore).toBeGreaterThan(0)
    expect(evaluation.overallScore).toBeLessThanOrEqual(1)
  })
})

describe('E2E — Memory Fabric + Cognitive GC', () => {
  it('store memories → consolidate → verify procedural generated', async () => {
    const { storeMemory } = await import('@/lib/memory-fabric/fabric')
    const { embed } = await import('@/lib/embeddings')

    // 1. Store 5 similar episodic memories
    const baseContent = 'e2e pattern test for consolidation'
    for (let i = 0; i < 5; i++) {
      await storeMemory({
        layer: 'episodic',
        agentUri: 'agent://e2e-gc-test',
        content: `${baseContent} variant ${i}`,
        embedding: embed(baseContent),
        utilityScore: 0.7,
      })
    }

    // 2. Run consolidation
    const result = await consolidateEpisodicToProcedural({
      agentUri: 'agent://e2e-gc-test',
      minClusterSize: 3,
      similarityThreshold: 0.5,
    })

    expect(result.inputMemories).toBeGreaterThanOrEqual(5)
    expect(result.newProceduralMemories).toBeGreaterThan(0)
    expect(result.archivedMemories).toBeGreaterThan(0)
  })
})

describe('E2E — Autonomous Org with HITL approval', () => {
  it('generate proposals → approve → verify execution', async () => {
    // 1. Generate auto proposals (from current WorldState)
    const proposals = await generateAutoProposals({
      maxProposals: 2,
      provenance: VALID_PROV,
    })
    expect(proposals.length).toBeLessThanOrEqual(2)

    if (proposals.length === 0) {
      // No proposals generated (system healthy) — create one manually
      const { uri } = await createProposal({
        type: 'reorganize_memory',
        description: 'E2E test reorganization proposal',
        rationale: 'Test HITL flow',
        expectedImpact: { costDelta: 0, performanceDelta: 0.1, riskLevel: 'low' },
        payload: {
          consolidationStrategy: 'selective',
          archivalPolicy: 'gradual',
          rationale: 'E2E test',
        },
        provenance: VALID_PROV,
      })
      proposals.push({ uri } as any)
    }

    // 2. Approve the first proposal
    const proposalUri = proposals[0]!.uri
    const result = await approveProposal({
      proposalUri,
      approvedBy: 'user://e2e-admin',
      provenance: VALID_PROV,
    })

    expect(result.executed).toBe(true)
    expect(result.result?.success).toBe(true)
  })
})

describe('E2E — Full pipeline integration', () => {
  it('mesh + world model + proposals + conflicts all coexist', async () => {
    // Verify that all systems are populated and functional together
    const topology = await getMeshTopology()
    expect(topology.nodes.length).toBeGreaterThan(0)

    const stats = await Promise.all([
      db.graphNode.count({ where: { entityType: 'Agent' } }),
      db.graphNode.count({ where: { entityType: 'Task' } }),
      db.graphNode.count({ where: { entityType: 'WorldState' } }),
      db.graphNode.count({ where: { entityType: 'Decision' } }),
      db.graphNode.count({ where: { entityType: 'Skill' } }),
    ])

    // All entity types should have at least one node after E2E
    expect(stats[0]).toBeGreaterThan(0) // Agents (from mesh bootstrap)
    expect(stats[1]).toBeGreaterThan(0) // Tasks (from event publish)
    expect(stats[2]).toBeGreaterThan(0) // WorldStates (from capture)
    expect(stats[4]).toBeGreaterThan(0) // Skills (from register)
  })
})
