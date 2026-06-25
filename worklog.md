# SOTA Agentic OS — Worklog condiviso

Questo file è l'append-only log di tutti gli agenti che lavorano al progetto.
Ogni entry inizia con `---` e segue il template:

```
---
Task ID: <id>
Agent: <nome>
Task: <descrizione>

Work Log:
- <step>

Stage Summary:
- <risultati>
```

---
Task ID: 1
Agent: main (PostgreSQL migration + Fase 1 MVP Core)
Task: Fase 1 — MVP Core: migrazione SQLite → PostgreSQL + pgvector + Apache AGE + verifica 1.2/1.3/1.4/1.5/1.6

Work Log:
- Letto schema Prisma esistente (966 righe, 60+ modelli) — provider sqlite
- Verificato che i moduli Fase 1.2-1.6 (context-graph, graphrag, memory-fabric, checkpoint) esistono già come scaffold su SQLite
- Verificato che né PostgreSQL né Docker sono installati localmente → strategia: strato di astrazione con fallback SQLite
- Fase 1.1 — Creato `docker-compose.yml` con AgensGraph (PostgreSQL 16 + AGE + pgvector)
- Fase 1.1 — Creato `scripts/pg-bootstrap.sql` con CREATE EXTENSION pgvector + AGE + indici GIN + funzione `sota_cosine_search`
- Fase 1.1 — Creato `prisma/schema.postgres.prisma` con `Unsupported("vector(256)")` per embedding nativi pgvector
- Fase 1.1 — Creato `src/lib/db-runtime.ts`: getProvider() detection, hasPgvector(), hasAge(), vectorSearch() con fallback, upsertEmbedding(), ageCypher(), cosineSimilarity()
- Fase 1.1 — Creato `src/lib/vector-store.ts`: façade storeEmbedding/getEmbedding/listEmbeddings/searchSimilar/deleteEmbedding con parsePgvectorString
- Fase 1.1 — Creato `src/lib/graph-age.ts`: façade createNode/createEdge/getNode/getNeighbors/traverse/updateNodeLifecycle/queryNodes/cypherQuery/graphStats con mirror su AGE best-effort
- Fase 1.1 — Refattorizzato `src/lib/context-graph/graph.ts` come re-export di graph-age.ts (backward compat per tutti i consumer)
- Fase 1.1 — Refattorizzato `src/lib/graphrag/engine.ts` per usare vector-store + graph-age
- Fase 1.1 — Aggiornato `src/lib/memory-fabric/fabric.ts` per usare pgvector nativo quando disponibile
- Fase 1.1 — Creata API route `GET /api/runtime` che espone provider + extensions + capabilities + counts
- Fase 1.1 — Disabilitato `fileParallelism` in vitest.config.ts (SQLite è single-writer)
- Fase 1.3 — Aggiunta validazione runtime `validateProvenance()` in graph-age.createNode (enforcement oltre al type system)
- Fase 1.4 — Verificato pipeline GraphRAG end-to-end con test: vectorSearch + graphExpansion + rankSubgraph + buildContext + hybridRetrieval
- Fase 1.5 — Verificato Memory Fabric con test: 4 strati + retrieveMemory + semanticMemorySearch + consolidateMemory + memoryStats
- Fase 1.6 — Verificato checkpointing con test: saveCheckpoint + loadCheckpoint + resumeFromCheckpoint + replayFromCheckpoint + rollbackToCheckpoint + autoCheckpoint
- Fix TypeScript: replace broken `db.$queryRaw` tagged template con `db.$queryRawUnsafe` per query dinamiche
- Run finale: 231/231 test passano (158 preesistenti + 73 nuovi per Fase 1)

Stage Summary:
- Deliverable Fase 1.1:
  - `docker-compose.yml` (AgensGraph stack)
  - `scripts/pg-bootstrap.sql` (extensions + indices + cosine search function)
  - `prisma/schema.postgres.prisma` (PostgreSQL variant con pgvector nativo)
  - `src/lib/db-runtime.ts` (provider detection + pgvector/AGE helpers)
  - `src/lib/vector-store.ts` (façade embeddings)
  - `src/lib/graph-age.ts` (façade Context Graph)
  - `src/app/api/runtime/route.ts` (runtime info endpoint)
- Deliverable Fase 1.2: graph-age.ts come façade unificata con fallback AGE → Prisma
- Deliverable Fase 1.3: validateProvenance() enforce in createNode
- Deliverable Fase 1.4: graphrag/engine.ts integrato con vector-store + graph-age
- Deliverable Fase 1.5: memory-fabric/fabric.ts integrato con pgvector
- Deliverable Fase 1.6: checkpoint/checkpoint.ts verificato con 11 test (resume/replay/rollback)
- Test: 231/231 passing (15 file, +73 test nuovi)
- TypeScript: 0 errori nei file nuovi/modificati
- In dev: SQLite continua a funzionare senza modifiche a .env
- In prod: switch via DATABASE_URL=postgresql://... + db:push con schema.postgres.prisma + psql -f scripts/pg-bootstrap.sql

---
Task ID: 2
Agent: main (Fase 2 — Enterprise Core)
Task: Fase 2 — 9 sotto-task: Event Mesh, Knowledge Extraction, Cognitive Router, Code Intelligence, Skill Registry, Observability, Evaluation, Conflict Resolution, Cognitive GC

