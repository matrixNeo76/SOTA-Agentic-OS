/**
 * Fase 9: Artificial Retainer & Prevenzione Agentic Literacy Debt
 *
 * Cambia il paradigma: da "chat" a "piattaforma di supervisione".
 * L'agente agisce per conto dell'utente (mandante), ma con confini di
 * autorità espliciti e gates di approvazione umana sulle azioni
 * irreversibili o che violano policy.
 *
 * Componenti:
 *  1) DelegationContract: scope di autorità (permessi concessi a un agente)
 *  2) ApprovalGate: HITL gates integrati nel router dei tool
 *  3) NormativeResolution: calcolo normativo per conflitti prompt utente vs policy
 *     Gerarchia: Safety > Operational > Aesthetic
 *  4) AuditLedgerEntry: registro di delega comprensibile all'umano
 */
import { db } from '@/lib/db'

// =====================================================
// 1) Delegation Contracts
// =====================================================

export type DelegationScope = {
  resource: string  // es. "tool:exec", "filesystem:write", "spend:budget"
  pattern: string   // es. "/tmp/*", "*", "100"
  constraints: {
    maxCalls?: number
    maxSpend?: number
    timeWindow?: string  // es. "1h", "24h"
    reversible?: boolean
  }
}

/**
 * Concede una delega a un agente.
 */
export async function grantDelegation(
  agentId: string,
  scope: string,
  constraints: Record<string, unknown>,
  grantedBy: string,
  expiresAt?: Date
): Promise<string> {
  const delegation = await db.delegationContract.create({
    data: {
      agentId,
      scope,
      constraints: JSON.stringify(constraints),
      grantedBy,
      expiresAt: expiresAt || null,
      active: true,
    },
  })

  await logAuditEntry({
    agentId,
    action: 'delegation_granted',
    decision: {
      source: grantedBy,
      intent: `Concessa delega ${scope} a ${agentId}`,
      gate: 'delegation',
      outcome: 'granted',
    },
    delegationId: delegation.id,
    readableNarrative: `L'utente ${grantedBy} ha concesso a ${agentId} l'autorità su "${scope}" con vincoli: ${JSON.stringify(constraints)}`,
    reversible: true,
  })

  return delegation.id
}

/**
 * Revoca una delega.
 */
export async function revokeDelegation(delegationId: string, revokeReason: string): Promise<void> {
  await db.delegationContract.update({
    where: { id: delegationId },
    data: {
      active: false,
      revokedAt: new Date(),
      revokeReason,
    },
  })
  const delegation = await db.delegationContract.findUnique({ where: { id: delegationId } })
  if (delegation) {
    await logAuditEntry({
      agentId: delegation.agentId,
      action: 'delegation_revoked',
      decision: {
        source: 'user',
        intent: `Revocata delega ${delegation.scope}`,
        gate: 'delegation',
        outcome: 'revoked',
      },
      delegationId,
      readableNarrative: `Delega ${delegation.scope} a ${delegation.agentId} revocata. Motivo: ${revokeReason}`,
      reversible: false,
    })
  }
}

/**
 * Verifica se un agente ha l'autorità per eseguire una data azione.
 */
export async function checkAuthority(
  agentId: string,
  scope: string
): Promise<{ authorized: boolean; delegationId?: string; constraints?: Record<string, unknown>; reason: string }> {
  const delegations = await db.delegationContract.findMany({
    where: { agentId, active: true },
  })

  for (const d of delegations) {
    // Match scope via prefix or exact
    if (d.scope === scope || d.scope === '*' || scope.startsWith(d.scope)) {
      // Check expiration
      if (d.expiresAt && d.expiresAt < new Date()) {
        continue
      }
      return {
        authorized: true,
        delegationId: d.id,
        constraints: JSON.parse(d.constraints),
        reason: `Autorizzato da delega ${d.id} (scope: ${d.scope})`,
      }
    }
  }

  return {
    authorized: false,
    reason: `Nessuna delega attiva per scope "${scope}" sull'agente ${agentId}`,
  }
}

export async function listDelegations(agentId?: string) {
  return db.delegationContract.findMany({
    where: agentId ? { agentId } : { active: true },
    orderBy: { grantedAt: 'desc' },
    take: 30,
  })
}

// =====================================================
// 2) Approval Gates (Human-in-the-loop)
// =====================================================

/**
 * Crea un gate di approvazione umana.
 * Chiamato quando un'azione è irreversibile, viola policy LTL,
 * o supera soglie di spesa.
 */
