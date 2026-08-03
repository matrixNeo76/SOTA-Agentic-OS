/**
 * API: /api/organization — Organization management
 *
 * GET    — list organizations for current user
 * POST   — create new organization (with default workspace + owner user)
 *   body: { action: 'create', name, slug, compliancePreset? }
 * POST   — get organization details
 *   body: { action: 'get', organizationId }
 * POST   — update organization
 *   body: { action: 'update', organizationId, name?, plan?, compliancePreset? }
 * POST   — list members
 *   body: { action: 'members', organizationId }
 * POST   — invite member
 *   body: { action: 'invite', organizationId, email, role }
 * POST   — remove member
 *   body: { action: 'remove_member', organizationId, userId }
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth/session'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Get current user from session
  const token = req.cookies.get('sota_session')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || !session.user.active) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const org = await db.organization.findUnique({
    where: { id: session.user.organizationId },
    include: {
      workspaces: true,
      _count: { select: { users: true } },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  return NextResponse.json({
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      compliancePreset: org.compliancePreset,
      stripeCustomerId: org.stripeCustomerId,
      memberCount: org._count.users,
      workspaces: org.workspaces.map(w => ({
        id: w.id,
        name: w.name,
        isShared: w.isShared,
        ownerId: w.ownerId,
      })),
    },
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

  // === Create new organization ===
  if (action === 'create') {
    const { name, slug, compliancePreset } = body
    if (!name || !slug) {
      return NextResponse.json({ error: 'name and slug required' }, { status: 400 })
    }

    // Check slug uniqueness
    const existing = await db.organization.findUnique({ where: { slug } })
    if (existing) {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
    }

    // Create org + default shared workspace
    const org = await db.organization.create({
      data: {
        name,
        slug,
        compliancePreset: compliancePreset || 'generic',
        plan: 'free',
      },
    })

    const workspace = await db.workspace.create({
      data: {
        name: 'Shared Workspace',
        organizationId: org.id,
        isShared: true,
      },
    })

    return NextResponse.json({
      ok: true,
      organizationId: org.id,
      workspaceId: workspace.id,
    })
  }

  // === Get organization details ===
  if (action === 'get') {
    const { organizationId } = body
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      include: {
        workspaces: { include: { _count: { select: { members: true } } } },
        _count: { select: { users: true } },
      },
    })
    if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ organization: org })
  }

  // === List members ===
  if (action === 'members') {
    const { organizationId } = body
    const users = await db.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ members: users })
  }

  // === Invite member (create user with temp password) ===
  if (action === 'invite') {
    const { organizationId, email, role, name } = body
    if (!email || !organizationId) {
      return NextResponse.json({ error: 'email and organizationId required' }, { status: 400 })
    }

    // Check if user already exists
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'User already exists' }, { status: 409 })
    }

    // Generate temp password
    const tempPassword = randomBytes(6).toString('hex')
    const { hash, salt } = hashPassword(tempPassword)

    const newUser = await db.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        passwordHash: `${salt}:${hash}`,
        role: role || 'viewer',
        organizationId,
        active: true,
      },
    })

    // Add to shared workspace
    const sharedWs = await db.workspace.findFirst({
      where: { organizationId, isShared: true },
    })
    if (sharedWs) {
      await db.userWorkspace.create({
        data: { userId: newUser.id, workspaceId: sharedWs.id, role: 'editor' },
      })
    }

    return NextResponse.json({
      ok: true,
      userId: newUser.id,
      tempPassword, // In production: send via email, don't return
    })
  }

  // === Remove member ===
  if (action === 'remove_member') {
    const { organizationId, userId } = body
    await db.user.update({
      where: { id: userId },
      data: { active: false },
    })
    return NextResponse.json({ ok: true })
  }

  // === Update organization ===
  if (action === 'update') {
    const { organizationId, name, plan, compliancePreset } = body
    const org = await db.organization.update({
      where: { id: organizationId },
      data: {
        ...(name && { name }),
        ...(plan && { plan }),
        ...(compliancePreset && { compliancePreset }),
      },
    })
    return NextResponse.json({ ok: true, organization: org })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}
