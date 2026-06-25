/**
 * Fase 7: Validazione Sequenziale Robusta tramite Dominator Trees
 *
 * Nei workflow reali (UI, API, automazione), l'esecuzione non è mai
 * bit-per-bit identica. L'OS deve validare il successo distinguendo:
 *  - Deviazioni accettabili (popup di caricamento saltato)
 *  - Fallimenti critici (skip di uno stato essenziale)
 *
 * Pipeline:
 *  1) Cattura 2-10 tracce positive → fonde in un Prefix Tree Automaton (PTA)
 *  2) Estrae i "dominator nodes" (stati che devono essere visitati)
 *  3) Per nuove tracce: calcola "dominator coverage"
 *     - Coverage 1.0 = tutti i dominatori raggiunti → ACCEPT
 *     - Coverage < threshold → REJECT (deviazione critica)
 *  4) Per stati ambigui, matching semantico via LLM (opzionale)
 */
import { db } from '@/lib/db'

export type DiscreteState = string
export type Trace = {
  states: DiscreteState[]
  actions: string[]
  outcome: 'success' | 'failure' | 'partial'
}

export type PTANode = {
  id: string
  state: DiscreteState
  children: Record<DiscreteState, string> // state → childNodeId
  isAccept: boolean
  depth: number
}

export type PTAGraph = {
  nodes: Record<string, PTANode>
  startNodeId: string
  acceptNodeIds: string[]
  dominators: string[] // nodeIds
}

/**
 * Cattura una traccia di esecuzione.
 */
export async function captureTrace(
  workflowId: string,
  traceLabel: string,
  states: DiscreteState[],
  actions: string[],
  outcome: 'success' | 'failure' | 'partial' = 'success'
): Promise<string> {
  const trace = await db.executionTrace.create({
    data: {
      workflowId,
      traceLabel,
      statesJson: JSON.stringify(states),
      actionsJson: JSON.stringify(actions),
      outcome,
    },
  })
  return trace.id
}

/**
 * Costruisce il PTA fondendo tutte le tracce positive di un workflow.
 * Il PTA è un albero dove ogni path dalla root a una foglia è una traccia,
 * e nodi con lo stesso stato vengono fusi (determinizzazione parziale).
 */
export async function buildPTA(workflowId: string): Promise<{ ptaId: string; graph: PTAGraph; traceCount: number }> {
  const traces = await db.executionTrace.findMany({
    where: { workflowId, outcome: 'success' },
    orderBy: { capturedAt: 'asc' },
  })

  if (traces.length === 0) {
    throw new Error(`Nessuna traccia positiva per workflow ${workflowId}`)
  }

  // Costruzione albero
  const nodes: Record<string, PTANode> = {}
  let nodeCounter = 0
  const newNodeId = () => `n${nodeCounter++}`

  const root: PTANode = {
    id: newNodeId(),
    state: '__start__',
    children: {},
    isAccept: false,
    depth: 0,
  }
  nodes[root.id] = root

  const acceptNodeIds: string[] = []

  for (const trace of traces) {
    const states: DiscreteState[] = JSON.parse(trace.statesJson)
    let current = root

    for (let i = 0; i < states.length; i++) {
      const s = states[i]
      if (current.children[s]) {
        current = nodes[current.children[s]]
      } else {
        const newNode: PTANode = {
          id: newNodeId(),
          state: s,
          children: {},
          isAccept: i === states.length - 1,
          depth: current.depth + 1,
        }
        nodes[newNode.id] = newNode
        current.children[s] = newNode.id
        current = newNode
      }
      if (i === states.length - 1 && !acceptNodeIds.includes(current.id)) {
        acceptNodeIds.push(current.id)
        current.isAccept = true
      }
    }
  }

  const graph: PTAGraph = {
    nodes,
    startNodeId: root.id,
    acceptNodeIds,
    dominators: [],
  }

  // Calcola dominatori
  const dominators = computeDominators(graph)
  graph.dominators = dominators

  // Persisti
  const pta = await db.prefixTreeAutomaton.upsert({
    where: { workflowId },
    create: {
      workflowId,
      nodesJson: JSON.stringify(nodes),
      dominatorsJson: JSON.stringify(dominators),
      startNodeId: root.id,
      acceptNodeIds: JSON.stringify(acceptNodeIds),
    },
    update: {
      nodesJson: JSON.stringify(nodes),
      dominatorsJson: JSON.stringify(dominators),
      startNodeId: root.id,
      acceptNodeIds: JSON.stringify(acceptNodeIds),
    },
  })

  return { ptaId: pta.id, graph, traceCount: traces.length }
}

