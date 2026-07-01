/**
 * POST /api/skills/import — Import a skill from SKILL.md or JSON manifest
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/api-key'
import { importSkill } from '@/lib/skill-registry/skill-export'
import { createProvenance } from '@/lib/governance'

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, 'exec')
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { format, content } = body

  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 })

  const provenance = createProvenance({
    agent: auth.apiKey.userId ? `user://${auth.apiKey.userId}` : 'agent://external',
    source: 'external-api',
    confidence: 0.8,
  })

  try {
    const result = await importSkill({
      manifest: content, // string (SKILL.md) or object (JSON manifest)
      provenance,
    })
    return NextResponse.json({ imported: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
