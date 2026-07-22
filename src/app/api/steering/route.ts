/**
 * API: /api/steering
 * ACTS Controller: decide strategia e applica steering phrase.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  steer, STEERING_VOCABULARY, steeringHistory, getSteeringState,
  VALID_STRATEGIES, DEFAULT_HALT_THRESHOLD, DEFAULT_REFLECT_INTERVAL,
  type Strategy,
} from '@/lib/kernel/acts'
import { db } from '@/lib/db'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get('agentId') || 'controller'
    const planId = searchParams.get('planId') || undefined
    // G1 — Recupera lo stato FSM persistito (per riprendere ciclo interrotto)
    const currentState = await getSteeringState(agentId, planId)

    // B6 fix — Seed SteeringStrategy se tabella vuota (no fallback silenzioso).
    // PRIMA: se tabella aveva anche 1 entry, fallback non scattava e UI mostrava
    // solo quella. ORA: GET seeda la tabella se vuota, poi usa sempre il DB.
    let strategies = await db.steeringStrategy.findMany()
    if (strategies.length === 0) {
      strategies = await Promise.all(
        Object.entries(STEERING_VOCABULARY).map(async ([name, info]) => {
          return db.steeringStrategy.create({
            data: {
              name,
              triggerPhrase: info.phrase,
              description: info.description,
              budgetCost: info.budgetCost,
              active: true,
            },
          })
        }),
      )
    }

    const [history] = await Promise.all([
      steeringHistory(agentId, 30),
    ])
    return NextResponse.json({
      vocabulary: STEERING_VOCABULARY,
      history,
      currentState, // G1 — stato FSM corrente (null se prima chiamata)
      strategies,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load steering state', detail: err.message }, { status: 500 })
  }
}

// B5 — Validation helpers
const VALID_STRATEGY_SET = new Set<string>(VALID_STRATEGIES)

interface ValidationError { field: string; reason: string }

function validateSteerInput(body: any): { ok: true; data: ParsedSteerInput } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = []

  // agentId: string, non vuoto
  const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId : 'controller'

  // budgetTotal: number, > 0, <= 1e6
  const budgetTotal = Number(body.budgetTotal ?? 1000)
  if (!Number.isFinite(budgetTotal) || budgetTotal <= 0 || budgetTotal > 1_000_000) {
    errors.push({ field: 'budgetTotal', reason: `must be a number > 0 and <= 1000000, got ${body.budgetTotal}` })
  }

  // budgetUsed: number, >= 0, <= budgetTotal
  const budgetUsed = Number(body.budgetUsed ?? 0)
  if (!Number.isFinite(budgetUsed) || budgetUsed < 0 || budgetUsed > budgetTotal) {
    errors.push({ field: 'budgetUsed', reason: `must be a number >= 0 and <= budgetTotal (${budgetTotal}), got ${body.budgetUsed}` })
  }

  // step: integer, >= 0, <= 10000
  const step = Number(body.step ?? 0)
  if (!Number.isInteger(step) || step < 0 || step > 10_000) {
    errors.push({ field: 'step', reason: `must be an integer >= 0 and <= 10000, got ${body.step}` })
  }

  // lastStrategy: enum
  const lastStrategy = body.lastStrategy ?? 'PLAN'
  if (typeof lastStrategy !== 'string' || !VALID_STRATEGY_SET.has(lastStrategy)) {
    errors.push({ field: 'lastStrategy', reason: `must be one of ${[...VALID_STRATEGY_SET].join('|')}, got ${lastStrategy}` })
  }

  // lastCheckPassed: boolean | null
  const lastCheckPassed = body.lastCheckPassed === undefined ? null : body.lastCheckPassed
  if (lastCheckPassed !== null && typeof lastCheckPassed !== 'boolean') {
    errors.push({ field: 'lastCheckPassed', reason: `must be boolean or null, got ${typeof lastCheckPassed}` })
  }

  // errorsConsecutive: integer, >= 0, < 100
  const errorsConsecutive = Number(body.errorsConsecutive ?? 0)
  if (!Number.isInteger(errorsConsecutive) || errorsConsecutive < 0 || errorsConsecutive >= 100) {
    errors.push({ field: 'errorsConsecutive', reason: `must be an integer >= 0 and < 100, got ${body.errorsConsecutive}` })
  }

  // planId: optional string
  const planId = body.planId
  if (planId !== undefined && (typeof planId !== 'string' || planId.length > 200)) {
    errors.push({ field: 'planId', reason: `must be a string <= 200 chars, got ${typeof planId}` })
  }

  // haltThreshold: optional number, > 0
  const haltThreshold = body.haltThreshold
  if (haltThreshold !== undefined && (!Number.isFinite(haltThreshold) || haltThreshold <= 0)) {
    errors.push({ field: 'haltThreshold', reason: `must be a number > 0, got ${haltThreshold}` })
  }

  // G4 — reflectInterval: optional integer, >= 0, <= 1000
  const reflectInterval = body.reflectInterval
  if (reflectInterval !== undefined && (!Number.isInteger(reflectInterval) || reflectInterval < 0 || reflectInterval > 1000)) {
    errors.push({ field: 'reflectInterval', reason: `must be an integer >= 0 and <= 1000, got ${reflectInterval}` })
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      agentId,
      budgetTotal,
      budgetUsed,
      step,
      lastStrategy: lastStrategy as Strategy,
      lastCheckPassed: lastCheckPassed as boolean | null,
      errorsConsecutive,
      planId: planId || undefined,
      haltThreshold: typeof haltThreshold === 'number' ? haltThreshold : undefined,
      reflectInterval: typeof reflectInterval === 'number' ? reflectInterval : undefined,
    },
  }
}

interface ParsedSteerInput {
  agentId: string
  budgetTotal: number
  budgetUsed: number
  step: number
  lastStrategy: Strategy
  lastCheckPassed: boolean | null
  errorsConsecutive: number
  planId?: string
  haltThreshold?: number
  reflectInterval?: number
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  let body
  try {
    body = await req.json()
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body', detail: err.message }, { status: 400 })
  }

  // B5 — Input validation
  const validation = validateSteerInput(body)
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', errors: validation.errors },
      { status: 400 },
    )
  }
  const input = validation.data

  try {
    const result = await steer(
      input.agentId,
      input.budgetTotal,
      input.budgetUsed,
      input.step,
      input.lastStrategy,
      input.lastCheckPassed,
      input.errorsConsecutive,
      input.planId,                                              // G1
      input.haltThreshold ?? DEFAULT_HALT_THRESHOLD,             // B1
      input.reflectInterval ?? DEFAULT_REFLECT_INTERVAL,         // G4
    )
    await db.agentLog.create({
      data: {
        agentId: input.agentId,
        phase: '3',
        event: 'steer',
        payload: JSON.stringify(result),
      },
    })
    await publishAgentEvent({
      agentId: input.agentId, phase: '3',
      event: 'steer',
      payload: { strategy: result.strategy, tokenUsed: result.tokenUsed, planId: input.planId, idempotent: result.idempotent },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Steer failed', detail: err.message }, { status: 500 })
  }
}
