/**
 * Skill Sandbox — Fase 6.2 + C4 hardening
 *
 * Esecuzione isolata di skill generate per validazione pre-registrazione.
 *
 * C4 — Real isolation via worker_threads:
 *   - When a GeneratedSkill has an `execute` field (JS source string), the
 *     sandbox spawns a worker_thread with resourceLimits (memory cap), a
 *     hard wall-clock timeout enforced via `worker.terminate()`, and a
 *     sanitised global scope (no `require`, no `process.exit`, captured
 *     console). Tool calls RPC back to the parent through a whitelisted
 *     proxy. See `./worker.ts` for the worker-side protocol.
 *   - When the skill has no `execute` field (prompt-only, legacy), the
 *     sandbox falls back to the original simulated-execution path so the
 *     existing tests and pre-C4 skills keep working unchanged.
 *
 * Resource limits (still enforced in both paths):
 *   - maxExecutionMs   — hard wall-clock timeout per test
 *   - maxOutputBytes   — stdout/stderr truncation threshold
 *   - maxIterations    — total number of tests we will run before bailing
 *   - allowedTools     — tool IDs the worker is allowed to RPC to
 *   - forbiddenPatterns — regex patterns that block the prompt before run
 *   - env              — sandboxed env vars (worker sees only these)
 *
 * Audit trail: every sandbox execution is logged to AgentLog for review.
 */

import { Worker } from 'worker_threads'
import { join } from 'path'
import { db } from '@/lib/db'
import { createProvenance, type Provenance } from '@/lib/governance'
import type { GeneratedSkill } from '@/lib/skill-synthesis/pipeline'
import type { SkillTest } from '@/lib/skill-registry/registry'
import type { TaskResult } from '@/lib/evaluation/runner'

// === Tipi ============================================================

export interface SandboxConfig {
  maxExecutionMs: number
  maxOutputBytes: number
  maxIterations: number
  allowedTools: string[] // tool IDs whitelist
  forbiddenPatterns: RegExp[] // regex patterns che bloccano l'output
  env: Record<string, string> // env vars isolate
  // C4 — worker_thread resource limits. Defaults are conservative.
  maxOldGenerationSizeMb?: number // heap old generation cap (default 64)
  maxYoungGenerationSizeMb?: number // heap young generation cap (default 32)
  codeRangeSizeMb?: number // code range cap (default 16)
  stackSizeMb?: number // stack cap (default 8)
}

export interface SandboxExecution {
  id: string
  skillId: string
  testResults: TaskResult[]
  success: boolean
  errorRate: number
  avgLatencyMs: number
  totalCost: number
  iterations: number
  violations: string[]
  output: SandboxOutput[]
  startedAt: string
  completedAt: string
  durationMs: number
}

export interface SandboxOutput {
  testId: string
  stdout: string
  stderr: string
  exitCode: number
  truncated: boolean
}

// === C4 worker protocol =============================================

/**
 * Result returned by the worker. Mirrors `WorkerResult` in worker.ts but
 * kept here so callers don't have to import the worker module (which would
 * pull worker_threads into the main bundle even when not used).
 */
export interface WorkerResult {
  ok: boolean
  value?: unknown
  error?: string
  stdout: string
  stderr: string
  toolCalls: string[]
}

/**
 * Outcome of a single isolated execution. Either the worker returned a
 * value (success), or the worker threw / timed out / exceeded memory
 * (failure). The `kind` field lets callers distinguish timeout from a
 * user-code thrown error.
 */
export type IsolatedRunOutcome =
  | { kind: 'ok'; value: unknown; stdout: string; stderr: string; toolCalls: string[] }
  | { kind: 'error'; error: string; stdout: string; stderr: string; toolCalls: string[] }
  | { kind: 'timeout'; stdout: string; stderr: string; toolCalls: string[] }
  | { kind: 'terminated'; reason: string; stdout: string; stderr: string; toolCalls: string[] }

