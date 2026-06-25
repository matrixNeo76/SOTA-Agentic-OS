/**
 * Knowledge Conflict Resolution Engine — Fase 2.8
 *
 * Motore attivo (lo schema è in governance/knowledge-claims.ts da Fase 0.5):
 *   1. Detect: quando un nuovo Claim viene creato, verifica se conflitta
 *      con claim esistenti (same domain, contradictory confidence)
 *   2. Resolve: aplica strategie di risoluzione (highest confidence,
 *      most evidence, human decision, temporal priority)
 *   3. Persist: crea nodo Conflict + edge CONFLICTS_WITH + Decision node
 *
 * Relazioni nel Context Graph:
 *   (:Claim)-[:CONFLICTS_WITH]->(:Claim)
 *   (:Conflict)-[:RESOLVED_BY]->(:Decision)
 *   (:Decision)-[:DERIVED_FROM]->(:Document | :Evidence)
 *
 * Eventi emessi (Fase 2.1):
 *   - ConflictDetected
 *   - ConflictResolved
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'
import {
  detectClaimConflict, computeClaimStrength,
  type ClaimNode, type EvidenceNode, type SourceNode, type ConflictNode,
  type ResolutionStrategy,
} from '@/lib/governance/knowledge-claims'
import {
  publishConflictDetected, publishConflictResolved,
} from '@/lib/event-mesh/publishers'

// === Tipi ============================================================

export interface ConflictRecord {
  uri: string
  claimAUri: string
  claimBUri: string
  severity: 'low' | 'medium' | 'high'
  detectedAt: string
  status: 'pending' | 'resolved'
  resolution?: ConflictResolution
  strategy?: ResolutionStrategy
}

export interface ConflictResolution {
  strategy: ResolutionStrategy
  winnerUri: string // the surviving claim
  loserUri: string // the superseded/rejected claim
  reason: string
  decisionUri: string
  resolvedAt: string
  resolvedBy: string
}

// === Conflict detection ==============================================

/**
 * Verifica se un claim appena creato è in conflitto con claim esistenti.
 * Ritorna la lista dei conflitti trovati.
 *
 * Criteri (dal governance/knowledge-claims.ts):
 *   - Stesso domain
 *   - Confidence difference > 0.3 (medium) o > 0.5 (high)
 *   - Statements semanticamente opposti (semplificato: confronto testuale)
 */
export async function detectConflictsForClaim(newClaimUri: string): Promise<ConflictRecord[]> {
  const newClaim = await getClaimNode(newClaimUri)
  if (!newClaim) return []

  // Cerca claim con stesso domain (escluso se stesso)
  const candidateClaims = await findClaimsByDomain(newClaim.domain)

  const conflicts: ConflictRecord[] = []
  for (const candidate of candidateClaims) {
    if (candidate.uri === newClaimUri) continue

    const detection = detectClaimConflict(newClaim, candidate)
    if (!detection.hasConflict) continue

    // Crea Conflict node
    const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const conflictUri = `conflict://${conflictId}`
    const conflictRecord: ConflictRecord = {
      uri: conflictUri,
      claimAUri: newClaim.uri,
      claimBUri: candidate.uri,
      severity: detection.severity as ConflictRecord['severity'],
      detectedAt: new Date().toISOString(),
      status: 'pending',
    }

    try {
      await createNode({
        type: 'Conflict',
        identifier: conflictId,
        attributes: {
          claimA: newClaim.uri, // required by ENTITY_REGISTRY
          claimB: candidate.uri, // required by ENTITY_REGISTRY
          status: 'pending', // required by ENTITY_REGISTRY
          severity: detection.severity,
          detectedAt: conflictRecord.detectedAt,
        },
        provenance: createProvenance({
          agent: 'agent://conflict-resolver',
          source: 'agent-reasoning',
          confidence: 1.0,
        }),
      })

      // Crea edges CONFLICTS_WITH bidirezionali
      await createEdge({
        fromUri: newClaim.uri,
        toUri: candidate.uri,
        relationType: 'CONFLICTS_WITH',
        createdByAgent: 'agent://conflict-resolver',
        properties: { conflictUri, severity: detection.severity },
      }).catch(() => {})
      await createEdge({
        fromUri: candidate.uri,
        toUri: newClaim.uri,
        relationType: 'CONFLICTS_WITH',
        createdByAgent: 'agent://conflict-resolver',
        properties: { conflictUri, severity: detection.severity },
      }).catch(() => {})

      // Pubblica evento ConflictDetected
      await publishConflictDetected(
        conflictUri,
        newClaim.uri,
        candidate.uri,
        createProvenance({
          agent: 'agent://conflict-resolver',
          source: 'agent-reasoning',
          confidence: 1.0,
        }),
      ).catch(() => {})

      conflicts.push(conflictRecord)
    } catch (err) {
      console.warn(`[conflict-resolution] Failed to persist conflict:`, err)
    }
  }

  return conflicts
}

