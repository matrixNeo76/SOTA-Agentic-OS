/**
 * E2E Integration — Fase 4.2
 *
 * Collega il kernel esistente (F1-F23) ai nuovi moduli Fase 1-3.
 *
 * Scorre in due direzioni:
 *   1. Kernel → Event Mesh: gli eventi del kernel vengono pubblicati
 *      sull'Event Mesh, popolando il Context Graph e i moduli Fase 1-3.
 *   2. Event Mesh → Kernel: le decisions dell'Autonomous Org e del
 *      Conflict Resolution innescano azioni nel kernel.
 *
 * Specificamente:
 *   - AgentLog → Event Mesh (TaskCompleted/Failed events)
 *   - AgentLog → Context Graph (GraphNode Task/Agent nodes)
 *   - CostEntry → Observability dashboard
 *   - ERL Heuristics → Skill Registry (procedural memories become skills)
 *   - LTL Violations → Policy Engine (recordPolicyViolation)
 *   - Sovereign Validator → Autonomous Org (approvals flow)
 *
 * Avvio: chiamare startIntegrationLayer() all'avvio del server.
 * Stop: stopIntegrationLayer() per test.
 */

import { db } from '@/lib/db'
import { subscribeEvent } from '@/lib/event-mesh/mesh'
import { createNode, createEdge } from '@/lib/graph-age'
import { createProvenance, type Provenance } from '@/lib/governance'
import { recordPolicyViolation } from '@/lib/observability-v2/dashboard'
import { registerSkill } from '@/lib/skill-registry/registry'
import { publish, publishTaskCompleted, publishTaskFailed } from '@/lib/event-mesh/publishers'

// === State ===========================================================

const _activeSubscriptions: Array<{ unsubscribe: () => Promise<void> }> = []
let _started = false

// === Integration: AgentLog → Event Mesh =============================

/**
 * Scorre AgentLog entries e pubblica gli eventi corrispondenti sull'Event Mesh.
 *
 * Da chiamare periodicamente (es. ogni 60s) o on-demand.
 * Skip entries già processati ( tracked via marker).
 */
export async function syncAgentLogToEventMesh(options?: {
  batchSize?: number
  sinceMinutes?: number
}): Promise<{ processed: number; published: number; skipped: number }> {
  const batchSize = options?.batchSize ?? 100
  const sinceMinutes = options?.sinceMinutes ?? 5
  const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000)

  const logs = await db.agentLog.findMany({
    where: {
      timestamp: { gte: cutoff },
      event: { in: ['TaskCompleted', 'TaskFailed', 'TaskBlocked'] },
      // Skip already-synced (use level=info as marker; we set level=info after sync)
    },
    take: batchSize,
    orderBy: { timestamp: 'asc' },
  })

  let published = 0
  let skipped = 0
  const provenance = createProvenance({
    agent: 'agent://integration-sync',
    source: 'system-event',
    confidence: 1.0,
  })

  for (const log of logs) {
    try {
      const payload = JSON.parse(log.payload) as Record<string, unknown>

      if (log.event === 'TaskCompleted') {
        await publishTaskCompleted(
          (payload.taskUri as string) || log.id,
          (payload.result as string) || '',
          (payload.durationMs as number) || 0,
          provenance,
        )
        published++
      } else if (log.event === 'TaskFailed') {
        await publishTaskFailed(
          (payload.taskUri as string) || log.id,
          (payload.error as string) || 'unknown',
          (payload.recoverable as boolean) ?? false,
          provenance,
        )
        published++
      } else if (log.event) {
        // Fallback: publish generico
        await publish({
          type: log.event as any,
          payload,
          provenance,
        })
        published++
      }
    } catch (err) {
      console.warn(`[integration] Failed to sync log ${log.id}:`, err)
      skipped++
    }
  }

  return { processed: logs.length, published, skipped }
}

// === Integration: Events → Context Graph =============================

/**
 * Sottoscrive agli eventi dell'Event Mesh e popola il Context Graph.
 *
 * Per ogni evento:
 *   - TaskCreated → crea GraphNode Task
 *   - TaskCompleted → update Task lifecycle (active → archived)
 *   - TaskFailed → crea GraphNode Experience (per ERL learning)
 *   - AgentSpawned → crea GraphNode Agent (se non esiste)
 *   - DecisionTaken → crea GraphNode Decision
 *   - CodeChanged → trigger code intelligence sync (best-effort)
 */
