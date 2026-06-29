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
import { verifyEvent, listLTLRules, addLTLRule, deleteLTLRule, validateLTLFormula, previewFSM, type LTLRuleSpec } from '@/lib/kernel/ltl-monitor'
import { taintInput, checkSink, listTaintRecords, propagateTaint } from '@/lib/kernel/taint'
import { evaluateIntent, listAxioms, addAxiom, deleteAxiom, type Intent } from '@/lib/kernel/normative'
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
    propagateTaint(taintId, step)
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
    await addLTLRule(spec)
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'ltl_rule_added',
      payload: { ruleId: spec.ruleId, formula: spec.formula, addedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_ltl') {
    const { ruleId } = body
    await deleteLTLRule(ruleId)
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'ltl_rule_deleted',
      payload: { ruleId, deletedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_axiom') {
    const { axiom, priority } = body
    await addAxiom(axiom, priority)
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'axiom_added',
      payload: { axiom, priority, addedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_axiom') {
    const { id } = body
    await deleteAxiom(id)
    await publishAgentEvent({
      agentId: 'verifier', phase: '4',
      event: 'axiom_deleted',
      payload: { id, deletedBy: auth.email },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
