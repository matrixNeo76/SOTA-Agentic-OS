/**
 * GET /api/skill-registry — list skills + stats
 * POST /api/skill-registry — register/search/version/seed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import {
  registerSkill, getSkill, searchSkills, updateSkillLifecycle,
  versionSkill, listSkills, skillRegistryStats, seedDefaultSkills,
  codeAnalysisProvenanceSkill,
} from '@/lib/skill-registry/registry'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const [stats, skills] = await Promise.all([
    skillRegistryStats(),
    listSkills({ limit: 50 }),
  ])
  return NextResponse.json({ stats, skills })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || codeAnalysisProvenanceSkill()

    if (action === 'register') {
      const { name, description, promptTemplate, version, tools, memory, constraints, examples, tests, tags } = body
      if (!name || !description || !promptTemplate) {
        return NextResponse.json({ error: 'Missing name, description, or promptTemplate' }, { status: 400 })
      }
      const result = await registerSkill({
        name, description, promptTemplate, version, tools, memory, constraints, examples, tests, tags, provenance,
      })
      return NextResponse.json(result)
    }

    if (action === 'search') {
      const { query, tags, limit, activeOnly } = body
      if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 })
      const results = await searchSkills(query, { tags, limit, activeOnly })
      return NextResponse.json({ results })
    }

    if (action === 'get') {
      const { uri } = body
      if (!uri) return NextResponse.json({ error: 'Missing uri' }, { status: 400 })
      const skill = await getSkill(uri)
      return NextResponse.json({ skill })
    }

    if (action === 'version') {
      const { sourceUri, newVersion, updates } = body
      if (!sourceUri || !newVersion || !updates) {
        return NextResponse.json({ error: 'Missing sourceUri, newVersion, or updates' }, { status: 400 })
      }
      const result = await versionSkill({ sourceUri, newVersion, updates, provenance })
      return NextResponse.json(result)
    }

    if (action === 'lifecycle') {
      const { uri, newState, actor, reason } = body
      if (!uri || !newState || !actor) {
        return NextResponse.json({ error: 'Missing uri, newState, or actor' }, { status: 400 })
      }
      await updateSkillLifecycle(uri, newState, actor, reason)
      return NextResponse.json({ updated: true })
    }

    if (action === 'seed-defaults') {
      const result = await seedDefaultSkills()
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
