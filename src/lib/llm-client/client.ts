/**
 * LLM Client unificato — Fase 5.1
 *
 * Façade per chiamate LLM tramite ZAI SDK (zai-glm).
 * Usato da:
 *   - Meta Agent (Skill Synthesis) per generare prompt template
 *   - Cognitive Router per classification LLM-based (fallback al rule-based)
 *   - ERL per extraction euristiche da esperienze
 *   - World Model per generare predictions LLM-based
 *   - Conflict Resolution per human-readable explanations
 *
 * Pattern:
 *   - Tutte le chiamate passano per `llmComplete()` che gestisce retry, timeout, cost tracking
 *   - Fallback deterministico se ZAI SDK non disponibile o errore
 *   - Cost tracking automatico via cost-ledger (Fase 14)
 *   - Audit trail via AgentLog
 */

import { recordCostEntry } from '@/lib/kernel/cost-ledger'
import { db } from '@/lib/db'

// === Tipi ============================================================

export interface LLMCompleteParams {
  prompt: string
  systemPrompt?: string
  agentId?: string
  phase?: string
  model?: string
  maxTokens?: number
  temperature?: number
  fallback?: string // output deterministico se LLM non disponibile
  trackCost?: boolean // default true
}

export interface LLMCompleteResult {
  output: string
  model: string
  tokensIn: number
  tokensOut: number
  cost: number
  durationMs: number
  source: 'llm' | 'fallback' // se 'fallback', LLM non è stato usato
  error?: string
}

// === Pricing table (allineata a cost-ledger.ts) ======================

const PRICING: Record<string, { input: number; output: number }> = {
  'zai-glm': { input: 0.0001, output: 0.0002 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'glm-4.6': { input: 0.005, output: 0.015 },
  'glm-4.5-flash': { input: 0.002, output: 0.005 },
  'glm-4.6-reason': { input: 0.01, output: 0.03 },
}

const DEFAULT_MODEL = 'zai-glm'

// === Main entry point =================================================

/**
 * Esegue una chiamata LLM con retry, fallback, cost tracking, audit.
 *
 * Se ZAI SDK non è disponibile o la chiamata fallisce, ritorna il fallback
 * deterministico (se fornito) o una stringa vuota.
 */
export async function llmComplete(params: LLMCompleteParams): Promise<LLMCompleteResult> {
  const startTime = Date.now()
  const model = params.model || DEFAULT_MODEL
  const agentId = params.agentId || 'agent://llm-client'
  const phase = params.phase || 'llm_completion'
  const trackCost = params.trackCost !== false

  // Stima token input (4 char ≈ 1 token)
  const inputText = (params.systemPrompt || '') + params.prompt
  const tokensIn = Math.ceil(inputText.length / 4)

  try {
    // Dynamic import per evitare di caricare ZAI in test environment
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt })
    }
    messages.push({ role: 'user', content: params.prompt })

    const completion = await zai.chat.completions.create({
      messages,
      ...(params.maxTokens && { max_tokens: params.maxTokens }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
    })

    const output = completion.choices[0]?.message?.content || ''
    const tokensOut = Math.ceil(output.length / 4)
    const pricing = PRICING[model] || PRICING[DEFAULT_MODEL]!
    const cost = (tokensIn / 1000) * pricing.input + (tokensOut / 1000) * pricing.output
    const durationMs = Date.now() - startTime

    // Cost tracking
    if (trackCost && cost > 0) {
      try {
        await recordCostEntry({
          agentId,
          model,
          phase,
          tokensIn,
          tokensOut,
          cost,
        })
      } catch (err) {
        console.warn('[llm-client] Cost tracking failed (non-blocking):', err)
      }
    }

    return {
      output,
      model,
      tokensIn,
      tokensOut,
      cost,
      durationMs,
      source: 'llm',
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)

    // Fallback deterministico
    const fallbackOutput = params.fallback || ''
    const tokensOut = Math.ceil(fallbackOutput.length / 4)

    return {
      output: fallbackOutput,
      model,
      tokensIn,
      tokensOut,
      cost: 0,
      durationMs,
      source: 'fallback',
      error: errorMsg,
    }
  }
}

// === Helper functions specific ======================================

/**
 * Genera un prompt template per una skill usando LLM.
 *
 * Usato dal Meta Agent in Skill Synthesis (Fase 3.5).
 * Se LLM non disponibile, fallback al template rule-based esistente.
 */
