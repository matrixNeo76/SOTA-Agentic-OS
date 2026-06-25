/**
 * Agent Identity & Lifecycle — Fase 3.3
 *
 * Enforcement attivo dello schema definito in Fase 0.5.
 * Gli agenti diventano entità persistenti con:
 *   - Versioning (UPGRADED_TO)
 *   - Role binding (HAS_ROLE)
 *   - Capability tracking (POSSESSES)
 *   - Policy binding (BOUND_BY)
 *   - Skill usage tracking (USES_SKILL)
 *   - Performance evaluation linking (collegato a Fase 2.7 Evaluation)
 *
 * Tutte le operazioni sono auditate via AgentLog + emettono eventi Event Mesh.
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode, updateNodeLifecycle } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type LifecycleState, type Provenance } from '@/lib/governance'
import {
  publishAgentSpawned, publishAgentStopped,
} from '@/lib/event-mesh/publishers'
import { getAgentEvaluations } from '@/lib/evaluation/runner'

// === Tipi ============================================================

export interface AgentIdentity {
  uri: string
  name: string
  description: string
  version: string // current active version
  roles: string[] // AgentRole URIs
  capabilities: string[] // AgentCapability URIs
  skills: string[] // Skill URIs
  policies: string[] // AgentPolicy URIs
  parentAgent?: string
  currentVersionUri?: string
  lifecycleState: LifecycleState
  provenance: Provenance
  createdAt: string
  updatedAt: string
}

export interface AgentVersion {
  uri: string
  agentUri: string
  version: string
  changes: string
  upgradedFrom?: string
  evaluationScore?: number
  active: boolean
  createdAt: string
}

export interface AgentRole {
  uri: string
  name: string
  description: string
  permissions: string[]
}

export interface AgentCapability {
  uri: string
  name: string
  description: string
}

export interface AgentPolicy {
  uri: string
  rules: Record<string, unknown>
  enforcement: 'strict' | 'advisory' | 'audit'
  lifecycleState: LifecycleState
}

// === Agent registration ==============================================

/**
 * Registra un nuovo agente come entità persistente nel Context Graph.
 *
 * Crea:
 *   - Nodo Agent (lifecycleState='draft')
 *   - AgentVersion v1 iniziale
 *   - Edges HAS_ROLE / POSSESSES / BOUND_BY per i binding iniziali
 *
 * Pubblica evento AgentSpawned (Fase 2.1).
 */
