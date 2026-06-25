/**
 * Event Taxonomy — Fase 0.5.4
 *
 * Vocabolario eventi chiuso e versionato.
 * Base per l'Event Mesh di Fase 2 (NATS JetStream).
 *
 * Definirlo ora evita divergenze di naming tra produttori e consumatori.
 * Ogni evento ha un tipo, un payload schema, e metadati di provenance.
 */

import { z } from 'zod'
import { provenanceSchema, type Provenance } from './provenance-schema'

// === Event Types (chiuso, versionato) ===
export const EVENT_TYPES = [
  // Task lifecycle
  'TaskCreated',
  'TaskStarted',
  'TaskCompleted',
  'TaskFailed',
  'TaskBlocked',
  'TaskCancelled',

  // Agent lifecycle
  'AgentSpawned',
  'AgentStopped',
  'AgentUpgraded',

  // Decision & Governance
  'DecisionTaken',
  'ApprovalRequested',
  'ApprovalGranted',
  'ApprovalRejected',

  // Knowledge
  'ClaimCreated',
  'EvidenceAdded',
  'ConflictDetected',
  'ConflictResolved',
  'ExperienceLearned',
  'HeuristicExtracted',

  // Workflow
  'WorkflowStarted',
  'WorkflowCompleted',
  'WorkflowFailed',

  // Tool & Skill
  'ToolInvoked',
  'ToolResult',
  'SkillExecuted',
  'SkillCreated',

  // System
  'CheckpointSaved',
  'CheckpointRestored',
  'RollbackExecuted',
  'MemoryConsolidated',
  'GarbageCollected',

  // Document (Fase 2)
  'DocumentUploaded',
  'DocumentParsed',
  'CodeChanged',
] as const

export type EventType = typeof EVENT_TYPES[number]

// === Event Schema ===
export const eventSchema = z.object({
  // Identità
  id: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  uri: z.string().min(1), // event://<type>/<uuid>

  // Payload (tipizzato per tipo, ma flessibile)
  payload: z.record(z.string(), z.unknown()),

  // Provenance (obbligatorio — Fase 0.5.3)
  provenance: provenanceSchema,

  // Target (entità coinvolta)
  targetUri: z.string().optional(), // URI dell'entità principale

  // Correlazione (per tracciare catene di eventi)
  correlationId: z.string().optional(),
  parentEventUri: z.string().optional(),

  // Timestamp
  timestamp: z.string().datetime(),

  // Versione del vocabolario (per backward compat)
  schemaVersion: z.literal(1).default(1),
})

export type SystemEvent = z.infer<typeof eventSchema>

// === Event Payload Schemas (per tipo) ===
export const EVENT_PAYLOAD_SCHEMAS: Partial<Record<EventType, z.ZodSchema>> = {
  TaskCreated: z.object({
    taskUri: z.string(),
    goal: z.string(),
    assignedAgent: z.string(),
  }),
  TaskCompleted: z.object({
    taskUri: z.string(),
    durationMs: z.number(),
    result: z.string().optional(),
  }),
  TaskFailed: z.object({
    taskUri: z.string(),
    error: z.string(),
    recoverable: z.boolean(),
  }),
  TaskBlocked: z.object({
    taskUri: z.string(),
    reason: z.string(),
    source: z.string(), // ltl, taint, normative, hitl_gate
  }),
  AgentSpawned: z.object({
    agentUri: z.string(),
    role: z.string(),
    capabilities: z.array(z.string()),
  }),
  AgentStopped: z.object({
    agentUri: z.string(),
    reason: z.string(),
  }),
  DecisionTaken: z.object({
    decisionUri: z.string(),
    rationale: z.string(),
    decidedBy: z.string(),
    confidence: z.number(),
  }),
  ApprovalRequested: z.object({
    blockedActionUri: z.string(),
    action: z.string(),
    source: z.string(),
  }),
  ApprovalGranted: z.object({
    blockedActionUri: z.string(),
    choice: z.enum(['approved', 'modified', 'downgraded', 'rejected']),
    resolvedBy: z.string(),
  }),
  ClaimCreated: z.object({
    claimUri: z.string(),
    statement: z.string(),
    confidence: z.number(),
  }),
  ConflictDetected: z.object({
    conflictUri: z.string(),
    claimA: z.string(),
    claimB: z.string(),
  }),
  ConflictResolved: z.object({
    conflictUri: z.string(),
    resolution: z.string(),
    decisionUri: z.string(),
  }),
  ExperienceLearned: z.object({
    experienceUri: z.string(),
    outcome: z.enum(['success', 'failure', 'partial']),
    heuristic: z.string().optional(),
  }),
  ToolInvoked: z.object({
    toolUri: z.string(),
    toolId: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  ToolResult: z.object({
    toolUri: z.string(),
    success: z.boolean(),
    output: z.unknown().optional(),
    durationMs: z.number(),
  }),
  SkillExecuted: z.object({
    skillUri: z.string(),
    skillName: z.string(),
    durationMs: z.number(),
    success: z.boolean(),
  }),
  CheckpointSaved: z.object({
    checkpointId: z.string(),
    state: z.record(z.string(), z.unknown()),
  }),
  CheckpointRestored: z.object({
    checkpointId: z.string(),
  }),
  RollbackExecuted: z.object({
    fromCheckpoint: z.string(),
    toCheckpoint: z.string(),
  }),
  DocumentUploaded: z.object({
    documentUri: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  }),
  CodeChanged: z.object({
    repo: z.string(),
    commit: z.string(),
    filesChanged: z.number(),
  }),
}

// === Helper: create event ===
export function createEvent(params: {
  type: EventType
  payload: Record<string, unknown>
  provenance: Provenance
  targetUri?: string
  correlationId?: string
  parentEventUri?: string
}): SystemEvent {
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const type = params.type
  return {
    id,
    type,
    uri: `event://${type}/${id}`,
    payload: params.payload,
    provenance: params.provenance,
    targetUri: params.targetUri,
    correlationId: params.correlationId,
    parentEventUri: params.parentEventUri,
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
  }
}

// === Helper: validate event ===
export function validateEvent(data: unknown): { valid: boolean; error?: string } {
  const result = eventSchema.safeParse(data)
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message || 'Invalid event' }
  }

  // Validate payload against type-specific schema if available
  const event = result.data
  const payloadSchema = EVENT_PAYLOAD_SCHEMAS[event.type]
  if (payloadSchema) {
    const payloadResult = payloadSchema.safeParse(event.payload)
    if (!payloadResult.success) {
      return { valid: false, error: `Invalid payload for ${event.type}: ${payloadResult.error.issues[0]?.message}` }
    }
  }

  return { valid: true }
}

// === Event routing (per Fase 2 — NATS subjects) ===
export function eventToSubject(event: SystemEvent): string {
  // NATS subject format: sota.<entityType>.<eventType>
  // es. sota.task.TaskCreated, sota.agent.AgentSpawned
  const entityPrefix = event.type.replace(/^(Task|Agent|Decision|Approval|Claim|Conflict|Experience|Tool|Skill|Checkpoint|Rollback|Document|Code|Workflow|Memory|Garbage).*/, (match) => {
    return match.toLowerCase()
  })
  return `sota.${entityPrefix}.${event.type}`
}
