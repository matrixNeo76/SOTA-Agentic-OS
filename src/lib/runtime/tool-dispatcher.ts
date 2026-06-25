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
  allowedScopes?: string[] // scope concessi all'agente
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

  try {
    const result = await withTimeout(tool.execute(call.arguments, ctx), timeout)
    await auditToolCall(call.name, options, result, Date.now() - startTime)
    return { ...result, toolName: call.name, durationMs: Date.now() - startTime }
  } catch (err: any) {
    const errorResult: ToolResult = {
      success: false,
      output: '',
      error: err.message,
    }
    await auditToolCall(call.name, options, errorResult, Date.now() - startTime)
    return { ...errorResult, toolName: call.name, durationMs: Date.now() - startTime }
  }
}

// === Registered tool execution (HTTP-based) ==========================

async function executeRegistered(
  tool: { toolId: string; name: string; description: string | null },
  call: ToolCallRequest,
  options: DispatchOptions,
  startTime: number,
  timeout: number,
): Promise<ToolCallResult> {
  // Cerca permessi per questo tool
  const permissions = await db.toolPermission.findMany({
    where: { toolId: tool.toolId, granted: true },
  })

  if (permissions.length === 0) {
    return {
      toolName: call.name,
      success: false,
      output: '',
      error: `No permissions granted for tool: ${tool.toolId}`,
      durationMs: Date.now() - startTime,
    }
  }

  // Per ora i tool registrati non hanno un endpoint HTTP configurato.
  // In produzione: cercare un campo `endpoint` nel tool record e fare fetch.
  // WS1.4d aggiungerà supporto MCP client per tool esterni.
  return {
    toolName: call.name,
    success: false,
    output: '',
    error: `Registered tool '${tool.toolId}' has no execution endpoint configured. Use builtin tools or MCP client (WS1.4d).`,
    durationMs: Date.now() - startTime,
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
