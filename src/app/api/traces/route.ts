import { NextRequest, NextResponse } from 'next/server'
import { getTrace, listTraces, traceStats } from '@/lib/kernel/observability'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'
  if (action === 'stats') {
    return NextResponse.json(await traceStats())
  }
  if (action === 'detail') {
    const traceId = searchParams.get('traceId')
    if (!traceId) return NextResponse.json({ error: 'traceId required' }, { status: 400 })
    const spans = await getTrace(traceId)
    return NextResponse.json({ traceId, spans })
  }
  const traces = await listTraces(20)
  return NextResponse.json({ traces })
}
