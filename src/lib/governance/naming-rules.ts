/**
 * Naming Rules — Fase 0.5.2
 *
 * Schema URI per identità stabili e interrogabili.
 * Ogni entità nel Context Graph ha un URI canonico.
 *
 * Schemi:
 *   agent://<name>           — es. agent://planner, agent://research
 *   skill://<name>           — es. skill://code-review
 *   task://<uuid>            — es. task://550e8400-e29b-41d4-a716-446655440000
 *   workflow://<uuid>        — es. workflow://abc123
 *   tool://<toolId>          — es. tool://filesystem-browser
 *   document://<hash>        — es. document://sha256:abc123...
 *   decision://<uuid>        — es. decision://def456
 *   experience://<uuid>      — es. experience://ghi789
 *   claim://<uuid>           — es. claim://claim-001
 *   evidence://<uuid>        — es. evidence://ev-001
 *   source://<type>/<id>     — es. source://github/repo#issue-42
 *   conversation://<uuid>    — es. conversation://conv-001
 *   event://<type>/<uuid>    — es. event://TaskCreated/evt-001
 */

import { z } from 'zod'
import type { EntityType } from './entity-registry'

// === URI Schemes per entity type ===
export const URI_SCHEMES: Record<EntityType, string> = {
  Agent: 'agent',
  Task: 'task',
  Workflow: 'workflow',
  Skill: 'skill',
  Tool: 'tool',
  Document: 'document',
  Decision: 'decision',
  Experience: 'experience',
  Claim: 'claim',
  Evidence: 'evidence',
  Source: 'source',
  Conflict: 'conflict',
  Event: 'event',
  Conversation: 'conversation',
  Benchmark: 'benchmark',
  Evaluation: 'evaluation',
  Metric: 'metric',
  AgentVersion: 'agent-version',
  AgentRole: 'agent-role',
  AgentCapability: 'agent-capability',
  AgentPolicy: 'agent-policy',
  WorldState: 'world-state',
  Prediction: 'prediction',
  Risk: 'risk',
  Opportunity: 'opportunity',
}

// === URI Validation ===
export const uriSchema = z.string().regex(
  /^[a-z][-a-z]*:\/\/[^\s]+$/,
  'URI must match scheme://identifier format'
)

// === Helper: build URI ===
export function buildUri(type: EntityType, identifier: string): string {
  const scheme = URI_SCHEMES[type]
  return `${scheme}://${identifier}`
}

// === Helper: parse URI ===
export function parseUri(uri: string): { scheme: string; identifier: string; entityType: EntityType | null } | null {
  const match = uri.match(/^([a-z][-a-z]*):\/\/(.+)$/)
  if (!match) return null

  const [, scheme, identifier] = match
  const entityType = (Object.entries(URI_SCHEMES).find(([, s]) => s === scheme)?.[0] as EntityType) || null

  return { scheme, identifier, entityType }
}

// === Helper: validate URI matches entity type ===
export function validateUriForType(uri: string, type: EntityType): { valid: boolean; reason?: string } {
  const parsed = parseUri(uri)
  if (!parsed) return { valid: false, reason: `Invalid URI format: ${uri}` }
  if (parsed.entityType !== type) {
    return { valid: false, reason: `URI scheme '${parsed.scheme}' does not match entity type '${type}' (expected '${URI_SCHEMES[type]}')` }
  }
  return { valid: true }
}

// === Naming conventions for identifiers ===
export const IDENTIFIER_RULES = {
  Agent: 'kebab-case name (e.g. "planner", "code-reviewer")',
  Task: 'UUID v4',
  Workflow: 'UUID v4',
  Skill: 'kebab-case name (e.g. "code-review", "task-analyzer")',
  Tool: 'toolId as registered in Tool Ecosystem',
  Document: 'sha256 hash of content',
  Decision: 'UUID v4',
  Experience: 'UUID v4',
  Claim: 'sequential or UUID (e.g. "claim-001")',
  Evidence: 'sequential or UUID (e.g. "ev-001")',
  Source: 'type/id format (e.g. "github/repo#issue-42")',
  Conflict: 'UUID v4',
  Event: 'eventType/UUID (e.g. "TaskCreated/evt-001")',
  Conversation: 'UUID v4',
  Benchmark: 'kebab-case name',
  Evaluation: 'UUID v4',
  Metric: 'kebab-case name',
  AgentVersion: 'agent-name/v<version> (e.g. "planner/v2")',
  AgentRole: 'kebab-case name (e.g. "architect", "coder")',
  AgentCapability: 'kebab-case name (e.g. "code-generation", "testing")',
  AgentPolicy: 'kebab-case name (e.g. "safety-first", "cost-optimized")',
  WorldState: 'timestamp-based (e.g. "2026-06-25T10:00:00Z")',
  Prediction: 'UUID v4',
  Risk: 'UUID v4',
  Opportunity: 'UUID v4',
} as const
