/**
 * Agent Lifecycle Schema — Fase 0.5.5
 *
 * Schema di modellazione per Agent Identity & Lifecycle.
 * Enforcement attivo in Fase 3 quando gli agenti diventano entità persistenti.
 *
 * Nodi (nel Context Graph su Apache AGE):
 *   Agent, AgentVersion, AgentRole, AgentCapability, AgentPolicy
 *
 * Relazioni:
 *   (:Agent)-[:HAS_ROLE]->(:AgentRole)
 *   (:Agent)-[:POSSESSES]->(:AgentCapability)
 *   (:Agent)-[:USES_SKILL]->(:Skill)
 *   (:Agent)-[:BOUND_BY]->(:AgentPolicy)
 *   (:Agent)-[:UPGRADED_TO]->(:AgentVersion)
 *   (:AgentVersion)-[:UPGRADED_FROM]->(:AgentVersion)
 */

import { z } from 'zod'
import { provenanceSchema } from './provenance-schema'

// === Agent ===
export const agentNodeSchema = z.object({
  uri: z.string().regex(/^agent:\/\//),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['spawned', 'active', 'idle', 'stopped', 'failed']),
  currentVersion: z.string().optional(), // agent://planner/v2
  roles: z.array(z.string()).default([]), // URIs of AgentRole
  capabilities: z.array(z.string()).default([]), // URIs of AgentCapability
  skills: z.array(z.string()).default([]), // URIs of Skill
  policies: z.array(z.string()).default([]), // URIs of AgentPolicy
  parentAgent: z.string().optional(), // URI of parent agent (for hierarchical mesh)
  provenance: provenanceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type AgentNode = z.infer<typeof agentNodeSchema>

// === AgentVersion ===
export const agentVersionSchema = z.object({
  uri: z.string().regex(/^agent-version:\/\//),
  agentUri: z.string().regex(/^agent:\/\//),
  version: z.string(), // e.g. "v1", "v2"
  changes: z.string(), // changelog
  upgradedFrom: z.string().optional(), // URI of previous AgentVersion
  evaluationScore: z.number().optional(), // from Evaluation Layer (Fase 2)
  provenance: provenanceSchema,
  createdAt: z.string().datetime(),
})

export type AgentVersionNode = z.infer<typeof agentVersionSchema>

// === AgentRole ===
export const agentRoleSchema = z.object({
  uri: z.string().regex(/^agent-role:\/\//),
  name: z.string().min(1), // e.g. "architect", "coder", "reviewer"
  description: z.string(),
  permissions: z.array(z.string()), // permission scopes
  level: z.enum(['executive', 'strategic', 'operational', 'specialized']),
  provenance: provenanceSchema,
})

export type AgentRoleNode = z.infer<typeof agentRoleSchema>

// === AgentCapability ===
export const agentCapabilitySchema = z.object({
  uri: z.string().regex(/^agent-capability:\/\//),
  name: z.string().min(1), // e.g. "code-generation", "testing", "planning"
  description: z.string(),
  proficiencyLevel: z.enum(['basic', 'intermediate', 'advanced', 'expert']).default('basic'),
  provenance: provenanceSchema,
})

export type AgentCapabilityNode = z.infer<typeof agentCapabilitySchema>

// === AgentPolicy ===
export const agentPolicySchema = z.object({
  uri: z.string().regex(/^agent-policy:\/\//),
  name: z.string().min(1), // e.g. "safety-first", "cost-optimized"
  rules: z.array(z.object({
    rule: z.string(),
    enforcement: z.enum(['hard', 'soft', 'advisory']),
    consequence: z.string(), // what happens if violated
  })),
  provenance: provenanceSchema,
  createdAt: z.string().datetime(),
  active: z.boolean().default(true),
})

export type AgentPolicyNode = z.infer<typeof agentPolicySchema>

// === Agent Lifecycle States (extends entity lifecycle) ===
export const AGENT_LIFECYCLE = {
  SPAWNED: 'spawned',     // just created, not yet active
  ACTIVE: 'active',       // running and accepting tasks
  IDLE: 'idle',           // active but no current task
  STOPPED: 'stopped',     // deliberately stopped
  FAILED: 'failed',       // crashed or errored
  UPGRADED: 'upgraded',   // replaced by new version
  DEPRECATED: 'deprecated', // old version, kept for audit
} as const

export const AGENT_TRANSITIONS: Record<string, string[]> = {
  spawned: ['active', 'failed'],
  active: ['idle', 'stopped', 'failed', 'upgraded'],
  idle: ['active', 'stopped', 'failed'],
  stopped: ['active', 'deprecated'],
  failed: ['active', 'stopped', 'deprecated'],
  upgraded: ['deprecated'],
  deprecated: [],
}

// === Relation definitions (for Apache AGE Cypher) ===
export const AGENT_RELATIONS = [
  { type: 'HAS_ROLE', from: 'Agent', to: 'AgentRole', description: 'Agent ha un ruolo' },
  { type: 'POSSESSES', from: 'Agent', to: 'AgentCapability', description: 'Agent possiede una capacità' },
  { type: 'USES_SKILL', from: 'Agent', to: 'Skill', description: 'Agent usa una skill' },
  { type: 'BOUND_BY', from: 'Agent', to: 'AgentPolicy', description: 'Agent è vincolato da una policy' },
  { type: 'UPGRADED_TO', from: 'Agent', to: 'AgentVersion', description: 'Agent è stato aggiornato a una versione' },
  { type: 'UPGRADED_FROM', from: 'AgentVersion', to: 'AgentVersion', description: 'Versione precedente' },
  { type: 'SPAWNED_BY', from: 'Agent', to: 'Agent', description: 'Agent padre (hierarchical mesh)' },
  { type: 'ACHIEVED', from: 'Agent', to: 'Evaluation', description: 'Agent ha ottenuto una valutazione' },
] as const
