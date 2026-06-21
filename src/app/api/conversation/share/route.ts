/**
 * API: /api/conversation/share
 *
 * POST - crea una shared conversation con signed token
 *   body: { action: 'create', branchId, title, messages, expiresInHours? }
 *   returns: { ok, token, url }
 *
 * GET  - lista shared conversations (admin)
 *   returns: { shared: [...] }
 *
 * POST action='view' - increment view count + return messages (for public route)
 *   body: { action: 'view', token }
 *   returns: { ok, title, messages, expiresAt }
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'

export async function GET() {
  const shared = await db.sharedConversation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      token: true,
      branchId: true,
      title: true,
      createdBy: true,
      expiresAt: true,
      viewCount: true,
      createdAt: true,
    },
  })
  return NextResponse.json({ shared })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const { branchId, title, messages, expiresInHours, createdBy } = body
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages richiesto' }, { status: 400 })
    }

    const token = randomBytes(16).toString('hex')
    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 3600 * 1000)
      : null

    const shared = await db.sharedConversation.create({
      data: {
        token,
        branchId: branchId || 'root',
        title: title || 'Conversazione condivisa',
        messagesJson: JSON.stringify(messages),
        createdBy: createdBy || 'admin',
        expiresAt,
      },
    })

    return NextResponse.json({
      ok: true,
      token: shared.token,
      url: `/share/${shared.token}`,
      expiresAt: shared.expiresAt,
    })
  }

  if (action === 'view') {
    const { token } = body
    const shared = await db.sharedConversation.findUnique({ where: { token } })
    if (!shared) {
      return NextResponse.json({ error: 'Token non valido' }, { status: 404 })
    }
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Link scaduto' }, { status: 410 })
    }

    // Increment view count
    await db.sharedConversation.update({
      where: { id: shared.id },
      data: { viewCount: { increment: 1 } },
    })

    return NextResponse.json({
      ok: true,
      title: shared.title,
      messages: JSON.parse(shared.messagesJson),
      expiresAt: shared.expiresAt,
      viewCount: shared.viewCount + 1,
      createdAt: shared.createdAt,
    })
  }

  if (action === 'revoke') {
    const { token } = body
    await db.sharedConversation.delete({ where: { token } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}
