/**
 * GET /api/skills/discover — Public skill catalog for agent discovery
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/api-key'
import { discoverSkills } from '@/lib/skill-registry/skill-export'

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, 'read')
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const query = url.searchParams.get('q') || undefined

  const skills = await discoverSkills(query)
  return NextResponse.json({ skills, total: skills.length })
}
