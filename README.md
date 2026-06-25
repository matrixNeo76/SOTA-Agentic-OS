# SOTA Agentic OS

> **INTELLIGENT · SECURE · AUTONOMOUS** — Un sistema operativo per agenti autonomi

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-146%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

SOTA Agentic OS è una piattaforma che orchestra agenti AI autonomi attraverso un kernel transazionale con verifica formale LTL, apprendimento riflessivo (ERL), steering cognitivo ACTS, e un ecosistema tool con firme crittografiche ECDSA.

---

## Indice

- [Panoramica](#panoramica)
- [Funzionalità](#funzionalità)
- [Stack Tecnologico](#stack-tecnologico)
- [Installazione — Windows](#installazione--windows)
- [Installazione — Linux](#installazione--linux)
- [Configurazione](#configurazione)
- [Avvio](#avvio)
- [Credenziali Default](#credenziali-default)
- [Struttura del Progetto](#struttura-del-progetto)
- [Testing](#testing)
- [Licenza](#licenza)

---

## Panoramica

SOTA Agentic OS trasforma un LLM in un **sistema operativo agentico** con:

- **Kernel transazionale** — operazioni atomiche con rollback (PatchBoard)
- **Verifica formale** — regole LTL (Linear Temporal Logic) enforce safety invariants
- **Apprendimento riflessivo** — ERL (Experience-Reflective Learning) estrae euristiche e Red Lines
- **Steering cognitivo** — ACTS (Adaptive Cognitive Task Steering) con 5 strategie
- **Sovereign Validator** — HITL (Human-In-The-Loop) per azioni irreversibili
- **Tool Ecosystem** — tool firmati ECDSA con permessi a grana fine
- **MCP Server/Client** — Model Context Protocol per interoperabilità con client esterni

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

### Ecosystem
- **Tool Manager** — Catalogo tool con firme ECDSA e permessi
- **Skill Manager** — Prompt templates riutilizzabili con variabili
- **MCP Explorer** — Connessioni a server MCP esterni

---

## Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Backend** | Next.js API Routes (37 route), Prisma 6 ORM |
| **Database** | SQLite (dev) / PostgreSQL (prod) |
| **LLM** | ZAI SDK (zai-glm) |
| **Embeddings** | @xenova/transformers (all-MiniLM-L6-v2, 384dim) |
| **WebSocket** | Socket.IO (Sensorium real-time) |
| **State** | Zustand (navigation + data-store) |
| **Testing** | Vitest (146 test) |
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
│   │   ├── api/                # 37 API routes
│   │   ├── login/              # Pagina login
│   │   ├── share/[token]/      # Conversazioni condivise
│   │   ├── globals.css         # Design system premium (OKLCH)
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # App shell (workbench)
│   ├── components/
│   │   ├── agentic/            # PhaseN + sidebar + topbar + overview
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
│   │   ├── stores/             # Zustand data-store + transfer-store
│   │   ├── design-tokens.ts    # Design system unificato
│   │   ├── store.ts            # Navigation store (Zustand)
│   │   ├── db.ts               # Prisma client
│   │   ├── redis.ts            # Redis client
│   │   └── embeddings.ts       # Neural embeddings (Xenova)
│   └── middleware.ts           # Auth gate server-side
├── prisma/
│   └── schema.prisma           # 62 modelli
├── tests/
│   ├── unit/                   # 6 file, 146 test
│   └── fixtures/               # Test fixtures
├── mini-services/
│   └── sensorium-ws/           # WebSocket server (Socket.IO)
├── download/                   # Documentazione + asset
├── package.json
└── README.md
```

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

I test coprono i moduli kernel critici: LTL monitor, normative, taint tracking, ERL, patchboard, embeddings, e i nuovi moduli Fase 1-4 (Context Graph, GraphRAG, Memory Fabric, Event Mesh, Cognitive Router, Code Intelligence, Skill Registry, Observability v2, Evaluation Layer, Conflict Resolution, Cognitive GC, World Model, Digital Twin, Agent Lifecycle, Agent Mesh, Skill Synthesis, Autonomous Org, Integration Layer).

**Stato attuale: 496 test passing su 31 file.**

---

## Fase 4 — Production Hardening & Integration

La Fase 4 completa la transizione da MVP a sistema production-ready, integrando il kernel esistente con i moduli delle Fasi 1-3:

### Moduli Fase 4

- **API Routes** — 13 nuovi endpoint REST espongono tutti i moduli Fase 1-3 (mesh, world-model, digital-twin, autonomous-org, agent-lifecycle, evaluation, conflict-resolution, cognitive-gc, cognitive-router, code-intelligence, skill-registry, skill-synthesis, knowledge-extraction)
- **Integration Layer** — `src/lib/integration/bridges.ts` collega il kernel esistente ai nuovi moduli:
  - AgentLog → Event Mesh → Context Graph (TaskCreated/Completed/Failed events diventano GraphNode)
  - ERL Heuristics → Skill Registry (euristiche mature diventano Skill auto-generate)
  - Autonomous Org → Sovereign Validator (proposals diventano BlockedAction per HITL)
- **Cockpit UI** — `/autonomous` page con dashboard unificata (mesh topology, world state, pending proposals, memory tiers)

### Avvio dell'Integration Layer

In produzione, avviare l'Integration Layer all'avvio del server:

```typescript
// next.config.ts o modulo bootstrap
import { startIntegrationLayer } from '@/lib/integration/bridges'

// Avvia i bridge di integrazione (Event Mesh subscribers)
await startIntegrationLayer()
// → context-graph-populator, erl-skill-bridge, autonomous-org-sovereign-bridge
```

### Endpoint API principali

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/agent-mesh` | GET, POST | Mesh topology + bootstrap/delegate/escalate/quorum |
| `/api/world-model` | GET, POST | WorldState capture + predictions |
| `/api/digital-twin` | GET, POST | Scenarios + run simulation + what-if presets |
| `/api/autonomous-org` | GET, POST | Proposals + approve/reject + auto-generate |
| `/api/agent-lifecycle` | GET, POST | Agent registration + versioning + permissions |
| `/api/evaluation` | GET, POST | Benchmarks + run evaluation + agent evaluations |
| `/api/conflict-resolution` | GET, POST | Pending conflicts + resolve + auto-resolve |
| `/api/cognitive-gc` | GET, POST | Memory stats + consolidate + decay + archive |
| `/api/cognitive-router` | GET, POST | Router stats + classify + plan + route |
| `/api/skill-registry` | GET, POST | Skills CRUD + search + version + seed |
| `/api/skill-synthesis` | GET, POST | Detect gaps + run pipeline |
| `/api/code-intelligence` | GET, POST | Parse + sync + analyze git diff |
| `/api/knowledge-extraction` | GET, POST | Extract document → Context Graph |

---

## Licenza

MIT — Libero uso personale e commerciale.

---

> **SOTA Agentic OS** — Operative Intelligence for Autonomous Agents