export async function registerAgent(params: {
  name: string
  description: string
  version?: string
  roles?: Array<{ name: string; description?: string; permissions?: string[] }>
  capabilities?: Array<{ name: string; description?: string }>
  skills?: string[] // URIs of existing Skill
  policies?: Array<{ rules: Record<string, unknown>; enforcement?: AgentPolicy['enforcement'] }>
  parentAgent?: string
  provenance: Provenance
}): Promise<{ uri: string; agent: AgentIdentity; versionUri: string }> {
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  if (!params.name || params.name.length < 2) {
    throw new Error('Agent name must be at least 2 characters')
  }

  const identifier = params.name.toLowerCase().replace(/\s+/g, '-')
  const { uri } = await createNode({
    type: 'Agent',
    identifier,
    attributes: {
      name: params.name, // required by ENTITY_REGISTRY
      role: params.roles?.[0]?.name || 'general', // required by ENTITY_REGISTRY
      description: params.description,
      version: params.version || '1.0.0',
      roles: [],
      capabilities: [],
      skills: params.skills || [],
      policies: [],
      parentAgent: params.parentAgent,
    },
    provenance: params.provenance,
    lifecycleState: 'draft',
  })

  // Create initial AgentVersion
  const versionId = `v${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const versionIdentifier = `${identifier}@${params.version || '1.0.0'}`
  const { uri: versionUri } = await createNode({
    type: 'AgentVersion',
    identifier: versionIdentifier,
    attributes: {
      version: params.version || '1.0.0', // required by ENTITY_REGISTRY
      changes: 'Initial version', // required by ENTITY_REGISTRY
      agentUri: uri,
      active: true,
    },
    provenance: params.provenance,
  })

  // Edge Agent -[UPGRADED_TO]-> AgentVersion
  try {
    await createEdge({
      fromUri: uri,
      toUri: versionUri,
      relationType: 'UPGRADED_TO',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  // Update Agent with currentVersionUri
  const agentNode = await db.graphNode.findUnique({ where: { uri } })
  if (agentNode) {
    const attrs = JSON.parse(agentNode.attributes) as Record<string, unknown>
    await db.graphNode.update({
      where: { uri },
      data: {
        attributes: JSON.stringify({ ...attrs, currentVersionUri: versionUri }),
      },
    })
  }

  // Bind roles
  const roleUris: string[] = []
  for (const role of params.roles || []) {
    const roleUri = await bindRole(uri, role, params.provenance)
    roleUris.push(roleUri)
  }

  // Bind capabilities
  const capabilityUris: string[] = []
  for (const cap of params.capabilities || []) {
    const capUri = await bindCapability(uri, cap, params.provenance)
    capabilityUris.push(capUri)
  }

  // Bind policies
  const policyUris: string[] = []
  for (const policy of params.policies || []) {
    const policyUri = await bindPolicy(uri, policy, params.provenance)
    policyUris.push(policyUri)
  }

  // Bind skills
  for (const skillUri of params.skills || []) {
    try {
      await createEdge({
        fromUri: uri,
        toUri: skillUri,
        relationType: 'USES_SKILL',
        createdByAgent: params.provenance.createdByAgent,
      })
    } catch {}
  }

  // Update Agent with role/capability/policy URIs (need to re-read attributes after edges)
  const agentNode2 = await db.graphNode.findUnique({ where: { uri } })
  if (agentNode2) {
    const attrs2 = JSON.parse(agentNode2.attributes) as Record<string, unknown>
    await db.graphNode.update({
      where: { uri },
      data: {
        attributes: JSON.stringify({
          ...attrs2,
          roles: roleUris,
          capabilities: capabilityUris,
          policies: policyUris,
          skills: params.skills || [],
          currentVersionUri: versionUri,
        }),
      },
    })
  }

  // Activate the agent (draft → active)
  await updateNodeLifecycle(uri, 'active', params.provenance.createdByAgent, 'Initial activation')

  // Activate the initial version too
  try {
    await updateNodeLifecycle(versionUri, 'active', params.provenance.createdByAgent, 'Version activation')
  } catch {}

  // Publish AgentSpawned event
  await publishAgentSpawned(
    uri,
    params.roles?.[0]?.name || 'general',
    (params.capabilities || []).map((c) => c.name),
    params.provenance,
  ).catch(() => {})

  const agent: AgentIdentity = {
    uri,
    name: params.name,
    description: params.description,
    version: params.version || '1.0.0',
    roles: roleUris,
    capabilities: capabilityUris,
    skills: params.skills || [],
    policies: policyUris,
    parentAgent: params.parentAgent,
    currentVersionUri: versionUri,
    lifecycleState: 'active',
    provenance: params.provenance,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  return { uri, agent, versionUri }
}

/**
 * Recupera l'identità completa di un agente.
 */
export async function getAgent(uri: string): Promise<AgentIdentity | null> {
  const node = await getNode(uri)
  if (!node || node.entityType !== 'Agent') return null

  const attrs = node.attributes as Record<string, unknown>
  return {
    uri: node.uri,
    name: attrs.name as string,
    description: (attrs.description as string) || '',
    version: (attrs.version as string) || '1.0.0',
    roles: (attrs.roles as string[]) || [],
    capabilities: (attrs.capabilities as string[]) || [],
    skills: (attrs.skills as string[]) || [],
    policies: (attrs.policies as string[]) || [],
    parentAgent: attrs.parentAgent as string | undefined,
    currentVersionUri: attrs.currentVersionUri as string | undefined,
    lifecycleState: node.lifecycleState as LifecycleState,
    provenance: node.provenance,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  }
}

// === Role / Capability / Policy binding ==============================

async function bindRole(agentUri: string, role: { name: string; description?: string; permissions?: string[] }, provenance: Provenance): Promise<string> {
  const identifier = `role-${role.name.toLowerCase().replace(/\s+/g, '-')}`
  let roleUri: string

  try {
    const { uri } = await createNode({
      type: 'AgentRole',
      identifier,
      attributes: {
        name: role.name, // required by ENTITY_REGISTRY
        permissions: role.permissions || [], // required by ENTITY_REGISTRY
        description: role.description || '',
      },
      provenance,
    })
    roleUri = uri
  } catch {
    // Role già esistente
    roleUri = `agent-role://${identifier}`
  }

  try {
    await createEdge({
      fromUri: agentUri,
      toUri: roleUri,
      relationType: 'HAS_ROLE',
      createdByAgent: provenance.createdByAgent,
    })
  } catch {}

  return roleUri
}

