/**
 * Autonomous Organization Layer — Fase 3.6
 *
 * Il sistema crea agenti, skill, workflow, team; ottimizza processi;
 * riorganizza la memoria; apprende in autonomia.
 *
 * TUTTO sotto Human Approval Gates del Sovereign Validator (Fase 9).
 *
 * Capacità:
 *   1. createAgent: genera nuovi agenti quando servono
 *   2. createWorkflow: composizione automatica di workflow
 *   3. optimizeProcess: analizza e ottimizza processi esistenti
 *   4. reorganizeMemory: consolidation e restructuring della memoria
 *   5. learnFromExperience: apprendimento riflessivo autonomo
 *
 * Ogni azione è wrapping in una proposal che DEVE essere approvata
 * dal Sovereign Validator prima dell'esecuzione.
 */

import { db } from '@/lib/db'
import { createNode, createEdge } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'
import { registerAgent, getAgent, upgradeAgentVersion } from '@/lib/agent-lifecycle/manager'
import { registerSkill, searchSkills } from '@/lib/skill-registry/registry'
import { consolidateEpisodicToProcedural, archiveColdMemories } from '@/lib/cognitive-gc/curator'
import { publishApprovalRequested, publishApprovalGranted } from '@/lib/event-mesh/publishers'
import { captureWorldState, runRuleBasedPredictor } from '@/lib/world-model/engine'

// === Tipi ============================================================

export type ProposalType =
  | 'create_agent'
  | 'create_skill'
  | 'create_workflow'
  | 'optimize_process'
  | 'reorganize_memory'
  | 'upgrade_agent'
  | 'learn_from_experience'

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed'

export interface AutonomousProposal {
  uri: string
  type: ProposalType
  description: string
  rationale: string
  expectedImpact: {
    costDelta: number // negative = saving
    performanceDelta: number // 0..1, positive = improvement
    riskLevel: 'low' | 'medium' | 'high'
  }
  proposedBy: string
  proposedAt: string
  status: ProposalStatus
  approvedBy?: string
  approvedAt?: string
  executionResult?: {
    success: boolean
    artifacts: string[] // URIs of created/modified entities
    error?: string
    executedAt: string
  }
  expiresAt?: string
}

export interface CreateAgentProposal {
  name: string
  description: string
  tier: 'executive' | 'strategic' | 'operational' | 'specialized'
  parentAgentUri?: string
  roles: Array<{ name: string; permissions: string[] }>
  capabilities: Array<{ name: string; description?: string }>
  rationale: string
}

export interface CreateWorkflowProposal {
  name: string
  goal: string
  steps: Array<{ agentUri: string; task: string; dependencies: string[] }>
  rationale: string
}

export interface OptimizeProcessProposal {
  targetProcess: string // process URI or name
  optimizationType: 'cost_reduction' | 'latency_reduction' | 'quality_improvement' | 'resource_optimization'
  changes: Array<{ description: string; expectedImpact: string }>
  rationale: string
}

export interface ReorganizeMemoryProposal {
  agentUri?: string
  consolidationStrategy: 'aggressive' | 'conservative' | 'selective'
  archivalPolicy: 'immediate' | 'gradual' | 'manual'
  rationale: string
}

export interface UpgradeAgentProposal {
  agentUri: string
  newVersion: string
  changes: string
  rationale: string
}

// === Proposal creation ===============================================

/**
 * Crea una proposal per un'azione autonoma.
 * Tutte le proposal sono pending fino a approval umana.
 */
export async function createProposal(params: {
  type: ProposalType
  description: string
  rationale: string
  expectedImpact: AutonomousProposal['expectedImpact']
  proposedBy?: string
  payload: unknown
  provenance: Provenance
  expiresInHours?: number
}): Promise<{ uri: string; proposal: AutonomousProposal }> {
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  if (!params.description || params.description.length < 10) {
    throw new Error('Proposal description must be at least 10 characters')
  }

  const proposedBy = params.proposedBy || 'agent://autonomous-org'
  const now = new Date()
  const expiresAt = params.expiresInHours
    ? new Date(now.getTime() + params.expiresInHours * 60 * 60 * 1000)
    : undefined

  const identifier = `proposal-${now.toISOString().replace(/[:.]/g, '-')}`
  const { uri } = await createNode({
    type: 'Decision',
    identifier,
    attributes: {
      rationale: params.rationale, // required by ENTITY_REGISTRY
      decidedBy: proposedBy, // required by ENTITY_REGISTRY
      type: params.type,
      description: params.description,
      expectedImpact: params.expectedImpact,
      payload: params.payload,
      status: 'pending',
      proposedAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString(),
    },
    provenance: params.provenance,
  })

  // Publish ApprovalRequested event per Sovereign Validator
  await publishApprovalRequested(
    uri,
    `Autonomous action: ${params.type} - ${params.description.slice(0, 80)}`,
    'hitl_gate',
    params.provenance,
  ).catch(() => {})

  const proposal: AutonomousProposal = {
    uri,
    type: params.type,
    description: params.description,
    rationale: params.rationale,
    expectedImpact: params.expectedImpact,
    proposedBy,
    proposedAt: now.toISOString(),
    status: 'pending',
    expiresAt: expiresAt?.toISOString(),
  }

  return { uri, proposal }
}