/**
 * Recupera tutti i conflitti pendenti.
 */
export async function listPendingConflicts(): Promise<ConflictRecord[]> {
  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Conflict' },
    orderBy: { createdAt: 'desc' },
  })

  const conflicts: ConflictRecord[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    if (attrs.status !== 'pending') continue
    conflicts.push({
      uri: node.uri,
      claimAUri: attrs.claimA as string,
      claimBUri: attrs.claimB as string,
      severity: (attrs.severity as ConflictRecord['severity']) || 'medium',
      detectedAt: node.createdAt.toISOString(),
      status: 'pending',
    })
  }
  return conflicts
}

// === Conflict resolution =============================================

/**
 * Risolve un conflitto applicando una strategia.
 *
 * Strategie (dal governance/knowledge-claims.ts):
 *   - highest_confidence: vince il claim con confidence più alta
 *   - most_evidence: vince il claim con più evidence a supporto
 *   - temporal_priority: vince il claim più recente (last writer wins)
 *   - human_decision: richiede Decisione umana (HITL)
 */
export async function resolveConflict(params: {
  conflictUri: string
  strategy: ResolutionStrategy
  resolvedBy: string
  reason?: string
  provenance: Provenance
  manualWinnerUri?: string // per human_decision strategy
}): Promise<ConflictResolution> {
  const conflictNode = await getNode(params.conflictUri)
  if (!conflictNode || conflictNode.entityType !== 'Conflict') {
    throw new Error(`Conflict not found: ${params.conflictUri}`)
  }

  const attrs = conflictNode.attributes as Record<string, unknown>
  const claimAUri = attrs.claimA as string
  const claimBUri = attrs.claimB as string

  const claimA = await getClaimNode(claimAUri)
  const claimB = await getClaimNode(claimBUri)
  if (!claimA || !claimB) {
    throw new Error('One or both claims not found')
  }

  // Applica strategia
  let winnerUri: string
  let loserUri: string
  let reason: string

  switch (params.strategy) {
    case 'higher-confidence': {
      if (claimA.confidence > claimB.confidence) {
        winnerUri = claimA.uri
        loserUri = claimB.uri
      } else if (claimB.confidence > claimA.confidence) {
        winnerUri = claimB.uri
        loserUri = claimA.uri
      } else {
        // Tie → fallback a more-evidence
        const evA = await getEvidenceCount(claimA.uri)
        const evB = await getEvidenceCount(claimB.uri)
        winnerUri = evA >= evB ? claimA.uri : claimB.uri
        loserUri = winnerUri === claimA.uri ? claimB.uri : claimA.uri
      }
      reason = `Winner has higher confidence (${claimA.confidence} vs ${claimB.confidence})`
      break
    }

    case 'more-evidence': {
      const evidenceA = await getEvidenceCount(claimA.uri)
      const evidenceB = await getEvidenceCount(claimB.uri)
      if (evidenceA >= evidenceB) {
        winnerUri = claimA.uri
        loserUri = claimB.uri
      } else {
        winnerUri = claimB.uri
        loserUri = claimA.uri
      }
      reason = `Winner has more evidence (${evidenceA} vs ${evidenceB})`
      break
    }

    case 'more-reliable-source': {
      // Simplified: winner is the claim with higher confidence × evidence count
      const scoreA = claimA.confidence * (await getEvidenceCount(claimA.uri) + 1)
      const scoreB = claimB.confidence * (await getEvidenceCount(claimB.uri) + 1)
      if (scoreA >= scoreB) {
        winnerUri = claimA.uri
        loserUri = claimB.uri
      } else {
        winnerUri = claimB.uri
        loserUri = claimA.uri
      }
      reason = `Winner has higher confidence×evidence score (${scoreA.toFixed(2)} vs ${scoreB.toFixed(2)})`
      break
    }

    case 'formal-proof': {
      // In Fase 2 non abbiamo Lean4 integration completa. Fallback a more-evidence.
      const evidenceA = await getEvidenceCount(claimA.uri)
      const evidenceB = await getEvidenceCount(claimB.uri)
      winnerUri = evidenceA >= evidenceB ? claimA.uri : claimB.uri
      loserUri = winnerUri === claimA.uri ? claimB.uri : claimA.uri
      reason = 'Formal proof not yet integrated in Fase 2; fallback to more-evidence'
      break
    }

    case 'human-decision': {
      if (!params.manualWinnerUri) {
        throw new Error('human-decision strategy requires manualWinnerUri')
      }
      if (![claimA.uri, claimB.uri].includes(params.manualWinnerUri)) {
        throw new Error('manualWinnerUri must be one of the conflicting claims')
      }
      winnerUri = params.manualWinnerUri
      loserUri = winnerUri === claimA.uri ? claimB.uri : claimA.uri
      reason = params.reason || 'Resolved by human decision'
      break
    }

    default:
      throw new Error(`Unknown strategy: ${params.strategy}`)
  }

  // Crea nodo Decision
  const decisionId = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const decisionUri = `decision://${decisionId}`
  await createNode({
    type: 'Decision',
    identifier: decisionId,
    attributes: {
      rationale: reason, // required by ENTITY_REGISTRY
      decidedBy: params.resolvedBy, // required by ENTITY_REGISTRY
      strategy: params.strategy,
      winnerUri,
      loserUri,
      conflictUri: params.conflictUri,
    },
    provenance: params.provenance,
  })

  // Crea edge Conflict -[RESOLVED_BY]-> Decision
  await createEdge({
    fromUri: params.conflictUri,
    toUri: decisionUri,
    relationType: 'RESOLVED_BY',
    createdByAgent: params.resolvedBy,
  }).catch(() => {})

  // Aggiorna status del Conflict a 'resolved'
  await db.graphNode.update({
    where: { uri: params.conflictUri },
    data: {
      attributes: JSON.stringify({
        ...attrs,
        status: 'resolved',
        resolution: {
          strategy: params.strategy,
          winnerUri,
          loserUri,
          reason,
          decisionUri,
          resolvedAt: new Date().toISOString(),
          resolvedBy: params.resolvedBy,
        },
      }),
      updatedAt: new Date(),
    },
  })

  // Aggiorna lifecycle del claim perdente (mark as superseded)
  // Questo richiede updateNodeLifecycle che va da draft→active→deprecated
  // Per i claim usiamo lo status interno (non lifecycleState del grafo)
  await markClaimSuperseded(loserUri, params.resolvedBy)

  // Pubblica evento ConflictResolved
  await publishConflictResolved(
    params.conflictUri,
    params.strategy,
    decisionUri,
    createProvenance({
      agent: params.resolvedBy,
      source: 'human-approval',
      confidence: 1.0,
    }),
  ).catch(() => {})

  // C1 — Use LLM to generate human-readable explanation (with fallback).
  let llmExplanation: string | undefined
  try {
    const { explainConflictResolutionWithLLM } = await import('@/lib/llm-client/client')
    const claimA = await getClaimNode(claimAUri)
    const claimB = await getClaimNode(claimBUri)
    const llmResult = await explainConflictResolutionWithLLM({
      claimA: claimA?.statement || claimAUri,
      claimB: claimB?.statement || claimBUri,
      strategy: params.strategy,
      winner: winnerUri,
      reason,
    })
    if (llmResult.source === 'llm' && llmResult.explanation.length > 10) {
      llmExplanation = llmResult.explanation
    }
  } catch {
    // LLM non disponibile → fallback (usa il reason rule-based)
  }

  return {
    strategy: params.strategy,
    winnerUri,
    loserUri,
    reason: llmExplanation || reason, // prefer LLM explanation if available
    decisionUri,
    resolvedAt: new Date().toISOString(),
    resolvedBy: params.resolvedBy,
  }
}

