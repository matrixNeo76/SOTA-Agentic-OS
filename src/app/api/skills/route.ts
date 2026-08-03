/**
 * API: /api/skills — Skill management CRUD (Fase 4 Track 4.3)
 *
 * GET  — list skills (filtered by category, includePublic)
 * POST action='create'     — create new skill
 * POST action='import'     — import skill from JSON
 * POST action='export'     — export skill as JSON
 * POST action='execute'    — execute skill with variables
 * POST action='delete'     — soft-delete skill
 * POST action='initialize' — seed builtin skills
 * POST action='get'        — get skill details
 * POST action='suggest'    — suggest skills based on input text
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createSkill, importSkill, exportSkill, executeSkill,
  listSkills, deleteSkill, initializeBuiltinSkills, getSkill, suggestSkills,
} from '@/lib/kernel/skill-manager'
import { verifySession } from '@/lib/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getContext(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) {
    return { tenantId: 'default', userId: 'anonymous' }
  }
  const session = await verifySession(token)
  if (!session) {
    return { tenantId: 'default', userId: 'anonymous' }
  }
  return { tenantId: session.tenantId, userId: session.userId }
}

export async function GET(req: NextRequest) {
  const { tenantId } = await getContext(req)
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || undefined
  const includePublic = searchParams.get('public') === 'true'

  const skills = await listSkills(tenantId, { category, includePublic })
  return NextResponse.json({ skills })
}

export async function POST(req: NextRequest) {
  const { tenantId, userId } = await getContext(req)
  const body = await req.json()
  const { action } = body

  // === Create ===
  if (action === 'create') {
    try {
      const skill = await createSkill(body, tenantId, userId)
      return NextResponse.json({ ok: true, skillId: skill.id })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Import ===
  if (action === 'import') {
    try {
      const { json } = body
      const skill = await importSkill(json, tenantId, userId)
      return NextResponse.json({ ok: true, skillId: skill.id })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Export ===
  if (action === 'export') {
    try {
      const { skillId } = body
      const json = await exportSkill(skillId)
      return NextResponse.json({ ok: true, json })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Execute ===
  if (action === 'execute') {
    try {
      const { skillId, variables } = body
      const result = await executeSkill(skillId, variables || {}, tenantId)
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Delete ===
  if (action === 'delete') {
    try {
      await deleteSkill(body.skillId, tenantId)
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Initialize builtin ===
  if (action === 'initialize') {
    try {
      await initializeBuiltinSkills(tenantId)
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // === Get details ===
  if (action === 'get') {
    const skill = await getSkill(body.skillId, tenantId)
    if (!skill) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ skill })
  }

  // === Suggest ===
  if (action === 'suggest') {
    const { input, topK } = body
    if (!input) return NextResponse.json({ error: 'input required' }, { status: 400 })
    const suggestions = await suggestSkills(input, tenantId, topK || 3)
    return NextResponse.json({ suggestions })
  }

  return NextResponse.json({ error: 'Action not recognized' }, { status: 400 })
}
