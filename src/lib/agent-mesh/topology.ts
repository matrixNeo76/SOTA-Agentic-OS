/**
 * Hierarchical Agent Mesh — Fase 3.4
 *
 * Gerarchia completa di agenti:
 *   Executive (CEO Agent) → Strategic (Architect/Planner/Research/World Model)
 *   → Operational (Coding/QA/Security/Data/Support) → Specialized (domain agents)
 *
 * Componenti:
 *   1. Mesh topology: definisce livelli e relazioni parent/child
 *   2. Delegation: executive può delegare task a strategic/operational
 *   3. Escalation: operational può escalation problemi a strategic
 *   4. Coordination: agenti allo stesso livello coordinano via quorum (Fase 13 ESR)
 *
 * Relazioni nel Context Graph:
 *   (:Agent)-[:REPORTS_TO]->(:Agent) // gerarchia
 *   (:Agent)-[:DELEGATES_TO]->(:Agent) // delega runtime
 *   (:Agent)-[:ESCALATES_TO]->(:Agent) // escalation runtime
 *   (:Agent)-[:COORDINATES_WITH]->(:Agent) // peer coordination
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'
import { registerAgent, getAgent, checkPermission } from '@/lib/agent-lifecycle/manager'

// === Tipi ============================================================

export type MeshTier = 'executive' | 'strategic' | 'operational' | 'specialized'

export interface MeshNode {
  agentUri: string
  tier: MeshTier
  parentAgentUri?: string
  childAgentUris: string[]
  peerAgentUris: string[]
  reportsTo?: string
  delegates: Array<{ toAgentUri: string; taskUri: string; timestamp: string }>
  escalations: Array<{ toAgentUri: string; reason: string; timestamp: string }>
}

export interface MeshTopology {
  nodes: MeshNode[]
  edges: Array<{ from: string; to: string; relation: 'REPORTS_TO' | 'COORDINATES_WITH' }>
}

// === Default mesh presets ============================================

/**
 * Topologia di default: organizzazione SOTA standard.
 * Da usare come punto di partenza; può essere customizzata.
 */
export const DEFAULT_MESH_PRESET: Array<{
  name: string
  tier: MeshTier
  description: string
  role: { name: string; description?: string; permissions: string[] }
  capabilities: Array<{ name: string; description?: string }>
  reportsTo?: string
}> = [
  // Executive
  {
    name: 'ceo',
    tier: 'executive',
    description: 'Chief Executive Agent: defines vision, strategy, allocates resources',
    role: { name: 'ceo', description: 'Executive leadership', permissions: ['*'] },
    capabilities: [
      { name: 'strategic-planning', description: 'Can define strategic direction' },
      { name: 'resource-allocation', description: 'Can allocate budget and agents' },
    ],
  },
  // Strategic
  {
    name: 'architect',
    tier: 'strategic',
    description: 'System Architect: designs technical architecture',
    role: { name: 'architect', description: 'Technical architecture', permissions: ['system:design', 'system:review'] },
    capabilities: [{ name: 'architecture-design', description: 'Can design system architecture' }],
    reportsTo: 'agent://ceo',
  },
  {
    name: 'planner',
    tier: 'strategic',
    description: 'Strategic Planner: decomposes goals into executable plans',
    role: { name: 'planner', description: 'Strategic planning', permissions: ['task:create', 'task:assign', 'plan:approve'] },
    capabilities: [{ name: 'task-decomposition', description: 'Can decompose complex goals' }],
    reportsTo: 'agent://ceo',
  },
  {
    name: 'research',
    tier: 'strategic',
    description: 'Research Agent: explores new approaches and technologies',
    role: { name: 'researcher', description: 'Research and exploration', permissions: ['web:search', 'doc:read'] },
    capabilities: [{ name: 'research', description: 'Can conduct research' }],
    reportsTo: 'agent://ceo',
  },
  {
    name: 'world-model',
    tier: 'strategic',
    description: 'World Model Agent: maintains the world state and predictions',
    role: { name: 'world-model', description: 'World modeling', permissions: ['world:capture', 'prediction:create'] },
    capabilities: [{ name: 'world-modeling', description: 'Can capture and predict world state' }],
    reportsTo: 'agent://ceo',
  },
  // Operational
  {
    name: 'coding',
    tier: 'operational',
    description: 'Coding Agent: writes and modifies code',
    role: { name: 'coder', description: 'Code implementation', permissions: ['file:write:src/*', 'tool:exec:git'] },
    capabilities: [{ name: 'coding', description: 'Can write code' }],
    reportsTo: 'agent://architect',
  },
  {
    name: 'qa',
    tier: 'operational',
    description: 'QA Agent: tests and validates code',
    role: { name: 'qa', description: 'Quality assurance', permissions: ['tool:exec:tests', 'tool:exec:lint'] },
    capabilities: [{ name: 'testing', description: 'Can run tests' }],
    reportsTo: 'agent://architect',
  },
  {
    name: 'security',
    tier: 'operational',
    description: 'Security Agent: enforces security policies and audits',
    role: { name: 'security', description: 'Security enforcement', permissions: ['security:audit', 'security:block'] },
    capabilities: [{ name: 'security-audit', description: 'Can audit for security issues' }],
    reportsTo: 'agent://architect',
  },
  {
    name: 'data',
    tier: 'operational',
    description: 'Data Agent: manages data pipelines and analytics',
    role: { name: 'data-engineer', description: 'Data management', permissions: ['db:read', 'db:write:analytics/*'] },
    capabilities: [{ name: 'data-processing', description: 'Can process data' }],
    reportsTo: 'agent://architect',
  },
  {
    name: 'support',
    tier: 'operational',
    description: 'Support Agent: handles user requests and incidents',
    role: { name: 'support', description: 'User support', permissions: ['user:respond', 'incident:handle'] },
    capabilities: [{ name: 'incident-response', description: 'Can handle incidents' }],
    reportsTo: 'agent://planner',
  },
]