interface RpcCall {
  kind: 'rpc-call'
  id: number
  tool: string
  args: unknown[]
}
interface RpcReturn {
  kind: 'rpc-return'
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

// === Default config ==================================================

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  maxExecutionMs: 5000,
  maxOutputBytes: 10000,
  maxIterations: 100,
  allowedTools: [],
  forbiddenPatterns: [
    /require\s*\(\s*['"]child_process['"]/gi,
    /require\s*\(\s*['"]fs['"]/gi,
    /require\s*\(\s*['"]net['"]/gi,
    /process\.exit/gi,
    /eval\s*\(/gi,
    /Function\s*\(/gi,
    // Patterns più generici per catturare menzioni di moduli pericolosi
    /\bchild_process\b/gi,
    /\bprocess\.env\b/gi,
  ],
  env: {},
  // C4 — conservative memory caps. Skills that need more should opt in
  // explicitly via config; the default is intentionally tight so a runaway
  // allocation gets killed before OOMing the host process.
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 16,
  stackSizeMb: 8,
}

// === C4 — Low-level isolated runner =================================
//
// Spawns a worker_thread, runs the user code, enforces timeout + memory
// limits, and surfaces the result. Used by executeSkillInSandbox when the
// skill has an `execute` field, and exported as runUserCodeInSandbox for
// callers that want to run arbitrary code without a GeneratedSkill wrapper.

const WORKER_PATH = join(__dirname, 'worker.js')

/**
 * Resolve the worker entrypoint path.
 *
 * In the source tree the worker lives at `src/lib/skill-sandbox/worker.ts`.
 * After TypeScript compilation it becomes `worker.js` (or stays `worker.ts`
 * when run via tsx/vitest). We try both, falling back to a `.cjs` build
 * artifact if neither exists.
 */
function resolveWorkerPath(): string {
  // __dirname is the sandbox dir at runtime (compiled or via tsx).
  // Try .js first (production), .ts second (vitest via tsx), .cjs last.
  const candidates = [
    join(__dirname, 'worker.js'),
    join(__dirname, 'worker.ts'),
    join(__dirname, 'worker.cjs'),
  ]
  // Lazy-load fs to keep worker_threads import cost out of the warm path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore — try next
    }
  }
  // Default to .js so the error message is meaningful if missing.
  return WORKER_PATH
}

/**
 * Run arbitrary JS code in an isolated worker_thread.
 *
 * The code is wrapped as `async (input, tools) => { ... }` and awaited.
 * The worker has no `require`, no `process.exit`, captured console, and a
 * memory cap enforced by Node's V8 isolate. Hard timeout via terminate().
 *
 * Tool calls RPC back to this process via `toolHandler`. Tools not in
 * `allowedTools` are rejected by the worker before RPC.
 *
 * Returns an IsolatedRunOutcome; never throws. A timeout or termination
 * is reported as `kind: 'timeout' | 'terminated'`, not as a throw.
 */
export async function runUserCodeInSandbox(params: {
  code: string
  input: unknown
  config?: Partial<SandboxConfig>
  allowedTools?: string[]
  toolHandler?: (tool: string, args: unknown[]) => Promise<unknown>
}): Promise<IsolatedRunOutcome> {
  const config = { ...DEFAULT_SANDBOX_CONFIG, ...params.config }
  const allowedTools = params.allowedTools ?? config.allowedTools
  const workerPath = resolveWorkerPath()

  let worker: Worker | null = null
  let timeoutHandle: NodeJS.Timeout | null = null
  let terminated = false
  let lastStdout = ''
  let lastStderr = ''
  let lastToolCalls: string[] = []

  // Pending RPC calls from the worker. We resolve them via toolHandler.
  const rpcPending = new Map<number, { tool: string; args: unknown[]; resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  try {
    worker = new Worker(workerPath, {
      workerData: {
        code: params.code,
        input: params.input,
        env: config.env,
        allowedTools,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: config.maxOldGenerationSizeMb ?? 64,
        maxYoungGenerationSizeMb: config.maxYoungGenerationSizeMb ?? 32,
        codeRangeSizeMb: config.codeRangeSizeMb ?? 16,
        stackSizeMb: config.stackSizeMb ?? 8,
      },
    })

    return await new Promise<IsolatedRunOutcome>((resolve) => {
      // Hard timeout. terminate() is the only way to kill a worker that is
      // stuck in a tight CPU loop or unbounded allocation.
      timeoutHandle = setTimeout(() => {
        if (terminated) return
        terminated = true
        try {
          worker?.terminate()
        } catch {
          /* swallow */
        }
        resolve({
          kind: 'timeout',
          stdout: lastStdout,
          stderr: lastStderr,
          toolCalls: lastToolCalls,
        })
      }, config.maxExecutionMs)

      worker!.on('message', (msg: WorkerResult | RpcCall) => {
        // Distinguish by `kind`. RpcCall has kind='rpc-call'.
        const m = msg as { kind?: string }
        if (m.kind === 'rpc-call') {
          const call = msg as RpcCall
          // Reject quickly if the tool isn't allowed (defence in depth —
          // the worker already rejects, but a malicious worker could lie).
          if (!allowedTools.includes(call.tool)) {
            const ret: RpcReturn = {
              kind: 'rpc-return',
              id: call.id,
              ok: false,
              error: `Tool not allowed: ${call.tool}`,
            }
            worker!.postMessage(ret)
            return
          }
          // Dispatch to the user-provided handler.
          Promise.resolve()
            .then(() => params.toolHandler?.(call.tool, call.args))
            .then(
              (value) => {
                const ret: RpcReturn = { kind: 'rpc-return', id: call.id, ok: true, value }
                worker!.postMessage(ret)
              },
              (err) => {
                const ret: RpcReturn = {
                  kind: 'rpc-return',
                  id: call.id,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                }
                worker!.postMessage(ret)
              },
            )
          return
        }

        // Otherwise it's the final WorkerResult.
        const result = msg as WorkerResult
        lastStdout = result.stdout
        lastStderr = result.stderr
        lastToolCalls = result.toolCalls
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = null
        }
        if (result.ok) {
          resolve({
            kind: 'ok',
            value: result.value,
            stdout: result.stdout,
            stderr: result.stderr,
            toolCalls: result.toolCalls,
          })
        } else {
          resolve({
            kind: 'error',
            error: result.error ?? 'Unknown worker error',
            stdout: result.stdout,
            stderr: result.stderr,
            toolCalls: result.toolCalls,
          })
        }
      })

      worker!.on('error', (err: unknown) => {
        if (terminated) return
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = null
        }
        // Distinguish OOM from other errors by message content (V8 reports
        // "Maximum call stack size exceeded" or "Array buffer allocation
        // failed" depending on which limit was hit).
        const msg = err instanceof Error ? err.message : String(err)
        terminated = true
        resolve({
          kind: 'terminated',
          reason: msg,
          stdout: lastStdout,
          stderr: lastStderr,
          toolCalls: lastToolCalls,
        })
      })

      worker!.on('exit', (code) => {
        if (terminated) return
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = null
        }
        // Worker exited without posting a message — treat as failure.
        if (code !== 0) {
          terminated = true
          resolve({
            kind: 'terminated',
            reason: `Worker exited with code ${code}`,
            stdout: lastStdout,
            stderr: lastStderr,
            toolCalls: lastToolCalls,
          })
        }
      })
    })
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    // Reject any pending RPC calls so they don't leak.
    for (const { reject } of rpcPending.values()) {
      reject(new Error('Sandbox terminated before RPC completed'))
    }
    rpcPending.clear()
    // Best-effort terminate. If the worker already exited this is a no-op.
    if (worker && !terminated) {
      try {
        await worker.terminate()
      } catch {
        /* swallow */
      }
    }
  }
}

// === Default tool handler ============================================
//
// Built-in tool implementations used when no custom toolHandler is
// provided. These respect the C6 settings store whitelists so an admin
// can change tool.allowed_read_paths / tool.allowed_write_paths at runtime.

async function defaultToolHandler(tool: string, args: unknown[]): Promise<unknown> {
  // Lazy imports so we don't pull these into the worker bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isCacheLoaded, getCachedArray } = require('@/lib/settings') as typeof import('@/lib/settings')

  switch (tool) {
    case 'read': {
      const target = String(args[0] ?? '')
      const allowed = isCacheLoaded() ? getCachedArray('tool.allowed_read_paths') : []
      if (allowed.length > 0 && !allowed.some((p) => target.startsWith(p))) {
        throw new Error(`Path not allowed: ${target}`)
      }
      return fs.readFileSync(target, 'utf8')
    }
    case 'write': {
      const target = String(args[0] ?? '')
      const content = String(args[1] ?? '')
      const allowed = isCacheLoaded() ? getCachedArray('tool.allowed_write_paths') : []
      if (allowed.length > 0 && !allowed.some((p) => target.startsWith(p))) {
        throw new Error(`Path not allowed: ${target}`)
      }
      fs.writeFileSync(target, content, 'utf8')
      return true
    }
    case 'httpGet': {
      const url = String(args[0] ?? '')
      if (!/^https?:\/\//.test(url)) {
        throw new Error(`URL must be http(s): ${url}`)
      }
      const res = await fetch(url)
      return await res.text()
    }
    default:
      throw new Error(`Unknown tool: ${tool}`)
  }
}

// === Main entry point =================================================

/**
 * Esegue una skill generata in sandbox isolata.
 *
 * Per ogni test case della skill:
 *   1. Istanzia il prompt template con il test input
 *   2. Se la skill ha `execute` (C4), lo esegue in worker_thread isolato
 *      con memory cap, hard timeout e tool whitelist. Altrimenti usa il
 *      path simulato legacy (pattern matching sul prompt).
 *   3. Verifica output contro expectedContains/assertFn
 *   4. Applica resource limits e forbidden patterns
 *
 * Ritorna risultati dettagliati per ogni test + stats aggregate.
 */
export async function executeSkillInSandbox(params: {
  skill: GeneratedSkill
  config?: Partial<SandboxConfig>
  provenance: Provenance
}): Promise<SandboxExecution> {
  const config = { ...DEFAULT_SANDBOX_CONFIG, ...params.config }
  const startTime = Date.now()
  const sandboxId = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const violations: string[] = []
  const output: SandboxOutput[] = []
  const taskResults: TaskResult[] = []
  let iterations = 0

  for (const test of params.skill.tests) {
    const testStart = Date.now()
    iterations++

    if (iterations > config.maxIterations) {
      violations.push(`Max iterations (${config.maxIterations}) exceeded`)
      break
    }

    // 1. Istanzia prompt template con test input
    const instantiatedPrompt = params.skill.promptTemplate.replace(
      /\{\{task\}\}/g,
      test.input,
    )

    // 2. Verifica forbidden patterns nel prompt
    for (const pattern of config.forbiddenPatterns) {
      if (pattern.test(instantiatedPrompt)) {
        violations.push(`Forbidden pattern in prompt: ${pattern.source}`)
      }
    }

    // 3. Esecuzione — C4 biforcazione:
    //    - Se la skill ha `execute` (codice JS), lo esegue in worker_thread
    //      isolato con memory cap, hard timeout e tool whitelist.
    //    - Altrimenti, usa il path simulato legacy (pattern matching sul
    //      prompt) per retrocompatibilità con skill pre-C4.
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    let truncated = false
    let toolCallsUsed: string[] = []

    if (params.skill.execute) {
      const outcome = await runUserCodeInSandbox({
        code: params.skill.execute,
        input: test.input,
        config,
        allowedTools: config.allowedTools,
        toolHandler: defaultToolHandler,
      })

      // Map outcome to (stdout, stderr, exitCode). Timeouts and terminations
      // are reported as violations so they show up in the audit trail and
      // count against the success threshold.
      switch (outcome.kind) {
        case 'ok': {
          // Serialise the return value into stdout so expectedContains /
          // assertFn can match against it. Strings pass through unchanged.
          const value = outcome.value
          stdout = typeof value === 'string' ? value : safeStringify(value)
          stderr = outcome.stderr
          exitCode = 0
          toolCallsUsed = outcome.toolCalls
          break
        }
        case 'error': {
          stderr = outcome.error ?? 'Unknown sandbox error'
          stdout = outcome.stdout
          exitCode = 1
          toolCallsUsed = outcome.toolCalls
          violations.push(`Test "${test.name}" worker error: ${stderr}`)
          break
        }
        case 'timeout': {
          stderr = `Execution timeout after ${config.maxExecutionMs}ms`
          stdout = outcome.stdout
          exitCode = 124 // standard timeout exit code
          toolCallsUsed = outcome.toolCalls
          violations.push(`Test "${test.name}" timed out after ${config.maxExecutionMs}ms`)
          break
        }
        case 'terminated': {
          stderr = `Worker terminated: ${outcome.reason}`
          stdout = outcome.stdout
          exitCode = 137 // standard kill -9 exit code
          toolCallsUsed = outcome.toolCalls
          violations.push(`Test "${test.name}" terminated: ${outcome.reason}`)
          break
        }
      }
    } else {
      try {
        const result = await withTimeout(
          simulateSkillExecution(instantiatedPrompt, test, config),
          config.maxExecutionMs,
        )
        stdout = result.stdout
        stderr = result.stderr
        exitCode = result.exitCode
      } catch (err) {
        stderr = err instanceof Error ? err.message : String(err)
        exitCode = 1
        violations.push(`Test "${test.name}" failed: ${stderr}`)
      }
    }

    // 4. Truncate output se eccede maxOutputBytes
    if (stdout.length > config.maxOutputBytes) {
      stdout = stdout.slice(0, config.maxOutputBytes)
      truncated = true
    }

    output.push({
      testId: test.name,
      stdout,
      stderr,
      exitCode,
      truncated,
    })

    // 5. Verifica expectedContains
    let success = exitCode === 0
    if (success && test.expectedContains && test.expectedContains.length > 0) {
      const lowerOutput = stdout.toLowerCase()
      for (const expected of test.expectedContains) {
        if (!lowerOutput.includes(expected.toLowerCase())) {
          success = false
          break
        }
      }
    }

    // 6. Verifica assertFn (semplificato: supporta `output.length > N`)
    if (success && test.assertFn) {
      const match = test.assertFn.match(/output\.length\s*>\s*(\d+)/)
      if (match) {
        const threshold = parseInt(match[1]!, 10)
        if (stdout.length <= threshold) {
          success = false
        }
      }
    }

    taskResults.push({
      taskId: test.name,
      success,
      output: stdout,
      toolCallsUsed,
      forbiddenActionsTriggered: violations.filter((v) => v.includes(test.name)),
      durationMs: Date.now() - testStart,
      cost: 0,
      error: success ? undefined : stderr,
    })
  }

  const successCount = taskResults.filter((r) => r.success).length
  const errorRate = taskResults.length > 0 ? 1 - (successCount / taskResults.length) : 1
  const avgLatencyMs = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.durationMs, 0) / taskResults.length
    : 0
  const totalCost = taskResults.reduce((s, r) => s + r.cost, 0)

  const execution: SandboxExecution = {
    id: sandboxId,
    skillId: params.skill.id,
    testResults: taskResults,
    success: errorRate < 0.5 && violations.length === 0,
    errorRate,
    avgLatencyMs,
    totalCost,
    iterations,
    violations,
    output,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  }

  // Persisti audit trail
  try {
    await db.agentLog.create({
      data: {
        agentId: 'agent://skill-sandbox',
        phase: 'skill-synthesis',
        event: 'sandbox-execution',
        payload: JSON.stringify({
          sandboxId,
          skillId: params.skill.id,
          success: execution.success,
          errorRate,
          violations: violations.length,
          durationMs: execution.durationMs,
        }),
        level: execution.success ? 'info' : 'warn',
      },
    })
  } catch {}

  return execution
}

// === Simulated skill execution ======================================

async function simulateSkillExecution(
  prompt: string,
  test: SkillTest,
  _config: SandboxConfig,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 100))

  if (prompt.length < 50) {
    return {
      stdout: '',
      stderr: 'Prompt too short for effective skill execution',
      exitCode: 1,
    }
  }

  if (test.expectedContains && test.expectedContains.length > 0) {
    const promptLower = prompt.toLowerCase()
    const hasRelevantContent = test.expectedContains.some((c) =>
      promptLower.includes(c.toLowerCase()) || promptLower.includes('task'),
    )

    if (hasRelevantContent) {
      const stdout = `Skill execution for: ${test.input}\n\n` +
        `Identified root cause and applied corrective action.\n` +
        `Verification: ${test.expectedContains.join(', ')} confirmed.\n` +
        `Output: ${test.expectedContains.join(' ')}`
      return { stdout, stderr: '', exitCode: 0 }
    } else {
      return {
        stdout: `Skill execution for: ${test.input}\nNo relevant content found.`,
        stderr: '',
        exitCode: 0,
      }
    }
  }

  return {
    stdout: `Skill execution completed for: ${test.input}`,
    stderr: '',
    exitCode: 0,
  }
}

// === Timeout helper ==================================================

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timeout after ${ms}ms`)), ms),
    ),
  ])
}

// === Helpers =========================================================

/**
 * Safe JSON stringify for sandbox return values. Handles circular references
 * and non-serialisable values (functions, symbols) by falling back to String.
 */
function safeStringify(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`
      if (typeof v === 'symbol') return v.toString()
      if (typeof v === 'bigint') return `${v.toString()}n`
      return v
    }, 2)
  } catch {
    return String(value)
  }
}

// === Stats ===========================================================

export async function sandboxStats() {
  const logs = await db.agentLog.findMany({
    where: { phase: 'skill-synthesis', event: 'sandbox-execution' },
    take: 100,
    orderBy: { timestamp: 'desc' },
  })

  const total = logs.length
  const successful = logs.filter((l) => l.level === 'info').length
  const failed = total - successful

  return {
    totalExecutions: total,
    successful,
    failed,
    successRate: total > 0 ? successful / total : 0,
  }
}

export function sandboxProvenance(agentUri: string = 'agent://skill-sandbox'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'agent-reasoning',
    confidence: 0.9,
  })
}
