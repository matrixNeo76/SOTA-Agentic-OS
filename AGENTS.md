# AGENTS.md — Guida per LLM Agenti

> Questo file aiuta i modelli LLM a comprendere rapidamente la struttura, le convenzioni e i pattern del progetto per lavorare in modo efficace.

---

## Identità del Progetto

**SOTA Agentic OS** — Cognitive Operating System per agenti autonomi con kernel transazionale, verifica formale LTL, apprendimento riflessivo, e organizzazione autonoma governata da HITL.

**Stack:** Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Prisma 6 + ZAI SDK + Socket.IO

**Evoluzione architetturale:**
- **Kernel esistente (F1-F23):** 25 moduli core con LTL, ERL, ACTS, DynAMO, Sovereign, MCP, ECDSA
- **Fase 0.5:** Governance Foundation (Entity Registry, Naming URI, Provenance, Event Taxonomy, Knowledge-as-Claims)
- **Fase 1:** MVP Core (PostgreSQL+pgvector+AGE, Context Graph, GraphRAG, Memory Fabric, Checkpointing)
- **Fase 2:** Enterprise Core (Event Mesh, Knowledge Extraction, Cognitive Router, Code Intelligence, Skill Registry, Observability v2, Evaluation, Conflict Resolution, Cognitive GC)
- **Fase 3:** AGI-Oriented (World Model, Digital Twin, Agent Lifecycle, Agent Mesh, Skill Synthesis, Autonomous Org)
- **Fase 4:** Production Hardening (13 API routes, Integration Layer, Cockpit UI)

---

## Regole Fondamentali

### 1. Sempre committare
Dopo ogni modifica significativa, eseguire `git add -A && git commit -m "descrizione"`. Il container può riavviarsi e perdere il lavoro non committato.

### 2. Verificare prima di committare
```bash
bunx tsc --noEmit   # 0 errori TypeScript
bun run lint         # 0 errori ESLint
bun run test         # Tutti i test passano (496 test su 31 file)
bun run build        # Build successful
```

### 3. Usare il dev server webpack (non turbopack)
```bash
bun run dev          # USA QUESTO (--webpack)
bun run dev:turbo    # NON USARE (bug CSS con @utility custom)
```

### 4. Tailwind v4 — no tailwind.config.ts
Il progetto usa Tailwind CSS 4 con `@theme inline` in `globals.css`. Il file `tailwind.config.ts` non deve essere creato — è dead code che confligge con `@theme inline`.

### 5. Token CSS — no hardcoded colors
Usare i token definiti in `globals.css` e `design-tokens.ts`:
- Status: `text-status-ok`, `bg-status-warn/10`, `border-status-danger/30`
- Category: `text-cat-foundation`, `bg-cat-orchestration/10`
- Brand: `bg-primary`, `text-primary`, `bg-primary/10`
- Surface: `bg-card` (elevated), `bg-popover` (overlay), `bg-background` (base)

**MAI** usare `text-emerald-600`, `bg-amber-500`, `text-red-600` direttamente.

### 6. Commenti — evitare pattern `*-`
Tailwind v4 scansiona anche i commenti e interpreta pattern come `status-*` come selettori CSS. Nei commenti usare "status tone" invece di "status-*".

### 7. Provenance obbligatoria (Fase 1.3)
Ogni nodo creato nel Context Graph DEVE avere provenance valida (`createdByAgent`, `source`, `confidence`, `timestamp`). Il runtime enforce questa regola in `graph-age.ts → createNode()`.

### 8. Event Mesh subjects (Fase 2.1)
I subject dell'Event Mesh sono generati da `eventToSubject()` con formato `sota.<entityprefix>.<EventType>` (es. `sota.taskcreated.TaskCreated` — camelCase attaccato). Verificare sempre il subject esatto prima di fare subscribe.

### 9. HITL gates per azioni autonome (Fase 3.6)
Le azioni dell'Autonomous Org (create_agent, create_skill, upgrade_agent, etc.) NON vengono mai eseguite senza approval umana esplicita via Sovereign Validator.

---

## Struttura del Codice

### Directory chiave