// === Proposal approval ===============================================

/**
 * Approva una proposal (Sovereign Validator action).
 * Solo dopo approval l'azione viene eseguita.
 */
export async function approveProposal(params: {
  proposalUri: string
  approvedBy: string
  provenance: Provenance
}): Promise<{ executed: boolean; result?: AutonomousProposal['executionResult'] }> {
  const proposal = await getProposal(params.proposalUri)
  if (!proposal) {
    return { executed: false }
  }

  if (proposal.status !== 'pending') {
    return { executed: false }
  }

  // Verifica expiry
  if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
    await updateProposalStatus(params.proposalUri, 'expired', params.approvedBy, params.provenance)
    return { executed: false }
  }

  // Update status to approved
  await updateProposalStatus(params.proposalUri, 'approved', params.approvedBy, params.provenance)

  // Publish ApprovalGranted
  await publishApprovalGranted(
    params.proposalUri,
    'approved',
    params.approvedBy,
    params.provenance,
  ).catch(() => {})

  // Execute the proposal
  const result = await executeProposal(params.proposalUri, params.provenance)

  // Update with execution result
  await db.graphNode.update({
    where: { uri: params.proposalUri },
    data: {
      attributes: JSON.stringify({
        ...(JSON.parse((await db.graphNode.findUnique({ where: { uri: params.proposalUri } }))!.attributes)),
        status: 'executed',
        executionResult: result,
      }),
      updatedAt: new Date(),
    },
  })

  return { executed: result.success, result }
}

/**
 * Respinge una proposal.
 */
export async function rejectProposal(params: {
  proposalUri: string
  rejectedBy: string
  reason: string
  provenance: Provenance
}): Promise<void> {
  await updateProposalStatus(params.proposalUri, 'rejected', params.rejectedBy, params.provenance)

  // Publish ApprovalRejected (using publishApprovalGranted with choice='rejected' for simplicity)
  await publishApprovalGranted(
    params.proposalUri,
    'rejected',
    params.rejectedBy,
    params.provenance,
  ).catch(() => {})
}

// === Proposal execution ==============================================

async function executeProposal(proposalUri: string, provenance: Provenance): Promise<NonNullable<AutonomousProposal['executionResult']>> {
  const proposal = await getProposal(proposalUri)
  if (!proposal) {
    return { success: false, artifacts: [], error: 'Proposal not found', executedAt: new Date().toISOString() }
  }

  const node = await db.graphNode.findUnique({ where: { uri: proposalUri } })
  const attrs = JSON.parse(node!.attributes) as Record<string, unknown>
  const payload = attrs.payload as Record<string, unknown>

  try {
    let artifacts: string[] = []

    switch (proposal.type) {
      case 'create_agent':
        artifacts = await executeCreateAgent(payload as unknown as CreateAgentProposal, provenance)
        break

      case 'create_skill':
        artifacts = await executeCreateSkill(payload as unknown as { name: string; description: string; promptTemplate: string }, provenance)
        break

      case 'create_workflow':
        artifacts = await executeCreateWorkflow(payload as unknown as CreateWorkflowProposal, provenance)
        break

      case 'optimize_process':
        artifacts = await executeOptimizeProcess(payload as unknown as OptimizeProcessProposal, provenance)
        break

      case 'reorganize_memory':
        artifacts = await executeReorganizeMemory(payload as unknown as ReorganizeMemoryProposal, provenance)
        break

      case 'upgrade_agent':
        artifacts = await executeUpgradeAgent(payload as unknown as UpgradeAgentProposal, provenance)
        break

      case 'learn_from_experience':
        artifacts = await executeLearnFromExperience(provenance)
        break

      default:
        throw new Error(`Unknown proposal type: ${proposal.type}`)
    }

    return {
      success: true,
      artifacts,
      executedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      success: false,
      artifacts: [],
      error: String(err),
      executedAt: new Date().toISOString(),
    }
  }
}

