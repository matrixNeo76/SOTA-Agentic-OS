# SOTA Agentic OS

> **INTELLIGENT · SECURE · AUTONOMOUS** — Un sistema operativo per agenti autonomi

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-533%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![Phases](https://img.shields.io/badge/phases-0.5%20%E2%86%92%206-blue)]()

SOTA Agentic OS è un **Cognitive Operating System** che orchestra agenti AI autonomi attraverso un kernel transazionale con verifica formale LTL, apprendimento riflessivo (ERL), steering cognitivo ACTS, ecosistema tool con firme crittografiche ECDSA, organizzazione autonoma gerarchica con HITL gates, World Model predittivo, Digital Twin per what-if analysis, e Skill Synthesis automatica.

---

## Indice

- [Panoramica](#panoramica)
- [Funzionalità](#funzionalità)
- [Architettura a Fasi](#architettura-a-fasi)
- [Stack Tecnologico](#stack-tecnologico)
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

- **Kernel transazionale** — operazioni atomiche con rollback (PatchBoard)
- **Verifica formale** — regole LTL (Linear Temporal Logic) enforce safety invariants
- **Apprendimento riflessivo** — ERL (Experience-Reflective Learning) estrae euristiche e Red Lines
- **Steering cognitivo** — ACTS (Adaptive Cognitive Task Steering) con 5 strategie
- **Sovereign Validator** — HITL (Human-In-The-Loop) per azioni irreversibili
- **Tool Ecosystem** — tool firmati ECDSA con permessi a grana fine
- **MCP Server/Client** — Model Context Protocol per interoperabilità con client esterni
- **Universal Context Graph** (Fase 1) — grafo knowledge su Apache AGE con provenance obbligatoria
- **GraphRAG** (Fase 1) — hybrid retrieval: vector search + graph expansion + subgraph ranking
- **Memory Fabric** (Fase 1) — 4 layers (episodic/semantic/procedural/reasoning) con consolidation
- **Event Mesh** (Fase 2) — pub/sub con NATS JetStream / Redis / in-memory
- **Cognitive Router** (Fase 2) — task classifier (Simple/Medium/Complex/Critical) + local-first routing
- **Skill Registry + Synthesis** (Fase 2+3) — catalogo con versioning + Meta Agent per auto-generazione
- **Evaluation Layer** (Fase 2) — 8 metriche (task_success_rate, tool_accuracy, hallucination_rate, etc.)
- **Conflict Resolution** (Fase 2) — detect claim conflicts + 5 resolution strategies
- **Cognitive GC** (Fase 2) — memory consolidation + decay + cold archival
- **World Model** (Fase 3) — WorldState + Prediction + Risk + Opportunity
- **Digital Twin** (Fase 3) — Fork + Simulation + 6 what-if presets
- **Hierarchical Agent Mesh** (Fase 3) — 10 agenti in 3 tier (CEO + 4 strategic + 5 operational)
- **Autonomous Organization** (Fase 3) — auto-creazione agenti/skill/workflow sotto HITL gates

---

## Funzionalità

### Console Agentica
Chat naturale → generazione piano DynAMO → esecuzione passo-passo → verifica LTL → apprendimento. Streaming SSE real-time con DAG visualizer.

### Cockpit
Control room con 5 tab: Narrativa, Log tecnico, Scheduler task, Cicli cognitivi, Safety actions. Widget persistenti per Sensorium e Telemetria Affettiva.

### 4 Domini Inspect
- **Memory & Context** — Memoria episodica, Context manager, Sessioni LLM
- **Plan & Execute** — DynAMO planner, Steering ACTS, Objective tree
- **Verify & Trust** — LTL & Taint, Trace validator, Lean4, Swarm quorum
- **Learn & Route** — Reflective learning, Affect monitor, Model router, Human retainer

### Workbench
- **Canvas** — DAG visualizer unificato (DynAMO, Objective Tree, Lean Workflow)
- **Timeline** — Traccia eventi con filtri per fase/agente/livello
- **Sovereign** — Azioni bloccate con risoluzione HITL
- **Command Palette** (Cmd+K) — 33+ comandi con fuzzy search
- **Context Panel** — Inspector context-aware con 4 modalità

### Autonomous Dashboard (Fase 4)
Dashboard unificata su `/autonomous` per visualizzare:
- Mesh gerarchica (agenti per tier)
- World Model (latest WorldState + pending predictions + risks + opportunities)
- Autonomous Org proposals (pending + stats + HITL approve/reject)
- Digital Twin scenarios + what-if presets
- Skill Registry + Synthesis stats
- Conflict Resolution queue
- Cognitive GC memory tiers (hot/warm/cold)

### Ecosystem
- **Tool Manager** — Catalogo tool con firme ECDSA e permessi
- **Skill Manager** — Prompt templates riutilizzabili con variabili
- **MCP Explorer** — Connessioni a server MCP esterni

---

## Architettura a Fasi

Il progetto evolve attraverso 5 livelli architetturali:

| Fase | Nome | Moduli | Stato |
|------|------|--------|-------|
| **0.5** | Governance Foundation | Entity Registry, Naming URI, Provenance, Event Taxonomy, Knowledge-as-Claims | ✅ |
| **1** | MVP Core | PostgreSQL+pgvector+AGE, Context Graph, GraphRAG, Memory Fabric, Checkpointing | ✅ |
| **2** | Enterprise Core | Event Mesh, Knowledge Extraction, Cognitive Router, Code Intelligence, Skill Registry, Observability v2, Evaluation, Conflict Resolution, Cognitive GC | ✅ |
| **3** | AGI-Oriented | World Model, Digital Twin, Agent Lifecycle, Agent Mesh, Skill Synthesis, Autonomous Org | ✅ |
| **4** | Production Hardening | 13 API routes, Integration Layer, Cockpit UI | ✅ |
| **ESISTE** | Kernel F1-F23 | LTL, ERL, ACTS, DynAMO, Sovereign, MCP, ECDSA, 25 moduli | ✅ |

Vedi `ARCHITECTURE.md` per il diagramma completo e `DIAGRAM.md` per i diagrammi Mermaid.

---

## Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Backend** | Next.js API Routes (49 route), Prisma 6 ORM |
| **Database** | SQLite (dev) / PostgreSQL + pgvector + Apache AGE (prod via AgensGraph) |
| **Message Bus** | NATS JetStream / Redis Streams / in-memory (auto-select via env) |
| **Observability** | OpenTelemetry traces + Langfuse self-host (export opzionale) |
| **LLM** | ZAI SDK (zai-glm) + local-first router (llama.cpp / Ollama opzionali) |
| **Embeddings** | @xenova/transformers (all-MiniLM-L6-v2, 384dim) + pgvector native |
| **WebSocket** | Socket.IO (Sensorium real-time) |
| **State** | Zustand (navigation + data-store) |
| **Testing** | Vitest (496 test su 31 file) |
| **Animation** | Framer Motion, tw-animate-css |
| **Icons** | Lucide React |

---

## Installazione — Windows

### Prerequisiti

1. **Node.js 20+** — https://nodejs.org/ (scarica LTS installer)
2. **Bun** — https://bun.sh/
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
3. **Git** — https://git-scm.com/download/win

### Step

```powershell
# 1. Clona il repository
git clone https://github.com/matrixNeo76/SOTA-Agentic-OS.git
cd SOTA-Agentic-OS

# 2. Installa dipendenze
bun install

# 3. Crea file .env
copy .env.example .env

# 4. Genera client Prisma
bun run db:generate

# 5. Inizializza database
bun run db:push

# 6. Avvia il server di sviluppo
bun run dev
```

Apri **http://localhost:3000** nel browser.

---

## Installazione — Linux

### Prerequisiti

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Git
sudo apt-get install -y git

# Build tools (per @xenova/transformers)
sudo apt-get install -y build-essential python3
```

### Step

```bash
# 1. Clona il repository
git clone https://github.com/matrixNeo76/SOTA-Agentic-OS.git
cd SOTA-Agentic-OS

# 2. Installa dipendenze
bun install

# 3. Crea file .env
cp .env.example .env

# 4. Genera client Prisma
bun run db:generate

# 5. Inizializza database
bun run db:push

# 6. Avvia il server di sviluppo
bun run dev
```

Apri **http://localhost:3000** nel browser.

---

## Configurazione

### File `.env`

```env
# Database (SQLite per dev, PostgreSQL per prod)
DATABASE_URL=file:./db/custom.db

# ZAI SDK (LLM)
ZAI_API_KEY=your-api-key-here

# WebSocket (Sensorium)
WS_PORT=3001

# Cost tracking budget (USD)
COST_BUDGET_WARN=1
COST_BUDGET_DANGER=5
```

### Database

Il progetto usa SQLite per sviluppo (zero configurazione). Per produzione, cambia `DATABASE_URL` a PostgreSQL:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/sota_os
```

Poi esegui:
```bash
bun run db:push
```

---

## Avvio

### Sviluppo

```bash
bun run dev          # Server di sviluppo (webpack)
bun run dev:turbo    # Server con Turbopack (più veloce, ma può avere bug CSS)
bun run dev:full     # Server + WebSocket Sensorium
```

### Produzione

```bash
bun run build        # Build ottimizzato
bun run start        # Avvia server di produzione
```

### Altri comandi

```bash
bun run lint         # ESLint
bun run test         # Vitest (146 test)
bun run test:watch   # Vitest in watch mode
bun run db:generate  # Genera client Prisma
bun run db:push      # Sincronizza schema DB
bun run db:reset     # Reset completo database
bun run db:backup    # Backup database
```

---

## Credenziali Default

Al primo avvio viene creato automaticamente un admin di default:

| Campo | Valore |
|-------|--------|
| **Email** | `admin@sota-os.local` |
| **Password** | `admin123` |

> **⚠️ Cambia queste credenziali in produzione!**

---

## Struttura del Progetto

```
SOTA-Agentic-OS/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # 49 API routes (36 kernel + 13 Fase 4)
│   │   ├── autonomous/         # Cockpit UI Fase 4 (Autonomous Dashboard)
│   │   ├── login/              # Pagina login
│   │   ├── share/[token]/      # Conversazioni condivise
│   │   ├── globals.css         # Design system premium (OKLCH)
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # App shell (workbench)
│   ├── components/
│   │   ├── agentic/            # PhaseN + sidebar + topbar + overview
│   │   ├── autonomous-dashboard/ # Fase 4.3 — Cockpit UI unificata
│   │   ├── console/            # Chat agentica decomposta
│   │   ├── cockpit/            # Control room (widget + tabs)
│   │   ├── canvas/             # DAG visualizer
│   │   ├── domains/            # 4 domini Inspect
│   │   ├── shared/             # 9 componenti condivisi
│   │   ├── blocked-action/     # Stili condivisi BlockedAction
│   │   ├── onboarding/         # Tour 5-step
│   │   ├── ui/                 # shadcn/ui premium
│   │   └── workbench/          # Workspace views + status bar + command palette
│   ├── hooks/                  # use-url-sync
│   ├── lib/
│   │   ├── auth/               # Session management + RBAC
│   │   ├── kernel/             # 25 moduli kernel (F1-F23)
│   │   ├── governance/         # Fase 0.5 — Entity Registry, Naming, Provenance, Event Taxonomy
│   │   ├── context-graph/      # Fase 1.2 — Re-export di graph-age
│   │   ├── graphrag/           # Fase 1.4 — Hybrid retrieval engine
│   │   ├── memory-fabric/      # Fase 1.5 — 4 layers memory
│   │   ├── checkpoint/         # Fase 1.6 — Resume/Replay/Rollback
│   │   ├── event-mesh/         # Fase 2.1 — NATS/Redis/memory pub/sub
│   │   ├── knowledge-extraction/ # Fase 2.2 — Document → Graph pipeline
│   │   ├── cognitive-router/   # Fase 2.3 — Task classifier + local-first
│   │   ├── code-intelligence/  # Fase 2.4 — AST + Call Graph
│   │   ├── skill-registry/     # Fase 2.5 — Catalogo skill
│   │   ├── observability-v2/   # Fase 2.6 — Langfuse export + dashboard
│   │   ├── evaluation/         # Fase 2.7 — Benchmark + metrics
│   │   ├── conflict-resolution/ # Fase 2.8 — Claim conflict engine
│   │   ├── cognitive-gc/       # Fase 2.9 — Memory curator
│   │   ├── world-model/        # Fase 3.1 — WorldState + Prediction
│   │   ├── digital-twin/       # Fase 3.2 — Fork + Simulation
│   │   ├── agent-lifecycle/    # Fase 3.3 — Versioning + permissions
│   │   ├── agent-mesh/         # Fase 3.4 — Hierarchical mesh (10 agents)
│   │   ├── skill-synthesis/    # Fase 3.5 — Meta Agent + sandbox
│   │   ├── autonomous-org/     # Fase 3.6 — Proposals + HITL gates
│   │   ├── integration/        # Fase 4.2 — Kernel ↔ Event Mesh bridges
│   │   ├── stores/             # Zustand data-store + transfer-store
│   │   ├── design-tokens.ts    # Design system unificato
│   │   ├── store.ts            # Navigation store (Zustand)
│   │   ├── db.ts               # Prisma client
│   │   ├── db-runtime.ts       # Fase 1.1 — Provider detection + pgvector/AGE
│   │   ├── vector-store.ts     # Fase 1.1 — Embeddings façade
│   │   ├── graph-age.ts        # Fase 1.2 — Context Graph façade
│   │   ├── redis.ts            # Redis client
│   │   └── embeddings.ts       # Neural embeddings (Xenova)
│   └── middleware.ts           # Auth gate server-side
├── prisma/
│   ├── schema.prisma           # 60+ modelli (SQLite, dev)
│   └── schema.postgres.prisma  # Fase 1.1 — PostgreSQL con pgvector nativo
├── tests/
│   ├── unit/                   # 31 file, 496 test
│   └── fixtures/               # Test fixtures
├── scripts/
│   ├── pg-bootstrap.sql        # Fase 1.1 — pgvector + AGE + indici
│   └── seed.py                 # Seed script
├── mini-services/
│   └── sensorium-ws/           # WebSocket server (Socket.IO)
├── docker-compose.yml          # Fase 1.1 — AgensGraph stack (PostgreSQL + AGE + pgvector)
├── download/                   # Documentazione + asset
├── AGENTS.md                   # Guida per LLM agenti
├── ARCHITECTURE.md             # Architettura tecnica (Fase 1-4 inclusa)
├── DIAGRAM.md                  # Diagrammi Mermaid
├── worklog.md                  # Cronologia sessioni (Fase 0.5 → 4)
├── package.json
└── README.md
```

---

## API Endpoints

Il sistema espone **49 API routes** (36 preesistenti + 13 nuove Fase 4). Tutte seguono il pattern: `GET` = stats/list, `POST` = action dispatcher con `{ action, ...params, provenance }`.

### Endpoint Fase 4 (moduli 1-3)

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/runtime` | GET | Runtime info: provider (sqlite/postgresql), extensions (pgvector, age), capabilities |
| `/api/mesh` | GET, POST | Event Mesh stats + publish events manually |
| `/api/world-model` | GET, POST | WorldState capture + predictions + risks + opportunities |
| `/api/digital-twin` | GET, POST | Scenarios + run simulation + 6 what-if presets |
| `/api/autonomous-org` | GET, POST | Proposals + approve/reject + auto-generate (HITL gated) |
| `/api/agent-mesh` | GET, POST | Mesh topology + bootstrap default (10 agents) + delegate/escalate/quorum |
| `/api/agent-lifecycle` | GET, POST | Agent registration + versioning + suspend/resume + check-permission |
| `/api/evaluation` | GET, POST | Benchmarks + run evaluation + agent evaluations + seed defaults |
| `/api/conflict-resolution` | GET, POST | Pending conflicts + resolve (5 strategies) + auto-resolve |
| `/api/cognitive-gc` | GET, POST | Memory stats + consolidate + decay update + archive cold |
| `/api/cognitive-router` | GET, POST | Router stats + classify + plan routing + route + local models health |
| `/api/code-intelligence` | GET, POST | Parse file + sync to graph + analyze git diff |
| `/api/skill-registry` | GET, POST | Skills CRUD + search + version + seed 3 defaults |
| `/api/skill-synthesis` | GET, POST | Detect skill gaps + run synthesis pipeline (HITL gated) |
| `/api/knowledge-extraction` | GET, POST | Extract document → chunks → entities → Context Graph |

### Endpoint Kernel esistenti (selezione)

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/console/stream` | POST (SSE) | Chat agentica con streaming real-time |
| `/api/dashboard` | GET | KPI globali (cost, agents, tasks, blocked) |
| `/api/blocked-actions` | GET, POST | Azioni bloccate da Sovereign Validator |
| `/api/plan` | GET, POST | DynAMO plan generation |
| `/api/verify` | GET, POST | LTL verification + taint tracking |
| `/api/reflect` | GET, POST | ERL reflective learning |
| `/api/cost` | GET | Cost tracking aggregato |
| `/api/metrics` | GET | Prometheus export |
| `/api/embeddings` | GET, POST | Embeddings management (recompute, search) |

Vedi `AGENTS.md` per il pattern uniforme e le convenzioni API.

---

## Testing

```bash
# Esegui tutti i test
bun run test

# Watch mode
bun run test:watch

# Con coverage
bun run test:coverage
```

I test coprono:

- **Moduli kernel critici** — LTL monitor, normative, taint tracking, ERL, patchboard, embeddings
- **Fase 1-6 moduli** — Context Graph, GraphRAG, Memory Fabric, Event Mesh, Cognitive Router, Code Intelligence, Skill Registry, Observability v2, Evaluation Layer, Conflict Resolution, Cognitive GC, World Model, Digital Twin, Agent Lifecycle, Agent Mesh, Skill Synthesis, Autonomous Org, Integration Layer, LLM Client, Skill Sandbox, Cache Layer
- **E2E integration tests** — pipeline completa (router → events → graph → mesh → skills → conflicts → evaluation → memory → autonomous org)

**Stato attuale: 533 test passing su 34 file.**

---

## MCP Server

Il sistema espone un **MCP Server** (Model Context Protocol) su `/api/mcp` per consentire a client esterni (Claude Desktop, Cursor, VS Code) di interrogare e controllare l'organizzazione autonoma.

### Metodi supportati (JSON-RPC 2.0)

| Metodo | Descrizione |
|--------|-------------|
| `initialize` | Handshake con capabilities + serverInfo |
| `tools/list` | Elenco di 20 tool disponibili |
| `tools/call` | Esecuzione tool con argomenti |
| `resources/list` | Elenco di 5 risorse (world-state, proposals, conflicts, mesh, skills) |
| `resources/read` | Lettura risorsa per URI |
| `prompts/list` | Elenco di 4 prompt template |
| `prompts/get` | Builda messaggi contextualized per il prompt richiesto |
| `completion/complete` | Auto-completamento argomenti (conflict URIs, agent URIs) |

### Tool principali

- **Monitoring**: `sota_mesh_stats`, `sota_world_model_latest`, `sota_cognitive_gc_stats`, `sota_llm_health`, `sota_context_graph_stats`
- **Actions**: `sota_world_model_capture`, `sota_world_model_predict`, `sota_digital_twin_whatif`, `sota_autonomous_org_approve`, `sota_conflict_resolution_resolve`, `sota_cognitive_gc_consolidate`, `sota_knowledge_extraction`
- **Queries**: `sota_autonomous_org_proposals`, `sota_agent_mesh_topology`, `sota_evaluation_stats`, `sota_conflict_resolution_list`, `sota_cognitive_router_classify`, `sota_skill_registry_search`, `sota_skill_synthesis_detect`, `sota_memory_search`

### Esempio di utilizzo

```bash
# List tools
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Capture WorldState
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sota_world_model_capture","arguments":{}}}'
```

Per configurare Claude Desktop o Cursor, aggiungi l'endpoint `http://localhost:3000/api/mcp` come MCP server nelle impostazioni del client.

---

## Fasi di Evoluzione

Il progetto evolve attraverso 7 livelli architetturali. Ogni fase estende il kernel esistente senza riscriverlo.

### Fase 0.5 — Governance Foundation

Schema-first: Entity Registry (25 entity types), Naming URI (`agent://`, `task://`, `skill://`), Provenance Schema (obbligatoria), Event Taxonomy (33 event types), Agent Lifecycle schema, Knowledge-as-Claims schema.

### Fase 1 — MVP Core (6 moduli)

PostgreSQL + pgvector + Apache AGE (Docker Compose ready), Context Graph (façade graph-age.ts), GraphRAG (hybrid retrieval), Memory Fabric (4 layers + consolidation), Checkpointing (resume/replay/rollback), db-runtime + vector-store façades.

### Fase 2 — Enterprise Core (9 moduli)

Event Mesh (NATS/Redis/in-memory), Knowledge Extraction, Cognitive Router (task classifier + local-first), Code Intelligence (AST + Call Graph), Skill Registry (versioning + 3 defaults), Observability v2 (Langfuse export + dashboard), Evaluation Layer (8 metrics), Conflict Resolution (5 strategies), Cognitive GC (consolidation + decay + archival).

### Fase 3 — AGI-Oriented (6 moduli)

World Model (WorldState + Prediction + Risk + Opportunity), Digital Twin (Fork + Simulation + 6 what-if presets), Agent Lifecycle (versioning + roles + capabilities + policies + permission check), Agent Mesh (10 agenti in 3 tier: CEO + 4 strategic + 5 operational), Skill Synthesis (Meta Agent + sandbox + validation + HITL), Autonomous Org (proposals + auto-generators + HITL gates).

### Fase 4 — Production Hardening (3 componenti)

13 API routes REST per esporre tutti i moduli Fase 1-3, Integration Layer (`src/lib/integration/bridges.ts` con 3 bridge: ContextGraph populator, ERL→Skill, AutonomousOrg→Sovereign), Cockpit UI (`/autonomous` page con dashboard unificata + Digital Twin panel + Conflict Queue panel).

### Fase 5 — Real LLM Integration & MCP Exposure

LLM Client unificato (`src/lib/llm-client/client.ts`) con retry, fallback, cost tracking, 5 helper specializzati (skill generation, task classification, heuristic extraction, prediction, conflict explanation). Cognitive Router ed ERL ora LLM-based con fallback rule-based. MCP Server su `/api/mcp` con 20 tools, 5 resources, 4 prompts.

### Fase 6 — Production Readiness & E2E Validation

E2E integration tests (`tests/e2e/pipeline.test.ts` — 10 test pipeline completa), Skill Sandbox (`src/lib/skill-sandbox/sandbox.ts` con resource limits + forbidden patterns + audit trail), MCP Completions (`prompts/get` + `completion/complete` per full MCP spec compliance), Production Deployment (`scripts/prod-bootstrap.sh` + `docker-compose.yml` con AgensGraph + NATS + Langfuse + Redis), Cache Layer (`src/lib/cache/cache.ts` LRU con TTL + invalidation automatica).

### Avvio dell'Integration Layer

In produzione, avviare l'Integration Layer all'avvio del server:

```typescript
// next.config.ts o modulo bootstrap
import { startIntegrationLayer } from '@/lib/integration/bridges'

// Avvia i bridge di integrazione (Event Mesh subscribers)
await startIntegrationLayer()
// → context-graph-populator, erl-skill-bridge, autonomous-org-sovereign-bridge
```

### Production Deployment

```bash
# Avvio completo stack produzione (PostgreSQL + NATS + Langfuse + opzionale Redis)
./scripts/prod-bootstrap.sh [--with-redis]

# Health check di tutti i servizi
./scripts/health-check.sh

# Stack Docker Compose completo
docker compose up -d
# → sota-postgres (AgensGraph) + sota-nats (JetStream) + sota-langfuse
```

Vedi `docker-compose.yml` per la configurazione completa e `scripts/prod-bootstrap.sh` per l'automazione.

---

## Licenza

MIT — Libero uso personale e commerciale.

---

> **SOTA Agentic OS** — Operative Intelligence for Autonomous Agents