#### Kernel esistente (F1-F23)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/kernel/` | 25 moduli kernel (logica pura, 0 dipendenze DB/LLM dirette) |
| `src/lib/stores/` | Zustand stores (data-store, transfer-store) |
| `src/lib/design-tokens.ts` | Design system unificato (COLORS, STATUS_TONES, helpers) |
| `src/lib/store.ts` | Navigation store (Zustand: activePhase, activeView, contextPanel) |
| `src/lib/auth/` | Session management + RBAC |
| `src/lib/governance/` | Fase 0.5 — Entity Registry, Naming URI, Provenance, Event Taxonomy, Knowledge-as-Claims |
| `src/app/api/` | 49 API routes totali (36 preesistenti + 13 nuove Fase 4) |
| `src/components/console/` | Chat agentica decomposta (8 file) |
| `src/components/cockpit/` | Control room (4 file: container + widgets + tabs + types) |
| `src/components/canvas/` | DAG visualizer (3 file) |
| `src/components/domains/` | 4 domini Inspect + _shared/ |
| `src/components/shared/` | 9 componenti condivisi + index.ts |
| `src/components/ui/` | shadcn/ui premium (Card, Button, Input, Badge, Tabs, Dialog) |
| `src/components/workbench/` | Workspace views, status bar, command palette, skeletons |
| `src/components/agentic/` | PhaseN.tsx (14 fasi), sidebar, topbar, overview |
| `prisma/schema.prisma` | 60+ modelli DB (SQLite, dev) |

#### Fase 1 — MVP Core (6 moduli)
| Path | Cosa contiene |
|------|--------------|
| `prisma/schema.postgres.prisma` | Schema PostgreSQL con `Unsupported("vector(256)")` per pgvector nativo |
| `docker-compose.yml` | Stack produzione: AgensGraph (PostgreSQL 16 + AGE + pgvector) |
| `scripts/pg-bootstrap.sql` | CREATE EXTENSION pgvector + AGE + indici GIN + funzione `sota_cosine_search` |
| `src/lib/db-runtime.ts` | Provider detection + helper pgvector/AGE (vectorSearch, upsertEmbedding, ageCypher) |
| `src/lib/vector-store.ts` | Façade embeddings (JSON-string su SQLite, pgvector su Postgres) |
| `src/lib/graph-age.ts` | Façade Context Graph (Cypher via AGE, Prisma fallback); `context-graph/graph.ts` è re-export |
| `src/lib/graphrag/engine.ts` | Hybrid retrieval: vector search + graph expansion + subgraph ranking |
| `src/lib/memory-fabric/fabric.ts` | 4 layers (episodic/semantic/procedural/reasoning) + consolidation + semantic search |
| `src/lib/checkpoint/checkpoint.ts` | Resume/Replay/Rollback per Agent Runtime Kernel |

#### Fase 2 — Enterprise Core (9 moduli)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/event-mesh/mesh.ts` | Pub/sub con 3 backend: NATS JetStream, Redis Streams, in-memory |
| `src/lib/event-mesh/publishers.ts` | Helper tipizzati per eventi business (TaskCreated/Failed, ClaimCreated, etc.) |
| `src/lib/knowledge-extraction/extractor.ts` | Pipeline: text → chunks → entities/relations → Context Graph |
| `src/lib/cognitive-router/router.ts` | Task classifier (Simple/Medium/Complex/Critical) + local-first routing |
| `src/lib/code-intelligence/parser.ts` | Parser AST regex per TS/JS/Python + Call Graph + Git diff sync |
| `src/lib/skill-registry/registry.ts` | Catalogo skill con versioning + 3 default skills (code-review, task-planner, incident-responder) |
| `src/lib/observability-v2/dashboard.ts` | Langfuse-compatible trace export + dashboard unificato + policy engine |
| `src/lib/evaluation/runner.ts` | Benchmark + 8 metriche (task_success_rate, tool_accuracy, hallucination_rate, etc.) + regression detection |
| `src/lib/conflict-resolution/engine.ts` | Detect claim conflicts + 5 resolution strategies + auto-resolver |
| `src/lib/cognitive-gc/curator.ts` | Memory consolidation + decay + cold archival + scheduler |

#### Fase 3 — AGI-Oriented (6 moduli)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/world-model/engine.ts` | WorldState capture + Prediction + Risk + Opportunity + rule-based predictor |
| `src/lib/digital-twin/engine.ts` | Fork + Simulation + 6 what-if presets + comparator |
| `src/lib/agent-lifecycle/manager.ts` | Agent registration + versioning + roles + capabilities + policies + permission check |
| `src/lib/agent-mesh/topology.ts` | 10 agenti in 3 tier (1 CEO + 4 strategic + 5 operational) + delegation + escalation + quorum |
| `src/lib/skill-synthesis/pipeline.ts` | Gap detection + Meta Agent + sandbox test + validation + HITL approval |
| `src/lib/autonomous-org/governor.ts` | Proposals (7 tipi) + auto-generators + HITL gates |

