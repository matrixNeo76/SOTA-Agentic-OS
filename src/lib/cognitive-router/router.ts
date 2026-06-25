/**
 * Multi-Model Cognitive Router — Fase 2.3
 *
 * Formalizza il TimeRouter (Fase 14) con:
 *   1. Task Classifier: Simple | Medium | Complex | Critical
 *   2. Local-first routing: priorità a modelli locali (llama.cpp / Ollama)
 *      → fallback a modelli API solo per task Complex/Critical
 *   3. Ottimizzazione su 4 dimensioni: costo, latenza, accuratezza, disponibilità
 *
 * Integrazione con llama-server adattivo (produzione):
 *   - Endpoint configurabile via MODEL_ROUTER_ENDPOINT
 *   - Health-check automatico
 *   - Fallback a API cloud se locale non disponibile
 *
 * Strategia local-first:
 *   Simple   → SLM locale (Gemma 2B, Qwen 1.5B)
 *   Medium   → Qwen3 8B locale o glm-4.5-flash API
 *   Complex  → Qwen3 32B locale o glm-4.6 API
 *   Critical → glm-4.6-reason API (reasoning dedicato)
 */

import { db } from '@/lib/db'
import {
  extractFeatures, type InputFeatures, type RoutingResult,
  DEFAULT_MODELS, type FoundationModelSpec,
} from '@/lib/kernel/time-router'

// === Task classifier =================================================

export type TaskComplexity = 'Simple' | 'Medium' | 'Complex' | 'Critical'

export interface TaskClassification {
  complexity: TaskComplexity
  features: InputFeatures
  signals: string[] // motivazioni della classificazione
  estimatedTokensIn: number
  estimatedTokensOut: number
}

/**
 * Classifica il task in base a feature strutturali e semantiche.
 *
 * Regole:
 *   - Critical: contiene keyword safety/governance/deploy/production + alta complessità
 *   - Complex: complessità > 0.6 o lunghezza > 2000 token o multi-dominio
 *   - Medium: complessità > 0.3 o lunghezza > 500 token
 *   - Simple: tutto il resto
 */
export function classifyTask(prompt: string): TaskClassification {
  const features = extractFeatures(prompt)
  const signals: string[] = []

  // Keyword critiche (safety/governance)
  const criticalKeywords = /\b(deploy|production|safety|governance|approve|approval|delete|irreversib|secure|security|risk|critical|emergency|urgent)\b/i
  const isCriticalKeyword = criticalKeywords.test(prompt)
  if (isCriticalKeyword) signals.push('critical-keyword-detected')

  // Multi-dominio (code + math, logic + reasoning, etc.)
  const domains = [features.hasCode, features.hasMath, features.hasLogic].filter(Boolean).length
  if (domains >= 2) signals.push('multi-domain')

  // Multi-step reasoning indicators
  const stepIndicators = /\b(step\s+\d|first|then|finally|next|after that|subsequently)\b/i.test(prompt)
  if (stepIndicators) signals.push('multi-step-reasoning')

  let complexity: TaskComplexity
  // Critical keywords always escalate to Critical (safety-first)
  if (isCriticalKeyword) {
    complexity = 'Critical'
  } else if (features.complexity > 0.6 || features.tokenEstimate > 2000 || domains >= 2) {
    complexity = 'Complex'
  } else if (features.complexity > 0.2 || features.tokenEstimate > 500 || stepIndicators) {
    complexity = 'Medium'
  } else {
    complexity = 'Simple'
  }

  // Stima token output (euristica)
  let estimatedTokensOut: number
  switch (complexity) {
    case 'Critical': estimatedTokensOut = 1500; break
    case 'Complex':  estimatedTokensOut = 800; break
    case 'Medium':   estimatedTokensOut = 300; break
    case 'Simple':   estimatedTokensOut = 100; break
  }

  return {
    complexity,
    features,
    signals,
    estimatedTokensIn: features.tokenEstimate,
    estimatedTokensOut,
  }
}

// === Model registry (local-first) ===================================

export interface LocalModel extends FoundationModelSpec {
  local: true
  endpoint?: string // URL del server locale (es. http://localhost:8080)
  healthPath?: string
}

export interface ApiModel extends FoundationModelSpec {
  local: false
  provider: string // 'zai' | 'openai' | 'anthropic' | 'mistral' | etc.
  apiKeyEnv?: string // nome env var per la API key
}

export type CognitiveModel = LocalModel | ApiModel

/**
 * Registry di default — local-first.
 *
 * In produzione: caricare da tabella FoundationModel (già presente in schema.prisma).
 */