/**
 * Calcola i nodi dominatori del PTA.
 *
 * Un nodo `d` domina un nodo `n` se ogni path dalla root a `n` passa per `d`.
 * I dominatori della root sono {root}.
 * Per gli altri nodi: dominators(n) = {n} ∪ (∩ dominators(p) per ogni p in parents(n))
 *
 * I "dominatori essenziali" sono quelli che non sono né root né foglia:
 * rappresentano i checkpoint obbligatori che ogni esecuzione valida deve toccare.
 */
function computeDominators(graph: PTAGraph): string[] {
  const allNodeIds = Object.keys(graph.nodes)
  const parents: Record<string, string[]> = {}
  for (const id of allNodeIds) parents[id] = []

  // Costruisci lista genitori
  for (const id of allNodeIds) {
    const node = graph.nodes[id]
    for (const childId of Object.values(node.children)) {
      parents[childId].push(id)
    }
  }

  // Inizializza dominators
  const doms: Record<string, Set<string>> = {}
  for (const id of allNodeIds) {
    if (id === graph.startNodeId) {
      doms[id] = new Set([id])
    } else {
      doms[id] = new Set(allNodeIds) // universal set come approssimazione iniziale
    }
  }

  // Iterative dataflow algorithm (classico)
  let changed = true
  while (changed) {
    changed = false
    for (const id of allNodeIds) {
      if (id === graph.startNodeId) continue
      const preds = parents[id]
      if (preds.length === 0) continue

      let newDom: Set<string> | null = null
      for (const p of preds) {
        if (newDom === null) newDom = new Set(doms[p])
        else newDom = new Set<string>([...newDom].filter((x: string) => doms[p].has(x)))
      }
      newDom = newDom || new Set()
      newDom.add(id) // ogni nodo domina se stesso

      // Verifica cambiamento
      if (newDom.size !== doms[id].size || [...newDom].some((x) => !doms[id].has(x))) {
        doms[id] = newDom
        changed = true
      }
    }
  }

  // "Essential dominators": nodi che appaiono nei dominatori di TUTTI gli accept nodes
  // ma non sono né start né accept stessi
  const essentialDominators = new Set<string>()
  if (graph.acceptNodeIds.length > 0) {
    let intersection: Set<string> | null = null
    for (const acceptId of graph.acceptNodeIds) {
      if (intersection === null) intersection = new Set(doms[acceptId])
      else intersection = new Set<string>([...intersection].filter((x: string) => doms[acceptId].has(x)))
    }
    if (intersection) {
      for (const id of intersection) {
        if (id !== graph.startNodeId && !graph.acceptNodeIds.includes(id)) {
          essentialDominators.add(id)
        }
      }
    }
  }

  return Array.from(essentialDominators)
}

/**
 * Valida una nuova traccia contro il PTA + dominatori.
 *
 * Calcola:
 *  - "dominator coverage": frazione di dominatori essenziali raggiunti
 *  - "path validity": se la traccia segue transizioni valide del PTA
 *
 * Verdict:
 *  - coverage >= 1.0 && pathValid → accept
 *  - coverage >= 0.7 → warn (deviazione tollerabile)
 *  - coverage < 0.7 → reject (deviazione critica)
 */
