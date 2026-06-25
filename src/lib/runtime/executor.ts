/**
 * Runtime Executor — WS1.1 + WS1.2 + WS1.3
 *
 * Esecutore durevole che trasforma i piani DynAMO in lavoro reale.
 *
 * Caratteristiche chiave (vs vecchio executor inline in /api/console):
 *   - Persistente: lo stato vive nel DB, non nel processo
 *   - Ripartibile: recovery al boot via resumeFromCheckpoint
 *   - Idempotente: step con id deterministico (replay non duplica effetti)
 *   - Event journal: output non-deterministic registrati su ExecutionTrace
 *   - Dispatch parallelo: usa topologicalBatches (non più ordine lineare)
 *
 * La route /api/console/stream diventa thin trigger:
 *   POST → startExecutor(planId) → ritorna immediatamente
 *   GET → osserva stato via SSE
 */

import { db } from '@/lib/db'
import { validatePlan, topologicalBatches } from '@/lib/kernel/scheduler'
import { steer, type Strategy } from '@/lib/kernel/acts'
import { verifyEvent } from '@/lib/kernel/ltl-monitor'
import { reflectAndLearn, type ReflectionInput } from '@/lib/kernel/erl'
import { recordCostEntry, calculateCost } from '@/lib/kernel/cost-ledger'
import {
  saveCheckpoint, loadCheckpoint, resumeFromCheckpoint,
  type CheckpointState, type CheckpointType,
} from '@/lib/checkpoint/checkpoint'
import { createProvenance } from '@/lib/governance'
import {
  publishTaskStarted, publishTaskCompleted, publishTaskFailed,
} from '@/lib/event-mesh/publishers'

// === Tipi ============================================================

export type TaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'blocked'

export interface ExecutorStep {
  taskId: string
  agentId: string
  description: string
  status: TaskStatus
  strategy?: Strategy
  ltlVerdict?: string
  ltlViolations?: string[]
  result?: string
  error?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  checkpointId?: string
}

export interface ExecutorResult {
  planId: string
  goal: string
  steps: ExecutorStep[]
  batches: string[][]
  summary: {
    totalTasks: number
    completed: number
    failed: number
    blocked: number
    durationMs: number
  }
  errors: Array<{ type: string; message: string; phase: string }>
  resumed: boolean // true se è stato un recovery
}

export interface ExecutorOptions {
  planOnly?: boolean
  resumeFromPlanId?: string // se fornito, recovery da piano esistente
  signal?: AbortSignal // per cancellazione
  onEvent?: (event: string, data: Record<string, unknown>) => void // SSE callback
}

// === Plan generation =================================================

/**
 * Genera un piano DynAMO via LLM e lo persiste su DB.
 * Ritorna planId + plan + batches.
 */
export async function generateAndPersistPlan(params: {
  task: string
  onChunk?: (partial: string) => void
  signal?: AbortSignal
}): Promise<{ planId: string; plan: any; batches: string[][] }> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
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
- 3-5 task totali
- Rispondi con SOLO il JSON, nessuna spiegazione.`

  const completionStream = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Obiettivo: ${params.task}` },
    ],
    stream: true,
  })

  let raw = ''
  for await (const chunk of completionStream) {
    if (params.signal?.aborted) break
    const delta = chunk.choices?.[0]?.delta?.content || ''
    if (delta) {
      raw += delta
      params.onChunk?.(raw.slice(-200))
    }
  }

  // Record cost
  const inputTokens = Math.ceil((systemPrompt.length + params.task.length) / 4)
  const outputTokens = Math.ceil(raw.length / 4)
  await recordCostEntry({
    agentId: 'planner',
    model: 'zai-glm',
    phase: 'plan_generation',
    tokensIn: inputTokens,
    tokensOut: outputTokens,
    cost: calculateCost('zai-glm', inputTokens, outputTokens),
  }).catch(() => {})

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('LLM non ha prodotto JSON valido')
  }

  const plan = JSON.parse(jsonMatch[0])
  const validation = validatePlan(plan)
  if (!validation.valid) {
    throw new Error(`Piano non valido: ${validation.errors.join('; ')}`)
  }

  // Persist plan
  const planId = `plan_${Date.now()}`
  const batches = topologicalBatches(plan.tasks)

  await db.agentPlan.create({
    data: {
      id: planId,
      taskGoal: plan.goal,
      planJson: JSON.stringify(plan),
      dagJson: JSON.stringify(batches),
      status: 'scheduled',
      agentCount: new Set(plan.tasks.map((t: any) => t.agentId)).size,
      tasks: {
        create: plan.tasks.map((t: any) => ({
          taskId: t.taskId,
          agentId: t.agentId,
          description: t.description,
          dependencies: JSON.stringify(t.dependencies || []),
          status: 'pending',
        })),
      },
    },
  })

  return { planId, plan, batches }
}