export const DEFAULT_COGNITIVE_MODELS: CognitiveModel[] = [
  // === Local (llama.cpp / Ollama) ===
  {
    modelId: 'gemma-2b-local',
    name: 'Gemma 2B (local)',
    specialization: 'general',
    costPer1kTokens: 0, // locale = gratuito
    avgLatencyMs: 200,
    local: true,
    endpoint: 'http://localhost:8080',
  },
  {
    modelId: 'qwen3-8b-local',
    name: 'Qwen3 8B (local)',
    specialization: 'reasoning',
    costPer1kTokens: 0,
    avgLatencyMs: 400,
    local: true,
    endpoint: 'http://localhost:8081',
  },
  {
    modelId: 'qwen3-32b-local',
    name: 'Qwen3 32B (local)',
    specialization: 'reasoning',
    costPer1kTokens: 0,
    avgLatencyMs: 800,
    local: true,
    endpoint: 'http://localhost:8082',
  },
  {
    modelId: 'qwen3-coder-local',
    name: 'Qwen3 Coder (local)',
    specialization: 'code',
    costPer1kTokens: 0,
    avgLatencyMs: 500,
    local: true,
    endpoint: 'http://localhost:8083',
  },

  // === API fallback ===
  {
    modelId: 'glm-4.5-flash',
    name: 'GLM-4.5 Flash (API)',
    specialization: 'general',
    costPer1kTokens: 0.02,
    avgLatencyMs: 300,
    local: false,
    provider: 'zai',
    apiKeyEnv: 'ZAI_API_KEY',
  },
  {
    modelId: 'glm-4.6',
    name: 'GLM-4.6 (API)',
    specialization: 'general',
    costPer1kTokens: 0.05,
    avgLatencyMs: 800,
    local: false,
    provider: 'zai',
    apiKeyEnv: 'ZAI_API_KEY',
  },
  {
    modelId: 'glm-4.6-reason',
    name: 'GLM-4.6 Reasoning (API)',
    specialization: 'reasoning',
    costPer1kTokens: 0.10,
    avgLatencyMs: 1200,
    local: false,
    provider: 'zai',
    apiKeyEnv: 'ZAI_API_KEY',
  },
]

// === Local-first routing =============================================

export interface RoutingStrategy {
  classification: TaskClassification
  preferredModels: CognitiveModel[]
  fallbackModels: CognitiveModel[]
  estimatedCost: number
  estimatedLatencyMs: number
  routing: 'local' | 'api' | 'hybrid'
  reason: string
}

/**
 * Strategia di routing local-first:
 *   - Simple → solo locale (Gemma 2B)
 *   - Medium → locale (Qwen3 8B) + fallback API flash
 *   - Complex → locale (Qwen3 32B) + fallback API glm-4.6
 *   - Critical → API glm-4.6-reason (no locale, massima affidabilità)
 */
export function planRouting(
  prompt: string,
  options: {
    models?: CognitiveModel[]
    forceApi?: boolean
  } = {},
): RoutingStrategy {
  const classification = classifyTask(prompt)
  const models = options.models || DEFAULT_COGNITIVE_MODELS

  const localModels = models.filter((m) => m.local)
  const apiModels = models.filter((m) => !m.local)

  let preferred: CognitiveModel[] = []
  let fallback: CognitiveModel[] = []
  let routing: 'local' | 'api' | 'hybrid' = 'local'
  let reason: string

  if (options.forceApi) {
    preferred = apiModels.filter((m) => m.specialization === classification.features.domain || m.specialization === 'general')
    fallback = apiModels
    routing = 'api'
    reason = 'forced API by caller'
  } else if (classification.complexity === 'Critical') {
    // Critical → sempre API reasoning (massima affidabilità)
    preferred = apiModels.filter((m) => m.specialization === 'reasoning')
    fallback = apiModels.filter((m) => m.specialization === 'general')
    routing = 'api'
    reason = 'critical task requires API reasoning model'
  } else if (classification.complexity === 'Complex') {
    // Complex → locale 32B se disponibile, fallback API glm-4.6
    const local32b = localModels.filter((m) => m.specialization === 'reasoning' && (m.avgLatencyMs ?? 0) >= 600)
    const apiFallback = apiModels.filter((m) => m.modelId.includes('glm-4.6') && !m.modelId.includes('reason'))
    preferred = local32b.length > 0 ? local32b : apiFallback
    fallback = apiFallback
    routing = local32b.length > 0 ? 'hybrid' : 'api'
    reason = local32b.length > 0 ? 'local 32B with API fallback' : 'no local 32B, using API'
  } else if (classification.complexity === 'Medium') {
    // Medium → locale 8B, fallback API flash
    const local8b = localModels.filter((m) => m.specialization === 'reasoning' && (m.avgLatencyMs ?? 0) < 600)
    const apiFlash = apiModels.filter((m) => m.modelId.includes('flash'))
    preferred = local8b.length > 0 ? local8b : apiFlash
    fallback = apiFlash
    routing = local8b.length > 0 ? 'hybrid' : 'api'
    reason = local8b.length > 0 ? 'local 8B with API flash fallback' : 'no local 8B, using API flash'
  } else {
    // Simple → solo locale (SLM 2B)
    const localSlm = localModels.filter((m) => m.specialization === 'general' && (m.avgLatencyMs ?? 0) < 300)
    preferred = localSlm.length > 0 ? localSlm : apiModels.filter((m) => m.modelId.includes('flash'))
    fallback = apiModels.filter((m) => m.modelId.includes('flash'))
    routing = localSlm.length > 0 ? 'local' : 'api'
    reason = localSlm.length > 0 ? 'local SLM (Gemma 2B)' : 'no local SLM, using API flash'
  }

  // Stima costo e latenza (usa il primo preferred)
  const primary = preferred[0]
  const estimatedCost = primary
    ? (primary.costPer1kTokens || 0) * (classification.estimatedTokensIn + classification.estimatedTokensOut) / 1000
    : 0
  const estimatedLatencyMs = primary?.avgLatencyMs || 500

  return {
    classification,
    preferredModels: preferred,
    fallbackModels: fallback,
    estimatedCost,
    estimatedLatencyMs,
    routing,
    reason,
  }
}

