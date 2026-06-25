# AGENTS.md — Guida per LLM Agenti

> Questo file aiuta i modelli LLM a comprendere rapidamente la struttura, le convenzioni e i pattern del progetto per lavorare in modo efficace.

---

## Identità del Progetto

**SOTA Agentic OS** — Cognitive Operating System per agenti autonomi con kernel transazionale, verifica formale LTL, apprendimento riflessivo, organizzazione autonoma governata da HITL, executor durevole con recovery, e interoperabilità completa con agenti esterni (MCP + A2A + REST + API key).

**Stack:** Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Prisma 6 + ZAI SDK + Socket.IO

**Evoluzione architetturale (3 piani completati):**
- **Kernel esistente (F1-F23):** 25 moduli core con LTL, ERL, ACTS, DynAMO, Sovereign, MCP, ECDSA
- **Fase 0.5:** Governance Foundation (Entity Registry, Naming URI, Provenance, Event Taxonomy, Knowledge-as-Claims)
- **Fase 1-6:** Cognitive OS Evolution (Context Graph, GraphRAG, Memory Fabric, Event Mesh, Cognitive Router, Skills, Evaluation, Conflicts, GC, World Model, Digital Twin, Agent Mesh, Autonomous Org, LLM Client, Sandbox, Cache)
- **PLAN.md (WS0-WS2):** Runtime Executor durevole (state machine, checkpoint, recovery, ReAct loop, tool reali, MCP client, worker persistente) + Admin Panel (6 tab con HITL)
- **PLAN-UIUX.md (UX-1→UX-8):** 6 aree di navigazione per obiettivo, ModulePage pattern, Runs view, data-viz recharts, onboarding, a11y
- **PLAN-INTEROP.md (IO-0→IO-7):** API key M2M, MCP server (27 tool), A2A protocol, Skills export/import, OpenAPI spec, multi-tenant, docs quickstart

---

## Regole Fondamentali

### 1. Sempre committare
Dopo ogni modifica significativa, eseguire `git add -A && git commit -m "descrizione"`. Il container può riavviarsi e perdere il lavoro non committato.

### 2. Verificare prima di committare
```bash
bunx tsc --noEmit   # 0 errori TypeScript
bun run lint         # 0 errori ESLint
bun run test         # Tutti i test passano (538 test su 35 file)
bun run build        # Build successful (76 pagine)
```

### 3. Usare il dev server webpack (non turbopack)
```bash
bun run dev          # USA QUESTO (--webpack)
bun run dev:turbo    # NON USARE (bug CSS con @utility custom)
```

### 4. Tailwind v4 — no tailwind.config.ts
Il progetto usa Tailwind CSS 4 con `@theme inline` in `globals.css`. Il file `tailwind.config.ts` non deve essere creato.

### 5. Token CSS — no hardcoded colors
Usare i token definiti in `globals.css` e `design-tokens.ts`. **MAI** usare `text-emerald-600` direttamente.

### 6. Commenti — evitare pattern `*-`
Tailwind v4 scansiona anche i commenti e interpreta pattern come `status-*` come selettori CSS.

### 7. Provenance obbligatoria (Fase 1.3)
Ogni nodo creato nel Context Graph DEVE avere provenance valida. Il runtime enforce questa regola in `graph-age.ts → createNode()`.

### 8. Event Mesh subjects (Fase 2.1)
I subject sono generati da `eventToSubject()` con formato `sota.<entityprefix>.<EventType>` (camelCase attaccato, es. `sota.taskcreated.TaskCreated`).

### 9. HITL gates per azioni autonome (Fase 3.6)
Le azioni dell'Autonomous Org NON vengono mai eseguite senza approval umana esplicita via Sovereign Validator.

### 10. DynamicIcon per icone (UX-5)
Usare sempre `<DynamicIcon name="IconName" />` — ha 52 icone mappate in `ICON_MAP`. Non usare switch case manuali.