// === Helpers =========================================================

/**
 * Recupera un ClaimNode dal Context Graph.
 * I claim sono creati con tipo 'Claim' (Fase 2.2 knowledge extraction).
 */
export async function getClaimNode(uri: string): Promise<ClaimNode | null> {
  const node = await getNode(uri)
  if (!node || node.entityType !== 'Claim') return null

  const attrs = node.attributes as Record<string, unknown>
  return {
    uri: node.uri,
    statement: (attrs.statement as string) || '',
    confidence: (attrs.confidence as number) || 0.5,
    status: ((attrs.status as string) || 'active') as ClaimNode['status'],
    evidence: (attrs.evidence as string[]) || [],
    conflictingClaims: (attrs.conflictingClaims as string[]) || [],
    domain: attrs.domain as string | undefined,
    provenance: node.provenance,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  }
}

/**
 * Cerca claim per domain.
 */
async function findClaimsByDomain(domain?: string): Promise<ClaimNode[]> {
  if (!domain) return []

  const nodes = await db.graphNode.findMany({
    where: { entityType: 'Claim' },
    take: 200,
  })

  const claims: ClaimNode[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    if (attrs.domain !== domain) continue
    const claim = await getClaimNode(node.uri)
    if (claim && claim.status === 'active') claims.push(claim)
  }
  return claims
}

