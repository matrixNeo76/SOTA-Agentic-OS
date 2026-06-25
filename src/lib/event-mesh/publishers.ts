/**
 * Event publishers — Fase 2.1
 *
 * Helper tipizzati per pubblicare gli eventi più comuni del kernel.
 * I payload sono allineati a EVENT_PAYLOAD_SCHEMAS in event-taxonomy.ts.
 */

import { createEvent, type EventType } from '@/lib/governance'
import { publishEvent } from './mesh'
import type { Provenance } from '@/lib/governance'

interface PublishParams {
  type: EventType
  payload: Record<string, unknown>
  provenance: Provenance
  subject?: string
}

export async function publish(params: PublishParams) {
  const event = createEvent({
    type: params.type,
    payload: params.payload,
    provenance: params.provenance,
  })
  await publishEvent(event, params.subject)
  return event
}

// === Task lifecycle =================================================

export async function publishTaskCreated(
  taskUri: string,
  goal: string,
  assignedAgent: string,
  provenance: Provenance,
) {
  return publish({
    type: 'TaskCreated',
    payload: { taskUri, goal, assignedAgent },
    provenance,
  })
}

export async function publishTaskStarted(taskUri: string, agentUri: string, provenance: Provenance) {
  // TaskStarted non ha schema esplicito in EVENT_PAYLOAD_SCHEMAS → payload libero ma tipizzato
  return publish({
    type: 'TaskStarted',
    payload: { taskUri, agentUri, startedAt: new Date().toISOString() },
    provenance,
  })
}

export async function publishTaskCompleted(
  taskUri: string,
  result: string | undefined,
  durationMs: number,
  provenance: Provenance,
) {
  return publish({
    type: 'TaskCompleted',
    payload: { taskUri, result, durationMs },
    provenance,
  })
}

export async function publishTaskFailed(
  taskUri: string,
  error: string,
  recoverable: boolean,
  provenance: Provenance,
) {
  return publish({
    type: 'TaskFailed',
    payload: { taskUri, error, recoverable },
    provenance,
  })
}

export async function publishTaskBlocked(
  taskUri: string,
  reason: string,
  source: 'ltl' | 'taint' | 'normative' | 'hitl_gate',
  provenance: Provenance,
) {
  return publish({
    type: 'TaskBlocked',
    payload: { taskUri, reason, source },
    provenance,
  })
}

// === Knowledge events (Fase 2.8 conflict resolution) ================

export async function publishClaimCreated(
  claimUri: string,
  statement: string,
  confidence: number,
  provenance: Provenance,
) {
  return publish({
    type: 'ClaimCreated',
    payload: { claimUri, statement, confidence },
    provenance,
  })
}

export async function publishConflictDetected(
  conflictUri: string,
  claimA: string,
  claimB: string,
  provenance: Provenance,
) {
  return publish({
    type: 'ConflictDetected',
    payload: { conflictUri, claimA, claimB },
    provenance,
  })
}

export async function publishConflictResolved(
  conflictUri: string,
  resolution: string,
  decisionUri: string,
  provenance: Provenance,
) {
  return publish({
    type: 'ConflictResolved',
    payload: { conflictUri, resolution, decisionUri },
    provenance,
  })
}

// === Knowledge extraction (Fase 2.2) ================================

export async function publishDocumentUploaded(
  documentUri: string,
  mimeType: string,
  sizeBytes: number,
  provenance: Provenance,
) {
  return publish({
    type: 'DocumentUploaded',
    payload: { documentUri, mimeType, sizeBytes },
    provenance,
  })
}

// === Approval gates (Fase 2.6 governance) ===========================

export async function publishApprovalRequested(
  blockedActionUri: string,
  action: string,
  source: string,
  provenance: Provenance,
) {
  return publish({
    type: 'ApprovalRequested',
    payload: { blockedActionUri, action, source },
    provenance,
  })
}

export async function publishApprovalGranted(
  blockedActionUri: string,
  choice: 'approved' | 'modified' | 'downgraded' | 'rejected',
  resolvedBy: string,
  provenance: Provenance,
) {
  return publish({
    type: 'ApprovalGranted',
    payload: { blockedActionUri, choice, resolvedBy },
    provenance,
  })
}

// === Agent lifecycle (Fase 2.1) =====================================

export async function publishAgentSpawned(
  agentUri: string,
  role: string,
  capabilities: string[],
  provenance: Provenance,
) {
  return publish({
    type: 'AgentSpawned',
    payload: { agentUri, role, capabilities },
    provenance,
  })
}

export async function publishAgentStopped(agentUri: string, reason: string, provenance: Provenance) {
  return publish({
    type: 'AgentStopped',
    payload: { agentUri, reason },
    provenance,
  })
}

// === Code Intelligence (Fase 2.4) ===================================

export async function publishCodeChanged(
  repo: string,
  commit: string,
  filesChanged: string[],
  provenance: Provenance,
) {
  return publish({
    type: 'CodeChanged',
    payload: { repo, commit, filesChanged: filesChanged.length },
    provenance,
  })
}
