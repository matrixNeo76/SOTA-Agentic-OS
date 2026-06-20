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
 */
export async function recordBelief(input: BeliefInput): Promise<{ beliefId: string; supersededId?: string }> {
  const emb = embed(input.content)
  const serialized = serialize(emb)

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
      content: input.content,
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
 */
export async function getBeliefLineage(beliefId: string) {
  const lineage: any[] = []
  let current = await db.belief.findUnique({ where: { id: beliefId } })
  while (current) {
    lineage.push(current)
    if (current.lineageId) {
      current = await db.belief.findUnique({ where: { id: current.lineageId } })
    } else {
      break
    }
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
 */
export async function syncBelief(
  sourceAgentId: string,
  targetAgentId: string,
  beliefId: string
): Promise<{ syncStatus: 'synced' | 'conflict'; reason?: string }> {
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
    await db.belief.create({
      data: {
        agentId: targetAgentId,
        content: sourceBelief.content,
        beliefType: sourceBelief.beliefType,
        embedding: sourceBelief.embedding,
        lineageId: sourceBelief.id,
        confidence: sourceBelief.confidence,
        superseded: false,
        version: 1,
      },
    })
  }

  // Persisti evento di sync
  await db.eSRSyncEvent.create({
    data: {
      sourceAgentId,
      targetAgentId,
      beliefId,
      syncStatus: conflict ? 'conflict' : 'synced',
      conflictReason,
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
 */
export async function proposeQuorumAction(
  workflowJoinId: string,
  action: string,
  requiredQuorum = 2
): Promise<{ decisionId: string }> {
  const decision = await db.quorumDecision.create({
    data: {
      workflowJoinId,
      action,
      requiredQuorum,
    },
  })
  return { decisionId: decision.id }
}

/**
 * Un validatore vota su una proposta.
 */
export async function voteQuorum(
  decisionId: string,
  voterAgentId: string,
  vote: 'accept' | 'reject',
  reason?: string,
  confidence = 1.0
): Promise<{ verdict: 'pending' | 'accepted' | 'rejected'; acceptCount: number; rejectCount: number }> {
  // Registra il voto
  await db.quorumVote.create({
    data: {
      workflowJoinId: decisionId, // reuse come FK logica
      action: (await db.quorumDecision.findUnique({ where: { id: decisionId } }))?.action || '',
      voterAgentId,
      vote,
      reason,
      confidence,
    },
  })

  // Aggiorna conteggi
  const decision = await db.quorumDecision.findUnique({ where: { id: decisionId } })
  if (!decision) throw new Error('Decision not found')

  const newAccept = decision.acceptCount + (vote === 'accept' ? 1 : 0)
  const newReject = decision.rejectCount + (vote === 'reject' ? 1 : 0)

  let verdict: 'pending' | 'accepted' | 'rejected' = 'pending'
  if (newAccept >= decision.requiredQuorum) {
    verdict = 'accepted'
  } else if (newReject >= decision.requiredQuorum) {
    verdict = 'rejected'
  }

  await db.quorumDecision.update({
    where: { id: decisionId },
    data: {
      acceptCount: newAccept,
      rejectCount: newReject,
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
 */
export async function esrStats() {
  const [beliefs, syncEvents, conflicts, quorumDecisions, acceptedQuorum, rejectedQuorum] = await Promise.all([
    db.belief.count({ where: { superseded: false } }),
    db.eSRSyncEvent.count(),
    db.eSRSyncEvent.count({ where: { syncStatus: 'conflict' } }),
    db.quorumDecision.count(),
    db.quorumDecision.count({ where: { verdict: 'accepted' } }),
    db.quorumDecision.count({ where: { verdict: 'rejected' } }),
  ])
  return {
    beliefs,
    syncEvents,
    conflicts,
    quorumDecisions,
    acceptedQuorum,
    rejectedQuorum,
  }
}