// === Integration con time-router (per routing decision log) ===========

/**
 * Route un prompt: integra Fase 14 TimeRouter (scoring modelli) con
 * Fase 2.3 planRouting (local-first strategy).
 *
 * Persiste la decisione su RoutingDecision per audit.
 */
export async function routeCognitive(
  agentId: string,
  prompt: string,
  options?: { forceApi?: boolean },
): Promise<RoutingStrategy & { decisionId: string }> {
  const strategy = planRouting(prompt, options)

  // Delega al TimeRouter per scoring fine (margin, diversity, ensemble)
  const timeRouterResult = await routeWithTimeRouter(agentId, prompt, strategy)

  return { ...strategy, decisionId: timeRouterResult.decisionId }
}

/**
 * Wrapper attorno al TimeRouter esistente (Fase 14).
 * Passa la strategia come hint per scoring.
 */
async function routeWithTimeRouter(
  agentId: string,
  prompt: string,
  strategy: RoutingStrategy,
): Promise<RoutingResult> {
  // Ri-usa il route() del TimeRouter per ottenere decisionId + persistenza
  const { route } = await import('@/lib/kernel/time-router')
  const result = await route(agentId, prompt)

  // Log aggiuntivo: memorizza la strategia local-first in AgentLog
  try {
    await db.agentLog.create({
      data: {
        agentId,
        phase: 'cognitive-router',
        event: 'routing-strategy',
        payload: JSON.stringify({
          complexity: strategy.classification.complexity,
          routing: strategy.routing,
          preferred: strategy.preferredModels.map((m) => m.modelId),
          fallback: strategy.fallbackModels.map((m) => m.modelId),
          estimatedCost: strategy.estimatedCost,
          signals: strategy.classification.signals,
        }),
        level: 'info',
      },
    })
  } catch {}

  return result
}

// === Health check per modelli locali =================================

export interface LocalModelHealth {
  modelId: string
  endpoint: string
  healthy: boolean
  latencyMs?: number
  lastCheckedAt: string
}

/**
 * Pinga gli endpoint locali per verificare disponibilità.
 * In dev (senza server locali attivi) ritorna unhealthy per tutti.
 */
export async function checkLocalModelsHealth(
  models: CognitiveModel[] = DEFAULT_COGNITIVE_MODELS,
): Promise<LocalModelHealth[]> {
  const localModels = models.filter((m): m is LocalModel => m.local)
  const results: LocalModelHealth[] = []

  for (const model of localModels) {
    const endpoint = model.endpoint || 'http://localhost:8080'
    const healthPath = model.healthPath || '/health'

    try {
      const start = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)

      const response = await fetch(`${endpoint}${healthPath}`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)

      results.push({
        modelId: model.modelId,
        endpoint,
        healthy: response.ok,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
      })
    } catch {
      results.push({
        modelId: model.modelId,
        endpoint,
        healthy: false,
        lastCheckedAt: new Date().toISOString(),
      })
    }
  }

  return results
}

// === Stats ===========================================================

export async function cognitiveRouterStats() {
  const recent = await db.routingDecision.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
  })

  const localFirstCount = await db.agentLog.count({
    where: { phase: 'cognitive-router', event: 'routing-strategy' },
  })

  // Aggrega per routedTo
  const byRouting = recent.reduce((acc, r) => {
    acc[r.routedTo] = (acc[r.routedTo] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return {
    totalDecisions: recent.length,
    localFirstDecisions: localFirstCount,
    byRouting,
    avgConfidence: recent.reduce((s, r) => s + (r.confidence || 0), 0) / (recent.length || 1),
  }
}
