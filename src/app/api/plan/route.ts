/**
 * API: /api/plan
 * GET  - elenca piani
 * POST - crea un nuovo piano (valida JSON-Schema, builda DAG, persiste)
 */
import { NextRequest, NextResponse } from 'next/server'
import { validatePlan, persistPlan, topologicalBatches } from '@/lib/kernel/scheduler'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'
import { requireAuth } from '@/lib/auth/require-auth'
import { parseLlmJson } from '@/lib/llm-client/parse-json'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const plans = await db.agentPlan.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { tasks: true },
  })
  return NextResponse.json({ plans })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { mode } = body

  // Mode 'generate': usa LLM per generare un piano strutturato
  if (mode === 'generate') {
    const { goal } = body
    if (!goal) return NextResponse.json({ ok: false, error: 'goal obbligatorio' }, { status: 400 })

    try {
      const zai = await ZAI.create()
      const systemPrompt = `Sei l'orchestratore DynAMO di un Sistema Operativo Agentico.
Produci un piano JSON valido per il seguente obiettivo.
Schema richiesto:
{
  "goal": string,
  "tasks": [
    { "taskId": string, "agentId": string, "description": string, "dependencies": string[] }
  ]
}
Regole:
- taskId in formato T1, T2, T3...
- agentId tra: orchestrator, curator, controller, verifier, reflective
- dependencies contiene solo taskId precedenti (no cicli)
- 3-6 task totali
- Rispondi con SOLO il JSON, nessuna spiegazione.`

      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Obiettivo: ${goal}` },
        ],
      })
      const raw = completion.choices[0].message.content || ''
      // C3 FIX: usa parseLlmJson helper (strip markdown + balanced extraction + recovery)
      const fallbackPlan = {
        goal,
        tasks: [
          { taskId: 'T1', agentId: 'orchestrator', description: `Analyze: ${goal.slice(0, 100)}`, dependencies: [] },
          { taskId: 'T2', agentId: 'curator', description: 'Gather context', dependencies: ['T1'] },
          { taskId: 'T3', agentId: 'controller', description: 'Process information', dependencies: ['T2'] },
          { taskId: 'T4', agentId: 'reflective', description: 'Synthesize answer', dependencies: ['T3'] },
        ],
      }
      const plan = parseLlmJson(raw, fallbackPlan)
      const validation = validatePlan(plan)
      if (!validation.valid) {
        return NextResponse.json({ ok: false, error: 'Piano non valido', errors: validation.errors, plan }, { status: 400 })
      }
      const planId = await persistPlan(plan)
      const batches = topologicalBatches(plan.tasks)
      return NextResponse.json({ ok: true, planId, plan, batches })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
  }

  // Mode 'manual': usa il piano fornito
  const { plan } = body
  if (!plan) return NextResponse.json({ ok: false, error: 'plan obbligatorio' }, { status: 400 })
  const validation = validatePlan(plan)
  if (!validation.valid) {
    return NextResponse.json({ ok: false, error: 'Piano non valido', errors: validation.errors }, { status: 400 })
  }
  const planId = await persistPlan(plan)
  const batches = topologicalBatches(plan.tasks)
  return NextResponse.json({ ok: true, planId, batches })
}
