/**
 * API: /api/objective (Fase 12 - AgentObjective)
 *
 * C3 fix (Objective Builder audit Fase A): auth policy allineata con altre API mutative.
 * PRIMA: sia GET che POST usavano requireAuth → qualsiasi viewer autenticato poteva:
 *  - innescare BFS con multiple LLM calls (cost reale) via create_tree
 *  - marcare nodi come pass/fail via evaluate_node (manipolazione valutazione)
 * ORA:
 *  - GET (tree/list/stats) richiede requireAuth (lettura)
 *  - POST (create_tree/evaluate_node) richiede requireAdmin (mutative)
 *    perché:
 *    * create_tree esegue BFS con N LLM calls + crea alberi nel DB
 *    * evaluate_node modifica stato nodi (pass/fail) + skipDescendants + checkTreeCompletion
 */
import { NextRequest, NextResponse } from 'next/server'
import { createObjectiveTree, getObjectiveTree, evaluateNode, objectiveStats, listTrees } from '@/lib/kernel/agent-objective'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'

  if (action === 'tree') {
    const treeId = searchParams.get('treeId')
    if (!treeId) return NextResponse.json({ error: 'treeId required' }, { status: 400 })
    const tree = await getObjectiveTree(treeId)
    return NextResponse.json(tree)
  }

  if (action === 'list') {
    const trees = await listTrees(20)
    return NextResponse.json({ trees })
  }

  if (action === 'stats') {
    const stats = await objectiveStats()
    return NextResponse.json(stats)
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  // C3 — POST mutative richiede requireAdmin (prima era requireAuth)
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'create_tree') {
    const { rootGoal } = body
    const result = await createObjectiveTree(rootGoal)
    await publishAgentEvent({
      agentId: 'objective', phase: '12',
      event: 'tree_created',
      payload: { treeId: result.treeId, totalNodes: result.totalNodes, maxDepth: result.maxDepth },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'evaluate_node') {
    const { nodeId, status, evidence } = body
    const result = await evaluateNode(nodeId, status, evidence)
    await publishAgentEvent({
      agentId: 'objective', phase: '12',
      event: 'node_evaluated',
      payload: { nodeId, status },
    })
    return NextResponse.json({ ok: true, node: result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
