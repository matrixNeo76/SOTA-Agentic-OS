/**
 * GET /api/cognitive-gc — memory stats + tier breakdown
 * POST /api/cognitive-gc — run consolidation / decay / archival manually
 */

import { NextResponse } from 'next/server'
import {
  consolidateEpisodicToProcedural, updateDecayScores, archiveColdMemories,
  gcStats, gcProvenance,
} from '@/lib/cognitive-gc/curator'

export async function GET() {
  const stats = await gcStats()
  return NextResponse.json(stats)
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || gcProvenance()

    if (action === 'consolidate') {
      const { agentUri, minClusterSize, similarityThreshold, maxMemoriesPerRun } = body
      const result = await consolidateEpisodicToProcedural({
        agentUri, minClusterSize, similarityThreshold, maxMemoriesPerRun,
      })
      return NextResponse.json(result)
    }

    if (action === 'update-decay') {
      const { agentUri, olderThanDays } = body
      const result = await updateDecayScores({ agentUri, olderThanDays })
      return NextResponse.json(result)
    }

    if (action === 'archive-cold') {
      const { agentUri, maxArchives } = body
      const result = await archiveColdMemories({ agentUri, maxArchives })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
