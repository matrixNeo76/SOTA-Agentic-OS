/**
 * C4 isolation tests — worker_thread sandbox.
 *
 * Verifies that:
 *   1. A skill with a legitimate `execute` body runs and returns its value.
 *   2. `require('fs')` is blocked (no `require` global in the worker).
 *   3. `process.exit()` is undefined in the worker.
 *   4. `process.env` returns only the sandboxed env, not the host's.
 *   5. An infinite loop is killed by the hard wall-clock timeout.
 *   6. An unbounded allocation is killed by the V8 memory cap.
 *   7. Tool calls RPC back to the parent and respect the whitelist.
 *   8. Console output is captured, not printed to the host stdout.
 *   9. The full executeSkillInSandbox flow works end-to-end with execute.
 *
 * These tests spawn real worker_threads; they take ~1-3s each due to worker
 * startup cost. Total suite budget: ~30s.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  runUserCodeInSandbox,
  executeSkillInSandbox,
  sandboxProvenance,
  DEFAULT_SANDBOX_CONFIG,
} from '@/lib/skill-sandbox/sandbox'
import { db } from '@/lib/db'
import type { GeneratedSkill } from '@/lib/skill-synthesis/pipeline'

const VALID_PROV = sandboxProvenance()

// Helper: build a GeneratedSkill with an `execute` body.
function makeExecutableSkill(execute: string, tests: { name: string; input: string; expectedContains?: string[] }[] = [{ name: 't1', input: 'hello' }]): GeneratedSkill {
  return {
    id: 'c4-skill-test',
    gapId: 'gap-1',
    name: 'c4-test-skill',
    description: 'C4 isolation test skill',
    promptTemplate: 'ignored when execute is present',
    tools: [],
    examples: [],
    tests,
    generatedBy: 'agent://c4-test',
    generatedAt: new Date().toISOString(),
    status: 'generated',
    execute,
  }
}

describe('C4 — runUserCodeInSandbox (low-level)', () => {
  beforeEach(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'skill-synthesis', event: 'sandbox-execution' } })
  })

  afterEach(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'skill-synthesis', event: 'sandbox-execution' } })
  })

  it('runs a legitimate async skill body and returns its value', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        const text = 'processed:' + String(input)
        return text.toUpperCase()
      `,
      input: 'hello',
      config: { maxExecutionMs: 2000 },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.value).toBe('PROCESSED:HELLO')
      expect(outcome.toolCalls).toEqual([])
    }
  })

  it('captures console.log output from the worker', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        console.log('line 1')
        console.log('line 2')
        console.error('warn line')
        return 'done'
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.stdout).toContain('line 1')
      expect(outcome.stdout).toContain('line 2')
      expect(outcome.stderr).toContain('warn line')
    }
  })

  it('blocks require("fs") — no require global in the worker', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        const fs = require('fs')
        return fs.readFileSync('/etc/passwd', 'utf8')
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
    })

    // Either the worker throws ReferenceError (require is undefined) or the
    // worker catches it and reports kind:'error'. Both are acceptable.
    expect(['error', 'terminated']).toContain(outcome.kind)
    if (outcome.kind === 'error') {
      // V8 reports "require is not a function" since we set globalThis.require = undefined.
      expect(outcome.error).toMatch(/require.*not.*defined|require.*not.*function|require.*undefined/i)
    }
  })

  it('blocks require("child_process") — no require global in the worker', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        const cp = require('child_process')
        return cp.execSync('id').toString()
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
    })

    expect(['error', 'terminated']).toContain(outcome.kind)
  })

  it('process.exit is undefined in the worker', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        if (typeof process.exit === 'function') {
          throw new Error('process.exit is exposed — security violation')
        }
        return 'process.exit blocked'
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.value).toBe('process.exit blocked')
    }
  })

  it('process.env returns only the sandboxed env, not the host env', async () => {
    // Set a host env var that should NOT leak into the worker.
    const leakMarker = `C4_LEAK_${Date.now()}`
    process.env[leakMarker] = 'host-secret'

    try {
      const outcome = await runUserCodeInSandbox({
        code: `
          // Try to read the leak marker.
          const leak = process.env[${JSON.stringify(leakMarker)}]
          if (leak !== undefined) {
            throw new Error('Host env leaked into sandbox: ' + leak)
          }
          // Read a sandbox-provided env var instead.
          return process.env.SANDBOX_GREETING || '(no greeting)'
        `,
        input: '',
        config: {
          maxExecutionMs: 2000,
          env: { SANDBOX_GREETING: 'hello-from-sandbox' },
        },
      })

      expect(outcome.kind).toBe('ok')
      if (outcome.kind === 'ok') {
        expect(outcome.value).toBe('hello-from-sandbox')
      }
    } finally {
      delete process.env[leakMarker]
    }
  })

  it('kills an infinite loop via the hard wall-clock timeout', async () => {
    const start = Date.now()
    const outcome = await runUserCodeInSandbox({
      code: `
        while (true) {
          // tight CPU loop — never returns
        }
      `,
      input: '',
      config: { maxExecutionMs: 500 }, // 500ms cap
    })
    const elapsed = Date.now() - start

    // Should be killed as either timeout or terminated (V8 may report
    // a memory error if the loop allocates). Either way, NOT ok.
    expect(['timeout', 'terminated']).toContain(outcome.kind)
    // Should not take more than ~2x the timeout.
    expect(elapsed).toBeLessThan(2000)
  })

  it('kills an unbounded allocation via the V8 memory cap', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        const chunks = []
        while (true) {
          chunks.push(new Array(1024 * 1024).fill('x')) // 1MB per iter
        }
      `,
      input: '',
      config: {
        maxExecutionMs: 5000,
        maxOldGenerationSizeMb: 16, // very small cap
      },
    })

    // V8 will terminate the worker with an allocation-failed error.
    expect(['terminated', 'timeout']).toContain(outcome.kind)
    if (outcome.kind === 'terminated') {
      // V8 reports a few different messages; accept any of these.
      expect(outcome.reason).toMatch(/allocation|memory|heap|range/i)
    }
  })

  it('reports a thrown Error as kind:error (not crash the host)', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        throw new Error('intentional skill failure')
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
    })

    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.error).toMatch(/intentional skill failure/)
    }
  })

  it('forwards tool calls RPC to the parent and respects the whitelist', async () => {
    const calls: Array<{ tool: string; args: unknown[] }> = []
    const outcome = await runUserCodeInSandbox({
      code: `
        const a = await tools.add(2, 3)
        const b = await tools.multiply(a, 10)
        return { a, b }
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
      allowedTools: ['add', 'multiply'],
      toolHandler: async (tool, args) => {
        calls.push({ tool, args })
        if (tool === 'add') return (args[0] as number) + (args[1] as number)
        if (tool === 'multiply') return (args[0] as number) * (args[1] as number)
        throw new Error(`Unknown tool: ${tool}`)
      },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.value).toEqual({ a: 5, b: 50 })
      expect(outcome.toolCalls).toEqual(['add', 'multiply'])
      expect(calls).toHaveLength(2)
    }
  })

  it('blocks tool calls not in the whitelist', async () => {
    const outcome = await runUserCodeInSandbox({
      code: `
        return await tools.forbiddenOp('do something bad')
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
      allowedTools: ['onlyThisOne'],
      toolHandler: async () => 'should never be called',
    })

    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.error).toMatch(/not allowed/i)
    }
  })

  it('does not leak host stdout — worker console output is captured only', async () => {
    // We can't easily assert on host stdout from a test, but we can verify
    // the captured stdout contains the message AND the kind is ok. If the
    // worker had leaked to host stdout, the captured buffer would be empty.
    const outcome = await runUserCodeInSandbox({
      code: `
        console.log('captured message from worker')
        return 'ok'
      `,
      input: '',
      config: { maxExecutionMs: 2000 },
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.stdout).toContain('captured message from worker')
    }
  })
})

describe('C4 — executeSkillInSandbox with execute field', () => {
  beforeEach(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'skill-synthesis', event: 'sandbox-execution' } })
  })

  afterEach(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'skill-synthesis', event: 'sandbox-execution' } })
  })

  it('runs an executable skill end-to-end and records success', async () => {
    const skill = makeExecutableSkill(
      `
        return 'root cause found: ' + String(input) + ' — corrective action applied'
      `,
      [{ name: 't1', input: 'task-x', expectedContains: ['root cause', 'corrective'] }],
    )

    const result = await executeSkillInSandbox({ skill, provenance: VALID_PROV })

    expect(result.skillId).toBe(skill.id)
    expect(result.testResults).toHaveLength(1)
    expect(result.testResults[0]!.success).toBe(true)
    expect(result.testResults[0]!.output).toContain('root cause')
    expect(result.testResults[0]!.output).toContain('corrective')
    expect(result.violations).toEqual([])
  })

  it('records a timeout violation when the skill body loops forever', async () => {
    const skill = makeExecutableSkill(`while (true) {}`, [{ name: 't1', input: 'x' }])
    const result = await executeSkillInSandbox({
      skill,
      config: { maxExecutionMs: 400 },
      provenance: VALID_PROV,
    })

    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some((v) => v.includes('timed out'))).toBe(true)
    expect(result.testResults[0]!.success).toBe(false)
  })

  it('records a require() block when the skill body tries to import fs', async () => {
    const skill = makeExecutableSkill(
      `const fs = require('fs'); return fs.readFileSync('/etc/passwd').toString()`,
      [{ name: 't1', input: 'x' }],
    )
    const result = await executeSkillInSandbox({
      skill,
      config: { maxExecutionMs: 2000 },
      provenance: VALID_PROV,
    })

    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some((v) => v.includes('worker error'))).toBe(true)
    expect(result.testResults[0]!.success).toBe(false)
  })

  it('records a termination violation when the skill body OOMs', async () => {
    const skill = makeExecutableSkill(
      `const chunks = []; while (true) { chunks.push(new Array(1024 * 1024).fill('x')) }`,
      [{ name: 't1', input: 'x' }],
    )
    const result = await executeSkillInSandbox({
      skill,
      config: { maxExecutionMs: 5000, maxOldGenerationSizeMb: 16 },
      provenance: VALID_PROV,
    })

    expect(result.violations.some((v) => v.includes('terminated'))).toBe(true)
    expect(result.testResults[0]!.success).toBe(false)
  })

  it('persists audit trail even when the skill fails', async () => {
    const skill = makeExecutableSkill(`throw new Error('skill failure')`, [{ name: 't1', input: 'x' }])
    await executeSkillInSandbox({
      skill,
      config: { maxExecutionMs: 2000 },
      provenance: VALID_PROV,
    })

    const logs = await db.agentLog.findMany({
      where: { phase: 'skill-synthesis', event: 'sandbox-execution' },
      orderBy: { timestamp: 'desc' },
      take: 1,
    })

    expect(logs.length).toBeGreaterThan(0)
    const payload = JSON.parse(logs[0]!.payload)
    expect(payload.skillId).toBe(skill.id)
    expect(payload.success).toBe(false)
    expect(payload.violations).toBeGreaterThan(0)
  })
})

describe('C4 — DEFAULT_SANDBOX_CONFIG resource limits', () => {
  it('sets conservative memory caps by default', () => {
    expect(DEFAULT_SANDBOX_CONFIG.maxOldGenerationSizeMb).toBe(64)
    expect(DEFAULT_SANDBOX_CONFIG.maxYoungGenerationSizeMb).toBe(32)
    expect(DEFAULT_SANDBOX_CONFIG.codeRangeSizeMb).toBe(16)
    expect(DEFAULT_SANDBOX_CONFIG.stackSizeMb).toBe(8)
  })
})
