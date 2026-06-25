/**
 * ReAct Loop — WS1.4b
 *
 * Loop "pensa → chiama tool → osserva → ripeti" usando LLM tool-calling.
 *
 * Sostituisce il semplice `zai.chat.completions.create` (solo testo)
 * con un loop che permette all'LLM di:
 *   1. Pensare (THINK): ragionare sul task
 *   2. Chiamare un tool (ACT): invocare filesystem.read, http.fetch, etc.
 *   3. Osservare (OBSERVE): leggere il risultato del tool
 *   4. Ripetere finché non ha una risposta finale
 *
 * Implementazione:
 *   - Usa il tool-calling nativo di ZAI/GLM (function calling)
 *   - Max 10 iterazioni (safety cap)
 *   - Ogni iterazione: LLM call con history + tool results
 *   - Se l'LLM non ha tool calls nella risposta → risposta finale
 *
 * Fallback: se LLM non supporta tool-calling, ritorna testo semplice.
 */

import { dispatchTool, getDefaultScopes, type ToolCallRequest } from './tool-dispatcher'
import { listBuiltinTools } from './builtin-tools'
import { recordCostEntry, calculateCost } from '@/lib/kernel/cost-ledger'

// === Tipi ============================================================

export interface ReActIteration {
  iteration: number
  thought: string
  toolCalls?: Array<{
    name: string
    arguments: Record<string, unknown>
    result: string
    success: boolean
    durationMs: number
  }>
  isFinal: boolean
}

export interface ReActResult {
  finalAnswer: string
  iterations: ReActIteration[]
  totalToolCalls: number
  totalCost: number
  totalTokensIn: number
  totalTokensOut: number
  durationMs: number
  source: 'react' | 'fallback' // fallback = LLM senza tool-calling
}

export interface ReActOptions {
  agentId: string
  planId: string
  taskId: string
  task: string
  context?: string // contesto aggiuntivo (goal globale, ecc.)
  maxIterations?: number
  signal?: AbortSignal
  onIteration?: (iteration: ReActIteration) => void
}

const MAX_ITERATIONS = 10
const SYSTEM_PROMPT = `You are an autonomous agent in the SOTA Agentic OS. You can use tools to accomplish tasks.

When you need information or need to perform an action, call a tool. When you have enough information to answer, provide your final answer as plain text (no tool calls).

Available tools will be provided as function definitions. Use them when needed.`

// === Main entry point =================================================

