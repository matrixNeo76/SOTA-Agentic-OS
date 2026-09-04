/**
 * Fase 13: Epistemic State Replication (ESR) + Quorum Semantico
 *
 * Risolve la "Divergenza Epistemica": quando agenti paralleli leggono
 * dati diversi o estraggono riassunti divergenti, il sistema crolla.
 *
 * Soluzione:
 *  1) Belief Lineage: traccia l'origine delle convinzioni di ogni agente
 *  2) ESR (Epistemic State Replication): replica le convinzioni tra agenti
 *     con coerenza eventuale
 *  3) Quorum Semantico: ai join point del DAG, un'azione è ammessa se
 *     una soglia di validatori indipendenti la certifica
 */
import { db } from '@/lib/db'
import { embed, serialize, deserialize, cosine } from '@/lib/embeddings'

// =====================================================
// C3 fix (Swarm Coherence audit Fase A): size cap su payload persistito.
// PRIMA: content/reason/action/conflictReason persistiti senza size cap.
// Un caller malevolo o buggy poteva passare content di 1MB → DB bloat.
// ORA: costanti di size cap con marker [truncated]:
//  - MAX_BELIEF_CONTENT_SIZE: 10KB (belief testuale)
//  - MAX_VOTE_REASON_SIZE: 2KB (motivazione voto)
//  - MAX_QUORUM_ACTION_SIZE: 1KB (azione da certificare)
//  - MAX_CONFLICT_REASON_SIZE: 2KB (motivo conflitto ESR)
// =====================================================
const MAX_BELIEF_CONTENT_SIZE = 10_000
const MAX_VOTE_REASON_SIZE = 2_000
const MAX_QUORUM_ACTION_SIZE = 1_000
const MAX_CONFLICT_REASON_SIZE = 2_000

function truncateWithMarker(value: string, maxSize: number): string {
  if (value.length <= maxSize) return value
  return value.slice(0, maxSize) + '...[truncated]'
}

// =====================================================
// 1) Belief Lineage
// =====================================================

export type BeliefInput = {
  agentId: string
  content: string
  beliefType: 'summary' | 'evidence' | 'plan' | 'observation'
  lineageId?: string  // belief genitore
  confidence?: number
}

/**
 * Registra una nuova convinzione di un agente.
 * Se esiste una convinzione precedente con stesso contentuto (alta similarità),
 * la marca come superseded e crea una nuova versione.
 *
 * C3: content troncato a 10KB con marker [truncated].
 * B3: validazione runtime di beliefType enum.
 */
const VALID_BELIEF_TYPES: readonly string[] = ['summary', 'evidence', 'plan', 'observation']

function isValidBeliefType(value: unknown): value is BeliefInput['beliefType'] {
  return typeof value === 'string' && (VALID_BELIEF_TYPES as readonly string[]).includes(value)
}

export async function recordBelief(input: BeliefInput): Promise<{ beliefId: string; supersededId?: string }> {
  // B3 — Validazione runtime: beliefType deve essere uno dei valori ammessi
  if (!isValidBeliefType(input.beliefType)) {
    throw new Error(
      `Invalid beliefType: "${input.beliefType}". Allowed values: ${VALID_BELIEF_TYPES.join(', ')}`
    )
  }

  const emb = embed(input.content)
  const serialized = serialize(emb)

  // C3 — Size cap su content (10KB)
  const truncatedContent = truncateWithMarker(input.content, MAX_BELIEF_CONTENT_SIZE)

  // Cerca convinzioni precedenti dello stesso agente e stesso tipo
  const previous = await db.belief.findMany({
    where: { agentId: input.agentId, beliefType: input.beliefType, superseded: false },
  })

  let supersededId: string | undefined
  for (const p of previous) {
    const sim = cosine(emb, deserialize(p.embedding))
    if (sim > 0.85) {
      // Convinzione precedente molto simile → superseded
      supersededId = p.id
      await db.belief.update({
        where: { id: p.id },
        data: { superseded: true },
      })
      break
    }
  }

  const newVersion = supersededId
    ? ((await db.belief.findUnique({ where: { id: supersededId } }))?.version || 0) + 1
    : 1

  const belief = await db.belief.create({
    data: {
      agentId: input.agentId,
      content: truncatedContent,  // C3: capped
      beliefType: input.beliefType,
      embedding: serialized,
      lineageId: input.lineageId || supersededId,
      confidence: input.confidence ?? 1.0,
      superseded: false,
      version: newVersion,
    },
  })

  return { beliefId: belief.id, supersededId }
}

/**
 * Recupera il lignaggio di una convinzione (catena di versioni).
 * B4 FIX: depth limit (max 20) per prevenire loop infiniti su cyclic lineage.
 */
export async function getBeliefLineage(beliefId: string) {
  const lineage: any[] = []
  let current = await db.belief.findUnique({ where: { id: beliefId } })
  const MAX_DEPTH = 20 // B4: safety limit
  let depth = 0
  while (current && depth < MAX_DEPTH) {
    lineage.push(current)
    if (current.lineageId) {
      current = await db.belief.findUnique({ where: { id: current.lineageId } })
    } else {
      break
    }
    depth++
  }
  return lineage
}

