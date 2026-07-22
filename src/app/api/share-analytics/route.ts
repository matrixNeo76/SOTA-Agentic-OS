/**
 * API: /api/share-analytics — Analytics for shared conversations
 *
 * GET — list shared conversations with view counts, creation date, expiration
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

  const shared = await db.sharedConversation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      token: true,
      title: true,
      createdBy: true,
      expiresAt: true,
      viewCount: true,
      createdAt: true,
    },
  })

  const totalViews = shared.reduce((sum, s) => sum + s.viewCount, 0)
  const activeLinks = shared.filter(s => !s.expiresAt || new Date(s.expiresAt) > new Date()).length
  const expiredLinks = shared.length - activeLinks

  return NextResponse.json({
    analytics: {
      totalShares: shared.length,
      totalViews,
      activeLinks,
      expiredLinks,
      avgViewsPerShare: shared.length > 0 ? (totalViews / shared.length).toFixed(1) : '0',
    },
    shares: shared.map(s => ({
      id: s.id,
      token: s.token.substring(0, 8) + '...',
      title: s.title,
      createdBy: s.createdBy,
      viewCount: s.viewCount,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isExpired: s.expiresAt ? new Date(s.expiresAt) < new Date() : false,
      url: `/share/${s.token}`,
    })),
  })
}