async function bindCapability(agentUri: string, cap: { name: string; description?: string }, provenance: Provenance): Promise<string> {
  const identifier = `cap-${cap.name.toLowerCase().replace(/\s+/g, '-')}`
  let capUri: string

  try {
    const { uri } = await createNode({
      type: 'AgentCapability',
      identifier,
      attributes: {
        name: cap.name, // required by ENTITY_REGISTRY
        description: cap.description || cap.name, // required by ENTITY_REGISTRY
      },
      provenance,
    })
    capUri = uri
  } catch {
    capUri = `agent-capability://${identifier}`
  }

  try {
    await createEdge({
      fromUri: agentUri,
      toUri: capUri,
      relationType: 'POSSESSES',
      createdByAgent: provenance.createdByAgent,
    })
  } catch {}

  return capUri
}

async function bindPolicy(agentUri: string, policy: { rules: Record<string, unknown>; enforcement?: AgentPolicy['enforcement'] }, provenance: Provenance): Promise<string> {
  const identifier = `policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uri } = await createNode({
    type: 'AgentPolicy',
    identifier,
    attributes: {
      rules: policy.rules, // required by ENTITY_REGISTRY
      enforcement: policy.enforcement || 'strict', // required by ENTITY_REGISTRY
    },
    provenance,
    lifecycleState: 'draft',
  })

  // Activate policy (draft → active)
  await updateNodeLifecycle(uri, 'active', provenance.createdByAgent, 'Policy activation')

  try {
    await createEdge({
      fromUri: agentUri,
      toUri: uri,
      relationType: 'BOUND_BY',
      createdByAgent: provenance.createdByAgent,
    })
  } catch {}

  return uri
}

// === Versioning ======================================================

/**
 * Crea una nuova versione di un agente.
 *
 * La nuova versione diventa attiva; la vecchia viene deprecata.
 * Opzionalmente collega un'Evaluation (Fase 2.7) come evaluationScore.
 */
export async function upgradeAgentVersion(params: {
  agentUri: string
  newVersion: string
  changes: string
  evaluationScore?: number
  provenance: Provenance
}): Promise<{ versionUri: string; version: AgentVersion }> {
  const agent = await getAgent(params.agentUri)
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentUri}`)
  }

  // Deprecate old version (se esiste)
  if (agent.currentVersionUri) {
    try {
      await updateNodeLifecycle(agent.currentVersionUri, 'deprecated', params.provenance.createdByAgent, `Superseded by ${params.newVersion}`)
    } catch {}

    // Mark old version as inactive in attributes
    const oldVersionNode = await db.graphNode.findUnique({ where: { uri: agent.currentVersionUri } })
    if (oldVersionNode) {
      const oldAttrs = JSON.parse(oldVersionNode.attributes) as Record<string, unknown>
      await db.graphNode.update({
        where: { uri: agent.currentVersionUri },
        data: {
          attributes: JSON.stringify({ ...oldAttrs, active: false }),
          updatedAt: new Date(),
        },
      })
    }
  }

  // Create new version
  const identifier = `${agent.uri.split('//')[1]}@${params.newVersion}`
  const { uri: versionUri } = await createNode({
    type: 'AgentVersion',
    identifier,
    attributes: {
      version: params.newVersion,
      changes: params.changes,
      agentUri: params.agentUri,
      upgradedFrom: agent.currentVersionUri,
      evaluationScore: params.evaluationScore,
      active: true,
    },
    provenance: params.provenance,
  })

  // Activate the new version (draft → active)
  try {
    await updateNodeLifecycle(versionUri, 'active', params.provenance.createdByAgent, `Activated as new version ${params.newVersion}`)
  } catch {}

  // Edge Agent -[UPGRADED_TO]-> new AgentVersion
  try {
    await createEdge({
      fromUri: params.agentUri,
      toUri: versionUri,
      relationType: 'UPGRADED_TO',
      createdByAgent: params.provenance.createdByAgent,
    })
  } catch {}

  // Edge newVersion -[UPGRADED_FROM]-> oldVersion
  if (agent.currentVersionUri) {
    try {
      await createEdge({
        fromUri: versionUri,
        toUri: agent.currentVersionUri,
        relationType: 'UPGRADED_FROM',
        createdByAgent: params.provenance.createdByAgent,
      })
    } catch {}
  }

  // Update Agent.version and currentVersionUri
  const agentNode = await db.graphNode.findUnique({ where: { uri: params.agentUri } })
  if (agentNode) {
    const attrs = JSON.parse(agentNode.attributes) as Record<string, unknown>
    await db.graphNode.update({
      where: { uri: params.agentUri },
      data: {
        attributes: JSON.stringify({
          ...attrs,
          version: params.newVersion,
          currentVersionUri: versionUri,
        }),
        updatedAt: new Date(),
      },
    })
  }

  const version: AgentVersion = {
    uri: versionUri,
    agentUri: params.agentUri,
    version: params.newVersion,
    changes: params.changes,
    upgradedFrom: agent.currentVersionUri,
    evaluationScore: params.evaluationScore,
    active: true,
    createdAt: new Date().toISOString(),
  }

  return { versionUri, version }
}

