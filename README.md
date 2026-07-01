# SOTA Agentic OS

> **INTELLIGENT · SECURE · AUTONOMOUS** — Un Cognitive Operating System per agenti autonomi

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-538%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![Phases](https://img.shields.io/badge/phases-0.5%20%E2%86%92%206%20%2B%20INTEROP-blue)]()

SOTA Agentic OS è un **Cognitive Operating System** che orchestra agenti AI autonomi attraverso un kernel transazionale con verifica formale LTL, apprendimento riflessivo (ERL), steering cognitivo ACTS, ecosistema tool con firme crittografiche ECDSA, organizzazione autonoma gerarchica con HITL gates, World Model predittivo, Digital Twin per what-if analysis, Skill Synthesis automatica, **executor durevole** con recovery dopo crash, e **interoperabilità completa** con agenti esterni via MCP + A2A + REST + API key.

---

## Indice

- [Panoramica](#panoramica)
- [Funzionalità](#funzionalità)
- [Architettura a Fasi](#architettura-a-fasi)
- [Stack Tecnologico](#stack-tecnologico)
- [Interoperabilità](#interoperabilità)
- [Installazione — Windows](#installazione--windows)
- [Installazione — Linux](#installazione--linux)
- [Configurazione](#configurazione)
- [Avvio](#avvio)
- [Credenziali Default](#credenziali-default)
- [Struttura del Progetto](#struttura-del-progetto)
- [API Endpoints](#api-endpoints)
- [MCP Server](#mcp-server)
- [Testing](#testing)
- [Fasi di Evoluzione](#fasi-di-evoluzione)
- [Licenza](#licenza)

---

## Panoramica

SOTA Agentic OS trasforma un LLM in un **Cognitive Operating System** con:

**Kernel core (F1-F23):**
- **Kernel transazionale** — operazioni atomiche con rollback (PatchBoard)
- **Verifica formale** — regole LTL enforce safety invariants
- **Apprendimento riflessivo** — ERL estrae euristiche e Red Lines
- **Steering cognitivo** — ACTS con 5 strategie
- **Sovereign Validator** — HITL per azioni irreversibili
- **Tool Ecosystem** — tool firmati ECDSA con permessi a grana fine
- **MCP Server/Client** — interoperabilità con client esterni

**Cognitive OS (Fase 1-6):**
- **Universal Context Graph** — grafo knowledge su Apache AGE con provenance obbligatoria
- **GraphRAG** — hybrid retrieval: vector search + graph expansion + subgraph ranking
- **Memory Fabric** — 4 layers (episodic/semantic/procedural/reasoning) con consolidation
- **Event Mesh** — pub/sub con NATS JetStream / Redis / in-memory
- **Cognitive Router** — task classifier + local-first routing
- **Skill Registry + Synthesis** — catalogo con versioning + Meta Agent per auto-generazione
- **Evaluation Layer** — 8 metriche (task_success_rate, tool_accuracy, hallucination_rate, etc.)
- **Conflict Resolution** — detect claim conflicts + 5 resolution strategies
- **World Model** — WorldState + Prediction + Risk + Opportunity
- **Digital Twin** — Fork + Simulation + 6 what-if presets
- **Hierarchical Agent Mesh** — 10 agenti in 3 tier (CEO + 4 strategic + 5 operational)
- **Autonomous Organization** — auto-creazione agenti/skill/workflow sotto HITL gates

**Runtime & Interop (PLAN.md + PLAN-INTEROP.md):**
- **Executor durevole** — macchina a stati persistente, checkpoint, recovery dopo crash, loop ReAct con tool reali
- **Worker persistente** — coda JobRecord, dispatch parallelo nei batch, sempre attivo
- **API Key M2M** — auth con scopes (read/exec/admin) per agenti esterni
- **MCP Server** — 27 tool via JSON-RPC 2.0, auth, Run/executor + scritture governate
- **A2A Protocol** — agent card su `/.well-known/agent.json`, task lifecycle asincrono
- **Skills export/import** — SKILL.md format per Claude Code, discovery endpoint
- **OpenAPI 3.0** — spec generata per SDK autogenerati
- **Multi-tenant** — scoping, audit ledger, rate limiting, quota enforcement

---

## Funzionalità

### Console Agentica (Runs)
Crea ed esegui workflow in linguaggio naturale → generazione piano DynAMO → esecuzione step-by-step con loop ReAct (pensa → chiama tool → osserva → ripeti). Streaming SSE real-time, timeline per batch, trace dei tool-call, controlli checkpoint/resume/rollback, HITL in tempo reale. I workflow sono **durevoli**: riprendono dopo un crash.

### Admin Panel (`/admin`)
6 tab completi: Settings (DB, LLM, Event Mesh, Langfuse), Runtime (worker, jobs, recovery), Tools (builtin + registrati + MCP, tester), Governance (RedLines, LTL, Blocked Actions con HITL approve/reject), Memory (Context Graph browser, semantic search), Users (gestione utenti, ruoli, sessioni).

### Autonomous Dashboard (`/autonomous` → integrato nel workbench)
Dashboard unificata: mesh topology per tier, world state, pending proposals, digital twin what-if, conflict queue, memory tiers.

### 6 Aree di Navigazione (UX-1)
1. **Dashboard** — overview + KPI + activity
2. **Runs** — esegui workflow + console + HITL live
3. **Memory & Knowledge** — Context Graph + memoria + extraction
4. **Agents & Org** — mesh + lifecycle + skills + autonomous org
5. **Trust & Governance** — LTL + conflicts + sovereign/HITL + audit
6. **Insights** — world model + digital twin + evaluation

Le vecchie "fasi" 1-14 sono sotto **Advanced / Internals** (collassabili).

### Ecosystem
- **Tool Manager** — Catalogo tool con firme ECDSA e permessi
- **Skill Manager** — Prompt templates riutilizzabili con variabili
- **MCP Explorer** — Connessioni a server MCP esterni

---

## Architettura a Fasi

Il progetto evolve attraverso 3 piani architetturali:

### PLAN.md — Runtime & Production

| Fase | Nome | Stato |
|------|------|-------|
| **WS0** | Sblocco produzione (fix build + DB path configurabile) | ✅ |
| **WS1** | Runtime Executor durevole (state machine, checkpoint, recovery, ReAct loop, tool reali, MCP client, worker persistente) | ✅ |
| **WS2** | Pannello Admin & Settings (6 tab con HITL) | ✅ |

### PLAN-UIUX.md — Interfaccia SOTA

| Workstream | Nome | Stato |
|-----------|------|-------|
| **UX-1** | IA unificata: 6 aree per obiettivo | ✅ |
| **UX-2+8** | Copertura moduli + ModulePage pattern | ✅ |
| **UX-3** | Superficie Runs + HITL live | ✅ |
| **UX-4** | Admin/Settings nel workbench | ✅ |
| **UX-5** | Elevazione visuale (ombre, motion, data-viz) | ✅ |
| **UX-6** | Onboarding + empty states + AI suggestions | ✅ |
| **UX-7** | Responsive + a11y + ARIA | ✅ |

### PLAN-INTEROP.md — Interoperabilità esterna

| Workstream | Nome | Stato |
|-----------|------|-------|
| **IO-0** | Auth M2M (API key + scopes + Bearer) | ✅ |
| **IO-1** | MCP production-grade (27 tool, auth) | ✅ |
| **IO-2** | A2A (agent card + task lifecycle) | ✅ |
| **IO-3** | Skills packaging (SKILL.md export/import) | ✅ |
| **IO-4** | OpenAPI 3.0 spec | ✅ |
| **IO-5** | Backplane mode (guida Claude Code) | ✅ |
| **IO-6** | Multi-tenant (scoping + audit + rate limit) | ✅ |
| **IO-7** | Docs quickstart (7 client, 3 linguaggi) | ✅ |

### Fasi architetturali precedenti

| Fase | Nome | Moduli |
|------|------|--------|
| **0.5** | Governance Foundation | Entity Registry, Naming URI, Provenance, Event Taxonomy |
| **1** | MVP Core | PostgreSQL+pgvector+AGE, Context Graph, GraphRAG, Memory Fabric, Checkpointing |
| **2** | Enterprise Core | Event Mesh, Knowledge Extraction, Cognitive Router, Code Intelligence, Skill Registry, Observability, Evaluation, Conflict Resolution, Cognitive GC |
| **3** | AGI-Oriented | World Model, Digital Twin, Agent Lifecycle, Agent Mesh, Skill Synthesis, Autonomous Org |
| **4** | Production Hardening | API routes, Integration Layer, Cockpit UI |
| **5** | Real LLM Integration | LLM Client, MCP Server, Extended UI |
| **6** | Production Readiness | E2E tests, Sandbox, MCP Completions, Cache Layer |
| **ESISTE** | Kernel F1-F23 | LTL, ERL, ACTS, DynAMO, Sovereign, MCP, ECDSA |

Vedi `ARCHITECTURE.md` per il diagramma completo e `DIAGRAM.md` per i diagrammi Mermaid.

---

## Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Backend** | Next.js API Routes (70 route), Prisma 6 ORM |
| **Database** | SQLite (dev) / PostgreSQL + pgvector + Apache AGE (prod via AgensGraph) |
| **Message Bus** | NATS JetStream / Redis Streams / in-memory (auto-select via env) |
| **Observability** | OpenTelemetry traces + Langfuse self-host (export opzionale) |
| **LLM** | ZAI SDK (zai-glm) + local-first router (llama.cpp / Ollama opzionali) |
| **Embeddings** | @xenova/transformers (all-MiniLM-L6-v2, 384dim) + pgvector native |
| **WebSocket** | Socket.IO (Sensorium real-time) |
| **State** | Zustand (navigation + data-store) |
| **Testing** | Vitest (538 test su 35 file) |
| **Data-viz** | Recharts (cost/token/latency/evaluation trends) |
| **Graph viz** | ReactFlow (DAG, mesh topology) |
| **Animation** | Framer Motion, tw-animate-css |
| **Icons** | Lucide React |

---

## Interoperabilità

L'OS è progettato come **backplane** per agenti esterni (Claude Code, Cursor, VS Code, Antigravity):

### Protocolli supportati

| Protocollo | Endpoint | Auth | Use case |
|-----------|----------|------|----------|
| **MCP** | `/api/mcp` (JSON-RPC 2.0) | API key | IDE agentici (Claude Code, Cursor, VS Code) |
| **A2A** | `/.well-known/agent.json` + `/api/a2a/tasks` | API key (exec) | Delega agente↔agente |
| **REST** | 70 endpoint | API key o session cookie | Accesso programmatico generico |
| **OpenAPI** | `/api/openapi` | — | Generazione SDK (TS/Python/Go/etc.) |

### Auth machine-to-machine

API key con scopes granulari:
- `read` — query e monitoring
- `exec` — esecuzione workflow, scritture in memoria/grafo
- `admin` — gestione completa (utenti, API keys, governance)

Formato: `sak_<keyId>_<secret>` via header `Authorization: Bearer`

### Quickstart

Vedi `docs/quickstart.md` per guide copia-incolla (7 client, 3 linguaggi) e `docs/backplane-claude-code.md` per la guida Claude Code completa.

---

## Installazione — Windows

### Prerequisiti
1. **Node.js 20+** — https://nodejs.org
2. **Bun** — `powershell -c "irm bun.sh/install.ps1 | iex"`
3. **Git** — https://git-scm.com/download/win

### Step
```powershell
git clone https://github.com/matrixNeo76/SOTA-Agentic-OS.git
cd SOTA-Agentic-OS
bun install
# Crea file .env (opzionale — default usa SQLite)
cp .env.example .env
bun run db:generate
bun run db:push
bun run dev
```

---

## Installazione — Linux

### Prerequisiti
1. **Node.js 20+** — `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`
2. **Bun** — `curl -fsSL https://bun.sh/install | bash`
3. **Git** — `sudo apt install git`

### Step
```bash
git clone https://github.com/matrixNeo76/SOTA-Agentic-OS.git
cd SOTA-Agentic-OS
bun install
cp .env.example .env
bun run db:generate
bun run db:push
bun run dev
```

---

## Configurazione

### File `.env`
Vedi `.env.example` per tutti i parametri. In assenza di `.env`, l'app gira con i default (zero config).

### Database
- **SQLite** (default dev): nessuna configurazione, DB in `db/custom.db`
- **PostgreSQL + pgvector + AGE** (prod): `DATABASE_URL=postgresql://sota:sota@localhost:5432/sota` + `docker compose up -d postgres` + `./scripts/prod-bootstrap.sh`

---

## Avvio

### Sviluppo
```bash
bun run dev          # http://localhost:3000
```

### Produzione
```bash
./scripts/prod-bootstrap.sh [--with-redis]  # Setup completo Docker
bun run build
bun run start
```

### Health check
```bash
./scripts/health-check.sh
```

---

## Credenziali Default

```
URL: http://localhost:3000
Email: admin@sota-os.local
Password: admin123
```

> **⚠️ Cambia queste credenziali in produzione!**

---

## Struttura del Progetto

```
SOTA-Agentic-OS/
├── src/
│   ├── app/
│   │   ├── api/                # 70 API routes (REST + MCP + A2A + admin)
│   │   ├── admin/              # Admin panel (6 tab)
│   │   ├── autonomous/         # Autonomous dashboard (integrata nel workbench)
│   │   ├── .well-known/        # A2A agent card
│   │   ├── login/              # Pagina login
│   │   ├── share/[token]/      # Conversazioni condivise
│   │   └── page.tsx            # App shell (workbench con 6 aree)
│   ├── components/
│   │   ├── agentic/            # Sidebar + Topbar + Overview + MobileNav
│   │   ├── autonomous-dashboard/ # Digital Twin + Conflict Queue panels
│   │   ├── console/            # Chat agentica (8 file)
│   │   ├── cockpit/            # Control room (widget + tabs)
│   │   ├── canvas/             # DAG visualizer (reactflow)
│   │   ├── data-viz/           # Recharts: cost/token/latency/evaluation
│   │   ├── domains/            # 4 domini Inspect (legacy advanced)
│   │   ├── module-pages/       # ModulePage pattern + RunsView + MemoryView + AgentsView
│   │   ├── onboarding/         # Tour 5-step + AI suggestions
│   │   ├── shared/             # 9 componenti condivisi + DynamicIcon (52 icone)
│   │   ├── ui/                 # shadcn/ui premium
│   │   └── workbench/          # Workspace views + status bar + command palette
│   ├── hooks/                  # use-url-sync
│   ├── lib/
│   │   ├── a2a/                # IO-2 — A2A protocol (agent card + task lifecycle)
│   │   ├── agent-lifecycle/    # Fase 3.3 — Versioning + permissions
│   │   ├── agent-mesh/         # Fase 3.4 — Hierarchical mesh (10 agents)
│   │   ├── auth/               # Session + RBAC + requireAdmin + API key + multi-tenant
│   │   ├── autonomous-org/     # Fase 3.6 — Proposals + HITL gates
│   │   ├── cache/              # LRU cache con TTL + invalidation
│   │   ├── checkpoint/         # Fase 1.6 — Resume/Replay/Rollback
│   │   ├── cognitive-gc/       # Fase 2.9 — Memory curator + scheduler
│   │   ├── cognitive-router/   # Fase 2.3 — Task classifier + local-first + LLM
│   │   ├── code-intelligence/  # Fase 2.4 — AST + Call Graph + git diff
│   │   ├── conflict-resolution/ # Fase 2.8 — Claim conflicts + 5 strategies
│   │   ├── context-graph/      # Fase 1.2 — Re-export di graph-age
│   │   ├── db-runtime.ts       # Fase 1.1 — Provider detection + pgvector/AGE
│   │   ├── db.ts               # Prisma client (DB path configurabile)
│   │   ├── digital-twin/       # Fase 3.2 — Fork + Simulation + 6 presets
│   │   ├── evaluation/         # Fase 2.7 — Benchmark + 8 metrics
│   │   ├── event-mesh/         # Fase 2.1 — NATS/Redis/memory pub/sub
│   │   ├── governance/         # Fase 0.5 — Entity Registry, Naming, Provenance, Events
│   │   ├── graph-age.ts        # Fase 1.2 — Context Graph façade (Cypher/Prisma)
│   │   ├── graphrag/           # Fase 1.4 — Hybrid retrieval engine
│   │   ├── integration/        # Fase 4.2 — Kernel ↔ Event Mesh bridges
│   │   ├── kernel/             # 25 moduli kernel (F1-F23)
│   │   ├── knowledge-extraction/ # Fase 2.2 — Document → Graph pipeline
│   │   ├── llm-client/         # Fase 5.1 — LLM façade (ZAI SDK + fallback)
│   │   ├── mcp-client/         # Fase 5.4 — MCP client per tool esterni
│   │   ├── memory-fabric/      # Fase 1.5 — 4 layers + semantic search
│   │   ├── observability-v2/   # Fase 2.6 — Langfuse export + dashboard
│   │   ├── runtime/            # WS1 — Executor durevole + ReAct loop + tool dispatcher + builtin tools
│   │   ├── skill-registry/     # Fase 2.5 — Catalogo + versioning + export/import
│   │   ├── skill-sandbox/      # Fase 6.2 — Sandbox con resource limits
│   │   ├── skill-synthesis/    # Fase 3.5 — Meta Agent + sandbox + validation
│   │   ├── stores/             # Zustand data-store + transfer-store
│   │   ├── vector-store.ts     # Fase 1.1 — Embeddings façade
│   │   ├── world-model/        # Fase 3.1 — WorldState + Prediction + Risk
│   │   └── ...                 # design-tokens, store, utils, validation, ws-publish
│   └── instrumentation.ts      # WS1.5 — Avvia worker + integration + GC + recovery
├── prisma/
│   ├── schema.prisma           # 60+ modelli (SQLite, dev)
│   └── schema.postgres.prisma  # PostgreSQL con pgvector nativo
├── tests/
│   ├── unit/                   # 31 file, 528 test
│   └── e2e/                    # 1 file, 10 test E2E pipeline completa
├── docs/
│   ├── quickstart.md           # Guide per 7 client (Claude Code, Cursor, VS Code, ...)
│   └── backplane-claude-code.md # Guida Claude Code backplane mode
├── scripts/
│   ├── pg-bootstrap.sql        # pgvector + AGE + indici
│   ├── prod-bootstrap.sh       # Setup completo Docker
│   ├── health-check.sh         # Verifica tutti i servizi
│   └── ...
├── docker-compose.yml          # AgensGraph + NATS + Langfuse + Redis
├── AGENTS.md                   # Guida per LLM agenti
├── ARCHITECTURE.md             # Architettura tecnica
├── DIAGRAM.md                  # Diagrammi Mermaid
├── PLAN.md                     # Piano runtime
├── PLAN-UIUX.md                # Piano UI/UX
├── PLAN-INTEROP.md             # Piano interoperabilità
├── worklog.md                  # Cronologia sessioni
└── README.md
```

---

## API Endpoints

Il sistema espone **70 API routes** in 3 categorie:

### Interop (IO-0→IO-7)

| Endpoint | Metodo | Auth | Descrizione |
|----------|--------|------|-------------|
| `/api/mcp` | POST | API key | MCP JSON-RPC 2.0 (27 tool) |
| `/.well-known/agent.json` | GET | public | A2A agent card |
| `/api/a2a/tasks` | POST, GET | exec/read | A2A task submit/status/cancel |
| `/api/openapi` | GET | public | OpenAPI 3.0 spec |
| `/api/skills/export` | GET | read | Export skill SKILL.md/JSON |
| `/api/skills/import` | POST | exec | Import skill esterna |
| `/api/skills/discover` | GET | read | Skill discovery catalog |
| `/api/admin/api-keys` | GET, POST | admin | API key management |
| `/api/admin/audit` | GET | admin | Audit trail esterno |
| `/api/admin/quotas` | GET | admin | Quota usage per tenant |

### Runs & Admin (WS1+WS2)

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/runs/list` | GET | Lista workflow runs |
| `/api/runs/detail` | GET | Run detail con tasks/checkpoints/traces |
| `/api/runs/checkpoint` | POST | Rollback/resume checkpoint |
| `/api/admin/settings` | GET, POST | System configuration |
| `/api/admin/runtime` | GET, POST | Worker status + recover/GC |
| `/api/admin/tools` | GET, POST | Tool management + tester |
| `/api/admin/governance` | GET, POST | RedLines + HITL + LTL |
| `/api/admin/memory` | GET, POST | Graph browser + semantic search |
| `/api/admin/users` | GET, POST | User management |

### Fase 1-6 moduli

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/runtime` | GET | DB provider + extensions |
| `/api/mesh` | GET, POST | Event Mesh stats + publish |
| `/api/world-model` | GET, POST | WorldState + predictions |
| `/api/digital-twin` | GET, POST | Scenarios + what-if presets |
| `/api/autonomous-org` | GET, POST | Proposals + HITL |
| `/api/agent-mesh` | GET, POST | Mesh topology + delegate |
| `/api/agent-lifecycle` | GET, POST | Versioning + permissions |
| `/api/evaluation` | GET, POST | Benchmarks + run evaluation |
| `/api/conflict-resolution` | GET, POST | Conflicts + resolve |
| `/api/cognitive-gc` | GET, POST | Memory consolidation + archival |
| `/api/cognitive-router` | GET, POST | Classify + plan routing |
| `/api/code-intelligence` | GET, POST | Parse + sync + git diff |
| `/api/skill-registry` | GET, POST | Skills CRUD + search |
| `/api/skill-synthesis` | GET, POST | Detect gaps + pipeline |
| `/api/knowledge-extraction` | GET, POST | Extract document → Graph |

---

## MCP Server

Il sistema espone un **MCP Server** su `/api/mcp` con **27 tool** via JSON-RPC 2.0.

### Metodi supportati

`initialize` · `tools/list` · `tools/call` · `resources/list` · `resources/read` · `prompts/list` · `prompts/get` · `completion/complete`

### Tool per categoria

- **Runs**: `sota_run_create`, `sota_run_list`, `sota_run_detail`, `sota_run_recover`
- **Memory**: `sota_memory_store`, `sota_memory_search`
- **Graph**: `sota_graph_create_node`, `sota_graph_create_edge`, `sota_context_graph_stats`
- **World Model**: `sota_world_model_capture/latest/predict`
- **Digital Twin**: `sota_digital_twin_whatif`
- **Autonomous Org**: `sota_autonomous_org_proposals/approve`
- **Agent Mesh**: `sota_agent_mesh_topology`
- **Governance**: `sota_conflict_resolution_list/resolve`
- **System**: `sota_mesh_stats`, `sota_llm_health`, `sota_cognitive_gc_stats/consolidate`
- **Skills**: `sota_skill_registry_search`, `sota_skill_synthesis_detect`
- **Knowledge**: `sota_knowledge_extraction`
- **Router**: `sota_cognitive_router_classify`
- **Evaluation**: `sota_evaluation_stats`

### Configurazione client

Vedi `docs/quickstart.md` per guide specifiche (Claude Code, Cursor, VS Code, Antigravity).

---

## Testing

```bash
bun run test           # Esegui tutti i test
bun run test:watch     # Watch mode
bun run test:coverage  # Con coverage
```

I test coprono:

- **Moduli kernel critici** — LTL monitor, normative, taint tracking, ERL, patchboard, embeddings
- **Fase 1-6 moduli** — Context Graph, GraphRAG, Memory Fabric, Event Mesh, Cognitive Router, Code Intelligence, Skill Registry, Observability, Evaluation, Conflict Resolution, Cognitive GC, World Model, Digital Twin, Agent Lifecycle, Agent Mesh, Skill Synthesis, Autonomous Org, Integration Layer, LLM Client, Skill Sandbox, Cache Layer
- **E2E integration tests** — pipeline completa (router → events → graph → mesh → skills → conflicts → evaluation → memory → autonomous org)

**Stato attuale: 538 test passing su 35 file.**

---

## Fasi di Evoluzione

Il progetto evolve attraverso 3 piani architetturali (tutti completati):

### PLAN.md — Runtime & Production (WS0-WS2)
- **WS0**: Fix build (redis/nats optional) + DB path configurabile
- **WS1**: Executor durevole (state machine persistente, checkpoint+recovery, loop ReAct con tool reali, MCP client, worker persistente con coda JobRecord + dispatch parallelo)
- **WS2**: Pannello Admin (6 tab: Settings, Runtime, Tools, Governance, Memory, Users con HITL)

### PLAN-UIUX.md — Interfaccia SOTA (UX-1→UX-8)
- **UX-1**: 6 aree per obiettivo (Dashboard, Runs, Memory, Agents, Governance, Insights) + Advanced/Internals collassabile
- **UX-2+8**: ModulePage pattern standardizzato + MemoryKnowledgeView + AgentsOrgView
- **UX-3**: Runs list + detail con timeline/ReAct traces/checkpoint/rollback
- **UX-5**: Ombre soft, motion, glass, tabular nums, data-viz recharts (5 chart types)
- **UX-6**: Onboarding tour 5-step + AI suggestion primitive + empty states
- **UX-7**: ARIA roles, reduced-motion, focus-visible, MobileNav rivista

### PLAN-INTEROP.md — Interoperabilità (IO-0→IO-7)
- **IO-0**: API key con scopes (read/exec/admin) + Bearer token
- **IO-1**: MCP 27 tool con Run/executor + scritture governate + auth
- **IO-2**: A2A agent card + task lifecycle asincrono
- **IO-3**: Skills export SKILL.md/JSON + import + discovery
- **IO-4**: OpenAPI 3.0 spec per SDK autogenerati
- **IO-5**: Backplane mode guida Claude Code
- **IO-6**: Multi-tenant scoping + audit ledger + rate limiting + quota
- **IO-7**: Docs quickstart per 7 client in 3 linguaggi

### Production Deployment

```bash
# Setup completo (PostgreSQL + NATS + Langfuse + opzionale Redis)
./scripts/prod-bootstrap.sh [--with-redis]

# Health check
./scripts/health-check.sh

# Docker Compose
docker compose up -d
```

---

## Licenza

MIT — Libero uso personale e commerciale.

---

> **SOTA Agentic OS** — Cognitive Operating System for Autonomous Agents