// === Action executors ================================================

async function executeCreateAgent(proposal: CreateAgentProposal, provenance: Provenance): Promise<string[]> {
  const { uri } = await registerAgent({
    name: proposal.name,
    description: proposal.description,
    roles: proposal.roles,
    capabilities: proposal.capabilities,
    provenance,
  })

  // If parent specified, create REPORTS_TO edge
  if (proposal.parentAgentUri) {
    try {
      await createEdge({
        fromUri: uri,
        toUri: proposal.parentAgentUri,
        relationType: 'REPORTS_TO',
        createdByAgent: provenance.createdByAgent,
      })
    } catch {}
  }

  return [uri]
}

async function executeCreateSkill(proposal: { name: string; description: string; promptTemplate: string }, provenance: Provenance): Promise<string[]> {
  const { uri } = await registerSkill({
    name: proposal.name,
    description: proposal.description,
    promptTemplate: proposal.promptTemplate,
    tags: ['autonomous-generated'],
    provenance,
  })
  return [uri]
}

async function executeCreateWorkflow(proposal: CreateWorkflowProposal, provenance: Provenance): Promise<string[]> {
  // Create a Workflow node
  const identifier = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { uri } = await createNode({
    type: 'Workflow',
    identifier,
    attributes: {
      name: proposal.name, // required by ENTITY_REGISTRY
      steps: proposal.steps, // required by ENTITY_REGISTRY
      goal: proposal.goal,
    },
    provenance,
  })

  // Create edges for each step's agent involvement
  for (const step of proposal.steps) {
    try {
      await createEdge({
        fromUri: uri,
        toUri: step.agentUri,
        relationType: 'EXECUTED_BY',
        createdByAgent: provenance.createdByAgent,
        properties: { task: step.task, dependencies: step.dependencies },
      })
    } catch {}
  }

  return [uri]
}

