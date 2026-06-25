/**
 * GET /api/digital-twin — Digital Twin stats + scenarios list
 * POST /api/digital-twin — create a scenario
 * POST /api/digital-twin/run — run a simulation
 * POST /api/digital-twin/what-if — run a preset what-if
 */

import { NextResponse } from 'next/server'
import {
  createScenario, runSimulation, listScenarios, runWhatIf,
  digitalTwinStats, WHAT_IF_PRESETS, digitalTwinProvenance,
} from '@/lib/digital-twin/engine'

export async function GET() {
  const [stats, scenarios] = await Promise.all([
    digitalTwinStats(),
    listScenarios(20),
  ])
  return NextResponse.json({
    stats,
    scenarios,
    availablePresets: WHAT_IF_PRESETS.map((p) => p.name),
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || digitalTwinProvenance()

    if (action === 'create') {
      const { name, description, parameters } = body
      if (!name || !description || !parameters) {
        return NextResponse.json({ error: 'Missing name, description, or parameters' }, { status: 400 })
      }
      const result = await createScenario({ name, description, parameters, provenance })
      return NextResponse.json(result)
    }

    if (action === 'run') {
      const { scenarioUri } = body
      if (!scenarioUri) {
        return NextResponse.json({ error: 'Missing scenarioUri' }, { status: 400 })
      }
      const result = await runSimulation({ scenarioUri, provenance })
      return NextResponse.json(result)
    }

    if (action === 'what-if') {
      const { presetName } = body
      if (!presetName) {
        return NextResponse.json({ error: 'Missing presetName' }, { status: 400 })
      }
      const result = await runWhatIf(presetName, provenance)
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action. Use "create", "run", or "what-if".' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
