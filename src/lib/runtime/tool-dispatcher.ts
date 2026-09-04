/**
 * Tool Dispatcher — WS1.4a
 *
 * Collega tool-registry → esecuzione effettiva (builtin/HTTP/MCP).
 *
 * Per ogni tool call dall'LLM:
 *   1. Verifica che il tool esista (builtin o registrato nel Tool Ecosystem)
 *   2. Verifica i permessi (scope check via tool-registry)
 *   3. Esegue il tool (builtin function, HTTP endpoint, o MCP client)
 *   4. Ritorna il risultato all'LLM per il prossimo ciclo ReAct
 *
 * Sicurezza:
 *   - Scope enforcement: ogni tool dichiara requiredScopes, verificati prima dell'esecuzione
 *   - Timeout: ogni tool ha un timeout (default 10s)
 *   - Path restrictions: filesystem tools limitati a whitelist
 *   - Audit trail: ogni tool call registrato su AgentLog
 */

import { db } from '@/lib/db'
import { checkToolPermission } from '@/lib/kernel/tool-registry'
import { getBuiltinTool, type BuiltinTool, type ToolExecutionContext, type ToolResult } from './builtin-tools'

// === Tipi ============================================================

export interface ToolCallRequest {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolCallResult extends ToolResult {
  toolName: string
  durationMs: number
}

export interface DispatchOptions {
  agentId: string
  planId: string
  taskId: string
  timeout?: number
  allowedScopes?: string[] // scope concessi all'agente (per builtin tools)
  requiredScopes?: string[] // scope richiesti dal tool registrato (default: ['tool:exec'])
  // G2 (LTL audit Fase B) — Taint IDs per checkSink prima di tool sensibili.
  // Se presente, dispatchTool chiama checkSink('tool_call:'+name, taintIds)
  // prima di eseguire il tool. Se checkSink blocca, il tool non viene eseguito.
  taintIds?: string[]
}

// === Main dispatcher =================================================

/**
 * Esegue un tool call verificando permessi e gestendo timeout.
 *
 * Supporta 3 tipi di tool:
 *   1. Builtin (filesystem.read, http.fetch, memory.search, etc.)
 *   2. HTTP-based (tool registrati con endpoint HTTP)
 *   3. MCP-based (tool da server MCP esterni)
 */
export async function dispatchTool(
  call: ToolCallRequest,
  options: DispatchOptions,
): Promise<ToolCallResult> {
  const startTime = Date.now()
  const timeout = options.timeout || 10_000

  // G2 (LTL audit Fase B) — Taint check: prima di eseguire qualsiasi tool,
  // verifica se ci sono taintIds attivi e se il tool è un sink sensibile.
  // Se checkSink blocca, il tool non viene eseguito.
  if (options.taintIds && options.taintIds.length > 0) {
    try {
      const { checkSink } = await import('@/lib/kernel/taint')
      const sinkName = `tool_call:${call.name}`
      const taintResult = await checkSink(sinkName, options.taintIds)
      if (!taintResult.allowed) {
        // Taint blocca il tool: ritorna errore senza eseguire
        await auditToolCall(call.name, options, {
          success: false,
          output: '',
          error: `Taint block: ${taintResult.reason}`,
        }, Date.now() - startTime)
        return {
          toolName: call.name,
          success: false,
          output: '',
          error: `Blocked by Taint Tracking: ${taintResult.reason}. Flussi tainted hanno raggiunto il sink ${sinkName}.`,
          durationMs: Date.now() - startTime,
        }
      }
    } catch {
      // Non bloccante: se checkSink fallisce, continua (fail-open)
    }
  }

  // 1. Cerca builtin tool
  const builtin = getBuiltinTool(call.name)
  if (builtin) {
    return executeBuiltin(builtin, call, options, startTime, timeout)
  }

  // 2. Cerca tool registrato nel Tool Ecosystem (DB)
  const registeredTool = await db.tool.findFirst({
    where: { toolId: call.name, active: true },
  })

  if (registeredTool) {
    return executeRegistered(registeredTool, call, options, startTime, timeout)
  }

  // 3. Tool non trovato
  return {
    toolName: call.name,
    success: false,
    output: '',
    error: `Tool not found: ${call.name}`,
    durationMs: Date.now() - startTime,
  }
}

// === Builtin execution ===============================================

async function executeBuiltin(
  tool: BuiltinTool,
  call: ToolCallRequest,
  options: DispatchOptions,
  startTime: number,
  timeout: number,
): Promise<ToolCallResult> {
  // Scope check
  const allowedScopes = options.allowedScopes || []
  for (const required of tool.requiredScopes) {
    if (!allowedScopes.includes(required) && !allowedScopes.includes('*')) {
      return {
        toolName: call.name,
        success: false,
        output: '',
        error: `Permission denied: scope '${required}' not granted to agent ${options.agentId}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  const ctx: ToolExecutionContext = {
    agentId: options.agentId,
    planId: options.planId,
    taskId: options.taskId,
    timeout,
    sandboxEnabled: true,
  }

  // B2 fix (Tool Manager audit Fase B): retry logic su builtin tool execution.
  // PRIMA: se tool.execute() falliva (timeout, I/O error), ritornava subito errore.
  // ORA: max 2 retry (3 tentativi totali) con backoff 100ms * attempt.
  // Non ritenta su errori di permesso (già checkati sopra).
  const MAX_EXEC_RETRIES = 2
  const maxAttempts = MAX_EXEC_RETRIES + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await withTimeout(tool.execute(call.arguments, ctx), timeout)
      await auditToolCall(call.name, options, result, Date.now() - startTime)
      return { ...result, toolName: call.name, durationMs: Date.now() - startTime }
    } catch (err: any) {
      if (attempt < maxAttempts) {
        // eslint-disable-next-line no-console
        console.warn(`[tool-dispatcher] builtin '${call.name}' attempt ${attempt}/${maxAttempts} failed: ${err.message}. Retrying...`)
        await new Promise((r) => setTimeout(r, 100 * attempt))
        continue
      }
      // Ultimo tentativo fallito → ritorna errore
      const errorResult: ToolResult = {
        success: false,
        output: '',
        error: err.message,
      }
      await auditToolCall(call.name, options, errorResult, Date.now() - startTime)
      return { ...errorResult, toolName: call.name, durationMs: Date.now() - startTime }
    }
  }

  // Unreachable (loop always returns), but TypeScript needs it
  return {
    toolName: call.name,
    success: false,
    output: '',
    error: 'Unexpected: retry loop exhausted without return',
    durationMs: Date.now() - startTime,
  }
}

// === Registered tool execution (HTTP + MCP) — C1+C2 =================
// C1: ToolPermission.toolId ora standardizzato su tool.id (cuid interno).
//     - installTool (tool-registry.ts) scrive tool.id
//     - admin/tools grant-scope ora fa lookup tool.toolId → tool.id e scrive tool.id
//     - qui query per tool.id (NON tool.toolId)
// C2: scope check ora è scope-based (non existence-based).
//     Verifica TUTTI gli scopes richiesti siano granted per il tool,
//     non solo "almeno un permesso granted".

async function executeRegistered(
  tool: { id: string; toolId: string; name: string; description: string | null; transport?: string | null; endpoint?: string | null; apiKey?: string | null },
  call: ToolCallRequest,
  options: DispatchOptions,
  startTime: number,
  timeout: number,
): Promise<ToolCallResult> {
  // C2 — Scope check: ogni scope richiesto deve essere granted per il tool.
  // Default richiesto: 'tool:exec'. Se transport=http e method POST, anche 'network:post'.
  // Se transport=mcp, anche 'network:get' (MCP tool call via HTTP).
  const requiredScopes = new Set<string>(options.requiredScopes || ['tool:exec'])
  const method = (call.arguments.__method as string) || (call.arguments.method as string) || 'POST'
  if (tool.transport === 'http') {
    requiredScopes.add(method.toUpperCase() === 'GET' ? 'network:get' : 'network:post')
  } else if (tool.transport === 'mcp') {
    requiredScopes.add('network:get')
  }

  for (const scope of requiredScopes) {
    const check = await checkToolPermission(tool.toolId, scope)
    if (!check.authorized) {
      return {
        toolName: call.name,
        success: false,
        output: '',
        error: `Permission denied: ${check.reason}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  // Dispatch basato sul transport
  const transport = tool.transport
  const endpoint = tool.endpoint

  if (!transport || !endpoint) {
    return {
      toolName: call.name,
      success: false,
      output: '',
      error: `Tool '${tool.toolId}' has no transport/endpoint configured. Set transport='http'|'mcp' and endpoint URL via Admin → Tools.`,
      durationMs: Date.now() - startTime,
    }
  }

  // B2 fix (Tool Manager audit Fase B): retry logic su registered tool execution.
  // PRIMA: se executeHttpTool/executeMcpTool falliva (network error, timeout),
  // ritornava subito errore. ORA: max 2 retry con backoff 100ms * attempt.
  const MAX_EXT_RETRIES = 2
  const maxExtAttempts = MAX_EXT_RETRIES + 1

  for (let attempt = 1; attempt <= maxExtAttempts; attempt++) {
    try {
      let result: ToolResult

      if (transport === 'http') {
        result = await executeHttpTool(endpoint, call.arguments, tool.apiKey || undefined, timeout)
      } else if (transport === 'mcp') {
        result = await executeMcpTool(endpoint, call.name, call.arguments, tool.apiKey || undefined, timeout)
      } else {
        result = {
          success: false,
          output: '',
          error: `Unknown transport: ${transport}. Use 'http' or 'mcp'.`,
        }
      }

      // Se successo, ritorna subito
      if (result.success) {
        await auditToolCall(call.name, options, result, Date.now() - startTime)
        return { ...result, toolName: call.name, durationMs: Date.now() - startTime }
      }

      // Se fallito e non ultimo tentativo, ritenta
      if (attempt < maxExtAttempts) {
        // eslint-disable-next-line no-console
        console.warn(`[tool-dispatcher] external '${call.name}' attempt ${attempt}/${maxExtAttempts} failed: ${result.error}. Retrying...`)
        await new Promise((r) => setTimeout(r, 100 * attempt))
        continue
      }

      // Ultimo tentativo fallito → ritorna errore
      await auditToolCall(call.name, options, result, Date.now() - startTime)
      return { ...result, toolName: call.name, durationMs: Date.now() - startTime }
    } catch (err: any) {
      if (attempt < maxExtAttempts) {
        // eslint-disable-next-line no-console
        console.warn(`[tool-dispatcher] external '${call.name}' attempt ${attempt}/${maxExtAttempts} threw: ${err.message}. Retrying...`)
        await new Promise((r) => setTimeout(r, 100 * attempt))
        continue
      }
      const errorResult: ToolResult = {
        success: false,
        output: '',
        error: err.message,
      }
      await auditToolCall(call.name, options, errorResult, Date.now() - startTime)
      return { ...errorResult, toolName: call.name, durationMs: Date.now() - startTime }
    }
  }

  // Unreachable
  return {
    toolName: call.name,
    success: false,
    output: '',
    error: 'Unexpected: retry loop exhausted',
    durationMs: Date.now() - startTime,
  }
}

/**
 * C2 — Esegue un tool HTTP: POST con JSON body all'endpoint configurato.
 */
async function executeHttpTool(
  endpoint: string,
  args: Record<string, unknown>,
  apiKey: string | undefined,
  timeout: number,
): Promise<ToolResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeout),
    })