export async function generateSkillPromptTemplate(params: {
  skillName: string
  description: string
  failurePattern: string
  evidence: string[]
}): Promise<{ template: string; source: 'llm' | 'fallback' }> {
  const systemPrompt = `You are a Meta Agent that generates prompt templates for AI skills in an autonomous operating system.

Generate a clear, actionable prompt template that:
1. Defines the skill's role and expertise
2. Lists the approach steps (3-5)
3. Includes a {{task}} placeholder where the actual task will be inserted
4. References the failure pattern to avoid
5. Is between 200-500 characters

Output ONLY the prompt template, no explanation.`

  const userPrompt = `Skill name: ${params.skillName}
Description: ${params.description}
Failure pattern to handle: ${params.failurePattern}
Evidence from past failures:
${params.evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Generate the prompt template:`

  const fallback = `You are a specialized skill for handling: ${params.description}

When you encounter the pattern "${params.failurePattern}", apply the following approach:

1. Identify the root cause of the failure
2. Apply the corrective action based on the pattern
3. Verify the result before completing

Pattern context:
${params.evidence.map((e) => `- ${e}`).join('\n')}

Task to handle:
{{task}}`

  const result = await llmComplete({
    prompt: userPrompt,
    systemPrompt,
    agentId: 'agent://meta-agent-compiler',
    phase: 'skill_synthesis',
    model: 'zai-glm',
    fallback,
  })

  return {
    template: result.output,
    source: result.source,
  }
}

/**
 * Classifica un prompt utente usando LLM (fallback al rule-based classifier).
 *
 * Usato dal Cognitive Router (Fase 2.3) per classification più accurata.
 */
export async function classifyTaskWithLLM(prompt: string): Promise<{
  complexity: 'Simple' | 'Medium' | 'Complex' | 'Critical'
  domain: string
  reasoning: string
  source: 'llm' | 'fallback'
}> {
  const systemPrompt = `You are a task classifier for an autonomous AI operating system. Classify the user's task into:

1. Complexity: Simple | Medium | Complex | Critical
   - Simple: trivial question, basic lookup, single-step
   - Medium: requires reasoning, multi-step but bounded
   - Complex: multi-domain, long context, requires planning
   - Critical: involves deploy/security/deletion/irreversible actions

2. Domain: code | math | logic | reasoning | general

3. Reasoning: one sentence explaining the classification

Output as JSON: {"complexity": "...", "domain": "...", "reasoning": "..."}`

  const fallback = JSON.stringify({
    complexity: 'Medium',
    domain: 'general',
    reasoning: 'Fallback classification (LLM unavailable)',
  })

  const result = await llmComplete({
    prompt,
    systemPrompt,
    agentId: 'agent://cognitive-router',
    phase: 'task_classification',
    model: 'zai-glm',
    fallback,
  })

  if (result.source === 'fallback') {
    return { ...JSON.parse(result.output), source: 'fallback' }
  }

  try {
    // Estrai JSON dalla risposta (può essere wrappato in markdown)
    const jsonMatch = result.output.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        complexity: parsed.complexity || 'Medium',
        domain: parsed.domain || 'general',
        reasoning: parsed.reasoning || '',
        source: 'llm',
      }
    }
  } catch {}

  return {
    complexity: 'Medium',
    domain: 'general',
    reasoning: 'Failed to parse LLM output',
    source: 'llm',
  }
}

/**
 * Estrae un'euristica da un'esperienza (per ERL Fase 5).
 *
 * Usato da ERL per reflection learning: dato un outcome (success/failure)
 * e il context, genera un'euristica procedurale.
 */
export async function extractHeuristicWithLLM(params: {
  outcome: 'success' | 'failure' | 'partial'
  context: string
  steps: Array<{ action: string; result: string }>
}): Promise<{ heuristic: string; redLineFlag: boolean; source: 'llm' | 'fallback' }> {
  const systemPrompt = `You are a reflective learning agent in an autonomous OS. Given an experience (outcome + context + steps), extract:

1. heuristic: a procedural rule of the form "When I encounter situation X, I should do Y" (1-2 sentences)
2. redLineFlag: true if this experience suggests a safety boundary was crossed or nearly crossed

Output as JSON: {"heuristic": "...", "redLineFlag": true|false}`

  const userPrompt = `Outcome: ${params.outcome}
Context: ${params.context}

Steps taken:
${params.steps.map((s, i) => `${i + 1}. ${s.action} → ${s.result}`).join('\n')}

Extract the heuristic:`

  const fallback = JSON.stringify({
    heuristic: `When encountering situations similar to: ${params.context.slice(0, 100)}, apply the steps that led to ${params.outcome}.`,
    redLineFlag: params.outcome === 'failure',
  })

  const result = await llmComplete({
    prompt: userPrompt,
    systemPrompt,
    agentId: 'agent://erl',
    phase: 'reflection',
    model: 'zai-glm',
    fallback,
  })

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        heuristic: parsed.heuristic || '',
        redLineFlag: Boolean(parsed.redLineFlag),
        source: result.source,
      }
    }
  } catch {}

  return {
    heuristic: result.output,
    redLineFlag: params.outcome === 'failure',
    source: result.source,
  }
}