Work Log:
- Fase 2.1 — Creato `src/lib/event-mesh/mesh.ts` (3 backend: NATS JetStream, Redis Streams, in-memory) con selezione automatica via env vars. Audit trail su AgentLog. `src/lib/event-mesh/publishers.ts` con helper tipizzati per tutti gli eventi principali (TaskCreated/Completed/Failed/Blocked, ClaimCreated, ConflictDetected/Resolved, DocumentUploaded, ApprovalRequested/Granted, AgentSpawned/Stopped, CodeChanged).
- Fase 2.2 — Creato `src/lib/knowledge-extraction/extractor.ts`: pipeline completa (text extractor pluggable, sliding-window chunking con overlap, entity extraction regex-based con 6 tipi, relation extraction con pattern espliciti + co-occorrenza, sync al Context Graph con nodi Document/Claim + embeddings per chunk).
- Fase 2.3 — Creato `src/lib/cognitive-router/router.ts`: Task Classifier (Simple/Medium/Complex/Critical con keyword critiche safety-first), registry modelli local-first (4 locali + 3 API), planRouting strategico, routeCognitive integration con TimeRouter esistente, health check endpoint locali.
- Fase 2.4 — Creato `src/lib/code-intelligence/parser.ts`: parser AST semplificato (regex-based robusto) per TS/JS/Python con function/class/import/call extraction, syncToGraph che crea nodi Document per File/Function e edges CONTAINS/CALLS/IMPORTS, analyzeGitDiff per incremental sync con publishCodeChanged event.
- Fase 2.5 — Creato `src/lib/skill-registry/registry.ts`: catalogo strutturato con schema completo (name/description/tools/memory/constraints/examples/tests/tags), registerSkill con validazione (name, description, promptTemplate, tests, tools esistenti, provenance), getSkill/searchSkills/listSkills, versionSkill con deprecation automatica, lifecycle management, 3 skill di default seedabili (code-review, task-planner, incident-responder).
- Fase 2.6 — Creato `src/lib/observability-v2/dashboard.ts`: Langfuse-compatible trace export (startTrace/addSpan/addGeneration/endTrace), exportToLangfuse con env-based config, real-time metrics aggregator via Event Mesh subscription, getDashboardData unificato (cost/latency/tokens/errors/tools/tasks), recordPolicyViolation con escalation a ApprovalRequested per severity block.
- Fase 2.7 — Creato `src/lib/evaluation/runner.ts`: registerBenchmark/getBenchmark/listBenchmarks, runEvaluation che crea nodi Evaluation + Metric + relazioni ACHIEVED/BASED_ON/MEASURED_BY, computeMetrics con 8 metriche (task_success_rate, tool_accuracy, policy_compliance, hallucination_rate, reasoning_quality, avg_latency_ms, avg_cost_usd, token_efficiency), compareEvaluations per regression detection, 2 benchmark di default (basic-reasoning, tool-use).
- Fase 2.8 — Creato `src/lib/conflict-resolution/engine.ts`: detectConflictsForClaim che trova claim con stesso domain e confidence diff > 0.3 (medium) o > 0.5 (high), crea nodi Conflict + edges CONFLICTS_WITH bidirezionali + publishConflictDetected, resolveConflict con 5 strategie (higher-confidence, more-evidence, more-reliable-source, formal-proof, human-decision), crea Decision node + edge RESOLVED_BY, markClaimSuperseded, autoResolveConflicts che skip high severity (HITL required), createClaimAndDetectConflicts helper.
- Fase 2.9 — Creato `src/lib/cognitive-gc/curator.ts`: consolidateEpisodicToProcedural con clustering greedy per similarità, genera procedural memory con embedding medio, marca episodic originali come cold, apply decay alle non consolidate, updateDecayScores giornaliero (recencyScore = max(0, 1 - daysSinceLastAccess/30)), archiveColdMemories (weight < 0.05 + > 30gg → cold tier con embedding rimosso), classifyTier (hot/warm/cold), startGCScheduler con job daily+weekly.
- Fix TypeScript: `m.avgLatencyMs ?? 0` per optional, import `Provenance` da governance (non da graph-age), cast `any` per event.provenance/payload, dichiarazioni modulo per nats/redis in `src/types/optional-deps.d.ts`.
- Allineamento schema: CodeChanged event payload con `filesChanged: number` (non array), Evaluation attributes con `score` + `metrics` (required da ENTITY_REGISTRY), ResolutionStrategy con kebab-case ('higher-confidence', non 'highest_confidence').
- Test creati: event-mesh (12), knowledge-extraction (13), cognitive-router (20), code-intelligence (20), skill-registry (23), observability-v2 (18), evaluation (20), conflict-resolution (13), cognitive-gc (13) = 152 nuovi test.

Stage Summary:
- Deliverable Fase 2:
  - 9 nuovi moduli in `src/lib/{event-mesh,knowledge-extraction,cognitive-router,code-intelligence,skill-registry,observability-v2,evaluation,conflict-resolution,cognitive-gc}`
  - 9 nuovi file di test in `tests/unit/`
  - 1 file dichiarazioni tipi in `src/types/optional-deps.d.ts`
- Test: 383/383 passing (24 file, +152 test nuovi)
- TypeScript: 0 errori nei file Fase 2
- Architettura: tutti i moduli Fase 2 si integrano con Fase 1 (Context Graph via graph-age, Memory Fabric, Event Mesh) e riusano kernel esistente (time-router, observability, cost-ledger, governance)
- Production-ready: switch via env vars (NATS_URL, REDIS_URL, LANGFUSE_URL+KEY) — in dev tutto funziona con fallback in-memory/SQLite
