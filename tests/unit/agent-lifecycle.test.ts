/**
 * Tests for Agent Identity & Lifecycle (Fase 3.3)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  registerAgent, getAgent, upgradeAgentVersion, listAgentVersions,
  compareAgentVersions, suspendAgent, resumeAgent, deprecateAgent,
  checkPermission, agentLifecycleStats,
} from '@/lib/agent-lifecycle/manager'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

describe('Agent Lifecycle — registerAgent', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    _resetEventMeshForTests()
  })

  it('registra un agente con ruoli, capabilities, policies', async () => {
    const { uri, agent, versionUri } = await registerAgent({
      name: 'test-planner',
      description: 'A test planner agent',
      version: '1.0.0',
      roles: [{ name: 'planner', description: 'Plans tasks', permissions: ['task:create', 'task:assign'] }],
      capabilities: [{ name: 'planning', description: 'Can plan tasks' }],
      policies: [{ rules: { deny: ['tool:exec:rm'], allow: ['tool:exec:*'] }, enforcement: 'strict' }],
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^agent:\/\//)
    expect(agent.name).toBe('test-planner')
    expect(agent.lifecycleState).toBe('active')
    expect(agent.roles.length).toBeGreaterThan(0)
    expect(agent.capabilities.length).toBeGreaterThan(0)
    expect(agent.policies.length).toBeGreaterThan(0)
    expect(versionUri).toMatch(/^agent-version:\/\//)
  })

  it('rifiuta name < 2 caratteri', async () => {
    await expect(
      registerAgent({
        name: 'a',
        description: 'too short',
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/name must be at least 2 characters/)
  })

  it('rifiuta provenance non valida', async () => {
    await expect(
      registerAgent({
        name: 'bad-prov',
        description: 'invalid provenance',
        provenance: {} as any,
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })

  it('crea edge UPGRADED_TO tra agent e initial version', async () => {
    const { uri: agentUri, versionUri } = await registerAgent({
      name: 'edge-test-agent',
      description: 'For edge test',
      provenance: VALID_PROV,
    })

    const edges = await db.graphEdge.findMany({
      where: {
        relationType: 'UPGRADED_TO',
        fromNodeId: (await db.graphNode.findUnique({ where: { uri: agentUri } }))!.id,
      },
    })
    expect(edges.length).toBeGreaterThan(0)
    const toNode = await db.graphNode.findUnique({ where: { id: edges[0]!.toNodeId } })
    expect(toNode!.uri).toBe(versionUri)
  })
})

describe('Agent Lifecycle — getAgent', () => {
  it('recupera agente per URI', async () => {
    const { uri } = await registerAgent({
      name: 'get-test-agent',
      description: 'For getAgent test',
      provenance: VALID_PROV,
    })

    const agent = await getAgent(uri)
    expect(agent).not.toBeNull()
    expect(agent!.name).toBe('get-test-agent')
    expect(agent!.lifecycleState).toBe('active')
  })

  it('ritorna null per URI non Agent', async () => {
    const { createNode } = await import('@/lib/graph-age')
    const { uri } = await createNode({
      type: 'Document',
      identifier: 'not-an-agent',
      attributes: { title: 'test', source: 'test', mimeType: 'text/plain' },
      provenance: VALID_PROV,
    })

    expect(await getAgent(uri)).toBeNull()
  })
})

describe('Agent Lifecycle — upgradeAgentVersion', () => {
  it('crea nuova versione e depreca la vecchia', async () => {
    const { uri: agentUri, versionUri: oldVersionUri } = await registerAgent({
      name: 'upgrade-test-agent',
      description: 'For upgrade test',
      version: '1.0.0',
      provenance: VALID_PROV,
    })

    const { versionUri: newVersionUri, version } = await upgradeAgentVersion({
      agentUri,
      newVersion: '2.0.0',
      changes: 'Major refactor',
      evaluationScore: 0.85,
      provenance: VALID_PROV,
    })

    expect(version.version).toBe('2.0.0')
    expect(version.active).toBe(true)
    expect(version.upgradedFrom).toBe(oldVersionUri)
    expect(version.evaluationScore).toBe(0.85)

    // Verify Agent.version updated
    const agent = await getAgent(agentUri)
    expect(agent!.version).toBe('2.0.0')
    expect(agent!.currentVersionUri).toBe(newVersionUri)

    // Verify old version is deprecated
    const oldVersionNode = await db.graphNode.findUnique({ where: { uri: oldVersionUri } })
    expect(oldVersionNode!.lifecycleState).toBe('deprecated')
  })

  it('crea edge UPGRADED_FROM tra new e old version', async () => {
    const { uri: agentUri, versionUri: oldVersionUri } = await registerAgent({
      name: 'upgraded-from-test',
      description: 'For UPGRADED_FROM edge',
      provenance: VALID_PROV,
    })

    const { versionUri: newVersionUri } = await upgradeAgentVersion({
      agentUri,
      newVersion: '2.0.0',
      changes: 'test',
      provenance: VALID_PROV,
    })

    const edges = await db.graphEdge.findMany({
      where: {
        relationType: 'UPGRADED_FROM',
        fromNodeId: (await db.graphNode.findUnique({ where: { uri: newVersionUri } }))!.id,
      },
    })
    expect(edges.length).toBeGreaterThan(0)
    const toNode = await db.graphNode.findUnique({ where: { id: edges[0]!.toNodeId } })
    expect(toNode!.uri).toBe(oldVersionUri)
  })
})

describe('Agent Lifecycle — listAgentVersions', () => {
  it('lista tutte le versioni di un agente', async () => {
    const { uri: agentUri } = await registerAgent({
      name: 'list-versions-agent',
      description: 'For listAgentVersions',
      version: '1.0.0',
      provenance: VALID_PROV,
    })
    await upgradeAgentVersion({
      agentUri,
      newVersion: '2.0.0',
      changes: 'v2',
      provenance: VALID_PROV,
    })
    await upgradeAgentVersion({
      agentUri,
      newVersion: '3.0.0',
      changes: 'v3',
      provenance: VALID_PROV,
    })

    const versions = await listAgentVersions(agentUri)
    expect(versions.length).toBe(3) // v1, v2, v3
    // Ordinate per data desc (più recente prima)
    expect(versions[0]!.version).toBe('3.0.0')
  })
})

describe('Agent Lifecycle — compareAgentVersions', () => {
  it('raccomanda promote se evaluationScore migliora', async () => {
    const { uri: agentUri, versionUri: v1Uri } = await registerAgent({
      name: 'compare-promote-agent',
      description: 'For promote comparison',
      provenance: VALID_PROV,
    })

    const { versionUri: v2Uri } = await upgradeAgentVersion({
      agentUri,
      newVersion: '2.0.0',
      changes: 'better',
      evaluationScore: 0.95, // higher than v1's undefined
      provenance: VALID_PROV,
    })

    // Set evaluationScore for v1 manually
    const v1 = await db.graphNode.findUnique({ where: { uri: v1Uri } })
    const v1Attrs = JSON.parse(v1!.attributes)
    await db.graphNode.update({
      where: { uri: v1Uri },
      data: { attributes: JSON.stringify({ ...v1Attrs, evaluationScore: 0.7 }) },
    })

    const comparison = await compareAgentVersions({
      agentUri,
      fromVersionUri: v1Uri,
      toVersionUri: v2Uri,
    })

    expect(comparison.improvement).toBe(true)
    expect(comparison.delta).toBeGreaterThan(0)
    expect(comparison.recommendation).toBe('promote')
  })

  it('raccomanda rollback se evaluationScore peggiora', async () => {
    const { uri: agentUri, versionUri: v1Uri } = await registerAgent({
      name: 'compare-rollback-agent',
      description: 'For rollback comparison',
      provenance: VALID_PROV,
    })

    // Set v1 evaluationScore to high
    const v1 = await db.graphNode.findUnique({ where: { uri: v1Uri } })
    const v1Attrs = JSON.parse(v1!.attributes)
    await db.graphNode.update({
      where: { uri: v1Uri },
      data: { attributes: JSON.stringify({ ...v1Attrs, evaluationScore: 0.9 }) },
    })

    const { versionUri: v2Uri } = await upgradeAgentVersion({
      agentUri,
      newVersion: '2.0.0',
      changes: 'worse',
      evaluationScore: 0.5, // lower
      provenance: VALID_PROV,
    })

    const comparison = await compareAgentVersions({
      agentUri,
      fromVersionUri: v1Uri,
      toVersionUri: v2Uri,
    })

    expect(comparison.improvement).toBe(false)
    expect(comparison.delta).toBeLessThan(0)
    expect(comparison.recommendation).toBe('rollback')
  })
})

describe('Agent Lifecycle — suspend/resume/deprecate', () => {
  it('suspend imposta lifecycleState=suspended', async () => {
    const { uri } = await registerAgent({
      name: 'suspend-test',
      description: 'For suspend test',
      provenance: VALID_PROV,
    })

    await suspendAgent(uri, 'Maintenance', VALID_PROV)
    const agent = await getAgent(uri)
    expect(agent!.lifecycleState).toBe('suspended')
  })

  it('resume ripristina lifecycleState=active', async () => {
    const { uri } = await registerAgent({
      name: 'resume-test',
      description: 'For resume test',
      provenance: VALID_PROV,
    })
    await suspendAgent(uri, 'test', VALID_PROV)
    await resumeAgent(uri, VALID_PROV)
    const agent = await getAgent(uri)
    expect(agent!.lifecycleState).toBe('active')
  })

  it('deprecate imposta lifecycleState=deprecated', async () => {
    const { uri } = await registerAgent({
      name: 'deprecate-test',
      description: 'For deprecate test',
      provenance: VALID_PROV,
    })
    await deprecateAgent(uri, 'Replaced by new agent', VALID_PROV)
    const agent = await getAgent(uri)
    expect(agent!.lifecycleState).toBe('deprecated')
  })
})

describe('Agent Lifecycle — checkPermission', () => {
  it('allowed se permesso coperto da ruolo', async () => {
    const { uri } = await registerAgent({
      name: 'perm-role-test',
      description: 'For permission test',
      roles: [{ name: 'admin', permissions: ['*'] }],
      provenance: VALID_PROV,
    })

    const result = await checkPermission({ agentUri: uri, permission: 'tool:exec:anything' })
    expect(result.allowed).toBe(true)
    expect(result.matchedBy).toBe('role')
  })

  it('allowed se permesso coperto da policy allow', async () => {
    const { uri } = await registerAgent({
      name: 'perm-policy-allow',
      description: 'For policy allow test',
      policies: [{
        rules: { allow: ['tool:exec:safe-tool'], deny: [] },
        enforcement: 'strict',
      }],
      provenance: VALID_PROV,
    })

    const result = await checkPermission({ agentUri: uri, permission: 'tool:exec:safe-tool' })
    expect(result.allowed).toBe(true)
    expect(result.matchedBy).toBe('policy')
  })

  it('denied se permesso in policy deny strict', async () => {
    const { uri } = await registerAgent({
      name: 'perm-policy-deny',
      description: 'For policy deny test',
      policies: [{
        rules: { allow: [], deny: ['tool:exec:rm'] },
        enforcement: 'strict',
      }],
      provenance: VALID_PROV,
    })

    const result = await checkPermission({ agentUri: uri, permission: 'tool:exec:rm' })
    expect(result.allowed).toBe(false)
    expect(result.matchedBy).toBe('policy')
  })

  it('denied di default se nessun match', async () => {
    const { uri } = await registerAgent({
      name: 'perm-default-deny',
      description: 'For default deny test',
      provenance: VALID_PROV,
    })

    const result = await checkPermission({ agentUri: uri, permission: 'tool:exec:anything' })
    expect(result.allowed).toBe(false)
    expect(result.matchedBy).toBe('none')
  })

  it('denied se agente non è active', async () => {
    const { uri } = await registerAgent({
      name: 'perm-suspended',
      description: 'For suspended perm test',
      roles: [{ name: 'admin', permissions: ['*'] }],
      provenance: VALID_PROV,
    })
    await suspendAgent(uri, 'test', VALID_PROV)

    const result = await checkPermission({ agentUri: uri, permission: 'tool:exec:anything' })
    expect(result.allowed).toBe(false)
  })

  it('wildcard pattern funziona correttamente', async () => {
    const { uri } = await registerAgent({
      name: 'perm-wildcard',
      description: 'For wildcard test',
      roles: [{ name: 'ops', permissions: ['file:write:/tmp/*'] }],
      provenance: VALID_PROV,
    })

    const allowed = await checkPermission({ agentUri: uri, permission: 'file:write:/tmp/foo.txt' })
    expect(allowed.allowed).toBe(true)

    const denied = await checkPermission({ agentUri: uri, permission: 'file:write:/etc/passwd' })
    expect(denied.allowed).toBe(false)
  })
})

describe('Agent Lifecycle — stats', () => {
  it('agentLifecycleStats ritorna aggregati', async () => {
    const stats = await agentLifecycleStats()
    expect(stats.totalAgents).toBeGreaterThan(0)
    expect(typeof stats.byLifecycleState).toBe('object')
    expect(stats.totalVersions).toBeGreaterThan(0)
    expect(stats.totalRoles).toBeGreaterThan(0)
    expect(stats.totalPolicies).toBeGreaterThan(0)
  })
})
