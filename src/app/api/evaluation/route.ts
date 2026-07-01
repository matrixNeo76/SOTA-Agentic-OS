/**
 * GET /api/evaluation — stats + benchmarks list
 * POST /api/evaluation — register benchmark or run evaluation
 */

import { NextResponse } from 'next/server'
import {
  registerBenchmark, listBenchmarks, runEvaluation,
  getAgentEvaluations, evaluationStats, seedDefaultBenchmarks,
  evaluationProvenance,
} from '@/lib/evaluation/runner'

export async function GET() {
  const [stats, benchmarks] = await Promise.all([
    evaluationStats(),
    listBenchmarks(),
  ])
  return NextResponse.json({ stats, benchmarks })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || evaluationProvenance()

    if (action === 'register-benchmark') {
      const { name, description, dataset, version, tags } = body
      if (!name || !description || !dataset) {
        return NextResponse.json({ error: 'Missing name, description, or dataset' }, { status: 400 })
      }
      const result = await registerBenchmark({ name, description, dataset, version, tags, provenance })
      return NextResponse.json(result)
    }

    if (action === 'run') {
      const { agentUri, benchmarkUri, taskResults, notes } = body
      if (!agentUri || !benchmarkUri || !taskResults) {
        return NextResponse.json({ error: 'Missing agentUri, benchmarkUri, or taskResults' }, { status: 400 })
      }
      const result = await runEvaluation({ agentUri, benchmarkUri, taskResults, notes, provenance })
      return NextResponse.json(result)
    }

    if (action === 'agent-evaluations') {
      const { agentUri, limit } = body
      if (!agentUri) return NextResponse.json({ error: 'Missing agentUri' }, { status: 400 })
      const evaluations = await getAgentEvaluations(agentUri, limit)
      return NextResponse.json({ evaluations })
    }

    if (action === 'seed-defaults') {
      const result = await seedDefaultBenchmarks()
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
