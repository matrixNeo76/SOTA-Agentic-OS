/**
 * GET /api/admin/users — List all users
 * POST /api/admin/users — Create/update/delete user, change role
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      active: true,
      createdAt: true,
      sessions: { select: { id: true, expiresAt: true, ipAddress: true } },
    },
    take: 50,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      tenantId: u.tenantId,
      active: u.active,
      createdAt: u.createdAt.toISOString(),
      activeSessions: u.sessions.filter((s) => s.expiresAt > new Date()).length,
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const { action } = await req.json()

  if (action === 'create') {
    const { email, name, role, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return NextResponse.json({ error: 'User already exists' }, { status: 409 })

    const { hashPassword } = await import('@/lib/auth/session')
    const { hash, salt } = hashPassword(password)

    const user = await db.user.create({
      data: { email, name, role: role || 'viewer', passwordHash: hash },
    })
    return NextResponse.json({ created: true, userId: user.id })
  }

  if (action === 'update-role') {
    const { userId, role } = await req.json()
    if (!userId || !role) {
      return NextResponse.json({ error: 'Missing userId or role' }, { status: 400 })
    }

    const user = await db.user.update({
      where: { id: userId },
      data: { role },
    })
    return NextResponse.json({ updated: true, userId: user.id, role: user.role })
  }

  if (action === 'toggle-active') {
    const { userId, active } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    await db.user.update({ where: { id: userId }, data: { active } })
    return NextResponse.json({ updated: true })
  }

  if (action === 'revoke-sessions') {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    await db.session.deleteMany({ where: { userId } })
    return NextResponse.json({ revoked: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