// === Task execution (WS1.2: state machine persistente) ==============

/**
 * Esegue un singolo task con state machine persistente.
 *
 * Transizioni: pending → ready → running → done/failed/blocked
 * Ogni transizione è scritta su DB PRIMA di procedere.
 *
 * WS1.3: checkpoint ad ogni step + event journal per idempotency.
 */
export async function executeTask(params: {
  planId: string
  taskDef: { taskId: string; agentId: string; description: string; dependencies: string[] }
  planGoal: string
  signal?: AbortSignal
  onEvent?: (event: string, data: Record<string, unknown>) => void
}): Promise<ExecutorStep> {
  const { planId, taskDef, planGoal, signal, onEvent } = params
  const step: ExecutorStep = {
    taskId: taskDef.taskId,
    agentId: taskDef.agentId,
    description: taskDef.description,
    status: 'running',
    startedAt: new Date().toISOString(),
  }

  // WS1.2 — Persist transition: pending → running
  await updateTaskStatus(planId, taskDef.taskId, 'running')

  // WS1.3 — Checkpoint before execution (idempotency: step ID deterministico)
  const stepId = `${planId}:${taskDef.taskId}`
  const checkpointState: CheckpointState = {
    taskUri: `task://${planId}/${taskDef.taskId}`,
    stepIndex: 0,
    batchIndex: 0,
    agentStates: { [taskDef.agentId]: { phase: 'executing', description: taskDef.description } },
    cycleId: Math.floor(Date.now() / 1000), // epoch seconds (fit Int32)
  }
  const { id: checkpointId } = await saveCheckpoint({
    agentUri: `agent://${taskDef.agentId}`,
    taskId: `task://${planId}/${taskDef.taskId}`,
    checkpointType: 'execution_state',
    state: checkpointState,
    cycleId: checkpointState.cycleId,
  })
  step.checkpointId = checkpointId

  onEvent?.('task_start', { step })

  // Publish TaskStarted event (Fase 2.1)
  const provenance = createProvenance({
    agent: `agent://${taskDef.agentId}`,
    source: 'system-event',
    confidence: 1.0,
  })
  await publishTaskStarted(
    `task://${planId}/${taskDef.taskId}`,
    `agent://${taskDef.agentId}`,
    provenance,
  ).catch(() => {})

  try {
    if (signal?.aborted) throw new Error('Aborted')

    // Steering (ACTS)
    const steeringResult = await steer(
      taskDef.agentId,
      1000,
      50,
      1,
      'PLAN' as Strategy,
      null,
      0,
    )
    step.strategy = steeringResult.strategy

    // LTL verification
    const ltlResult = await verifyEvent(
      'execute' as any,
      'task_execution',
      { taskId: taskDef.taskId, agentId: taskDef.agentId },
    )
    step.ltlVerdict = ltlResult.verdict
    step.ltlViolations = ltlResult.violations.map((v) => `${v.ruleId}: ${v.reason}`)

    if (ltlResult.verdict === 'reject') {
      step.status = 'blocked'
      step.error = `LTL reject: ${step.ltlViolations.join('; ') || 'no details'}`
      step.completedAt = new Date().toISOString()
      step.durationMs = Date.now() - new Date(step.startedAt!).getTime()

      // WS1.2 — Persist: running → blocked
      await updateTaskStatus(planId, taskDef.taskId, 'blocked', step.error)
      await updateTaskResult(planId, taskDef.taskId, step.error, step.durationMs)

      onEvent?.('task_complete', { step })
      return step
    }

    // WS1.4 — Execute via ReAct loop (pensa → chiama tool → osserva → ripeti)
    const { executeReActLoop } = await import('./react-loop')
    const reactResult = await executeReActLoop({
      agentId: taskDef.agentId,
      planId,
      taskId: taskDef.taskId,
      task: taskDef.description,
      context: `obiettivo globale = ${planGoal}`,
      signal,
      onIteration: (iter) => {
        onEvent?.('task_iteration', {
          taskId: taskDef.taskId,
          iteration: iter.iteration,
          thought: iter.thought.slice(-150),
          toolCalls: iter.toolCalls?.map((tc) => ({ name: tc.name, success: tc.success })),
          isFinal: iter.isFinal,
        })
      },
    })

    const result = reactResult.finalAnswer

    // Cost è già tracciato nel ReAct loop, ma registriamo il totale per audit
    // (non chiamare recordCostEntry qui — il ReAct loop lo fa per ogni iterazione)

    step.result = result
    step.status = 'done'
    step.completedAt = new Date().toISOString()
    step.durationMs = Date.now() - new Date(step.startedAt!).getTime()

    // WS1.2 — Persist: running → done
    await updateTaskStatus(planId, taskDef.taskId, 'done')
    await updateTaskResult(planId, taskDef.taskId, result, step.durationMs)

    // WS1.3 — Event journal: registra output non-deterministic per replay
    await journalExecution(planId, taskDef.taskId, result, step.durationMs)

    // Publish TaskCompleted event
    await publishTaskCompleted(
      `task://${planId}/${taskDef.taskId}`,
      result,
      step.durationMs,
      provenance,
    ).catch(() => {})

    onEvent?.('task_complete', { step })
    return step
  } catch (err: any) {
    step.status = 'failed'
    step.error = err.message
    step.completedAt = new Date().toISOString()
    step.durationMs = Date.now() - new Date(step.startedAt!).getTime()

    // WS1.2 — Persist: running → failed
    await updateTaskStatus(planId, taskDef.taskId, 'failed', step.error)

    // Publish TaskFailed event
    await publishTaskFailed(
      `task://${planId}/${taskDef.taskId}`,
      step.error || 'Unknown error',
      false,
      provenance,
    ).catch(() => {})

    onEvent?.('task_complete', { step })
    return step
  }
}