/**
 * Conta le evidence a supporto di un claim (edge SUPPORTS incoming).
 */
async function getEvidenceCount(claimUri: string): Promise<number> {
  const claimNode = await db.graphNode.findUnique({ where: { uri: claimUri } })
  if (!claimNode) return 0

  const edges = await db.graphEdge.count({
    where: {
      toNodeId: claimNode.id,
      relationType: 'SUPPORTS',
    },
  })
  return edges
}

/**
 * Marca un claim come superseded (atomico, senza lifecycleState del grafo).
 */
async function markClaimSuperseded(claimUri: string, actor: string): Promise<void> {
  const node = await db.graphNode.findUnique({ where: { uri: claimUri } })
  if (!node) return

  const attrs = JSON.parse(node.attributes) as Record<string, unknown>
  await db.graphNode.update({
    where: { uri: claimUri },
    data: {
      attributes: JSON.stringify({
        ...attrs,
        status: 'superseded',
        supersededBy: actor,
        supersededAt: new Date().toISOString(),
      }),
      updatedAt: new Date(),
    },
  })
}

/**
 * Crea un nuovo claim e verifica conflitti in un colpo solo.
 * Helper per Fase 2.2 knowledge extraction.
 */
export async function createClaimAndDetectConflicts(params: {
  identifier: string
  statement: string
  confidence: number
  domain?: string
  evidence?: string[] // URIs of Evidence nodes
  provenance: Provenance
}): Promise<{ claimUri: string; conflicts: ConflictRecord[] }> {
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  const { uri } = await createNode({
    type: 'Claim',
    identifier: params.identifier,
    attributes: {
      statement: params.statement, // required by ENTITY_REGISTRY
      confidence: params.confidence, // required by ENTITY_REGISTRY
      status: 'active',
      evidence: params.evidence || [],
      conflictingClaims: [],
      domain: params.domain,
    },
    provenance: params.provenance,
  })

  const conflicts = await detectConflictsForClaim(uri)
  return { claimUri: uri, conflicts }
}

// === Stats ===========================================================

export async function conflictResolutionStats() {
  const [total, byStatus, byStrategy] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Conflict' } }),
    db.graphNode.groupBy({
      by: ['lifecycleState'],
      where: { entityType: 'Conflict' },
      _count: true,
    }),
    db.graphNode.findMany({
      where: { entityType: 'Decision' },
      select: { attributes: true },
    }),
  ])

  const strategyCounts: Record<string, number> = {}
  for (const node of byStrategy) {
    try {
      const attrs = JSON.parse(node.attributes) as Record<string, unknown>
      const strategy = (attrs.strategy as string) || 'unknown'
      strategyCounts[strategy] = (strategyCounts[strategy] || 0) + 1
    } catch {}
  }

  // Conta pending/resolved dallo status nelle attributes
  const conflicts = await db.graphNode.findMany({
    where: { entityType: 'Conflict' },
    select: { attributes: true },
  })
  let pending = 0
  let resolved = 0
  for (const c of conflicts) {
    try {
      const attrs = JSON.parse(c.attributes) as Record<string, unknown>
      if (attrs.status === 'pending') pending++
      else if (attrs.status === 'resolved') resolved++
    } catch {}
  }

  return {
    totalConflicts: total,
    pending,
    resolved,
    byStrategy: strategyCounts,
  }
}

// === Auto-resolver (best-effort) =====================================

/**
 * Risolve automaticamente i conflitti con strategia predefinita.
 * Skip conflict che richiedono human_decision (severity high → HITL).
 *
 * Utilizzabile come job schedulato (Fase 2.9 cognitive GC).
 */
export async function autoResolveConflicts(options?: {
  strategy?: ResolutionStrategy
  maxIterations?: number
}): Promise<{ resolved: number; skipped: number }> {
  const strategy = options?.strategy || 'higher-confidence'
  const maxIter = options?.maxIterations || 50

  const pending = await listPendingConflicts()
  let resolved = 0
  let skipped = 0

  for (const conflict of pending.slice(0, maxIter)) {
    if (conflict.severity === 'high') {
      // High severity richiede human decision
      skipped++
      continue
    }

    try {
      await resolveConflict({
        conflictUri: conflict.uri,
        strategy,
        resolvedBy: 'agent://auto-resolver',
        reason: `Auto-resolved with ${strategy}`,
        provenance: createProvenance({
          agent: 'agent://auto-resolver',
          source: 'agent-reasoning',
          confidence: 0.8,
        }),
      })
      resolved++
    } catch (err) {
      console.warn(`[conflict-resolution] Failed to auto-resolve ${conflict.uri}:`, err)
      skipped++
    }
  }

  return { resolved, skipped }
}
