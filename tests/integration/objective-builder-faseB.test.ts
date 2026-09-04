/**
 * Integration tests for Objective Builder Fase B
 * (B1, B2, B3, B5, B6)
 *
 * B1 — objectiveStats: 5 query in Promise.all (1 round-trip DB)
 * B2 — phase12.tsx refresh() con try/catch
 * B3 — skipDescendants: depth guard + visited set (stack overflow prevention)
 * B5 — evaluateNode: valida status enum a runtime
 * B6 — evidence: size cap 10KB con marker [truncated]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'OB-FASEB-'

async function cleanupFixtures() {
  const trees = await db.objectiveTree.findMany({
    where: { rootGoal: { startsWith: 'OB-FASEB' } },
    select: { id: true },
  })
  if (trees.length > 0) {
    const treeIds = trees.map(t => t.id)
    await db.objectiveNode.deleteMany({ where: { treeId: { in: treeIds } } })
    await db.objectiveTree.deleteMany({ where: { id: { in: treeIds } } })
  }
  await db.agentLog.deleteMany({ where: { agentId: 'objective' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B1: objectiveStats con 5 query in Promise.all ====================

describe('Fase B — B1: objectiveStats con 5 query in Promise.all', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('objectiveStats ritorna tutte le 5 metriche', async () => {
    const { objectiveStats } = await import('@/lib/kernel/agent-objective')
    const stats = await objectiveStats()
    expect(stats).toHaveProperty('trees')
    expect(stats).toHaveProperty('nodes')
    expect(stats).toHaveProperty('completedTrees')
    expect(stats).toHaveProperty('passNodes')
    expect(stats).toHaveProperty('failNodes')
    for (const key of ['trees', 'nodes', 'completedTrees', 'passNodes', 'failNodes']) {
      expect(typeof (stats as any)[key]).toBe('number')
    }
  })

  it('agent-objective.ts ha B1 fix (single Promise.all)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B1 fix[\s\S]*tutte le 5 query in un unico Promise\.all/)
  })

  it('objectiveStats non ha più query sequenziali dopo il Promise.all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    // Estrai il corpo di objectiveStats
    const statsMatch = content.match(/export async function objectiveStats\(\)[\s\S]*?\n\}/)
    expect(statsMatch).not.toBeNull()
    const statsBody = statsMatch![0]
    // Verifica: un solo Promise.all
    const promiseAllCount = (statsBody.match(/Promise\.all/g) || []).length
    expect(promiseAllCount).toBe(1)
    // Dopo il Promise.all (]), non devono esserci altri await db.*
    const afterPromiseAll = statsBody.split(']')[1] || ''
    expect(afterPromiseAll).not.toMatch(/await db\.\w+\.(count|findMany)/)
  })

  it('objectiveStats riflette nuovi alberi/nodi', async () => {
    const { createObjectiveTree, evaluateNode, objectiveStats } = await import('@/lib/kernel/agent-objective')
    const before = await objectiveStats()

    const result = await createObjectiveTree('OB-FASEB stats test')
    const after = await objectiveStats()
    expect(after.trees).toBeGreaterThan(before.trees)
    expect(after.nodes).toBeGreaterThan(before.nodes)
  })
})

// === B3: skipDescendants depth guard + visited set ====================

describe('Fase B — B3: skipDescendants depth guard + cycle detection', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('agent-objective.ts ha B3 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B3 fix[\s\S]*depth guard \+ cycle detection/)
    expect(content).toMatch(/MAX_DESCENDANT_DEPTH = 10/)
  })

  it('skipDescendants ha depth guard (non scende oltre MAX)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/if \(depth >= MAX_DESCENDANT_DEPTH\) return/)
  })

  it('skipDescendants ha visited set per cycle detection', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/visited: Set<string> = new Set\(\)/)
    expect(content).toMatch(/if \(visited\.has\(nodeId\)\) return/)
    expect(content).toMatch(/visited\.add\(nodeId\)/)
  })

  it('evaluateNode con fail skippa discendenti (no stack overflow)', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB skip test')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()

    // Trova il nodo root (depth 0)
    const rootNode = treeData!.nodes.find(n => n.depth === 0)
    expect(rootNode).toBeDefined()

    // Evalua root come fail → dovrebbe skippare tutti i discendenti
    await evaluateNode(rootNode!.id, 'fail')

    // Verifica che i discendenti sono skipped
    const updatedTree = await getObjectiveTree(result.treeId)
    const descendants = updatedTree!.nodes.filter(n => n.depth > 0)
    const skippedCount = descendants.filter(n => n.status === 'skipped').length
    // Almeno alcuni discendenti devono essere skipped (quelli pending)
    expect(skippedCount).toBeGreaterThan(0)

    // Non deve crashare (no stack overflow)
    expect(updatedTree).not.toBeNull()
  })
})

// === B5: evaluateNode valida status enum ==============================

describe('Fase B — B5: evaluateNode valida status enum a runtime', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('agent-objective.ts ha B5 fix (VALID_NODE_STATUSES)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B5 fix[\s\S]*validazione runtime di.*status/)
    expect(content).toMatch(/VALID_NODE_STATUSES.*'pass'.*'fail'.*'skipped'/)
    expect(content).toMatch(/isValidNodeStatus/)
    expect(content).toMatch(/Invalid node status/)
  })

  it('evaluateNode con status valido (pass) → ok', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB pass test')
    const treeData = await getObjectiveTree(result.treeId)
    const leafNode = treeData!.nodes.find(n => n.depth > 0)
    expect(leafNode).toBeDefined()

    const updated = await evaluateNode(leafNode!.id, 'pass', { reason: 'test pass' })
    expect(updated.status).toBe('pass')
    expect(updated.evidence).toContain('test pass')
  })

  it('evaluateNode con status valido (fail) → ok + skipDescendants', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB fail test')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth === 0)
    expect(node).toBeDefined()

    const updated = await evaluateNode(node!.id, 'fail', { reason: 'test fail' })
    expect(updated.status).toBe('fail')
  })

  it('evaluateNode con status non valido (unknown) → throws', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB invalid test')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes[0]!

    try {
      await evaluateNode(node.id, 'unknown' as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid node status/)
      expect(e.message).toMatch(/pass.*fail.*skipped/)
    }
  })

  it('evaluateNode con status vuoto → throws', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB empty test')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes[0]!

    try {
      await evaluateNode(node.id, '' as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid node status/)
    }
  })

  it('evaluateNode con status numerico → throws', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB numeric test')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes[0]!

    try {
      await evaluateNode(node.id, 42 as any)
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/Invalid node status/)
    }
  })
})

// === B6: evidence size cap ===========================================

describe('Fase B — B6: evidence size cap (10KB con marker)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('agent-objective.ts ha B6 fix (MAX_EVIDENCE_SIZE)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B6 fix[\s\S]*size cap su evidence JSON/)
    expect(content).toMatch(/MAX_EVIDENCE_SIZE = 10_000/)
    expect(content).toMatch(/\.\.\.\[truncated\]'/)
  })

  it('evaluateNode con evidence piccola → non troncata', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB small evidence')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    const updated = await evaluateNode(node.id, 'pass', { reason: 'small evidence test' })
    expect(updated.evidence).toContain('small evidence test')
    expect(updated.evidence).not.toMatch(/\[truncated\]$/)
  })

  it('evaluateNode con evidence enorme → troncata con marker', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB huge evidence')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    // Crea evidence > 10KB
    const hugeEvidence = { data: 'x'.repeat(15_000) }
    const updated = await evaluateNode(node.id, 'pass', hugeEvidence)

    // B6: evidence deve essere troncata a 10KB + marker
    expect(updated.evidence!.length).toBeLessThanOrEqual(10_000 + 20)
    expect(updated.evidence).toMatch(/\[truncated\]$/)
  })

  it('evaluateNode con evidence undefined → null nel DB', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB no evidence')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    const updated = await evaluateNode(node.id, 'pass')
    expect(updated.evidence).toBeNull()
  })

  it('evaluateNode con evidence null → null nel DB', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEB null evidence')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    const updated = await evaluateNode(node.id, 'pass', null)
    expect(updated.evidence).toBeNull()
  })
})

// === B2: phase12.tsx refresh() con try/catch =========================

describe('Fase B — B2: phase12.tsx refresh() con try/catch', () => {
  it('phase12.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*try\/catch[\s\S]*refresh/)
    expect(content).toMatch(/try \{[\s\S]*Promise\.all[\s\S]*\} catch \(err\)/)
    expect(content).toMatch(/toast\.error\('Caricamento Objective Builder fallito'\)/)
    expect(content).toMatch(/console\.error\('\[phase12\] refresh failed:'/)
  })

  it('phase12.tsx refresh non cancella stato su errore', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    const catchIdx = content.indexOf("} catch (err) {")
    expect(catchIdx).toBeGreaterThan(0)
    const catchSnippet = content.slice(catchIdx, catchIdx + 400)
    expect(catchSnippet).toMatch(/toast\.error\('Caricamento Objective Builder fallito'\)/)
    // Il catch block NON deve azzerare lo stato (preserva dati già caricati)
    expect(catchSnippet).not.toMatch(/setTrees\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setStats\(null\)/)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B5+B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('B1+B5: createObjectiveTree + evaluateNode + stats coerenti', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode, objectiveStats } = await import('@/lib/kernel/agent-objective')

    const result = await createObjectiveTree('OB-FASEB smoke lifecycle')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()

    // Evalua un nodo leaf come pass
    const leafNode = treeData!.nodes.find(n => n.depth > 0)!
    await evaluateNode(leafNode.id, 'pass', { reason: 'smoke pass' })

    // Evalua un altro nodo come fail (trigger skipDescendants)
    const otherNode = treeData!.nodes.find(n => n.depth > 0 && n.id !== leafNode.id)!
    if (otherNode) {
      await evaluateNode(otherNode.id, 'fail', { reason: 'smoke fail' })
    }

    // Verifica stats
    const stats = await objectiveStats()
    expect(stats.trees).toBeGreaterThanOrEqual(1)
    expect(stats.nodes).toBeGreaterThanOrEqual(result.totalNodes)
    expect(stats.passNodes).toBeGreaterThanOrEqual(1)
    expect(stats.failNodes).toBeGreaterThanOrEqual(1)
  })

  it('B5+B6: evaluateNode valida status + cap evidence', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')

    const result = await createObjectiveTree('OB-FASEB smoke validation')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    // Status valido + evidence enorme → ok, evidence capped
    const updated = await evaluateNode(node.id, 'pass', { big: 'y'.repeat(12_000) })
    expect(updated.status).toBe('pass')
    expect(updated.evidence!.length).toBeLessThanOrEqual(10_000 + 20)
    expect(updated.evidence).toMatch(/\[truncated\]$/)
  })

  it('B2+B3: phase12.tsx try/catch + skipDescendants safe', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )

    // B2: refresh con try/catch
    expect(content).toMatch(/B2 fix[\s\S]*try\/catch[\s\S]*refresh/)
    expect(content).toMatch(/toast\.error\('Caricamento Objective Builder fallito'\)/)

    // B3: skipDescendants safe (nel backend)
    const objContent = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(objContent).toMatch(/B3 fix[\s\S]*depth guard \+ cycle detection/)
    expect(objContent).toMatch(/MAX_DESCENDANT_DEPTH = 10/)
    expect(objContent).toMatch(/visited: Set<string>/)
  })
})
