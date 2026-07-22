/**
 * API: /api/cost/export — Export cost data as CSV
 *
 * GET ?format=csv — download CSV file
 * GET ?format=json — download JSON file
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || !session.user.active) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'csv'

  // Get all cost entries for this org
  const entries = await db.costEntry.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { timestamp: 'desc' },
    take: 1000,
  })

  if (format === 'json') {
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      organizationId: session.user.organizationId,
      totalEntries: entries.length,
      totalCost: entries.reduce((s, e) => s + e.cost, 0),
      entries,
    })
  }

  // CSV format
  const headers = ['Date', 'Time', 'Agent', 'Model', 'Phase', 'Tokens In', 'Tokens Out', 'Cost (USD)']
  const rows = entries.map(e => {
    const d = new Date(e.timestamp)
    return [
      d.toLocaleDateString('it-IT'),
      d.toLocaleTimeString('it-IT'),
      e.agentId,
      e.model,
      e.phase,
      e.tokensIn,
      e.tokensOut,
      e.cost.toFixed(6),
    ].join(',')
  })

  const csv = [headers.join(','), ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sota-cost-export-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}
