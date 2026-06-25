/**
 * A2A (Agent-to-Agent) — IO-2
 *
 * Implementa il protocollo A2A (Agent-to-Agent) per delega agente↔agente.
 *
 * Componenti:
 *   1. Agent Card su /.well-known/agent.json — identità, capability, endpoint, auth
 *   2. Task lifecycle asincrono: submit → working → input-required → completed/failed
 *      Mappato sull'executor durevole (WS1): i task A2A diventano Run
 *   3. Delega bidirezionale:
 *      - Ricevere: agenti esterni inviano task all'OS via POST /api/a2a/tasks
 *      - Inviare: l'OS delega a agenti esterni registrati nella mesh
 *
 * Specifica A2A (Google/Linux Foundation):
 *   https://github.com/google/A2A
 *
 * Formato Agent Card:
 * {
 *   "id": "sota-agentic-os",
 *   "name": "SOTA Agentic OS",
 *   "description": "Cognitive Operating System with durable execution, memory, and governance",
 *   "version": "1.0.0",
 *   "capabilities": {
 *     "streaming": true,
 *     "pushNotifications": false,
 *     "stateTransition": true
 *   },
 *   "skills": [...],
 *   "endpoints": {
 *     "tasks": "/api/a2a/tasks",
 *     "tasksSubscribe": "/api/a2a/tasks/subscribe"
 *   },
 *   "authentication": {
 *     "schemes": ["bearer"],
 *     "credentials": "API key with scope 'exec' — see /api/admin/api-keys"
 *   }
 * }
 */

import { db } from '@/lib/db'
import { startExecution, executePlan, type ExecutorResult } from '@/lib/runtime/executor'
import { createProvenance } from '@/lib/governance'

// === Tipi ============================================================

export interface AgentCard {
  id: string
  name: string
  description: string
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransition: boolean
  }
  skills: Array<{
    id: string
    name: string
    description: string
  }>
  endpoints: {
    tasks: string
    tasksSubscribe: string
  }
  authentication: {
    schemes: string[]
    credentials: string
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface A2ATask {
  id: string
  status: A2ATaskStatus
  message?: A2AMessage
  result?: A2ATaskResult
  artifacts?: A2AArtifact[]
  createdAt: string
  updatedAt: string
  planId?: string // link al piano DynAMO interno
  jobId?: string // link al JobRecord
}

export interface A2AMessage {
  role: 'user' | 'agent'
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'data'; data: Record<string, unknown> }
    | { type: 'file'; uri: string; mimeType: string }
  >
}

export interface A2ATaskResult {
  role: 'agent'
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'data'; data: Record<string, unknown> }
  >
}

export interface A2AArtifact {
  id: string
  name: string
  mimeType: string
  content: string
}

export interface A2ATaskSubmitRequest {
  message: A2AMessage
  sessionId?: string
  metadata?: Record<string, unknown>
}

// === Agent Card ======================================================

/**
 * Genera la Agent Card per l'OS.
 * Pubblicata su /.well-known/agent.json per discovery da parte di agenti esterni.
 */
export async function getAgentCard(): Promise<AgentCard> {
  // Recupera skill attive per popolare la card
  let skills: Array<{ id: string; name: string; description: string }> = []
  try {
    const skillNodes = await db.graphNode.findMany({
      where: { entityType: 'Skill', lifecycleState: 'active' },
      take: 20,
    })
    skills = skillNodes.map((s) => {
      const attrs = JSON.parse(s.attributes) as Record<string, unknown>
      return {
        id: s.uri,
        name: (attrs.name as string) || s.uri,
        description: (attrs.description as string) || '',
      }
    })
  } catch {}

  return {
    id: 'sota-agentic-os',
    name: 'SOTA Agentic OS',
    description: 'Cognitive Operating System with durable execution, persistent memory (Context Graph), governance (LTL + Sovereign HITL), and autonomous organization',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransition: true,
    },
    skills,
    endpoints: {
      tasks: '/api/a2a/tasks',
      tasksSubscribe: '/api/a2a/tasks/subscribe',
    },
    authentication: {
      schemes: ['bearer'],
      credentials: 'API key with scope exec — create at /api/admin/api-keys. Format: Bearer sak_<keyId>_<secret>',
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
  }
}

// === Task Lifecycle ==================================================

/**
 * Submit: riceve un task da un agente esterno e lo avvia come Run.
 *
 * Flusso:
 *   1. Parse del messaggio A2A (estrai il task text)
 *   2. Avvia startExecution({ task, async: true }) → crea piano + accoda su JobRecord
 *   3. Crea record A2ATask su DB (GraphNode tipo 'Task' con attributi A2A)
 *   4. Ritorna task con status 'working'
 */
