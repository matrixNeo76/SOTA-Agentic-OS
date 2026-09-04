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

  // Genera la struttura ad albero usando LLM per i sotto-obiettivi
  const treeStructure = await generateTreeStructure(rootGoal)

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
export async function generateTreeStructure(rootGoal: string): Promise<ObjectiveNodeSpec> {
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
        description: await generateSubGoal(current.description, i, childDepth),
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
 * Genera un sotto-obiettivo testuale usando LLM con fallback deterministico.
 *
 * C2 fix (Objective Builder audit Fase A): retry logic + size cap su output.
 * PRIMA: se la prima chiamata LLM falliva (rate limit 429, timeout), ritornava
 * subito il fallback. Inoltre l'output LLM non aveva size cap → poteva ritornare
 * 10KB anche se il system prompt chiedeva "max 80 chars" → DB bloat.
 * ORA:
 *  - Retry logic: max 2 retry (3 tentativi totali) con backoff 100ms * attempt
 *  - Size cap: MAX_SUBGOAL_SIZE = 200 char, tronca con marker [truncated]
 *  - Rispetta il system prompt "max 80 chars" troncando a 200 (margine difensivo)
 */
const MAX_SUBGOAL_SIZE = 200
const MAX_SUBGOAL_RETRIES = 2

function truncateSubGoal(value: string): string {
  if (value.length <= MAX_SUBGOAL_SIZE) return value
  return value.slice(0, MAX_SUBGOAL_SIZE) + '...[truncated]'
}

async function generateSubGoal(parentGoal: string, branchIdx: number, depth: number): Promise<string> {
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
  const fallback = `Verifica ${dim} di: ${parentGoal.slice(0, 60)}`

  // C2 — Retry loop: max MAX_SUBGOAL_RETRIES + 1 tentativi (3 totali)
  const maxAttempts = MAX_SUBGOAL_RETRIES + 1
  let lastError: string | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ZAI = (await import('z-ai-web-dev-sdk')).default
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are an objective decomposition engine. Given a parent goal, generate a concise sub-goal (max 80 chars). Output ONLY the sub-goal text, nothing else.' },
          { role: 'user', content: `Parent goal: "${parentGoal}"\nDimension: ${dim}\nDepth: ${depth}\nGenerate a specific, actionable sub-goal.` },
        ],
      })
      const output = completion.choices[0]?.message?.content?.trim()
      if (output) {
        // C2 — Size cap su output LLM (200 char + marker)
        return truncateSubGoal(output)
      }
      lastError = 'Empty LLM output'
    } catch (e: any) {
      lastError = e.message
      // Se non è l'ultimo tentativo, logga e riprova con backoff
      if (attempt < maxAttempts) {
        // eslint-disable-next-line no-console
        console.warn(`[agent-objective] generateSubGoal attempt ${attempt}/${maxAttempts} failed: ${lastError}. Retrying...`)
        await new Promise((r) => setTimeout(r, 100 * attempt))
      }
    }
  }

  // Tutti i tentativi falliti → fallback deterministico
  return fallback
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
 *
 * B5 fix (Objective Builder audit Fase B): validazione runtime di `status`.
 * PRIMA: `status: 'pass' | 'fail' | 'skipped'` era solo type union TypeScript,
 * ma a runtime qualunque stringa veniva persistita come `status` nel DB.
 * ORA: throw esplicito su valori non ammessi.
 *
 * B6 fix (Objective Builder audit Fase B): size cap su evidence JSON.
 * PRIMA: `evidence` veniva JSON.stringify senza size cap → DB bloat risk.
 * ORA: MAX_EVIDENCE_SIZE = 10_000, tronca con marker [truncated].
 */
const VALID_NODE_STATUSES: readonly string[] = ['pass', 'fail', 'skipped']
const MAX_EVIDENCE_SIZE = 10_000

function isValidNodeStatus(value: unknown): value is 'pass' | 'fail' | 'skipped' {
  return typeof value === 'string' && (VALID_NODE_STATUSES as readonly string[]).includes(value)
}

