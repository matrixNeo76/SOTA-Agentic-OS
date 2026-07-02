/**
 * GET /api/evaluation — stats + benchmarks list (requireAuth)
 * POST /api/evaluation — register benchmark or run evaluation (requireAdmin)
 *
 * C2 FIX: prima questa route era completamente senza auth → chiunque poteva
 * registrare benchmark malevoli, run evaluation con taskResults arbitrari,
 * seed defaults (sovrascrive benchmark di sistema).
 * Ora GET richiede sessione valida, POST richiede ruolo admin/operator.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  registerBenchmark, listBenchmarks, runEvaluation,
  getAgentEvaluations, evaluationStats, seedDefaultBenchmarks,
  evaluationProvenance, type TaskResult,
} from '@/lib/evaluation/runner'
import { requireAuth } from '@/lib/auth/require-auth'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const [stats, benchmarks] = await Promise.all([
    evaluationStats(),
    listBenchmarks(),
  ])
  return NextResponse.json({ stats, benchmarks })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

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
      // C5 fix: valida taskResults PRIMA di existence check (B6)
      if (!Array.isArray(taskResults)) {
        return NextResponse.json({ error: 'taskResults must be an array' }, { status: 400 })
      }
      if (taskResults.length === 0) {
        return NextResponse.json({ error: 'taskResults cannot be empty' }, { status: 400 })
      }
      if (taskResults.length > 1000) {
        return NextResponse.json({ error: 'taskResults too large: max 1000 entries' }, { status: 400 })
      }
      for (let i = 0; i < taskResults.length; i++) {
        const tr = taskResults[i]
        if (!tr || typeof tr !== 'object') {
          return NextResponse.json({ error: `taskResults[${i}] must be an object` }, { status: 400 })
        }
        if (!tr.taskId || typeof tr.taskId !== 'string') {
          return NextResponse.json({ error: `taskResults[${i}].taskId is required (string)` }, { status: 400 })
        }
        if (typeof tr.success !== 'boolean') {
          return NextResponse.json({ error: `taskResults[${i}].success must be boolean` }, { status: 400 })
        }
        if (typeof tr.durationMs !== 'number' || tr.durationMs < 0 || tr.durationMs > 3_600_000) {
          return NextResponse.json({ error: `taskResults[${i}].durationMs must be a number 0-3600000` }, { status: 400 })
        }
        if (typeof tr.cost !== 'number' || tr.cost < 0 || tr.cost > 1000) {
          return NextResponse.json({ error: `taskResults[${i}].cost must be a number 0-1000` }, { status: 400 })
        }
      }
      const result = await runEvaluation({ agentUri, benchmarkUri, taskResults: taskResults as TaskResult[], notes, provenance })
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
