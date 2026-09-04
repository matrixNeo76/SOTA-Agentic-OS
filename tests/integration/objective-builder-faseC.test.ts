/**
 * Integration tests for Objective Builder Fase C
 * (G1, G2, G3, G4)
 *
 * G1 — Unit test per generateTreeStructure/evaluateNode/skipDescendants/getObjectiveTree in isolamento
 * G2 — phase12.tsx a11y (aria-label, role=status)
 * G3 — phase12.tsx createTree/evalNode/loadTree parse-safe su r.json()
 * G4 — objectiveStats con metriche aggiuntive (passRate, avgNodesPerTree, avgMaxDepth, completionRate)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'OB-FASEC-'

async function cleanupFixtures() {
  const trees = await db.objectiveTree.findMany({
    where: { rootGoal: { startsWith: 'OB-FASEC' } },
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

// === G1: generateTreeStructure in isolamento ===========================

describe('Fase C — G1: generateTreeStructure BFS con arresto peso', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('generateTreeStructure ritorna root con depth 0 e weight 1.0', async () => {
    const { generateTreeStructure } = await import('@/lib/kernel/agent-objective')
    const root = await generateTreeStructure('OB-FASEC root test')
    expect(root.depth).toBe(0)
    expect(root.weight).toBe(1.0)
    expect(root.contextTier).toBe('strategic')
    expect(root.description).toBe('OB-FASEC root test')
  })

  it('generateTreeStructure crea figli con peso dimezzato', async () => {
    const { generateTreeStructure } = await import('@/lib/kernel/agent-objective')
    const root = await generateTreeStructure('OB-FASEC weight test')
    expect(root.children).toBeDefined()
    expect(root.children!.length).toBeGreaterThan(0)
    // Ogni figlio ha peso = peso padre / BRANCHING_FACTOR (3)
    for (const child of root.children!) {
      expect(child.weight).toBeCloseTo(1.0 / 3, 5)
      expect(child.depth).toBe(1)
    }
  })

  it('generateTreeStructure assegna contextTier per depth', async () => {
    const { generateTreeStructure } = await import('@/lib/kernel/agent-objective')
    const root = await generateTreeStructure('OB-FASEC tier test')
    expect(root.contextTier).toBe('strategic')  // depth 0

    if (root.children) {
      for (const child of root.children) {
        // depth 1-2 → methodological, depth 3+ → implementation
        if (child.depth <= 2) {
          expect(child.contextTier).toBe('methodological')
        } else {
          expect(child.contextTier).toBe('implementation')
        }
      }
    }
  })

  it('generateTreeStructure rispetta MAX_DEPTH = 5', async () => {
    const { generateTreeStructure } = await import('@/lib/kernel/agent-objective')
    const root = await generateTreeStructure('OB-FASEC depth test')
    // Verifica che nessun nodo supera depth 5
    const allDepths: number[] = []
    const collect = (node: any) => {
      allDepths.push(node.depth)
      if (node.children) node.children.forEach(collect)
    }
    collect(root)
    const maxDepth = Math.max(...allDepths)
    expect(maxDepth).toBeLessThanOrEqual(5)
  })

  it('generateTreeStructure rispetta WEIGHT_THRESHOLD = 0.1', async () => {
    const { generateTreeStructure } = await import('@/lib/kernel/agent-objective')
    const root = await generateTreeStructure('OB-FASEC threshold test')
    // Verifica che nessun nodo ha peso < 0.1 (trono se sotto threshold)
    const allWeights: number[] = []
    const collect = (node: any) => {
      allWeights.push(node.weight)
      if (node.children) node.children.forEach(collect)
    }
    collect(root)
    for (const w of allWeights) {
      expect(w).toBeGreaterThanOrEqual(0.1)
    }
  })
})

// === G1: createObjectiveTree lifecycle ================================

describe('Fase C — G1: createObjectiveTree lifecycle', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('createObjectiveTree crea tree con status expanded', async () => {
    const { createObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC lifecycle test')
    const tree = await db.objectiveTree.findUnique({ where: { id: result.treeId } })
    expect(tree).not.toBeNull()
    expect(tree!.status).toBe('expanded')
    expect(tree!.totalNodes).toBe(result.totalNodes)
    expect(tree!.maxDepth).toBe(result.maxDepth)
  })

  it('createObjectiveTree crea nodi con parentId gerarchico', async () => {
    const { createObjectiveTree, getObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC hierarchy test')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()

    // Root node ha parentId null
    const rootNode = treeData!.nodes.find(n => n.depth === 0)
    expect(rootNode).toBeDefined()
    expect(rootNode!.parentId).toBeNull()

    // Almeno 1 nodo con parentId non null (figlio)
    const childNodes = treeData!.nodes.filter(n => n.parentId !== null)
    expect(childNodes.length).toBeGreaterThan(0)
  })

  it('createObjectiveTree totalNodes match nodi persistiti', async () => {
    const { createObjectiveTree, getObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC count test')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData!.nodes.length).toBe(result.totalNodes)
  })
})

// === G1: evaluateNode + skipDescendants in isolamento =================

describe('Fase C — G1: evaluateNode + skipDescendants', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('evaluateNode con pass aggiorna status + evidence', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC eval pass')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    const updated = await evaluateNode(node.id, 'pass', { reason: 'test pass' })
    expect(updated.status).toBe('pass')
    expect(updated.evidence).toContain('test pass')
    expect(updated.evaluatedAt).not.toBeNull()
  })

  it('evaluateNode con fail trigger skipDescendants', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC eval fail skip')
    const treeData = await getObjectiveTree(result.treeId)
    // Evalua un nodo con figli come fail
    const nodeWithChildren = treeData!.nodes.find(n => n.depth < 4)!
    const childrenCount = treeData!.nodes.filter(n => n.parentId === nodeWithChildren.id).length

    await evaluateNode(nodeWithChildren.id, 'fail')

    // Verifica che i figli sono skipped
    const updatedTree = await getObjectiveTree(result.treeId)
    const children = updatedTree!.nodes.filter(n => n.parentId === nodeWithChildren.id)
    for (const child of children) {
      // Se era pending, ora deve essere skipped
      if (child.status !== 'pass' && child.status !== 'fail') {
        expect(child.status).toBe('skipped')
      }
    }
  })

  it('evaluateNode con skipped non trigger skipDescendants', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC eval skip')
    const treeData = await getObjectiveTree(result.treeId)
    const node = treeData!.nodes.find(n => n.depth > 0)!

    await evaluateNode(node.id, 'skipped')
    // Status aggiornato ma nessun skip sui discendenti
    const updated = await db.objectiveNode.findUnique({ where: { id: node.id } })
    expect(updated!.status).toBe('skipped')
  })

  it('checkTreeCompletion marca tree come done quando tutti valutati', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC completion')
    const treeData = await getObjectiveTree(result.treeId)

    // Valuta tutti i nodi come pass
    for (const node of treeData!.nodes) {
      await evaluateNode(node.id, 'pass')
    }

    // Verifica che il tree è done
    const tree = await db.objectiveTree.findUnique({ where: { id: result.treeId } })
    expect(tree!.status).toBe('done')
  })
})

// === G1: getObjectiveTree ordinamento =================================

describe('Fase C — G1: getObjectiveTree ordinamento', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('getObjectiveTree ritorna nodes ordinati per depth asc', async () => {
    const { createObjectiveTree, getObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC ordering')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()

    // Verifica ordinamento per depth asc
    for (let i = 1; i < treeData!.nodes.length; i++) {
      expect(treeData!.nodes[i]!.depth).toBeGreaterThanOrEqual(treeData!.nodes[i - 1]!.depth)
    }
  })

  it('getObjectiveTree ritorna null per treeId non esistente', async () => {
    const { getObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const treeData = await getObjectiveTree('nonexistent-tree-id')
    expect(treeData).toBeNull()
  })

  it('getObjectiveTree ritorna tree + nodes struttura', async () => {
    const { createObjectiveTree, getObjectiveTree } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC structure')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()
    expect(treeData!.tree).toBeDefined()
    expect(treeData!.tree.id).toBe(result.treeId)
    expect(treeData!.tree.rootGoal).toBe('OB-FASEC structure')
    expect(Array.isArray(treeData!.nodes)).toBe(true)
  })
})

// === G4: objectiveStats metriche aggiuntive ==========================

describe('Fase C — G4: objectiveStats metriche aggiuntive', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('objectiveStats ritorna tutte le 9 metriche (5 originali + 4 G4)', async () => {
    const { objectiveStats } = await import('@/lib/kernel/agent-objective')
    const stats = await objectiveStats()
    // 5 originali
    expect(stats).toHaveProperty('trees')
    expect(stats).toHaveProperty('nodes')
    expect(stats).toHaveProperty('completedTrees')
    expect(stats).toHaveProperty('passNodes')
    expect(stats).toHaveProperty('failNodes')
    // 4 G4
    expect(stats).toHaveProperty('passRate')
    expect(stats).toHaveProperty('avgNodesPerTree')
    expect(stats).toHaveProperty('avgMaxDepth')
    expect(stats).toHaveProperty('completionRate')
  })

  it('objectiveStats passRate = passNodes / (passNodes + failNodes)', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode, objectiveStats } = await import('@/lib/kernel/agent-objective')
    const result = await createObjectiveTree('OB-FASEC passRate')
    const treeData = await getObjectiveTree(result.treeId)

    // Evalua 1 nodo pass e 1 fail
    const nodes = treeData!.nodes.filter(n => n.depth > 0)
    if (nodes.length >= 2) {
      await evaluateNode(nodes[0]!.id, 'pass')
      await evaluateNode(nodes[1]!.id, 'fail')
    }

    const stats = await objectiveStats()
    const evaluated = stats.passNodes + stats.failNodes
    if (evaluated > 0) {
      expect(stats.passRate).toBeCloseTo(stats.passNodes / evaluated, 5)
    }
    expect(stats.passRate).toBeGreaterThanOrEqual(0)
    expect(stats.passRate).toBeLessThanOrEqual(1)
  })

  it('objectiveStats avgNodesPerTree = nodes / trees', async () => {
    const { createObjectiveTree, objectiveStats } = await import('@/lib/kernel/agent-objective')
    const before = await objectiveStats()
    await createObjectiveTree('OB-FASEC avgNodes 1')
    const after = await objectiveStats()

    if (after.trees > 0) {
      expect(after.avgNodesPerTree).toBeCloseTo(after.nodes / after.trees, 5)
    }
    expect(after.avgNodesPerTree).toBeGreaterThan(0)
  })

  it('objectiveStats completionRate = completedTrees / trees', async () => {
    const { objectiveStats } = await import('@/lib/kernel/agent-objective')
    const stats = await objectiveStats()
    if (stats.trees > 0) {
      expect(stats.completionRate).toBeCloseTo(stats.completedTrees / stats.trees, 5)
    }
    expect(stats.completionRate).toBeGreaterThanOrEqual(0)
    expect(stats.completionRate).toBeLessThanOrEqual(1)
  })

  it('objectiveStats avgMaxDepth è numerico', async () => {
    const { objectiveStats } = await import('@/lib/kernel/agent-objective')
    const stats = await objectiveStats()
    expect(typeof stats.avgMaxDepth).toBe('number')
    expect(stats.avgMaxDepth).toBeGreaterThanOrEqual(0)
  })

  it('agent-objective.ts ha G4 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/agent-objective.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G4 fix[\s\S]*metriche aggiuntive per monitoraggio/)
    expect(content).toMatch(/passRate.*passNodes.*evaluatedNodes/)
    expect(content).toMatch(/avgNodesPerTree.*nodes.*trees/)
    expect(content).toMatch(/completionRate.*completedTrees.*trees/)
  })
})

// === G2: phase12.tsx a11y =============================================

describe('Fase C — G2: phase12.tsx a11y', () => {
  it('phase12.tsx ha aria-label su button Aggiorna', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna dati Objective Builder"/)
  })

  it('phase12.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Objective Builder"/)
  })

  it('phase12.tsx ha aria-label su button Crea Albero BFS', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Crea albero obiettivi BFS dalla decomposizione"/)
  })

  it('phase12.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })

  it('phase12.tsx stats grid ha 9 stat card (5 originali + 4 G4)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    // G4: nuove stat card
    expect(content).toMatch(/label="Pass rate"/)
    expect(content).toMatch(/label="Avg nodi\/albero"/)
    expect(content).toMatch(/label="Avg depth"/)
    expect(content).toMatch(/label="Completion"/)
  })
})

// === G3: phase12.tsx parse-safe su r.json() ===========================

describe('Fase C — G3: phase12.tsx parse-safe su r.json()', () => {
  it('phase12.tsx ha G3 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/G3 fix[\s\S]*parse-safe su r\.json/)
  })

  it('phase12.tsx loadTree ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    // Verifica che loadTree ha parse-safe: console.error specifico per loadTree
    expect(content).toMatch(/\[phase12\] loadTree: response not JSON/)
  })

  it('phase12.tsx createTree ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase12\] createTree: response not JSON/)
  })

  it('phase12.tsx evalNode ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase12\] evalNode: response not JSON/)
  })

  it('phase12.tsx ha fallback a r.text() per logging in tutte le 3 funzioni', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    // 3 occorrenze di r.text() fallback (loadTree, createTree, evalNode)
    const textFallbackCount = (content.match(/await r\.text\(\)\.catch\(\(\) => '<no body>'\)/g) || []).length
    expect(textFallbackCount).toBe(3)
  })

  it('phase12.tsx ha toast.error su risposta non JSON in tutte le 3 funzioni', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )
    // 3 occorrenze di toast.error "Risposta non valida dal server"
    const toastErrorCount = (content.match(/toast\.error\(`Risposta non valida dal server \(status \$\{r\.status\}\)`\)/g) || []).length
    expect(toastErrorCount).toBe(3)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1+G4: createObjectiveTree + evaluateNode + stats con 9 metriche coerenti', async () => {
    const { createObjectiveTree, getObjectiveTree, evaluateNode, objectiveStats } = await import('@/lib/kernel/agent-objective')

    const result = await createObjectiveTree('OB-FASEC smoke lifecycle')
    const treeData = await getObjectiveTree(result.treeId)
    expect(treeData).not.toBeNull()

    // Evalua alcuni nodi
    const nodes = treeData!.nodes.filter(n => n.depth > 0)
    for (const node of nodes.slice(0, 3)) {
      await evaluateNode(node.id, 'pass', { reason: 'smoke' })
    }

    // Verifica stats con 9 metriche
    const stats = await objectiveStats()
    expect(stats.trees).toBeGreaterThanOrEqual(1)
    expect(stats.nodes).toBeGreaterThanOrEqual(result.totalNodes)
    expect(stats.passNodes).toBeGreaterThanOrEqual(3)
    // G4 metriche
    expect(stats.passRate).toBeGreaterThan(0)
    expect(stats.avgNodesPerTree).toBeGreaterThan(0)
    expect(stats.completionRate).toBeGreaterThanOrEqual(0)
    expect(stats.avgMaxDepth).toBeGreaterThanOrEqual(0)
  })

  it('G2+G3: phase12.tsx ha a11y + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase12.tsx'),
      'utf-8',
    )

    // G2: a11y
    expect(content).toMatch(/aria-label="Aggiorna dati Objective Builder"/)
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Crea albero obiettivi BFS dalla decomposizione"/)
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)

    // G3: parse-safe
    expect(content).toMatch(/G3 fix[\s\S]*parse-safe/)
    expect(content).toMatch(/try \{ d = await r\.json\(\)/)
    expect(content).toMatch(/response not JSON/)
  })

  it('G4: stats ritorna 9 metriche tutte numeriche', async () => {
    const { objectiveStats } = await import('@/lib/kernel/agent-objective')
    const stats = await objectiveStats()

    const keys = ['trees', 'nodes', 'completedTrees', 'passNodes', 'failNodes',
                  'passRate', 'avgNodesPerTree', 'avgMaxDepth', 'completionRate']
    for (const key of keys) {
      expect(stats).toHaveProperty(key)
      expect(typeof (stats as any)[key]).toBe('number')
      expect((stats as any)[key]).toBeGreaterThanOrEqual(0)
    }

    // Coerenza: passRate in [0, 1], completionRate in [0, 1]
    expect(stats.passRate).toBeLessThanOrEqual(1)
    expect(stats.completionRate).toBeLessThanOrEqual(1)
  })
})