### 11. ModulePage pattern (UX-8)
Le nuove viste devono usare `<ModulePage>` con header + stats + content + EmptyState. Non reinventare layout.

### 12. API Key per route esterne (IO-0)
Le route accessibili da agenti esterni devono usare `requireApiAuth(req, scope)` invece di `requireAuth(req)`. Accetta sia Bearer token che session cookie.

---

## Struttura del Codice

### Directory chiave

#### Kernel esistente (F1-F23)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/kernel/` | 25 moduli kernel (logica pura, 0 dipendenze DB/LLM dirette) |
| `src/lib/stores/` | Zustand stores (data-store, transfer-store) |
| `src/lib/design-tokens.ts` | Design system unificato (COLORS, STATUS_TONES, helpers) |
| `src/lib/store.ts` | Navigation store con 6 aree + Advanced + Admin |
| `src/lib/auth/` | Session + RBAC + requireAdmin + API key (IO-0) + multi-tenant (IO-6) |
| `src/lib/governance/` | Fase 0.5 — Entity Registry, Naming URI, Provenance, Event Taxonomy, Knowledge-as-Claims |
| `src/app/api/` | 70 API routes (36 kernel + 13 Fase 4 + 7 Runs/Admin + 10 Interop + 4 Skills) |
| `src/instrumentation.ts` | WS1.5 — avvia worker + integration + GC + recovery al boot |
| `prisma/schema.prisma` | 60+ modelli DB (SQLite, dev) |

#### PLAN.md — Runtime (WS0-WS2)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/runtime/executor.ts` | Executor durevole: state machine, checkpoint, recovery, dispatch parallelo, async mode |
| `src/lib/runtime/react-loop.ts` | Loop ReAct: pensa → chiama tool → osserva → ripeti (LLM tool-calling) |
| `src/lib/runtime/tool-dispatcher.ts` | Scope enforcement, timeout, audit trail per tool call |
| `src/lib/runtime/builtin-tools.ts` | 7 builtin tools: filesystem.read/write/list, http.fetch, memory.search, graph.query, web.search |
| `src/lib/mcp-client/client.ts` | MCP client per orchestrare tool MCP esterni |
| `src/app/admin/page.tsx` | Admin panel 6 tab: Settings, Runtime, Tools, Governance, Memory, Users |
| `src/app/api/admin/` | 8 route admin: settings, runtime, tools, governance, memory, users, api-keys, audit, quotas |
| `src/app/api/runs/` | 3 route runs: list, detail, checkpoint (rollback/resume) |
| `next.config.ts` | `serverExternalPackages: ['nats', 'redis']` + `webpackIgnore` su import dinamici |
| `.env.example` | Documentazione completa per tutte le env vars |

#### PLAN-UIUX.md — UI/UX (UX-1→UX-8)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/store.ts` | 6 aree: dashboard, runs, memory, agents, governance, insights + admin + advanced |
| `src/components/agentic/sidebar.tsx` | Sidebar con Main + System + Advanced (collassabile) + MobileNav |
| `src/components/module-pages/module-page.tsx` | Pattern standard: header + stats + EmptyState |
| `src/components/module-pages/runs-view.tsx` | Runs list + detail con timeline/ReAct/checkpoint/rollback |
| `src/components/module-pages/memory-knowledge-view.tsx` | Graph browser + semantic search + memory tiers |
| `src/components/module-pages/agents-org-view.tsx` | Mesh topology + skills + proposals |
| `src/components/data-viz/charts.tsx` | 5 recharts: CostTrend, TokenUsage, Latency, EvaluationTrend, Sparkline |
| `src/components/onboarding/onboarding-tour-v2.tsx` | Tour 5-step sulle 6 aree |
| `src/components/onboarding/ai-suggestion.tsx` | Primitive UI per suggerimenti AI |
| `src/components/shared/dynamic-icon.tsx` | 52 icone mappate (Record<string, LucideIcon>) |
| `src/app/globals.css` | UX-5: shadow-soft/md/lg, hover-lift, glass, tnum, animate-slide-in-up/stagger/pulse-glow, skeleton-shimmer |