/**
 * Lista tutte le versioni di un agente, ordinate per data.
 */
export async function listAgentVersions(agentUri: string): Promise<AgentVersion[]> {
  const edges = await db.graphEdge.findMany({
    where: { relationType: 'UPGRADED_TO', fromNodeId: (await db.graphNode.findUnique({ where: { uri: agentUri } }))?.id },
    include: { toNode: true },
    orderBy: { createdAt: 'desc' },
  })

  const versions: AgentVersion[] = []
  for (const edge of edges) {
    const attrs = JSON.parse(edge.toNode.attributes) as Record<string, unknown>
    versions.push({
      uri: edge.toNode.uri,
      agentUri,
      version: attrs.version as string,
      changes: attrs.changes as string,
      upgradedFrom: attrs.upgradedFrom as string | undefined,
      evaluationScore: attrs.evaluationScore as number | undefined,
      active: (attrs.active as boolean) ?? false,
      createdAt: edge.toNode.createdAt.toISOString(),
    })
  }
  return versions
}

/**
 * Verifica se un upgrade è un miglioramento o una regressione
 * basandosi sugli evaluationScore delle versioni.
 */
export async function compareAgentVersions(params: {
  agentUri: string
  fromVersionUri: string
  toVersionUri: string
}): Promise<{ improvement: boolean; delta: number; recommendation: 'promote' | 'rollback' | 'inconclusive' }> {
  const versions = await listAgentVersions(params.agentUri)
  const from = versions.find((v) => v.uri === params.fromVersionUri)
  const to = versions.find((v) => v.uri === params.toVersionUri)

  if (!from || !to) {
    return { improvement: false, delta: 0, recommendation: 'inconclusive' }
  }

  // Se abbiamo evaluationScore per entrambi, confronta
  if (from.evaluationScore !== undefined && to.evaluationScore !== undefined) {
    const delta = to.evaluationScore - from.evaluationScore
    return {
      improvement: delta > 0,
      delta,
      recommendation: delta > 0.05 ? 'promote' : delta < -0.05 ? 'rollback' : 'inconclusive',
    }
  }

  // Altrimenti usa le Evaluation di Fase 2.7
  const evaluations = await getAgentEvaluations(params.agentUri)
  if (evaluations.length === 0) {
    return { improvement: false, delta: 0, recommendation: 'inconclusive' }
  }

  // Confronta le ultime 2 valutazioni (assumendo che la più recente sia per la nuova versione)
  if (evaluations.length >= 2) {
    const recent = evaluations[0]!
    const previous = evaluations[1]!
    const delta = recent.overallScore - previous.overallScore
    return {
      improvement: delta > 0,
      delta,
      recommendation: delta > 0.05 ? 'promote' : delta < -0.05 ? 'rollback' : 'inconclusive',
    }
  }

  return { improvement: false, delta: 0, recommendation: 'inconclusive' }
}

// === Agent lifecycle management ======================================

/**
 * Sospendi un agente (active → suspended).
 * Pubblica evento AgentStopped.
 */
export async function suspendAgent(agentUri: string, reason: string, provenance: Provenance): Promise<void> {
  await updateNodeLifecycle(agentUri, 'suspended', provenance.createdByAgent, reason)
  await publishAgentStopped(agentUri, reason, provenance).catch(() => {})
}

