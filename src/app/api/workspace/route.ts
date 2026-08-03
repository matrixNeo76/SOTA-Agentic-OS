/**
 * API: /api/workspace — Workspace management
 *
 * GET    — list workspaces for current user
 * POST   action='create'  — create new workspace
 * POST   action='list'    — list workspaces in org
 * POST   action='get'     — get workspace details with members
 * POST   action='add_member'    — add user to workspace
 * POST   action='remove_member' — remove user from workspace
 * POST   action='update_role'   — change user role in workspace
 * POST   action='delete'        — delete workspace (owner only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const session = await db.session.findUnique({
    where: { token },
    include: { user: { include: { workspaces: { include: { workspace: true } } } } },
  })
  if (!session || !session.user.active) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  // Get user's workspaces + org's shared workspaces
  const orgWorkspaces = await db.workspace.findMany({
    where: {
      organizationId: session.user.organizationId,
      OR: [
        { isShared: true },
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
      ],
    },
    include: {
      _count: { select: { members: true } },
      members: {
        where: { userId: session.user.id },
        select: { role: true },
      },
    },
  })

  return NextResponse.json({
    workspaces: orgWorkspaces.map(ws => ({
      id: ws.id,
      name: ws.name,
      isShared: ws.isShared,
      ownerId: ws.ownerId,
      memberCount: ws._count.members,
      myRole: ws.members[0]?.role || (ws.ownerId === session.user.id ? 'owner' : null),
      createdAt: ws.createdAt,
    })),
  })
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
  const orgId = session.user.organizationId
  const userId = session.user.id

  // === Create workspace ===
  if (action === 'create') {
    const { name, isShared } = body
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const ws = await db.workspace.create({
      data: {
        name,
        organizationId: orgId,
        ownerId: isShared ? null : userId,
        isShared: isShared || false,
      },
    })

    // Add creator as owner
    await db.userWorkspace.create({
      data: { userId, workspaceId: ws.id, role: 'owner' },
    })

    return NextResponse.json({ ok: true, workspaceId: ws.id })
  }

  // === Get workspace details ===
  if (action === 'get') {
    const { workspaceId } = body
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, name: true, role: true },
            },
          },
        },
      },
    })
    if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (ws.organizationId !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ workspace: ws })
  }

  // === Add member ===
  if (action === 'add_member') {
    const { workspaceId, userId: targetUserId, role } = body
    const ws = await db.workspace.findUnique({ where: { id: workspaceId } })
    if (!ws || ws.organizationId !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await db.userWorkspace.upsert({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      create: { userId: targetUserId, workspaceId, role: role || 'viewer' },
      update: { role: role || 'viewer' },
    })
    return NextResponse.json({ ok: true })
  }

  // === Remove member ===
  if (action === 'remove_member') {
    const { workspaceId, userId: targetUserId } = body
    await db.userWorkspace.delete({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  // === Update role ===
  if (action === 'update_role') {
    const { workspaceId, userId: targetUserId, role } = body
    await db.userWorkspace.update({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      data: { role },
    })
    return NextResponse.json({ ok: true })
  }

  // === Delete workspace ===
  if (action === 'delete') {
    const { workspaceId } = body
    const ws = await db.workspace.findUnique({ where: { id: workspaceId } })
    if (!ws || ws.organizationId !== orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (ws.isShared) {
      return NextResponse.json({ error: 'Cannot delete shared workspace' }, { status: 400 })
    }
    if (ws.ownerId !== userId) {
      return NextResponse.json({ error: 'Only owner can delete' }, { status: 403 })
    }
    await db.workspace.delete({ where: { id: workspaceId } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}
