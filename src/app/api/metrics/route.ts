import { NextRequest, NextResponse } from 'next/server'
import { exportMetricsPrometheus, metricStats } from '@/lib/kernel/observability'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const format = url.searchParams.get('format')
  if (format === 'prometheus') {
    const text = exportMetricsPrometheus()
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    })
  }
  return NextResponse.json(metricStats())
}