/**
 * Riattiva un agente (suspended → active).
 */
export async function resumeAgent(agentUri: string, provenance: Provenance): Promise<void> {
  await updateNodeLifecycle(agentUri, 'active', provenance.createdByAgent, 'Resumed from suspension')
}

/**
 * Depreca un agente (active/suspended → deprecated).
 */
export async function deprecateAgent(agentUri: string, reason: string, provenance: Provenance): Promise<void> {
  await updateNodeLifecycle(agentUri, 'deprecated', provenance.createdByAgent, reason)
}

// === Permission check (Policy enforcement) ===========================

/**
 * Verifica se un agente ha un permesso specifico, considerando:
 *   - I ruoli assegnati (HAS_ROLE → permissions)
 *   - Le policy bound (BOUND_BY → rules)
 *
 * Ritorna { allowed: boolean, reason: string }.
 */
export async function checkPermission(params: {
  agentUri: string
  permission: string // e.g. 'tool:exec', 'file:write:/tmp/*'
}): Promise<{ allowed: boolean; reason: string; matchedBy: 'role' | 'policy' | 'none' }> {
  const agent = await getAgent(params.agentUri)
  if (!agent) {
    return { allowed: false, reason: 'Agent not found', matchedBy: 'none' }
  }

  if (agent.lifecycleState !== 'active') {
    return { allowed: false, reason: `Agent is ${agent.lifecycleState}, not active`, matchedBy: 'none' }
  }

  // Check permissions via roles
  for (const roleUri of agent.roles) {
    const roleNode = await db.graphNode.findUnique({ where: { uri: roleUri } })
    if (!roleNode) continue
    const attrs = JSON.parse(roleNode.attributes) as Record<string, unknown>
    const permissions = (attrs.permissions as string[]) || []
    for (const perm of permissions) {
      if (matchesPermission(perm, params.permission)) {
        return { allowed: true, reason: `Allowed by role ${attrs.name}`, matchedBy: 'role' }
      }
    }
  }

  // Check policies (enforcement=strict denies by default; advisory allows with warning)
  for (const policyUri of agent.policies) {
    const policyNode = await db.graphNode.findUnique({ where: { uri: policyUri } })
    if (!policyNode) continue
    const attrs = JSON.parse(policyNode.attributes) as Record<string, unknown>
    const rules = attrs.rules as Record<string, unknown>
    const enforcement = attrs.enforcement as string

    // Check deny rules
    const denyList = (rules.deny as string[]) || []
    for (const deny of denyList) {
      if (matchesPermission(deny, params.permission)) {
        if (enforcement === 'strict') {
          return { allowed: false, reason: `Denied by policy ${policyUri} (strict)`, matchedBy: 'policy' }
        }
      }
    }

    // Check allow rules
    const allowList = (rules.allow as string[]) || []
    for (const allow of allowList) {
      if (matchesPermission(allow, params.permission)) {
        return { allowed: true, reason: `Allowed by policy ${policyUri}`, matchedBy: 'policy' }
      }
    }
  }

  // Default deny
  return { allowed: false, reason: 'No matching permission or policy', matchedBy: 'none' }
}

function matchesPermission(pattern: string, requested: string): boolean {
  // Supporta wildcards: 'tool:*' matches 'tool:exec', 'file:write:/tmp/*' matches 'file:write:/tmp/foo'
  if (pattern === '*') return true
  const regex = pattern
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${regex}$`).test(requested)
}

// === Stats ===========================================================

export async function agentLifecycleStats() {
  const [totalAgents, byState, totalVersions, totalRoles, totalPolicies] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Agent' } }),
    db.graphNode.groupBy({ by: ['lifecycleState'], where: { entityType: 'Agent' }, _count: true }),
    db.graphNode.count({ where: { entityType: 'AgentVersion' } }),
    db.graphNode.count({ where: { entityType: 'AgentRole' } }),
    db.graphNode.count({ where: { entityType: 'AgentPolicy' } }),
  ])

  return {
    totalAgents,
    byLifecycleState: byState.reduce((acc, s) => ({ ...acc, [s.lifecycleState]: s._count }), {} as Record<string, number>),
    totalVersions,
    totalRoles,
    totalPolicies,
  }
}

export function agentLifecycleProvenance(agentUri: string = 'agent://identity-manager'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'system-event',
    confidence: 1.0,
  })
}
