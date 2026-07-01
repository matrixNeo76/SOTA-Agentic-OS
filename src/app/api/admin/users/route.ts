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

  // Parse the body once and reuse. Calling req.json() twice throws because
  // the body stream is already consumed.
  const body = await req.json()
  const { action } = body

  const VALID_ROLES = ['admin', 'operator', 'sovereign', 'viewer']

  if (action === 'create') {
    const { email, name, role, password } = body
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    const finalRole = role || 'viewer'
    if (!VALID_ROLES.includes(finalRole)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return NextResponse.json({ error: 'User already exists' }, { status: 409 })

    const { hashPassword } = await import('@/lib/auth/session')
    const { hash, salt } = hashPassword(password)
    // Store as "salt:hash" — verifyPassword + authenticateUser expect this format.
    // Without the salt prefix, created users cannot log in.
    const passwordHash = `${salt}:${hash}`

    const user = await db.user.create({
      data: { email, name, role: finalRole, passwordHash },
    })
    return NextResponse.json({ created: true, userId: user.id, email: user.email, role: user.role })
  }

  if (action === 'update-role') {
    const { userId, role } = body
    if (!userId || !role) {
      return NextResponse.json({ error: 'Missing userId or role' }, { status: 400 })
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 })

    const user = await db.user.update({
      where: { id: userId },
      data: { role },
    })
    return NextResponse.json({ updated: true, userId: user.id, role: user.role })
  }

  if (action === 'toggle-active') {
    const { userId, active } = body
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    if (typeof active !== 'boolean') return NextResponse.json({ error: 'active must be boolean' }, { status: 400 })

    const existing = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 })

    await db.user.update({ where: { id: userId }, data: { active } })
    return NextResponse.json({ updated: true, userId, active })
  }

  if (action === 'revoke-sessions') {
    const { userId } = body
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const existing = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 })

    const result = await db.session.deleteMany({ where: { userId } })
    return NextResponse.json({ revoked: true, userId, count: result.count })
  }

  return NextResponse.json({ error: 'Unknown action. Use: create, update-role, toggle-active, revoke-sessions' }, { status: 400 })
}