export async function requestApproval(
  agentId: string,
  action: string,
  payload: unknown,
  reason: string,
  expiresAt?: Date
): Promise<{ gateId: string; status: 'pending' }> {
  const gate = await db.approvalGate.create({
    data: {
      agentId,
      action,
      payload: JSON.stringify(payload),
      reason,
      status: 'pending',
      expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000), // default 24h
    },
  })
  return { gateId: gate.id, status: 'pending' }
}

/**
 * Risolve un gate di approvazione (approve/reject).
 */
export async function resolveApproval(
  gateId: string,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  axiomTrail?: Record<string, unknown>
): Promise<{ status: string; gateId: string }> {
  const gate = await db.approvalGate.findUnique({ where: { id: gateId } })
  if (!gate) throw new Error(`Gate ${gateId} non trovato`)
  if (gate.status !== 'pending') throw new Error(`Gate già risolto: ${gate.status}`)

  await db.approvalGate.update({
    where: { id: gateId },
    data: {
      status: decision,
      decidedBy,
      decidedAt: new Date(),
      axiomTrail: axiomTrail ? JSON.stringify(axiomTrail) : null,
    },
  })

  await logAuditEntry({
    agentId: gate.agentId,
    action: gate.action,
    decision: {
      source: decidedBy,
      intent: `Gate ${gateId}: ${decision}`,
      gate: 'hitl',
      outcome: decision,
      reason: gate.reason,
    },
    readableNarrative: `L'utente ${decidedBy} ha ${decision === 'approved' ? 'approvato' : 'rifiutato'} l'azione "${gate.action}" richiesta da ${gate.agentId}. Motivo richiesta: ${gate.reason}`,
    reversible: decision === 'rejected',
  })

  return { status: decision, gateId }
}

/**
 * Lista gates pending per la UI.
 */