export async function submitTask(request: A2ATaskSubmitRequest): Promise<A2ATask> {
  // Estrai il testo del task dal messaggio
  const textPart = request.message.parts.find((p) => p.type === 'text')
  if (!textPart || textPart.type !== 'text') {
    throw new Error('A2A task must include at least one text part')
  }

  const taskText = textPart.text
  const provenance = createProvenance({
    agent: 'agent://a2a-external',
    source: 'external-api',
    confidence: 0.8,
  })

  // Avvia l'executor durevole (async mode)
  const result = await startExecution({
    task: taskText,
    async: true,
  })

  if ('error' in result) {
    throw new Error(result.error)
  }

  // Per ora l'A2A task è memorizzato come attributi del piano
  const taskId = `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // result può essere { result: ExecutorResult } (sync) o { planId, jobId, async: true } (async)
  const planId = 'planId' in result ? result.planId : result.result.planId
  const jobId = 'jobId' in result ? result.jobId : undefined

  const task: A2ATask = {
    id: taskId,
    status: 'working',
    message: request.message,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    planId,
    ...(jobId && { jobId }),
  }

  // Persisti come AgentLog per audit
  await db.agentLog.create({
    data: {
      agentId: 'agent://a2a-external',
      phase: 'a2a',
      event: 'task_submitted',
      payload: JSON.stringify({ taskId, planId, jobId, taskText }),
      level: 'info',
    },
  }).catch(() => {})

  return task
}

/**
 * Get: recupera lo stato di un task A2A.
 * Mappa lo stato del piano DynAMO → stato A2A.
 */
export async function getTask(taskId: string): Promise<A2ATask | null> {
  // Cerca nel log il task
  const log = await db.agentLog.findFirst({
    where: { phase: 'a2a', event: 'task_submitted', payload: { contains: taskId } },
    orderBy: { timestamp: 'desc' },
  })

  if (!log) return null

  const payload = JSON.parse(log.payload) as { taskId: string; planId: string; jobSet?: string; taskText: string }
  const planId = payload.planId

  // Recupera lo stato del piano
  const plan = await db.agentPlan.findUnique({
    where: { id: planId },
    include: { tasks: { select: { status: true } } },
  })

  if (!plan) {
    return {
      id: taskId,
      status: 'failed',
      createdAt: log.timestamp.toISOString(),
      updatedAt: new Date().toISOString(),
      planId,
    }
  }

  // Mappa stato piano → stato A2A
  const a2aStatus = mapPlanStatusToA2A(plan.status, plan.tasks)

  // Estrai risultato se completato
  let result: A2ATaskResult | undefined
  let artifacts: A2AArtifact[] | undefined

  if (a2aStatus === 'completed') {
    const completedTasks = await db.planTask.findMany({
      where: { planId, status: 'done' },
      select: { taskId: true, result: true },
    })

    const resultText = completedTasks
      .map((t) => `[${t.taskId}] ${t.result?.slice(0, 500) || 'completed'}`)
      .join('\n\n')

    result = {
      role: 'agent',
      parts: [{ type: 'text', text: resultText }],
    }

    // Se ci sono tracce, le includi come artifact
    const traces = await db.executionTrace.findMany({
      where: { workflowId: planId },
      take: 10,
    })
    if (traces.length > 0) {
      artifacts = traces.map((t, i) => ({
        id: `artifact-${i}`,
        name: t.traceLabel,
        mimeType: 'application/json',
        content: JSON.stringify({
          states: JSON.parse(t.statesJson),
          actions: JSON.parse(t.actionsJson),
          outcome: t.outcome,
        }, null, 2),
      }))
    }
  }

  return {
    id: taskId,
    status: a2aStatus,
    message: {
      role: 'user',
      parts: [{ type: 'text', text: payload.taskText }],
    },
    result,
    artifacts,
    createdAt: log.timestamp.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    planId,
  }
}

/**
 * Cancel: annulla un task A2A.
 */
export async function cancelTask(taskId: string): Promise<{ canceled: boolean }> {
  const task = await getTask(taskId)
  if (!task || !task.planId) return { canceled: false }

  // Marca il piano come canceled
  await db.agentPlan.update({
    where: { id: task.planId },
    data: { status: 'failed' },
  })

  // Marca i task running come failed
  await db.planTask.updateMany({
    where: { planId: task.planId, status: 'running' },
    data: { status: 'failed', finishedAt: new Date() },
  })

  await db.agentLog.create({
    data: {
      agentId: 'agent://a2a-external',
      phase: 'a2a',
      event: 'task_canceled',
      payload: JSON.stringify({ taskId, planId: task.planId }),
      level: 'warn',
    },
  }).catch(() => {})

  return { canceled: true }
}

// === Helpers =========================================================

function mapPlanStatusToA2A(
  planStatus: string,
  tasks: Array<{ status: string }>,
): A2ATaskStatus {
  if (planStatus === 'completed') return 'completed'
  if (planStatus === 'failed') return 'failed'

  // Check if any task is blocked (needs input)
  const hasBlocked = tasks.some((t) => t.status === 'blocked')
  if (hasBlocked) return 'input-required'

  // Check if any task is running
  const hasRunning = tasks.some((t) => t.status === 'running')
  if (hasRunning) return 'working'

  // Default
  return 'working'
}