#### PLAN-INTEROP.md — Interoperabilità (IO-0→IO-7)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/auth/api-key.ts` | API key con scopes (read/exec/admin), Bearer token, createApiKey, verifyApiKey, requireApiAuth |
| `src/lib/auth/multi-tenant.ts` | TenantContext, auditAccess, checkRateLimit, checkQuota, tenantStats |
| `src/lib/a2a/protocol.ts` | A2A: agent card, submitTask, getTask, cancelTask, mapping piano→A2A status |
| `src/lib/skill-registry/skill-export.ts` | Skills export SKILL.md/JSON, import, discoverSkills |
| `src/app/api/mcp/route.ts` | MCP server: 27 tool JSON-RPC 2.0 con auth |
| `src/app/.well-known/agent.json/route.ts` | A2A agent card (public discovery) |
| `src/app/api/a2a/tasks/route.ts` | A2A task submit/status/cancel |
| `src/app/api/openapi/route.ts` | OpenAPI 3.0 spec |
| `src/app/api/skills/` | 3 route: export, import, discover |
| `src/app/api/admin/api-keys/` | API key management (create/list/revoke) |
| `src/app/api/admin/audit/` | Audit trail per accesso esterno |
| `src/app/api/admin/quotas/` | Quota usage per tenant |
| `docs/quickstart.md` | Guide per 7 client (Claude Code, Cursor, VS Code, Antigravity, MCP, A2A, SDK) |
| `docs/backplane-claude-code.md` | Guida specifica Claude Code backplane mode |

#### Fase 1-6 moduli (precedenti)
| Path | Cosa contiene |
|------|--------------|
| `src/lib/db-runtime.ts` | Provider detection + pgvector/AGE helpers |
| `src/lib/vector-store.ts` | Façade embeddings |
| `src/lib/graph-age.ts` | Façade Context Graph |
| `src/lib/graphrag/engine.ts` | Hybrid retrieval |
| `src/lib/memory-fabric/fabric.ts` | 4 layers + consolidation |
| `src/lib/checkpoint/checkpoint.ts` | Resume/Replay/Rollback |
| `src/lib/event-mesh/` | NATS/Redis/memory pub/sub |
| `src/lib/knowledge-extraction/` | Document → Graph pipeline |
| `src/lib/cognitive-router/` | Task classifier + local-first + LLM |
| `src/lib/code-intelligence/` | AST + Call Graph |
| `src/lib/skill-registry/registry.ts` | Catalogo + versioning |
| `src/lib/observability-v2/` | Langfuse export + dashboard |
| `src/lib/evaluation/` | Benchmark + 8 metriche |
| `src/lib/conflict-resolution/` | Detect + 5 strategies |
| `src/lib/cognitive-gc/` | Consolidation + decay + archival |
| `src/lib/world-model/` | WorldState + Prediction + Risk |
| `src/lib/digital-twin/` | Fork + Simulation + 6 presets |
| `src/lib/agent-lifecycle/` | Versioning + permissions |
| `src/lib/agent-mesh/` | 10 agenti in 3 tier |
| `src/lib/skill-synthesis/` | Meta Agent + sandbox + HITL |
| `src/lib/autonomous-org/` | Proposals + HITL gates |
| `src/lib/llm-client/` | LLM façade (ZAI SDK + fallback) |
| `src/lib/skill-sandbox/` | Sandbox con resource limits |
| `src/lib/cache/cache.ts` | LRU cache con TTL + invalidation |
| `src/lib/integration/bridges.ts` | Kernel ↔ Event Mesh bridges |

### Pattern architetturale

