/**
 * GET /api/cognitive-router — router stats + local models health
 * POST /api/cognitive-router — classify a prompt or plan routing
 */

import { NextResponse } from 'next/server'
import {
  classifyTask, planRouting, routeCognitive, checkLocalModelsHealth,
  cognitiveRouterStats, DEFAULT_COGNITIVE_MODELS,
} from '@/lib/cognitive-router/router'
import { createProvenance } from '@/lib/governance'

export async function GET() {
  const [stats, health] = await Promise.all([
    cognitiveRouterStats(),
    checkLocalModelsHealth(),
  ])
  return NextResponse.json({ stats, localModelsHealth: health, availableModels: DEFAULT_COGNITIVE_MODELS.length })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || createProvenance({
      agent: 'agent://api',
      source: 'system-event',
      confidence: 1.0,
    })

    if (action === 'classify') {
      const { prompt } = body
      if (!prompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
      const classification = classifyTask(prompt)
      return NextResponse.json({ classification })
    }

    if (action === 'plan') {
      const { prompt, forceApi } = body
      if (!prompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
      const strategy = planRouting(prompt, { forceApi })
      return NextResponse.json({ strategy })
    }

    if (action === 'route') {
      const { agentId, prompt, forceApi } = body
      if (!agentId || !prompt) return NextResponse.json({ error: 'Missing agentId or prompt' }, { status: 400 })
      const result = await routeCognitive(agentId, prompt, { forceApi })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
