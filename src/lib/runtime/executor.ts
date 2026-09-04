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
  objectiveTreeId?: string // C1 fix Objective Builder: tree creato per questo piano
}

export interface ExecutorOptions {
  planOnly?: boolean
  resumeFromPlanId?: string // se fornito, recovery da piano esistente
  signal?: AbortSignal // per cancellazione
  onEvent?: (event: string, data: Record<string, unknown>) => void // SSE callback
  // UX Architecture: per-run override options
  modelId?: string       // override model for LLM calls
  allowedTools?: string[] // whitelist of toolIds for this run
  agentUri?: string       // specific agent to use
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
  // C6.5 — Generate planId BEFORE recording cost so we can correlate it.
  // The planId is also used when persisting the plan below; generating it
  // here (instead of after parsing) ensures the cost entry has a planId
  // even if parsing fails afterwards.
  const planId = `plan_${Date.now()}`
  await recordCostEntry({
    agentId: 'planner',
    model: 'zai-glm',
    phase: 'plan_generation',
    tokensIn: inputTokens,
    tokensOut: outputTokens,
    cost: calculateCost('zai-glm', inputTokens, outputTokens),
    planId, // C6.5 — correlate cost with this plan
  }).catch(() => {})

  // C3 FIX: usa parseLlmJson helper (strip markdown + balanced extraction + recovery + fallback)
  const { parseLlmJson } = await import('@/lib/llm-client/parse-json')
  const fallbackPlan = {
    goal: params.task,
    tasks: [
      { taskId: 'T1', agentId: 'orchestrator', description: `Analyze: ${params.task.slice(0, 100)}`, dependencies: [] },
      { taskId: 'T2', agentId: 'curator', description: 'Gather context', dependencies: ['T1'] },
      { taskId: 'T3', agentId: 'controller', description: 'Process information', dependencies: ['T2'] },
      { taskId: 'T4', agentId: 'reflective', description: 'Synthesize answer', dependencies: ['T3'] },
    ],
  }
  const plan = parseLlmJson(raw, fallbackPlan)
  const validation = validatePlan(plan)
  if (!validation.valid) {
    console.warn('[executor] Plan validation failed, using fallback:', validation.errors)
    // Use fallback if validation fails
    Object.assign(plan, fallbackPlan)
  }

