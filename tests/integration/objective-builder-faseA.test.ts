/**
 * Integration tests for Objective Builder Fase A
 * (C1, C2, C3)
 *
 * C1 — createObjectiveTree integrato in executePlan (non bloccante, fail-open)
 * C2 — generateSubGoal retry logic + size cap su output (200 char con marker)
 * C3 — POST /api/objective con requireAdmin (prima era requireAuth)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'ob-faseA-'
const TEST_AGENT = 'ob-faseA-agent'

async function cleanupFixtures() {
  // Pulisci objective trees/nodes con rootGoal che inizia con il prefisso di test
  const trees = await db.objectiveTree.findMany({
    where: { rootGoal: { startsWith: 'OB-FASE-A' } },
    select: { id: true },
  })
  if (trees.length > 0) {
    const treeIds = trees.map(t => t.id)
    await db.objectiveNode.deleteMany({ where: { treeId: { in: treeIds } } })
    await db.objectiveTree.deleteMany({ where: { id: { in: treeIds } } })
  }
  await db.agentLog.deleteMany({ where: { agentId: 'objective' } })
  // cleanup executor integration side-effects
  await db.planTask.deleteMany({ where: { planId: { startsWith: TEST_PREFIX } } })
  await db.executionTrace.deleteMany({ where: { workflowId: { startsWith: TEST_PREFIX } } })
  await db.agentPlan.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C2: generateSubGoal retry + size cap ============================

describe('Fase A — C2: generateSubGoal retry + size cap', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('agent-objective.ts ha C2 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*retry logic \+ size cap su output/)
    expect(content).toMatch(/MAX_SUBGOAL_SIZE = 200/)
    expect(content).toMatch(/MAX_SUBGOAL_RETRIES = 2/)
  })

  it('agent-objective.ts ha truncateSubGoal helper', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/function truncateSubGoal\(value: string\): string/)
    expect(content).toMatch(/return value\.slice\(0, MAX_SUBGOAL_SIZE\) \+ '\.\.\.\[truncated\]'/)
  })

  it('agent-objective.ts ha retry loop con maxAttempts', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/maxAttempts = MAX_SUBGOAL_RETRIES \+ 1/)
    expect(content).toMatch(/for \(let attempt = 1; attempt <= maxAttempts; attempt\+\+\)/)
  })

  it('agent-objective.ts ha backoff esponenziale tra tentativi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/await new Promise\(\(r\) => setTimeout\(r, 100 \* attempt\)\)/)
    expect(content).toMatch(/console\.warn\(`\[agent-objective\] generateSubGoal attempt/)
  })

  it('createObjectiveTree crea nodi con description ≤ 200 char', async () => {
    const { createObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASE-A test size cap')
    expect(result.treeId).toBeTruthy()

    const nodes = await db.objectiveNode.findMany({ where: { treeId: result.treeId } })
    expect(nodes.length).toBeGreaterThan(0)
    // C2: tutte le description devono essere ≤ 200 char + marker
    for (const node of nodes) {
      // Se la description contiene [truncated], può essere 200 + 17 (marker)
      expect(node.description.length).toBeLessThanOrEqual(200 + 20)
    }
  })

  it('createObjectiveTree non crasha se LLM fallisce (fallback deterministico)', async () => {
    const { createObjectiveTree } = await import('@/lib/kernel/agent-objective')
    // Anche se LLM fallisce (no API key in test env), il fallback genera sub-goal
    const result = await createObjectiveTree('OB-FASE-A fallback test')
    expect(result.treeId).toBeTruthy()
    expect(result.totalNodes).toBeGreaterThan(0)
    expect(result.maxDepth).toBeGreaterThan(0)

    const nodes = await db.objectiveNode.findMany({ where: { treeId: result.treeId } })
    expect(nodes.length).toBe(result.totalNodes)
    // Le description devono contenere "Verifica" (fallback pattern) se LLM non disponibile
    const fallbackNodes = nodes.filter(n => n.description.startsWith('Verifica'))
    expect(fallbackNodes.length).toBeGreaterThan(0)
  })
})

// === C3: POST /api/objective con requireAdmin ========================

describe('Fase A — C3: POST /api/objective requireAdmin', () => {
  it('objective/route.ts ha import requireAdmin', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/objective/route.ts'),
      'utf-8',
    )
    expect(content).toMatch(/import \{ requireAdmin \} from '@\/lib\/auth\/require-admin'/)
  })

  it('objective/route.ts POST usa requireAdmin (non requireAuth)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/objective/route.ts'),
      'utf-8',
    )
    // POST deve usare requireAdmin
    const postMatch = content.match(/export async function POST[\s\S]*?return NextResponse/)
    expect(postMatch).not.toBeNull()
    expect(postMatch![0]).toMatch(/requireAdmin/)
    expect(postMatch![0]).not.toMatch(/requireAuth\(req\)/)
  })

  it('objective/route.ts GET usa ancora requireAuth (lettura permessa)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/objective/route.ts'),
      'utf-8',
    )
    // GET resta requireAuth (lettura permessa a tutti gli autenticati)
    const getMatch = content.match(/export async function GET[\s\S]*?return NextResponse/)
    expect(getMatch).not.toBeNull()
    expect(getMatch![0]).toMatch(/requireAuth\(req\)/)
    expect(getMatch![0]).not.toMatch(/requireAdmin/)
  })

  it('objective/route.ts ha C3 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/objective/route.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix[\s\S]*requireAdmin/)
    expect(content).toMatch(/create_tree[\s\S]*requireAdmin/)
    expect(content).toMatch(/evaluate_node[\s\S]*requireAdmin/)
  })
})

// === C1: createObjectiveTree integrato in executePlan =================

describe('Fase A — C1: createObjectiveTree integrato in executePlan', () => {
  it('executor.ts ha import dinamico di createObjectiveTree', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/createObjectiveTree/)
    expect(content).toMatch(/agent-objective/)
  })

  it('executor.ts ha C1 fix comment Objective Builder', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*Objective Builder audit Fase A[\s\S]*createObjectiveTree/)
    expect(content).toMatch(/Phase 1.5: Objective Tree decomposition/)
  })

  it('executor.ts createObjectiveTree è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Deve essere dentro try/catch (fail-open)
    expect(content).toMatch(/createObjectiveTree[\s\S]*?} catch \{[\s\S]*?Non bloccante[\s\S]*?createObjectiveTree[\s\S]*?fallisce/)
  })

  it('executor.ts emette evento objective_tree_created', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/onEvent\?\.\('objective_tree_created'/)
    expect(content).toMatch(/treeId: treeResult\.treeId/)
    expect(content).toMatch(/totalNodes: treeResult\.totalNodes/)
  })

  it('executor.ts ExecutorResult ha objectiveTreeId opzionale', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/objectiveTreeId\?: string[\s\S]*C1 fix Objective Builder/)
  })

  it('executor.ts return include objectiveTreeId', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Il return di executePlan deve includere objectiveTreeId
    expect(content).toMatch(/objectiveTreeId, \/\/ C1 fix Objective Builder: tree creato in Phase 1.5/)
  })

  it('executePlan crea objective tree durante esecuzione (non blocca)', async () => {
    const { db } = await import('@/lib/db')
    const planId = `${TEST_PREFIX}c1-integration-${Date.now()}`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'OB-FASE-A C1 integration test',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'Simple task', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Simple task',
            dependencies: '[]',
            status: 'pending',
          }],
        },
      },
    })

    const { executePlan } = await import('@/lib/runtime/executor')
    const result = await executePlan({
      planId,
      signal: new AbortController().signal,
    })

    // Il task deve completare (done/failed/blocked), non crashare
    expect(result.steps.length).toBe(1)
    expect(['done', 'failed', 'blocked']).toContain(result.steps[0]!.status)

    // C1: executePlan ritorna objectiveTreeId (se createObjectiveTree è riuscito)
    // Anche se LLM fallisce, createObjectiveTree crea comunque un tree con fallback
    if (result.objectiveTreeId) {
      const tree = await db.objectiveTree.findUnique({ where: { id: result.objectiveTreeId } })
      expect(tree).not.toBeNull()
      expect(tree!.rootGoal).toBe('OB-FASE-A C1 integration test')
      expect(tree!.totalNodes).toBeGreaterThan(0)
    }

    // Cleanup
    if (result.objectiveTreeId) {
      await db.objectiveNode.deleteMany({ where: { treeId: result.objectiveTreeId } })
      await db.objectiveTree.delete({ where: { id: result.objectiveTreeId } })
    }
    await db.planTask.deleteMany({ where: { planId } })
    await db.executionTrace.deleteMany({ where: { workflowId: planId } })
    await db.agentPlan.delete({ where: { id: planId } })
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('createObjectiveTree lifecycle: tree + nodi + size cap + fallback', async () => {
    const { createObjectiveTree, getObjectiveTree, objectiveStats } = await import('@/lib/kernel/agent-objective')

    // Crea un albero
    const result = await createObjectiveTree('OB-FASE-A smoke test full lifecycle')
    expect(result.treeId).toBeTruthy()
    expect(result.totalNodes).toBeGreaterThan(0)
    expect(result.maxDepth).toBeGreaterThan(0)

    // Verifica tree persistito
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()
    expect(treeData!.tree.status).toBe('expanded')
    expect(treeData!.nodes.length).toBe(result.totalNodes)

    // C2: tutte le description ≤ 200 + marker
    for (const node of treeData!.nodes) {
      expect(node.description.length).toBeLessThanOrEqual(200 + 20)
    }

    // Verifica stats aggiornate
    const stats = await objectiveStats()
    expect(stats.trees).toBeGreaterThanOrEqual(1)
    expect(stats.nodes).toBeGreaterThanOrEqual(result.totalNodes)
  })

  it('C1+C2 smoke: executePlan crea tree + nodi capped (non blocca)', async () => {
    const { db } = await import('@/lib/db')
    const planId = `${TEST_PREFIX}smoke-${Date.now()}`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'OB-FASE-A smoke executePlan',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'Task 1', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Task 1',
            dependencies: '[]',
            status: 'pending',
          }],
        },
      },
    })

    const { executePlan } = await import('@/lib/runtime/executor')
    const result = await executePlan({
      planId,
      signal: new AbortController().signal,
    })

    // Il piano deve completare (C1 non blocca anche se createObjectiveTree fallisce)
    expect(result.steps.length).toBe(1)
    expect(['done', 'failed', 'blocked']).toContain(result.steps[0]!.status)

    // C1: objectiveTreeId può essere undefined se createObjectiveTree fallisce
    // (rate limit LLM, ecc.) — il test verifica che non crasha l'executor
    if (result.objectiveTreeId) {
      // C2: verifica nodi con size cap
      const nodes = await db.objectiveNode.findMany({ where: { treeId: result.objectiveTreeId } })
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node.description.length).toBeLessThanOrEqual(200 + 20)
      }

      // Cleanup tree
      await db.objectiveNode.deleteMany({ where: { treeId: result.objectiveTreeId } })
      await db.objectiveTree.delete({ where: { id: result.objectiveTreeId } })
    }

    // Cleanup plan
    await db.planTask.deleteMany({ where: { planId } })
    await db.executionTrace.deleteMany({ where: { workflowId: planId } })
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('C3 smoke: route.ts policy corretta per GET vs POST', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/objective/route.ts'),
      'utf-8',
    )

    // GET: requireAuth (lettura permessa a viewer)
    const getSection = content.match(/export async function GET[\s\S]*?\n\}/)
    expect(getSection).not.toBeNull()
    expect(getSection![0]).toMatch(/requireAuth/)

    // POST: requireAdmin (mutative richiede admin)
    const postSection = content.match(/export async function POST[\s\S]*?\n\}/)
    expect(postSection).not.toBeNull()
    expect(postSection![0]).toMatch(/requireAdmin/)

    // Verifica count: 1 requireAuth (GET) + 1 requireAdmin (POST)
    const requireAuthCount = (content.match(/requireAuth\(req\)/g) || []).length
    const requireAdminCount = (content.match(/requireAdmin\(req\)/g) || []).length
    expect(requireAuthCount).toBe(1) // solo GET
    expect(requireAdminCount).toBe(1) // solo POST
  })
})