export async function evaluateNode(nodeId: string, status: 'pass' | 'fail' | 'skipped', evidence?: unknown) {
  // B5 — Validazione runtime: status deve essere uno dei valori ammessi
  if (!isValidNodeStatus(status)) {
    throw new Error(
      `Invalid node status: "${status}". Allowed values: ${VALID_NODE_STATUSES.join(', ')}`
    )
  }

  // B6 — Size cap su evidence JSON-stringified (10KB + marker)
  let evidenceJson: string | null = null
  if (evidence !== undefined && evidence !== null) {
    const raw = JSON.stringify(evidence)
    evidenceJson = raw.length > MAX_EVIDENCE_SIZE
      ? raw.slice(0, MAX_EVIDENCE_SIZE) + '...[truncated]'
      : raw
  }

  const updated = await db.objectiveNode.update({
    where: { id: nodeId },
    data: {
      status,
      evidence: evidenceJson,
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
 *
 * B3 fix (Objective Builder audit Fase B): depth guard + cycle detection.
 * PRIMA: ricorsione senza limiti → se parentId ciclici (A→B→A), stack overflow.
 * ORA: MAX_DESCENDANT_DEPTH = 10 + visited set per cycle detection (defensive).
 */
const MAX_DESCENDANT_DEPTH = 10

async function skipDescendants(nodeId: string, visited: Set<string> = new Set(), depth: number = 0) {
  // B3 — Depth guard: non scendere oltre 10 livelli (defensive)
  if (depth >= MAX_DESCENDANT_DEPTH) return
  // B3 — Cycle detection: se abbiamo già visitato questo nodo, esci
  if (visited.has(nodeId)) return
  visited.add(nodeId)

  const children = await db.objectiveNode.findMany({ where: { parentId: nodeId } })
  for (const child of children) {
    if (child.status === 'pending') {
      await db.objectiveNode.update({
        where: { id: child.id },
        data: { status: 'skipped', evaluatedAt: new Date() },
      })
    }
    await skipDescendants(child.id, visited, depth + 1)
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
 *
 * B1 fix (Objective Builder audit Fase B): tutte le query base in Promise.all.
 * G4 fix (Objective Builder audit Fase C): metriche aggiuntive per monitoraggio.
 * PRIMA: solo 5 metriche (trees, nodes, completedTrees, passNodes, failNodes).
 * ORA: aggiunte 4 metriche derivate:
 *  - passRate: % nodi passati su valutati (passNodes / (passNodes + failNodes))
 *  - avgNodesPerTree: media nodi per albero (nodes / trees)
 *  - avgMaxDepth: media profondità max degli alberi (via aggregate _avg)
 *  - completionRate: % alberi completati (completedTrees / trees)
 */
export async function objectiveStats() {
  const [trees, nodes, completedTrees, passNodes, failNodes, maxDepthAgg] = await Promise.all([
    db.objectiveTree.count(),
    db.objectiveNode.count(),
    db.objectiveTree.count({ where: { status: 'done' } }),
    db.objectiveNode.count({ where: { status: 'pass' } }),
    db.objectiveNode.count({ where: { status: 'fail' } }),
    // G4 — avg maxDepth via aggregate
    db.objectiveTree.aggregate({ _avg: { maxDepth: true } }),
  ])

  // G4 — metriche derivate
  const evaluatedNodes = passNodes + failNodes
  const passRate = evaluatedNodes > 0 ? passNodes / evaluatedNodes : 0
  const avgNodesPerTree = trees > 0 ? nodes / trees : 0
  const avgMaxDepth = maxDepthAgg._avg.maxDepth ?? 0
  const completionRate = trees > 0 ? completedTrees / trees : 0

  return {
    trees,
    nodes,
    completedTrees,
    passNodes,
    failNodes,
    // G4 — metriche aggiuntive
    passRate,
    avgNodesPerTree,
    avgMaxDepth,
    completionRate,
  }
}

export async function listTrees(limit = 20) {
  return db.objectiveTree.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