export async function listPendingGates(agentId?: string) {
  return db.approvalGate.findMany({
    where: {
      status: 'pending',
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
}

export async function listRecentGates(agentId?: string, limit = 30) {
  return db.approvalGate.findMany({
    where: agentId ? { agentId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// =====================================================
// 3) Normative Calculus (risoluzione conflitti)
// =====================================================

export const NORMATIVE_HIERARCHY = {
  SAFETY: 1,        // Sicurezza > tutto
  OPERATIONAL: 2,   // Istruzioni operative
  AESTHETIC: 3,     // Preferenze estetiche
} as const

export type NormativeLevel = keyof typeof NORMATIVE_HIERARCHY

export type NormativeConflict = {
  userInstruction: string
  userLevel: NormativeLevel
  systemPolicy: string
  systemLevel: NormativeLevel
}

/**
 * Risolve un conflitto tra istruzioni utente e policy di sistema.
 *
 * Regole deterministiche O(1):
 *  - Se systemLevel < userLevel → BLOCK (system vince, gerarchia superiore)
 *  - Se systemLevel = userLevel e sono in conflitto → BLOCK (tie va a safety)
 *  - Se systemLevel > userLevel → MODIFY (l'utente può modificare la policy)
 *
 * Ritorna verdict + modifiedAction (se MODIFY) + axiomTrail auditabile.
 */
export async function resolveNormativeConflict(
  conflict: NormativeConflict
): Promise<{
  verdict: 'accept' | 'block' | 'modify'
  modifiedAction?: string
  hierarchyApplied: NormativeLevel[]
  axiomTrail: { step: string; rule: string; result: string }[]
  resolutionId: string
}> {
  const { userInstruction, userLevel, systemPolicy, systemLevel } = conflict

  const axiomTrail: { step: string; rule: string; result: string }[] = []
  let verdict: 'accept' | 'block' | 'modify'
  let modifiedAction: string | undefined

  axiomTrail.push({
    step: '1_classify',
    rule: `Istruzione utente valutata come livello: ${userLevel} (${NORMATIVE_HIERARCHY[userLevel]})`,
    result: `Policy di sistema al livello: ${systemLevel} (${NORMATIVE_HIERARCHY[systemLevel]})`,
  })

  if (NORMATIVE_HIERARCHY[systemLevel] < NORMATIVE_HIERARCHY[userLevel]) {
    // System ha priorità più alta → BLOCK
    verdict = 'block'
    axiomTrail.push({
      step: '2_compare',
      rule: `Gerarchia: ${systemLevel}(${NORMATIVE_HIERARCHY[systemLevel]}) < ${userLevel}(${NORMATIVE_HIERARCHY[userLevel]}) → system vince`,
      result: 'BLOCK: l\'azione viola una policy di livello superiore',
    })
  } else if (NORMATIVE_HIERARCHY[systemLevel] === NORMATIVE_HIERARCHY[userLevel]) {
    // Stesso livello → tie va a safety
    verdict = 'block'
    axiomTrail.push({
      step: '2_compare',
      rule: `Stesso livello gerarchico: tie-break a favore della safety`,
      result: 'BLOCK: conflitto allo stesso livello, precauzione',
    })
  } else {
    // System ha priorità più bassa → l'utente può modificare
    verdict = 'modify'
    modifiedAction = `${userInstruction} [modificato per allinearsi a policy inferiore: ${systemPolicy}]`
    axiomTrail.push({
      step: '2_compare',
      rule: `Gerarchia: ${systemLevel}(${NORMATIVE_HIERARCHY[systemLevel]}) > ${userLevel}(${NORMATIVE_HIERARCHY[userLevel]}) → user può modificare`,
      result: `MODIFY: azione modificata per rispettare ${systemPolicy}`,
    })
  }

  axiomTrail.push({
    step: '3_finalize',
    rule: `Verdict finale: ${verdict}`,
    result: modifiedAction || userInstruction,
  })

  // Persisti risoluzione
  const resolution = await db.normativeResolution.create({
    data: {
      conflictType: `${userLevel}_vs_${systemLevel}`,
      userInstruction,
      systemPolicy,
      verdict,
      modifiedAction: modifiedAction || null,
      hierarchyApplied: JSON.stringify([systemLevel, userLevel].sort((a, b) => NORMATIVE_HIERARCHY[a as NormativeLevel] - NORMATIVE_HIERARCHY[b as NormativeLevel])),
      axiomTrail: JSON.stringify(axiomTrail),
    },
  })

  await logAuditEntry({
    agentId: 'system',
    action: userInstruction,
    decision: {
      source: 'normative_calculus',
      intent: `Conflitto ${userLevel} vs ${systemLevel}`,
      gate: 'normative',
      outcome: verdict,
    },
    readableNarrative: `Conflitto normativo risolto: ${verdict}. Istruzione utente "${userInstruction.slice(0, 50)}..." vs policy "${systemPolicy}". Gerarchia applicata: ${systemLevel} > ${userLevel}.`,
    reversible: verdict !== 'block',
  })

  return {
    verdict,
    modifiedAction,
    hierarchyApplied: [systemLevel, userLevel].sort((a, b) => NORMATIVE_HIERARCHY[a as NormativeLevel] - NORMATIVE_HIERARCHY[b as NormativeLevel]) as NormativeLevel[],
    axiomTrail,
    resolutionId: resolution.id,
  }
}

export async function listNormativeResolutions(limit = 20) {
  return db.normativeResolution.findMany({
    orderBy: { decidedAt: 'desc' },
    take: limit,
  })
}

// =====================================================
// 4) Audit Ledger
// =====================================================

/**
 * Registra una voce nel registro di delega comprensibile all'umano.
 */
async function logAuditEntry(params: {
  agentId: string
  action: string
  decision: Record<string, unknown>
  delegationId?: string
  readableNarrative: string
  reversible: boolean
}): Promise<void> {
  await db.auditLedgerEntry.create({
    data: {
      agentId: params.agentId,
      action: params.action,
      decision: JSON.stringify(params.decision),
      delegationId: params.delegationId || null,
      readableNarrative: params.readableNarrative,
      reversible: params.reversible,
    },
  })
}

/**
 * Lista il registro di audit per la UI.
 */
export async function listAuditLedger(limit = 50, agentId?: string) {
  return db.auditLedgerEntry.findMany({
    where: agentId ? { agentId } : {},
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
}

/**
 * Statistiche per dashboard.
 */
export async function retainerStats() {
  const [activeDelegations, totalDelegations, pendingGates, resolvedGates, auditEntries, normativeResolutions] = await Promise.all([
    db.delegationContract.count({ where: { active: true } }),
    db.delegationContract.count(),
    db.approvalGate.count({ where: { status: 'pending' } }),
    db.approvalGate.count({ where: { status: { in: ['approved', 'rejected'] } } }),
    db.auditLedgerEntry.count(),
    db.normativeResolution.count(),
  ])
  const approvedGates = await db.approvalGate.count({ where: { status: 'approved' } })
  const rejectedGates = await db.approvalGate.count({ where: { status: 'rejected' } })
  const blockedResolutions = await db.normativeResolution.count({ where: { verdict: 'block' } })

  return {
    activeDelegations,
    totalDelegations,
    pendingGates,
    resolvedGates,
    approvedGates,
    rejectedGates,
    auditEntries,
    normativeResolutions,
    blockedResolutions,
  }
}