// === Full plan execution (WS1.2: topologicalBatches dispatch) =======

/**
 * Esegue un piano completo usando topologicalBatches per parallelismo.
 *
 * WS1.3: se resumeFromPlanId è fornito, recupera i task già completati
 * e riprende solo quelli pending/running.
 */
export async function executePlan(params: {
  planId: string
  planOnly?: boolean
  signal?: AbortSignal
  onEvent?: (event: string, data: Record<string, unknown>) => void
}): Promise<ExecutorResult> {
  const { planId, planOnly, signal, onEvent } = params
  const startedAt = Date.now()
  const steps: ExecutorStep[] = []
  const errors: Array<{ type: string; message: string; phase: string }> = []

  // Load plan from DB
  const planRecord = await db.agentPlan.findUnique({
    where: { id: planId },
    include: { tasks: true },
  })

  if (!planRecord) {
    throw new Error(`Plan not found: ${planId}`)
  }

  const plan = JSON.parse(planRecord.planJson)
  const batches = topologicalBatches(plan.tasks)

  onEvent?.('plan_start', { task: plan.goal, planId })

  // WS1.3 — Recovery: identifica task già completati
  const existingTasks = planRecord.tasks
  const completedTaskIds = new Set(
    existingTasks.filter((t) => t.status === 'done').map((t) => t.taskId),
  )
  const resumed = completedTaskIds.size > 0

  if (resumed) {
    onEvent?.('resume', {
      planId,
      completedTasks: Array.from(completedTaskIds),
      remainingBatches: batches.length,
    })
  }

  onEvent?.('plan_complete', { planId, plan, batches, resumed })

  if (planOnly) {
    return {
      planId,
      goal: plan.goal,
      steps: [],
      batches,
      summary: {
        totalTasks: plan.tasks.length,
        completed: 0,
        failed: 0,
        blocked: 0,
        durationMs: Date.now() - startedAt,
      },
      errors: [],
      resumed: false,
    }
  }

  // === Phase 2: Task execution per batch ===
  // WS1.5c — Dispatch parallelo dentro il batch (task indipendenti)
  // topologicalBatches garantisce che i task nello stesso batch non hanno dipendenze reciproche.
  for (const batch of batches) {
    if (signal?.aborted) break

    // Separa i task già completati da quelli da eseguire
    const tasksToExecute: Array<{ taskDef: any; taskId: string }> = []
    for (const taskId of batch) {
      // WS1.3 — Skip task già completati (idempotency)
      if (completedTaskIds.has(taskId)) {
        const existing = existingTasks.find((t) => t.taskId === taskId)!
        steps.push({
          taskId: existing.taskId,
          agentId: existing.agentId,
          description: existing.description,
          status: 'done',
          result: existing.result || undefined,
          durationMs: 0,
        })
        continue
      }

      const taskDef = plan.tasks.find((t: any) => t.taskId === taskId)
      if (!taskDef) continue
      tasksToExecute.push({ taskDef, taskId })
    }

    if (tasksToExecute.length === 0) continue

    // WS1.5c — Esegui i task del batch in parallelo (Promise.all)
    // I task nello stesso batch sono indipendenti per costruzione (topologicalBatches)
    const batchResults = await Promise.all(
      tasksToExecute.map(({ taskDef }) =>
        executeTask({
          planId,
          taskDef,
          planGoal: plan.goal,
          signal,
          onEvent,
        }).catch((err) => {
          // Error in parallel task non deve bloccare gli altri del batch
          const errorStep: ExecutorStep = {
            taskId: taskDef.taskId,
            agentId: taskDef.agentId,
            description: taskDef.description,
            status: 'failed',
            error: err.message,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
          }
          onEvent?.('task_complete', { step: errorStep })
          return errorStep
        }),
      ),
    )

    for (const step of batchResults) {
      steps.push(step)
      if (step.status === 'failed') {
        errors.push({
          type: 'task_execution',
          message: step.error || 'Unknown error',
          phase: 'Cognitive Steering',
        })
      }
    }
  }

  // === Phase 3: Reflection ===
  if (!signal?.aborted && steps.length > 0) {
    onEvent?.('reflection_start', {})
    try {
      const failed = steps.filter((s) => s.status === 'failed').length
      const reflectionInput: ReflectionInput = {
        operationId: planId,
        goal: plan.goal,
        outcome: failed > 0 ? 'failure' : 'success',
        steps: steps.map((s) => ({ action: s.taskId, result: s.status })),
        context: `Plan: ${plan.goal}. Tasks: ${steps.length}.`,
      }
      const reflection = await reflectAndLearn(reflectionInput)
      onEvent?.('reflection_complete', {
        reflection: {
          approved: reflection.approved,
          heuristic: reflection.heuristic?.trigger + ' → ' + reflection.heuristic?.action,
          reviewReason: reflection.reviewReason,
        },
      })
    } catch (e: any) {
      onEvent?.('reflection_complete', {
        reflection: { approved: false, error: e.message },
      })
    }
  }

  // === Update plan status ===
  const allDone = steps.every((s) => s.status === 'done')
  const anyFailed = steps.some((s) => s.status === 'failed')
  await db.agentPlan.update({
    where: { id: planId },
    data: { status: allDone ? 'completed' : anyFailed ? 'failed' : 'partial' },
  })

  const summary = {
    totalTasks: steps.length,
    completed: steps.filter((s) => s.status === 'done').length,
    failed: steps.filter((s) => s.status === 'failed').length,
    blocked: steps.filter((s) => s.status === 'blocked').length,
    durationMs: Date.now() - startedAt,
  }

  return {
    planId,
    goal: plan.goal,
    steps,
    batches,
    summary,
    errors,
    resumed,
  }
}

