/**
 * Tests for Skill Registry (Fase 2.5)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  registerSkill, getSkill, searchSkills, updateSkillLifecycle,
  versionSkill, listSkills, skillRegistryStats, seedDefaultSkills,
  codeAnalysisProvenanceSkill,
} from '@/lib/skill-registry/registry'
import { db } from '@/lib/db'

const VALID_PROV = codeAnalysisProvenanceSkill()

// Pulizia globale prima di tutti i test (i nodi persistono tra esecuzioni)
beforeAll(async () => {
  await db.graphEdge.deleteMany({})
  await db.graphNode.deleteMany({})
})

describe('Skill Registry — registerSkill', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({ where: { entityType: 'Skill' } })
  })

  it('registra una skill valida', async () => {
    const { uri, skill } = await registerSkill({
      name: 'test-skill',
      description: 'A test skill for unit testing the registry',
      promptTemplate: 'You are a test assistant. Task: {{task}}',
      version: '1.0.0',
      tags: ['test', 'unit-test'],
      examples: [{ input: 'task1', output: 'result1' }],
      tests: [{ name: 'basic', input: 'task', expectedContains: ['result'] }],
      provenance: VALID_PROV,
    })

    expect(uri).toMatch(/^skill:\/\/test-skill@1\.0\.0$/)
    expect(skill.name).toBe('test-skill')
    expect(skill.lifecycleState).toBe('draft')
    expect(skill.version).toBe('1.0.0')
  })

  it('rifiuta name troppo corto (<3 chars)', async () => {
    await expect(
      registerSkill({
        name: 'ab',
        description: 'valid description here',
        promptTemplate: 'prompt template long enough',
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/name must be at least 3 characters/)
  })

  it('rifiuta description troppo corta (<10 chars)', async () => {
    await expect(
      registerSkill({
        name: 'valid-name',
        description: 'short',
        promptTemplate: 'prompt template long enough',
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/description must be at least 10 characters/)
  })

  it('rifiuta prompt template troppo corto', async () => {
    await expect(
      registerSkill({
        name: 'valid-name',
        description: 'valid description here',
        promptTemplate: 'short',
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/Prompt template must be at least 20 characters/)
  })

  it('rifiuta test senza expectedOutput/expectedContains/assertFn', async () => {
    await expect(
      registerSkill({
        name: 'bad-tests',
        description: 'valid description here',
        promptTemplate: 'prompt template long enough',
        tests: [{ name: 'empty-test', input: 'x' }],
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/must have expectedOutput, expectedContains, or assertFn/)
  })

  it('rifiuta skill duplicata (same name/identifier)', async () => {
    await registerSkill({
      name: 'duplicate-skill',
      description: 'first registration here',
      promptTemplate: 'prompt template long enough',
      provenance: VALID_PROV,
    })

    await expect(
      registerSkill({
        name: 'duplicate-skill',
        description: 'second registration here',
        promptTemplate: 'prompt template long enough',
        provenance: VALID_PROV,
      }),
    ).rejects.toThrow(/already exists/)
  })

  it('rifiuta provenance non valida', async () => {
    await expect(
      registerSkill({
        name: 'bad-prov',
        description: 'valid description here',
        promptTemplate: 'prompt template long enough',
        provenance: { } as any,
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })
})

describe('Skill Registry — getSkill', () => {
  it('recupera una skill per URI', async () => {
    const { uri } = await registerSkill({
      name: 'get-test-skill',
      description: 'Another test skill for getSkill test',
      promptTemplate: 'You are a test assistant. Task: {{task}}',
      tags: ['get-test'],
      provenance: VALID_PROV,
    })

    const skill = await getSkill(uri)
    expect(skill).not.toBeNull()
    expect(skill!.name).toBe('get-test-skill')
    expect(skill!.tags).toEqual(['get-test'])
  })

  it('ritorna null per URI inesistente', async () => {
    const skill = await getSkill('skill://nonexistent')
    expect(skill).toBeNull()
  })

  it('ritorna null per URI di tipo non Skill', async () => {
    // Crea un nodo Document con identifier univoco e verifica che getSkill ritorni null
    const { createNode } = await import('@/lib/graph-age')
    await createNode({
      type: 'Document',
      identifier: 'not-a-skill-unique-12345',
      attributes: { title: 'not a skill', source: 'test', mimeType: 'text/plain' },
      provenance: VALID_PROV,
    })

    const skill = await getSkill('document://not-a-skill-unique-12345')
    expect(skill).toBeNull()
  })
})

describe('Skill Registry — searchSkills', () => {
  beforeAll(async () => {
    // Aggiungi qualche skill per la ricerca
    await registerSkill({
      name: 'code-reviewer',
      description: 'Reviews code for bugs and best practices',
      promptTemplate: 'You are a code reviewer. Review: {{code}}',
      tags: ['code', 'review'],
      provenance: VALID_PROV,
    })
    await registerSkill({
      name: 'task-planner',
      description: 'Plans and decomposes tasks into subtasks',
      promptTemplate: 'You are a task planner. Plan: {{goal}}',
      tags: ['planning', 'task'],
      provenance: VALID_PROV,
    })
  })

  it('trova skill per keyword nel name', async () => {
    const results = await searchSkills('code')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.name === 'code-reviewer')).toBe(true)
  })

  it('trova skill per keyword nella description', async () => {
    const results = await searchSkills('bugs')
    expect(results.some((r) => r.name === 'code-reviewer')).toBe(true)
  })

  it('trova skill per tag', async () => {
    const results = await searchSkills('planning')
    expect(results.some((r) => r.name === 'task-planner')).toBe(true)
  })

  it('filtra per tag espliciti', async () => {
    const results = await searchSkills('', { tags: ['review'] })
    expect(results.every((r) => r.name.includes('review') || r.name.includes('code'))).toBe(true)
  })

  it('ordina per score decrescente', async () => {
    const results = await searchSkills('code review')
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score)
    }
  })

  it('matchedOn è popolato correttamente', async () => {
    const results = await searchSkills('code')
    const top = results[0]!
    expect(top.matchedOn.length).toBeGreaterThan(0)
    expect(['name', 'description', 'tags']).toContain(top.matchedOn[0])
  })
})

describe('Skill Registry — lifecycle', () => {
  it('updateSkillLifecycle draft → active', async () => {
    const { uri } = await registerSkill({
      name: 'lifecycle-test',
      description: 'Test skill for lifecycle transitions',
      promptTemplate: 'You are a test assistant.',
      provenance: VALID_PROV,
    })

    await updateSkillLifecycle(uri, 'active', 'agent://test', 'activation test')

    const skill = await getSkill(uri)
    expect(skill!.lifecycleState).toBe('active')
  })

  it('updateSkillLifecycle rifiusta transizione non valida', async () => {
    const { uri } = await registerSkill({
      name: 'bad-lifecycle',
      description: 'Test skill for invalid transition',
      promptTemplate: 'You are a test assistant.',
      provenance: VALID_PROV,
    })

    // draft → archived non è valida (vedi LIFECYCLE_TRANSITIONS)
    await expect(
      updateSkillLifecycle(uri, 'archived', 'agent://test'),
    ).rejects.toThrow(/Transition.*not allowed/)
  })
})

describe('Skill Registry — versionSkill', () => {
  it('crea nuova versione e depreca la vecchia', async () => {
    const { uri: v1Uri } = await registerSkill({
      name: 'versioned-skill',
      description: 'A skill that will be versioned',
      promptTemplate: 'You are v1. Task: {{task}}',
      version: '1.0.0',
      provenance: VALID_PROV,
    })

    const { uri: v2Uri, skill: v2 } = await versionSkill({
      sourceUri: v1Uri,
      newVersion: '2.0.0',
      updates: {
        promptTemplate: 'You are v2. Task: {{task}}',
      },
      provenance: VALID_PROV,
    })

    expect(v2.version).toBe('2.0.0')
    expect(v2Uri).not.toBe(v1Uri)

    // V1 deve essere deprecated
    const v1 = await getSkill(v1Uri)
    expect(v1!.lifecycleState).toBe('deprecated')

    // V2 deve essere draft
    expect(v2.lifecycleState).toBe('draft')
  })
})

describe('Skill Registry — listSkills + stats', () => {
  it('listSkills ritorna tutte le skill', async () => {
    const skills = await listSkills()
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.every((s) => s.entityType !== undefined || s.name !== undefined)).toBe(true)
  })

  it('listSkills filtra per lifecycleState', async () => {
    const active = await listSkills({ lifecycleState: 'active' })
    expect(active.every((s) => s.lifecycleState === 'active')).toBe(true)
  })

  it('skillRegistryStats ritorna aggregati', async () => {
    const stats = await skillRegistryStats()
    expect(stats.total).toBeGreaterThan(0)
    expect(typeof stats.byLifecycleState).toBe('object')
    expect(Array.isArray(stats.topTags)).toBe(true)
  })
})

describe('Skill Registry — seedDefaultSkills', () => {
  it('inserisce le skill di default (idempotente)', async () => {
    const first = await seedDefaultSkills()
    expect(first.created + first.skipped).toBeGreaterThan(0)

    // Second run: tutte skipped
    const second = await seedDefaultSkills()
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(first.created + first.skipped)
  })
})
