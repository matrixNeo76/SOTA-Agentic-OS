import { NextResponse } from 'next/server'
import { exportMetricsPrometheus, metricStats } from '@/lib/kernel/observability'

export async function GET(req: Request) {
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
