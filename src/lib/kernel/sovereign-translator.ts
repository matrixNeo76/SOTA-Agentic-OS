/**
 * Fase 17: Sovereign Validator — Traduttore LTL/Taint/Normative → italiano
 *
 * Converte le violazioni logiche formali in avvisi leggibili per l'umano,
 * con Axiom Trail esplicito.
 */
import { db } from '@/lib/db'
import { publishAgentEvent } from '@/lib/ws-publish'

export type BlockedActionInput = {
  agentId: string
  action: string
  source: 'ltl' | 'taint' | 'normative' | 'hitl_gate'
  axiomTrail: { step: string; rule: string; result: string }[]
  readableExplanation?: string
  relatedData?: Record<string, unknown>
}

export type ResolutionChoice = 'approved' | 'modified' | 'downgraded' | 'rejected'

/**
 * Registra un'azione bloccata in attesa di risoluzione umana.
 */
export async function registerBlockedAction(input: BlockedActionInput): Promise<{ blockedId: string }> {
  const readableExplanation = input.readableExplanation || generateExplanation(input)
  const blocked = await db.blockedAction.create({
    data: {
      agentId: input.agentId,
      action: input.action,
      source: input.source,
      axiomTrail: JSON.stringify(input.axiomTrail),
      readableExplanation,
    },
  })
  await publishAgentEvent({
    agentId: input.agentId, phase: '17',
    event: 'action_blocked',
    level: 'warn',
    payload: { blockedId: blocked.id, source: input.source, action: input.action },
  })
  return { blockedId: blocked.id }
}

/**
 * Risolve un'azione bloccata con override umano.
 */
export async function resolveBlockedAction(
  blockedId: string,
  choice: ResolutionChoice,
  resolvedBy = 'admin',
  resolutionDetails?: Record<string, unknown>
): Promise<{ status: ResolutionChoice; blockedId: string }> {
  const blocked = await db.blockedAction.findUnique({ where: { id: blockedId } })
  if (!blocked) throw new Error(`Blocked action ${blockedId} non trovata`)
  if (blocked.status !== 'pending') throw new Error(`Blocked action già risolta: ${blocked.status}`)

  await db.blockedAction.update({
    where: { id: blockedId },
    data: {
      status: choice,
      resolution: resolutionDetails ? JSON.stringify(resolutionDetails) : null,
      resolvedBy,
      resolvedAt: new Date(),
    },
  })

  await publishAgentEvent({
    agentId: blocked.agentId, phase: '17',
    event: 'blocked_action_resolved',
    payload: { blockedId, choice, resolvedBy },
  })

  return { status: choice, blockedId }
}

/**
 * Genera una spiegazione in linguaggio naturale da un axiom trail.
 */
function generateExplanation(input: BlockedActionInput): string {
  const { source, action, axiomTrail } = input
  const lines: string[] = []

  switch (source) {
    case 'ltl':
      lines.push(`L'agente ha tentato di eseguire "${action}", ma questa azione viola una regola LTL di sicurezza.`)
      break
    case 'taint':
      lines.push(`L'agente ha tentato di eseguire "${action}" usando dati non fidati (tainted).`)
      break
    case 'normative':
      lines.push(`L'azione "${action}" è in conflitto con una policy di sistema di livello superiore.`)
      break
    case 'hitl_gate':
      lines.push(`L'azione "${action}" richiede approvazione umana esplicita (irreversibile o sensibile).`)
      break
  }

  lines.push('')
  lines.push('Catena logica (Axiom Trail):')
  axiomTrail.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step.rule}`)
    if (step.result) lines.push(`     → ${step.result}`)
  })

  return lines.join('\n')
}

/**
 * Lista azioni bloccate pending.
 */
export async function listPendingBlocked(limit = 20) {
  return db.blockedAction.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function listRecentBlocked(limit = 30) {
  return db.blockedAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function blockedStats() {
  const [total, pending, approved, rejected, modified, downgraded] = await Promise.all([
    db.blockedAction.count(),
    db.blockedAction.count({ where: { status: 'pending' } }),
    db.blockedAction.count({ where: { status: 'approved' } }),
    db.blockedAction.count({ where: { status: 'rejected' } }),
    db.blockedAction.count({ where: { status: 'modified' } }),
    db.blockedAction.count({ where: { status: 'downgraded' } }),
  ])
  return { total, pending, approved, rejected, modified, downgraded }
}

// =====================================================
// Cockpit Narratives
// =====================================================

/**
 * Registra una voce narrativa per il tab Narrative del Cockpit.
 */
export async function recordNarrative(
  agentId: string,
  narrative: string,
  level: 'info' | 'warn' | 'critical' = 'info',
  cycleId?: number,
  relatedPhase?: string
): Promise<void> {
  await db.cockpitNarrative.create({
    data: { agentId, narrative, level, cycleId, relatedPhase },
  })
}

/**
 * Lista narrative per il Cockpit.
 */
export async function listNarratives(limit = 50, level?: 'info' | 'warn' | 'critical') {
  return db.cockpitNarrative.findMany({
    where: level ? { level } : {},
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
}
