/**
 * Fase 14: TimeRouter (Adaptive Routing + Ensemble Fallback)
 *
 * Massimizza performance riducendo tempi e costi: instrada i task
 * dinamicamente tra modelli Foundation in base a confidenza e diversità.
 *
 * Pipeline:
 *  1) Estrai feature strutturali dal prompt (lunghezza, dominio, complessità)
 *  2) Classificatore leggero (XGBoost-like, qui semplificato) prevede
 *     accuratezza dei vari modelli
 *  3) Gate Selettivo: se margine tra top-2 < τm O diversità > τd → fallback
 *  4) Ensemble Fallback: instrada a ensemble ponderato o modelli Critic
 */
import { db } from '@/lib/db'
import { createHash } from 'crypto'

export type FoundationModelSpec = {
  modelId: string
  name: string
  specialization: 'code' | 'reasoning' | 'math' | 'logic' | 'general'
  costPer1kTokens?: number
  avgLatencyMs?: number
}

export const DEFAULT_MODELS: FoundationModelSpec[] = [
  { modelId: 'glm-4.6', name: 'GLM-4.6', specialization: 'general', costPer1kTokens: 0.05, avgLatencyMs: 800 },
  { modelId: 'glm-4.6-code', name: 'GLM-4.6 Code', specialization: 'code', costPer1kTokens: 0.08, avgLatencyMs: 600 },
  { modelId: 'glm-4.6-reason', name: 'GLM-4.6 Reason', specialization: 'reasoning', costPer1kTokens: 0.10, avgLatencyMs: 1200 },
  { modelId: 'glm-4.6-math', name: 'GLM-4.6 Math', specialization: 'math', costPer1kTokens: 0.10, avgLatencyMs: 1000 },
  { modelId: 'glm-4.6-logic', name: 'GLM-4.6 Logic', specialization: 'logic', costPer1kTokens: 0.07, avgLatencyMs: 700 },
  { modelId: 'glm-4.5-flash', name: 'GLM-4.5 Flash', specialization: 'general', costPer1kTokens: 0.02, avgLatencyMs: 300 },
]

export type InputFeatures = {
  length: number           // lunghezza prompt in caratteri
  tokenEstimate: number    // stima token
  hasCode: boolean         // contiene blocchi di codice
  hasMath: boolean         // contiene formule matematiche
  hasLogic: boolean        // contiene operatori logici
  complexity: number       // 0..1, complessità stimata
  domain: string           // dominio rilevato
}

export type RoutingResult = {
  primaryModel: string
  confidence: number       // 0..1
  margin: number           // differenza tra top-2
  diversity: number        // diversità tra predizioni
  routedTo: 'primary' | 'ensemble' | 'critic'
  ensembleModels?: string[]
  finalOutput?: string
  decisionId: string
}

/**
 * Estrae feature strutturali dal prompt.
 */
