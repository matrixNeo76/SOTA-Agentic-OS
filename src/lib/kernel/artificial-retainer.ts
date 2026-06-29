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
 *
 * C9 fix: prima il matching usava `scope.startsWith(d.scope)` che permetteva
 * bypass pericolosi (es. delega `tool:exec` autorizzava `tool:executor`,
 * `tool:exec_malicious`, `tool:exec_privileged`). Ora:
 *  - Match esatto (scope === d.scope)
 *  - Wildcard esplicita con `*` (es. `tool:exec*` → match `tool:exec`,
 *    `tool:executor`, ma NON `tool:execute_privileged` se scritto come
 *    `tool:exec/*` — vedi regola sotto)
 *  - Prefisso con separatore (es. `filesystem:read:/tmp/*` → match
 *    `filesystem:read:/tmp/file1`, `filesystem:read:/tmp/sub/file2`)
 *  - Star globale (`*`) autorizza tutto (kept for backward compat)
 *
 * Non viene più fatto startsWith grezzo: il suffisso deve essere separato
 * da un carattere non alfanumerico (`.`, `:`, `/`, `-`, `_` dopo il
 * prefisso non viene considerato separatore se alfanumerico).
 */
export async function checkAuthority(
  agentId: string,
  scope: string
): Promise<{ authorized: boolean; delegationId?: string; constraints?: Record<string, unknown>; reason: string }> {
  const delegations = await db.delegationContract.findMany({
    where: { agentId, active: true },
  })

  for (const d of delegations) {
    if (matchesScope(d.scope, scope)) {
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

/**
 * Pattern matching robusto per scope di delega.
 *
 * Regole:
 *  1. `*` (solo star) → match qualsiasi scope
 *  2. `pattern*` (star finale) → match se scope inizia con `pattern`
 *     E il carattere successivo nel scope (se presente) non è alfanumerico
 *     o underscore (prevenzione `tool:exec` → `tool:executor`)
 *  3. `pattern/*` o `pattern:*` → match se scope inizia con `pattern` + separatore
 *  4. Altrimenti → match esatto
 *
 * Esempi:
 *  - matchesScope('tool:exec', 'tool:exec') → true
 *  - matchesScope('tool:exec', 'tool:executor') → false (C9 fix)
 *  - matchesScope('tool:exec', 'tool:exec_malicious') → false (C9 fix)
 *  - matchesScope('tool:exec*', 'tool:exec') → true
 *  - matchesScope('tool:exec*', 'tool:executor') → false (alnum after)
 *  - matchesScope('tool:exec*', 'tool:exec:privileged') → true (separator :)
 *  - matchesScope('tool:exec/*', 'tool:exec/privileged') → true
 *  - matchesScope('tool:exec/*', 'tool:executor') → false
 *  - matchesScope('fs:read:/tmp/*', 'fs:read:/tmp/file1') → true
 *  - matchesScope('fs:read:/tmp/*', 'fs:read:/var/file1') → false
 *  - matchesScope('*', 'anything') → true
 */
function matchesScope(delegationScope: string, requestedScope: string): boolean {
  if (delegationScope === '*') return true
  if (delegationScope === requestedScope) return true

  // Star finale: `pattern*`
  if (delegationScope.endsWith('*') && !delegationScope.endsWith('/*')) {
    const prefix = delegationScope.slice(0, -1) // rimuove la star
    if (!requestedScope.startsWith(prefix)) return false
    // Il carattere successivo al prefix nel requestedScope deve essere
    // un separatore (non alfanumerico, non underscore) o la fine della stringa.
    // Questo previene `tool:exec*` dal matchare `tool:executor`.
    if (requestedScope.length === prefix.length) return true // match esatto dopo strip
    const nextChar = requestedScope[prefix.length]
    return !/[a-zA-Z0-9_]/.test(nextChar)
  }

  // `pattern/*` o `pattern:*` → prefix + separatore + qualsiasi cosa
  if (delegationScope.endsWith('/*') || delegationScope.endsWith(':*')) {
    const separator = delegationScope.endsWith('/*') ? '/' : ':'
    const prefix = delegationScope.slice(0, -2) // rimuove separator + star
    if (!requestedScope.startsWith(prefix)) return false
    if (requestedScope.length === prefix.length) return false // manca il separatore
    return requestedScope[prefix.length] === separator
  }

  return false
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
 *
 * C10 fix: prima di restituire i gates pending, marca come 'expired'
 * tutti quelli con expiresAt < now(). Questo risolve il bug per cui i gates
 * pending rimanevano per sempre anche dopo la scadenza (l'admin doveva
 * risolverli manualmente uno per uno).
 *
 * Il check è lazy (su lettura) per evitare di richiedere un cron job.
 * Throttled a max 1 esecuzione ogni 60s per non gravare su ogni GET.
 */
let lastExpireRun = 0
const EXPIRE_THROTTLE_MS = 60 * 1000 // 1 minuto

export async function expirePendingGates(force = false): Promise<number> {
  const now = Date.now()
  if (!force && now - lastExpireRun < EXPIRE_THROTTLE_MS) {
    return 0 // throttled
  }
  lastExpireRun = now

  const result = await db.approvalGate.updateMany({
    where: {
      status: 'pending',
      expiresAt: { lt: new Date() },
    },
    data: {
      status: 'expired',
      decidedAt: new Date(),
      decidedBy: 'system-auto-expire',
    },
  })

  if (result.count > 0) {
    await logAuditEntry({
      agentId: 'system',
      action: `Auto-expire ${result.count} gates`,
      decision: {
        source: 'auto-expire-job',
        intent: 'expire over-due pending gates',
        gate: 'hitl',
        outcome: 'expired',
        count: result.count,
      },
      readableNarrative: `Sistema: ${result.count} gate(s) di approvazione scaduti automaticamente (expiresAt < now) e marcati come 'expired'.`,
      reversible: false,
    })
  }

  return result.count
}

/**
 * Reset del throttle (solo per test).
 */
export function __resetExpireThrottleForTests(): void {
  lastExpireRun = 0
}

export async function listPendingGates(agentId?: string) {
  // C10: expire lazy i gates scaduti prima di restituire la lista
  await expirePendingGates()

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
    // C8 fix: tie-break a favore della safety SOLO se uno dei due è SAFETY.
    // Prima il codice bloccava sempre a parità di livello, anche per
    // AESTHETIC vs AESTHETIC (es. "usa colore blu" vs "usa colore rosso" → BLOCK).
    // Ora: se system è SAFETY → BLOCK (conservativo); altrimenti MODIFY
    // (l'utente può sovrascrivere policy di livello AESTHETIC o OPERATIONAL).
    if (systemLevel === 'SAFETY') {
      verdict = 'block'
      axiomTrail.push({
        step: '2_compare',
        rule: `Stesso livello gerarchico SAFETY: tie-break a favore della safety`,
        result: 'BLOCK: conflitto su policy di sicurezza, precauzione',
      })
    } else {
      verdict = 'modify'
      modifiedAction = `${userInstruction} [modificato per allinearsi a policy di pari livello: ${systemPolicy}]`
      axiomTrail.push({
        step: '2_compare',
        rule: `Stesso livello gerarchico ${systemLevel}: tie-break non bloccante (non SAFETY)`,
        result: `MODIFY: azione modificata per rispettare ${systemPolicy}`,
      })
    }
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
 * Registra una voce nel registro di audit comprensibile all'umano.
 *
 * C5: esposta come pubblica per permettere all'admin governance API
 * di loggare le operazioni di resolve-blocked, resolve-approval, toggle-ltl,
 * add-redline. Prima era privata e l'admin API non loggava nulla.
 */
export async function logAuditEntry(params: {
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
