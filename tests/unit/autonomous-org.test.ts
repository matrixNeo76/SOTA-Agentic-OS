/**
 * Tests for Autonomous Organization Layer (Fase 3.6)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createProposal, approveProposal, rejectProposal,
  generateAutoProposals, getProposal, listPendingProposals,
  autonomousOrgStats, autonomousOrgProvenance,
  type ProposalType,
} from '@/lib/autonomous-org/governor'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = autonomousOrgProvenance()

describe('Autonomous Org — createProposal', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    _resetEventMeshForTests()
  })

  it('crea una proposal pending', async () => {
    const { uri, proposal } = await createProposal({
      type: 'create_agent',
      description: 'Create a new coding agent for backend',
      rationale: 'Backend development needs more capacity',
      expectedImpact: {
        costDelta: 10,
        performanceDelta: 0.3,
        riskLevel: 'low',
      },
      payload: {
        name: 'backend-coder',
        description: 'Backend coding agent',
        tier: 'operational',
        roles: [{ name: 'coder', permissions: ['file:write:src/*'] }],
        capabilities: [{ name: 'coding' }],
        rationale: 'For backend',
      },
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^decision:\/\//)
    expect(proposal.type).toBe('create_agent')
    expect(proposal.status).toBe('pending')
    expect(proposal.proposedBy).toBe('agent://autonomous-org')
  })

  it('rifiuta description < 10 caratteri', async () => {
    await expect(
      createProposal({
        type: 'create_skill',
        description: 'short',
        rationale: 'test',
        expectedImpact: { costDelta: 0, performanceDelta: 0, riskLevel: 'low' },
        payload: {},
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/description must be at least 10 characters/)
  })

  it('rifiuta provenance non valida', async () => {
    await expect(
      createProposal({
        type: 'create_skill',
        description: 'valid description',
        rationale: 'test',
        expectedImpact: { costDelta: 0, performanceDelta: 0, riskLevel: 'low' },
        payload: {},
        provenance: {} as any,
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('imposta expiresAt se expiresInHours fornito', async () => {
    const { proposal } = await createProposal({
      type: 'optimize_process',
      description: 'Optimize the deployment process',
      rationale: 'test',
      expectedImpact: { costDelta: -10, performanceDelta: 0.1, riskLevel: 'low' },
      payload: {},
      provenance: VALID_PROV,
      expiresInHours: 24,
    })

    expect(proposal.expiresAt).toBeTruthy()
    const expiry = new Date(proposal.expiresAt!).getTime()
    expect(expiry).toBeGreaterThan(Date.now())
  })
})

describe('Autonomous Org — getProposal + listPendingProposals', () => {
  it('getProposal recupera per URI', async () => {
    const { uri } = await createProposal({
      type: 'create_workflow',
      description: 'Create a CI/CD workflow',
      rationale: 'Automate deployment',
      expectedImpact: { costDelta: -20, performanceDelta: 0.4, riskLevel: 'medium' },
      payload: { name: 'cicd', goal: 'auto-deploy', steps: [] },
      provenance: VALID_PROV,
    })

    const proposal = await getProposal(uri)
    expect(proposal).not.toBeNull()
    expect(proposal!.type).toBe('create_workflow')
  })

  it('getProposal ritorna null per URI non proposal', async () => {
    const { createNode } = await import('@/lib/graph-age')
    const { uri } = await createNode({
      type: 'Document',
      identifier: 'not-a-proposal',
      attributes: { title: 'test', source: 'test', mimeType: 'text/plain' },
      provenance: VALID_PROV,
    })

    expect(await getProposal(uri)).toBeNull()
  })

  it('listPendingProposals ritorna solo pending', async () => {
    const pending = await listPendingProposals()
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((p) => p.status === 'pending')).toBe(true)
  })
})

describe('Autonomous Org — approveProposal (create_agent)', () => {
  it('approva ed esegue una proposal create_agent', async () => {
    const { uri } = await createProposal({
      type: 'create_agent',
      description: 'Create new backend coder agent',
      rationale: 'Need more coding capacity',
      expectedImpact: { costDelta: 10, performanceDelta: 0.3, riskLevel: 'low' },
      payload: {
        name: `test-coder-${Date.now()}`,
        description: 'Test coder agent',
        tier: 'operational',
        roles: [{ name: 'coder', permissions: ['file:write:src/*'] }],
        capabilities: [{ name: 'coding', description: 'Can code' }],
        rationale: 'Test',
      },
      provenance: VALID_PROV,
    })

    const result = await approveProposal({
      proposalUri: uri,
      approvedBy: 'user://admin',
      provenance: VALID_PROV,
    })

    expect(result.executed).toBe(true)
    expect(result.result!.success).toBe(true)
    expect(result.result!.artifacts.length).toBeGreaterThan(0)

    // Verify agent was created
    const proposal = await getProposal(uri)
    expect(proposal!.status).toBe('executed')
  })

  it('approva ed esegue una proposal reorganize_memory', async () => {
    const { uri } = await createProposal({
      type: 'reorganize_memory',
      description: 'Reorganize memory with selective consolidation',
      rationale: 'Memory growth needs consolidation',
      expectedImpact: { costDelta: -5, performanceDelta: 0.1, riskLevel: 'low' },
      payload: {
        consolidationStrategy: 'selective',
        archivalPolicy: 'gradual',
        rationale: 'Test',
      },
      provenance: VALID_PROV,
    })

    const result = await approveProposal({
      proposalUri: uri,
      approvedBy: 'user://admin',
      provenance: VALID_PROV,
    })

    expect(result.executed).toBe(true)
    expect(result.result!.success).toBe(true)
    expect(result.result!.artifacts.length).toBeGreaterThan(0)
  })

  it('rifiuta execution se proposal non è pending', async () => {
    const { uri } = await createProposal({
      type: 'create_skill',
      description: 'Test skill creation',
      rationale: 'test',
      expectedImpact: { costDelta: 0, performanceDelta: 0, riskLevel: 'low' },
      payload: { name: 'test-skill', description: 'test', promptTemplate: 'You are a test skill. Do: {{task}}' },
      provenance: VALID_PROV,
    })

    // Approve once
    await approveProposal({
      proposalUri: uri,
      approvedBy: 'user://admin',
      provenance: VALID_PROV,
    })

    // Try to approve again
    const second = await approveProposal({
      proposalUri: uri,
      approvedBy: 'user://admin',
      provenance: VALID_PROV,
    })

    expect(second.executed).toBe(false)
  })
})

describe('Autonomous Org — rejectProposal', () => {
  it('respinge una proposal', async () => {
    const { uri } = await createProposal({
      type: 'create_agent',
      description: 'Test agent to reject',
      rationale: 'test',
      expectedImpact: { costDelta: 0, performanceDelta: 0, riskLevel: 'low' },
      payload: { name: 'reject-me', description: 'test', tier: 'operational', roles: [], capabilities: [], rationale: 'test' },
      provenance: VALID_PROV,
    })

    await rejectProposal({
      proposalUri: uri,
      rejectedBy: 'user://admin',
      reason: 'Not needed',
      provenance: VALID_PROV,
    })

    const proposal = await getProposal(uri)
    expect(proposal!.status).toBe('rejected')
  })
})

describe('Autonomous Org — generateAutoProposals', () => {
  it('genera proposals basate su stato del sistema', async () => {
    const proposals = await generateAutoProposals({
      maxProposals: 3,
      provenance: VALID_PROV,
    })

    expect(Array.isArray(proposals)).toBe(true)
    expect(proposals.length).toBeLessThanOrEqual(3)

    for (const p of proposals) {
      expect(p.status).toBe('pending')
      expect(['create_agent', 'create_skill', 'create_workflow', 'optimize_process', 'reorganize_memory', 'upgrade_agent', 'learn_from_experience']).toContain(p.type)
    }
  })

  it('rispetta maxProposals', async () => {
    const proposals = await generateAutoProposals({
      maxProposals: 1,
      provenance: VALID_PROV,
    })
    expect(proposals.length).toBeLessThanOrEqual(1)
  })
})

describe('Autonomous Org — stats', () => {
  it('autonomousOrgStats ritorna aggregati', async () => {
    const stats = await autonomousOrgStats()
    expect(stats).toHaveProperty('totalProposals')
    expect(stats).toHaveProperty('pending')
    expect(stats).toHaveProperty('approved')
    expect(stats).toHaveProperty('rejected')
    expect(stats).toHaveProperty('executed')
    expect(stats).toHaveProperty('byType')
    expect(stats.totalProposals).toBeGreaterThan(0)
  })
})
