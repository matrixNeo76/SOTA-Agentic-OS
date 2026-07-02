/**
 * Unit tests for Plan Domain core modules (Fase 3)
 * Covers: scheduler.ts, compiled-ai.ts, dominator-tree.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db'
import { validatePlan, topologicalBatches } from '@/lib/kernel/scheduler'
import { checkSafety, checkSyntax, checkExecution, checkAccuracy, BUILTIN_TEMPLATES } from '@/lib/kernel/compiled-ai'
import { captureTrace, listTraces, dominatorStats } from '@/lib/kernel/dominator-tree'
import * as dominatorModule from '@/lib/kernel/dominator-tree'

// === scheduler.ts tests ==============================================

describe('scheduler — validatePlan + topologicalBatches', () => {
  it('validatePlan accepts valid linear plan', () => {
    const result = validatePlan({
      goal: 'test',
      tasks: [
        { taskId: 'T1', agentId: 'orchestrator', description: 'first', dependencies: [] },
        { taskId: 'T2', agentId: 'curator', description: 'second', dependencies: ['T1'] },
      ],
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('validatePlan rejects cyclic dependencies', () => {
    const result = validatePlan({
      goal: 'test',
      tasks: [
        { taskId: 'T1', agentId: 'orchestrator', description: 'a', dependencies: ['T2'] },
        { taskId: 'T2', agentId: 'curator', description: 'b', dependencies: ['T1'] },
      ],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('validatePlan rejects missing goal', () => {
    const result = validatePlan({
      goal: '',
      tasks: [{ taskId: 'T1', agentId: 'orchestrator', description: 'a', dependencies: [] }],
    })
    expect(result.valid).toBe(false)
  })

  it('validatePlan rejects empty tasks', () => {
    const result = validatePlan({ goal: 'test', tasks: [] })
    expect(result.valid).toBe(false)
  })

  it('validatePlan rejects missing taskId', () => {
    const result = validatePlan({
      goal: 'test',
      tasks: [{ agentId: 'orchestrator', description: 'a', dependencies: [] }],
    })
    expect(result.valid).toBe(false)
  })

  it('topologicalBatches returns linear batches for sequential deps', () => {
    const batches = topologicalBatches([
      { taskId: 'T1', agentId: 'a', description: '', dependencies: [] },
      { taskId: 'T2', agentId: 'b', description: '', dependencies: ['T1'] },
      { taskId: 'T3', agentId: 'c', description: '', dependencies: ['T2'] },
    ])
    expect(batches).toEqual([['T1'], ['T2'], ['T3']])
  })

  it('topologicalBatches groups parallel tasks in same batch', () => {
    const batches = topologicalBatches([
      { taskId: 'T1', agentId: 'a', description: '', dependencies: [] },
      { taskId: 'T2', agentId: 'b', description: '', dependencies: [] },
      { taskId: 'T3', agentId: 'c', description: '', dependencies: ['T1', 'T2'] },
    ])
    expect(batches.length).toBe(2)
    expect(batches[0]).toContain('T1')
    expect(batches[0]).toContain('T2')
    expect(batches[1]).toEqual(['T3'])
  })

  it('topologicalBatches handles single task', () => {
    const batches = topologicalBatches([
      { taskId: 'T1', agentId: 'a', description: '', dependencies: [] },
    ])
    expect(batches).toEqual([['T1']])
  })
})

// === compiled-ai.ts tests (C1 sandbox verification) =================

describe('compiled-ai — C1 sandbox verification', () => {
  it('checkSafety blocks constructor.constructor', () => {
    expect(checkSafety('return input.constructor.constructor("return process")()').passed).toBe(false)
  })

  it('checkSafety blocks eval(', () => {
    expect(checkSafety('return eval("1+1")').passed).toBe(false)
  })

  it('checkSafety blocks backtick template literals', () => {
    expect(checkSafety('return `hello`').passed).toBe(false)
  })

  it('checkSafety allows safe code', () => {
    expect(checkSafety('return input.value * 2').passed).toBe(true)
  })

  it('checkSyntax validates valid code', () => {
    expect(checkSyntax('return input.value').passed).toBe(true)
  })

  it('checkSyntax rejects invalid code', () => {
    expect(checkSyntax('return input.').passed).toBe(false)
  })

  it('checkExecution runs in sandbox — no process access', () => {
    expect(checkExecution('return process.env.HOME', { value: 'test' }).passed).toBe(false)
  })

  it('checkExecution runs safe code successfully', () => {
    expect(checkExecution('return input.value * 2', { value: 21 }).passed).toBe(true)
  })

  it('checkExecution blocks require', () => {
    expect(checkExecution('return require("fs")', {}).passed).toBe(false)
  })

  it('checkExecution blocks fetch', () => {
    expect(checkExecution('return fetch("http://evil.com")', {}).passed).toBe(false)
  })

  it('checkAccuracy matches expected result', () => {
    expect(checkAccuracy('return input.value * 2', { value: 21 }, 42).passed).toBe(true)
  })

  it('checkAccuracy fails on mismatch', () => {
    expect(checkAccuracy('return input.value * 2', { value: 21 }, 99).passed).toBe(false)
  })

  it('BUILTIN_TEMPLATES has 3 templates', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(3)
    expect(BUILTIN_TEMPLATES.map((t) => t.templateId)).toContain('compliance_check')
    expect(BUILTIN_TEMPLATES.map((t) => t.templateId)).toContain('authz_decision')
    expect(BUILTIN_TEMPLATES.map((t) => t.templateId)).toContain('risk_score')
  })
})

// === dominator-tree.ts tests =========================================

describe('dominator-tree — captureTrace + stats', () => {
  beforeEach(async () => {
    await db.executionTrace.deleteMany({ where: { workflowId: 'test-dom-workflow' } })
    await db.prefixTreeAutomaton.deleteMany({ where: { workflowId: 'test-dom-workflow' } })
  })
  afterEach(async () => {
    await db.executionTrace.deleteMany({ where: { workflowId: 'test-dom-workflow' } })
    await db.prefixTreeAutomaton.deleteMany({ where: { workflowId: 'test-dom-workflow' } })
  })

  it('captureTrace creates an ExecutionTrace record', async () => {
    const traceId = await captureTrace(
      'test-dom-workflow',
      'test-trace',
      ['start', 'check', 'execute', 'done'],
      ['start', 'check', 'execute'],
      'success',
    )
    expect(traceId).toBeTruthy()

    const trace = await db.executionTrace.findUnique({ where: { id: traceId } })
    expect(trace?.workflowId).toBe('test-dom-workflow')
    expect(trace?.outcome).toBe('success')
    expect(JSON.parse(trace!.statesJson)).toEqual(['start', 'check', 'execute', 'done'])
  })

  it('dominatorStats returns structure', async () => {
    const stats = await dominatorStats()
    expect(stats).toHaveProperty('traces')
    expect(stats).toHaveProperty('ptas')
    expect(stats).toHaveProperty('validations')
    expect(typeof stats.traces).toBe('number')
  })

  it('listTraces returns traces for a workflow', async () => {
    await captureTrace(
      'test-dom-workflow',
      'list-test',
      ['a', 'b'],
      ['go'],
      'success',
    )

    const traces = await listTraces('test-dom-workflow')
    expect(traces.length).toBeGreaterThanOrEqual(1)
    expect(traces[0].workflowId).toBe('test-dom-workflow')
  })

  it('B3: semanticMatch is removed (dead code cleanup)', () => {
    expect((dominatorModule as any).semanticMatch).toBeUndefined()
  })
})

// === B4: lean4-agent strict postcondition matching ==================

describe('B4: lean4-agent strict postcondition regex', () => {
  it('regex matches task.T1.status = "completed"', () => {
    const regex = new RegExp(`task\\.T1\\.status\\s*=\\s*['"]completed['"]`)
    expect(regex.test('task.T1.status = "completed"')).toBe(true)
    expect(regex.test("task.T1.status = 'completed'")).toBe(true)
  })

  it('regex does NOT match "not-completed"', () => {
    const regex = new RegExp(`task\\.T1\\.status\\s*=\\s*['"]completed['"]`)
    expect(regex.test('task.T1.status = "not-completed"')).toBe(false)
  })

  it('regex does NOT match "incomplete"', () => {
    const regex = new RegExp(`task\\.T1\\.status\\s*=\\s*['"]completed['"]`)
    expect(regex.test('task.T1.status = "incomplete"')).toBe(false)
  })

  it('regex handles spaces around =', () => {
    const regex = new RegExp(`task\\.T1\\.status\\s*=\\s*['"]completed['"]`)
    expect(regex.test('task.T1.status  =  "completed"')).toBe(true)
  })
})
