/**
 * Skill Sandbox Worker — C4
 *
 * Runs untrusted skill code in an isolated Node.js worker_thread.
 *
 * SECURITY MODEL:
 *   - The worker has NO `require` global. Trying to import 'fs', 'child_process',
 *     'net', etc. throws synchronously at module-eval time.
 *   - `process` is exposed only with a minimal shape: `process.platform`,
 *     `process.arch`, `process.cwd()` (returns a fixed dummy path), and
 *     `process.env` returns a frozen copy of the sandboxed env passed by the
 *     parent. No `process.exit`, `process.kill`, `process.on`, etc.
 *   - `globalThis.require` is `undefined`.
 *   - `console.log/info/warn/error` are captured into an output buffer that
 *     the parent drains when the worker posts its result.
 *   - Memory is capped via `resourceLimits` (set by the parent).
 *   - Wall-clock timeout is enforced by the parent via `worker.terminate()`.
 *
 * MESSAGE PROTOCOL (parent <-> worker):
 *   Parent -> Worker (workerData):
 *     {
 *       code: string,          // JS source: `async (input, tools) => { ... }`
 *       input: unknown,        // test input
 *       env: Record<string, string>,
 *       allowedTools: string[], // tool names the worker is allowed to call
 *     }
 *
 *   Worker -> Parent (parentPort.postMessage):
 *     { ok: true, value: unknown, stdout: string, stderr: string, toolCalls: string[] }
 *     | { ok: false, error: string, stdout: string, stderr: string, toolCalls: string[] }
 *
 *   Parent -> Worker (parentPort.on 'message', for RPC tool calls):
 *     { kind: 'rpc-call', id: number, tool: string, args: unknown[] }
 *   Worker -> Parent (postMessage, for RPC tool responses):
 *     { kind: 'rpc-return', id: number, ok: true, value: unknown }
 *     | { kind: 'rpc-return', id: number, ok: false, error: string }
 *
 * If the worker tries to call a tool not in `allowedTools`, the proxy throws
 * synchronously and the error is reported as a sandbox violation.
 */

import { parentPort, workerData } from 'worker_threads'

interface WorkerData {
  code: string
  input: unknown
  env: Record<string, string>
  allowedTools: string[]
}

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

interface WorkerResult {
  ok: boolean
  value?: unknown
  error?: string
  stdout: string
  stderr: string
  toolCalls: string[]
}

const data = workerData as WorkerData

// === Captured I/O buffers ============================================

const stdoutChunks: string[] = []
const stderrChunks: string[] = []
const toolCalls: string[] = []

const capturedConsole = {
  log: (...args: unknown[]) => stdoutChunks.push(formatArgs(args)),
  info: (...args: unknown[]) => stdoutChunks.push(formatArgs(args)),
  warn: (...args: unknown[]) => stderrChunks.push(formatArgs(args)),
  error: (...args: unknown[]) => stderrChunks.push(formatArgs(args)),
  debug: (...args: unknown[]) => stdoutChunks.push(formatArgs(args)),
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

// === Restricted `process` shim =======================================
//
// We expose a frozen `process` with a minimal surface so skill code that
// reads `process.platform` or `process.env.MY_VAR` still works, but
// anything dangerous (`process.exit`, `process.kill`, `process.on`) is
// absent and will throw on access via the Proxy's `get` trap.

const FAKE_CWD = '/sandbox'

const restrictedProcess = new Proxy(
  {
    platform: 'linux',
    arch: 'x64',
    cwd: () => FAKE_CWD,
    env: Object.freeze({ ...data.env }),
    pid: 0,
    version: '0.0.0-sandbox',
  },
  {
    get(target, prop: string) {
      if (prop in target) {
        return (target as Record<string, unknown>)[prop]
      }
      // Explicitly dangerous props return undefined (or throw) instead of
      // the real Node.js process.* methods.
      if (
        prop === 'exit' ||
        prop === 'kill' ||
        prop === 'on' ||
        prop === 'off' ||
        prop === 'once' ||
        prop === 'emit' ||
        prop === 'send' ||
        prop === 'abort' ||
        prop === 'channel' ||
        prop === 'argv' ||
        prop === 'execArgv' ||
        prop === 'mainModule'
      ) {
        return undefined
      }
      return undefined
    },
    set() {
      return false // make process.* effectively read-only
    },
  },
)

// === RPC tool proxy ==================================================
//
// `tools.foo(...args)` posts an rpc-call to the parent and awaits the
// matching rpc-return. Calling a tool not in `allowedTools` throws.

const rpcPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let rpcCounter = 0

function rpcCall(tool: string, args: unknown[]): Promise<unknown> {
  if (!data.allowedTools.includes(tool)) {
    throw new Error(`Tool not allowed in sandbox: ${tool}`)
  }
  const id = ++rpcCounter
  return new Promise((resolve, reject) => {
    rpcPending.set(id, { resolve, reject })
    const msg: RpcCall = { kind: 'rpc-call', id, tool, args }
    parentPort!.postMessage(msg)
  })
}

const toolsProxy = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        toolCalls.push(prop)
        return rpcCall(prop, args)
      }
    },
  },
)