```
UI Component (tsx)
    ↓ fetch
API Route (route.ts) → requireApiAuth (IO-0: API key o session)
    ↓ import
Runtime Module (lib/runtime/) OR Kernel (lib/kernel/) OR Fase 1-6 Module
    ↓ import
DB (lib/db.ts → Prisma) / LLM (llm-client) / Event Mesh / Context Graph / Tool Dispatcher
```

---

## Fasi Architetturali

### Kernel esistente (F1-F23)
| Fase | Nome | Kernel Module | Stato |
|------|------|---------------|-------|
| F1 | Memory & State | ns-mem, patchboard | ✅ |
| F2 | Planner & Compiler | scheduler, compiled-ai | ✅ Con LLM |
| F3 | Cognitive Steering | acts | ✅ |
| F4 | Verification & Taint | ltl-monitor, taint, normative | ✅ |
| F5 | Reflective Learning | erl | ✅ Con LLM |
| F6 | Context Manager | context-engineering | ✅ |
| F7 | Trace Validator | dominator-tree | ⚠️ Stub |
| F8 | Formal Verifier | lean4-agent | ⚠️ Stub |
| F9 | Human Retainer | artificial-retainer | ✅ |
| F10 | Model Encapsulator | compiled-ai | ✅ Con LLM |
| F11 | Affect Monitor | affect-subsystem | ✅ |
| F12 | Objective Builder | agent-objective | ⚠️ Stub |
| F13 | Swarm Coherence | esr-quorum | ✅ |
| F14 | Model Router | time-router | ⚠️ Stub |
| MCP | Server/Client | mcp-client, skill-manager | ✅ |
| Cost | Cost tracking | cost-ledger | ✅ |
| Auth | Authentication | auth/session, auth/rbac | ✅ |
| Trust | ECDSA signing | crypto-trust | ✅ |

### PLAN.md (WS0-WS2)
| Workstream | Modulo | Stato |
|-----------|--------|-------|
| WS0 | Build fix + DB path configurabile | ✅ |
| WS1 | Executor durevole + ReAct loop + Tool dispatcher + Builtin tools + MCP client + Worker persistente | ✅ |
| WS2 | Admin Panel 6 tab (Settings, Runtime, Tools, Governance, Memory, Users) | ✅ |

### PLAN-UIUX.md (UX-1→UX-8)
| Workstream | Modulo | Stato |
|-----------|--------|-------|
| UX-1 | 6 aree per obiettivo + Advanced collassabile | ✅ |
| UX-2+8 | ModulePage pattern + MemoryKnowledgeView + AgentsOrgView | ✅ |
| UX-3 | Runs list + detail con timeline/ReAct/checkpoint/rollback | ✅ |
| UX-4 | Admin/Settings nel workbench | ✅ |
| UX-5 | Ombre soft, motion, glass, data-viz recharts | ✅ |
| UX-6 | Onboarding tour + AI suggestions + empty states | ✅ |
| UX-7 | ARIA roles, reduced-motion, focus-visible, MobileNav | ✅ |

### PLAN-INTEROP.md (IO-0→IO-7)
| Workstream | Modulo | Stato |
|-----------|--------|-------|
| IO-0 | API key + scopes + Bearer token + multi-tenant | ✅ |
| IO-1 | MCP 27 tool con Run/executor + scritture governate | ✅ |
| IO-2 | A2A agent card + task lifecycle asincrono | ✅ |
| IO-3 | Skills export SKILL.md/JSON + import + discovery | ✅ |
| IO-4 | OpenAPI 3.0 spec | ✅ |
| IO-5 | Backplane mode guida Claude Code | ✅ |
| IO-6 | Multi-tenant scoping + audit + rate limit + quota | ✅ |
| IO-7 | Docs quickstart 7 client 3 linguaggi | ✅ |

### Fase 1-6 moduli
Vedi sezione Struttura del Codice sopra per la lista completa dei 35+ moduli.

---

## Convenzioni di Codice

