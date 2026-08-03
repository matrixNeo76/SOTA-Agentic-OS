/**
 * Governance Hooks — Fase 5 G6 + G7 + G8
 *
 * Hook di governance integrati nel runtime per enforcement reale:
 *
 *  G6: taintInput su input esterni + checkSink prima di tool call sensibili
 *  G7: verifyEvent (LTL monitor) su state-change del runtime
 *  G8: evaluateRedLines prima di azioni sensibili (tool call, deploy, delete)
 *
 * Design:
 *  - Tutti gli hook sono best-effort: se falliscono (es. DB non disponibile),
 *    loggano l'errore ma non bloccano l'esecuzione del runtime.
 *    L'executor può scegliere come reagire al verdict (block/warn/allow).
 *  - Gli hook usano le funzioni esistenti in lib/kernel/* (no duplicazione).
 *  - Ogni hook ritorna un verdict strutturato { allowed, reason, violations }.
 */

import { taintInput, checkSink } from '@/lib/kernel/taint'
import { verifyEvent } from '@/lib/kernel/ltl-monitor'
import { db } from '@/lib/db'
import { publishAgentEvent } from '@/lib/ws-publish'

// === G6: Taint Hooks =================================================

/**
 * Sorgenti di input esterni che devono essere marcate come tainted.
 * Chiamare quando il runtime riceve input da queste sorgenti.
 */
export async function markExternalInputTainted(
  source: 'user_chat' | 'api_response' | 'external_feed' | 'file_input',
  payload: string,
  agentId: string,
): Promise<{ taintId: string | null }> {
  try {
    const taintId = await taintInput(source, payload)
    await publishAgentEvent({
      agentId, phase: '4',
      event: 'input_tainted',
      level: 'info',
      payload: { taintId, source, payloadLength: payload.length },
    })
    return { taintId }
  } catch (err: any) {
    console.error(`[governance-hooks] taintInput failed: ${err.message}`)
    return { taintId: null }
  }
}

/**
 * Sensitive sinks — tool call che richiedono check taint.
 * Mappatura tool name → sink category.
 */
const TOOL_SINK_MAP: Record<string, string> = {
  exec: 'tool_call:exec',
  shell: 'tool_call:exec',
  bash: 'tool_call:exec',
  file_write: 'tool_call:file_write',
  write_file: 'tool_call:file_write',
  save_file: 'tool_call:file_write',
  network: 'tool_call:network',
  http: 'tool_call:network',
  fetch: 'tool_call:network',
  request: 'tool_call:network',
  db_write: 'tool_call:db_write',
  database_write: 'tool_call:db_write',
  sql_write: 'tool_call:db_write',
  deploy: 'tool_call:deploy',
  publish: 'tool_call:deploy',
  release: 'tool_call:deploy',
  delete: 'tool_call:delete',
  remove: 'tool_call:delete',
  rm: 'tool_call:delete',
}

/**
 * G6: Verifica se un tool call sta consumando dati tainted.
 * Da chiamare prima di eseguire qualsiasi tool call.
 *
 * @param toolName Nome del tool (es. "exec", "file_write", "deploy")
 * @param taintIds Array di taintId attivi nel contesto corrente
 * @returns { allowed, reason, blockedFlows }
 */
export async function checkToolCallSink(
  toolName: string,
  taintIds: string[],
  agentId: string,
): Promise<{ allowed: boolean; reason: string; sink?: string }> {
  const sink = TOOL_SINK_MAP[toolName.toLowerCase()]
  if (!sink) {
    // Tool non sensibile → allow
    return { allowed: true, reason: `Tool '${toolName}' is not a sensitive sink` }
  }

  if (taintIds.length === 0) {
    return { allowed: true, reason: 'No active taint in context', sink }
  }

  try {
    const result = await checkSink(sink, taintIds)
    if (!result.allowed) {
      await publishAgentEvent({
        agentId, phase: '4',
        event: 'taint_blocked_sink',
        level: 'warn',
        payload: { toolName, sink, taintIds, blockedFlows: result.blockedFlows.length },
      })
    }
    return { allowed: result.allowed, reason: result.reason, sink }
  } catch (err: any) {
    console.error(`[governance-hooks] checkSink failed: ${err.message}`)
    // Fail-open: se il check fallisce per errore tecnico, non bloccare
    // (ma logga per audit). In produzione critica si potrebbe scegliere fail-close.
    return { allowed: true, reason: `checkSink error (fail-open): ${err.message}`, sink }
  }
}

// === G7: LTL Hook ====================================================

/**
 * G7: Pubblica un evento state-change al LTL monitor.
 *
 * Da chiamare quando il runtime cambia fase:
 *   plan → check → execute → error → reflect → halt → success
 *
 * Il monitor valuta l'evento contro tutte le regole LTL attive e
 * ritorna il verdict + le violazioni.
 */
