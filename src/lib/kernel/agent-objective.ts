/**
 * Fase 12: AgentObjective (Costruzione Automatica Rubriche)
 *
 * Per task esplorativi complessi (obiettivi aperti), l'OS costruisce
 * autonomamente criteri di successo densi tramite decomposizione BFS.
 *
 * Pipeline:
 *  1) BFS: partendo dall'obiettivo macro, decompone ricorsivamente in
 *     sotto-task binari (Pass/Fail)
 *  2) Arresto basato sul peso: la ramificazione si ferma quando il peso
 *     del sotto-task scende sotto una soglia (default 0.1)
 *  3) Iniezione gerarchica del contesto:
 *     - Livello 0 (root): contesto strategico (abstract, overview)
 *     - Livello 1-2: contesto metodologico (documentazione)
 *     - Livello 3+: contesto implementativo (codice, log)
 */
import { db } from '@/lib/db'

export type ObjectiveNodeSpec = {
  description: string
  depth: number
  weight: number
  contextTier: 'strategic' | 'methodological' | 'implementation'
  children?: ObjectiveNodeSpec[]
}

const WEIGHT_THRESHOLD = 0.1
const MAX_DEPTH = 5
const BRANCHING_FACTOR = 3

/**
 * Crea un albero di obiettivi partendo da un obiettivo macro.
 * Usa BFS con arresto basato sul peso.
 */
export async function createObjectiveTree(rootGoal: string): Promise<{ treeId: string; totalNodes: number; maxDepth: number }> {
  const tree = await db.objectiveTree.create({
    data: { rootGoal, status: 'drafted' },
  })

  // Genera la struttura ad albero (simulata: in produzione usare LLM)
  const treeStructure = generateTreeStructure(rootGoal)

  // Persisti ricorsivamente
  let totalNodes = 0
  let maxDepth = 0

  const persistNode = async (node: ObjectiveNodeSpec, parentId: string | null): Promise<void> => {
    const created = await db.objectiveNode.create({
      data: {
        treeId: tree.id,
        parentId,
        description: node.description,
        depth: node.depth,
        weight: node.weight,
        contextTier: node.contextTier,
      },
    })
    totalNodes++
    maxDepth = Math.max(maxDepth, node.depth)
    if (node.children) {
      for (const child of node.children) {
        await persistNode(child, created.id)
      }
    }
  }

  await persistNode(treeStructure, null)

  await db.objectiveTree.update({
    where: { id: tree.id },
    data: {
      status: 'expanded',
      totalNodes,
      maxDepth,
    },
  })

  return { treeId: tree.id, totalNodes, maxDepth }
}

/**
 * Genera la struttura ad albero con BFS e arresto basato sul peso.
 *
 * Regole:
 *  - Ogni nodo ha BRANCHING_FACTOR figli
 *  - Il peso di un figlio = peso del padre / BRANCHING_FACTOR
 *  - Fermati se peso < WEIGHT_THRESHOLD o depth >= MAX_DEPTH
 *  - Context tier: depth 0 = strategic, 1-2 = methodological, 3+ = implementation
 */
function generateTreeStructure(rootGoal: string): ObjectiveNodeSpec {
  const root: ObjectiveNodeSpec = {
    description: rootGoal,
    depth: 0,
    weight: 1.0,
    contextTier: 'strategic',
  }

  // BFS queue
  const queue: ObjectiveNodeSpec[] = [root]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= MAX_DEPTH) continue
    if (current.weight < WEIGHT_THRESHOLD) continue

    // Genera BRANCHING_FACTOR figli
    const children: ObjectiveNodeSpec[] = []
    for (let i = 0; i < BRANCHING_FACTOR; i++) {
      const childWeight = current.weight / BRANCHING_FACTOR
      if (childWeight < WEIGHT_THRESHOLD) break

      const childDepth = current.depth + 1
      const childTier: ObjectiveNodeSpec['contextTier'] =
        childDepth === 0 ? 'strategic' :
        childDepth <= 2 ? 'methodological' :
        'implementation'

      const child: ObjectiveNodeSpec = {
        description: generateSubGoal(current.description, i, childDepth),
        depth: childDepth,
        weight: childWeight,
        contextTier: childTier,
      }
      children.push(child)
      queue.push(child)
    }
    if (children.length > 0) {
      current.children = children
    }
  }

  return root
}

/**
 * Genera un sotto-obiettivo testuale (stub deterministico).
 * In produzione: chiamare LLM con contesto gerarchico.
 */
function generateSubGoal(parentGoal: string, branchIdx: number, depth: number): string {
  const dimensions = [
    ['correttezza', 'completezza', 'efficienza'],
    ['validazione', 'documentazione', 'monitoraggio'],
    ['test unitari', 'test integrazione', 'test e2e'],
    ['lettura codice', 'analisi log', 'profilazione'],
    ['refactoring', 'ottimizzazione', 'caching'],
  ]
  const tier = Math.min(depth - 1, dimensions.length - 1)
  if (tier < 0) return parentGoal
  const dim = dimensions[tier][branchIdx % 3]
  return `Verifica ${dim} di: ${parentGoal.slice(0, 60)}`
}

/**
 * Recupera l'albero completo per visualizzazione.
 */
export async function getObjectiveTree(treeId: string) {
  const tree = await db.objectiveTree.findUnique({ where: { id: treeId } })
  if (!tree) return null
  const nodes = await db.objectiveNode.findMany({
    where: { treeId },
    orderBy: { depth: 'asc' },
  })
  return { tree, nodes }
}

/**
 * Valuta un singolo nodo (Pass/Fail).
 */
export async function evaluateNode(nodeId: string, status: 'pass' | 'fail' | 'skipped', evidence?: unknown) {
  const updated = await db.objectiveNode.update({
    where: { id: nodeId },
    data: {
      status,
      evidence: evidence ? JSON.stringify(evidence) : null,
      evaluatedAt: new Date(),
    },
  })

  // Se il nodo padre fallisce, tutti i discendenti vengono skippati
  if (status === 'fail') {
    await skipDescendants(nodeId)
  }

  // Verifica se tutti i nodi foglia sono stati valutati
  await checkTreeCompletion(updated.treeId)

  return updated
}

/**
 * Salta tutti i discendenti di un nodo fallito.
 */
async function skipDescendants(nodeId: string) {
  const children = await db.objectiveNode.findMany({ where: { parentId: nodeId } })
  for (const child of children) {
    if (child.status === 'pending') {
      await db.objectiveNode.update({
        where: { id: child.id },
        data: { status: 'skipped', evaluatedAt: new Date() },
      })
    }
    await skipDescendants(child.id)
  }
}

/**
 * Verifica se tutti i nodi dell'albero sono stati valutati.
 */
async function checkTreeCompletion(treeId: string) {
  const pending = await db.objectiveNode.count({
    where: { treeId, status: 'pending' },
  })
  if (pending === 0) {
    await db.objectiveTree.update({
      where: { id: treeId },
      data: { status: 'done' },
    })
  }
}

/**
 * Statistiche per dashboard.
 */
export async function objectiveStats() {
  const [trees, nodes, completedTrees] = await Promise.all([
    db.objectiveTree.count(),
    db.objectiveNode.count(),
    db.objectiveTree.count({ where: { status: 'done' } }),
  ])
  const passNodes = await db.objectiveNode.count({ where: { status: 'pass' } })
  const failNodes = await db.objectiveNode.count({ where: { status: 'fail' } })
  return { trees, nodes, completedTrees, passNodes, failNodes }
}

export async function listTrees(limit = 20) {
  return db.objectiveTree.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
