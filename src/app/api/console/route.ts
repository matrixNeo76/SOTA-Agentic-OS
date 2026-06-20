/**
 * API: /api/console — Console Agentica
 *
 * Orchestra il flusso end-to-end con error handling strutturato:
 * 1. Utente invia un task testuale
 * 2. Planner (F2) genera piano DynAMO via LLM
 * 3. Per ogni task: Steering (F3) + LTL (F4) + esecuzione reale via LLM
 * 4. Se bloccato → BlockedAction (F17)
 * 5. Al termine → Reflective Learning (F5)
 * 6. Ogni errore è catturato, classificato e mostrato con dettagli
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
  ltlViolations?: string[]
  result?: string
  error?: ErrorDetail
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

type ErrorDetail = {
  type: 'plan_generation' | 'steering' | 'ltl_verification' | 'task_execution' | 'reflection' | 'unknown'
  message: string
  phase: string
  recoverable: boolean
  suggestion?: string
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
    error?: string
  }
  summary: {
    totalTasks: number
    completed: number
    failed: number
    blocked: number
    durationMs: number
  }
  errors: ErrorDetail[]
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { task, mode } = body as { task: string; mode?: 'full' | 'plan-only' }
  const errors: ErrorDetail[] = []

  if (!task || !task.trim()) {
    return NextResponse.json({
      ok: false,
      error: 'Task obbligatorio',
      errors: [{ type: 'unknown', message: 'Nessun task fornito', phase: 'input', recoverable: false }],
    }, { status: 400 })
  }

  const startTime = Date.now()

  try {
    // ============================================
    // STEP 1: Genera piano via LLM (F2 - DynAMO)
    // ============================================
    let plan: any
    try {
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
        throw new Error(`LLM non ha prodotto JSON valido. Risposta: ${raw.slice(0, 200)}`)
      }
      plan = JSON.parse(jsonMatch[0])
      const validation = validatePlan(plan)
      if (!validation.valid) {
        throw new Error(`Piano non valido: ${validation.errors.join('; ')}`)
      }
    } catch (e: any) {
      const error: ErrorDetail = {
        type: 'plan_generation',
        message: e.message,
        phase: 'F2-Planner',
        recoverable: false,
        suggestion: 'Riprova con un task più specifico o meno complesso',
      }
      errors.push(error)
      return NextResponse.json({ ok: false, error: e.message, errors }, { status: 500 })
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
      payload: { planId: planRecord.id, taskCount: plan.tasks.length },
    })
    await recordNarrative('orchestrator', `Piano generato per: "${task.slice(0, 80)}" — ${plan.tasks.length} task`, 'info', undefined, '2')

    // Se plan-only, ritorna subito
    if (mode === 'plan-only') {
      return NextResponse.json({
        ok: true,
        result: {
          planId: planRecord.id,
          goal: plan.goal,
          steps: plan.tasks.map((t: any) => ({
            taskId: t.taskId, agentId: t.agentId, description: t.description, status: 'pending',
          })),
          batches,
          summary: { totalTasks: plan.tasks.length, completed: 0, failed: 0, blocked: 0, durationMs: Date.now() - startTime },
          errors: [],
        } as ConsoleResult,
      })
    }

    // ============================================
    // STEP 2: Esegui ogni task
    // ============================================
    const steps: ExecutionStep[] = plan.tasks.map((t: any) => ({
      taskId: t.taskId, agentId: t.agentId, description: t.description, status: 'pending',
    }))

    let budgetUsed = 0
    const budgetTotal = 2000
    let lastStrategy: Strategy = 'PLAN'
    let lastCheckPassed: boolean | null = null
    let errorsConsecutive = 0

    for (let i = 0; i < plan.tasks.length; i++) {
      const taskSpec = plan.tasks[i]
      const step = steps[i]
      const stepStart = Date.now()

      step.status = 'running'
      step.startedAt = new Date().toISOString()

      await db.planTask.updateMany({
        where: { planId: planRecord.id, taskId: taskSpec.taskId },
        data: { status: 'running', startedAt: new Date() },
      })
      await publishAgentEvent({
        agentId: taskSpec.agentId, phase: '3',
        event: 'task_started',
        payload: { taskId: taskSpec.taskId, description: taskSpec.description.slice(0, 80) },
      })

      // --- F3: Steering ---
      try {
        const steerResult = await steer(
          taskSpec.agentId, budgetTotal, budgetUsed, i,
          lastStrategy, lastCheckPassed, errorsConsecutive
        )
        step.strategy = steerResult.strategy
        budgetUsed += steerResult.tokenUsed
        lastStrategy = steerResult.strategy
      } catch (e: any) {
        const error: ErrorDetail = {
          type: 'steering',
          message: `Errore nello steering per ${taskSpec.taskId}: ${e.message}`,
          phase: 'F3-ACTS',
          recoverable: true,
          suggestion: 'Il controller steering ha incontrato un errore interno. Il task viene saltato.',
        }
        errors.push(error)
        step.status = 'failed'
        step.error = error
        step.result = `Steering fallito: ${e.message}`
        step.completedAt = new Date().toISOString()
        step.durationMs = Date.now() - stepStart
        lastCheckPassed = false
        errorsConsecutive++
        continue
      }

      // --- F4: LTL verify ---
      try {
        const eventLabel = taskSpec.agentId === 'verifier' ? 'check' : 'execute'
        const ltlResult = await verifyEvent(eventLabel, 'task_execution', {
          taskId: taskSpec.taskId, agentId: taskSpec.agentId,
        })
        step.ltlVerdict = ltlResult.verdict

        if (ltlResult.verdict === 'reject') {
          step.status = 'blocked'
          step.completedAt = new Date().toISOString()
          step.durationMs = Date.now() - stepStart
          step.ltlViolations = ltlResult.violations.map(v => v.reason)
          step.result = `Bloccato da regola LTL di sicurezza`
          step.error = {
            type: 'ltl_verification',
            message: `Regola LTL violata: ${ltlResult.violations.map(v => v.reason).join('; ')}`,
            phase: 'F4-LTL',
            recoverable: false,
            suggestion: 'Questa azione è stata bloccata per motivi di sicurezza. Controlla il tab Safety nel Cockpit per dettagli.',
          }
          errors.push(step.error)

          await db.planTask.updateMany({
            where: { planId: planRecord.id, taskId: taskSpec.taskId },
            data: { status: 'failed', finishedAt: new Date(), result: step.result },
          })
          await publishAgentEvent({
            agentId: taskSpec.agentId, phase: '4',
            event: 'task_blocked_ltl', level: 'warn',
            payload: { taskId: taskSpec.taskId, violations: ltlResult.violations.length },
          })
          lastCheckPassed = false
          errorsConsecutive++
          continue
        }
      } catch (e: any) {
        // LTL error non blocca l'esecuzione, ma viene registrato
        const error: ErrorDetail = {
          type: 'ltl_verification',
          message: `Errore nella verifica LTL per ${taskSpec.taskId}: ${e.message}`,
          phase: 'F4-LTL',
          recoverable: true,
          suggestion: 'Verifica LTL saltata per errore interno. Il task continua senza verifica.',
        }
        errors.push(error)
        step.ltlVerdict = 'skipped'
      }

      // --- Esecuzione task via LLM ---
      try {
        const execResult = await executeTaskWithLLM(taskSpec, plan.goal, i, steps)

        if (execResult.success) {
          step.status = 'done'
          step.result = execResult.output
          lastCheckPassed = true
          errorsConsecutive = 0

          await db.planTask.updateMany({
            where: { planId: planRecord.id, taskId: taskSpec.taskId },
            data: { status: 'done', finishedAt: new Date(), result: execResult.output },
          })
          await publishAgentEvent({
            agentId: taskSpec.agentId, phase: '3',
            event: 'task_completed',
            payload: { taskId: taskSpec.taskId },
          })
        } else {
          step.status = 'failed'
          step.result = execResult.error
          step.error = {
            type: 'task_execution',
            message: execResult.error,
            phase: 'F3-Execution',
            recoverable: true,
            suggestion: execResult.suggestion || 'Riprova con un task più specifico.',
          }
          errors.push(step.error)
          lastCheckPassed = false
          errorsConsecutive++

          await db.planTask.updateMany({
            where: { planId: planRecord.id, taskId: taskSpec.taskId },
            data: { status: 'failed', finishedAt: new Date(), result: execResult.error },
          })
          await publishAgentEvent({
            agentId: taskSpec.agentId, phase: '3',
            event: 'task_failed', level: 'warn',
            payload: { taskId: taskSpec.taskId, error: execResult.error },
          })
        }
      } catch (e: any) {
        step.status = 'failed'
        step.result = `Errore imprevisto: ${e.message}`
        step.error = {
          type: 'task_execution',
          message: `Errore imprevisto durante l'esecuzione di ${taskSpec.taskId}: ${e.message}`,
          phase: 'F3-Execution',
          recoverable: true,
          suggestion: 'Errore interno del sistema. Controlla i log nel Cockpit.',
        }
        errors.push(step.error)
        lastCheckPassed = false
        errorsConsecutive++

        await db.planTask.updateMany({
          where: { planId: planRecord.id, taskId: taskSpec.taskId },
          data: { status: 'failed', finishedAt: new Date(), result: step.result },
        })
      }

      step.completedAt = new Date().toISOString()
      step.durationMs = Date.now() - stepStart
    }

    // ============================================
    // STEP 3: Reflective Learning (F5)
    // ============================================
    const completedCount = steps.filter(s => s.status === 'done').length
    const failedCount = steps.filter(s => s.status === 'failed').length
    const blockedCount = steps.filter(s => s.status === 'blocked').length
    const outcome = completedCount === steps.length ? 'success' : failedCount > blockedCount ? 'failure' : 'partial'

    let reflectionResult: ConsoleResult['reflection'] | undefined

    try {
      const reflectionInput: ReflectionInput = {
        operationId: planRecord.id,
        goal: plan.goal,
        outcome: outcome as 'success' | 'failure' | 'partial',
        steps: steps.map(s => ({ action: s.taskId, result: s.result || s.status })),
        context: `Task utente: ${task.slice(0, 100)}`,
      }
      const reflection = await reflectAndLearn(reflectionInput)
      reflectionResult = {
        approved: reflection.approved,
        heuristic: reflection.heuristic.action,
        reviewReason: reflection.reviewReason,
      }
      await publishAgentEvent({
        agentId: 'reflective', phase: '5',
        event: 'reflection_completed',
        payload: { approved: reflection.approved, stored: reflection.stored },
      })
      await recordNarrative('reflective', `Riflessione: ${outcome}, euristica ${reflection.approved ? 'approvata' : 'rifiutata'}`, reflection.approved ? 'info' : 'warn', undefined, '5')
    } catch (e: any) {
      const error: ErrorDetail = {
        type: 'reflection',
        message: `Errore nella riflessione ERL: ${e.message}`,
        phase: 'F5-ERL',
        recoverable: true,
        suggestion: 'La riflessione non è stata completata, ma i risultati del task sono disponibili.',
      }
      errors.push(error)
      reflectionResult = { approved: false, error: e.message }
    }

    await db.agentPlan.update({ where: { id: planRecord.id }, data: { status: 'completed' } })

    const result: ConsoleResult = {
      planId: planRecord.id,
      goal: plan.goal,
      steps,
      batches,
      reflection: reflectionResult,
      summary: {
        totalTasks: steps.length,
        completed: completedCount,
        failed: failedCount,
        blocked: blockedCount,
        durationMs: Date.now() - startTime,
      },
      errors,
    }

    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    const error: ErrorDetail = {
      type: 'unknown',
      message: `Errore imprevisto: ${e.message}`,
      phase: 'unknown',
      recoverable: false,
    }
    errors.push(error)
    return NextResponse.json({ ok: false, error: e.message, errors }, { status: 500 })
  }
}

/**
 * Esegue un task usando LLM reale (ZAI SDK).
 * Ogni task viene eseguito con un prompt specifico per l'agente assegnato.
 */
