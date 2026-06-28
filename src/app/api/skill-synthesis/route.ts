/**
 * GET /api/skill-synthesis — synthesis stats
 * POST /api/skill-synthesis — detect gaps or run full pipeline
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import {
  detectSkillGaps, runSynthesisPipeline, synthesisStats, synthesisProvenance,
} from '@/lib/skill-synthesis/pipeline'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const stats = await synthesisStats()
  return NextResponse.json(stats)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || synthesisProvenance()

    if (action === 'detect-gaps') {
      const { daysWindow, minOccurrences } = body
      const gaps = await detectSkillGaps({ daysWindow, minOccurrences })
      return NextResponse.json({ gaps })
    }

    if (action === 'run-pipeline') {
      const { gap, autoApprove } = body
      const pipelines = await runSynthesisPipeline({ gap, provenance, autoApprove })
      return NextResponse.json({ pipelines })
    }

    return NextResponse.json({ error: 'Unknown action. Use "detect-gaps" or "run-pipeline".' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