async function executeOptimizeProcess(proposal: OptimizeProcessProposal, provenance: Provenance): Promise<string[]> {
  // Create a Decision node documenting the optimization
  const identifier = `optimization-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { uri } = await createNode({
    type: 'Decision',
    identifier,
    attributes: {
      rationale: `Process optimization: ${proposal.optimizationType} for ${proposal.targetProcess}`,
      decidedBy: provenance.createdByAgent,
      targetProcess: proposal.targetProcess,
      optimizationType: proposal.optimizationType,
      changes: proposal.changes,
    },
    provenance,
  })

  return [uri]
}

async function executeReorganizeMemory(proposal: ReorganizeMemoryProposal, provenance: Provenance): Promise<string[]> {
  const artifacts: string[] = []

  // Run consolidation based on strategy
  const minClusterSize = proposal.consolidationStrategy === 'aggressive' ? 2
    : proposal.consolidationStrategy === 'conservative' ? 5
    : 3 // selective

  const consolidationResult = await consolidateEpisodicToProcedural({
    agentUri: proposal.agentUri,
    minClusterSize,
  })
  artifacts.push(`consolidation:${consolidationResult.newProceduralMemories} new procedural memories`)

  // Run archival if immediate or gradual
  if (proposal.archivalPolicy === 'immediate' || proposal.archivalPolicy === 'gradual') {
    const archiveResult = await archiveColdMemories({
      agentUri: proposal.agentUri,
      maxArchives: proposal.archivalPolicy === 'immediate' ? 500 : 100,
    })
    artifacts.push(`archival:${archiveResult.archived} memories archived`)
  }

  return artifacts
}

async function executeUpgradeAgent(proposal: UpgradeAgentProposal, provenance: Provenance): Promise<string[]> {
  const { versionUri } = await upgradeAgentVersion({
    agentUri: proposal.agentUri,
    newVersion: proposal.newVersion,
    changes: proposal.changes,
    provenance,
  })
  return [versionUri]
}

async function executeLearnFromExperience(provenance: Provenance): Promise<string[]> {
  const artifacts: string[] = []

  // Capture current WorldState
  const { uri: wsUri, worldState } = await captureWorldState({ provenance })
  artifacts.push(wsUri)

  // Run rule-based predictor to identify risks/opportunities
  const predictions = await runRuleBasedPredictor({ ...worldState, uri: wsUri, basedOnWorldStateUri: wsUri } as any)

  artifacts.push(...predictions.predictions.map((p) => p.uri))
  artifacts.push(...predictions.risks.map((r) => r.uri))
  artifacts.push(...predictions.opportunities.map((o) => o.uri))

  return artifacts
}

// === Auto-proposal generators ========================================

/**
 * Analizza lo stato del sistema e genera proposals autonome.
 *
 * Questo è il "brain" dell'Autonomous Organization: guarda i dati,
 * identifica problemi/opportunità, propone azioni.
 *
 * Le proposals vengono create ma NON eseguite: aspettano approval umana.
 */
export async function generateAutoProposals(options?: {
  maxProposals?: number
  provenance?: Provenance
}): Promise<AutonomousProposal[]> {
  const maxProposals = options?.maxProposals ?? 5
  const provenance = options?.provenance || createProvenance({
    agent: 'agent://autonomous-org',
    source: 'agent-reasoning',
    confidence: 0.8,
  })

  const proposals: AutonomousProposal[] = []

  // Capture WorldState
  const { worldState } = await captureWorldState({ provenance })

  // Rule 1: high error rate → propose process optimization
  if (worldState.snapshot.errorRate > 0.2 && proposals.length < maxProposals) {
    const { proposal } = await createProposal({
      type: 'optimize_process',
      description: `Investigate and optimize process causing ${(worldState.snapshot.errorRate * 100).toFixed(1)}% error rate`,
      rationale: 'Sustained high error rate indicates systemic issue requiring process optimization',
      expectedImpact: {
        costDelta: -50, // expected savings from reduced errors
        performanceDelta: 0.2,
        riskLevel: 'medium',
      },
      payload: {
        targetProcess: 'task-execution-pipeline',
        optimizationType: 'quality_improvement',
        changes: [
          { description: 'Add retry logic with exponential backoff', expectedImpact: 'Reduce transient failures by 60%' },
          { description: 'Implement circuit breaker for failing tools', expectedImpact: 'Prevent cascading failures' },
        ],
      } as unknown as OptimizeProcessProposal,
      provenance,
    })
    proposals.push(proposal)
  }

  // Rule 2: high cost → propose cost reduction
  if (worldState.snapshot.totalCostLast24h > 50 && proposals.length < maxProposals) {
    const { proposal } = await createProposal({
      type: 'optimize_process',
      description: `Reduce daily cost from $${worldState.snapshot.totalCostLast24h.toFixed(2)} by routing more tasks to local models`,
      rationale: 'Cost trajectory exceeds budget threshold; local-first routing can reduce API costs by 80%',
      expectedImpact: {
        costDelta: -40,
        performanceDelta: -0.05, // slight quality reduction
        riskLevel: 'low',
      },
      payload: {
        targetProcess: 'cognitive-router',
        optimizationType: 'cost_reduction',
        changes: [
          { description: 'Lower routing threshold for Simple tasks to prefer local SLM', expectedImpact: '40% tasks shifted to local' },
        ],
      } as unknown as OptimizeProcessProposal,
      provenance,
    })
    proposals.push(proposal)
  }

  // Rule 3: many pending tasks → propose creating new agent
  if (worldState.snapshot.pendingTasks > 20 && proposals.length < maxProposals) {
    const { proposal } = await createProposal({
      type: 'create_agent',
      description: `Create new operational agent to handle backlog of ${worldState.snapshot.pendingTasks} pending tasks`,
      rationale: 'Backlog exceeds capacity; spawning additional operational agent will increase throughput',
      expectedImpact: {
        costDelta: 10, // additional agent cost
        performanceDelta: 0.3,
        riskLevel: 'low',
      },
      payload: {
        name: `autoscaled-worker-${Date.now()}`,
        description: 'Auto-scaled worker agent for backlog processing',
        tier: 'operational',
        roles: [{ name: 'worker', permissions: ['task:execute', 'tool:exec:safe'] }],
        capabilities: [{ name: 'task-execution', description: 'Can execute tasks' }],
        rationale: 'Auto-spawned for backlog',
      } as unknown as CreateAgentProposal,
      provenance,
    })
    proposals.push(proposal)
  }

  // Rule 4: large memory → propose reorganization
  if (worldState.snapshot.memoryEntries > 1000 && proposals.length < maxProposals) {
    const { proposal } = await createProposal({
      type: 'reorganize_memory',
      description: `Reorganize ${worldState.snapshot.memoryEntries} memory entries with consolidation and archival`,
      rationale: 'Memory growth indicates need for consolidation; archival will free storage',
      expectedImpact: {
        costDelta: -5,
        performanceDelta: 0.1,
        riskLevel: 'low',
      },
      payload: {
        consolidationStrategy: 'selective',
        archivalPolicy: 'gradual',
        rationale: 'Selective consolidation with gradual archival',
      } as unknown as ReorganizeMemoryProposal,
      provenance,
    })
    proposals.push(proposal)
  }

  // Rule 5: anomalies detected → propose learning
  if (worldState.snapshot.anomalies.length > 0 && proposals.length < maxProposals) {
    const { proposal } = await createProposal({
      type: 'learn_from_experience',
      description: `Capture world state and identify risks/opportunities from ${worldState.snapshot.anomalies.length} anomalies`,
      rationale: 'Anomalies indicate need for learning and adaptation',
      expectedImpact: {
        costDelta: 0,
        performanceDelta: 0.05,
        riskLevel: 'low',
      },
      payload: {},
      provenance,
    })
    proposals.push(proposal)
  }

  return proposals
}

// === Queries =========================================================

export async function getProposal(uri: string): Promise<AutonomousProposal | null> {
  const node = await db.graphNode.findUnique({ where: { uri } })
  if (!node || node.entityType !== 'Decision') return null

  const attrs = JSON.parse(node.attributes) as Record<string, unknown>
  if (!attrs.type || !['create_agent', 'create_skill', 'create_workflow', 'optimize_process', 'reorganize_memory', 'upgrade_agent', 'learn_from_experience'].includes(attrs.type as string)) {
    return null
  }

  return {
    uri: node.uri,
    type: attrs.type as ProposalType,
    description: attrs.description as string,
    rationale: attrs.rationale as string,
    expectedImpact: attrs.expectedImpact as AutonomousProposal['expectedImpact'],
    proposedBy: attrs.decidedBy as string,
    proposedAt: (attrs.proposedAt as string) || node.createdAt.toISOString(),
    status: (attrs.status as ProposalStatus) || 'pending',
    approvedBy: attrs.approvedBy as string | undefined,
    approvedAt: attrs.approvedAt as string | undefined,
    executionResult: attrs.executionResult as AutonomousProposal['executionResult'],
    expiresAt: attrs.expiresAt as string | undefined,
  }
}

export async function listPendingProposals(limit = 20): Promise<AutonomousProposal[]> {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Decision' },
    take: limit * 3,
    orderBy: { createdAt: 'desc' },
  })

  const proposals: AutonomousProposal[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    if (!attrs.type || !Array.from(['create_agent', 'create_skill', 'create_workflow', 'optimize_process', 'reorganize_memory', 'upgrade_agent', 'learn_from_experience']).includes(attrs.type as string)) continue
    if (attrs.status !== 'pending') continue

    proposals.push({
      uri: node.uri,
      type: attrs.type as ProposalType,
      description: attrs.description as string,
      rationale: attrs.rationale as string,
      expectedImpact: attrs.expectedImpact as AutonomousProposal['expectedImpact'],
      proposedBy: attrs.decidedBy as string,
      proposedAt: (attrs.proposedAt as string) || node.createdAt.toISOString(),
      status: 'pending',
      expiresAt: attrs.expiresAt as string | undefined,
    })

    if (proposals.length >= limit) break
  }

  return proposals
}

async function updateProposalStatus(uri: string, status: ProposalStatus, actor: string, provenance: Provenance): Promise<void> {
  const node = await db.graphNode.findUnique({ where: { uri } })
  if (!node) return
  const attrs = JSON.parse(node.attributes) as Record<string, unknown>
  await db.graphNode.update({
    where: { uri },
    data: {
      attributes: JSON.stringify({
        ...attrs,
        status,
        approvedBy: actor,
        approvedAt: new Date().toISOString(),
      }),
      updatedAt: new Date(),
    },
  })
}

// === Stats ===========================================================

export async function autonomousOrgStats() {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Decision' },
    select: { attributes: true },
  })

  const stats = {
    totalProposals: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    executed: 0,
    expired: 0,
    byType: {} as Record<ProposalType, number>,
  }

  for (const node of nodes) {
    try {
      const attrs = JSON.parse(node.attributes) as Record<string, unknown>
      if (!attrs.type || !Array.from(['create_agent', 'create_skill', 'create_workflow', 'optimize_process', 'reorganize_memory', 'upgrade_agent', 'learn_from_experience']).includes(attrs.type as string)) continue

      stats.totalProposals++
      const status = (attrs.status as ProposalStatus) || 'pending'
      stats[status]++
      const type = attrs.type as ProposalType
      stats.byType[type] = (stats.byType[type] || 0) + 1
    } catch {}
  }

  return stats
}

export function autonomousOrgProvenance(agentUri: string = 'agent://autonomous-org'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'agent-reasoning',
    confidence: 0.8,
  })
}
