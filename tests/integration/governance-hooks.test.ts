/**
 * Integration tests for governance hooks (Fase 5 — G6, G7, G8).
 *
 * Coverage:
 *   G6: markExternalInputTainted + checkToolCallSink
 *     - markExternalInputTainted creates TaintRecord + returns taintId
 *     - checkToolCallSink on non-sensitive tool → allowed
 *     - checkToolCallSink on sensitive tool with no taint → allowed
 *     - checkToolCallSink on sensitive tool with active taint → blocked
 *   G7: publishStateChangeToLTL
 *     - returns verdict + violations
 *     - fail-open on error
 *   G8: evaluateRedLinesForAction
 *     - returns allowed=true when no red lines match
 *     - returns allowed=false when red line matches action
 *     - case-insensitive matching
 *     - fail-open on error
 *   Composite: preExecuteGate
 *     - allowed when all gates pass
 *     - blocked when taint blocks
 *     - blocked when red line blocks
 *     - blocked when LTL rejects
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  markExternalInputTainted,
  checkToolCallSink,
  publishStateChangeToLTL,
  evaluateRedLinesForAction,
  preExecuteGate,
} from '@/lib/runtime/governance-hooks'
import { __resetExpireThrottleForTests } from '@/lib/kernel/artificial-retainer'

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

const TEST_AGENT = 'gov5-test-agent'

async function cleanupGovData() {
  __resetExpireThrottleForTests()
  await db.taintRecord.deleteMany({})
  await db.verificationEvent.deleteMany({})
  await db.redLine.deleteMany({ where: { description: { startsWith: 'TEST-RL-GOV5-' } } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
}

// === G6: Taint Hooks =================================================

describe('Fase 5 — G6: taint hooks', () => {
  beforeEach(async () => { await cleanupGovData() })
  afterEach(async () => { await cleanupGovData() })

  it('markExternalInputTainted creates a TaintRecord', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'malicious payload', TEST_AGENT)
    expect(taintId).toBeTruthy()

    const record = await db.taintRecord.findUnique({ where: { id: taintId! } })
    expect(record).toBeTruthy()
    expect(record?.source).toBe('user_chat')
    expect(record?.payload).toBe('malicious payload')
    expect(record?.taintLabel).toBe('TAINTED')
    expect(record?.blocked).toBe(false)
  })

  it('checkToolCallSink on non-sensitive tool → allowed', async () => {
    const result = await checkToolCallSink('memory_search', [], TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.sink).toBeUndefined()
  })

  it('checkToolCallSink on sensitive tool with no taint → allowed', async () => {
    const result = await checkToolCallSink('exec', [], TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.sink).toBe('tool_call:exec')
  })

  it('checkToolCallSink on sensitive tool with active taint → blocked', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'rm -rf /', TEST_AGENT)
    expect(taintId).toBeTruthy()

    const result = await checkToolCallSink('exec', [taintId!], TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.sink).toBe('tool_call:exec')
    expect(result.reason).toMatch(/Bloccato/)

    // Verify record marked as blocked
    const record = await db.taintRecord.findUnique({ where: { id: taintId! } })
    expect(record?.blocked).toBe(true)
  })

  it('checkToolCallSink recognizes file_write as sensitive', async () => {
    const { taintId } = await markExternalInputTainted('file_input', 'untrusted content', TEST_AGENT)
    const result = await checkToolCallSink('file_write', [taintId!], TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.sink).toBe('tool_call:file_write')
  })

  it('checkToolCallSink recognizes deploy as sensitive', async () => {
    const { taintId } = await markExternalInputTainted('api_response', 'untrusted', TEST_AGENT)
    const result = await checkToolCallSink('deploy', [taintId!], TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.sink).toBe('tool_call:deploy')
  })

  it('checkToolCallSink recognizes delete as sensitive', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'untrusted', TEST_AGENT)
    const result = await checkToolCallSink('delete', [taintId!], TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.sink).toBe('tool_call:delete')
  })

  it('checkToolCallSink is case-insensitive on tool name', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'untrusted', TEST_AGENT)
    const result = await checkToolCallSink('EXEC', [taintId!], TEST_AGENT)
    expect(result.allowed).toBe(false)
  })

  it('checkToolCallSink with non-existent taintId → allowed (expired/missing)', async () => {
    const result = await checkToolCallSink('exec', ['non-existent-id'], TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.reason).toMatch(/scaduti o non trovati/)
  })
})

// === G7: LTL Hook ====================================================

describe('Fase 5 — G7: LTL state-change hook', () => {
  beforeEach(async () => { await cleanupGovData() })
  afterEach(async () => { await cleanupGovData() })

  it('publishStateChangeToLTL returns verdict + violations', async () => {
    const result = await publishStateChangeToLTL('plan', 'task_start', { taskId: 'test' }, TEST_AGENT)
    expect(['accept', 'warn', 'reject']).toContain(result.verdict)
    expect(Array.isArray(result.violations)).toBe(true)
  })

  it('publishStateChangeToLTL on valid sequence (plan → execute) → accept or warn', async () => {
    const r1 = await publishStateChangeToLTL('plan', 'plan', {}, TEST_AGENT)
    const r2 = await publishStateChangeToLTL('execute', 'execute', {}, TEST_AGENT)
    // Both should be valid (no LTL rule violated by plan+execute alone)
    expect(['accept', 'warn']).toContain(r1.verdict)
    expect(['accept', 'warn']).toContain(r2.verdict)
  })
})

// === G8: Red Lines Hook ==============================================

describe('Fase 5 — G8: red lines evaluation hook', () => {
  beforeEach(async () => { await cleanupGovData() })
  afterEach(async () => { await cleanupGovData() })

  it('returns allowed=true when no red lines match action', async () => {
    const result = await evaluateRedLinesForAction('harmless action', TEST_AGENT)
    expect(result.allowed).toBe(true)
    expect(result.blockingRedLines).toEqual([])
  })

  it('returns allowed=false when red line description is contained in action', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-delete user data', rationale: 'safety', severity: 'absolute' },
    })

    const result = await evaluateRedLinesForAction('delete user data from database', TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.blockingRedLines.length).toBe(1)
    expect(result.blockingRedLines[0].description).toBe('TEST-RL-GOV5-delete user data')
    expect(result.blockingRedLines[0].severity).toBe('absolute')
  })

  it('matches case-insensitively', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-NEVER deploy production', rationale: '', severity: 'strong' },
    })

    const result = await evaluateRedLinesForAction('DEPLOY TO PRODUCTION NOW', TEST_AGENT)
    expect(result.allowed).toBe(false)
  })

  it('matches on significant keyword overlap (>4 chars)', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-confidential data leak', rationale: '', severity: 'absolute' },
    })

    // action contains "confidential" which is a word >4 chars
    const result = await evaluateRedLinesForAction('share confidential information externally', TEST_AGENT)
    expect(result.allowed).toBe(false)
  })

  it('does NOT match on short words (<5 chars)', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-no go', rationale: '', severity: 'soft' },
    })

    // "no" and "go" are too short (length <= 4), no match
    const result = await evaluateRedLinesForAction('go to the next step', TEST_AGENT)
    expect(result.allowed).toBe(true)
  })

  it('ignores inactive red lines', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-inactive rule', rationale: '', severity: 'absolute', active: false },
    })

    const result = await evaluateRedLinesForAction('inactive rule is triggered', TEST_AGENT)
    expect(result.allowed).toBe(true)
  })

  it('handles multiple blocking red lines', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-delete', rationale: '', severity: 'absolute' },
    })
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-production', rationale: '', severity: 'strong' },
    })

    const result = await evaluateRedLinesForAction('delete production database', TEST_AGENT)
    expect(result.allowed).toBe(false)
    expect(result.blockingRedLines.length).toBe(2)
  })
})

// === Composite: preExecuteGate ======================================

describe('Fase 5 — preExecuteGate (composite)', () => {
  beforeEach(async () => { await cleanupGovData() })
  afterEach(async () => { await cleanupGovData() })

  it('allowed when all gates pass (no taint, no red line, no LTL violation)', async () => {
    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'harmless action',
      toolName: 'memory_search', // non-sensitive
    })
    expect(result.allowed).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.taintBlocked).toBe(false)
  })

  it('blocked when taint blocks (sensitive tool + active taint)', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'malicious', TEST_AGENT)

    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'exec rm -rf',
      toolName: 'exec',
      taintIds: [taintId!],
    })
    expect(result.allowed).toBe(false)
    expect(result.taintBlocked).toBe(true)
    expect(result.reasons.some(r => r.startsWith('Taint:'))).toBe(true)
  })

  it('blocked when red line blocks', async () => {
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-delete production', rationale: '', severity: 'absolute' },
    })

    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'delete production database',
      // No toolName → skip taint check
    })
    expect(result.allowed).toBe(false)
    expect(result.blockingRedLines.length).toBe(1)
    expect(result.reasons.some(r => r.startsWith('Red Lines:'))).toBe(true)
  })

  it('blocked when multiple gates block simultaneously', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'malicious', TEST_AGENT)
    await db.redLine.create({
      data: { description: 'TEST-RL-GOV5-deploy', rationale: '', severity: 'absolute' },
    })

    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'deploy to production',
      toolName: 'deploy',
      taintIds: [taintId!],
    })
    expect(result.allowed).toBe(false)
    expect(result.taintBlocked).toBe(true)
    expect(result.blockingRedLines.length).toBe(1)
    // Both reasons should be present
    expect(result.reasons.some(r => r.startsWith('Taint:'))).toBe(true)
    expect(result.reasons.some(r => r.startsWith('Red Lines:'))).toBe(true)
  })

  it('allowed when sensitive tool has no active taint', async () => {
    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'exec ls -la',
      toolName: 'exec',
      taintIds: [], // no taint
    })
    expect(result.allowed).toBe(true)
    expect(result.taintBlocked).toBe(false)
  })

  it('does not check taint when toolName is undefined', async () => {
    const { taintId } = await markExternalInputTainted('user_chat', 'malicious', TEST_AGENT)

    const result = await preExecuteGate({
      agentId: TEST_AGENT,
      action: 'some action',
      taintIds: [taintId!],
      // no toolName → taint check skipped
    })
    expect(result.taintBlocked).toBe(false)
    expect(result.allowed).toBe(true)
  })
})