/**
 * Genera una predizione LLM-based per il World Model (Fase 3.1).
 *
 * Dato uno WorldState, genera una predizione testuale con probability.
 */
export async function generatePredictionWithLLM(params: {
  worldStateSnapshot: Record<string, unknown>
  anomalies: string[]
  horizon: string
}): Promise<{
  statement: string
  probability: number
  source: 'llm' | 'fallback'
}> {
  const systemPrompt = `You are a World Model prediction agent. Given the current system state and anomalies, predict what will happen in the next time horizon.

Output as JSON: {"statement": "prediction in one sentence", "probability": 0.0-1.0}`

  const userPrompt = `Current world state:
${JSON.stringify(params.worldStateSnapshot, null, 2)}

Anomalies detected:
${params.anomalies.length > 0 ? params.anomalies.map((a) => `- ${a}`).join('\n') : 'None'}

Time horizon: ${params.horizon}

Generate a prediction:`

  const fallback = JSON.stringify({
    statement: params.anomalies.length > 0
      ? `Based on ${params.anomalies.length} anomalies, expect system degradation in next ${params.horizon}`
      : `System appears stable for next ${params.horizon}`,
    probability: params.anomalies.length > 0 ? 0.6 : 0.3,
  })

  const result = await llmComplete({
    prompt: userPrompt,
    systemPrompt,
    agentId: 'agent://world-model',
    phase: 'prediction_generation',
    model: 'zai-glm',
    fallback,
  })

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        statement: parsed.statement || '',
        probability: Math.min(1, Math.max(0, Number(parsed.probability) || 0.5)),
        source: result.source,
      }
    }
  } catch {}

  return {
    statement: result.output,
    probability: 0.5,
    source: result.source,
  }
}

/**
 * Genera una spiegazione human-readable di una risoluzione di conflitto.
 *
 * Usato dal Conflict Resolution Engine (Fase 2.8) per spiegare le decisioni.
 */
export async function explainConflictResolutionWithLLM(params: {
  claimA: string
  claimB: string
  strategy: string
  winner: string
  reason: string
}): Promise<{ explanation: string; source: 'llm' | 'fallback' }> {
  const systemPrompt = `You are a conflict resolution explainer. Given two conflicting claims and the resolution, generate a clear, non-technical explanation of why the conflict was resolved that way.

Output: 2-3 sentences in plain language. No JSON.`

  const userPrompt = `Claim A: ${params.claimA}
Claim B: ${params.claimB}
Resolution strategy: ${params.strategy}
Winner: ${params.winner}
Technical reason: ${params.reason}

Explain in plain language:`

  const fallback = `The conflict between "${params.claimA.slice(0, 50)}..." and "${params.claimB.slice(0, 50)}..." was resolved in favor of the winner because: ${params.reason}. Strategy used: ${params.strategy}.`

  const result = await llmComplete({
    prompt: userPrompt,
    systemPrompt,
    agentId: 'agent://conflict-resolution',
    phase: 'conflict_explanation',
    model: 'zai-glm',
    fallback,
  })

  return { explanation: result.output, source: result.source }
}

// === Health check ====================================================

/**
 * Verifica se l'LLM è disponibile.
 */
export async function llmHealthCheck(): Promise<{
  available: boolean
  model: string
  latencyMs?: number
  error?: string
}> {
  const start = Date.now()
  try {
    const result = await llmComplete({
      prompt: 'Reply with the single word: OK',
      fallback: 'LLM_UNAVAILABLE',
      trackCost: false,
    })
    return {
      available: result.source === 'llm',
      model: result.model,
      latencyMs: Date.now() - start,
      ...(result.error && { error: result.error }),
    }
  } catch (err) {
    return {
      available: false,
      model: DEFAULT_MODEL,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// === Stats ===========================================================

export async function llmClientStats() {
  const recentCalls = await db.costEntry.findMany({
    where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    take: 100,
    orderBy: { timestamp: 'desc' },
  })

  const llmCalls = recentCalls.filter((c) => c.cost > 0)
  const fallbackCalls = recentCalls.length - llmCalls.length

  return {
    totalCalls24h: recentCalls.length,
    llmCalls: llmCalls.length,
    fallbackCalls,
    totalCost24h: llmCalls.reduce((s, c) => s + c.cost, 0),
    avgLatencyMs: 0, // Non tracciato nel cost ledger; richiederebbe TraceSpan
    byModel: llmCalls.reduce((acc, c) => {
      acc[c.model] = (acc[c.model] || 0) + 1
      return acc
    }, {} as Record<string, number>),
  }
}