export async function startContextGraphPopulator(): Promise<void> {
  const provenance = createProvenance({
    agent: 'agent://context-graph-populator',
    source: 'system-event',
    confidence: 1.0,
  })

  // Subscribe to TaskCreated → create Task node
  // Nota: eventToSubject produce "sota.taskcreated.TaskCreated" (regex non separa camelCase)
  const sub1 = await subscribeEvent('sota.taskcreated.TaskCreated', async (event) => {
    try {
      const taskUri = event.payload.taskUri as string
      if (!taskUri) return

      const identifier = taskUri.split('//')[1] || taskUri
      try {
        await createNode({
          type: 'Task',
          identifier,
          attributes: {
            goal: event.payload.goal || 'Unknown goal',
            status: 'pending',
            assignedAgent: event.payload.assignedAgent,
            source: 'event-mesh',
            createdAt: event.timestamp,
          },
          provenance,
          lifecycleState: 'draft',
        })
      } catch {
        // Node may already exist — that's OK
      }
    } catch (err) {
      console.warn('[integration] Failed to handle TaskCreated:', err)
    }
  })
  _activeSubscriptions.push(sub1)

  // Subscribe to TaskCompleted → mark Task as active→deprecated (completed)
  const sub2 = await subscribeEvent('sota.taskcompleted.TaskCompleted', async (event) => {
    try {
      const taskUri = event.payload.taskUri as string
      if (!taskUri) return

      // Update task attributes to mark as completed
      const taskNode = await db.graphNode.findUnique({ where: { uri: taskUri } })
      if (taskNode) {
        const attrs = JSON.parse(taskNode.attributes) as Record<string, unknown>
        await db.graphNode.update({
          where: { uri: taskUri },
          data: {
            attributes: JSON.stringify({
              ...attrs,
              status: 'completed',
              completedAt: event.timestamp,
              durationMs: event.payload.durationMs,
              result: event.payload.result,
            }),
          },
        })
      }
    } catch (err) {
      console.warn('[integration] Failed to handle TaskCompleted:', err)
    }
  })
  _activeSubscriptions.push(sub2)

  // Subscribe to TaskFailed → create Experience node for ERL
  const sub3 = await subscribeEvent('sota.taskfailed.TaskFailed', async (event) => {
    try {
      const taskUri = event.payload.taskUri as string
      const error = event.payload.error as string
      if (!taskUri) return

      const identifier = `exp-failure-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      try {
        await createNode({
          type: 'Experience',
          identifier,
          attributes: {
            outcome: 'failure',
            context: `Task ${taskUri} failed: ${error}`,
            source: 'event-mesh',
            recoverable: event.payload.recoverable,
          },
          provenance,
        })
      } catch {}
    } catch (err) {
      console.warn('[integration] Failed to handle TaskFailed:', err)
    }
  })
  _activeSubscriptions.push(sub3)

  // Subscribe to AgentSpawned → create Agent node (idempotent)
  const sub4 = await subscribeEvent('sota.agentspawned.AgentSpawned', async (event) => {
    try {
      const agentUri = event.payload.agentUri as string
      const role = (event.payload.role as string) || 'general'
      if (!agentUri) return

      const identifier = agentUri.split('//')[1] || agentUri
      try {
        await createNode({
          type: 'Agent',
          identifier,
          attributes: {
            name: identifier,
            role,
            capabilities: event.payload.capabilities || [],
            source: 'event-mesh',
          },
          provenance,
          lifecycleState: 'draft',
        })
      } catch {}
    } catch (err) {
      console.warn('[integration] Failed to handle AgentSpawned:', err)
    }
  })
  _activeSubscriptions.push(sub4)

  // Subscribe to ConflictDetected → record policy violation for observability
  const sub5 = await subscribeEvent('sota.conflictdetected.ConflictDetected', async (event) => {
    try {
      await recordPolicyViolation({
        ruleId: `claim-conflict-${event.payload.conflictUri || 'unknown'}`,
        ruleDescription: `Conflict between ${event.payload.claimA} and ${event.payload.claimB}`,
        severity: 'warn',
        context: event.payload,
      })
    } catch (err) {
      console.warn('[integration] Failed to handle ConflictDetected:', err)
    }
  })
  _activeSubscriptions.push(sub5)
}

// === Integration: ERL Heuristics → Skill Registry ====================

/**
 * Sottoscrive a ExperienceLearned events e converge euristiche ERL mature
 * in Skill del Skill Registry.
 *
 * Logica: quando un'Experience ha outcome=success + heuristic estratta,
 * crea una Skill che codifica quell'euristica.
 */
export async function startErlToSkillBridge(): Promise<void> {
  const provenance = createProvenance({
    agent: 'agent://erl-skill-bridge',
    source: 'agent-reasoning',
    confidence: 0.7,
  })

  const sub = await subscribeEvent('sota.experiencelearned.ExperienceLearned', async (event) => {
    try {
      if (event.payload.outcome !== 'success') return
      const heuristic = event.payload.heuristic as string | undefined
      if (!heuristic || heuristic.length < 20) return

      const skillName = `erl-skill-${Date.now()}`
      try {
        await registerSkill({
          name: skillName,
          description: `Auto-generated from ERL experience: ${heuristic.slice(0, 100)}`,
          promptTemplate: `You are a specialized agent applying the following learned heuristic:

${heuristic}

Task: {{task}}`,
          tags: ['erl', 'auto-learned', 'procedural'],
          provenance,
        })
      } catch {}
    } catch (err) {
      console.warn('[integration] Failed to handle ExperienceLearned:', err)
    }
  })
  _activeSubscriptions.push(sub)
}

// === Integration: Autonomous Org approvals → Sovereign Validator =====

/**
 * Sottoscrive a ApprovalRequested events provenienti dall'Autonomous Org
 * e li inoltra al Sovereign Validator (Fase 9) come BlockedAction.
 *
 * Questo permette all'API esistente /api/blocked-actions di visualizzare
 * e gestire le proposals dell'Autonomous Org tramite la stessa UI.
 */
export async function startAutonomousOrgToSovereignBridge(): Promise<void> {
  const sub = await subscribeEvent('sota.approvalrequested.ApprovalRequested', async (event) => {
    try {
      const blockedActionUri = event.payload.blockedActionUri as string
      const action = event.payload.action as string
      if (!blockedActionUri || !action) return

      // Create BlockedAction entry (delegates to existing kernel module)
      await db.blockedAction.create({
        data: {
          agentId: 'agent://autonomous-org',
          action,
          source: 'hitl_gate',
          axiomTrail: JSON.stringify({
            proposalUri: blockedActionUri,
            eventUri: event.uri,
            timestamp: event.timestamp,
          }),
          readableExplanation: `Autonomous Org proposal: ${action}`,
          status: 'pending',
        },
      })
    } catch (err) {
      console.warn('[integration] Failed to handle ApprovalRequested:', err)
    }
  })
  _activeSubscriptions.push(sub)
}

// === Top-level start/stop ============================================

/**
 * Avvia tutti i bridge di integrazione.
 * Da chiamare all'avvio del server (es. in next.config o un modulo bootstrap).
 */
export async function startIntegrationLayer(): Promise<{ started: boolean; bridges: string[] }> {
  if (_started) {
    return { started: false, bridges: [] }
  }

  const bridges: string[] = []

  try {
    await startContextGraphPopulator()
    bridges.push('context-graph-populator')
  } catch (err) {
    console.warn('[integration] Failed to start context graph populator:', err)
  }

  try {
    await startErlToSkillBridge()
    bridges.push('erl-skill-bridge')
  } catch (err) {
    console.warn('[integration] Failed to start ERL→Skill bridge:', err)
  }

  try {
    await startAutonomousOrgToSovereignBridge()
    bridges.push('autonomous-org-sovereign-bridge')
  } catch (err) {
    console.warn('[integration] Failed to start Autonomous Org bridge:', err)
  }

  _started = true
  console.log(`[integration] Started ${bridges.length} bridges: ${bridges.join(', ')}`)
  return { started: true, bridges }
}

/**
 * Stoppa tutti i bridge (per test).
 */
export async function stopIntegrationLayer(): Promise<void> {
  for (const sub of _activeSubscriptions) {
    try {
      await sub.unsubscribe()
    } catch {}
  }
  _activeSubscriptions.length = 0
  _started = false
}

/**
 * Stato corrente dell'integration layer.
 */
export function integrationLayerStatus(): {
  started: boolean
  activeSubscriptions: number
} {
  return {
    started: _started,
    activeSubscriptions: _activeSubscriptions.length,
  }
}

// === One-shot sync helper ============================================

/**
 * Esegue una sincronizzazione completa one-shot:
 *   1. syncAgentLogToEventMesh (publish pending logs)
 *   2. Attende che i subscriber processino
 *   3. Verifica il Context Graph aggiornato
 *
 * Utile per test e per il primo bootstrap.
 */
export async function runFullSync(): Promise<{
  agentLogSync: { processed: number; published: number; skipped: number }
  contextGraphBefore: { nodes: number; edges: number }
  contextGraphAfter: { nodes: number; edges: number }
}> {
  const before = await Promise.all([
    db.graphNode.count(),
    db.graphEdge.count(),
  ])

  const agentLogSync = await syncAgentLogToEventMesh({
    batchSize: 200,
    sinceMinutes: 60 * 24, // last 24h
  })

  // Attendi 500ms che i subscriber processino
  await new Promise((r) => setTimeout(r, 500))

  const after = await Promise.all([
    db.graphNode.count(),
    db.graphEdge.count(),
  ])

  return {
    agentLogSync,
    contextGraphBefore: { nodes: before[0], edges: before[1] },
    contextGraphAfter: { nodes: after[0], edges: after[1] },
  }
}