### TypeScript
- Strict mode attivo
- Evitare `any` — usare `unknown` per catch blocks
- Importare `Provenance` da `@/lib/governance`, NON da `@/lib/graph-age`
- Per moduli IO: importare `ApiKeyInfo` da `@/lib/auth/api-key`

### Nomenclatura
- **File:** kebab-case (`runs-view.tsx`, `api-key.ts`)
- **Componenti:** PascalCase (`RunsView`, `AgentsOrgView`)
- **Functions:** camelCase (`startExecution`, `requireApiAuth`)
- **Types:** PascalCase (`Phase`, `WorkspaceView`, `ApiKeyInfo`, `A2ATask`)
- **URI scheme:** `agent://planner`, `task://uuid`, `skill://name`, `claim://domain/name`
- **API key format:** `sak_<keyId>_<secret>`

### CSS
- Usare classi Tailwind, non CSS inline
- `cn()` utility per classi condizionali
- UX-5 utilities: `shadow-soft/md/lg`, `hover-lift`, `glass`, `tnum`, `animate-slide-in-up`
- Token CSS via `@theme inline` in globals.css

### API Routes
- `export const runtime = 'nodejs'` (mai edge)
- Pattern: `POST` con `body.action` per CRUD multi-azione
- **Route esterne (IO-0):** usare `requireApiAuth(req, scope)` — accetta Bearer + cookie
- **Route admin:** usare `requireAdmin(req)` — solo admin/operator
- **MCP:** `POST /api/mcp` con `requireApiAuth(req, 'read')`

### Runtime Executor (PLAN.md)
- `startExecution({ async: true })` per esecuzione asincrona via JobRecord
- `startExecution({ async: false })` per esecuzione sincrona con SSE streaming
- `executePlan()` usa `Promise.all` per dispatch parallelo nei batch
- `recoverOrphanedPlans()` al boot per resume dopo crash
- Checkpoint automatico ad ogni task via `saveCheckpoint`

### Event Mesh (Fase 2.1)
- Subject: `sota.<entityprefix>.<EventType>` (camelCase attaccato)
- Publisher helper in `src/lib/event-mesh/publishers.ts`
- Backend: `NATS_URL` > `REDIS_URL` > in-memory

### Context Graph (Fase 1.2)
- Usare `@/lib/graph-age.ts` (façade), NON `@/lib/context-graph/graph.ts`
- Provenance obbligatoria in `createNode`
- `traverse()` con `maxDepth` ≤ 3

### Commit messages
- Formato: `<tipo>: <descrizione>` o `WSX.Y: <descrizione>` o `IO-X: <descrizione>` o `UX-X: <descrizione>`

---

## Errori Comuni da Evitare

1. **`tee dev.log` nello script dev** → recompilazione infinita
2. **Pattern `status-*` nei commenti** → Tailwind v4 lo interpreta come selettore CSS
3. **Creare componenti durante render** → usare `DynamicIcon` shared
4. **`setInterval` nei componenti** → usare `startGlobalRefresh()`
5. **Non committare** → il container può riavviarsi
6. **Import `Provenance` da graph-age** → importare da `@/lib/governance`
7. **Subject Event Mesh con dot camelCase** → `sota.taskcreated.TaskCreated` (non `sota.task.TaskCreated`)
8. **Azioni Autonomous Org senza approval** → sempre `createProposal` + `approveProposal`
9. **`db.$queryRaw` tagged template con conditional WHERE** → usare `$queryRawUnsafe` con `$1, $2`
10. **Cancellare GraphNode tra test paralleli** → `vitest.config.ts` ha `fileParallelism: false`
11. **Usare `requireAuth` su route esterne** → usare `requireApiAuth(req, scope)` per MCP/A2A/REST esterni
12. **Nuove icone senza aggiungerle a DynamicIcon** → aggiungere a `ICON_MAP` in `dynamic-icon.tsx`
13. **Nuove viste senza ModulePage** → usare `<ModulePage>` pattern per coerenza
14. **Esecuzione sincrona per workflow lunghi** → usare `startExecution({ async: true })` per non bloccare la request
15. **Dimenticare `webpackIgnore` su import dinamici opzionali** → `import(/* webpackIgnore: true */ 'nats')`

