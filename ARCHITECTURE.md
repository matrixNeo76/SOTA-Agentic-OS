# SOTA Agentic OS — Architettura

> Documento tecnico che descrive l'architettura del sistema, i moduli kernel, i flussi di dati e le decisioni progettuali.

---

## Indice

1. [Visione d'insieme](#1-visione-dinsieme)
2. [Layer architetturali](#2-layer-architetturali)
3. [Kernel modules (F1-F23)](#3-kernel-modules-f1-f23)
4. [Flusso di esecuzione end-to-end](#4-flusso-di-esecuzione-end-to-end)
5. [Modello dati](#5-modello-dati)
6. [Sicurezza e Trust](#6-sicurezza-e-trust)
7. [Design system](#7-design-system)
8. [Performance e scalabilità](#8-performance-e-scalabilità)
9. [Architettura Fase 1-6 (Agentic OS Evolution)](#9-architettura-fase-1-6-agentic-os-evolution)
10. [Runtime Executor (PLAN.md)](#10-runtime-executor-planmd)
11. [Interoperabilità esterna (PLAN-INTEROP.md)](#11-interoperabilità-esterna-plan-interopmd)
12. [Information Architecture & UI (PLAN-UIUX.md)](#12-information-architecture--ui-plan-uiuxmd)

---

## 1. Visione d'insieme

```
┌─────────────────────────────────────────────────────────┐
│              USER (Browser + Agenti esterni)              │
│  Workbench (6 aree) · Admin Panel · Runs · MobileNav     │
│  Claude Code · Cursor · VS Code · A2A clients             │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS + WebSocket + MCP + A2A
┌────────────────────────▼────────────────────────────────┐
│              NEXT.JS APP (SSR + API Routes)              │
│  70 API routes · MCP server (27 tool) · A2A · OpenAPI    │
│  Middleware auth (cookie + API key) · SSE streaming       │
├──────────────────────────────────────────────────────────┤
│           RUNTIME EXECUTOR (PLAN.md — durevole)          │
│  Executor (state machine) · ReAct loop · Tool dispatcher │
│  Builtin tools (7) · Checkpoint/Recovery · JobRecord     │
│  Worker persistente · Dispatch parallelo nei batch       │
├──────────────────────────────────────────────────────────┤
│                    KERNEL (25 moduli)                    │
│  F1 Memory · F2 Planner · F3 Steering · F4 Verify       │
│  F5 Reflect · F6 Context · F7 Trace · F8 Lean4          │
│  F9 Retainer · F10 Encapsulator · F11 Affect            │
│  F12 Objective · F13 Swarm · F14 Router                  │
│  + MCP · Cost · Crypto · Scheduler · Scalability         │
├──────────────────────────────────────────────────────────┤
│           FASE 1-6 (Agentic OS Evolution)                │
│  Context Graph (AGE) · GraphRAG · Memory Fabric (4 layers)│
│  Event Mesh (NATS/Redis) · Cognitive Router · Skill Registry│
│  Evaluation Layer · Conflict Resolution · Cognitive GC    │
│  World Model · Digital Twin · Agent Mesh (10 agents)      │
│  Skill Synthesis · Autonomous Org · Integration Layer     │
│  LLM Client · Skill Sandbox · Cache Layer · MCP Client   │
├──────────────────────────────────────────────────────────┤
│         INTEROPERABILITY (PLAN-INTEROP.md)               │
│  API Key (scopes) · MCP (27 tool) · A2A (agent card)     │
│  Skills export/import (SKILL.md) · OpenAPI 3.0 spec      │
│  Multi-tenant (scoping + audit + rate limit + quota)     │
├──────────────────────────────────────────────────────────┤
│              INFRASTRUCTURE LAYER                        │
│  SQLite (dev) / PostgreSQL+pgvector+AGE (prod, AgensGraph)│
│  NATS JetStream / Redis (Event Mesh) · ZAI SDK (LLM)     │
│  Xenova Transformers (embeddings) · Socket.IO (WS)       │
│  Langfuse self-host (observability, opzionale)           │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Layer architetturali

### Layer 1: Presentation (React Components)
```
src/components/
├── console/          # Chat agentica (8 file, decomposta)
├── cockpit/          # Control room (container + widgets + tabs)
├── canvas/           # DAG visualizer (3 tipi: DynAMO, Objective, Lean)
├── domains/          # 4 domini Inspect (Memory, Plan, Verify, Learn)
├── shared/           # 9 componenti condivisi (EmptyState, StatCard, etc.)
├── ui/               # shadcn/ui premium (Card, Button, Input, Badge, etc.)
├── workbench/        # Workspace shell (views, status bar, command palette)
├── agentic/          # 14 PhaseN + sidebar + topbar + overview
├── blocked-action/   # Stili condivisi entità BlockedAction
└── onboarding/       # Tour 5-step al primo accesso
```

### Layer 2: State Management (Zustand)
```
src/lib/
├── store.ts              # Navigation store (activePhase, activeView, contextPanel)
├── stores/
│   ├── data-store.ts     # Data cache unificata (dashboard, blocked, cost, affect, logs)
│   └── transfer-store.ts # Cross-component state (pendingTabSwitch, shortcuts)
└── design-tokens.ts      # Design system unificato
```

**Pattern:** Il data-store usa cache con TTL (5-30s) e `startGlobalRefresh()`/`stopGlobalRefresh()` singleton per evitare polling multipli. I componenti sottoscrivono allo store invece di fare fetch dirette.

### Layer 3: API Routes (37 endpoints)
```
src/app/api/
├── auth/            # Login/logout/session
├── console/         # Task execution + SSE stream
├── dashboard/       # KPI aggregation (15+ queries)
├── cockpit/         # 5 tab data (narrative, log, scheduler, cycles, safety)
├── plan/            # DynAMO plan generation
├── memory/          # Episodic/Semantic/Logical memory CRUD
├── verify/          # LTL rule verification
├── cost/            # Cost tracking + breakdown
├── blocked-actions/ # HITL resolution
├── mcp/             # MCP Server (JSON-RPC 2.0)
├── mcp-client/      # MCP Client (external connections)
├── skills/          # Skill management CRUD
├── tools/           # Tool registry
├── ... (23 altre route kernel)
├── runtime/         # Fase 1.1 — DB runtime info
├── mesh/            # Fase 2.1 — Event Mesh stats + publish
├── world-model/     # Fase 3.1 — WorldState + predictions
├── digital-twin/    # Fase 3.2 — Scenarios + what-if
├── autonomous-org/  # Fase 3.6 — Proposals + HITL
├── agent-mesh/      # Fase 3.4 — Mesh topology + delegate
├── agent-lifecycle/ # Fase 3.3 — Agent versioning + permissions
├── evaluation/      # Fase 2.7 — Benchmarks + run evaluation
├── conflict-resolution/ # Fase 2.8 — Conflicts + resolve
├── cognitive-gc/    # Fase 2.9 — Memory consolidation + archival
├── cognitive-router/ # Fase 2.3 — Task classifier + routing
├── code-intelligence/ # Fase 2.4 — AST + git diff
├── skill-registry/  # Fase 2.5 — Skills CRUD + version
├── skill-synthesis/ # Fase 3.5 — Gap detection + pipeline
└── knowledge-extraction/ # Fase 2.2 — Document → Graph
```

### Layer 4: Kernel (25 moduli puri)
```
src/lib/kernel/
├── ns-mem.ts              # F1: Neural-Symbolic Memory
├── patchboard.ts          # F1: Transazione PatchBoard
├── scheduler.ts           # F2: DynAMO plan scheduler
├── compiled-ai.ts         # F2: Compiled AI artifacts
├── acts.ts                # F3: ACTS steering controller
├── ltl-monitor.ts         # F4: LTL safety monitor (783 LOC, largest module)
├── taint.ts               # F4: Taint tracking
├── normative.ts           # F4: Normative calculus
├── erl.ts                 # F5: Experience-Reflective Learning
├── context-engineering.ts # F6: Context ring buffer + summaries
├── dominator-tree.ts      # F7: Trace dominator analysis
├── lean4-agent.ts         # F8: Lean4 formal verifier
├── artificial-retainer.ts # F9: Human Retainer (HITL gates)
├── grounded-inference.ts  # F10: Grounded LLM inference
├── affect-subsystem.ts    # F11: Affect (desperation/frustration)
├── agent-objective.ts     # F12: BFS objective tree
├── esr-quorum.ts          # F13: ESR Swarm quorum
├── time-router.ts         # F14: Adaptive model router
├── cost-ledger.ts         # Cost tracking kernel
├── crypto-trust.ts        # ECDSA P-256 tool signing
├── scalability.ts         # FSM snapshots + job processing
├── observability.ts       # Error tracking + tracing
├── sovereign-translator.ts# Sovereign narrative generation
├── curator.ts             # Context curation
└── tool-registry.ts       # Tool installation + permissions
```

**Vincolo architetturale:** I moduli kernel NON importano mai `@prisma/client` o `z-ai-web-dev-sdk` direttamente. L'accesso a DB/LLM avviene tramite le API routes che mediiano tramite `lib/db.ts` e dynamic import di ZAI. Questo mantiene il kernel testabile in isolamento.

### Layer 5: Fase 1-4 Moduli (Agentic OS Evolution)
```
src/lib/
├── governance/         # Fase 0.5 — Entity Registry, Naming URI, Provenance, Event Taxonomy
├── db-runtime.ts       # Fase 1.1 — Provider detection + pgvector/AGE helpers
├── vector-store.ts     # Fase 1.1 — Embeddings façade (JSON-string | pgvector)
├── graph-age.ts        # Fase 1.2 — Context Graph façade (Cypher via AGE | Prisma)
├── graphrag/           # Fase 1.4 — Hybrid retrieval (vector + graph + ranking)
├── memory-fabric/      # Fase 1.5 — 4 layers + consolidation + semantic search
├── checkpoint/         # Fase 1.6 — Resume/Replay/Rollback
├── event-mesh/         # Fase 2.1 — NATS/Redis/memory pub/sub + publishers tipizzati
├── knowledge-extraction/ # Fase 2.2 — Document → chunks → entities → Graph
├── cognitive-router/   # Fase 2.3 — Task classifier + local-first routing
├── code-intelligence/  # Fase 2.4 — AST parser + Call Graph + git diff sync
├── skill-registry/     # Fase 2.5 — Catalogo skill con versioning + 3 default
├── observability-v2/   # Fase 2.6 — Langfuse export + dashboard + policy engine
├── evaluation/         # Fase 2.7 — Benchmark + 8 metriche + regression detection
├── conflict-resolution/ # Fase 2.8 — Claim conflict detect + 5 strategies
├── cognitive-gc/       # Fase 2.9 — Memory curator + decay + cold archival + scheduler
├── world-model/        # Fase 3.1 — WorldState + Prediction + Risk + Opportunity
├── digital-twin/       # Fase 3.2 — Fork + Simulation + 6 what-if presets
├── agent-lifecycle/    # Fase 3.3 — Versioning + roles + capabilities + policies
├── agent-mesh/         # Fase 3.4 — 10 agenti in 3 tier + delegation + escalation
├── skill-synthesis/    # Fase 3.5 — Meta Agent + sandbox + validation + HITL
├── autonomous-org/     # Fase 3.6 — Proposals (7 tipi) + auto-generators + HITL
└── integration/        # Fase 4.2 — Kernel ↔ Event Mesh ↔ Context Graph bridges
```

**Pattern Fase 1-4:** I moduli seguono lo stesso vincolo del kernel (logica pura, nessun import diretto di `@prisma/client`). Le façade `graph-age.ts`, `vector-store.ts`, `event-mesh/mesh.ts` mediiano l'accesso a DB/Event Mesh, rendendo i moduli testabili in isolamento con fallback in-memory/SQLite.

---

## 3. Kernel modules (F1-F23)

### F1 — Memory & State
- **ns-mem.ts:** Neural-Symbolic Memory — memorizzazione episodi con decay, retrieval semantico via embeddings
- **patchboard.ts:** PatchBoard transazionale — operazioni atomiche con rollback su stato globale

### F2 — Planner & Compiler
- **scheduler.ts:** DynAMO plan scheduler — validazione piani, batch topologici, esecuzione ordinata
- **compiled-ai.ts:** Compiled AI — template Lean4 compilati da piani DynAMO

### F3 — Cognitive Steering
- **acts.ts:** Adaptive Cognitive Task Steering — 5 strategie (PLAN, EXECUTE, CHECK, REFLECT, HALT) con budget token

### F4 — Verification & Taint
- **ltl-monitor.ts:** (783 LOC) LTL safety monitor — FSM per ogni regola, verifica eventi, reject/warn/accept
- **taint.ts:** Taint tracking — source → flow → sink, blocca sink contaminati
- **normative.ts:** Normative calculus — gerarchia SAFETY > OPERATIONAL > AESTHETIC

### F5 — Reflective Learning
- **erl.ts:** Experience-Reflective Learning — estrae euristiche da success/failure, enforce Red Lines

### F6 — Context Manager
- **context-engineering.ts:** Ring buffer tool calls + summaries + pruning policies

### F7 — Trace Validator
- **dominator-tree.ts:** Dominator analysis su execution traces, identifica nodi critici

### F8 — Formal Verifier
- **lean4-agent.ts:** Lean4 contract generation + verification workflow

### F9 — Human Retainer
- **artificial-retainer.ts:** (423 LOC) Delegation contracts + HITL gates + audit trail

### F10 — Model Encapsulator
- **grounded-inference.ts:** Grounded LLM inference con context injection + sandbox

### F11 — Affect Monitor
- **affect-subsystem.ts:** Desperation/frustrazione sampling → steering feedback loop

### F12 — Objective Builder
- **agent-objective.ts:** BFS rubric tree per goal decomposition

### F13 — Swarm Coherence
- **esr-quorum.ts:** ESR (Epistemic Status Registry) + quorum voting per belief sync

### F14 — Model Router
- **time-router.ts:** Adaptive routing — primary/ensemble/critic con cost/latency tradeoff

---

## 4. Flusso di esecuzione end-to-end

```
User scrive task nella Console
    │
    ▼
POST /api/console/stream (SSE)
    │
    ├── F2 scheduler.validatePlan() → topologicalBatches()
    │
    ├── Per ogni batch (parallelo):
    │   ├── F3 acts.steer() → strategia (PLAN/EXECUTE/CHECK/REFLECT/HALT)
    │   ├── F4 ltl-monitor.verifyEvent() → accept/warn/reject
    │   │   └── if reject → BlockedAction → F9 HITL gate → Sovereign modal
    │   ├── F10 grounded-inference → LLM call (ZAI SDK)
    │   ├── F4 taint.track() → se tainted, blocca sink
    │   └── F5 erl.reflectAndLearn() → estrai euristica
    │
    ├── F14 time-router → route prompt a modello ottimale
    │
    ├── Cost tracking → cost-ledger → CostEntry (DB)
    │
    └── SSE events → Console UI (plan_chunk, task_complete, reflection, done)
```

### Flusso Sovereign (HITL)
```
Azione bloccata (LTL reject / taint / normative)
    │
    ▼
POST /api/blocked-actions → BlockedAction (DB)
    │
    ▼
SovereignModalContainer (polling 10s via data-store)
    │
    ├── Approva → azione eseguita, audit logged
    ├── Modifica → parametri cambiati, riesegui
    ├── Declassa → task degradato a safer alternative
    └── Rifiuta → azione abortita, audit logged
```

---

## 5. Modello dati

Il database ha **62 modelli Prisma** organizzati in 10 gruppi:

| Gruppo | Modelli | Scopo |
|--------|---------|-------|
| **Memory** | EpisodicMemory, SemanticEntity, LogicalRule, ContextSummary, PruningPolicy | Persistenza memoria |
| **Plans** | AgentPlan, PlanTask | Piani DynAMO |
| **Traces** | ExecutionTrace, TraceSpan, TraceValidation, FSMSnapshot | Tracing esecuzione |
| **Normative** | LTLRule, NormativeRule, NormativeResolution, Heuristic, RedLine, FormalContract, ReflectionLog | Regole + apprendimento |
| **Safety** | TaintRecord, TaintFlow, BlockedAction, ApprovalGate, AuditLedgerEntry | Sicurezza + audit |
| **Steering** | SteeringEvent, SteeringStrategy, AffectSample, AffectThreshold | Controllo cognitivo |
| **Objectives** | ObjectiveTree, ObjectiveNode, Belief | Goal decomposition |
| **Swarm** | ESRSyncEvent, QuorumVote, QuorumDecision | Swarm coherence |
| **Routing** | RoutingDecision, RouterConfig, FoundationModel | Model routing |
| **System** | User, Session, Tool, ToolPermission, CostEntry, AgentLog, ToolCallEntry, etc. | Infrastruttura |

---

## 6. Sicurezza e Trust

### Autenticazione
- **Middleware** (`src/middleware.ts`): gate server-side, redirect a `/login` se senza cookie
- **Session** (`src/lib/auth/session.ts`): cookie `sota_session` httpOnly, 7 giorni, SHA-256 + salt
- **RBAC** (`src/lib/auth/rbac.ts`): ruoli admin/operator/viewer/sovereign

### Trust crittografico
- **crypto-trust.ts:** ECDSA P-256 per firma tool
- Ogni publisher ha keypair, i tool sono firmati con chiave privata
- Verifica con chiave pubblica del publisher registrato
- `PublisherKey` model con fingerprint SHA-256

### MCP Security
- Connessioni MCP con auth: none/bearer/basic/ecdsa
- Connessioni "trusted" richiedono verifica fingerprint ECDSA
- Ogni esecuzione tool esterno è loggata in `ToolExecutionLog`

---

## 7. Design system

### Token system (`globals.css` + `design-tokens.ts`)

```
Surface (3 livelli):
  --surface-base     → bg-background (app)
  --surface-elevated → bg-card (cards)
  --surface-overlay  → bg-popover (modals)

Brand:
  --brand            → oklch(0.52 0.19 245) — blu elettrico
  --brand-hover      → hover state
  --brand-active     → active state

Category (7, desaturati chroma 0.08-0.14):
  --cat-foundation, --cat-orchestration, --cat-cognitive,
  --cat-trust, --cat-learning, --cat-governance, --cat-infrastructure

Status (5, chroma ridotto):
  --status-ok, --status-warn, --status-danger, --status-info, --status-muted

Shadow (4 livelli): --shadow-sm/md/lg/xl
Radius (6 sistematici): --radius-xs(4)/sm(6)/md(8)/lg(12)/xl(16)/2xl(20)
```

### Mappato in Tailwind v4 via `@theme inline`
Tutti i token sono mappati come `--color-*` in `@theme inline` per generare classi native:
- `bg-status-ok/10`, `text-status-warn`, `border-status-danger/30`
- `bg-cat-foundation/10`, `text-cat-orchestration`
- `bg-primary`, `text-primary`, `bg-primary/10`

---

## 8. Performance e scalabilità

### Data-store unificato
- Singolo `setInterval` globale (5s dashboard/blocked/affect, 30s cost)
- Cache con TTL per evitare fetch ridondanti
- `startGlobalRefresh()` / `stopGlobalRefresh()` singleton con refcount

### Lazy loading
- 4 domini + 14 fasi legacy caricati via `next/dynamic` con skeleton fallback
- Componenti pesanti (AgentConsole, Cockpit, Canvas) caricati eagerly (viste principali)

### Embeddings
- `@xenova/transformers` (all-MiniLM-L6-v2, 384dim) caricato dinamicamente
- Semantic search per memoria episodica

### WebSocket
- Socket.IO per Sensorium real-time events
- Buffer limitato a 50 eventi (evita memory leak)
- Reconnect con exponential backoff

### Known limitations
- SQLite per dev (accettabile per <50 utenti)
- N+1 queries in `/api/dashboard` (15 query separate, non ottimizzato)
- No rate limiting sistematico (solo spot)
- 5 kernel modules con stub LLM (F7, F8, F10, F12, F14)

---

## 9. Architettura Fase 1-6 (Agentic OS Evolution)

Le Fasi 1-6 estendono il kernel F1-F23 con capacità cognitive, autonome, di produzione, LLM integration e interop esterna.

### Layer aggiuntivi

```
┌──────────────────────────────────────────────────────────────┐
│ FASE 6  Production Readiness & E2E Validation                 │
│         E2E tests · Skill Sandbox · MCP Completions ·        │
│         Cache Layer · Production deployment scripts           │
├──────────────────────────────────────────────────────────────┤
│ FASE 5  Real LLM Integration & MCP Exposure                   │
│         LLM Client façade · MCP Server (27 tool) ·           │
│         Extended UI (Digital Twin + Conflict Queue)           │
├──────────────────────────────────────────────────────────────┤
│ FASE 4  Production Hardening & Integration                    │
│         Cockpit UI · 13 API routes · Integration bridges      │
├──────────────────────────────────────────────────────────────┤
│ FASE 3  Autonomous Organization Layer                         │
│         Skill Synthesis (Meta Agent + Sandbox + Validation)   │
│         Hierarchical Agent Mesh (CEO + 4 strategic + 5 ops)   │
│         Agent Lifecycle (versioning + roles + policies)       │
│         Digital Twin Engine (Fork + Simulation + What-if)     │
│         World Model (WorldState + Prediction + Risk + Opp)    │
├──────────────────────────────────────────────────────────────┤
│ FASE 2  Cognitive Garbage Collection (Memory Curator)         │
│         Knowledge Conflict Resolution (5 strategies)          │
│         Agent Evaluation Layer (8 metrics + benchmarks)       │
│         Skill Registry (versioning + 3 default skills)        │
│         Code Intelligence (regex AST + Call Graph)            │
│         Knowledge Extraction (chunking + entity/relation)     │
│         Cognitive Router (classifier + local-first)           │
│         Event Mesh (NATS / Redis / in-memory)                 │
│         Observability v2 (Langfuse export + dashboard)        │
├──────────────────────────────────────────────────────────────┤
│ FASE 1  Agent Runtime Kernel + Checkpointing (resume/replay)  │
│         Memory Fabric (4 layers + semantic search)            │
│         GraphRAG (vector + graph + subgraph ranking)          │
│         Knowledge Provenance (enforced on every node)         │
│         Universal Context Graph (AGE + relational fallback)   │
│         PostgreSQL + AGE + pgvector (Docker Compose ready)    │
├──────────────────────────────────────────────────────────────┤
│ FASE 0.5  Entity Registry · Naming (URI scheme)               │
│           Provenance Schema · Event Taxonomy                  │
│           Agent Lifecycle schema · Knowledge-as-Claims        │
├──────────────────────────────────────────────────────────────┤
│ KERNEL   F1-F23 · LTL · ERL · ACTS · DynAMO · Sovereign      │
│ ESISTE   MCP · ECDSA · Next.js 16 · Prisma 6 · 538 test      │
└──────────────────────────────────────────────────────────────┘
```

### Moduli per fase

#### Fase 1 — MVP Core (6 moduli)
| Modulo | Path | Funzione |
|--------|------|----------|
| PostgreSQL + pgvector + AGE | `prisma/schema.postgres.prisma` + `docker-compose.yml` | Database unificato per relazionale + grafo + semantica |
| db-runtime | `src/lib/db-runtime.ts` | Provider detection + native pgvector/AGE ops |
| vector-store | `src/lib/vector-store.ts` | Façade embeddings (JSON-string su SQLite, pgvector su Postgres) |
| graph-age | `src/lib/graph-age.ts` | Façade Context Graph (Cypher via AGE, Prisma fallback) |
| GraphRAG | `src/lib/graphrag/engine.ts` | Hybrid retrieval: vector + graph + subgraph ranking |
| Memory Fabric | `src/lib/memory-fabric/fabric.ts` | 4 layers (episodic/semantic/procedural/reasoning) + consolidation |
| Checkpointing | `src/lib/checkpoint/checkpoint.ts` | Resume/Replay/Rollback per Agent Runtime Kernel |

#### Fase 2 — Enterprise Core (9 moduli)
| Modulo | Path | Funzione |
|--------|------|----------|
| Event Mesh | `src/lib/event-mesh/` | NATS/Redis/in-memory pub/sub con audit trail |
| Knowledge Extraction | `src/lib/knowledge-extraction/` | Document → chunks → entities/relations → Graph |
| Cognitive Router | `src/lib/cognitive-router/` | Task classifier + local-first routing |
| Code Intelligence | `src/lib/code-intelligence/` | TS/JS/Python AST + Call Graph in Context Graph |
| Skill Registry | `src/lib/skill-registry/` | Catalogo skill con versioning + 3 default |
| Observability v2 | `src/lib/observability-v2/` | Langfuse-compatible trace export + dashboard |
| Evaluation Layer | `src/lib/evaluation/` | Benchmark + 8 metriche + regression detection |
| Conflict Resolution | `src/lib/conflict-resolution/` | Detect + 5 strategies + auto-resolver |
| Cognitive GC | `src/lib/cognitive-gc/` | Consolidation + decay + cold archival + scheduler |

#### Fase 3 — AGI-Oriented (6 moduli)
| Modulo | Path | Funzione |
|--------|------|----------|
| World Model | `src/lib/world-model/` | WorldState + Prediction + Risk + Opportunity |
| Digital Twin | `src/lib/digital-twin/` | Fork + Simulation + 6 what-if presets |
| Agent Lifecycle | `src/lib/agent-lifecycle/` | Versioning + roles + capabilities + policies + permissions |
| Agent Mesh | `src/lib/agent-mesh/` | 10 agenti in 3 tier + delegation + escalation + quorum |
| Skill Synthesis | `src/lib/skill-synthesis/` | Meta Agent + sandbox + validation + HITL approval |
| Autonomous Org | `src/lib/autonomous-org/` | Proposals + auto-generators + HITL gates |

#### Fase 4 — Production Hardening (3 componenti)
| Componente | Path | Funzione |
|-----------|------|----------|
| API Routes | `src/app/api/{mesh,world-model,digital-twin,autonomous-org,agent-lifecycle,evaluation,conflict-resolution,cognitive-gc,cognitive-router,code-intelligence,skill-registry,skill-synthesis,knowledge-extraction}/route.ts` | 13 endpoint REST per esporre tutti i moduli |
| Integration Layer | `src/lib/integration/bridges.ts` | Kernel ↔ Event Mesh ↔ Context Graph bridges |
| Cockpit UI | `src/components/autonomous-dashboard/` + `src/app/autonomous/page.tsx` | Dashboard unificata per Autonomous Org |

### Flusso di integrazione (Fase 4.2)

```
   Kernel esistente                  Integration Layer              Moduli Fase 1-3
   ──────────────────                ──────────────────              ──────────────
   AgentLog ──────────────►  syncAgentLogToEventMesh  ──────►  Event Mesh
                                                                         │
                                                                         ▼
                                          startContextGraphPopulator
                                                  │
                                                  ▼
                                          createNode (Task/Agent/Experience)
                                                  │
                                                  ▼
                                          Context Graph (GraphNode)
                                                                          │
   ERL Heuristics ─────────────►  startErlToSkillBridge  ──────►  Skill Registry
                                                                          │
   Autonomous Org ──────────────►  startAutonomousOrgToSovereignBridge  ──────►  BlockedAction
                                                                          │
   Conflict Resolution ─────────►  recordPolicyViolation  ──────►  Observability v2
```

### Numeri finali

- **538 test** in **35 file** (tutti passing)
- **+35 nuovi moduli** tra Fase 1-6 + Runtime + Interop
- **70 API routes** (36 kernel + 13 Fase 4 + 7 Runs/Admin + 10 Interop + 4 Skills)
- **27 tool MCP** per client esterni
- **76 pagine** generate dal build
- **0 TypeScript errors** nei moduli nuovi
- **0 dipendenze native** aggiunte (tree-sitter sostituito con parser regex, NATS/Redis lazy-loaded opzionali)

---

## 10. Runtime Executor (PLAN.md)

L'executor durevole trasforma i piani DynAMO in lavoro reale, con recovery dopo crash.

### Architettura

```
POST /api/console/stream
    │
    ▼
startExecution({ task, async: true })
    │
    ├── generateAndPersistPlan (LLM → DynAMO → DB)
    │
    ├── [async] enqueueJob('execute_plan', { planId })
    │       └── Worker (background, ogni 3s)
    │             └── processNextJob → executePlan({ planId })
    │                   ├── topologicalBatches (DAG dispatch)
    │                   ├── Promise.all (parallelo nel batch)
    │                   ├── executeTask per ogni task:
    │                   │     ├── saveCheckpoint (execution_state)
    │                   │     ├── steer (ACTS)
    │                   │     ├── verifyEvent (LTL)
    │                   │     ├── executeReActLoop (pensa → tool → osserva)
    │                   │     │     ├── dispatchTool (builtin/HTTP/MCP)
    │                   │     │     └── recordCostEntry
    │                   │     ├── journalExecution (ExecutionTrace)
    │                   │     └── publishTaskCompleted (Event Mesh)
    │                   └── reflectAndLearn (ERL)
    │
    └── ritorna { planId, jobId } immediatamente
```

### Componenti

| Componente | Path | Funzione |
|-----------|------|----------|
| Executor | `src/lib/runtime/executor.ts` | State machine persistente, checkpoint, recovery, dispatch parallelo |
| ReAct Loop | `src/lib/runtime/react-loop.ts` | Pens a→tool call→observe→repeat (LLM tool-calling) |
| Tool Dispatcher | `src/lib/runtime/tool-dispatcher.ts` | Scope enforcement, timeout, audit trail |
| Builtin Tools | `src/lib/runtime/builtin-tools.ts` | filesystem.read/write/list, http.fetch, memory.search, graph.query, web.search (7 tool) |
| MCP Client | `src/lib/mcp-client/client.ts` | Discovery + execution tool MCP esterni |
| Worker | `src/lib/kernel/scalability.ts` | Coda JobRecord, processNextJob, startWorker |
| Bootstrap | `src/instrumentation.ts` | Avvia worker + integration + GC + recovery al boot |

### Controlli durabilità

- **Checkpoint**: `saveCheckpoint` ad ogni task (execution_state)
- **Recovery**: `recoverOrphanedPlans()` al boot → reset running → resume
- **Idempotency**: task già `done` skippati in replay
- **Event journal**: `ExecutionTrace` per replay bit-identico
- **Dispatch parallelo**: `Promise.all` per task nello stesso `topologicalBatches`

---

## 11. Interoperabilità esterna (PLAN-INTEROP.md)

Il sistema è progettato come **backplane** per agenti esterni.

### Protocolli

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENTI ESTERNI                           │
│  Claude Code · Cursor · VS Code · Antigravity · A2A agents  │
└───────────┬──────────┬──────────┬──────────┬────────────────┘
            │          │          │          │
       MCP (JSON-RPC) A2A    REST API    OpenAPI
            │          │          │          │
            ▼          ▼          ▼          ▼
┌──────────────────────────────────────────────────────────────┐
│                   AUTH LAYER (IO-0)                          │
│  API Key (sak_<keyId>_<secret>) · Scopes: read/exec/admin   │
│  Bearer token · Session cookie fallback · Rate limiting     │
├──────────────────────────────────────────────────────────────┤
│                   ENDPOINT LAYER                             │
│  /api/mcp (27 tool) · /.well-known/agent.json · /api/a2a/*  │
│  /api/openapi · /api/skills/* · 70 REST routes              │
├──────────────────────────────────────────────────────────────┤
│                   GOVERNANCE LAYER                           │
│  Scoping tenant · Audit ledger · Quota enforcement          │
│  Sovereign HITL · LTL verify · Red Lines                    │
├──────────────────────────────────────────────────────────────┤
│                   RUNTIME + MEMORY                           │
│  Executor durevole · Context Graph · Memory Fabric          │
│  Skill Registry · World Model · Agent Mesh                  │
└──────────────────────────────────────────────────────────────┘
```

### Moduli

| Modulo | Path | Funzione |
|--------|------|----------|
| API Key Auth | `src/lib/auth/api-key.ts` | createApiKey, verifyApiKey, requireApiAuth (Bearer + cookie) |
| Multi-tenant | `src/lib/auth/multi-tenant.ts` | TenantContext, auditAccess, checkRateLimit, checkQuota |
| A2A Protocol | `src/lib/a2a/protocol.ts` | Agent card, submitTask, getTask, cancelTask |
| Skills Export | `src/lib/skill-registry/skill-export.ts` | SKILL.md/JSON export, import, discoverSkills |
| MCP Server | `src/app/api/mcp/route.ts` | 27 tool JSON-RPC 2.0 con auth |
| OpenAPI | `src/app/api/openapi/route.ts` | Spec OpenAPI 3.0 per SDK autogenerati |

---

## 12. Information Architecture & UI (PLAN-UIUX.md)

### 6 Aree per obiettivo (non per modulo)

```
┌──────────────────────────────────────────────┐
│ SIDEBAR (6 aree + System + Advanced)          │
├──────────────────────────────────────────────┤
│ Main:                                         │
│  1. Dashboard   — Overview + KPI + Activity  │
│  2. Runs        — Esegui workflow + HITL     │
│  3. Memory      — Context Graph + Search     │
│  4. Agents      — Mesh + Skills + Autonomous │
│  5. Governance  — LTL + Conflicts + HITL     │
│  6. Insights    — World Model + Digital Twin │
│ System:                                       │
│  · Admin & Settings (6 tab)                  │
│ Advanced / Internals (collassabile):          │
│  · Fasi 1-14 + Domains + Tools (debug)       │
└──────────────────────────────────────────────┘
```

### Componenti UI

| Componente | Path | Funzione |
|-----------|------|----------|
| ModulePage | `src/components/module-pages/module-page.tsx` | Pattern standard: header + stats + content + actions + EmptyState |
| RunsView | `src/components/module-pages/runs-view.tsx` | Runs list + detail con timeline/ReAct/checkpoint/rollback |
| MemoryKnowledgeView | `src/components/module-pages/memory-knowledge-view.tsx` | Graph browser + semantic search + memory tiers |
| AgentsOrgView | `src/components/module-pages/agents-org-view.tsx` | Mesh topology + skills + proposals |
| DigitalTwinDashboard | `src/components/autonomous-dashboard/digital-twin-panel.tsx` | 6 what-if presets + projected metrics |
| ConflictQueuePanel | `src/components/autonomous-dashboard/conflict-queue-panel.tsx` | Pending conflicts + 5 strategies + auto-resolve |
| Charts | `src/components/data-viz/charts.tsx` | 5 recharts: CostTrend, TokenUsage, Latency, EvaluationTrend, Sparkline |
| OnboardingTourV2 | `src/components/onboarding/onboarding-tour-v2.tsx` | Tour 5-step sulle 6 aree |
| AISuggestion | `src/components/onboarding/ai-suggestion.tsx` | Primitive UI per suggerimenti AI contestuali |
| DynamicIcon | `src/components/shared/dynamic-icon.tsx` | 52 icone mappate (Record<string, LucideIcon>) |

### Design system (UX-5)

- **Shadow hierarchy**: `shadow-soft`, `shadow-soft-md`, `shadow-soft-lg` (3 livelli)
- **Motion**: `animate-slide-in-up`, `animate-stagger`, `animate-pulse-glow`, `hover-lift`
- **Glass**: `glass` utility (backdrop-filter blur per overlay)
- **Tabular numbers**: `tnum` utility per metriche
- **Skeleton**: `skeleton-shimmer` per loading states
- **Token CSS**: OKLCH color space, 7 category colors, 5 status tones, 3 surface levels
