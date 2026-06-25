/**
 * Entity Registry — Fase 0.5.1
 *
 * Registro canonico delle entità di prima classe del sistema.
 * Ogni entità ha un tipo, uno schema di attributi e regole di ciclo di vita.
 *
 * Questo è il contratto che governa cosa può esistere nel Context Graph (Fase 1)
 * e nell'Event Mesh (Fase 2). Nessun nodo può essere creato con un tipo
 * non registrato qui.
 */

import { z } from 'zod'

// === Entity Types (chiuse, versionate) ===
export const ENTITY_TYPES = [
  'Agent',
  'Task',
  'Workflow',
  'Skill',
  'Tool',
  'Document',
  'Decision',
  'Experience',
  'Claim',        // Fase 0.5.5 — Knowledge-as-Claims
  'Evidence',     // Fase 0.5.5 — Knowledge-as-Claims
  'Source',       // Fase 0.5.5 — Knowledge-as-Claims
  'Conflict',     // Fase 0.5.5 — Knowledge-as-Claims
  'Event',
  'Conversation',
  // Riservati per Fase 2-3 (definiti ora, enforcement dopo)
  'Benchmark',
  'Evaluation',
  'Metric',
  'AgentVersion',   // Fase 3 — Agent Lifecycle
  'AgentRole',      // Fase 3 — Agent Lifecycle
  'AgentCapability',// Fase 3 — Agent Lifecycle
  'AgentPolicy',    // Fase 3 — Agent Lifecycle
  'WorldState',     // Fase 3 — World Model
  'Prediction',     // Fase 3 — World Model
  'Risk',           // Fase 3 — World Model
  'Opportunity',    // Fase 3 — World Model
] as const

export type EntityType = typeof ENTITY_TYPES[number]

// === Entity Lifecycle States ===
export const LIFECYCLE_STATES = [
  'draft',       // creato ma non attivo
  'active',      // in uso
  'suspended',   // temporaneamente disattivato
  'deprecated',  // sostituito ma mantenuto per audit
  'archived',    // rimosso da hot storage
  'deleted',     // soft-delete, mantenuto per provenance
] as const

export type LifecycleState = typeof LIFECYCLE_STATES[number]

// === Entity Lifecycle Rules ===
export const LIFECYCLE_TRANSITIONS: Record<string, LifecycleState[]> = {
  draft: ['active', 'deleted'],
  active: ['suspended', 'deprecated', 'deleted'],
  suspended: ['active', 'deprecated', 'deleted'],
  deprecated: ['archived', 'deleted'],
  archived: ['deleted'],
  deleted: [], // terminal state
}

// === Base Entity Schema ===
export const entitySchema = z.object({
  // Identità
  id: z.string().min(1),
  type: z.enum(ENTITY_TYPES),
  uri: z.string().min(1), // Fase 0.5.2 — URI scheme

  // Lifecycle
  lifecycleState: z.enum(LIFECYCLE_STATES).default('draft'),
  lifecycleHistory: z.array(z.object({
    from: z.enum(LIFECYCLE_STATES),
    to: z.enum(LIFECYCLE_STATES),
    timestamp: z.string().datetime(),
    actor: z.string(), // agent URI or user ID
    reason: z.string().optional(),
  })).default([]),

  // Provenance (Fase 0.5.3 — obbligatorio)
  provenance: z.object({
    createdByAgent: z.string(),
    createdByModel: z.string().optional(),
    source: z.string(),
    confidence: z.number().min(0).max(1),
    timestamp: z.string().datetime(),
  }),

  // Attributi (estesi per tipo)
  attributes: z.record(z.string(), z.unknown()).default({}),

  // Relazioni (riferimenti ad altre entità via URI)
  relations: z.array(z.object({
    type: z.string(), // es. EXECUTED, GENERATED, RESULTED_IN
    target: z.string(), // URI dell'entità target
    provenance: z.object({
      createdByAgent: z.string(),
      timestamp: z.string().datetime(),
    }).optional(),
  })).default([]),

  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().min(1).default(1),
})

