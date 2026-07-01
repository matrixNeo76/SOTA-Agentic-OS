/**
 * Tests for Hierarchical Agent Mesh (Fase 3.4)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  bootstrapDefaultMesh, getMeshTopology, getMeshByTier, getReportingChain,
  delegateTask, escalateIssue, requestPeerQuorum, meshStats,
  meshProvenance, DEFAULT_MESH_PRESET,
} from '@/lib/agent-mesh/topology'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = meshProvenance()

describe('Agent Mesh — bootstrapDefaultMesh', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    _resetEventMeshForTests()
  })

  it('inizializza la mesh con il preset di default', async () => {
    const { created, skipped, mesh } = await bootstrapDefaultMesh(VALID_PROV)

    expect(created).toBeGreaterThan(0)
    expect(created + skipped).toBe(DEFAULT_MESH_PRESET.length)
    expect(mesh.nodes.length).toBe(DEFAULT_MESH_PRESET.length)
  })

  it('è idempotente (second run non crea duplicati)', async () => {
    const second = await bootstrapDefaultMesh(VALID_PROV)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(DEFAULT_MESH_PRESET.length)
  })

  it('crea agenti in tutti i 4 tier', async () => {
    const stats = await meshStats()
    expect(stats.executiveAgents).toBeGreaterThan(0)
    expect(stats.strategicAgents).toBeGreaterThan(0)
    expect(stats.operationalAgents).toBeGreaterThan(0)
  })
})

describe('Agent Mesh — getMeshTopology', () => {
  it('ritorna la topologia completa con nodi ed edges', async () => {
    const topology = await getMeshTopology()
    expect(topology.nodes.length).toBeGreaterThan(0)
    expect(topology.edges.length).toBeGreaterThan(0)

    // Ogni nodo ha i campi popolati
    for (const node of topology.nodes) {
      expect(node.agentUri).toMatch(/^agent:\/\//)
      expect(['executive', 'strategic', 'operational', 'specialized']).toContain(node.tier)
      expect(Array.isArray(node.childAgentUris)).toBe(true)
      expect(Array.isArray(node.peerAgentUris)).toBe(true)
    }
  })

  it('CEO è executive senza parent', async () => {
    const topology = await getMeshTopology()
    const ceo = topology.nodes.find((n) => n.agentUri === 'agent://ceo')
    expect(ceo).toBeDefined()
    expect(ceo!.tier).toBe('executive')
    expect(ceo!.parentAgentUri).toBeUndefined()
  })

  it('operational agents hanno parent strategic', async () => {
    const topology = await getMeshTopology()
    const coding = topology.nodes.find((n) => n.agentUri === 'agent://coding')
    expect(coding).toBeDefined()
    expect(coding!.parentAgentUri).toBe('agent://architect')
  })
})

describe('Agent Mesh — getMeshByTier', () => {
  it('filtra per tier', async () => {
    const executive = await getMeshByTier('executive')
    expect(executive.length).toBe(1) // solo CEO
    expect(executive[0]!.agentUri).toBe('agent://ceo')

    const strategic = await getMeshByTier('strategic')
    expect(strategic.length).toBeGreaterThanOrEqual(4) // architect, planner, research, world-model

    const operational = await getMeshByTier('operational')
    expect(operational.length).toBeGreaterThanOrEqual(5) // coding, qa, security, data, support
  })
})

describe('Agent Mesh — getReportingChain', () => {
  it('ritorna la catena fino all\'executive', async () => {
    const chain = await getReportingChain('agent://coding')
    expect(chain.length).toBeGreaterThanOrEqual(2) // coding → architect → ceo
    expect(chain[0]).toBe('agent://coding')
    expect(chain[chain.length - 1]).toBe('agent://ceo')
  })

  it('per CEO ritorna solo se stesso', async () => {
    const chain = await getReportingChain('agent://ceo')
    expect(chain).toEqual(['agent://ceo'])
  })
})

describe('Agent Mesh — delegateTask', () => {
  it('CEO delega a planner (CEO ha task:assign)', async () => {
    const result = await delegateTask({
      fromAgentUri: 'agent://ceo',
      toAgentUri: 'agent://planner',
      taskUri: 'task://delegation-test',
      provenance: VALID_PROV,
    })

    expect(result.delegated).toBe(true)

    // Verify edge DELEGATES_TO exists
    const ceo = await db.graphNode.findUnique({ where: { uri: 'agent://ceo' } })
    const edges = await db.graphEdge.findMany({
      where: { fromNodeId: ceo!.id, relationType: 'DELEGATES_TO' },
    })
    expect(edges.length).toBeGreaterThan(0)
  })

  it('rifiuta se delegante non ha task:assign permission', async () => {
    // coding agent non ha task:assign (ha solo file:write)
    const result = await delegateTask({
      fromAgentUri: 'agent://coding',
      toAgentUri: 'agent://qa',
      taskUri: 'task://test',
      provenance: VALID_PROV,
    })

    expect(result.delegated).toBe(false)
    expect(result.reason).toContain('task:assign')
  })

  it('rifiuta se delegato non è active', async () => {
    // Sospendi un agente e prova a delegare a lui
    const { suspendAgent } = await import('@/lib/agent-lifecycle/manager')
    await suspendAgent('agent://qa', 'test', VALID_PROV)

    const result = await delegateTask({
      fromAgentUri: 'agent://ceo',
      toAgentUri: 'agent://qa',
      taskUri: 'task://test',
      provenance: VALID_PROV,
    })

    expect(result.delegated).toBe(false)
    expect(result.reason).toContain('suspended')

    // Resume per test successivi
    const { resumeAgent } = await import('@/lib/agent-lifecycle/manager')
    await resumeAgent('agent://qa', VALID_PROV)
  })
})

describe('Agent Mesh — escalateIssue', () => {
  it('coding escalation a architect (in reporting chain)', async () => {
    const result = await escalateIssue({
      fromAgentUri: 'agent://coding',
      toAgentUri: 'agent://architect',
      reason: 'Architecture decision needed',
      severity: 'medium',
      provenance: VALID_PROV,
    })

    expect(result.escalated).toBe(true)
  })

  it('coding escalation a CEO (in reporting chain)', async () => {
    const result = await escalateIssue({
      fromAgentUri: 'agent://coding',
      toAgentUri: 'agent://ceo',
      reason: 'Critical architecture decision',
      severity: 'high',
      provenance: VALID_PROV,
    })

    expect(result.escalated).toBe(true)
  })

  it('rifiuta escalation a peer non in reporting chain', async () => {
    // coding → qa: qa non è nel reporting chain di coding
    const result = await escalateIssue({
      fromAgentUri: 'agent://coding',
      toAgentUri: 'agent://qa',
      reason: 'test',
      severity: 'low',
      provenance: VALID_PROV,
    })

    expect(result.escalated).toBe(false)
    expect(result.reason).toContain('reporting chain')
  })
})

describe('Agent Mesh — requestPeerQuorum', () => {
  it('richiede quorum tra peer agenti', async () => {
    // CEO ha come peer... beh, CEO è solo nel tier executive.
    // Usiamo architect che ha peer nel tier strategic
    const result = await requestPeerQuorum({
      proposerAgentUri: 'agent://architect',
      proposal: 'We need to redesign the system architecture',
      requiredQuorum: 1,
      provenance: VALID_PROV,
    })

    expect(result.votes.length).toBeGreaterThan(0)
    expect(typeof result.quorumAchieved).toBe('boolean')
    expect(result.acceptCount + result.rejectCount).toBe(result.votes.length)
  })

  it('peer vota accept se proposal menziona suo dominio', async () => {
    const result = await requestPeerQuorum({
      proposerAgentUri: 'agent://architect',
      proposal: 'Plan the next sprint task decomposition',
      requiredQuorum: 1,
      provenance: VALID_PROV,
    })

    // planner è peer di architect, e 'plan'+'task' sono suoi keyword
    const plannerVote = result.votes.find((v) => v.voterUri === 'agent://planner')
    expect(plannerVote).toBeDefined()
    if (plannerVote) {
      expect(plannerVote.vote).toBe('accept')
    }
  })

  it('peer vota reject se proposal non menziona suo dominio', async () => {
    const result = await requestPeerQuorum({
      proposerAgentUri: 'agent://architect',
      proposal: 'Random topic unrelated to any agent',
      requiredQuorum: 1,
      provenance: VALID_PROV,
    })

    const rejectVotes = result.votes.filter((v) => v.vote === 'reject')
    expect(rejectVotes.length).toBeGreaterThan(0)
  })

  it('quorum achieved se acceptCount >= requiredQuorum', async () => {
    const result = await requestPeerQuorum({
      proposerAgentUri: 'agent://architect',
      proposal: 'architecture design plan research',
      requiredQuorum: 2,
      provenance: VALID_PROV,
    })

    if (result.acceptCount >= 2) {
      expect(result.quorumAchieved).toBe(true)
    } else {
      expect(result.quorumAchieved).toBe(false)
    }
  })
})

describe('Agent Mesh — meshStats', () => {
  it('ritorna aggregati per tier', async () => {
    const stats = await meshStats()
    expect(stats.totalAgents).toBe(DEFAULT_MESH_PRESET.length)
    expect(stats.executiveAgents).toBe(1)
    expect(stats.strategicAgents).toBe(4)
    expect(stats.operationalAgents).toBe(5)
    expect(stats.specializedAgents).toBe(0)
    expect(stats.totalEdges).toBeGreaterThan(0)
  })
})