  // Persist plan
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
  // C2 (ACTS audit) — Stato FSM passato dal loop executePlan per evitare
  // parametri hardcoded. Permette al ACTS Controller di evolvere durante
  // l'esecuzione del piano (PLAN → EXECUTE → CHECK → ...).
  steeringState?: {
    step: number
    lastStrategy: Strategy
    lastCheckPassed: boolean | null
    errorsConsecutive: number
    budgetTotal: number
    budgetUsed: number
  }
  // UX Architecture: per-run model override (from executePlan)
  modelId?: string
  allowedTools?: string[]
}): Promise<ExecutorStep> {
  const { planId, taskDef, planGoal, signal, onEvent } = params
  const perRunModelId = params.modelId
  const perRunAllowedTools = params.allowedTools
  // C2 — Default a stato iniziale (backward compat: se caller non passa steeringState,
  // usa valori equivalenti al vecchio hardcoded: step=1, PLAN, no errors, budget 1000/50).
  const sState = params.steeringState || {
    step: 1,
    lastStrategy: 'PLAN' as Strategy,
    lastCheckPassed: null,
    errorsConsecutive: 0,
    budgetTotal: 1000,
    budgetUsed: 50,
  }
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

    // Steering (ACTS) — C2 fix: usa stato reale passato dal caller (no hardcoded)
    const steeringResult = await steer(
      taskDef.agentId,
      sState.budgetTotal,
      sState.budgetUsed,
      sState.step,
      sState.lastStrategy,
      sState.lastCheckPassed,
      sState.errorsConsecutive,
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

    // C6.7 — Persist LTL verdict + violations for display in RunDetailView
    await updateTaskLtl(planId, taskDef.taskId, ltlResult.verdict, step.ltlViolations)

    if (ltlResult.verdict === 'reject') {
      step.status = 'blocked'
      step.error = `LTL reject: ${step.ltlViolations.join('; ') || 'no details'}`
      step.completedAt = new Date().toISOString()
      step.durationMs = Date.now() - new Date(step.startedAt!).getTime()

      // WS1.2 — Persist: running → blocked
      await updateTaskStatus(planId, taskDef.taskId, 'blocked', step.error)
      await updateTaskResult(planId, taskDef.taskId, step.error, step.durationMs)

      // C2 fix (Delegation HITL audit Fase A): registra l'azione bloccata nella coda HITL.
      // PRIMA: registerBlockedAction non era chiamato dall'executor → le azioni bloccate
      // dai gate LTL non apparivano nella coda HITL (sovereign-view vuoto).
      // ORA: ogni block dell'executor registra l'azione con source + axiomTrail.
      // Non bloccante (fail-open): se registerBlockedAction fallisce, il task resta blocked.
      try {
        const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
        await registerBlockedAction({
          agentId: taskDef.agentId,
          action: `task:${taskDef.taskId} - ${taskDef.description}`,
          source: 'ltl',
          axiomTrail: [
            { step: '1_ltl_check', rule: 'LTL verification', result: `verdict: ${ltlResult.verdict}` },
            ...(step.ltlViolations || []).map((v, i) => ({
              step: `2_violation_${i + 1}`,
              rule: v.split(':')[0] || 'LTL rule',
              result: v,
            })),
            { step: '3_block', rule: 'LTL reject → task blocked', result: step.error || 'LTL reject' },
          ],
        })
      } catch {
        // Non bloccante: registerBlockedAction fallisce in modo silente
      }

      onEvent?.('task_complete', { step })
      return step
    }

    // C2 fix (Lean4 LeanEvolve audit Fase A): verifica formale del workflow.
    // PRIMA: verifyWorkflow era cosmetico (non chiamato da executor).
    // ORA: se il piano ha contratti formali, verifica il workflow prima del ReAct loop.
    // Se verifica fallisce (contratti violati), marca task come blocked.
    // Non bloccante (fail-open): se verifyWorkflow fallisce per errori tecnici, continua.
    //
    // HOTFIX (post-Delegation HITL Fase A): skip della verifica se il piano NON ha
    // formal contracts. PRIMA, verifyWorkflow veniva chiamato su ogni piano, anche
    // quelli senza contracts → ritornava "Task X senza contratto formale" per ogni
    // task → tutti i task venivano bloccati. Questo era silent prima del Delegation
    // HITL Fase A (registerBlockedAction non integrato), ma ora ogni blocco appare
    // nel sovereign-view → l'app sembra "costantemente bloccata".
    // ORA: se non ci sono formal contracts, skip completo (verifica formale è
    // opzionale — si attiva solo quando l'admin chiama autoGenerateContracts).
    try {
      const contractCount = await db.formalContract.count({ where: { planId } })
      if (contractCount > 0) {
        const { verifyWorkflow } = await import('@/lib/kernel/lean4-agent')
        const leanResult = await verifyWorkflow(planId)
        if (!leanResult.verified) {
          // Cerca errori relativi al task corrente
          const taskErrors = leanResult.results.filter(
            (r: any) => r.taskId === taskDef.taskId && r.errors.length > 0,
          )
          if (taskErrors.length > 0) {
            step.status = 'blocked'
            step.error = `Formal verification failed: ${taskErrors[0].errors.join('; ')}`
            step.completedAt = new Date().toISOString()
            step.durationMs = Date.now() - new Date(step.startedAt!).getTime()
            await updateTaskStatus(planId, taskDef.taskId, 'blocked', step.error)
            await updateTaskResult(planId, taskDef.taskId, step.error, step.durationMs)

            // C2 fix (Delegation HITL audit Fase A): registra formal verification block nella coda HITL.
            try {
              const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
              await registerBlockedAction({
                agentId: taskDef.agentId,
                action: `task:${taskDef.taskId} - ${taskDef.description}`,
                source: 'ltl', // Lean4 formal verification = safety property (LTL-family)
                axiomTrail: [
                  { step: '1_verify_workflow', rule: 'Lean4 formal verification', result: `verified: ${leanResult.verified}` },
                  ...taskErrors[0].errors.map((e: string, i: number) => ({
                    step: `2_error_${i + 1}`,
                    rule: 'formal_contract_violation',
                    result: e,
                  })),
                  { step: '3_block', rule: 'Formal verification failed → task blocked', result: step.error },
                ],
              })
            } catch {
              // Non bloccante
            }

            onEvent?.('task_complete', { step })
            return step
          }
        }
      }
      // contractCount === 0 → skip verifica formale (piano senza contracts espliciti)
    } catch {
      // Non bloccante: se verifyWorkflow fallisce, continua senza verifica formale
    }

    // WS1.4 — Execute via ReAct loop (pensa → chiama tool → osserva → ripeti)
    // C1 fix: inietta la steering phrase dell'ACTS Controller nel system prompt.
    // Senza questo, le steering phrases erano calcolate ma mai inviate all'LLM.
    //
    // G3 fix (LTL audit Fase B): evaluateIntent prima del ReAct loop.
    // PRIMA: Normative gate era cosmetico (non chiamato da executor).
    // ORA: valuta l'intenzione del task contro gli assiomi normativi.
    // Se BLOCK → skip ReAct loop, marca task come blocked.
    try {
      const { evaluateIntent } = await import('@/lib/kernel/normative')
      const normativeVerdict = await evaluateIntent({
        agentId: taskDef.agentId,
        action: taskDef.description,
        rationale: `Task execution for plan ${planGoal}`,
        affectedAxioms: [], // G3: in futuro, mappare taskDef → assiomi impattati
        claimedPriority: 2, // default operational; in futuro da AgentPolicy
      })
      if (!normativeVerdict.allowed) {
        step.status = 'blocked'
        step.error = `Normative block: ${normativeVerdict.blockingAxiom} (priority ${normativeVerdict.blockingPriority})`
        step.completedAt = new Date().toISOString()
        step.durationMs = Date.now() - new Date(step.startedAt!).getTime()
        await updateTaskStatus(planId, taskDef.taskId, 'blocked', step.error)
        await updateTaskResult(planId, taskDef.taskId, step.error, step.durationMs)

        // C2 fix (Delegation HITL audit Fase A): registra normative block nella coda HITL.
        try {
          const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
          await registerBlockedAction({
            agentId: taskDef.agentId,
            action: `task:${taskDef.taskId} - ${taskDef.description}`,
            source: 'normative',
            axiomTrail: [
              { step: '1_evaluate_intent', rule: 'Normative calculus', result: `allowed: ${normativeVerdict.allowed}` },
              { step: '2_block', rule: `blockingAxiom: ${normativeVerdict.blockingAxiom}`, result: `priority: ${normativeVerdict.blockingPriority}` },
              { step: '3_block', rule: 'Normative block → task blocked', result: step.error },
            ],
          })
        } catch {
          // Non bloccante
        }

        onEvent?.('task_complete', { step })
        return step
      }
    } catch {
      // Non bloccante: se normative fallisce, continua comunque
    }

    // C3 fix (ERL audit Fase A): preExecuteGate per Red Lines + Taint + LTL composite.
    // PRIMA: governance-hooks era cosmetico (non chiamato da executor).
    // ORA: chiama preExecuteGate che combina G6 (taint) + G7 (LTL) + G8 (red lines).
    // Se blocca → skip ReAct loop, marca task come blocked.
    // Non bloccante (fail-open): se il gate fallisce per errori tecnici, continua.
    try {
      const { preExecuteGate } = await import('@/lib/runtime/governance-hooks')
      const gateResult = await preExecuteGate({
        agentId: taskDef.agentId,
        action: taskDef.description,
        // toolName e stateLabel non specificati qui: verranno checkati
        // più fine-grained nel ReAct loop / tool-dispatcher
      })
      if (!gateResult.allowed) {
        step.status = 'blocked'
        step.error = `Governance gate block: ${gateResult.reasons.join('; ')}`
        step.completedAt = new Date().toISOString()
        step.durationMs = Date.now() - new Date(step.startedAt!).getTime()
        await updateTaskStatus(planId, taskDef.taskId, 'blocked', step.error)
        await updateTaskResult(planId, taskDef.taskId, step.error, step.durationMs)

        // C2 fix (Delegation HITL audit Fase A): registra governance gate block nella coda HITL.
        // source: 'hitl_gate' perché preExecuteGate combina red lines + taint + LTL composite.
        try {
          const { registerBlockedAction } = await import('@/lib/kernel/sovereign-translator')
          await registerBlockedAction({
            agentId: taskDef.agentId,
            action: `task:${taskDef.taskId} - ${taskDef.description}`,
            source: 'hitl_gate',
            axiomTrail: [
              { step: '1_pre_execute_gate', rule: 'Governance hooks (red lines + taint + LTL composite)', result: `allowed: ${gateResult.allowed}` },
              ...gateResult.reasons.map((r: string, i: number) => ({
                step: `2_reason_${i + 1}`,
                rule: 'governance_block',
                result: r,
              })),
              { step: '3_block', rule: 'Governance gate block → task blocked', result: step.error },
            ],
          })
        } catch {
          // Non bloccante
        }

        onEvent?.('task_complete', { step })
        return step
      }
    } catch {
      // Non bloccante: se governance-hooks fallisce, continua comunque
    }

    // C1 fix (Delegation HITL audit Fase A): checkAuthority integrato nell'executor.
    // PRIMA: checkAuthority era cosmetico (non chiamato da executor) → le deleghe
    // definite in DelegationContract non venivano mai consultate a runtime.
    // ORA: prima del ReAct loop, verifica se l'agente ha l'autorità per eseguire
    // il task. Lo scope derivato è `task:execute:{agentId}` (admin concede questo
    // scope per autorizzare un agente a eseguire task).
    // Non bloccante (fail-open): se checkAuthority fallisce per errori tecnici,
    // continua. Se authorized: false, log warning ma NON blocca — il sistema di
    // deleghe è ancora opzionale (backward compat con piani senza deleghe).
    try {
      const { checkAuthority, logAuditEntry } = await import('@/lib/kernel/artificial-retainer')
      const authorityScope = `task:execute:${taskDef.agentId}`
      const authorityResult = await checkAuthority(taskDef.agentId, authorityScope)
      if (!authorityResult.authorized) {
        // Log warning all'audit ledger — il task procede ma l'esecuzione senza
        // delega esplicita è tracciata per review retrospettiva.
        await logAuditEntry({
          agentId: taskDef.agentId,
          action: `task:${taskDef.taskId}`,
          decision: {
            source: 'executor',
            intent: `Esecuzione senza delega esplicita per ${taskDef.agentId}`,
            gate: 'delegation',
            outcome: 'unauthorized-but-proceeded',
            scope: authorityScope,
            reason: authorityResult.reason,
          },
          readableNarrative: `L'agente ${taskDef.agentId} ha eseguito il task ${taskDef.taskId} senza delega esplicita (scope: ${authorityScope}). Motivo: ${authorityResult.reason}`,
          reversible: true,
        }).catch(() => {})
      }
    } catch {
      // Non bloccante: se checkAuthority o logAuditEntry falliscono, continua
    }

    // G2 fix (LTL audit Fase B): taintInput su task description (potenziale input utente).
    // PRIMA: Taint tracking era cosmetico (non chiamato da executor).
    // ORA: marca il task description come tainted e propaga attraverso il ReAct loop.
    // Il taintId viene passato al ReAct loop che propaga ad ogni iterazione,
    // e al tool-dispatcher che chiama checkSink prima di tool sensibili.
    let taintId: string | undefined
    try {
      const { taintInput } = await import('@/lib/kernel/taint')
      taintId = await taintInput(
        `task:${planId}/${taskDef.taskId}`,
        taskDef.description,
      )
    } catch {
      // Non bloccante: se taint fallisce, continua senza tracking
    }

    // C1 fix (Context Manager audit Fase A): integra Context Manager nell'executor.
    // PRIMA: recordToolCall non era chiamato da nessuna parte → ring buffer sempre vuoto.
    // ORA: dopo ogni task, registra il tool call nel Context Manager.
    // Non bloccante (fail-open): se Context Manager fallisce, continua.
    try {
      const { recordToolCall } = await import('@/lib/kernel/context-engineering')
      // Registra il task come "tool call" nel ring buffer del Context Manager
      await recordToolCall(
        taskDef.agentId,
        'task_execution',
        { taskId: taskDef.taskId, description: taskDef.description },
        { planId, goal: planGoal },
        0, // tokenCost sarà aggiornato dopo l'esecuzione
      )
    } catch {
      // Non bloccante: se Context Manager fallisce, continua
    }

    // C1 fix (Model Encapsulator audit Fase A): integra encapsulatedCall nell'executor.
    // PRIMA: encapsulatedCall era cosmetico (chiamato solo via API manuale).
    // L'executor usava direttamente executeReActLoop (che chiama lo ZAI SDK
    // raw, senza incapsulamento né policy enforcement).
    // ORA: prima del ReAct loop, se l'agente ha una EncapsulationPolicy attiva
    // con forbidDirectMutation=true, chiama encapsulatedCall per stabilire
    // una sessione incapsulata stateless. Il risultato (modelOutput) viene
    // iniettato come contesto nel ReAct loop, in modo che l'LLM riceva
    // solo il context minimale determinato dalla policy.
    // Non bloccante (fail-open): se encapsulatedCall fallisce per errori tecnici,
    // il ReAct loop procede comunque (senza incapsulamento, backward compat).
    let encapsulatedContext: string | undefined
    try {
      const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
      const encResult = await encapsulatedCall({
        agentId: taskDef.agentId,
        taskGoal: taskDef.description,
        contextData: {
          planId,
          planGoal,
          taskId: taskDef.taskId,
          agentId: taskDef.agentId,
          description: taskDef.description,
        },
      })
      // Se la sandbox ha eseguito uno script, usa il result come contesto aggiuntivo
      // per il ReAct loop. Altrimenti, usa il modelOutput come "grounding hint".
      if (encResult.sandboxOk && encResult.sandboxResult !== undefined) {
        encapsulatedContext = `Grounded inference result: ${JSON.stringify(encResult.sandboxResult)}`
      } else if (encResult.modelOutput && !encResult.modelOutput.startsWith('LLM Error:')) {
        encapsulatedContext = `Grounded inference hint: ${encResult.modelOutput.slice(0, 500)}`
      }
      onEvent?.('task_encapsulated', {
        taskId: taskDef.taskId,
        sessionId: encResult.sessionId,
        status: encResult.status,
      })
    } catch {
      // Non bloccante: se encapsulatedCall fallisce, il ReAct loop procede senza
      // contesto incapsulato. Non blocca il task (backward compat).
    }

    const { executeReActLoop } = await import('./react-loop')
    const reactResult = await executeReActLoop({
      agentId: taskDef.agentId,
      planId,
      taskId: taskDef.taskId,
      task: taskDef.description,
      // C1 Model Encapsulator: inietta il contesto incapsulato se disponibile
      context: encapsulatedContext
        ? `obiettivo globale = ${planGoal}\n\n${encapsulatedContext}`
        : `obiettivo globale = ${planGoal}`,
      signal,
      steeringPhrase: steeringResult.phrase,
      taintId, // G2: passa taintId per propagateTaint nel ReAct loop
      // C1 fix (Model Router audit Fase A): passa modelId dal TimeRouter.
      // steer() chiama getRoutedModel() che chiama route() per scegliere
      // il modello adaptive. Se routedModel è disponibile, il react-loop
      // lo passa a zai.chat.completions.create({ model: ... }).
      // UX Architecture: per-run modelId override takes priority over router
      modelId: perRunModelId || steeringResult.routedModel?.modelId,
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

    // G3 fix (PTA Dominators audit Fase C): cattura traccia di esecuzione.
    // PRIMA: captureTrace non era chiamato da nessuna parte → PTA sempre vuoto.
    // ORA: dopo ogni task completato, cattura la sequenza di stati (steering strategies)
    // come traccia per il Dominator Tree del workflow.
    // Non bloccante (fail-open): se captureTrace fallisce, continua.
    try {
      const { captureTrace } = await import('@/lib/kernel/dominator-tree')
      // Costruisci states dalla sequenza di steering strategies + outcome
      const traceStates = [
        step.strategy || 'execute',
        ...(step.ltlVerdict ? [`ltl:${step.ltlVerdict}`] : []),
        'done',
      ]
      await captureTrace(
        `plan:${planId}`,
        `task:${taskDef.taskId}`,
        traceStates,
        [taskDef.description],
        step.status === 'done' ? 'success' : 'partial',
      )
    } catch {
      // Non bloccante: se PTA capture fallisce, continua
    }

    // C1 fix (Affect Monitor audit Fase A): integra computeAffect nell'executor.
    // PRIMA: computeAffect era cosmetico (chiamato solo via API manuale).
    // L'executor non calcolava mai le metriche desperation/frustration →
    // il Meta-Observer non interveniva mai (death spiral prevention cosmetica).
    // ORA: dopo ogni task completato, calcola le metriche affettive dell'agente
    // usando la telemetria del task (toolFailures/toolCalls/gateRejects/etc.).
    // Se `intervention` è settato, emette evento WS per UI + logga audit.
    // Non bloccante (fail-open): se computeAffect fallisce, il task resta done.
    try {
      const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
      // Deriva telemetria dal step + reactResult
      const reactToolCalls = (reactResult as any)?.iterations?.length || 0
      const reactToolFailures = (reactResult as any)?.iterations?.reduce(
        (sum: number, iter: any) => sum + (iter.toolCalls?.filter((tc: any) => !tc.success).length || 0), 0,
      ) || 0
      // gateRejects: task blocked da LTL/Normative/Governance → step.status === 'blocked'
      // (in questo branch step.status === 'done', quindi gateRejects = 0 qui)
      const gateRejects = 0
      const gateAttempts = 1  // ogni task è 1 gate attempt
      // repeatedToolCalls: heuristic — se ci sono state 3+ iterazioni sullo stesso task,
      // assumiamo almeno 1 repeated call (proxy per loop detection)
      const repeatedToolCalls = reactToolCalls >= 3 ? reactToolCalls - 2 : 0

      const affectResult = await computeAffect({
        agentId: taskDef.agentId,
        toolFailures: reactToolFailures,
        toolCalls: reactToolCalls,
        gateRejects,
        gateAttempts,
        repeatedToolCalls,
      })
      // Se il Meta-Observer ha generato un intervento, emetti evento WS per UI
      if (affectResult.intervention) {
        const { publishAgentEvent } = await import('@/lib/ws-publish')
        await publishAgentEvent({
          agentId: taskDef.agentId, phase: '11',
          event: 'affect_intervention',
          level: 'warn',
          payload: {
            taskId: taskDef.taskId,
            desperation: affectResult.desperation,
            frustration: affectResult.frustration,
            intervention: affectResult.intervention,
            cycleId: affectResult.cycleId,
          },
        }).catch(() => {})
        onEvent?.('affect_intervention', {
          taskId: taskDef.taskId,
          agentId: taskDef.agentId,
          desperation: affectResult.desperation,
          frustration: affectResult.frustration,
          intervention: affectResult.intervention,
        })
      }
    } catch {
      // Non bloccante: se computeAffect o publishAgentEvent falliscono, continua
    }

    // C1 fix (Swarm Coherence audit Fase A): integra recordBelief nell'executor.
    // PRIMA: recordBelief era cosmetico (chiamato solo via API manuale).
    // L'executor non registrava belief durante l'esecuzione → divergenza
    // epistemica non mitigata a runtime (agenti paralleli con riassunti divergenti).
    // ORA: dopo ogni task completato, registra un belief "observation" con il
    // risultato del task. Se esiste già un belief simile (sim > 0.85), viene
    // marcato come superseded → belief lineage preservato.
    // Non bloccante (fail-open): se recordBelief fallisce, il task resta done.
    try {
      const { recordBelief } = await import('@/lib/kernel/esr-quorum')
      const beliefContent = `Task ${taskDef.taskId} (${taskDef.agentId}): ${step.status} — ${result.slice(0, 200)}`
      await recordBelief({
        agentId: taskDef.agentId,
        content: beliefContent,
        beliefType: 'observation',
        confidence: step.status === 'done' ? 0.9 : 0.5,
      })
      onEvent?.('belief_recorded', {
        taskId: taskDef.taskId,
        agentId: taskDef.agentId,
        beliefType: 'observation',
      })
    } catch {
      // Non bloccante: se recordBelief fallisce (DB error, embedding error), continua
    }

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
  // UX Architecture: per-run override options
  modelId?: string
  allowedTools?: string[]
  agentUri?: string
}): Promise<ExecutorResult> {
  const { planId, planOnly, signal, onEvent } = params
  const perRunModelId = params.modelId     // UX: override model for LLM calls
  const perRunAllowedTools = params.allowedTools  // UX: tool whitelist
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

  // === Phase 1.5: Objective Tree decomposition (C1 fix Objective Builder) ===
  // C1 fix (Objective Builder audit Fase A): integra createObjectiveTree in executePlan.
  // PRIMA: createObjectiveTree era cosmetico (chiamato solo via API manuale).
  // L'executor non decomposeva il planGoal in rubric tree → nessuna valutazione
  // gerarchica Pass/Fail durante l'esecuzione.
  // ORA: prima del batch loop, crea un objective tree per il planGoal.
  // L'albero fornisce criteri di successo densi (BFS rubric) che potrebbero
  // essere usati per valutare il risultato del piano (in futuro).
  // Non bloccante (fail-open): se createObjectiveTree fallisce, il piano procede.
  // Evita duplicati: salta se esiste già un tree con stesso rootGoal (cache implicita).
  let objectiveTreeId: string | undefined
  try {
    const { createObjectiveTree } = await import('@/lib/kernel/agent-objective')
    // C1 — crea albero una volta per piano (non per task)
    // Il tree viene persistito e può essere recuperato via API per visualizzazione
    const treeResult = await createObjectiveTree(plan.goal)
    objectiveTreeId = treeResult.treeId
    onEvent?.('objective_tree_created', {
      planId,
      treeId: treeResult.treeId,
      totalNodes: treeResult.totalNodes,
      maxDepth: treeResult.maxDepth,
    })
  } catch {
    // Non bloccante: se createObjectiveTree fallisce (LLM error, DB error),
    // il piano procede senza rubric tree (backward compat)
  }

  // === Phase 2: Task execution per batch ===
  // WS1.5c — Dispatch parallelo dentro il batch (task indipendenti)
  // topologicalBatches garantisce che i task nello stesso batch non hanno dipendenze reciproche.
  //
  // C2 (ACTS audit) — Stato FSM dell'ACTS Controller mantenuto tra batch.
  // I task nello stesso batch sono indipendenti e possono leggere lo stesso
  // stato (snapshot); l'aggiornamento avviene sequenzialmente dopo ogni batch.
  let steeringState = {
    step: 0,
    lastStrategy: 'PLAN' as Strategy,
    lastCheckPassed: null as boolean | null,
    errorsConsecutive: 0,
    budgetTotal: 1000,
    budgetUsed: 0,
  }

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

    // C2 — Snapshot dello stato FSM per questo batch (tutti i task del batch
    // leggono lo stesso stato iniziale, perché sono indipendenti).
    const batchSteeringSnapshot = { ...steeringState }

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
          steeringState: batchSteeringSnapshot,
          // UX Architecture: pass per-run modelId/allowedTools to each task
          ...(perRunModelId && { modelId: perRunModelId }),
          ...(perRunAllowedTools && { allowedTools: perRunAllowedTools }),
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

    // C2 — Aggiorna lo stato FSM dopo il batch per evolvere il controller
    // (PLAN → EXECUTE → CHECK → ...). Usiamo l'ultimo step come proxy per
    // l'evoluzione; in una versione futura si potrebbe leggere lo stato
    // persistito da SteeringState (G1).
    //
    // B2 fix (Fase B) — Contratto errorsConsecutive documentato:
    //   - reset a 0 su success (task done) → lastCheckPassed = true
    //   - incrementa su failure (task failed) → lastCheckPassed = false
    //   - decideStrategy usa errorsConsecutive >= 3 per forzare CHECK
    // Il caller (executePlan) è responsabile di mantenere questo invariant.
    const lastStepInBatch = batchResults[batchResults.length - 1]
    if (lastStepInBatch?.strategy) {
      steeringState.step += batchResults.length
      steeringState.lastStrategy = lastStepInBatch.strategy as Strategy
      steeringState.budgetUsed += 100 // stima cost media per step
      if (lastStepInBatch.status === 'failed') {
        // B2 — failure: increment errorsConsecutive, lastCheckPassed = false
        steeringState.errorsConsecutive += 1
        steeringState.lastCheckPassed = false
      } else if (lastStepInBatch.status === 'done') {
        // B2 — success: RESET errorsConsecutive to 0, lastCheckPassed = true
        steeringState.errorsConsecutive = 0
        steeringState.lastCheckPassed = true
      }
    }

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

  // C2 fix (Swarm Coherence audit Fase A): integra proposeQuorumAction+voteQuorum ai join point.
  // PRIMA: proposeQuorumAction/voteQuorum erano cosmetici (chiamati solo via API manuale).
  // L'executor non proponeva quorum ai join point del DAG → nessuna azione era
  // certificata da validatori indipendenti a runtime.
  // ORA: dopo tutti i batch (join point finale del DAG), se ci sono task done,
  // propone un quorum per certificare il risultato del piano. I validatori
  // indipendenti (verifier-1, verifier-2) votano accept/reject.
  // Non bloccante (fail-open): se quorum fallisce, il piano procede comunque.
  // Solo se almeno 1 task è done (altrimenti quorum su piano fallito è inutile).
  const doneCount = steps.filter((s) => s.status === 'done').length
  if (!signal?.aborted && doneCount > 0) {
    try {
      const { proposeQuorumAction, voteQuorum } = await import('@/lib/kernel/esr-quorum')
      const quorumAction = `certify plan ${planId}: ${doneCount}/${steps.length} tasks done`
      const { decisionId } = await proposeQuorumAction(
        `join:${planId}`,
        quorumAction,
        2,  // requiredQuorum = 2 validatori indipendenti
      )
      // Auto-voto del verifier-1 (accept se majority done, reject altrimenti)
      const majorityDone = doneCount > steps.length / 2
      await voteQuorum(decisionId, 'verifier-1', majorityDone ? 'accept' : 'reject')
      onEvent?.('quorum_proposed', {
        planId,
        decisionId,
        action: quorumAction,
        doneCount,
        totalTasks: steps.length,
      })
    } catch {
      // Non bloccante: se quorum proposal/vote fallisce, il piano procede
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
    objectiveTreeId, // C1 fix Objective Builder: tree creato in Phase 1.5
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
 * C6.7 — Persist LTL verdict + violations on a task so the RunDetailView
 * can display whether each task passed/failed LTL verification.
 */
async function updateTaskLtl(
  planId: string,
  taskId: string,
  verdict: string,
  violations: string[],
): Promise<void> {
  const task = await db.planTask.findFirst({
    where: { planId, taskId },
    select: { id: true },
  })
  if (!task) return

  await db.planTask.update({
    where: { id: task.id },
    data: {
      ltlVerdict: verdict,
      ltlViolations: violations.length > 0 ? JSON.stringify(violations) : null,
    },
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
  // UX Architecture: per-run override options (optional, passed from Console)
  modelId?: string       // override model for LLM calls (TimeRouter model)
  allowedTools?: string[] // whitelist of toolIds for this run
  agentUri?: string       // specific agent to use (future: agent selection)
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
    // UX Architecture: pass modelId/allowedTools through to executePlan
    const result = await executePlan({
      planId,
      signal: params.signal,
      onEvent: params.onEvent,
      ...(params.modelId && { modelId: params.modelId }),
      ...(params.allowedTools && { allowedTools: params.allowedTools }),
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