export type Entity = z.infer<typeof entitySchema>

// === Entity Registry (type-safe lookup) ===
export const ENTITY_REGISTRY: Record<EntityType, {
  description: string
  requiredAttributes: string[]
  allowedRelations: string[]
  lifecycleEnabled: boolean
}> = {
  Agent: {
    description: 'Un agente autonomo che opera nel sistema',
    requiredAttributes: ['name', 'role'],
    allowedRelations: ['HAS_ROLE', 'USES_SKILL', 'BOUND_BY', 'UPGRADED_TO', 'EXECUTED', 'GENERATED'],
    lifecycleEnabled: true,
  },
  Task: {
    description: 'Un\'unita di lavoro assegnata a un agente',
    requiredAttributes: ['goal', 'status'],
    allowedRelations: ['EXECUTED_BY', 'RESULTED_IN', 'PART_OF', 'DEPENDS_ON'],
    lifecycleEnabled: true,
  },
  Workflow: {
    description: 'Una sequenza di task coordinati',
    requiredAttributes: ['name', 'steps'],
    allowedRelations: ['CONTAINS', 'TRIGGERED', 'RESULTED_IN'],
    lifecycleEnabled: true,
  },
  Skill: {
    description: 'Un prompt template riutilizzabile con tool dipendenze',
    requiredAttributes: ['name', 'description', 'promptTemplate'],
    allowedRelations: ['USES_TOOL', 'REQUIRED_BY', 'GENERATED_BY'],
    lifecycleEnabled: true,
  },
  Tool: {
    description: 'Uno strumento firmato ECDSA con permessi',
    requiredAttributes: ['toolId', 'name', 'version', 'signature'],
    allowedRelations: ['USED_BY_SKILL', 'USED_BY_AGENT', 'PERMISSIONS'],
    lifecycleEnabled: true,
  },
  Document: {
    description: 'Un documento esterno ingerito nel sistema',
    requiredAttributes: ['title', 'source', 'mimeType'],
    allowedRelations: ['DERIVED_FROM', 'PARSED_INTO', 'REFERENCED_BY'],
    lifecycleEnabled: true,
  },
  Decision: {
    description: 'Una decisione presa da un agente o umano',
    requiredAttributes: ['rationale', 'decidedBy'],
    allowedRelations: ['DERIVED_FROM', 'RESOLVED', 'TRIGGERED'],
    lifecycleEnabled: true,
  },
  Experience: {
    description: 'Un episodio di apprendimento riflesso (ERL)',
    requiredAttributes: ['outcome', 'context'],
    allowedRelations: ['LEARNED_FROM', 'PRODUCED', 'RELATED_TO'],
    lifecycleEnabled: true,
  },
  Claim: {
    description: 'Un\'affermazione di conoscenza con evidenza',
    requiredAttributes: ['statement', 'confidence'],
    allowedRelations: ['SUPPORTED_BY', 'CONFLICTS_WITH', 'RESOLVED_BY'],
    lifecycleEnabled: true,
  },
  Evidence: {
    description: 'Evidenza a supporto di un claim',
    requiredAttributes: ['source', 'type'],
    allowedRelations: ['SUPPORTS', 'DERIVED_FROM'],
    lifecycleEnabled: true,
  },
  Source: {
    description: 'Fonte di un\'evidenza o claim',
    requiredAttributes: ['uri', 'type'],
    allowedRelations: ['PRODUCED', 'REFERENCED_BY'],
    lifecycleEnabled: false,
  },
  Conflict: {
    description: 'Conflitto tra claim con risoluzione',
    requiredAttributes: ['claimA', 'claimB', 'status'],
    allowedRelations: ['RESOLVED_BY', 'INVOLVES'],
    lifecycleEnabled: true,
  },
  Event: {
    description: 'Evento nel sistema (event taxonomy 0.5.4)',
    requiredAttributes: ['eventType', 'timestamp'],
    allowedRelations: ['TRIGGERED', 'GENERATED', 'OBSERVED'],
    lifecycleEnabled: false,
  },
  Conversation: {
    description: 'Una conversazione tra utente e agente',
    requiredAttributes: ['messages', 'participants'],
    allowedRelations: ['BRANCHED_FROM', 'SHARED_AS', 'CONTAINS'],
    lifecycleEnabled: true,
  },
  Benchmark: {
    description: 'Dataset di valutazione agenti (Fase 2)',
    requiredAttributes: ['name', 'dataset'],
    allowedRelations: ['EVALUATED', 'MEASURED_BY'],
    lifecycleEnabled: false,
  },
  Evaluation: {
    description: 'Valutazione di un agente (Fase 2)',
    requiredAttributes: ['agentUri', 'score', 'metrics'],
    allowedRelations: ['ACHIEVED_BY', 'MEASURED_BY', 'BASED_ON'],
    lifecycleEnabled: false,
  },
  Metric: {
    description: 'Metrica di valutazione (Fase 2)',
    requiredAttributes: ['name', 'value', 'unit'],
    allowedRelations: ['MEASURES', 'AGGREGATES'],
    lifecycleEnabled: false,
  },
  AgentVersion: {
    description: 'Versione di un agente (Fase 3)',
    requiredAttributes: ['version', 'changes'],
    allowedRelations: ['UPGRADED_FROM', 'UPGRADED_TO'],
    lifecycleEnabled: true,
  },
  AgentRole: {
    description: 'Ruolo di un agente (Fase 3)',
    requiredAttributes: ['name', 'permissions'],
    allowedRelations: ['ASSIGNED_TO'],
    lifecycleEnabled: false,
  },
  AgentCapability: {
    description: 'Capacità di un agente (Fase 3)',
    requiredAttributes: ['name', 'description'],
    allowedRelations: ['POSSESSED_BY'],
    lifecycleEnabled: false,
  },
  AgentPolicy: {
    description: 'Policy vincolante per un agente (Fase 3)',
    requiredAttributes: ['rules', 'enforcement'],
    allowedRelations: ['BINDS', 'ENFORCED_BY'],
    lifecycleEnabled: true,
  },
  WorldState: {
    description: 'Stato del mondo osservato (Fase 3)',
    requiredAttributes: ['snapshot', 'timestamp'],
    allowedRelations: ['PREDICTED_FROM', 'OBSERVED_AT'],
    lifecycleEnabled: false,
  },
  Prediction: {
    description: 'Predizione del World Model (Fase 3)',
    requiredAttributes: ['statement', 'probability', 'horizon'],
    allowedRelations: ['BASED_ON', 'VERIFIED_BY'],
    lifecycleEnabled: false,
  },
  Risk: {
    description: 'Rischio identificato (Fase 3)',
    requiredAttributes: ['description', 'severity', 'probability'],
    allowedRelations: ['MITIGATED_BY', 'OBSERVED_IN'],
    lifecycleEnabled: false,
  },
  Opportunity: {
    description: 'Opportunità identificata (Fase 3)',
    requiredAttributes: ['description', 'potential'],
    allowedRelations: ['EXPLOITED_BY', 'OBSERVED_IN'],
    lifecycleEnabled: false,
  },
}

// === Helper: validate entity creation ===
export function validateEntityCreation(type: EntityType, attributes: Record<string, unknown>): { valid: boolean; missing: string[] } {
  const registry = ENTITY_REGISTRY[type]
  if (!registry) return { valid: false, missing: [`Unknown entity type: ${type}`] }

  const missing = registry.requiredAttributes.filter(attr => !(attr in attributes))
  return { valid: missing.length === 0, missing }
}

// === Helper: validate lifecycle transition ===
export function validateLifecycleTransition(from: LifecycleState, to: LifecycleState): { valid: boolean; reason?: string } {
  const allowed = LIFECYCLE_TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) {
    return { valid: false, reason: `Transition ${from} → ${to} not allowed. Valid: ${allowed?.join(', ') || 'none'}` }
  }
  return { valid: true }
}
