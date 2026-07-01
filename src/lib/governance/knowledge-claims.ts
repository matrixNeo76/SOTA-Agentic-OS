/**
 * Knowledge-as-Claims Schema — Fase 0.5.5
 *
 * Principio chiave: la conoscenza è un insieme di **claim**, non di verità.
 * Ogni claim ha evidenza, confidence, e può entrare in conflitto con altri claim.
 * I conflitti si risolvono via Decision.
 *
 * Nodi (nel Context Graph su Apache AGE):
 *   Claim, Evidence, Source, Conflict
 *
 * Relazioni:
 *   (:Claim)-[:SUPPORTED_BY]->(:Evidence)
 *   (:Claim)-[:CONFLICTS_WITH]->(:Claim)
 *   (:Conflict)-[:RESOLVED_BY]->(:Decision)
 *   (:Evidence)-[:DERIVED_FROM]->(:Source)
 *   (:Decision)-[:DERIVED_FROM]->(:Document)
 *   (:BestPractice)-[:LEARNED_FROM]->(:Experience)
 *   (:Prediction)-[:BASED_ON]->(:Evidence)
 *
 * Motore di risoluzione attivo in Fase 2 (Conflict Resolution Engine).
 */

import { z } from 'zod'
import { provenanceSchema } from './provenance-schema'

// === Claim ===
export const claimNodeSchema = z.object({
  uri: z.string().regex(/^claim:\/\//),
  statement: z.string().min(1), // l'affermazione
  confidence: z.number().min(0).max(1),
  status: z.enum(['active', 'superseded', 'rejected', 'verified']).default('active'),
  evidence: z.array(z.string()).default([]), // URIs of Evidence
  conflictingClaims: z.array(z.string()).default([]), // URIs of conflicting Claims
  domain: z.string().optional(), // es. "code-quality", "security", "performance"
  provenance: provenanceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type ClaimNode = z.infer<typeof claimNodeSchema>

// === Evidence ===
export const evidenceNodeSchema = z.object({
  uri: z.string().regex(/^evidence:\/\//),
  type: z.enum([
    'document', // derived from a document
    'tool-output', // output of a tool execution
    'agent-reasoning', // agent's reasoning chain
    'human-input', // direct human input
    'empirical', // observed outcome
    'statistical', // statistical analysis
    'formal-proof', // Lean4 or formal verification
  ]),
  content: z.string(), // the evidence content (or reference)
  sourceUri: z.string(), // URI of Source
  supportsClaim: z.string().optional(), // URI of Claim this supports
  strength: z.number().min(0).max(1).default(0.5), // how strong is this evidence
  provenance: provenanceSchema,
  createdAt: z.string().datetime(),
})

export type EvidenceNode = z.infer<typeof evidenceNodeSchema>

// === Source ===
export const sourceNodeSchema = z.object({
  uri: z.string().regex(/^source:\/\//),
  type: z.enum([
    'github', // GitHub repo/issue/PR
    'document', // uploaded document
    'api', // external API
    'agent', // agent-generated
    'human', // human-provided
    'system', // system event/log
    'benchmark', // evaluation benchmark
  ]),
  identifier: z.string(), // e.g. "repo#issue-42", "doc-sha256:abc..."
  reliability: z.number().min(0).max(1).default(0.5), // how reliable is this source
  provenance: provenanceSchema,
  createdAt: z.string().datetime(),
})

export type SourceNode = z.infer<typeof sourceNodeSchema>

// === Conflict ===
export const conflictNodeSchema = z.object({
  uri: z.string().regex(/^conflict:\/\//),
  claimA: z.string(), // URI of first claim
  claimB: z.string(), // URI of second claim
  status: z.enum(['detected', 'investigating', 'resolved', 'ignored']).default('detected'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  resolution: z.string().optional(), // URI of Decision that resolved this
  resolutionReason: z.string().optional(),
  provenance: provenanceSchema,
  detectedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
})

export type ConflictNode = z.infer<typeof conflictNodeSchema>

// === Relation definitions (for Apache AGE Cypher) ===
export const KNOWLEDGE_RELATIONS = [
  { type: 'SUPPORTED_BY', from: 'Claim', to: 'Evidence', description: 'Claim supportato da evidenza' },
  { type: 'CONFLICTS_WITH', from: 'Claim', to: 'Claim', description: 'Claim in conflitto con altro claim' },
  { type: 'RESOLVED_BY', from: 'Conflict', to: 'Decision', description: 'Conflitto risolto da decisione' },
  { type: 'DERIVED_FROM', from: 'Evidence', to: 'Source', description: 'Evidenza derivata da fonte' },
  { type: 'DERIVED_FROM', from: 'Decision', to: 'Document', description: 'Decisione derivata da documento' },
  { type: 'LEARNED_FROM', from: 'BestPractice', to: 'Experience', description: 'Best practice appresa da esperienza' },
  { type: 'BASED_ON', from: 'Prediction', to: 'Evidence', description: 'Predizione basata su evidenza' },
  { type: 'INVOLVES', from: 'Conflict', to: 'Claim', description: 'Conflitto coinvolge claim' },
] as const

// === Conflict Resolution Strategy (per Fase 2 — motore attivo) ===
export const RESOLUTION_STRATEGIES = {
  HIGHER_CONFIDENCE: 'higher-confidence', // wins the claim with higher confidence
  MORE_EVIDENCE: 'more-evidence', // wins the claim with more supporting evidence
  MORE_RELIABLE_SOURCE: 'more-reliable-source', // wins evidence from more reliable source
  HUMAN_DECISION: 'human-decision', // requires Sovereign Validator
  FORMAL_PROOF: 'formal-proof', // Lean4 verification wins over everything
  TEMPORAL_RECENCY: 'temporal-recency', // most recent claim wins (for time-sensitive data)
  CONSENSUS: 'consensus', // swarm quorum decides
} as const

export type ResolutionStrategy = typeof RESOLUTION_STRATEGIES[keyof typeof RESOLUTION_STRATEGIES]

// === Helper: detect conflict between two claims ===
export function detectClaimConflict(claimA: ClaimNode, claimB: ClaimNode): { hasConflict: boolean; severity: string } {
  if (claimA.uri === claimB.uri) return { hasConflict: false, severity: 'none' }
  if (claimA.domain !== claimB.domain) return { hasConflict: false, severity: 'none' }

  // Same domain, contradictory confidence levels
  const confidenceDiff = Math.abs(claimA.confidence - claimB.confidence)
  if (confidenceDiff > 0.5) return { hasConflict: true, severity: 'high' }
  if (confidenceDiff > 0.3) return { hasConflict: true, severity: 'medium' }

  return { hasConflict: false, severity: 'none' }
}

// === Helper: compute claim strength ===
export function computeClaimStrength(claim: ClaimNode, evidence: EvidenceNode[], sources: SourceNode[]): number {
  if (evidence.length === 0) return claim.confidence * 0.5 // no evidence = weak

  // Weighted average of evidence strength × source reliability
  let totalWeight = 0
  let weightedSum = 0

  for (const ev of evidence) {
    const source = sources.find(s => s.uri === ev.sourceUri)
    const reliability = source?.reliability ?? 0.5
    const weight = ev.strength * reliability
    weightedSum += weight
    totalWeight += reliability
  }

  const evidenceScore = totalWeight > 0 ? weightedSum / totalWeight : 0
  // Combine claim confidence with evidence score
  return Math.sqrt(claim.confidence * evidenceScore)
}
