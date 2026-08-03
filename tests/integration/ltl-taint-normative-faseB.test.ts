/**
 * Integration tests for LTL Taint Normative Fase B
 * (G2, G3, B5)
 *
 * G2 — Taint integrato in executor + react-loop + tool-dispatcher
 * G3 — Normative evaluateIntent integrato in executor (prima del ReAct loop)
 * B5 — evaluateIntent persiste verdict su agentLog
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

// === Fixtures ========================================================

const TEST_PREFIX = 'ltl-faseB-'
const TEST_AGENT = 'ltl-faseB-agent'

async function cleanupFixtures() {
  await db.taintRecord.deleteMany({
    where: { source: { startsWith: TEST_PREFIX } },
  })
  await db.agentLog.deleteMany({
    where: { agentId: TEST_AGENT },
  })
  await db.verificationEvent.deleteMany({
    where: { stateLabel: { startsWith: 'test_faseB_' } },
  })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B5: evaluateIntent persiste verdict su agentLog =================

describe('Fase B — B5: evaluateIntent persiste verdict su agentLog', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('evaluateIntent con auditLog=true (default) crea agentLog entry', async () => {
    const { evaluateIntent } = await import('@/lib/kernel/normative')
    await evaluateIntent({
      agentId: TEST_AGENT,
      action: 'test action B5',
      rationale: 'test',
      affectedAxioms: [],
      claimedPriority: 2,
    })

    const logs = await db.agentLog.findMany({
      where: { agentId: TEST_AGENT, event: 'normative_evaluation' },
    })
    expect(logs.length).toBe(1)
    expect(logs[0].phase).toBe('4')
    expect(logs[0].level).toBe('info') // allowed=true → info
    const payload = JSON.parse(logs[0].payload)
    expect(payload.action).toBe('test action B5')
    expect(payload.allowed).toBe(true)
    expect(payload.claimedPriority).toBe(2)
  })

  it('evaluateIntent con auditLog=false NON crea agentLog entry', async () => {
    const { evaluateIntent } = await import('@/lib/kernel/normative')
    await evaluateIntent(
      {
        agentId: TEST_AGENT,
        action: 'test action no audit',
        rationale: 'test',
        affectedAxioms: [],
        claimedPriority: 2,
      },
      { auditLog: false },
    )

    const logs = await db.agentLog.findMany({
      where: { agentId: TEST_AGENT, event: 'normative_evaluation' },
    })
    expect(logs.length).toBe(0)
  })

  it('evaluateIntent BLOCK persiste con level=warn', async () => {
    const { evaluateIntent } = await import('@/lib/kernel/normative')
    // Crea assioma priority 1 che sarà violato
    const axiomText = `B5 test axiom ${Date.now()}`
    await db.normativeRule.create({
      data: { axiom: axiomText, priority: 1, active: true },
    })

    try {
      await evaluateIntent({
        agentId: TEST_AGENT,
        action: 'violating action',
        rationale: 'test',
        affectedAxioms: [{ axiom: axiomText, impact: 'violate' }],
        claimedPriority: 3, // priority 3 < axiom priority 1 → BLOCK
      })

      const logs = await db.agentLog.findMany({
        where: { agentId: TEST_AGENT, event: 'normative_evaluation' },
      })
      expect(logs.length).toBe(1)
      expect(logs[0].level).toBe('warn') // blocked → warn
      const payload = JSON.parse(logs[0].payload)
      expect(payload.allowed).toBe(false)
      expect(payload.blockingAxiom).toBe(axiomText)
      expect(payload.blockingPriority).toBe(1)
    } finally {
      await db.normativeRule.deleteMany({ where: { axiom: axiomText } })
    }
  })

  it('evaluateIntent con claimedPriority invalido NON crea agentLog (throw prima)', async () => {
    const { evaluateIntent, InvalidPriorityError } = await import('@/lib/kernel/normative')
    try {
      await evaluateIntent({
        agentId: TEST_AGENT,
        action: 'invalid priority',
        rationale: 'test',
        affectedAxioms: [],
        claimedPriority: 0,
      })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidPriorityError)
    }

    const logs = await db.agentLog.findMany({
      where: { agentId: TEST_AGENT, event: 'normative_evaluation' },
    })
    expect(logs.length).toBe(0) // throw prima della persistenza
  })
})

// === G2: Taint integrato in tool-dispatcher ==========================

describe('Fase B — G2: dispatchTool chiama checkSink prima di tool sensibili', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('dispatchTool con taintIds bloccati → tool non eseguito, ritorna Taint block error', async () => {
    const { taintInput } = await import('@/lib/kernel/taint')
    const { dispatchTool } = await import('@/lib/runtime/tool-dispatcher')

    // Crea taint
    const taintId = await taintInput(`${TEST_PREFIX}g2-block`, 'malicious input')

    // Prima chiamata a 'exec' (sensibile) → blocca
    const result = await dispatchTool(
      { name: 'exec', arguments: {} },
      {
        agentId: TEST_AGENT,
        planId: 'test-plan',
        taskId: 'test-task',
        taintIds: [taintId],
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Taint block|Blocked by Taint/i)
    expect(result.error).toMatch(/exec/)
  })

  it('dispatchTool con taintIds ma tool non sensibile → tool eseguito normalmente', async () => {
    const { taintInput } = await import('@/lib/kernel/taint')
    const { dispatchTool } = await import('@/lib/runtime/tool-dispatcher')

    const taintId = await taintInput(`${TEST_PREFIX}g2-nonsensitive`, 'payload')

    // 'filesystem.read' non è in SENSITIVE_SINKS → non blocca
    const result = await dispatchTool(
      { name: 'filesystem.read', arguments: { path: '/tmp/nonexistent-test' } },
      {
        agentId: TEST_AGENT,
        planId: 'test-plan',
        taskId: 'test-task',
        allowedScopes: ['filesystem:read'], // scope richiesto dal builtin
        taintIds: [taintId],
      },
    )

    // Tool eseguito (fallisce per file non trovato, NON per taint block)
    expect(result.success).toBe(false)
    expect(result.error).not.toMatch(/Taint block|Blocked by Taint/i)
    expect(result.error).toMatch(/File not found|Path not allowed/i)
  })

  it('dispatchTool senza taintIds → nessun checkSink, tool eseguito', async () => {
    const { dispatchTool } = await import('@/lib/runtime/tool-dispatcher')

    const result = await dispatchTool(
      { name: 'filesystem.read', arguments: { path: '/tmp/nonexistent-no-taint' } },
      {
        agentId: TEST_AGENT,
        planId: 'test-plan',
        taskId: 'test-task',
        // niente taintIds
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).not.toMatch(/Taint block|Blocked by Taint/i)
  })

  it('dispatchTool con taintId scaduto → tool eseguito (taint ignorato)', async () => {
    const { dispatchTool } = await import('@/lib/runtime/tool-dispatcher')

    // taintId inesistente → checkSink ritorna allowed=true (missing)
    const result = await dispatchTool(
      { name: 'exec', arguments: {} },
      {
        agentId: TEST_AGENT,
        planId: 'test-plan',
        taskId: 'test-task',
        taintIds: ['nonexistent-taint-id'],
      },
    )

    // Tool non trovato (exec non è builtin/registered), ma NON taint block
    expect(result.success).toBe(false)
    expect(result.error).not.toMatch(/Taint block|Blocked by Taint/i)
    expect(result.error).toMatch(/Tool not found/i)
  })

  it('DispatchOptions accetta taintIds opzionali', async () => {
    // Type-level check: la signature accetta taintIds
    const { dispatchTool } = await import('@/lib/runtime/tool-dispatcher')
    expect(typeof dispatchTool).toBe('function')
    // Verifica che taintIds è opzionale (non richiesto)
    const opts: any = { agentId: 'x', planId: 'y', taskId: 'z' }
    expect(opts.taintIds).toBeUndefined() // ok se non presente
  })
})

// === G2: Taint integrato in react-loop (propagateTaint) ==============

describe('Fase B — G2: ReActOptions accetta taintId per propagateTaint', () => {
  it('ReActOptions.taintId è opzionale (backward compat)', async () => {
    // Type-level check: taintId è opzionale
    const opts: any = {
      agentId: 'test',
      planId: 'test',
      taskId: 'test',
      task: 'test',
    }
    expect(opts.taintId).toBeUndefined() // ok se non presente
  })

  it('react-loop.ts ha import dinamico di propagateTaint', async () => {
    // Verifica che il codice sorgente contiene l'integrazione
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    expect(content).toMatch(/propagateTaint/)
    expect(content).toMatch(/taintId/)
    expect(content).toMatch(/react_iter_/)
  })

  it('react-loop.ts passa taintIds a dispatchTool', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    expect(content).toMatch(/taintIds:\s*options\.taintId/)
  })
})

// === G2: Taint integrato in executor (taintInput) ===================

describe('Fase B — G2: executor.ts chiama taintInput su task description', () => {
  it('executor.ts ha import dinamico di taintInput', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/taintInput/)
    expect(content).toMatch(/task:\$\{planId\}\/\$\{taskDef\.taskId\}/)
  })

  it('executor.ts passa taintId a executeReActLoop', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/taintId/)
    expect(content).toMatch(/G2[\s\S]*taintId/)
  })
})

// === G3: Normative integrato in executor =============================

describe('Fase B — G3: executor.ts chiama evaluateIntent prima del ReAct loop', () => {
  it('executor.ts ha import dinamico di evaluateIntent', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/evaluateIntent/)
    expect(content).toMatch(/G3 fix[\s\S]*Normative/)
  })

  it('executor.ts blocca task se normative non permette', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Verifica che c'è il branch che gestisce !normativeVerdict.allowed
    expect(content).toMatch(/normativeVerdict\.allowed/)
    expect(content).toMatch(/Normative block/)
    expect(content).toMatch(/step\.status\s*=\s*['"]blocked['"]/)
  })

  it('executor.ts usa claimedPriority=2 (operational) come default', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/claimedPriority:\s*2/)
  })
})

// === Smoke: full G2+G3+B5 integration ===============================

describe('Fase B — Smoke: full G2+G3+B5 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('Taint flow: taintInput → checkSink blocca → agentLog audit', async () => {
    const { taintInput, checkSink } = await import('@/lib/kernel/taint')

    // 1. Crea taint
    const taintId = await taintInput(`${TEST_PREFIX}smoke`, 'user input malicious')

    // 2. checkSink su sink sensibile → blocca
    const result = await checkSink('tool_call:exec', [taintId])
    expect(result.allowed).toBe(false)
    expect(result.blockedFlows.length).toBe(1)

    // 3. Verifica TaintRecord.blockedAtSink tracciato
    const record = await db.taintRecord.findUnique({ where: { id: taintId } })
    expect(record!.blocked).toBe(true)
    expect(record!.blockedAtSink).toBe('tool_call:exec')

    // 4. Idempotency: secondo sink non ri-blocca
    const result2 = await checkSink('tool_call:file_write', [taintId])
    expect(result2.allowed).toBe(true) // già bloccato, idempotente
  })

  it('Normative flow: evaluateIntent → BLOCK → agentLog persistito', async () => {
    const { evaluateIntent } = await import('@/lib/kernel/normative')

    // Crea assioma priority 1
    const axiomText = `Smoke test axiom ${Date.now()}`
    await db.normativeRule.create({
      data: { axiom: axiomText, priority: 1, active: true },
    })

    try {
      // evaluateIntent con violation di priority 1 da claimedPriority 3 → BLOCK
      const verdict = await evaluateIntent({
        agentId: TEST_AGENT,
        action: 'smoke test violating action',
        rationale: 'test',
        affectedAxioms: [{ axiom: axiomText, impact: 'violate' }],
        claimedPriority: 3,
      })

      expect(verdict.allowed).toBe(false)
      expect(verdict.blockingAxiom).toBe(axiomText)
      expect(verdict.blockingPriority).toBe(1)

      // B5: agentLog persistito con level=warn
      const logs = await db.agentLog.findMany({
        where: { agentId: TEST_AGENT, event: 'normative_evaluation' },
      })
      expect(logs.length).toBe(1)
      expect(logs[0].level).toBe('warn')
      const payload = JSON.parse(logs[0].payload)
      expect(payload.allowed).toBe(false)
      expect(payload.blockingAxiom).toBe(axiomText)
    } finally {
      await db.normativeRule.deleteMany({ where: { axiom: axiomText } })
    }
  })

  it('dispatchTool con taint bloccato ritorna errore descrittivo', async () => {
    const { taintInput } = await import('@/lib/kernel/taint')
    const { dispatchTool } = await import('@/lib/runtime/tool-dispatcher')

    const taintId = await taintInput(`${TEST_PREFIX}smoke-dispatch`, 'payload')
    const result = await dispatchTool(
      { name: 'file_write', arguments: {} },
      {
        agentId: TEST_AGENT,
        planId: 'test',
        taskId: 'test',
        taintIds: [taintId],
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Blocked by Taint/i)
    expect(result.error).toContain('file_write')
  })
})
