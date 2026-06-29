/**
 * API: /api/verify (LTL Monitor + Taint Tracking + Normative Gate)
 *
 * C4 fix: GET (lettura rules/taint/axioms/events) richiede requireAuth.
 * POST è diviso in due categorie:
 *  - READ-ONLY (validate_ltl, preview_fsm): requireAuth — usati dall'editor
 *    LTL per validazione live senza persistere nulla
 *  - MUTATIVE (verify_event, taint_input, propagate, check_sink,
 *    evaluate_intent, add_ltl, delete_ltl, add_axiom, delete_axiom):
 *    requireAdmin perché modificano regole governance o iniettano eventi
 *    nel monitor LTL che potrebbero mascherare violazioni reali.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  verifyEvent, listLTLRules, addLTLRule, deleteLTLRule,
  validateLTLFormula, previewFSM, simulateLTL, type LTLRuleSpec,
  LTLRuleConflictError, LTLRuleNotFoundError,
} from '@/lib/kernel/ltl-monitor'
import { taintInput, checkSink, listTaintRecords, propagateTaint } from '@/lib/kernel/taint'
import { evaluateIntent, listAxioms, addAxiom, deleteAxiom, toggleAxiom, updateAxiom, type Intent, AxiomNotFoundError, AxiomConflictError } from '@/lib/kernel/normative'
import { db } from '@/lib/db'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const section = searchParams.get('section') || 'all'

  if (section === 'ltl') {
    const rules = await listLTLRules()
    return NextResponse.json({ rules })
  }
  if (section === 'taint') {
    const records = await listTaintRecords(30)
    return NextResponse.json({ records, sensitiveSinks: ['tool_call:exec', 'tool_call:file_write', 'tool_call:network', 'tool_call:db_write', 'tool_call:deploy', 'tool_call:delete'] })
  }
  if (section === 'normative') {
    const axioms = await listAxioms()
    return NextResponse.json({ axioms })
  }
  if (section === 'events') {
    const events = await db.verificationEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 30 })
    return NextResponse.json({ events })
  }

  // all
  const [rules, taintRecs, axioms, events] = await Promise.all([
    listLTLRules(),
    listTaintRecords(15),
    listAxioms(),
    db.verificationEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 15 }),
  ])
  return NextResponse.json({ rules, taint: taintRecs, axioms, events })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  // === READ-ONLY actions (requireAuth) ===
  // Queste non persistono nulla, sono solo calcoli stateless.
  if (action === 'validate_ltl') {
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response
    const { formula } = body
    const result = validateLTLFormula(formula)
    return NextResponse.json(result)
  }

  if (action === 'preview_fsm') {
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response
    const { formula } = body
    const result = previewFSM(formula)
    return NextResponse.json(result)
  }

  if (action === 'simulate_ltl') {
    // G3: read-only (requireAuth). Simula una formula su una sequenza di eventi.
    const auth = await requireAuth(req)
    if (!auth.ok) return auth.response
    const { formula, events } = body
    if (!formula || !Array.isArray(events)) {
      return NextResponse.json({ ok: false, error: 'Missing formula or events array' }, { status: 400 })
    }
    const result = simulateLTL(formula, events)
    return NextResponse.json(result)
  }

  // === MUTATIVE actions (requireAdmin) ===
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (action === 'verify_event') {
    const { eventLabel, eventType, payload } = body
    const result = await verifyEvent(eventLabel, eventType, payload)
    await db.agentLog.create({
      data: {
        agentId: 'verifier',
        phase: '4',
        event: 'verify_event',
        payload: JSON.stringify({ eventLabel, result, triggeredBy: auth.email }),
        level: result.verdict === 'reject' ? 'warn' : 'info',
      },
    })
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'verify_event',
      level: result.verdict === 'reject' ? 'warn' : 'info',
      payload: { eventLabel, verdict: result.verdict, violations: result.violations.length, triggeredBy: auth.email },
    })
    return NextResponse.json(result)
  }

  if (action === 'taint_input') {
    const { source, payload } = body
    const id = await taintInput(source, payload)
    return NextResponse.json({ ok: true, taintId: id })
  }

  if (action === 'propagate') {
    const { taintId, step } = body
    await propagateTaint(taintId, step)
    return NextResponse.json({ ok: true })
  }

  if (action === 'check_sink') {
    const { sink, taintIds } = body
    const result = await checkSink(sink, taintIds)
    await db.agentLog.create({
      data: {
        agentId: 'verifier',
        phase: '4',
        event: 'check_sink',
        payload: JSON.stringify({ sink, result, triggeredBy: auth.email }),
        level: result.allowed ? 'info' : 'warn',
      },
    })
    return NextResponse.json(result)
  }

  if (action === 'evaluate_intent') {
    const intent: Intent = body.intent
    const verdict = await evaluateIntent(intent)
    await db.agentLog.create({
      data: {
        agentId: 'verifier',
        phase: '4',
        event: 'evaluate_intent',
        payload: JSON.stringify({ intent, verdict, triggeredBy: auth.email }),
        level: verdict.allowed ? 'info' : 'warn',
      },
    })
    return NextResponse.json(verdict)
  }

  if (action === 'add_ltl') {
    const spec: LTLRuleSpec = body.spec
    try {
      await addLTLRule(spec)
    } catch (e: any) {
      // B3: ruleId duplicato → 409 Conflict
      if (e instanceof LTLRuleConflictError) {
        return NextResponse.json(
          { ok: false, error: e.message, code: 'RULE_ID_CONFLICT', ruleId: e.ruleId },
          { status: 409 },
        )
      }
      // Formula non valida o altro errore → 400
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'ltl_rule_added',
      payload: { ruleId: spec.ruleId, formula: spec.formula, addedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_ltl') {
    const { ruleId } = body
    try {
      await deleteLTLRule(ruleId)
    } catch (e: any) {
      // B5: ruleId non trovato → 404
      if (e instanceof LTLRuleNotFoundError) {
        return NextResponse.json(
          { ok: false, error: e.message, code: 'RULE_NOT_FOUND', ruleId: e.ruleId },
          { status: 404 },
        )
      }
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'ltl_rule_deleted',
      payload: { ruleId, deletedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_axiom') {
    const { axiom, priority } = body
    try {
      await addAxiom(axiom, priority)
    } catch (e: any) {
      // B10: assioma duplicato → 409 Conflict
      if (e instanceof AxiomConflictError) {
        return NextResponse.json(
          { ok: false, error: e.message, code: 'AXIOM_CONFLICT' },
          { status: 409 },
        )
      }
      // Validazione (priorità non valida, testo mancante) → 400
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'axiom_added',
      payload: { axiom, priority, addedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_axiom') {
    const { id } = body
    try {
      await deleteAxiom(id)
    } catch (e: any) {
      // B5: id non trovato → 404
      if (e instanceof AxiomNotFoundError) {
        return NextResponse.json(
          { ok: false, error: e.message, code: 'AXIOM_NOT_FOUND', id: e.id },
          { status: 404 },
        )
      }
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'axiom_deleted',
      payload: { id, deletedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'toggle_axiom') {
    // G2b: attiva/disattiva un assioma (soft delete / restore)
    const { id, active } = body
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })
    if (typeof active !== 'boolean') return NextResponse.json({ ok: false, error: 'active must be boolean' }, { status: 400 })
    try {
      await toggleAxiom(id, active)
    } catch (e: any) {
      if (e instanceof AxiomNotFoundError) {
        return NextResponse.json({ ok: false, error: e.message, code: 'AXIOM_NOT_FOUND', id: e.id }, { status: 404 })
      }
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'axiom_toggled',
      level: active ? 'info' : 'warn',
      payload: { id, active, toggledBy: auth.email },
    })
    return NextResponse.json({ ok: true, id, active })
  }

  if (action === 'update_axiom') {
    // G2b: aggiorna testo e/o priorità di un assioma
    const { id, axiom, priority } = body
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })
    try {
      await updateAxiom(id, { axiom, priority })
    } catch (e: any) {
      if (e instanceof AxiomNotFoundError) {
        return NextResponse.json({ ok: false, error: e.message, code: 'AXIOM_NOT_FOUND', id: e.id }, { status: 404 })
      }
      if (e instanceof AxiomConflictError) {
        return NextResponse.json({ ok: false, error: e.message, code: 'AXIOM_CONFLICT' }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
    }
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'axiom_updated',
      level: 'info',
      payload: { id, changes: { axiom, priority }, updatedBy: auth.email },
    })
    return NextResponse.json({ ok: true, id })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
