/**
 * Tests for Skill Synthesis + Meta Agent Compiler (Fase 3.5)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  detectSkillGaps, generateSkillForGap, testSkillInSandbox,
  validateSkill, runSynthesisPipeline, synthesisStats,
  synthesisProvenance,
  type SkillGap, type GeneratedSkill,
} from '@/lib/skill-synthesis/pipeline'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = synthesisProvenance()

// Crea un gap di test predefinito
const TEST_GAP: SkillGap = {
  id: 'gap-test-1',
  description: 'Recurring failure pattern: file write permission denied',
  evidence: [
    { taskUri: 'task://failed-1', failurePattern: 'file write permission denied', occurrences: 3 },
    { taskUri: 'task://failed-2', failurePattern: 'file write permission denied', occurrences: 2 },
  ],
  suggestedSkillName: 'skill-for-file-write',
  suggestedDomain: 'file write permission',
  detectedAt: new Date().toISOString(),
}

describe('Skill Synthesis — detectSkillGaps', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    await db.agentLog.deleteMany({ where: { event: 'TaskFailed' } })
    _resetEventMeshForTests()
  })

  it('ritorna gaps vuoto se nessun task fallito', async () => {
    const gaps = await detectSkillGaps({ minOccurrences: 1 })
    expect(gaps.length).toBe(0)
  })

  it('rileva gap quando pattern ricorrente senza skill', async () => {
    // Inietta 3 task falliti con stesso pattern
    for (let i = 0; i < 3; i++) {
      await db.agentLog.create({
        data: {
          agentId: 'agent://test',
          phase: 'test',
          event: 'TaskFailed',
          payload: JSON.stringify({
            taskUri: `task://failed-${i}`,
            error: 'file write permission denied to restricted path',
          }),
          level: 'error',
        },
      })
    }

    const gaps = await detectSkillGaps({ minOccurrences: 3, daysWindow: 1 })
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0]!.evidence.length).toBeGreaterThanOrEqual(3)
    expect(gaps[0]!.suggestedSkillName).toContain('skill-for-')
  })
})

describe('Skill Synthesis — generateSkillForGap', () => {
  it('genera una skill con prompt template, examples, tests', async () => {
    const generated = await generateSkillForGap({
      gap: TEST_GAP,
      provenance: VALID_PROV,
    })

    expect(generated.id).toMatch(/^gen-skill-/)
    expect(generated.name).toBe('skill-for-file-write')
    expect(generated.promptTemplate).toContain('file write permission')
    expect(generated.examples.length).toBeGreaterThan(0)
    expect(generated.tests.length).toBeGreaterThan(0)
    expect(generated.status).toBe('generated')
  })

  it('prompt template contiene {{task}} placeholder', async () => {
    const generated = await generateSkillForGap({
      gap: TEST_GAP,
      provenance: VALID_PROV,
    })

    expect(generated.promptTemplate).toContain('{{task}}')
  })

  it('tests coprono expectedContains e assertFn', async () => {
    const generated = await generateSkillForGap({
      gap: TEST_GAP,
      provenance: VALID_PROV,
    })

    const hasExpectedContains = generated.tests.some((t) => t.expectedContains && t.expectedContains.length > 0)
    const hasAssertFn = generated.tests.some((t) => t.assertFn)
    expect(hasExpectedContains).toBe(true)
    expect(hasAssertFn).toBe(true)
  })

  it('persiste il nodo Document per tracking', async () => {
    const generated = await generateSkillForGap({
      gap: TEST_GAP,
      provenance: VALID_PROV,
    })

    // Cerca per source + title pattern (SQLite non supporta query su JSON contains)
    const nodes = await db.graphNode.findMany({
      where: { entityType: 'Document' },
    })
    const found = nodes.find((n) => {
      try {
        const attrs = JSON.parse(n.attributes) as Record<string, unknown>
        return attrs.source === 'skill-synthesis' && attrs.title === `Generated Skill: ${TEST_GAP.suggestedSkillName}`
      } catch {
        return false
      }
    })
    expect(found).toBeDefined()
  })

  it('rifiuta provenance non valida', async () => {
    await expect(
      generateSkillForGap({
        gap: TEST_GAP,
        provenance: {} as any,
      }),
    ).rejects.toThrow(/Invalid provenance/)
  })
})

describe('Skill Synthesis — testSkillInSandbox', () => {
  it('esegue i test e ritorna risultati', async () => {
    const generated = await generateSkillForGap({
      gap: TEST_GAP,
      provenance: VALID_PROV,
    })

    const result = await testSkillInSandbox({
      skill: generated,
      provenance: VALID_PROV,
    })

    expect(result.skillId).toBe(generated.id)
    expect(result.taskResults.length).toBe(generated.tests.length)
    expect(typeof result.errorRate).toBe('number')
    expect(typeof result.avgLatencyMs).toBe('number')
    expect(Array.isArray(result.anomalies)).toBe(true)
  })

  it('errorRate = 0 se tutti i test passano', async () => {
    // Genera skill con test che sicuramente passano nel template
    const generated: GeneratedSkill = {
      id: 'test-perfect',
      gapId: 'gap-1',
      name: 'perfect-skill',
      description: 'Perfect skill',
      promptTemplate: 'You handle root cause corrective verify the task: {{task}}',
      tools: [],
      examples: [],
      tests: [
        {
          name: 'test-1',
          input: 'task1',
          expectedContains: ['root cause', 'corrective', 'verify'],
        },
      ],
      generatedBy: 'agent://test',
      generatedAt: new Date().toISOString(),
      status: 'generated',
    }

    const result = await testSkillInSandbox({ skill: generated, provenance: VALID_PROV })
    expect(result.errorRate).toBe(0)
    expect(result.success).toBe(true)
  })

  it('rileva anomaly se prompt template troppo corto', async () => {
    const generated: GeneratedSkill = {
      id: 'test-short-template',
      gapId: 'gap-1',
      name: 'short-skill',
      description: 'Short skill',
      promptTemplate: 'OK',
      tools: [],
      examples: [],
      tests: [],
      generatedBy: 'agent://test',
      generatedAt: new Date().toISOString(),
      status: 'generated',
    }

    const result = await testSkillInSandbox({ skill: generated, provenance: VALID_PROV })
    expect(result.anomalies.some((a) => a.includes('too short'))).toBe(true)
  })
})

describe('Skill Synthesis — validateSkill', () => {
  it('crea benchmark e ritorna evaluation score', async () => {
    const generated = await generateSkillForGap({
      gap: TEST_GAP,
      provenance: VALID_PROV,
    })
    const sandbox = await testSkillInSandbox({
      skill: generated,
      provenance: VALID_PROV,
    })

    const validation = await validateSkill({
      skill: generated,
      sandbox,
      provenance: VALID_PROV,
    })

    expect(validation.evaluationUri).toMatch(/^evaluation:\/\//)
    expect(typeof validation.overallScore).toBe('number')
    expect(['pass', 'fail', 'partial']).toContain(validation.verdict)
  })
})

describe('Skill Synthesis — runSynthesisPipeline', () => {
  it('pipeline completa con gap fornito manualmente', async () => {
    const pipelines = await runSynthesisPipeline({
      gap: TEST_GAP,
      provenance: VALID_PROV,
      autoApprove: true, // solo per test
    })

    expect(pipelines.length).toBe(1)
    const pipeline = pipelines[0]!
    expect(pipeline.gap.id).toBe(TEST_GAP.id)
    expect(pipeline.generated.name).toBe(TEST_GAP.suggestedSkillName)
    expect(pipeline.sandbox).toBeDefined()
    expect(pipeline.validation).toBeDefined

    if (pipeline.validation && pipeline.validation.verdict === 'pass') {
      expect(pipeline.finalStatus).toBe('approved')
      expect(pipeline.skillUri).toMatch(/^skill:\/\//)
    }
  })

  it('senza autoApprove, finalStatus è pending_approval', async () => {
    const pipelines = await runSynthesisPipeline({
      gap: { ...TEST_GAP, id: 'gap-no-auto-approve' },
      provenance: VALID_PROV,
      autoApprove: false,
    })

    expect(pipelines.length).toBe(1)
    const pipeline = pipelines[0]!

    // Se validation è pass, finalStatus deve essere pending_approval (no auto-approve)
    if (pipeline.validation && pipeline.validation.verdict === 'pass') {
      expect(pipeline.finalStatus).toBe('pending_approval')
      expect(pipeline.skillUri).toBeUndefined()
    }
  })

  it('detect automatico ritorna gaps e li processa', async () => {
    // Verifica che la pipeline funzioni senza gap fornito
    const pipelines = await runSynthesisPipeline({
      provenance: VALID_PROV,
      autoApprove: true,
    })

    // Se ci sono gaps (dai test precedenti), dovrebbero essere processati
    expect(Array.isArray(pipelines)).toBe(true)
  })
})

describe('Skill Synthesis — synthesisStats', () => {
  it('ritorna aggregati', async () => {
    const stats = await synthesisStats()
    expect(stats).toHaveProperty('totalGenerated')
    expect(stats).toHaveProperty('approved')
    expect(stats).toHaveProperty('rejected')
    expect(stats).toHaveProperty('pendingApproval')
    expect(stats.totalGenerated).toBeGreaterThanOrEqual(0)
  })
})