#### Fase 4 — Production Hardening (3 componenti)
| Path | Cosa contiene |
|------|--------------|
| `src/app/api/{mesh,world-model,digital-twin,autonomous-org,agent-lifecycle,evaluation,conflict-resolution,cognitive-gc,cognitive-router,code-intelligence,skill-registry,skill-synthesis,knowledge-extraction}/route.ts` | 13 nuove API routes REST per esporre tutti i moduli Fase 1-3 |
| `src/lib/integration/bridges.ts` | 3 bridge di integrazione: ContextGraph populator, ERL→Skill, AutonomousOrg→Sovereign |
| `src/components/autonomous-dashboard/autonomous-dashboard.tsx` + `src/app/autonomous/page.tsx` | Cockpit UI unificata per visualizzare mesh/world-model/proposals |

### Pattern architetturale

```
UI Component (tsx)
    ↓ fetch
API Route (route.ts)
    ↓ import
Kernel Module (lib/kernel/*.ts) OR Fase 1-3 Module (lib/<module>/)
    ↓ import
DB (lib/db.ts → Prisma) / LLM (z-ai-web-dev-sdk) / Event Mesh / Context Graph
```

**Importante:** I moduli kernel NON importano mai direttamente `@prisma/client` o `z-ai-web-dev-sdk`. L'accesso a DB/LLM avviene tramite le API routes che usano `lib/db.ts` e dynamic import di ZAI.

**Fase 1-3 pattern:** I nuovi moduli seguono lo stesso principio. `graph-age.ts` è la façade per il Context Graph; `vector-store.ts` per gli embeddings; `event-mesh/mesh.ts` per pub/sub. Le API routes sono thin wrapper che espongono queste façade.

---

## Store Zustand

### Navigation store (`src/lib/store.ts`)
```typescript
useStore() → {
  activePhase: Phase,           // 'overview' | 'console' | 'domain-memory' | ...
  activeView: WorkspaceView,    // 'console' | 'canvas' | 'timeline' | 'cockpit' | 'sovereign' | 'phase'
  contextPanelOpen: boolean,
  contextPanelMode: 'quickstats' | 'phase' | 'inspector' | 'help',
  selectedItem: SelectedItem,
  commandPaletteOpen: boolean,
  // ...setters
}
```

### Data store (`src/lib/stores/data-store.ts`)
```typescript
useDataStore() → {
  dashboard: DashboardData | null,     // KPI globali (cache 5s)
  blockedPending: any[],               // Azioni bloccate (cache 10s)
  cost: any,                           // Cost tracking (cache 30s)
  affect: any,                         // Telemetria affettiva (cache 5s)
  logs: LogEntry[],                    // Log eventi (cache 10s)
  fetchDashboard(force?), fetchBlocked(force?), fetchCost(force?), ...
  refreshAll(),
}
```

**Pattern:** `startGlobalRefresh()` / `stopGlobalRefresh()` gestiscono un singolo interval condiviso (singleton). Non creare `setInterval` dedicati nei componenti.

---

## Componenti UI Premium

### Design system (`globals.css`)
- **Surface 3 livelli:** `--surface-base` (app bg), `--surface-elevated` (cards), `--surface-overlay` (modals)
- **Brand:** `--brand` oklch(0.52 0.19 245) — blu elettrico
- **7 category desaturati:** `--cat-foundation` through `--cat-infrastructure` (chroma 0.08-0.14)
- **5 status tones:** `--status-ok/warn/danger/info/muted`
- **Shadow 4 livelli:** `shadow-sm` through `shadow-xl`
- **Radius 6 sistematici:** `rounded-xs`(4px) through `rounded-2xl`(20px)

### Componenti shadcn premium (`src/components/ui/`)
- **Card:** `bg-card rounded-lg border shadow-sm hover:shadow-md` + header strutturato
- **Button:** `active:scale-[0.98]` + `focus-visible:ring-2 ring-primary/30` + prop `loading`
- **Input:** `h-10 bg-card shadow-sm focus:border-primary focus:ring-2 ring-primary/15`
- **Badge:** 8 varianti (`default/success/warning/danger/info/secondary/destructive/outline`)
- **Tabs:** `bg-muted/40 border rounded-md` + active `bg-card shadow-sm`
- **Dialog:** `bg-popover rounded-xl shadow-xl backdrop-blur-sm` + slide-in-from-top-4

