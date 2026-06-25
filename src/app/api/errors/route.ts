import { NextRequest, NextResponse } from 'next/server'
import { recordError, resolveError, listErrors, errorStats } from '@/lib/kernel/observability'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'
  if (action === 'stats') {
    return NextResponse.json(await errorStats())
  }
  const status = searchParams.get('status') || undefined
  const source = searchParams.get('source') || undefined
  const errors = await listErrors({ status, source, limit: 50 })
  return NextResponse.json({ errors })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body
  if (action === 'record') {
    const result = await recordError(body.input)
    return NextResponse.json({ ok: true, ...result })
  }
  if (action === 'resolve') {
    await resolveError(body.errorId, body.resolvedBy || 'admin', body.status)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