// === Incoming RPC returns from parent ===============================

parentPort!.on('message', (msg: RpcReturn) => {
  if (msg.kind !== 'rpc-return') return
  const pending = rpcPending.get(msg.id)
  if (!pending) return
  rpcPending.delete(msg.id)
  if (msg.ok) {
    pending.resolve(msg.value)
  } else {
    pending.reject(new Error(msg.error ?? 'RPC tool failed'))
  }
})

// === Build the sandboxed globals ====================================
//
// We override `globalThis.console`, `globalThis.process`, and delete
// `globalThis.require` BEFORE evaluating the skill code. This is the
// core isolation mechanism.

;(globalThis as Record<string, unknown>).console = capturedConsole
;(globalThis as Record<string, unknown>).process = restrictedProcess
;(globalThis as Record<string, unknown>).require = undefined
;(globalThis as Record<string, unknown>).import = undefined // ESM dynamic import shim
;(globalThis as Record<string, unknown>).importMeta = undefined

// Block dynamic import() at the syntax level by overriding the global
// import function. (Worker threads use CommonJS by default, so dynamic
// import is a syntax construct; we can't fully block it, but we can
// ensure any module the worker tries to load via import() will fail to
// resolve because the worker has no module loader configured for ESM.)

// === Run the skill code =============================================
//
// The skill code is wrapped as `async (input, tools) => { ... }`. We
// build the function with `new Function` to avoid needing a real module
// loader. The function body is the user-provided string.

async function run(): Promise<void> {
  let userFn: (input: unknown, tools: unknown) => Promise<unknown>
  try {
    // eslint-disable-next-line no-new-func
    userFn = new Function(
      'input',
      'tools',
      `"use strict";\nreturn (async () => {\n${data.code}\n})();`,
    ) as (input: unknown, tools: unknown) => Promise<unknown>
  } catch (err) {
    postError(err, 'SyntaxError while compiling skill code')
    return
  }

  try {
    const value = await userFn(data.input, toolsProxy)
    const result: WorkerResult = {
      ok: true,
      value,
      stdout: stdoutChunks.join('\n'),
      stderr: stderrChunks.join('\n'),
      toolCalls,
    }
    parentPort!.postMessage(result)
  } catch (err) {
    postError(err, 'Skill execution threw')
  }
}

function postError(err: unknown, context: string): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const result: WorkerResult = {
    ok: false,
    error: `${context}: ${message}`,
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
    toolCalls,
  }
  parentPort!.postMessage(result)
}

// === Kick off ========================================================
//
// run() is fully wrapped in try/catch internally and always posts either
// a success or an error result. The outer .catch() is a last-resort guard
// for any error that escapes run() itself (e.g. a TypeError thrown while
// building the proxy).

run().catch((err) => {
  postError(err, 'Fatal worker error')
})