// === Recovery (WS1.3: resume from interruption) =====================

/**
 * Recovery al boot: scansiona piani con task 'running' orfani e riprende.
 *
 * Da chiamare all'avvio del worker (WS1.5 instrumentation.ts).
 */
export async function recoverOrphanedPlans(): Promise<{
  recoveredPlans: number
  recoveredTasks: number
}> {
  // Trova tutti i piani non completati con task in stato 'running'
  const orphanedPlans = await db.agentPlan.findMany({
    where: {
      status: { in: ['scheduled', 'running'] },
      tasks: { some: { status: 'running' } },
    },
    include: { tasks: true },
  })

  let recoveredPlans = 0
  let recoveredTasks = 0

  for (const plan of orphanedPlans) {
    const runningTasks = plan.tasks.filter((t) => t.status === 'running')
    if (runningTasks.length === 0) continue

    // WS1.3 — Reset running tasks to pending (saranno rieseguiti)
    for (const task of runningTasks) {
      await db.planTask.update({
        where: { id: task.id },
        data: { status: 'pending', startedAt: null },
      })
      recoveredTasks++
    }

    // Riprendi il piano
    try {
      await executePlan({ planId: plan.id })
      recoveredPlans++
    } catch (err) {
      console.error(`[executor] Recovery failed for plan ${plan.id}:`, err)
    }
  }

  return { recoveredPlans, recoveredTasks }
}

