/**
 * API: /api/verify (LTL Monitor + Taint Tracking + Normative Gate)
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyEvent, listLTLRules, addLTLRule, type LTLRuleSpec } from '@/lib/kernel/ltl-monitor'
import { taintInput, checkSink, listTaintRecords, propagateTaint } from '@/lib/kernel/taint'
import { evaluateIntent, listAxioms, addAxiom, type Intent } from '@/lib/kernel/normative'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
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

  if (action === 'verify_event') {
    const { eventLabel, eventType, payload } = body
    const result = await verifyEvent(eventLabel, eventType, payload)
    await db.agentLog.create({
      data: {
        agentId: 'verifier',
        phase: '4',
        event: 'verify_event',
        payload: JSON.stringify({ eventLabel, result }),
        level: result.verdict === 'reject' ? 'warn' : 'info',
      },
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
        payload: JSON.stringify({ sink, result }),
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
        payload: JSON.stringify({ intent, verdict }),
        level: verdict.allowed ? 'info' : 'warn',
      },
    })
    return NextResponse.json(verdict)
  }

  if (action === 'add_ltl') {
    const spec: LTLRuleSpec = body.spec
    await addLTLRule(spec)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_axiom') {
    const { axiom, priority } = body
    await addAxiom(axiom, priority)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
