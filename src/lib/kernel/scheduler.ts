/**
 * DynAMO + Topological Scheduler (Fase 2)
 *
 * 1) Forza l'LLM a produrre un piano JSON-Schema-validato
 * 2) Converte il piano in un DAG
 * 3) Schedula task indipendenti in parallelo (topological sort + batch)
 */
import { db } from '@/lib/db'

export type PlanTaskSpec = {
  taskId: string
  agentId: string
  description: string
  dependencies: string[]
}

export type AgentPlanSpec = {
  goal: string
  tasks: PlanTaskSpec[]
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['goal', 'tasks'],
  properties: {
    goal: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskId', 'agentId', 'description', 'dependencies'],
        properties: {
          taskId: { type: 'string' },
          agentId: { type: 'string' },
          description: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

/**
 * Validazione JSON-Schema minimale (solo campi critici).
 */
export function validatePlan(plan: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['Piano non è un object'] }
  }
  if (typeof plan.goal !== 'string' || !plan.goal.trim()) {
    errors.push('Campo goal mancante o non stringa')
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    errors.push('Campo tasks mancante o vuoto')
    return { valid: false, errors }
  }
  const taskIds = new Set<string>()
  for (const t of plan.tasks) {
    if (!t.taskId) errors.push(`Task senza taskId`)
    else taskIds.add(t.taskId)
    if (!t.agentId) errors.push(`Task ${t.taskId}: agentId mancante`)
    if (!t.description) errors.push(`Task ${t.taskId}: description mancante`)
    if (!Array.isArray(t.dependencies)) errors.push(`Task ${t.taskId}: dependencies non array`)
  }
  // verifica dipendenze riferiscano a task esistenti
  for (const t of plan.tasks) {
    for (const dep of t.dependencies || []) {
      if (!taskIds.has(dep)) errors.push(`Task ${t.taskId}: dipendenza sconosciuta ${dep}`)
    }
  }
  // verifica aciclicità
  if (!isAcyclic(plan.tasks)) errors.push('Il grafo delle dipendenze contiene un ciclo')
  return { valid: errors.length === 0, errors }
}

function isAcyclic(tasks: PlanTaskSpec[]): boolean {
  const adj = new Map<string, string[]>()
  for (const t of tasks) adj.set(t.taskId, t.dependencies || [])
  const visited = new Map<string, 0 | 1 | 2>() // 0=unvisited,1=in-progress,2=done
  function dfs(node: string): boolean {
    const s = visited.get(node) || 0
    if (s === 1) return false // ciclo
    if (s === 2) return true
    visited.set(node, 1)
    for (const d of adj.get(node) || []) {
      if (!dfs(d)) return false
    }
    visited.set(node, 2)
    return true
  }
  for (const t of tasks) {
    if ((visited.get(t.taskId) || 0) === 0 && !dfs(t.taskId)) return false
  }
  return true
}

/**
 * Schedulazione topologica: restituisce batch di task pronti in parallelo.
 * Ogni batch contiene task con tutte le dipendenze già completate.
 */
export function topologicalBatches(tasks: PlanTaskSpec[]): string[][] {
  const remaining = new Map<string, PlanTaskSpec>()
  for (const t of tasks) remaining.set(t.taskId, t)
  const done = new Set<string>()
  const batches: string[][] = []

  while (remaining.size > 0) {
    const ready: string[] = []
    for (const [id, t] of remaining) {
      if (t.dependencies.every((d) => done.has(d))) ready.push(id)
    }
    if (ready.length === 0) {
      // ciclo inatteso (dovrebbe essere già stato validato)
      break
    }
    // ordina per priorità (qui: task con più dipendenti prima = critical path)
    ready.sort((a, b) => {
      const dependentsA = tasks.filter((t) => t.dependencies.includes(a)).length
      const dependentsB = tasks.filter((t) => t.dependencies.includes(b)).length
      return dependentsB - dependentsA
    })
    batches.push(ready)
    for (const id of ready) {
      done.add(id)
      remaining.delete(id)
    }
  }
  return batches
}

/**
 * Persiste un piano e i suoi task nel DB.
 */
export async function persistPlan(spec: AgentPlanSpec): Promise<string> {
  const validation = validatePlan(spec)
  if (!validation.valid) {
    throw new Error(`Piano non valido: ${validation.errors.join(', ')}`)
  }
  const plan = await db.agentPlan.create({
    data: {
      taskGoal: spec.goal,
      planJson: JSON.stringify(spec),
      dagJson: JSON.stringify(topologicalBatches(spec.tasks)),
      status: 'scheduled',
      agentCount: new Set(spec.tasks.map((t) => t.agentId)).size,
    },
  })
  for (const t of spec.tasks) {
    await db.planTask.create({
      data: {
        planId: plan.id,
        taskId: t.taskId,
        agentId: t.agentId,
        description: t.description,
        dependencies: JSON.stringify(t.dependencies),
        status: 'ready',
      },
    })
  }
  return plan.id
}

export { PLAN_SCHEMA }