### Componenti shared (`src/components/shared/`)
- `EmptyState` — icon + title + description + optional CTA
- `StatCard` / `StatCardGrid` — KPI card con tone colors
- `SectionCard` — Card con header (icon + title + description + action)
- `FormField` / `FormSection` — form standardizzato
- `DynamicIcon` — renderizza icone da nome string (lint-safe, no component-during-render)
- `KVList` — lista key-value
- `TagBadge` — badge con 7 varianti
- `RefreshButton` — bottone Aggiorna con loading state
- `ConfirmDialog` — wrapper alert-dialog

### Cockpit Autonomous Dashboard (Fase 4.3)
- **Path:** `src/components/autonomous-dashboard/autonomous-dashboard.tsx`
- **Route:** `/autonomous`
- **Auto-refresh:** 30 secondi
- **8 stat cards:** Agent Mesh, World Model, Autonomous Org, Digital Twin, Skill Registry, Conflicts, Memory Entries, Latest WorldState
- **Sezioni:** Pending Proposals table, Mesh Topology view per tier

---

## Fasi Architetturali

### Kernel esistente (F1-F23)

| Fase | Nome | Kernel Module | Stato |
|------|------|---------------|-------|
| F1 | Memory & State | ns-mem, patchboard | ✅ Completo |
| F2 | Planner & Compiler | scheduler, compiled-ai | ✅ Con LLM |
| F3 | Cognitive Steering | acts | ✅ Completo |
| F4 | Verification & Taint | ltl-monitor, taint, normative | ✅ Completo |
| F5 | Reflective Learning | erl | ✅ Con LLM |
| F6 | Context Manager | context-engineering | ✅ Completo |
| F7 | Trace Validator | dominator-tree | ⚠️ Stub semantico |
| F8 | Formal Verifier | lean4-agent | ⚠️ Stub LLM |
| F9 | Human Retainer | artificial-retainer | ✅ Completo |
| F10 | Model Encapsulator | compiled-ai | ✅ Con LLM |
| F11 | Affect Monitor | affect-subsystem | ✅ Completo |
| F12 | Objective Builder | agent-objective | ⚠️ Stub LLM |
| F13 | Swarm Coherence | esr-quorum | ✅ Completo |
| F14 | Model Router | time-router | ⚠️ Stub LLM |
| MCP | Server/Client | mcp-client, skill-manager | ✅ Completo |
| Cost | Cost tracking | cost-ledger | ✅ Completo |
| Auth | Authentication | auth/session, auth/rbac | ✅ Completo |
| Trust | ECDSA signing | crypto-trust | ✅ Completo |

### Fase 0.5 — Governance Foundation
| Modulo | Path | Stato |
|--------|------|-------|
| Entity Registry | `src/lib/governance/entity-registry.ts` | ✅ 25 entity types |
| Naming Rules | `src/lib/governance/naming-rules.ts` | ✅ URI scheme |
| Provenance Schema | `src/lib/governance/provenance-schema.ts` | ✅ Enforced in createNode |
| Event Taxonomy | `src/lib/governance/event-taxonomy.ts` | ✅ 33 event types |
| Agent Lifecycle Schema | `src/lib/governance/agent-lifecycle.ts` | ✅ Schema pronto |
| Knowledge-as-Claims | `src/lib/governance/knowledge-claims.ts` | ✅ Schema pronto |

### Fase 1 — MVP Core
| Modulo | Path | Stato |
|--------|------|-------|
| PostgreSQL + pgvector + AGE | `prisma/schema.postgres.prisma` + `docker-compose.yml` | ✅ |
| db-runtime | `src/lib/db-runtime.ts` | ✅ Provider detection |
| vector-store | `src/lib/vector-store.ts` | ✅ Façade embeddings |
| graph-age | `src/lib/graph-age.ts` | ✅ Façade Context Graph |
| GraphRAG | `src/lib/graphrag/engine.ts` | ✅ Hybrid retrieval |
| Memory Fabric | `src/lib/memory-fabric/fabric.ts` | ✅ 4 layers + consolidation |
| Checkpointing | `src/lib/checkpoint/checkpoint.ts` | ✅ Resume/Replay/Rollback |