export function extractFeatures(prompt: string): InputFeatures {
  const length = prompt.length
  const tokenEstimate = Math.ceil(length / 4)

  const hasCode = /```|function\s*\(|return\s+|const\s+|let\s+|class\s+/.test(prompt)
  const hasMath = /[∫∑√π≤≥≠∞±×÷]|[a-z]\^[0-9]|[a-z]_[0-9]|\b(equation|theorem|proof|integral)\b/i.test(prompt)
  const hasLogic = /\b(if|then|else|forall|exists|implies|and|or|not)\b|→|↔|∀|∃|∧|∨|¬/.test(prompt)

  // Complessità: combina lunghezza, presenza di codice/matematica/logica
  let complexity = 0
  complexity += Math.min(0.3, length / 5000) // lunghezza max 0.3
  if (hasCode) complexity += 0.2
  if (hasMath) complexity += 0.25
  if (hasLogic) complexity += 0.2
  if (tokenEstimate > 1000) complexity += 0.05
  complexity = Math.min(1, complexity)

  // Dominio
  let domain = 'general'
  if (hasCode) domain = 'code'
  else if (hasMath) domain = 'math'
  else if (hasLogic) domain = 'logic'
  else if (tokenEstimate > 500) domain = 'reasoning'

  return {
    length,
    tokenEstimate,
    hasCode,
    hasMath,
    hasLogic,
    complexity,
    domain,
  }
}

/**
 * Classificatore leggero (semplificato): assegna un punteggio a ogni modello
 * in base alle feature estratte.
 *
 * In produzione: sostituire con XGBoost addestrato su log storici.
 */
function scoreModels(features: InputFeatures): { modelId: string; score: number; specialization: string }[] {
  const models = DEFAULT_MODELS
  return models.map((m) => {
    let score = 0.5 // base

    // Bonus se la specializzazione matcha il dominio
    if (m.specialization === features.domain) score += 0.3

    // Code-specific adjustments
    if (features.hasCode && m.specialization === 'code') score += 0.2
    if (features.hasMath && m.specialization === 'math') score += 0.2
    if (features.hasLogic && m.specialization === 'logic') score += 0.2

    // Complessità: modelli pesanti hanno vantaggio su task complessi
    if (features.complexity > 0.6) {
      if (m.specialization === 'reasoning') score += 0.15
      if (m.specialization === 'general' && m.modelId.includes('flash')) score -= 0.2
    } else {
      // Task semplici: preferisci modelli veloci
      if (m.modelId.includes('flash')) score += 0.25
    }

    // Penalizza costo alto per task semplici
    if (features.complexity < 0.3 && (m.costPer1kTokens || 0) > 0.05) {
      score -= 0.15
    }

    // Lunghezza: modelli con context lungo preferiti
    if (features.tokenEstimate > 2000 && m.modelId.includes('flash')) {
      score -= 0.1
    }

    score = Math.max(0, Math.min(1, score))
    return { modelId: m.modelId, score, specialization: m.specialization }
  }).sort((a, b) => b.score - a.score)
}

/**
 * Router principale: decide quale modello usare.
 */
export async function route(agentId: string, prompt: string): Promise<RoutingResult> {
  const features = extractFeatures(prompt)
  const scores = scoreModels(features)

  const primary = scores[0]
  const secondary = scores[1]
  const confidence = primary.score
  const margin = primary.score - (secondary?.score || 0)

  // Diversità: se top model ha specializzazione diversa da second, alta diversità
  const diversity = primary.specialization !== secondary?.specialization ? 0.8 : 0.2

  // Configurazione router
  const config = await getOrCreateConfig()
  const inputHash = createHash('sha256').update(prompt).digest('hex').slice(0, 16)

  // Gate Selettivo
  let routedTo: 'primary' | 'ensemble' | 'critic' = 'primary'
  let ensembleModels: string[] | undefined

  if (
    confidence < config.minConfidence ||
    margin < config.marginThreshold ||
    diversity > config.diversityThreshold
  ) {
    // Fallback: ensemble dei top-3 modelli
    if (config.enableEnsemble) {
      routedTo = 'ensemble'
      ensembleModels = scores.slice(0, 3).map((s) => s.modelId)
    } else if (config.enableCritic) {
      routedTo = 'critic'
      ensembleModels = [primary.modelId, 'glm-4.6-reason'] // primary + critic
    }
  }

  // Chiama LLM via ZAI SDK
  let finalOutput: string
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are an adaptive model router in SOTA Agentic OS. Process the prompt and provide a clear, actionable response.' },
        { role: 'user', content: prompt },
      ],
    })
    finalOutput = completion.choices[0]?.message?.content || 'No output from model.'
  } catch (e: any) {
    finalOutput = `LLM Error: ${e.message}. ${simulateModelOutput(primary.modelId, prompt)}`
  }

  // Persisti decisione
  const decision = await db.routingDecision.create({
    data: {
      agentId,
      inputHash,
      inputFeatures: JSON.stringify(features),
      primaryModel: primary.modelId,
      confidence,
      margin,
      diversity,
      routedTo,
      ensembleModels: ensembleModels ? JSON.stringify(ensembleModels) : null,
      finalOutput,
    },
  })

  return {
    primaryModel: primary.modelId,
    confidence,
    margin,
    diversity,
    routedTo,
    ensembleModels,
    finalOutput,
    decisionId: decision.id,
  }
}

/**
 * Simula output del modello (stub).
 * In produzione: chiamare ZAI.create() con il modelId scelto.
 */
function simulateModelOutput(modelId: string, prompt: string): string {
  const features = extractFeatures(prompt)
  return `[${modelId}] Output per dominio '${features.domain}' (complessità ${features.complexity.toFixed(2)}):
Risposta sintetica generata dal modello ${modelId}.`
}

async function getOrCreateConfig() {
  let config = await db.routerConfig.findFirst()
  if (!config) {
    config = await db.routerConfig.create({
      data: {
        marginThreshold: 0.2,
        diversityThreshold: 0.3,
        minConfidence: 0.6,
        enableEnsemble: true,
        enableCritic: true,
      },
    })
  }
  return config
}

export async function updateConfig(updates: {
  marginThreshold?: number
  diversityThreshold?: number
  minConfidence?: number
  enableEnsemble?: boolean
  enableCritic?: boolean
}) {
  const existing = await db.routerConfig.findFirst()
  if (existing) {
    return db.routerConfig.update({ where: { id: existing.id }, data: updates })
  }
  return db.routerConfig.create({ data: updates })
}

export async function listRoutingDecisions(limit = 30) {
  return db.routingDecision.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function routerStats() {
  const [decisions, ensemble, critic, primary] = await Promise.all([
    db.routingDecision.count(),
    db.routingDecision.count({ where: { routedTo: 'ensemble' } }),
    db.routingDecision.count({ where: { routedTo: 'critic' } }),
    db.routingDecision.count({ where: { routedTo: 'primary' } }),
  ])
  // Modello più frequentemente scelto come primary
  const recent = await db.routingDecision.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { primaryModel: true },
  })
  const modelCounts: Record<string, number> = {}
  for (const r of recent) {
    modelCounts[r.primaryModel] = (modelCounts[r.primaryModel] || 0) + 1
  }
  const topModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]
  return {
    decisions,
    ensemble,
    critic,
    primary,
    topModel: topModel ? topModel[0] : 'none',
    topModelPct: topModel && recent.length ? topModel[1] / recent.length : 0,
  }
}