    const text = await response.text()
    const truncated = text.length > 50000
    const output = truncated ? text.slice(0, 50000) + '\n...[truncated]' : text

    return {
      success: response.ok,
      output,
      error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      metadata: { status: response.status, size: text.length, truncated },
    }
  } catch (err: any) {
    return { success: false, output: '', error: err.message }
  }
}

/**
 * C2 — Esegue un tool MCP: usa mcp-client per tools/call sul server esterno.
 */
async function executeMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  apiKey: string | undefined,
  timeout: number,
): Promise<ToolResult> {
  try {
    const { callExternalTool } = await import('@/lib/mcp-client/client')
    const result = await callExternalTool({
      serverUrl,
      toolName,
      args,
      apiKey,
    })

    return {
      success: result.success,
      output: result.output,
      error: result.error,
    }
  } catch (err: any) {
    return { success: false, output: '', error: err.message }
  }
}

// === Audit trail =====================================================

async function auditToolCall(
  toolName: string,
  options: DispatchOptions,
  result: ToolResult,
  durationMs: number,
): Promise<void> {
  try {
    await db.agentLog.create({
      data: {
        agentId: options.agentId,
        phase: 'tool-execution',
        event: `tool:${toolName}`,
        payload: JSON.stringify({
          toolName,
          planId: options.planId,
          taskId: options.taskId,
          success: result.success,
          error: result.error,
          outputLength: result.output.length,
          durationMs,
        }),
        level: result.success ? 'info' : 'warn',
      },
    })
  } catch {
    // Non bloccante
  }
}

// === Timeout helper ==================================================

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timeout after ${ms}ms`)), ms),
    ),
  ])
}

// === Default scopes per agentId ======================================

/**
 * Scope predefiniti per agente. In produzione: caricare da AgentPolicy (Fase 3.3).
 */
export function getDefaultScopes(agentId: string): string[] {
  // Agenti operazionali hanno filesystem + network
  if (['coding', 'data', 'orchestrator', 'curator'].includes(agentId)) {
    return ['filesystem:read', 'filesystem:write', 'network:get', 'db:read']
  }
  // Agenti strategic hanno solo read
  if (['architect', 'planner', 'research', 'world-model'].includes(agentId)) {
    return ['filesystem:read', 'network:get', 'db:read']
  }
  // Agenti di verifica hanno solo read
  if (['verifier', 'controller', 'qa', 'security'].includes(agentId)) {
    return ['filesystem:read', 'db:read']
  }
  // Default: read-only
  return ['filesystem:read', 'db:read']
}