### Fase 2 — Enterprise Core
| Modulo | Path | Stato |
|--------|------|-------|
| Event Mesh | `src/lib/event-mesh/` | ✅ NATS/Redis/memory |
| Knowledge Extraction | `src/lib/knowledge-extraction/` | ✅ Pipeline completa |
| Cognitive Router | `src/lib/cognitive-router/` | ✅ Classifier + local-first |
| Code Intelligence | `src/lib/code-intelligence/` | ✅ AST + Call Graph |
| Skill Registry | `src/lib/skill-registry/` | ✅ Catalogo + versioning |
| Observability v2 | `src/lib/observability-v2/` | ✅ Langfuse export |
| Evaluation Layer | `src/lib/evaluation/` | ✅ 8 metriche |
| Conflict Resolution | `src/lib/conflict-resolution/` | ✅ 5 strategie |
| Cognitive GC | `src/lib/cognitive-gc/` | ✅ Consolidation + decay |

### Fase 3 — AGI-Oriented
| Modulo | Path | Stato |
|--------|------|-------|
| World Model | `src/lib/world-model/` | ✅ WorldState + Prediction + Risk + Opportunity |
| Digital Twin | `src/lib/digital-twin/` | ✅ Fork + Simulation + 6 presets |
| Agent Lifecycle | `src/lib/agent-lifecycle/` | ✅ Versioning + permissions |
| Agent Mesh | `src/lib/agent-mesh/` | ✅ 10 agenti in 3 tier |
| Skill Synthesis | `src/lib/skill-synthesis/` | ✅ Meta Agent + sandbox |
| Autonomous Org | `src/lib/autonomous-org/` | ✅ Proposals + HITL |

### Fase 4 — Production Hardening
| Componente | Path | Stato |
|-----------|------|-------|
| API Routes | `src/app/api/{mesh,world-model,...,knowledge-extraction}/route.ts` | ✅ 13 endpoint |
| Integration Layer | `src/lib/integration/bridges.ts` | ✅ 3 bridge attivi |
| Cockpit UI | `src/components/autonomous-dashboard/` + `src/app/autonomous/page.tsx` | ✅ Dashboard |

---

## Convenzioni di Codice

### TypeScript
- Strict mode attivo
- Evitare `any` — usare `unknown` per catch blocks
- Tipizzare esplicitamente return types delle funzioni pubbliche
- Per moduli Fase 1-3: importare `Provenance` da `@/lib/governance`, NON da `@/lib/graph-age` (è dichiarato localmente ma non esportato)

### Nomenclatura
- **File:** kebab-case (`message-bubble.tsx`, `data-store.ts`)
- **Componenti:** PascalCase (`MessageBubble`, `SensoriumWidget`)
- **Functions:** camelCase (`fetchDashboard`, `setActivePhase`)
- **Constants:** UPPER_SNAKE (`SECTIONS`, `DEFAULT_EXPANDED`)
- **Types:** PascalCase (`Phase`, `WorkspaceView`, `DashboardData`)
- **URI scheme (Fase 0.5):** `agent://planner`, `task://uuid`, `skill://name`, `claim://domain/name`, `world-state://iso-timestamp`

### CSS
- Usare classi Tailwind, non CSS inline (tranne per dynamic values)
- `cn()` utility per classi condizionali
- Token CSS via `@theme inline` in globals.css
- `@utility` per custom utilities (shimmer, hover-lift, etc.)

### API Routes
- `export const runtime = 'nodejs'` (mai edge)
- Pattern: `POST` con `body.action` per CRUD multi-azione
- Auth: verificare cookie `sota_session` tramite `verifySession()`
- **Fase 4 pattern uniforme:** GET = stats/list, POST = action dispatcher con `{ action, ...params, provenance }`

### Event Mesh (Fase 2.1)
- Subject generati da `eventToSubject()`: formato `sota.<entityprefix>.<EventType>` (camelCase attaccato)
- Esempi: `sota.taskcreated.TaskCreated`, `sota.approvalrequested.ApprovalRequested`
- Publisher helper in `src/lib/event-mesh/publishers.ts` — preferire questi a `publishEvent` raw
- Backend selection automatica via env: `NATS_URL` > `REDIS_URL` > in-memory

### Context Graph (Fase 1.2)
- Sempre usare `@/lib/graph-age.ts` (façade) — NON `@/lib/context-graph/graph.ts` direttamente (è re-export)
- Provenance obbligatoria in ogni `createNode`
- Per performance: usare `traverse()` con `maxDepth` ≤ 3 (BFS può esplodere)
- Su PostgreSQL + AGE: `cypherQuery()` per query complesse; fallback Prisma automatico