// === Mesh bootstrap ==================================================

/**
 * Inizializza la mesh gerarchica con il preset di default.
 * Idempotente: se gli agenti esistono già, vengono skippati.
 */
export async function bootstrapDefaultMesh(provenance: Provenance): Promise<{
  created: number
  skipped: number
  mesh: MeshTopology
}> {
  let created = 0
  let skipped = 0

  // Fase 1: registra tutti gli agenti (senza reportsTo perché potrebbero non esistere ancora)
  const agentUris = new Map<string, string>()
  for (const def of DEFAULT_MESH_PRESET) {
    const identifier = def.name.toLowerCase().replace(/\s+/g, '-')
    const existingUri = `agent://${identifier}`
    const existing = await db.graphNode.findUnique({ where: { uri: existingUri } })

    if (existing) {
      skipped++
      agentUris.set(def.name, existingUri)
      continue
    }

    const { uri } = await registerAgent({
      name: def.name,
      description: def.description,
      roles: [def.role],
      capabilities: def.capabilities,
      provenance,
    })
    agentUris.set(def.name, uri)
    created++
  }

  // Fase 2: crea le relazioni REPORTS_TO
  for (const def of DEFAULT_MESH_PRESET) {
    if (!def.reportsTo) continue
    const childUri = agentUris.get(def.name)
    const parentUri = agentUris.get(def.reportsTo.split('//')[1])
    if (!childUri || !parentUri) continue

    try {
      await createEdge({
        fromUri: childUri,
        toUri: parentUri,
        relationType: 'REPORTS_TO',
        createdByAgent: provenance.createdByAgent,
      })
    } catch {} // edge may already exist
  }

  // Fase 3: crea relazioni COORDINATES_WITH tra peer (stesso tier)
  const byTier = new Map<MeshTier, string[]>()
  for (const def of DEFAULT_MESH_PRESET) {
    const uri = agentUris.get(def.name)!
    if (!byTier.has(def.tier)) byTier.set(def.tier, [])
    byTier.get(def.tier)!.push(uri)
  }

  for (const [_tier, uris] of byTier) {
    for (let i = 0; i < uris.length; i++) {
      for (let j = i + 1; j < uris.length; j++) {
        try {
          await createEdge({
            fromUri: uris[i]!,
            toUri: uris[j]!,
            relationType: 'COORDINATES_WITH',
            createdByAgent: provenance.createdByAgent,
          })
        } catch {}
      }
    }
  }

  const mesh = await getMeshTopology()
  return { created, skipped, mesh }
}

// === Mesh queries ====================================================

/**
 * Recupera l'intera topologia della mesh.
 */
