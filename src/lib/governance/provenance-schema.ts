/**
 * Provenance Schema — Fase 0.5.3
 *
 * Contratto obbligatorio per ogni nodo del Context Graph.
 * Nessun nodo può essere creato senza metadati di provenienza.
 *
 * Retrofittare la provenance su un grafo già popolato è impraticabile.
 * Per questo è il primo schema ad essere enforced.
 */

import { z } from 'zod'

// === Provenance Schema (obbligatorio per ogni entità) ===
export const provenanceSchema = z.object({
  /** Agente che ha creato il nodo (URI: agent://planner) */
  createdByAgent: z.string().min(1),

  /** Modello LLM usato per generare il contenuto (es. "zai-glm", "qwen3-32b") */
  createdByModel: z.string().optional(),

  /** Fonte dei dati: "user-input", "llm-generation", "document-extraction", "tool-output", "system-event" */
  source: z.enum([
    'user-input',
    'llm-generation',
    'document-extraction',
    'tool-output',
    'system-event',
    'agent-reasoning',
    'external-api',
    'code-analysis',
    'human-approval',
    'synthesis',
  ]),

  /** Confidence 0.0-1.0: quanto è affidabile il contenuto */
  confidence: z.number().min(0).max(1),

  /** Timestamp ISO 8601 di creazione */
  timestamp: z.string().datetime(),
})

export type Provenance = z.infer<typeof provenanceSchema>

// === Relation Provenance (per relazioni nel grafo) ===
export const relationProvenanceSchema = z.object({
  createdByAgent: z.string().min(1),
  timestamp: z.string().datetime(),
  reason: z.string().optional(),
})

export type RelationProvenance = z.infer<typeof relationProvenanceSchema>

// === Helper: create provenance ===
export function createProvenance(params: {
  agent: string
  model?: string
  source: Provenance['source']
  confidence?: number
}): Provenance {
  return {
    createdByAgent: params.agent,
    createdByModel: params.model,
    source: params.source,
    confidence: params.confidence ?? 1.0,
    timestamp: new Date().toISOString(),
  }
}

// === Helper: validate provenance ===
export function validateProvenance(data: unknown): { valid: boolean; error?: string } {
  const result = provenanceSchema.safeParse(data)
  if (result.success) return { valid: true }
  return { valid: false, error: result.error.issues[0]?.message || 'Invalid provenance' }
}

// === Confidence levels semantic ===
export const CONFIDENCE_LEVELS = {
  HIGH: { min: 0.8, label: 'high', description: 'Verificato o derivato da fonte autorevole' },
  MEDIUM: { min: 0.5, label: 'medium', description: 'Plausibile ma non verificato indipendentemente' },
  LOW: { min: 0.2, label: 'low', description: 'Speculativo o basato su inferenza debole' },
  SPECULATIVE: { min: 0.0, label: 'speculative', description: 'Ipotetico, da verificare' },
} as const

export function getConfidenceLevel(confidence: number): { label: string; description: string } {
  if (confidence >= CONFIDENCE_LEVELS.HIGH.min) return CONFIDENCE_LEVELS.HIGH
  if (confidence >= CONFIDENCE_LEVELS.MEDIUM.min) return CONFIDENCE_LEVELS.MEDIUM
  if (confidence >= CONFIDENCE_LEVELS.LOW.min) return CONFIDENCE_LEVELS.LOW
  return CONFIDENCE_LEVELS.SPECULATIVE
}

// === Provenance-based trust chain ===
/**
 * Quando un claim supporta una decisione, la confidence della decisione
 * è influenzata dalla confidence del claim e della sua evidence.
 */
export function computeDerivedConfidence(
  claimConfidence: number,
  evidenceConfidence: number,
  sourceReliability: number = 1.0
): number {
  // Geometric mean weighted by source reliability
  const combined = Math.sqrt(claimConfidence * evidenceConfidence) * sourceReliability
  return Math.min(combined, 1.0)
}