async function executeTaskWithLLM(
  task: { taskId: string; agentId: string; description: string },
  goal: string,
  stepIndex: number,
  previousSteps: ExecutionStep[]
): Promise<{ success: boolean; output?: string; error?: string; suggestion?: string }> {
  try {
    const zai = await ZAI.create()

    // Costruisci contesto: cosa hanno fatto gli step precedenti
    const context = previousSteps.slice(0, stepIndex).map(s =>
      `${s.taskId} (${s.agentId}): ${s.status} — ${s.result || 'nessun output'}`
    ).join('\n')

    const prompt = `Sei l'agente "${task.agentId}" in un sistema operativo agentico.
Obiettivo generale: ${goal}
Task assegnato: ${task.description}

Risultati dei task precedenti:
${context || '(nessun task precedente)'}

Esegui il task e produci un risultato conciso (massimo 3 righe). Se il task non può essere completato, spiega chiaramente perché.`

    const completion = await zai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
    })
    const output = completion.choices[0].message.content || ''

    if (!output.trim()) {
      return {
        success: false,
        error: `${task.taskId}: LLM non ha prodotto output`,
        suggestion: 'Il modello non ha generato risposta. Riprova.',
      }
    }

    // Controlla se l'output indica un fallimento
    const lowerOutput = output.toLowerCase()
    if (lowerOutput.includes('non posso') || lowerOutput.includes('impossibile') || lowerOutput.includes('non riesco')) {
      return {
        success: false,
        error: `${task.taskId}: ${output.slice(0, 200)}`,
        suggestion: 'L\'agente ha segnalato di non poter completare il task. Prova a riformulare.',
      }
    }

    return {
      success: true,
      output: output.slice(0, 500), // limit output length
    }
  } catch (e: any) {
    return {
      success: false,
      error: `${task.taskId}: errore LLM — ${e.message}`,
      suggestion: 'Errore di connessione al modello. Riprova tra qualche secondo.',
    }
  }
}
