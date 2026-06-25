/**
 * Tests for Skill Sandbox (Fase 6.2)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  executeSkillInSandbox, sandboxStats, DEFAULT_SANDBOX_CONFIG,
  sandboxProvenance,
} from '@/lib/skill-sandbox/sandbox'
import { db } from '@/lib/db'
import type { GeneratedSkill } from '@/lib/skill-synthesis/pipeline'

const VALID_PROV = sandboxProvenance()

const TEST_SKILL: GeneratedSkill = {
  id: 'test-skill-1',
  gapId: 'gap-1',
  name: 'test-skill',
  description: 'A test skill for sandbox validation',
  promptTemplate: `You are a specialized skill for handling test scenarios.

When you encounter the pattern, apply the following approach:

1. Identify the root cause
2. Apply the corrective action
3. Verify the result

Task to handle:
{{task}}`,
  tools: [],
  examples: [],
  tests: [
    {
      name: 'test-with-expected-contains',
      input: 'Handle task with pattern',
      expectedContains: ['root cause', 'corrective', 'verify'],
    },
    {
      name: 'test-with-assert-fn',
      input: 'Process the task thoroughly',
      expectedContains: [],
      assertFn: 'output.length > 50',
    },
    {
      name: 'test-simple',
      input: 'Simple task',
    },
  ],
  generatedBy: 'agent://test',
  generatedAt: new Date().toISOString(),
  status: 'generated',
}

describe('Skill Sandbox — executeSkillInSandbox', () => {
  beforeAll(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'skill-synthesis', event: 'sandbox-execution' } })
  })

  it('esegue una skill e ritorna risultati dettagliati', async () => {
    const result = await executeSkillInSandbox({
      skill: TEST_SKILL,
      provenance: VALID_PROV,
    })

    expect(result.id).toMatch(/^sandbox-/)
    expect(result.skillId).toBe(TEST_SKILL.id)
    expect(result.testResults.length).toBe(TEST_SKILL.tests.length)
    expect(typeof result.success).toBe('boolean')
    expect(typeof result.errorRate).toBe('number')
    expect(typeof result.avgLatencyMs).toBe('number')
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.iterations).toBe(TEST_SKILL.tests.length)
  })

  it('rispetta maxIterations limit', async () => {
    const skillWithManyTests: GeneratedSkill = {
      ...TEST_SKILL,
      tests: Array.from({ length: 10 }, (_, i) => ({
        name: `test-${i}`,
        input: `input-${i}`,
      })),
    }

    const result = await executeSkillInSandbox({
      skill: skillWithManyTests,
      config: { maxIterations: 3 },
      provenance: VALID_PROV,
    })

    expect(result.iterations).toBe(4) // 3 + 1 that triggers the limit
    expect(result.violations.some((v) => v.includes('Max iterations'))).toBe(true)
  })

  it('rileva forbidden patterns nel prompt', async () => {
    const skillWithForbidden: GeneratedSkill = {
      ...TEST_SKILL,
      promptTemplate: `You are a test skill that requires child_process to execute commands.

Task: {{task}}`,
      tests: [{ name: 'test-forbidden', input: 'test' }],
    }

    const result = await executeSkillInSandbox({
      skill: skillWithForbidden,
      provenance: VALID_PROV,
    })

    // Forbidden patterns should be detected in violations
    expect(result.violations.length).toBeGreaterThan(0)
    const hasForbiddenViolation = result.violations.some((v) => v.includes('Forbidden pattern'))
    expect(hasForbiddenViolation).toBe(true)
  })

  it('verifica expectedContains nell\'output', async () => {
    const skillWithExpected: GeneratedSkill = {
      ...TEST_SKILL,
      tests: [{
        name: 'test-expected',
        input: 'Handle task with root cause corrective verify',
        expectedContains: ['root cause', 'corrective', 'verify'],
      }],
    }

    const result = await executeSkillInSandbox({
      skill: skillWithExpected,
      provenance: VALID_PROV,
    })

    // Il test dovrebbe passare perché il prompt contiene le keyword attese
    expect(result.testResults[0]!.success).toBe(true)
  })

  it('fallisce se expectedContains non matchano', async () => {
    const skillWithUnmatched: GeneratedSkill = {
      ...TEST_SKILL,
      promptTemplate: 'Short',
      tests: [{
        name: 'test-unmatched',
        input: 'unrelated content',
        expectedContains: ['nonexistent-keyword-12345'],
      }],
    }

    const result = await executeSkillInSandbox({
      skill: skillWithUnmatched,
      provenance: VALID_PROV,
    })

    expect(result.testResults[0]!.success).toBe(false)
  })

  it('rispetta maxExecutionMs timeout', async () => {
    const result = await executeSkillInSandbox({
      skill: TEST_SKILL,
      config: { maxExecutionMs: 1 }, // 1ms — should timeout
      provenance: VALID_PROV,
    })

    // Almeno un test dovrebbe avere timeout
    const timeouts = result.testResults.filter((r) => r.error?.includes('timeout'))
    expect(timeouts.length).toBeGreaterThan(0)
  })

  it('persiste audit trail in AgentLog', async () => {
    await executeSkillInSandbox({
      skill: TEST_SKILL,
      provenance: VALID_PROV,
    })

    const logs = await db.agentLog.findMany({
      where: { phase: 'skill-synthesis', event: 'sandbox-execution' },
      orderBy: { timestamp: 'desc' },
      take: 1,
    })

    expect(logs.length).toBeGreaterThan(0)
    const log = logs[0]!
    const payload = JSON.parse(log.payload)
    expect(payload.skillId).toBe(TEST_SKILL.id)
    expect(payload).toHaveProperty('success')
    expect(payload).toHaveProperty('errorRate')
  })
})

describe('Skill Sandbox — DEFAULT_SANDBOX_CONFIG', () => {
  it('ha forbidden patterns per sicurezza', () => {
    expect(DEFAULT_SANDBOX_CONFIG.forbiddenPatterns.length).toBeGreaterThan(0)
    expect(DEFAULT_SANDBOX_CONFIG.forbiddenPatterns.some((p) => p.test('require("child_process")'))).toBe(true)
    expect(DEFAULT_SANDBOX_CONFIG.forbiddenPatterns.some((p) => p.test('process.exit(1)'))).toBe(true)
    expect(DEFAULT_SANDBOX_CONFIG.forbiddenPatterns.some((p) => p.test('eval("code")'))).toBe(true)
  })

  it('ha limiti ragionevoli di default', () => {
    expect(DEFAULT_SANDBOX_CONFIG.maxExecutionMs).toBeGreaterThan(100)
    expect(DEFAULT_SANDBOX_CONFIG.maxOutputBytes).toBeGreaterThan(1000)
    expect(DEFAULT_SANDBOX_CONFIG.maxIterations).toBeGreaterThan(1)
  })
})

describe('Skill Sandbox — sandboxStats', () => {
  it('ritorna aggregati delle esecuzioni', async () => {
    const stats = await sandboxStats()
    expect(stats).toHaveProperty('totalExecutions')
    expect(stats).toHaveProperty('successful')
    expect(stats).toHaveProperty('failed')
    expect(stats).toHaveProperty('successRate')
    expect(typeof stats.successRate).toBe('number')
  })
})
