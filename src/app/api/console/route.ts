/**
 * API: /api/console — Console Agentica
 *
 * Orchestra il flusso end-to-end:
 * 1. Utente invia un task testuale
 * 2. Planner (F2) genera piano DynAMO via LLM
 * 3. Per ogni task: Steering (F3) decide strategia, LTL (F4) verifica
 * 4. Se bloccato → BlockedAction (F17)
 * 5. Al termine → Reflective Learning (F5) estrae euristica
 * 6. Pubblica eventi WS per real-time UI
 */
import { NextRequest, NextResponse } from 'next/server'
import { validatePlan, topologicalBatches } from '@/lib/kernel/scheduler'
import { steer, type Strategy } from '@/lib/kernel/acts'
import { verifyEvent } from '@/lib/kernel/ltl-monitor'
import { reflectAndLearn, type ReflectionInput } from '@/lib/kernel/erl'
import { recordNarrative } from '@/lib/kernel/sovereign-translator'
import { publishAgentEvent, publishSensorium } from '@/lib/ws-publish'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

type ExecutionStep = {
  taskId: string
  agentId: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked'
  strategy?: Strategy
  ltlVerdict?: string
  result?: string
  startedAt?: string
  completedAt?: string
}

type ConsoleResult = {
  planId: string
  goal: string
  steps: ExecutionStep[]
  batches: string[][]
  reflection?: {
    approved: boolean
    heuristic?: string
    reviewReason?: string
  }
  summary: {
    totalTasks: number
    completed: number
    failed: number
    blocked: number
    durationMs: number
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { task, mode } = body as { task: string; mode?: 'full' | 'plan-only' }

  if (!task || !task.trim()) {
    return NextResponse.json({ ok: false, error: 'Task obbligatorio' }, { status: 400 })
  }

  const startTime = Date.now()

  try {
    // ============================================
    // STEP 1: Genera piano via LLM (F2 - DynAMO)
    // ============================================
    await publishAgentEvent({
      agentId: 'orchestrator', phase: '2',
      event: 'plan_generation_started',
      payload: { task: task.slice(0, 100) },
    })

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

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Obiettivo: ${task}` },
      ],
    })
    const raw = completion.choices[0].message.content || ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ ok: false, error: 'LLM non ha prodotto un piano valido' }, { status: 500 })
    }
    const plan = JSON.parse(jsonMatch[0])
    const validation = validatePlan(plan)
    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: 'Piano non valido', errors: validation.errors }, { status: 400 })
    }

    // Persisti piano
    const batches = topologicalBatches(plan.tasks)
    const planRecord = await db.agentPlan.create({
      data: {
        taskGoal: plan.goal,
        planJson: JSON.stringify(plan),
        dagJson: JSON.stringify(batches),
        status: 'running',
        agentCount: new Set(plan.tasks.map((t: any) => t.agentId)).size,
      },
    })
    for (const t of plan.tasks) {
      await db.planTask.create({
        data: {
          planId: planRecord.id,
          taskId: t.taskId,
          agentId: t.agentId,
          description: t.description,
          dependencies: JSON.stringify(t.dependencies),
          status: 'ready',
        },
      })
    }

    await publishAgentEvent({
      agentId: 'orchestrator', phase: '2',
      event: 'plan_generated',
      payload: { planId: planRecord.id, taskCount: plan.tasks.length, batchCount: batches.length },
    })

    await recordNarrative('orchestrator', `Piano generato per: "${task.slice(0, 80)}" — ${plan.tasks.length} task in ${batches.length} batch`, 'info', undefined, '2')

    // Se mode=plan-only, ritorna solo il piano
    if (mode === 'plan-only') {
      return NextResponse.json({
        ok: true,
        result: {
          planId: planRecord.id,
          goal: plan.goal,
          steps: plan.tasks.map((t: any) => ({
            taskId: t.taskId,
            agentId: t.agentId,
            description: t.description,
            status: 'pending',
          })),
          batches,
          summary: {
            totalTasks: plan.tasks.length,
            completed: 0,
            failed: 0,
            blocked: 0,
            durationMs: Date.now() - startTime,
          },
        } as ConsoleResult,
      })
    }

    // ============================================
    // STEP 2: Esegui ogni task (F3 Steering + F4 LTL)
    // ============================================
    const steps: ExecutionStep[] = plan.tasks.map((t: any) => ({
      taskId: t.taskId,
      agentId: t.agentId,
      description: t.description,
      status: 'pending',
    }))

    let budgetUsed = 0
    const budgetTotal = 2000
    let lastStrategy: Strategy = 'PLAN'
    let lastCheckPassed: boolean | null = null
    let errorsConsecutive = 0

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i]
      const step = steps[i]

      // Update status
      step.status = 'running'
      step.startedAt = new Date().toISOString()

      await db.planTask.updateMany({
        where: { planId: planRecord.id, taskId: task.taskId },
        data: { status: 'running', startedAt: new Date() },
      })

      await publishAgentEvent({
        agentId: task.agentId, phase: '3',
        event: 'task_started',
        payload: { taskId: task.taskId, description: task.description.slice(0, 80) },
      })

      // F3: Steering — decide strategia
      const steerResult = await steer(
        task.agentId,
        budgetTotal,
        budgetUsed,
        i,
        lastStrategy,
        lastCheckPassed,
        errorsConsecutive
      )
      step.strategy = steerResult.strategy
      budgetUsed += steerResult.tokenUsed
      lastStrategy = steerResult.strategy

      await publishSensorium({
        cycleId: Date.now(),
        xml: `<sensorium><task>${task.taskId}</task><strategy>${steerResult.strategy}</strategy></sensorium>`,
        queueDepth: plan.tasks.length - i - 1,
        activeThreads: 1,
        systemLoad: Math.min(0.9, 0.3 + i * 0.1),
      })

      // F4: LTL verify — simula evento per ogni task
      const eventLabel = task.agentId === 'verifier' ? 'check' : 'execute'
      const ltlResult = await verifyEvent(eventLabel, 'task_execution', {
        taskId: task.taskId,
        agentId: task.agentId,
      })
      step.ltlVerdict = ltlResult.verdict

      if (ltlResult.verdict === 'reject') {
        // Azione bloccata da LTL
        step.status = 'blocked'
        step.completedAt = new Date().toISOString()
        step.result = `Bloccato da LTL: ${ltlResult.violations.map(v => v.reason).join('; ')}`

        await db.planTask.updateMany({
          where: { planId: planRecord.id, taskId: task.taskId },
          data: { status: 'failed', finishedAt: new Date(), result: step.result },
        })

        await publishAgentEvent({
          agentId: task.agentId, phase: '4',
          event: 'task_blocked_ltl',
          level: 'warn',
          payload: { taskId: task.taskId, violations: ltlResult.violations.length },
        })

        lastCheckPassed = false
        errorsConsecutive++
        continue
      }

      // Simula esecuzione task (in produzione: chiama tool/LLM reale)
      const execResult = simulateTaskExecution(task)

      if (execResult.success) {
        step.status = 'done'
        step.result = execResult.output
        lastCheckPassed = true
        errorsConsecutive = 0

        await db.planTask.updateMany({
          where: { planId: planRecord.id, taskId: task.taskId },
          data: { status: 'done', finishedAt: new Date(), result: execResult.output },
        })

        await publishAgentEvent({
          agentId: task.agentId, phase: '3',
          event: 'task_completed',
          payload: { taskId: task.taskId },
        })
      } else {
        step.status = 'failed'
        step.result = execResult.error
        lastCheckPassed = false
        errorsConsecutive++

        await db.planTask.updateMany({
          where: { planId: planRecord.id, taskId: task.taskId },
          data: { status: 'failed', finishedAt: new Date(), result: execResult.error },
        })

        await publishAgentEvent({
          agentId: task.agentId, phase: '3',
          event: 'task_failed',
          level: 'warn',
          payload: { taskId: task.taskId, error: execResult.error },
        })
      }

      step.completedAt = new Date().toISOString()
    }

    // ============================================
    // STEP 3: Reflective Learning (F5 — ERL)
    // ============================================
    const completedCount = steps.filter(s => s.status === 'done').length
    const failedCount = steps.filter(s => s.status === 'failed').length
    const blockedCount = steps.filter(s => s.status === 'blocked').length
    const outcome = completedCount === steps.length ? 'success' : failedCount > blockedCount ? 'failure' : 'partial'

    await publishAgentEvent({
      agentId: 'reflective', phase: '5',
      event: 'reflection_started',
      payload: { outcome, completed: completedCount, failed: failedCount },
    })

    const reflectionInput: ReflectionInput = {
      operationId: planRecord.id,
      goal: plan.goal,
      outcome: outcome as 'success' | 'failure' | 'partial',
      steps: steps.map(s => ({
        action: s.taskId,
        result: s.result || s.status,
      })),
      context: `Task utente: ${task.slice(0, 100)}`,
    }

    const reflection = await reflectAndLearn(reflectionInput)

    await publishAgentEvent({
      agentId: 'reflective', phase: '5',
      event: 'reflection_completed',
      payload: { approved: reflection.approved, stored: reflection.stored },
    })

    await recordNarrative('reflective', `Riflessione completata per "${plan.goal.slice(0, 60)}": ${outcome}, euristica ${reflection.approved ? 'approvata' : 'rifiutata'}`, reflection.approved ? 'info' : 'warn', undefined, '5')

    // Update plan status
    await db.agentPlan.update({
      where: { id: planRecord.id },
      data: { status: 'completed' },
    })

    const durationMs = Date.now() - startTime

    const result: ConsoleResult = {
      planId: planRecord.id,
      goal: plan.goal,
      steps,
      batches,
      reflection: {
        approved: reflection.approved,
        heuristic: reflection.heuristic.action,
        reviewReason: reflection.reviewReason,
      },
      summary: {
        totalTasks: steps.length,
        completed: completedCount,
        failed: failedCount,
        blocked: blockedCount,
        durationMs,
      },
    }

    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

/**
 * Simula l'esecuzione di un task.
 * In produzione: chiamare tool reali o LLM.
 */
function simulateTaskExecution(task: { taskId: string; agentId: string; description: string }): {
  success: boolean
  output?: string
  error?: string
} {
  // 85% success rate
  const success = Math.random() > 0.15
  if (success) {
    return {
      success: true,
      output: `${task.taskId} completato da ${task.agentId}: ${task.description.slice(0, 60)}`,
    }
  }
  return {
    success: false,
    error: `${task.taskId} fallito: timeout o errore di esecuzione`,
  }
}