### Commit messages
- Inglese o italiano (coerente entro lo stesso scope)
- Formato: `<tipo>: <descrizione>` (es. `Fix sidebar: replace old structure with premium SECTIONS`)
- Per Fasi 1-4: includere "Fase X.Y" nel messaggio (es. `Fase 3.2: Digital Twin Engine with 6 what-if presets`)

---

## Errori Comuni da Evitare

1. **`tee dev.log` nello script dev** → causa recompilazione infinita (file watcher loop)
2. **Pattern `status-*` nei commenti** → Tailwind v4 lo interpreta come selettore CSS
3. **`var(--status-ok)/10`** → non funziona in Tailwind v4 arbitrary values. Usare `bg-status-ok/10` (classi native via `@theme inline`)
4. **Creare componenti durante render** → `const Icon = getIcon(name); return <Icon />` viola `react-hooks/static-components`. Usare `DynamicIcon` shared
5. **`setInterval` nei componenti** → usare `startGlobalRefresh()` / `stopGlobalRefresh()` dal data-store
6. **`window.dispatchEvent`** → usare `useTransferStore` Zustand
7. **Non committare** → il container può riavviarsi e perdere tutto
8. **Import `Provenance` da graph-age** → graph-age dichiara Provenance localmente ma non lo esporta. Importare da `@/lib/governance`
9. **Subject Event Mesh con dot camelCase** → `sota.task.TaskCreated` è SBAGLIATO. Il subject corretto è `sota.taskcreated.TaskCreated` (regex non separa camelCase)
10. **Eseguire azioni Autonomous Org senza approval** → sempre passare per `createProposal` + `approveProposal`. Mai chiamare direttamente gli executor
11. **`db.$queryRaw` tagged template con conditional WHERE** → non funziona. Usare `$queryRawUnsafe` con parametri `$1, $2, ...`
12. **Cancellare GraphNode esistenti tra test** → i test che girano in parallelo su SQLite possono collidere. `vitest.config.ts` ha `fileParallelism: false`

---

## Come Aggiungere una Nuova Vista

1. Creare il componente in `src/components/<area>/`
2. Aggiungere il case in `workspace-views.tsx` → `PhaseView()` switch
3. Aggiungere la voce in `sidebar.tsx` → `SECTIONS`
4. Aggiungere il type in `store.ts` → `Phase`
5. Aggiornare `use-url-sync.ts` → `VALID_PHASES`
6. Commit: `git add -A && git commit -m "Add new view: <name>"`

---

## Come Aggiungere un Nuovo Modulo Fase 1-4

1. Creare la directory in `src/lib/<module-name>/`
2. Implementare il modulo con tipi espliciti, validazione provenance, e helper `xxxProvenance()`
3. Creare i test in `tests/unit/<module-name>.test.ts`
4. Creare l'API route in `src/app/api/<module-name>/route.ts` (pattern GET=stats, POST=action)
5. Aggiornare AGENTS.md, ARCHITECTURE.md, DIAGRAM.md, README.md
6. Aggiornare il worklog `worklog.md` con la nuova sezione Task ID
7. Commit: `git add -A && git commit -m "Fase X.Y: <module name> with <features>"`

---

## Risorse

- **Design system:** `src/app/globals.css` + `src/lib/design-tokens.ts`
- **Worklog:** `worklog.md` (cronologia sessioni — Fase 0.5 → Fase 4)
- **Roadmap:** `download/ROADMAP-VNEXT.md` (piano originale Fase 0.5 → Fase 3)
- **Diagrammi architetturali:** `ARCHITECTURE.md` + `DIAGRAM.md`
- **Schema DB:** `prisma/schema.prisma` (SQLite dev) + `prisma/schema.postgres.prisma` (PostgreSQL prod)
- **Bootstrap SQL:** `scripts/pg-bootstrap.sql` (pgvector + AGE + indici)
- **Stack prod:** `docker-compose.yml` (AgensGraph)

---

## Numeri Finali

- **496 test** in **31 file** (tutti passing)
- **25+ nuovi moduli** tra Fase 1+2+3+4
- **49 endpoint API** totali (36 preesistenti + 13 nuovi)
- **60+ modelli Prisma**
- **0 TypeScript errors** nei moduli nuovi
- **0 dipendenze native** aggiunte (tree-sitter sostituito con parser regex, NATS/Redis lazy-loaded opzionali)