// === Helpers =========================================================

async function updateTaskStatus(
  planId: string,
  taskId: string,
  status: TaskStatus,
  error?: string,
): Promise<void> {
  const task = await db.planTask.findFirst({
    where: { planId, taskId },
  })
  if (!task) return

  await db.planTask.update({
    where: { id: task.id },
    data: {
      status,
      ...(status === 'running' && { startedAt: new Date() }),
      ...((status === 'done' || status === 'failed' || status === 'blocked') && { finishedAt: new Date() }),
      ...(status === 'failed' && error && { result: error }),
    },
  })
}

async function updateTaskResult(
  planId: string,
  taskId: string,
  result: string,
  durationMs: number,
): Promise<void> {
  const task = await db.planTask.findFirst({
    where: { planId, taskId },
  })
  if (!task) return

  await db.planTask.update({
    where: { id: task.id },
    data: { result },
  })
}

/**
 * WS1.3 — Event journal: registra output non-deterministic su ExecutionTrace.
 * Permette replay bit-identico in caso di recovery.
 */
async function journalExecution(
  planId: string,
  taskId: string,
  output: string,
  durationMs: number,
): Promise<void> {
  try {
    await db.executionTrace.create({
      data: {
        workflowId: planId,
        traceLabel: `task:${taskId}`,
        statesJson: JSON.stringify([{ taskId, status: 'done', timestamp: new Date().toISOString() }]),
        actionsJson: JSON.stringify([{ action: 'execute', output, durationMs }]),
        outcome: 'success',
      },
    })
  } catch (err) {
    console.warn('[executor] Journal write failed (non-blocking):', err)
  }
}

// === Public API per la route (thin trigger) ==========================

/**
 * Avvia l'esecuzione di un piano.
 *
 * WS1.5: Due modalità:
 *   - sync (default per SSE streaming): esegue inline, bloccando la request
 *     con onEvent callback per streaming
 *   - async (via enqueue): accoda su JobRecord, il worker processa in background
 *     La route ritorna immediatamente con planId, l'esecuzione avviene nel worker
 */
export async function startExecution(params: {
  task: string
  planOnly?: boolean
  signal?: AbortSignal
  onEvent?: (event: string, data: Record<string, unknown>) => void
  async?: boolean // WS1.5: se true, accoda su JobRecord invece di eseguire sync
}): Promise<{ result: ExecutorResult } | { planId: string; jobId: string; async: true } | { error: string }> {
  try {
    // Phase 1: Generate plan
    const { planId, plan, batches } = await generateAndPersistPlan({
      task: params.task,
      signal: params.signal,
      onChunk: (partial) => params.onEvent?.('plan_chunk', { partial }),
    })

    params.onEvent?.('plan_complete', { planId, plan, batches })

    if (params.planOnly) {
      return {
        result: {
          planId,
          goal: plan.goal,
          steps: [],
          batches,
          summary: {
            totalTasks: plan.tasks.length,
            completed: 0,
            failed: 0,
            blocked: 0,
            durationMs: 0,
          },
          errors: [],
          resumed: false,
        },
      }
    }

    // WS1.5 — Modalità async: accoda su JobRecord
    if (params.async) {
      const { enqueueJob } = await import('@/lib/kernel/scalability')
      const { jobId } = await enqueueJob('execute_plan', { planId }, 1) // priority=high
      return { planId, jobId, async: true }
    }

    // Modalità sync (default per SSE streaming): esegue inline
    const result = await executePlan({
      planId,
      signal: params.signal,
      onEvent: params.onEvent,
    })

    return { result }
  } catch (err: any) {
    return { error: err.message }
  }
}

/**
 * WS1.5 — Accoda un piano esistente per esecuzione asincrona via worker.
 * Utile per recovery o per riesecuzione di piani falliti.
 */
export async function enqueuePlanExecution(planId: string, priority: 0 | 1 | 2 = 1): Promise<{ jobId: string }> {
  const { enqueueJob } = await import('@/lib/kernel/scalability')
  return enqueueJob('execute_plan', { planId }, priority)
}