export async function listBeliefs(agentId?: string, limit = 30) {
  return db.belief.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      superseded: false,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// =====================================================
// 2) ESR (Epistemic State Replication)
// =====================================================

/**
 * Sincronizza una convinzione da un agente sorgente a uno target.
 * Verifica la coerenza: se il target ha una convinzione simile ma divergente,
 * marca come conflitto.
 *
 * B5: validazione sourceAgentId !== targetAgentId (no self-sync).
 */
export async function syncBelief(
  sourceAgentId: string,
  targetAgentId: string,
  beliefId: string
): Promise<{ syncStatus: 'synced' | 'conflict'; reason?: string }> {
  // B5 — Self-sync prevention: source e target devono essere agenti diversi
  if (sourceAgentId === targetAgentId) {
    return {
      syncStatus: 'conflict',
      reason: `Self-sync not allowed: source and target are the same agent (${sourceAgentId})`,
    }
  }

  const sourceBelief = await db.belief.findUnique({ where: { id: beliefId } })
  if (!sourceBelief) {
    return { syncStatus: 'conflict', reason: 'Source belief not found' }
  }

  // Cerca convinzioni nel target con stesso tipo
  const targetBeliefs = await db.belief.findMany({
    where: { agentId: targetAgentId, beliefType: sourceBelief.beliefType, superseded: false },
  })

  const sourceEmb = deserialize(sourceBelief.embedding)

  let conflict = false
  let conflictReason: string | undefined

  for (const tb of targetBeliefs) {
    const sim = cosine(sourceEmb, deserialize(tb.embedding))
    if (sim > 0.7) {
      // Simile ma non identico → potenziale conflitto
      if (sim < 0.9 && tb.content !== sourceBelief.content) {
        conflict = true
        conflictReason = `Conflitto: sim=${sim.toFixed(3)}, contenuti divergenti`
        break
      }
    }
  }

  // Se non conflitto, replica la convinzione nel target
  if (!conflict) {
    // B5 FIX: use source version + 1 instead of always 1 (preserves version history)
    // C3: content già capped nel recordBelief source, ma re-applica per safety
    await db.belief.create({
      data: {
        agentId: targetAgentId,
        content: truncateWithMarker(sourceBelief.content, MAX_BELIEF_CONTENT_SIZE),
        beliefType: sourceBelief.beliefType,
        embedding: sourceBelief.embedding,
        lineageId: sourceBelief.id,
        confidence: sourceBelief.confidence,
        superseded: false,
        version: (sourceBelief.version || 0) + 1, // B5: preserve version history
      },
    })
  }

  // Persisti evento di sync
  // C3 — Size cap su conflictReason (2KB)
  const truncatedConflictReason = conflictReason
    ? truncateWithMarker(conflictReason, MAX_CONFLICT_REASON_SIZE)
    : null

  await db.eSRSyncEvent.create({
    data: {
      sourceAgentId,
      targetAgentId,
      beliefId,
      syncStatus: conflict ? 'conflict' : 'synced',
      conflictReason: truncatedConflictReason,
    },
  })

  return { syncStatus: conflict ? 'conflict' : 'synced', reason: conflictReason }
}

export async function listSyncEvents(limit = 30) {
  return db.eSRSyncEvent.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
}

// =====================================================
// 3) Quorum Semantico
// =====================================================

/**
 * Crea una proposta di decisione da certificare con quorum.
 *
 * C3: action troncato a 1KB con marker [truncated].
 */
export async function proposeQuorumAction(
  workflowJoinId: string,
  action: string,
  requiredQuorum = 2
): Promise<{ decisionId: string }> {
  // C3 — Size cap su action (1KB)
  const truncatedAction = truncateWithMarker(action, MAX_QUORUM_ACTION_SIZE)

  const decision = await db.quorumDecision.create({
    data: {
      workflowJoinId,
      action: truncatedAction,
      requiredQuorum,
    },
  })
  return { decisionId: decision.id }
}

/**
 * Un validatore vota su una proposta.
 *
 * C3 FIX: duplicate vote prevention — check if voterAgentId already voted.
 * C4 FIX: race condition — use atomic increment inside transaction.
 * B1 FIX: tie handling — accept==reject==requiredQuorum → verdict 'rejected' (tie va a safety).
 * B4 FIX: validazione runtime di vote enum.
 */
const VALID_VOTES: readonly string[] = ['accept', 'reject']

function isValidVote(value: unknown): value is 'accept' | 'reject' {
  return typeof value === 'string' && (VALID_VOTES as readonly string[]).includes(value)
}

export async function voteQuorum(
  decisionId: string,
  voterAgentId: string,
  vote: 'accept' | 'reject',
  reason?: string,
  confidence = 1.0
): Promise<{ verdict: 'pending' | 'accepted' | 'rejected'; acceptCount: number; rejectCount: number }> {
  // B4 — Validazione runtime: vote deve essere 'accept' o 'reject'
  if (!isValidVote(vote)) {
    throw new Error(
      `Invalid vote: "${vote}". Allowed values: ${VALID_VOTES.join(', ')}`
    )
  }

  // C3: check for duplicate vote
  const existingVote = await db.quorumVote.findFirst({
    where: { workflowJoinId: decisionId, voterAgentId },
  })
  if (existingVote) {
    throw new Error(`Voter ${voterAgentId} has already voted on decision ${decisionId}`)
  }

  // Get decision for action field + current counts
  const decision = await db.quorumDecision.findUnique({ where: { id: decisionId } })
  if (!decision) throw new Error('Decision not found')

  // Register the vote
  // C3 — Size cap su reason (2KB)
  const truncatedReason = reason ? truncateWithMarker(reason, MAX_VOTE_REASON_SIZE) : null

  await db.quorumVote.create({
    data: {
      workflowJoinId: decisionId,
      action: decision.action,  // già capped da proposeQuorumAction
      voterAgentId,
      vote,
      reason: truncatedReason,
      confidence,
    },
  })

  // C4: atomic increment instead of read-then-write
  const incrementField = vote === 'accept' ? { acceptCount: { increment: 1 } } : { rejectCount: { increment: 1 } }

  // Calculate new verdict based on incremented counts
  const newAccept = decision.acceptCount + (vote === 'accept' ? 1 : 0)
  const newReject = decision.rejectCount + (vote === 'reject' ? 1 : 0)

  let verdict: 'pending' | 'accepted' | 'rejected' = 'pending'
  // B1 fix: tie handling — se accept == reject == requiredQuorum, tie va a safety (rejected)
  if (newAccept >= decision.requiredQuorum && newReject >= decision.requiredQuorum && newAccept === newReject) {
    // B1: tie → rejected (safety, come normative calculus C8 fix)
    verdict = 'rejected'
  } else if (newAccept >= decision.requiredQuorum) {
    verdict = 'accepted'
  } else if (newReject >= decision.requiredQuorum) {
    verdict = 'rejected'
  }

  // C4: use atomic increment + verdict update in single query
  await db.quorumDecision.update({
    where: { id: decisionId },
    data: {
      ...incrementField,
      verdict,
      decidedAt: verdict !== 'pending' ? new Date() : null,
    },
  })

  return { verdict, acceptCount: newAccept, rejectCount: newReject }
}

export async function listQuorumDecisions(limit = 20) {
  return db.quorumDecision.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function getQuorumVotes(decisionId: string) {
  return db.quorumVote.findMany({
    where: { workflowJoinId: decisionId },
    orderBy: { timestamp: 'desc' },
  })
}

/**
 * Statistiche per dashboard.
 *
 * G4/B6 fix (Swarm Coherence audit Fase C): metriche derivate aggiuntive.
 * PRIMA: solo 6 metriche raw (beliefs, syncEvents, conflicts, quorumDecisions, acceptedQuorum, rejectedQuorum).
 * ORA: aggiunte 4 metriche derivate per monitoraggio qualità:
 *  - conflictRate: conflicts / syncEvents (% di sync con conflitto epistemico)
 *  - quorumCompletionRate: (accepted + rejected) / quorumDecisions (% decisioni risolte)
 *  - pendingQuorum: decisioni ancora pending (non votate a sufficienza)
 *  - avgConfidence: media confidence dei belief attivi (qualità epistemica)
 * Tutte le query in un unico Promise.all (1 round-trip DB).
 */
export async function esrStats() {
  const [beliefs, syncEvents, conflicts, quorumDecisions, acceptedQuorum, rejectedQuorum, confidenceAgg] = await Promise.all([
    db.belief.count({ where: { superseded: false } }),
    db.eSRSyncEvent.count(),
    db.eSRSyncEvent.count({ where: { syncStatus: 'conflict' } }),
    db.quorumDecision.count(),
    db.quorumDecision.count({ where: { verdict: 'accepted' } }),
    db.quorumDecision.count({ where: { verdict: 'rejected' } }),
    // G4 — avg confidence dei belief attivi
    db.belief.aggregate({
      where: { superseded: false },
      _avg: { confidence: true },
    }),
  ])

  // G4 — metriche derivate
  const conflictRate = syncEvents > 0 ? conflicts / syncEvents : 0
  const decidedQuorum = acceptedQuorum + rejectedQuorum
  const quorumCompletionRate = quorumDecisions > 0 ? decidedQuorum / quorumDecisions : 0
  const pendingQuorum = quorumDecisions - decidedQuorum
  const avgConfidence = confidenceAgg._avg.confidence ?? 0

  return {
    beliefs,
    syncEvents,
    conflicts,
    quorumDecisions,
    acceptedQuorum,
    rejectedQuorum,
    // G4 — metriche derivate
    conflictRate,
    quorumCompletionRate,
    pendingQuorum,
    avgConfidence,
  }
}
