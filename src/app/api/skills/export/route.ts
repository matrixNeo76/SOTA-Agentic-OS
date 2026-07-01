/**
 * GET /api/skills/export?uri=xxx — Export skill as SKILL.md or JSON manifest
 * GET /api/skills/export?uri=xxx&format=json — JSON manifest
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/api-key'
import { getSkill } from '@/lib/skill-registry/registry'
import { exportSkillAsSkillMd, exportSkillAsManifest } from '@/lib/skill-registry/skill-export'

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, 'read')
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const uri = url.searchParams.get('uri')
  const format = url.searchParams.get('format') || 'skillmd'

  if (!uri) return NextResponse.json({ error: 'Missing uri parameter' }, { status: 400 })

  const skill = await getSkill(uri)
  if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })

  if (format === 'json') {
    return NextResponse.json(exportSkillAsManifest(skill))
  }

  // Default: SKILL.md format
  const skillMd = exportSkillAsSkillMd(skill)
  return new NextResponse(skillMd, {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="${skill.name}.skill.md"`,
    },
  })
}