export async function publishStateChangeToLTL(
  stateLabel: 'plan' | 'check' | 'execute' | 'error' | 'reflect' | 'halt' | 'success' | 'high_risk' | 'human_approval' | 'tainted' | 'sensitive_call',
  eventType: string,
  payload: Record<string, unknown>,
  agentId: string,
): Promise<{ verdict: 'accept' | 'warn' | 'reject'; violations: { ruleId: string; reason: string }[] }> {
  try {
    const result = await verifyEvent(stateLabel, eventType, payload)
    if (result.verdict !== 'accept') {
      await publishAgentEvent({
        agentId, phase: '4',
        event: 'ltl_violation',
        level: result.verdict === 'reject' ? 'warn' : 'info',
        payload: {
          stateLabel, verdict: result.verdict,
          violations: result.violations.map(v => ({ ruleId: v.ruleId, reason: v.reason })),
        },
      })
    }
    return {
      verdict: result.verdict,
      violations: result.violations.map(v => ({ ruleId: v.ruleId, reason: v.reason })),
    }
  } catch (err: any) {
    console.error(`[governance-hooks] verifyEvent failed: ${err.message}`)
    return { verdict: 'accept', violations: [] }
  }
}

// === G8: Red Lines Hook ==============================================

/**
 * G8: Valuta le Red Lines attive contro un'azione sensibile.
 *
 * A differenza di ERL (che valuta le red lines su euristiche proposte),
 * questo hook valuta le red lines su AZIONI in corso di esecuzione.
 *
 * C2 fix (ERL audit Fase A): matching meno aggressivo.
 * PRIMA: keywordOverlap con qualsiasi token >4 char come substring → falsi positivi
 * (es. Red Line "non ignorare dataset" bloccava "leggi dataset").
 * ORA: usa solo substring match esatto (actionContainsDesc o descContainsAction).
 * Per matching più fine, l'admin può usare Red Line description specifiche.
 *
 * @param action Descrizione dell'azione (es. "delete user record", "deploy to prod")
 * @param agentId Agente che richiede l'azione
 * @returns { allowed, blockingRedLines }
 */
export async function evaluateRedLinesForAction(
  action: string,
  agentId: string,
): Promise<{ allowed: boolean; blockingRedLines: { id: string; description: string; severity: string }[] }> {
  try {
    const redLines = await db.redLine.findMany({
      where: { active: true },
      select: { id: true, description: true, rationale: true, severity: true },
    })

    const actionLower = action.toLowerCase()
    const blocking: { id: string; description: string; severity: string }[] = []

    for (const rl of redLines) {
      const rlDescLower = rl.description.toLowerCase()

      // C2 fix: usa solo substring match bidirezionale (esatto, non keyword overlap).
      // Questo è conservativo: blocca solo se l'azione contiene la descrizione
      // della Red Line (o viceversa) come substring esatta.
      const actionContainsDesc = actionLower.includes(rlDescLower)
      const descContainsAction = rlDescLower.includes(actionLower)

      if (actionContainsDesc || descContainsAction) {
        blocking.push({ id: rl.id, description: rl.description, severity: rl.severity })
      }
    }

    if (blocking.length > 0) {
      await publishAgentEvent({
        agentId, phase: '5',
        event: 'redline_violation',
        level: 'warn',
        payload: { action, blockingRedLines: blocking.map(b => b.description) },
      })
    }

    return {
      allowed: blocking.length === 0,
      blockingRedLines: blocking,
    }
  } catch (err: any) {
    console.error(`[governance-hooks] evaluateRedLines failed: ${err.message}`)
    // Fail-open su errori tecnici
    return { allowed: true, blockingRedLines: [] }
  }
}

// === Composite: pre-execute gate ====================================

/**
 * Gate composito da chiamare prima di eseguire un'azione sensibile.
 * Combina G6 (taint) + G7 (LTL) + G8 (red lines).
 *
 * @returns verdict aggregato: se uno qualsiasi blocca, l'azione è bloccata
 */
export async function preExecuteGate(params: {
  agentId: string
  action: string
  toolName?: string
  taintIds?: string[]
  stateLabel?: 'plan' | 'check' | 'execute' | 'error' | 'reflect' | 'halt' | 'success' | 'high_risk' | 'human_approval' | 'tainted' | 'sensitive_call'
}): Promise<{
  allowed: boolean
  reasons: string[]
  blockingRedLines: { id: string; description: string; severity: string }[]
  ltlViolations: { ruleId: string; reason: string }[]
  taintBlocked: boolean
}> {
  const { agentId, action, toolName, taintIds = [], stateLabel } = params
  const reasons: string[] = []
  let taintBlocked = false

  // G6: Taint check (solo se toolName è specificato ed è un sink sensibile)
  if (toolName) {
    const taintResult = await checkToolCallSink(toolName, taintIds, agentId)
    if (!taintResult.allowed) {
      taintBlocked = true
      reasons.push(`Taint: ${taintResult.reason}`)
    }
  }

  // G7: LTL check (solo se stateLabel è specificato)
  let ltlViolations: { ruleId: string; reason: string }[] = []
  if (stateLabel) {
    const ltlResult = await publishStateChangeToLTL(stateLabel, 'pre_execute', { action, toolName }, agentId)
    ltlViolations = ltlResult.violations
    if (ltlResult.verdict === 'reject') {
      reasons.push(`LTL: ${ltlResult.violations.map(v => `${v.ruleId}: ${v.reason}`).join('; ')}`)
    }
  }

  // G8: Red Lines check
  const redLineResult = await evaluateRedLinesForAction(action, agentId)
  if (!redLineResult.allowed) {
    reasons.push(`Red Lines: ${redLineResult.blockingRedLines.map(r => r.description).join('; ')}`)
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    blockingRedLines: redLineResult.blockingRedLines,
    ltlViolations,
    taintBlocked,
  }
}