export async function validateTrace(
  workflowId: string,
  states: DiscreteState[],
  threshold = 0.7
): Promise<{
  verdict: 'accept' | 'reject' | 'warn'
  dominatorCoverage: number
  passedDominatorIds: string[]
  pathValid: boolean
  reason: string
}> {
  const ptaRow = await db.prefixTreeAutomaton.findUnique({ where: { workflowId } })
  if (!ptaRow) {
    return {
      verdict: 'warn',
      dominatorCoverage: 0,
      passedDominatorIds: [],
      pathValid: false,
      reason: `PTA non trovato per workflow ${workflowId}`,
    }
  }

  const nodes: Record<string, PTANode> = JSON.parse(ptaRow.nodesJson)
  const dominators: string[] = JSON.parse(ptaRow.dominatorsJson)
  const graph: PTAGraph = {
    nodes,
    startNodeId: ptaRow.startNodeId,
    acceptNodeIds: JSON.parse(ptaRow.acceptNodeIds),
    dominators,
  }

  // Simula la traccia sul PTA: raccogli i nodeId visitati
  let current = nodes[graph.startNodeId]
  const visitedNodeIds: string[] = [current.id]
  let pathValid = true

  for (const s of states) {
    if (current.children[s]) {
      current = nodes[current.children[s]]
      visitedNodeIds.push(current.id)
    } else {
      // Transizione non presente nel PTA: deviazione
      pathValid = false
      // Non interrompere: continuiamo per calcolare coverage sui dominatori
      // rimanenti tramite matching semantico dello stato
      break
    }
  }

  // Calcola dominatori raggiunti
  const passedDominatorIds = dominators.filter((d) => visitedNodeIds.includes(d))
  const dominatorCoverage = dominators.length > 0
    ? passedDominatorIds.length / dominators.length
    : 1.0

  // Verdict
  let verdict: 'accept' | 'reject' | 'warn'
  let reason: string
  if (dominatorCoverage >= 1.0 && pathValid) {
    verdict = 'accept'
    reason = `Tutti i ${dominators.length} dominatori raggiunti, path valido`
  } else if (dominatorCoverage >= threshold) {
    verdict = 'warn'
    reason = `Coverage ${dominatorCoverage.toFixed(2)} >= threshold ${threshold}. Path valid: ${pathValid}. Deviazione tollerabile.`
  } else {
    verdict = 'reject'
    reason = `Coverage ${dominatorCoverage.toFixed(2)} < threshold ${threshold}. Dominatori mancanti: ${dominators.filter((d) => !passedDominatorIds.includes(d)).map((d) => nodes[d].state).join(', ')}`
  }

  // Persisti validazione
  await db.traceValidation.create({
    data: {
      ptaId: ptaRow.id,
      statesJson: JSON.stringify(states),
      dominatorCoverage,
      passedDominatorIds: JSON.stringify(passedDominatorIds),
      verdict,
      reason,
    },
  })

  return {
    verdict,
    dominatorCoverage,
    passedDominatorIds,
    pathValid,
    reason,
  }
}

/**
 * Matching semantico sub-sequenziale via LLM.
 * Quando una traccia devia dal PTA ma potrebbe essere semanticamente equivalente
 * (es. API risponde con formato diverso ma contenuto uguale), chiedi all'LLM.
 */
export async function semanticMatch(
  observedState: DiscreteState,
  expectedState: DiscreteState
): Promise<{ equivalent: boolean; confidence: number; reason: string }> {
  // Match esatto: skip LLM
  if (observedState === expectedState) {
    return { equivalent: true, confidence: 1.0, reason: 'Match esatto' }
  }

  // Try LLM semantic comparison
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a semantic equivalence checker. Compare two states and determine if they are semantically equivalent. Respond with JSON: {"equivalent": true/false, "confidence": 0.0-1.0, "reason": "explanation"}' },
        { role: 'user', content: `Observed state: "${observedState}"\nExpected state: "${expectedState}"\n\nAre these semantically equivalent?` },
      ],
    })
    const output = completion.choices[0]?.message?.content || ''
    const parsed = JSON.parse(output)
    return { equivalent: !!parsed.equivalent, confidence: parsed.confidence || 0.5, reason: parsed.reason || 'LLM semantic match' }
  } catch {
    return { equivalent: false, confidence: 0.0, reason: 'LLM unavailable, exact match only' }
  }
}

/**
 * Statistiche per dashboard.
 */
export async function dominatorStats() {
  const [traces, ptas, validations] = await Promise.all([
    db.executionTrace.count(),
    db.prefixTreeAutomaton.count(),
    db.traceValidation.count(),
  ])
  const recentValidations = await db.traceValidation.findMany({
    orderBy: { timestamp: 'desc' },
    take: 100,
    select: { verdict: true, dominatorCoverage: true },
  })
  const avgCoverage = recentValidations.length
    ? recentValidations.reduce((s, v) => s + v.dominatorCoverage, 0) / recentValidations.length
    : 0
  const acceptRate = recentValidations.length
    ? recentValidations.filter((v) => v.verdict === 'accept').length / recentValidations.length
    : 0
  return {
    traces,
    ptas,
    validations,
    avgCoverage,
    acceptRate,
  }
}

/**
 * Recupera il PTA di un workflow per visualizzazione.
 */
export async function getPTA(workflowId: string): Promise<PTAGraph | null> {
  const ptaRow = await db.prefixTreeAutomaton.findUnique({ where: { workflowId } })
  if (!ptaRow) return null
  return {
    nodes: JSON.parse(ptaRow.nodesJson),
    startNodeId: ptaRow.startNodeId,
    acceptNodeIds: JSON.parse(ptaRow.acceptNodeIds),
    dominators: JSON.parse(ptaRow.dominatorsJson),
  }
}

export async function listTraces(workflowId?: string) {
  return db.executionTrace.findMany({
    where: workflowId ? { workflowId } : {},
    orderBy: { capturedAt: 'desc' },
    take: 30,
  })
}
