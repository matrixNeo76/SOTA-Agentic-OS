/**
 * Governance Index — Fase 0.5
 *
 * Punto di ingresso unico per tutti i moduli di governance.
 */

// Entity Registry
export {
  ENTITY_TYPES, LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS,
  ENTITY_REGISTRY, entitySchema,
  validateEntityCreation, validateLifecycleTransition,
  type EntityType, type LifecycleState, type Entity,
} from './entity-registry'

// Naming Rules
export {
  URI_SCHEMES, IDENTIFIER_RULES, uriSchema,
  buildUri, parseUri, validateUriForType,
} from './naming-rules'

// Provenance Schema
export {
  provenanceSchema, relationProvenanceSchema,
  createProvenance, validateProvenance, getConfidenceLevel, computeDerivedConfidence,
  CONFIDENCE_LEVELS,
  type Provenance, type RelationProvenance,
} from './provenance-schema'

// Event Taxonomy
export {
  EVENT_TYPES, eventSchema, EVENT_PAYLOAD_SCHEMAS,
  createEvent, validateEvent, eventToSubject,
  type EventType, type SystemEvent,
} from './event-taxonomy'

// Agent Lifecycle
export {
  agentNodeSchema, agentVersionSchema, agentRoleSchema,
  agentCapabilitySchema, agentPolicySchema,
  AGENT_LIFECYCLE, AGENT_TRANSITIONS, AGENT_RELATIONS,
  type AgentNode, type AgentVersionNode, type AgentRoleNode,
  type AgentCapabilityNode, type AgentPolicyNode,
} from './agent-lifecycle'

// Knowledge-as-Claims
export {
  claimNodeSchema, evidenceNodeSchema, sourceNodeSchema, conflictNodeSchema,
  KNOWLEDGE_RELATIONS, RESOLUTION_STRATEGIES,
  detectClaimConflict, computeClaimStrength,
  type ClaimNode, type EvidenceNode, type SourceNode, type ConflictNode,
  type ResolutionStrategy,
} from './knowledge-claims'
