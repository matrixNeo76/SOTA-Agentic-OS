/**
 * API: /api/console/stream — Console Agentica con SSE streaming
 *
 * Versione streaming di /api/console che emette eventi Server-Sent Events
 * per ogni fase dell'esecuzione:
 *   - plan_start, plan_chunk, plan_complete
 *   - task_start, task_chunk, task_complete (per ogni task)
 *   - reflection_start, reflection_complete
 *   - error, done
 *
 * Il client usa EventSource per consumare gli eventi in tempo reale.
 * Supporta abort via AbortController (client chiude la connessione).
 */
import { NextRequest } from 'next/server'
import { validatePlan, topologicalBatches } from '@/lib/kernel/scheduler'
import { steer, type Strategy } from '@/lib/kernel/acts'
import { verifyEvent } from '@/lib/kernel/ltl-monitor'
import { reflectAndLearn, type ReflectionInput } from '@/lib/kernel/erl'
import { recordNarrative } from '@/lib/kernel/sovereign-translator'
import { publishAgentEvent } from '@/lib/ws-publish'
import { db } from '@/lib/db'
import { recordCostEntry, calculateCost } from '@/lib/kernel/cost-ledger'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExecutionStep = {
  taskId: string
  agentId: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked'
  strategy?: Strategy
  ltlVerdict?: string
  ltlViolations?: string[]
  result?: string
  error?: any
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

type SSEEvent = {
  event: string
  data: Record<string, unknown>
}

function encodeSSE({ event, data }: SSEEvent): string {
  const payload = JSON.stringify(data)
  return `event: ${event}\ndata: ${payload}\n\n`
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { task, mode } = body
  const planOnly = mode === 'plan-only'

  if (!task || typeof task !== 'string') {
    return new Response('task required', { status: 400 })
  }

  const encoder = new TextEncoder()
  const abortController = new AbortController()

  // Detect client disconnect
  req.signal.addEventListener('abort', () => {
    abortController.abort()
  })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        if (abortController.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(encodeSSE({ event, data })))
        } catch {
          // controller already closed
        }
      }

      const steps: ExecutionStep[] = []
      const errors: any[] = []
      const startedAt = Date.now()

      try {
        // === Phase 1: Plan generation (with streaming) ===
        send('plan_start', { task })
        let plan: any
        let planId: string
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
- 3-5 task totali
- Rispondi con SOLO il JSON, nessuna spiegazione.`

          const completionStream = await zai.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Obiettivo: ${task}` },
            ],
            stream: true,
          })

          let raw = ''
          let tokensUsed = 0
          for await (const chunk of completionStream) {
            if (abortController.signal.aborted) break
            const delta = chunk.choices?.[0]?.delta?.content || ''
            if (delta) {
              raw += delta
              tokensUsed++
              if (tokensUsed % 3 === 0) {
                send('plan_chunk', { partial: raw.slice(-200) })
              }
            }
          }

          // Record cost
          const inputTokens = Math.ceil((systemPrompt.length + task.length) / 4)
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
            throw new Error(`LLM non ha prodotto JSON valido`)
          }
          plan = JSON.parse(jsonMatch[0])
          const validation = validatePlan(plan)
          if (!validation.valid) {
            throw new Error(`Piano non valido: ${validation.errors.join('; ')}`)
          }

          // Persist plan
          planId = `plan_${Date.now()}`
          await db.agentPlan.create({
            data: {
              id: planId,
              taskGoal: plan.goal,
              planJson: JSON.stringify(plan),
              dagJson: JSON.stringify(topologicalBatches(plan.tasks)),
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

          const batches = topologicalBatches(plan.tasks)
          send('plan_complete', { planId, plan, batches, tokensUsed })
        } catch (e: any) {
          const error = {
            type: 'plan_generation',
            message: e.message,
            phase: 'Planner & Compiler',
            recoverable: true,
            suggestion: 'Riformula il task in modo più specifico.',
          }
          errors.push(error)
          send('error', { error, phase: 'plan_generation' })
          send('done', { ok: false, error: e.message, errors })
          controller.close()
          return
        }

        // If plan-only mode, stop here
        if (planOnly) {
          send('done', {
            ok: true,
            result: {
              planId,
              goal: plan.goal,
              steps: [],
              batches: topologicalBatches(plan.tasks),
              summary: {
                totalTasks: plan.tasks.length,
                completed: 0,
                failed: 0,
                blocked: 0,
                durationMs: Date.now() - startedAt,
              },
            },
          })
          controller.close()
          return
        }

        // === Phase 2: Task execution (streamed per task) ===
        const batches = topologicalBatches(plan.tasks)
        for (const batch of batches) {
          for (const taskId of batch) {
            if (abortController.signal.aborted) break
            const taskDef = plan.tasks.find((t: any) => t.taskId === taskId)
            if (!taskDef) continue

            const step: ExecutionStep = {
              taskId: taskDef.taskId,
              agentId: taskDef.agentId,
              description: taskDef.description,
              status: 'running',
              startedAt: new Date().toISOString(),
            }
            steps.push(step)
            send('task_start', { step })

            try {
              const steeringResult = await steer(
                taskDef.agentId,   // agentId
                1000,              // budgetTotal
                steps.length * 50, // budgetUsed (estimate)
                steps.length,      // step
                'PLAN' as Strategy, // lastStrategy
                null,              // lastCheckPassed
                0,                 // errorsConsecutive
              )
              step.strategy = steeringResult.strategy

              const ltlResult = await verifyEvent(
                'execute' as any,  // eventLabel (DiscreteState)
                'task_execution',  // eventType
                { taskId, agentId: taskDef.agentId }  // payload
              )
              step.ltlVerdict = ltlResult.verdict
              step.ltlViolations = ltlResult.violations.map((v) => `${v.ruleId}: ${v.reason}`)

              if (ltlResult.verdict === 'reject') {
                step.status = 'blocked'
                step.error = {
                  type: 'ltl_verification',
                  message: `LTL reject: ${step.ltlViolations.join('; ') || 'no details'}`,
                  phase: 'Verification & Taint',
                  recoverable: true,
                  suggestion: 'Modifica i parametri del task.',
                }
                errors.push(step.error)
                send('task_complete', { step })
                continue
              }

              // Execute task via LLM (with streaming)
              const zai = await ZAI.create()
              const execStream = await zai.chat.completions.create({
                messages: [
                  {
                    role: 'system',
                    content: `Sei l'agente ${taskDef.agentId} di un sistema agentico. Esegui il task assegnato in modo conciso (massimo 200 parole).`,
                  },
                  {
                    role: 'user',
                    content: `Task: ${taskDef.description}\nContesto: obiettivo globale = ${plan.goal}`,
                  },
                ],
                stream: true,
              })

              let result = ''
              let taskTokens = 0
              for await (const chunk of execStream) {
                if (abortController.signal.aborted) break
                const delta = chunk.choices?.[0]?.delta?.content || ''
                if (delta) {
                  result += delta
                  taskTokens++
                  if (taskTokens % 3 === 0) {
                    send('task_chunk', { taskId, partial: result.slice(-150) })
                  }
                }
              }

              // Record cost
              const inputTokens = Math.ceil((taskDef.description.length + plan.goal.length + 100) / 4)
              const outputTokens = Math.ceil(result.length / 4)
              await recordCostEntry({
                agentId: taskDef.agentId,
                model: 'zai-glm',
                phase: 'task_execution',
                tokensIn: inputTokens,
                tokensOut: outputTokens,
                cost: calculateCost('zai-glm', inputTokens, outputTokens),
              }).catch(() => {})

              step.result = result
              step.status = 'done'
              step.completedAt = new Date().toISOString()
              step.durationMs = Date.now() - new Date(step.startedAt!).getTime()
              send('task_complete', { step })
            } catch (e: any) {
              step.status = 'failed'
              step.error = {
                type: 'task_execution',
                message: e.message,
                phase: 'Cognitive Steering',
                recoverable: true,
                suggestion: 'Riprova con un task più semplice.',
              }
              step.completedAt = new Date().toISOString()
              step.durationMs = Date.now() - new Date(step.startedAt!).getTime()
              errors.push(step.error)
              send('task_complete', { step })
            }
          }
        }

        // === Phase 3: Reflection ===
        if (!abortController.signal.aborted) {
          send('reflection_start', {})
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
            send('reflection_complete', {
              reflection: {
                approved: reflection.approved,
                heuristic: reflection.heuristic?.trigger + ' → ' + reflection.heuristic?.action,
                reviewReason: reflection.reviewReason,
              },
            })
          } catch (e: any) {
            send('reflection_complete', {
              reflection: { approved: false, error: e.message },
            })
          }
        }

        // === Final ===
        const summary = {
          totalTasks: steps.length,
          completed: steps.filter((s) => s.status === 'done').length,
          failed: steps.filter((s) => s.status === 'failed').length,
          blocked: steps.filter((s) => s.status === 'blocked').length,
          durationMs: Date.now() - startedAt,
        }

        send('done', {
          ok: true,
          result: {
            planId,
            goal: plan.goal,
            steps,
            batches,
            summary,
            errors,
          },
        })
      } catch (e: any) {
        send('error', { error: { message: e.message, phase: 'unknown' } })
        send('done', { ok: false, error: e.message, errors })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
