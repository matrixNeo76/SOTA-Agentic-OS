/**
 * GET /api/world-model — World Model stats + latest state + pending predictions
 * POST /api/world-model/capture — capture a new WorldState
 * POST /api/world-model/predict — create a prediction
 */

import { NextResponse } from 'next/server'
import {
  captureWorldState, getLatestWorldState, listPendingPredictions, worldModelStats,
  createPrediction,
} from '@/lib/world-model/engine'
import { createProvenance } from '@/lib/governance'

export async function GET() {
  const [stats, latest, pendingPredictions] = await Promise.all([
    worldModelStats(),
    getLatestWorldState(),
    listPendingPredictions(),
  ])
  return NextResponse.json({ stats, latestWorldState: latest, pendingPredictions })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'capture') {
      const provenance = body.provenance || createProvenance({
        agent: body.agentUri || 'agent://api',
        source: 'system-event',
        confidence: 1.0,
      })
      const result = await captureWorldState({ provenance })
      return NextResponse.json(result)
    }

    if (action === 'predict') {
      const { statement, probability, horizon, basedOnWorldStateUri } = body
      if (!statement || probability === undefined || !horizon || !basedOnWorldStateUri) {
        return NextResponse.json({ error: 'Missing required fields for prediction' }, { status: 400 })
      }
      const provenance = body.provenance || createProvenance({
        agent: 'agent://api',
        source: 'agent-reasoning',
        confidence: 0.8,
      })
      const result = await createPrediction({
        statement, probability, horizon, basedOnWorldStateUri, provenance,
      })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action. Use "capture" or "predict".' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
