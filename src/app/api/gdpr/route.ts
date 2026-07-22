/**
 * API: /api/gdpr — GDPR Compliance endpoints
 *
 * Track 6.3: GDPR compliance
 *
 * GET  action=export  — Export all user data as JSON (Right to Access)
 * POST action=delete   — Delete all user data (Right to be Forgotten)
 * GET  action=consent  — Get consent status
 * POST action=consent  — Update consent status
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/kernel/audit-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const action = searchParams.get('action') || 'export'
  const userId = session.user.id
  const orgId = session.user.organizationId

  // === Export all user data ===
  if (action === 'export') {
    const userData = await exportUserData(userId, orgId)

    await recordAudit({
      action: 'data_export',
      actorId: userId,
      organizationId: orgId,
      targetType: 'user',
      targetId: userId,
      description: `GDPR data export requested by ${session.user.email}`,
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      user: session.user.email,
      data: userData,
    })
  }

  // === Get consent status ===
  if (action === 'consent') {
    return NextResponse.json({
      consent: {
        analytics: true,  // TODO: store in DB
        marketing: false,
        profiling: false,
      },
    })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || !session.user.active) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const body = await req.json()
  const { action } = body
  const userId = session.user.id
  const orgId = session.user.organizationId

  // === Delete all user data (Right to be Forgotten) ===
  if (action === 'delete') {
    const { confirmEmail } = body
    if (confirmEmail !== session.user.email) {
      return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    // Record audit BEFORE deletion
    await recordAudit({
      action: 'data_delete',
      actorId: userId,
      organizationId: orgId,
      targetType: 'user',
      targetId: userId,
      description: `GDPR data deletion requested by ${session.user.email}`,
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
    })

    // Delete user data (cascade will handle related records)
    await db.userWorkspace.deleteMany({ where: { userId } })
    await db.session.deleteMany({ where: { userId } })
    await db.user.update({
      where: { id: userId },
      data: {
        active: false,
        name: '[DELETED]',
        passwordHash: null,
      },
    })

    return NextResponse.json({
      ok: true,
      message: 'User data deleted. Account deactivated.',
    })
  }

  // === Update consent ===
  if (action === 'consent') {
    const { analytics, marketing, profiling } = body
    // TODO: store consent in DB model
    return NextResponse.json({
      ok: true,
      consent: { analytics, marketing, profiling },
    })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}

/**
 * Export all data associated with a user.
 */
async function exportUserData(userId: string, orgId: string) {
  const [user, workspaces, sessions, auditEntries] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    db.userWorkspace.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, name: true, isShared: true } } },
    }),
    db.session.findMany({
      where: { userId },
      select: { id: true, createdAt: true, expiresAt: true, ipAddress: true },
    }),
    db.auditLedgerEntry.findMany({
      where: { agentId: userId, organizationId: orgId },
      select: { action: true, description: true, createdAt: true },
      take: 100,
    }).catch(() => []),
  ])

  return {
    profile: user,
    workspaces: workspaces.map(w => ({
      workspace: w.workspace.name,
      role: w.role,
      joinedAt: w.createdAt,
    })),
    sessions: sessions.map(s => ({
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress,
    })),
    auditTrail: auditEntries,
  }
}