export async function getMeshTopology(): Promise<MeshTopology> {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Agent' },
    include: {
      edgesFrom: { where: { relationType: { in: ['REPORTS_TO', 'COORDINATES_WITH', 'DELEGATES_TO', 'ESCALATES_TO'] } } },
    },
  })

  const meshNodes: MeshNode[] = []
  const edges: MeshTopology['edges'] = []

  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    const tier = (attrs.tier as MeshTier) || inferTierFromName(attrs.name as string)

    const reportsTo = node.edgesFrom.find((e) => e.relationType === 'REPORTS_TO')
    const childUris = nodes
      .filter((n) => n.edgesFrom.some((e) => e.relationType === 'REPORTS_TO' && e.toNodeId === node.id))
      .map((n) => n.uri)
    const peerUris = nodes
      .filter((n) => {
        if (n.id === node.id) return false
        const incoming = n.edgesFrom.some((e) => e.relationType === 'COORDINATES_WITH' && e.toNodeId === node.id)
        const outgoing = node.edgesFrom.some((e) => e.relationType === 'COORDINATES_WITH' && e.toNodeId === n.id)
        return incoming || outgoing
      })
      .map((n) => n.uri)

    const parentUri = reportsTo
      ? (await db.graphNode.findUnique({ where: { id: reportsTo.toNodeId } }))?.uri
      : undefined

    meshNodes.push({
      agentUri: node.uri,
      tier,
      parentAgentUri: parentUri,
      childAgentUris: childUris,
      peerAgentUris: peerUris,
      reportsTo: parentUri,
      delegates: [],
      escalations: [],
    })

    for (const edge of node.edgesFrom) {
      if (edge.relationType === 'COORDINATES_WITH') {
        const toUri = (await db.graphNode.findUnique({ where: { id: edge.toNodeId } }))?.uri
        if (toUri) {
          edges.push({ from: node.uri, to: toUri, relation: 'COORDINATES_WITH' })
        }
      } else if (edge.relationType === 'REPORTS_TO') {
        const toUri = (await db.graphNode.findUnique({ where: { id: edge.toNodeId } }))?.uri
        if (toUri) {
          edges.push({ from: node.uri, to: toUri, relation: 'REPORTS_TO' })
        }
      }
    }
  }

  return { nodes: meshNodes, edges }
}

/**
 * Recupera la mesh per tier.
 */
export async function getMeshByTier(tier: MeshTier): Promise<MeshNode[]> {
  const topology = await getMeshTopology()
  return topology.nodes.filter((n) => n.tier === tier)
}

/**
 * Trova il path gerarchico da un agente all'executive.
 */
export async function getReportingChain(agentUri: string): Promise<string[]> {
  const chain: string[] = [agentUri]
  let current = agentUri

  for (let i = 0; i < 10; i++) { // safety cap
    const node = await db.graphNode.findUnique({
      where: { uri: current },
      include: {
        edgesFrom: { where: { relationType: 'REPORTS_TO' } },
      },
    })
    if (!node || node.edgesFrom.length === 0) break

    const parent = await db.graphNode.findUnique({ where: { id: node.edgesFrom[0]!.toNodeId } })
    if (!parent || parent.uri === current) break

    chain.push(parent.uri)
    current = parent.uri
  }

  return chain
}

// === Delegation ======================================================

/**
 * Delega un task da un agente a un altro (gerarchicamente inferiore o peer).
 *
 * Crea edge DELEGATES_TO e registra la delega.
 * Verifica permessi: solo agenti con 'task:assign' possono delegare.
 */
export async function delegateTask(params: {
  fromAgentUri: string
  toAgentUri: string
  taskUri: string
  provenance: Provenance
}): Promise<{ delegated: boolean; reason: string }> {
  // Verifica permessi del delegante
  const permCheck = await checkPermission({
    agentUri: params.fromAgentUri,
    permission: 'task:assign',
  })
  if (!permCheck.allowed) {
    return { delegated: false, reason: `Delegator lacks 'task:assign' permission: ${permCheck.reason}` }
  }

  // Verifica che il delegato esista e sia active
  const toAgent = await getAgent(params.toAgentUri)
  if (!toAgent) {
    return { delegated: false, reason: 'Delegate agent not found' }
  }
  if (toAgent.lifecycleState !== 'active') {
    return { delegated: false, reason: `Delegate agent is ${toAgent.lifecycleState}` }
  }

  // Crea edge DELEGATES_TO
  try {
    await createEdge({
      fromUri: params.fromAgentUri,
      toUri: params.toAgentUri,
      relationType: 'DELEGATES_TO',
      createdByAgent: params.provenance.createdByAgent,
      properties: { taskUri: params.taskUri, timestamp: new Date().toISOString() },
    })
  } catch {}

  return { delegated: true, reason: `Delegated task ${params.taskUri} to ${params.toAgentUri}` }
}

// === Escalation ======================================================

/**
 * Escalation di un problema da un agente a un altro (gerarchicamente superiore).
 *
 * Crea edge ESCALATES_TO e registra l'escalation.
 */