export async function executeReActLoop(options: ReActOptions): Promise<ReActResult> {
  const startTime = Date.now()
  const maxIterations = options.maxIterations || MAX_ITERATIONS
  const iterations: ReActIteration[] = []
  let totalToolCalls = 0
  let totalCost = 0
  let totalTokensIn = 0
  let totalTokensOut = 0

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()

    // Prepara tool definitions per LLM
    const tools = listBuiltinTools().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Task: ${options.task}\n${options.context ? `Context: ${options.context}` : ''}`,
      },
    ]

    const allowedScopes = getDefaultScopes(options.agentId)

    for (let i = 0; i < maxIterations; i++) {
      if (options.signal?.aborted) break

      // === THINK: LLM call ===
      const completion = await zai.chat.completions.create({
        messages: messages as any,
        ...(tools.length > 0 && { tools: tools as any }),
        max_tokens: 500,
      })

      const choice = completion.choices?.[0]
      if (!choice) break

      const inputTokens = Math.ceil(messages.map((m) => m.content).join('').length / 4)
      const outputTokens = Math.ceil((choice.message?.content || '').length / 4)
      totalTokensIn += inputTokens
      totalTokensOut += outputTokens
      const cost = calculateCost('zai-glm', inputTokens, outputTokens)
      totalCost += cost

      await recordCostEntry({
        agentId: options.agentId,
        model: 'zai-glm',
        phase: 'react_iteration',
        tokensIn: inputTokens,
        tokensOut: outputTokens,
        cost,
      }).catch(() => {})

      // === ACT: check if LLM wants to call tools ===
      const toolCalls = choice.message?.tool_calls

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls → final answer
        const iteration: ReActIteration = {
          iteration: i + 1,
          thought: choice.message?.content || '',
          isFinal: true,
        }
        iterations.push(iteration)
        options.onIteration?.(iteration)

        return {
          finalAnswer: iteration.thought,
          iterations,
          totalToolCalls,
          totalCost,
          totalTokensIn,
          totalTokensOut,
          durationMs: Date.now() - startTime,
          source: 'react',
        }
      }

      // === Execute tool calls ===
      messages.push({
        role: 'assistant',
        content: choice.message?.content || '',
        tool_calls: toolCalls,
      })

      const toolResults: Array<{ name: string; arguments: Record<string, unknown>; result: string; success: boolean; durationMs: number }> = []

      for (const tc of toolCalls) {
        if (options.signal?.aborted) break

        const toolCall: ToolCallRequest = {
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        }

        const result = await dispatchTool(toolCall, {
          agentId: options.agentId,
          planId: options.planId,
          taskId: options.taskId,
          allowedScopes,
        })

        totalToolCalls++

        toolResults.push({
          name: toolCall.name,
          arguments: toolCall.arguments,
          result: result.output || result.error || '',
          success: result.success,
          durationMs: result.durationMs,
        })

        // === OBSERVE: feed result back to LLM ===
        messages.push({
          role: 'tool',
          content: result.success
            ? result.output
            : `Error: ${result.error}`,
          tool_call_id: tc.id,
        } as any)
      }

      const iteration: ReActIteration = {
        iteration: i + 1,
        thought: choice.message?.content || '',
        toolCalls: toolResults,
        isFinal: false,
      }
      iterations.push(iteration)
      options.onIteration?.(iteration)
    }

    // Max iterations reached
    return {
      finalAnswer: iterations[iterations.length - 1]?.thought || 'Max iterations reached without final answer.',
      iterations,
      totalToolCalls,
      totalCost,
      totalTokensIn,
      totalTokensOut,
      durationMs: Date.now() - startTime,
      source: 'react',
    }
  } catch (err: any) {
    // Fallback: if LLM tool-calling not available, use simple completion
    return executeFallback(options, startTime, err)
  }
}

// === Fallback (no tool-calling) ======================================

async function executeFallback(
  options: ReActOptions,
  startTime: number,
  error: any,
): Promise<ReActResult> {
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()

    const messages = [
      {
        role: 'system' as const,
        content: `Sei l'agente ${options.agentId} di un sistema agentico. Esegui il task assegnato in modo conciso (massimo 200 parole).`,
      },
      {
        role: 'user' as const,
        content: `Task: ${options.task}\n${options.context ? `Contesto: ${options.context}` : ''}`,
      },
    ]

    const completion = await zai.chat.completions.create({ messages })
    const output = completion.choices?.[0]?.message?.content || ''

    const inputTokens = Math.ceil(messages.map((m) => m.content).join('').length / 4)
    const outputTokens = Math.ceil(output.length / 4)
    const cost = calculateCost('zai-glm', inputTokens, outputTokens)

    return {
      finalAnswer: output,
      iterations: [{
        iteration: 1,
        thought: output,
        isFinal: true,
      }],
      totalToolCalls: 0,
      totalCost: cost,
      totalTokensIn: inputTokens,
      totalTokensOut: outputTokens,
      durationMs: Date.now() - startTime,
      source: 'fallback',
    }
  } catch (fallbackErr: any) {
    return {
      finalAnswer: `Error: ${error.message}. Fallback also failed: ${fallbackErr.message}`,
      iterations: [],
      totalToolCalls: 0,
      totalCost: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      durationMs: Date.now() - startTime,
      source: 'fallback',
    }
  }
}
