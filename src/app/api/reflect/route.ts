/**
 * API: /api/reflect (ERL + AutoSOTA)
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  reflectAndLearn, retrieveHeuristics, feedbackHeuristic, listRedLines,
  type ReflectionInput,
} from '@/lib/kernel/erl'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'

  if (action === 'retrieve') {
    const q = searchParams.get('q') || ''
    const k = Number(searchParams.get('k') || 5)
    const heuristics = await retrieveHeuristics(q, k)
    return NextResponse.json({ heuristics })
  }

  if (action === 'redlines') {
    const redLines = await listRedLines()
    return NextResponse.json({ redLines })
  }

  // list
  const [heuristics, reflections] = await Promise.all([
    db.heuristic.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    db.reflectionLog.findMany({ orderBy: { timestamp: 'desc' }, take: 20 }),
  ])
  return NextResponse.json({ heuristics, reflections })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'reflect') {
    const input: ReflectionInput = body.input
    const result = await reflectAndLearn(input)
    await db.agentLog.create({
      data: {
        agentId: 'reflective',
        phase: '5',
        event: 'reflection',
        payload: JSON.stringify({ input, result }),
        level: result.approved ? 'info' : 'warn',
      },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'feedback') {
    const { heuristicId, success } = body
    await feedbackHeuristic(heuristicId, success)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