export async function escalateIssue(params: {
  fromAgentUri: string
  toAgentUri: string
  reason: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  provenance: Provenance
}): Promise<{ escalated: boolean; reason: string }> {
  // Verifica che il destinatario sia superiore nella catena gerarchica
  const fromChain = await getReportingChain(params.fromAgentUri)
  if (!fromChain.includes(params.toAgentUri)) {
    return { escalated: false, reason: 'Escalation target must be in the reporting chain' }
  }

  // Crea edge ESCALATES_TO
  try {
    await createEdge({
      fromUri: params.fromAgentUri,
      toUri: params.toAgentUri,
      relationType: 'ESCALATES_TO',
      createdByAgent: params.provenance.createdByAgent,
      properties: {
        reason: params.reason,
        severity: params.severity,
        timestamp: new Date().toISOString(),
      },
    })
  } catch {}

  return { escalated: true, reason: `Escalated to ${params.toAgentUri}: ${params.reason}` }
}

// === Coordination (peer quorum) ======================================

/**
 * Richiede un quorum tra peer agenti per una decisione.
 *
 * Implementazione semplificata del Quorum semantico (Fase 13 ESR):
 *   - Invia la proposta a tutti i peer
 *   - Ogni peer vota accept/reject
 *   - La proposta passa se >= requiredQuorum peer votano accept
 *
 * In Fase 3.4 il quorum è simulato (rule-based). In produzione integrazione reale.
 */
export async function requestPeerQuorum(params: {
  proposerAgentUri: string
  proposal: string
  requiredQuorum: number
  provenance: Provenance
}): Promise<{
  quorumAchieved: boolean
  votes: Array<{ voterUri: string; vote: 'accept' | 'reject'; reason: string }>
  acceptCount: number
  rejectCount: number
}> {
  const topology = await getMeshTopology()
  const proposerNode = topology.nodes.find((n) => n.agentUri === params.proposerAgentUri)
  if (!proposerNode) {
    return {
      quorumAchieved: false,
      votes: [],
      acceptCount: 0,
      rejectCount: 0,
    }
  }

  const votes: Array<{ voterUri: string; vote: 'accept' | 'reject'; reason: string }> = []
  let acceptCount = 0
  let rejectCount = 0

  for (const peerUri of proposerNode.peerAgentUris) {
    // Rule-based voting: accept if proposal contains keywords matching the peer's role
    const peerAgent = await getAgent(peerUri)
    if (!peerAgent) continue

    const peerRole = peerAgent.name.toLowerCase()
    const proposalLower = params.proposal.toLowerCase()

    // Simple rule: peer accepts if proposal mentions its domain
    let vote: 'accept' | 'reject' = 'reject'
    let reason = 'Proposal not relevant to peer domain'

    const domainKeywords: Record<string, string[]> = {
      architect: ['architecture', 'design', 'system', 'structure'],
      planner: ['plan', 'task', 'decompose', 'schedule'],
      research: ['research', 'explore', 'investigate', 'study'],
      'world-model': ['prediction', 'world', 'state', 'forecast'],
      coding: ['code', 'implement', 'function', 'class'],
      qa: ['test', 'quality', 'verify', 'validate'],
      security: ['security', 'vulnerability', 'attack', 'safe'],
      data: ['data', 'pipeline', 'analytics', 'etl'],
      support: ['user', 'incident', 'support', 'help'],
    }

    const keywords = domainKeywords[peerRole] || []
    if (keywords.some((k) => proposalLower.includes(k))) {
      vote = 'accept'
      reason = `Proposal relevant to ${peerRole} domain`
      acceptCount++
    } else {
      rejectCount++
    }

    votes.push({ voterUri: peerUri, vote, reason })
  }

  return {
    quorumAchieved: acceptCount >= params.requiredQuorum,
    votes,
    acceptCount,
    rejectCount,
  }
}

// === Stats ===========================================================

export async function meshStats() {
  const topology = await getMeshTopology()
  const byTier = topology.nodes.reduce((acc, n) => {
    acc[n.tier] = (acc[n.tier] || 0) + 1
    return acc
  }, {} as Record<MeshTier, number>)

  return {
    totalAgents: topology.nodes.length,
    byTier,
    totalEdges: topology.edges.length,
    executiveAgents: byTier.executive || 0,
    strategicAgents: byTier.strategic || 0,
    operationalAgents: byTier.operational || 0,
    specializedAgents: byTier.specialized || 0,
  }
}

// === Helpers =========================================================

function inferTierFromName(name: string): MeshTier {
  const lower = name.toLowerCase()
  if (lower.includes('ceo') || lower.includes('executive')) return 'executive'
  if (['architect', 'planner', 'research', 'world-model'].some((k) => lower.includes(k))) return 'strategic'
  if (['coding', 'qa', 'security', 'data', 'support'].some((k) => lower.includes(k))) return 'operational'
  return 'specialized'
}

export function meshProvenance(agentUri: string = 'agent://mesh-manager'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'system-event',
    confidence: 1.0,
  })
}