---

## Come Aggiungere una Nuova Vista

1. Creare il componente in `src/components/module-pages/<name>-view.tsx` usando `<ModulePage>`
2. Aggiungere il case in `workspace-views.tsx` → `PhaseView()` switch
3. Aggiungere la voce in `store.ts` → `CORE_AREAS` o `ADVANCED_PHASES`
4. Aggiornare `use-url-sync.ts` → `VALID_PHASES` e `VALID_VIEWS`
5. Se usa icone nuove, aggiungerle a `dynamic-icon.tsx` → `ICON_MAP`
6. Commit: `git add -A && git commit -m "UX-X: <view name>"`

---

## Come Aggiungere un Nuovo Modulo

1. Creare la directory in `src/lib/<module-name>/`
2. Implementare con tipi espliciti, validazione provenance, e helper `xxxProvenance()`
3. Creare i test in `tests/unit/<module-name>.test.ts`
4. Creare l'API route in `src/app/api/<module-name>/route.ts` (GET=stats, POST=action)
5. Se accessibile esternamente: usare `requireApiAuth(req, scope)` invece di `requireAuth`
6. Se ha tool MCP: aggiungere a `TOOLS` array + `executeTool` switch in `src/app/api/mcp/route.ts`
7. Aggiornare AGENTS.md, ARCHITECTURE.md, DIAGRAM.md, README.md
8. Commit: `git add -A && git commit -m "<prefix>: <module name>"`

---

## Come Aggiungere un Tool MCP

1. Aggiungere la definizione a `TOOLS` array in `src/app/api/mcp/route.ts`
2. Aggiungere il case in `executeTool` switch
3. Se è un tool di scrittura: richiede scope `exec`
4. Se è un tool di lettura: scope `read` sufficiente
5. Testare con: `curl -X POST /api/mcp -H "Authorization: Bearer sak_..." -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"sota_new_tool","arguments":{}}}'`

---

## Risorse

- **Design system:** `src/app/globals.css` + `src/lib/design-tokens.ts`
- **Worklog:** `worklog.md` (cronologia sessioni)
- **Piani:** `PLAN.md` (runtime), `PLAN-UIUX.md` (UI/UX), `PLAN-INTEROP.md` (interop)
- **Diagrammi:** `ARCHITECTURE.md` + `DIAGRAM.md` (23 diagrammi Mermaid)
- **Quickstart:** `docs/quickstart.md` (7 client) + `docs/backplane-claude-code.md` (Claude Code)
- **Schema DB:** `prisma/schema.prisma` (SQLite) + `prisma/schema.postgres.prisma` (PostgreSQL)
- **Bootstrap:** `scripts/pg-bootstrap.sql` + `scripts/prod-bootstrap.sh` + `scripts/health-check.sh`
- **Stack prod:** `docker-compose.yml` (AgensGraph + NATS + Langfuse + Redis)
- **OpenAPI:** `GET /api/openapi` per spec autogenerata

---

## Numeri Finali

- **538 test** in **35 file** (tutti passing)
- **70 API routes** (36 kernel + 13 Fase 4 + 7 Runs/Admin + 10 Interop + 4 Skills)
- **27 tool MCP** per client esterni
- **76 pagine** generate dal build
- **60+ modelli Prisma** (incluso ApiKey per IO-0)
- **35+ nuovi moduli** tra Fase 1-6 + Runtime + Interop + UI
- **23 diagrammi Mermaid** in DIAGRAM.md
- **0 TypeScript errors**
- **0 dipendenze native** aggiunte
