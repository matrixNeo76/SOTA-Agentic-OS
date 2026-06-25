# SOTA Agentic OS — Architettura

> Documento tecnico che descrive l'architettura del sistema, i moduli kernel, i flussi di dati e le decisioni progettuali.

---

## Indice

1. [Visione d'insieme](#1-visione-dinsieme)
2. [Layer architetturali](#2-layer-architetturali)
3. [Kernel modules (F1-F23)](#3-kernel-modules-f1-f23)
4. [Flusso di esecuzione end-to-end](#4-flusso-di-esecuzione-end-to-end)
5. [Modello dati (62 modelli Prisma)](#5-modello-dati)
6. [Sicurezza e Trust](#6-sicurezza-e-trust)
7. [Design system](#7-design-system)
8. [Performance e scalabilità](#8-performance-e-scalabilità)

---

## 1. Visione d'insieme

```
┌─────────────────────────────────────────────────────────┐
│                    USER (Browser)                        │
│  Console · Cockpit · Canvas · Timeline · Sovereign      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS + WebSocket
┌────────────────────────▼────────────────────────────────┐
│              NEXT.JS APP (SSR + API Routes)              │
│  37 API routes · Middleware auth · SSE streaming         │
├──────────────────────────────────────────────────────────┤
│                    KERNEL (25 moduli)                    │
│  F1 Memory · F2 Planner · F3 Steering · F4 Verify       │
│  F5 Reflect · F6 Context · F7 Trace · F8 Lean4          │
│  F9 Retainer · F10 Encapsulator · F11 Affect            │
│  F12 Objective · F13 Swarm · F14 Router                  │
│  + MCP · Cost · Crypto · Scheduler · Scalability         │
├──────────────────────────────────────────────────────────┤
│              INFRASTRUCTURE LAYER                        │
│  SQLite/PostgreSQL (62 models) · Redis · ZAI SDK (LLM)  │
│  Xenova Transformers (embeddings) · Socket.IO (WS)       │
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
└── ... (24 altre route)
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

## 9. Architettura Fase 1-4 (Agentic OS Evolution)

Le Fasi 1-4 estendono il kernel F1-F23 con capacità cognitive, autonome e di produzione.

### Layer aggiuntivi

```
┌──────────────────────────────────────────────────────────────┐
│ FASE 4  Production Hardening & Integration                   │
│         Cockpit UI (/autonomous) · 13 API routes ·           │
│         Integration bridges (kernel ↔ Event Mesh ↔ Graph)    │
├──────────────────────────────────────────────────────────────┤
│ FASE 3  Autonomous Organization Layer                        │
│         Skill Synthesis (Meta Agent + Sandbox + Validation)  │
│         Hierarchical Agent Mesh (CEO + 4 strategic + 5 ops)  │
│         Agent Lifecycle (versioning + roles + policies)      │
│         Digital Twin Engine (Fork + Simulation + What-if)    │
│         World Model (WorldState + Prediction + Risk + Opp)   │
├──────────────────────────────────────────────────────────────┤
│ FASE 2  Cognitive Garbage Collection (Memory Curator)        │
│         Knowledge Conflict Resolution (5 strategies)         │
│         Agent Evaluation Layer (8 metrics + benchmarks)      │
│         Skill Registry (versioning + 3 default skills)       │
│         Code Intelligence (regex AST + Call Graph)           │
│         Knowledge Extraction (chunking + entity/relation)    │
│         Cognitive Router (classifier + local-first)          │
│         Event Mesh (NATS / Redis / in-memory)                │
│         Observability v2 (Langfuse export + dashboard)       │
├──────────────────────────────────────────────────────────────┤
│ FASE 1  Agent Runtime Kernel + Checkpointing (resume/replay) │
│         Memory Fabric (4 layers + semantic search)           │
│         GraphRAG (vector + graph + subgraph ranking)         │
│         Knowledge Provenance (enforced on every node)        │
│         Universal Context Graph (AGE + relational fallback)  │
│         PostgreSQL + AGE + pgvector (Docker Compose ready)   │
├──────────────────────────────────────────────────────────────┤
│ FASE 0.5  Entity Registry · Naming (URI scheme)              │
│           Provenance Schema · Event Taxonomy                 │
│           Agent Lifecycle schema · Knowledge-as-Claims       │
├──────────────────────────────────────────────────────────────┤
│ KERNEL   F1-F23 · LTL · ERL · ACTS · DynAMO · Sovereign     │
│ ESISTE   MCP · ECDSA · Next.js 16 · Prisma 6 · 158 test     │
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

- **496 test** in **31 file** (tutti passing)
- **+25 nuovi moduli** tra Fase 1+2+3+4
- **+13 nuove API routes** (totale 49 endpoint)
- **+1 nuova UI page** (`/autonomous`)
- **0 TypeScript errors** nei moduli nuovi
- **0 dipendenze native** aggiunte (tree-sitter sostituito con parser regex, NATS/Redis lazy-loaded opzionali)
