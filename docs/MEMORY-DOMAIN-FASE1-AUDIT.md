# Fase 1 — Audit & Gap Analysis: Modulo Memory Domain

**Data**: 2026-07-01
**Modulo**: `domain-memory` (ADVANCED_PHASES[0])
**Scope**: Phase 1 (NS-Mem + PatchBoard) · Phase 6 (Context Manager) · Phase 10 (Model Encapsulator) · Memory Fabric · Cognitive GC · Knowledge Extraction · GraphRAG · Embeddings · Vector Store

---

## 1. Mappatura del modulo

### 1.1 Componenti UI

| File | LOC | Ruolo |
|------|-----|-------|
| `src/components/domains/memory-context/memory-context-domain.tsx` | 30 | Wrapper con 3 tab: Episodic (Phase1), Context (Phase6), Sessions (Phase10) |
| `src/components/agentic/phase1.tsx` | 442 | NS-Mem: 4 tab (Memory, PatchBoard, Sensorium, Logical DAG) |
| `src/components/agentic/phase6.tsx` | 339 | Context Manager: 4 tab (Working Context, Record, Policy, Search) |
| `src/components/agentic/phase10.tsx` | 174 | Model Encapsulator: 2 tab (Encapsulated Call, History) |

### 1.2 API Routes (14 routes, tutte auth-protected)

| Route | LOC | Auth | Note |
|-------|-----|------|------|
| `GET/POST /api/memory` | 62 | requireAuth ✓ | List/search/dag + create episode/entity/rule |
| `GET /api/memory/browse` | 309 | requireAuth ✓ | Unified browser: graph nodes, memory entries, search across 4 tables |
| `POST /api/memory/manage` | 103 | requireAuth ✓ | Lifecycle: delete/archive/restore |
| `GET /api/memory/edges` | 81 | requireAuth ✓ | Edge browser con filtri + pagination |
| `GET /api/memory/similarity` | 121 | requireAuth ✓ | Cosine similarity tra entity embeddings |
| `GET/POST /api/memory/rules` | 110 | requireAuth ✓ | Logical rule CRUD |
| `GET/POST /api/embeddings` | 31 | requireAuth ✓ | Embedding dims/counts + recompute all |
| `GET/POST /api/knowledge-extraction` | 58 | requireAuth ✓ | Document extraction pipeline |
| `GET/POST /api/cognitive-gc` | 56 | requireAuth ✓ | GC stats + manual consolidate/decay/archive |
| `GET/POST /api/context` | 81 | requireAuth ✓ | Context assembly, tool call recording, summarization |
| `GET/POST /api/patchboard` | 62 | requireAuth ✓ | PatchBoard state + transactions |
| `GET/POST /api/grounded` | 54 | requireAuth ✓ | Encapsulated call + sessions + stats |
| `GET/DELETE /api/sensorium` | 44 | requireAuth ✓ | Sensorium XML generation + cleanup |
| `GET/POST /api/admin/memory` | 69 | requireAdmin ✓ | Admin: graph browser + GC stats + semantic search |

### 1.3 Lib files (11 files, ~2.500 LOC)

| File | LOC | Responsabilità |
|------|-----|----------------|
| `src/lib/kernel/ns-mem.ts` | 167 | 3-layer memory (Episodic/Semantic/Logical), EMA decay, TF-IDF embeddings |
| `src/lib/kernel/context-engineering.ts` | 299 | Ring buffer ToolCallEntry, summarization, policy, context search |
| `src/lib/kernel/grounded-inference.ts` | 247 | Stateless LLM call, context budget, sandbox execution |
| `src/lib/kernel/patchboard.ts` | 204 | RFC 6902 JSON Patch con permission matrix + replay |
| `src/lib/memory-fabric/fabric.ts` | 216 | 4-layer memory over MemoryEntry, dual-path pgvector/SQLite |
| `src/lib/cognitive-gc/curator.ts` | 440 | 3-stage GC: consolidate → decay → archive, scheduler |
| `src/lib/knowledge-extraction/extractor.ts` | 474 | PDF/text chunking, regex entity/relation extraction, graph persist |
| `src/lib/embedding-provider.ts` | 287 | Provider abstraction: Local TF-IDF, Ollama bge-m3, OpenAI |
| `src/lib/vector-store.ts` | 158 | Façade SQLite (JSON) vs PostgreSQL (pgvector native) |
| `src/lib/graphrag/engine.ts` | 142 | Hybrid retrieval: vector search → graph expansion → ranking |
| `src/lib/embeddings.ts` | 304 | Local TF-IDF 256-dim with 150+ semantic aliases IT/EN |

### 1.4 Modelli Prisma (15 modelli)

`EpisodicMemory` · `SemanticEntity` · `LogicalRule` · `PatchTransaction` · `GlobalState` · `SensoriumSnapshot` · `ToolCallEntry` · `ContextSummary` · `PruningPolicy` · `EncapsulatedSession` · `EncapsulationPolicy` · `GraphNode` · `GraphEdge` · `EmbeddingVector` · `MemoryEntry`

### 1.5 Test esistenti (8 file, ~1.500 LOC)

| File | LOC | Coverage |
|------|-----|----------|
| `tests/unit/memory-fabric.test.ts` | 151 | storeMemory, retrieveMemory, semanticMemorySearch, consolidateMemory |
| `tests/unit/cognitive-gc.test.ts` | 263 | classifyTier, consolidate, decay, archive, gcStats, scheduler |
| `tests/unit/knowledge-extraction.test.ts` | 217 | chunkText, extractEntities, extractRelations, extractDocument |
| `tests/unit/patchboard.test.ts` | 147 | Permission scoping + JSON Patch ops |
| `tests/unit/vector-store.test.ts` | 118 | parsePgvectorString, CRUD, searchSimilar |
| `tests/unit/embeddings.test.ts` | 160 | Dimensions, L2 norm, cosine, tokenization |
| `tests/unit/graphrag.test.ts` | 180 | Full pipeline: vectorSearch → graphExpansion → ranking → context |
| `tests/unit/graph-age.test.ts` | 289 | createNode, getNode, createEdge, traverse, cypherQuery |

---

## 2. Criticità (Critical / High)

### 🔴 C1 — `grounded-inference.ts:135` — `new Function()` non è un sandbox

**File**: `src/lib/kernel/grounded-inference.ts:135-145`

```ts
function executeSandbox(script: string, input: unknown): any {
  const fn = new Function('input', script)  // NON È UN SANDBOX
  return fn(input)
}
```

Il commento nel file (linea 16) claims "sandbox isolata" ma `new Function()` dà allo script LLM-generated accesso completo a `process`, `require`, `db`, `fetch`, `globalThis`. Un LLM malevolo o compromesso può eseguire codice arbitrario sul server.

**Impatto**: RCE (Remote Code Execution) via LLM-generated script.

**Fix**: Usare `node:vm` con `contextifiedSandbox` + timeout + resource limits, o `isolated-vm` per vero isolamento.

### 🔴 C2 — `fabric.ts:47` — SQL INSERT usa stesso parametro per weight e utilityScore

**File**: `src/lib/memory-fabric/fabric.ts:47`

```sql
INSERT INTO "MemoryEntry" (..., weight=$7, utilityScore=$7, ...)
```

Entrambi i campi ricevono `params.utilityScore ?? 0.5`. `weight` dovrebbe essere `utilityScore * recencyScore` (che a creazione è `utilityScore * 1.0`), ma l'SQL non rispetta l'invariante documentata. Funzionalmente corretto a creazione, ma semanticamente errato e breaks se recencyScore default cambia.

### 🔴 C3 — 10 di 14 API routes senza try/catch (500 non strutturati)

**File**: `/api/memory`, `/api/memory/manage`, `/api/memory/edges`, `/api/memory/similarity`, `/api/memory/rules`, `/api/embeddings`, `/api/context`, `/api/patchboard`, `/api/grounded`, `/api/sensorium`

Queste route non hanno try/catch intorno al handler body. Se Prisma lancia un errore (es. unique constraint violation, connection timeout), l'utente riceve un 500 generico senza `{ error: "..." }` strutturato.

Solo 4 route hanno try/catch: `/api/knowledge-extraction`, `/api/cognitive-gc`, `/api/admin/memory`, `/api/memory/browse`.

---

## 3. Bug (Medium)

### 🟠 B1 — `cognitive-gc/curator.ts:245-258` — N+1 update loop in `updateDecayScores`

```ts
for (const entry of entries) {
  await db.memoryEntry.update({ where: { id: entry.id }, data: { ... } })
}
```

Fino a 1000 `db.memoryEntry.update` individuali per esecuzione. Ogni update è una query SQL separata con overhead di round-trip.

**Fix**: Batch con raw SQL `UPDATE ... SET weight = utilityScore * MAX(0, 1 - ...)` o `updateMany` grouped per recency bucket.

### 🟠 B2 — `context-engineering.ts:282-298` — `searchContextHistory` re-embeds 50 summaries ogni chiamata

La funzione re-calcola gli embeddings di tutte le ContextSummary ad ogni search, invece di persistere l'embedding nel DB. Il modello `ContextSummary` non ha campo `embedding`.

**Fix**: Aggiungere `embedding String?` al modello `ContextSummary` e popolarlo alla creazione.

### 🟠 B3 — `phase1.tsx:374` — hardcoded `bg-zinc-950 text-zinc-100`

Il blocco XML Sensorium usa colore hardcoded invece di design token. In dark mode è OK, in light mode è illeggibile.

### 🟠 B4 — `context-engineering.ts:293-294` — cosine senza normalizzazione magnitudo

```ts
const dot = a.reduce((sum, v, i) => sum + v * b[i], 0)
return dot  // NON diviso per (|a| * |b|)
```

Ritorna un dot-product non normalizzato invece di vero cosine similarity. `fabric.ts:146-153` lo fa correttamente, ma è inconsistente.

### 🟠 B5 — Triple storage degli embeddings

Gli embeddings sono memorizzati in 3 posti diversi:
1. `SemanticEntity.embedding` (JSON string, Phase 1)
2. `EmbeddingVector` table (dual-path SQLite/Postgres, Phase 1.1)
3. `MemoryEntry.embedding` (JSON string, Phase 1.5)

Non c'è consistenza su quale viene usato. `vector-store.ts` è la façade corretta ma non tutti i moduli la usano.

### 🟠 B6 — `knowledge-extraction/extractor.ts` — 4 silent `catch {}` blocks

Linee 385, 414, 418, 434: errori silenziati su duplicate node/edge creation. Accettabile per idempotency, ma dovrebbe almeno loggare a debug level per diagnosi.

### 🟠 B7 — Phase 1/6/10 non hanno adaptive polling

I 3 componenti fanno un singolo `useEffect(() => { refresh() }, [])` e non si aggiornano mai più. L'utente deve cliccare "Aggiorna" per vedere nuovi episodi, context changes, o session results.

Il sistema ha già `useGovernanceData` hook (Fase 4 governance) con adaptive polling 5s/30s + Page Visibility API, ma non è usato qui.

---

## 4. Gap funzionali (Medium/Low)

### 🟡 G1 — a11y mancante su tutti i 3 componenti

Nessun `aria-label` su bottoni icon-only, nessun `role="status"` su stat cards, nessun `aria-live` per toast. Solo phase6 ha un `onKeyDown` (Enter su search input). Confronto con governance-view (Fase 4 G11) che ha a11y completa.

### 🟡 G2 — No unit tests per 4 moduli core

Mancano test per:
- `ns-mem.ts` (EMA decay, semantic search)
- `context-engineering.ts` (ring buffer, summarization)
- `grounded-inference.ts` (sandbox, LLM fallback)
- `embedding-provider.ts` (provider switching, fallback)

### 🟡 G3 — No API route integration tests

Zero test integration per le 14 API routes del modulo memory. Solo `admin-settings.route.test.ts` esiste come pattern.

### 🟡 G4 — `memory-context-domain.tsx` minimale (3 tab senza features avanzate)

Confronto con governance-view (6 tab con filtri, export, CRUD) e insights-view (6 tab con charts, budget config). Memory Domain ha solo 3 tab che renderizzano i phase components senza value-add (no filtri, no export, no pagination, no search unificata).

### 🟡 G5 — `EncapsulatedSession` non ha retry logic visibile

Il modello ha `maxRetries` field ma `grounded-inference.ts` non implementa retry. Se la chiamata LLM fallisce, la session va in `status: 'failed'` senza retry.

### 🟡 G6 — `PruningPolicy` auto-summarize non usa LLM

`summarizeAndEvict` in `context-engineering.ts` genera narrative deterministica (concatenazione tool names + results), non usa LLM per riassumere. La quality del summary è bassa.

### 🟡 G7 — `GraphRAG` non integrato nella Console

`hybridRetrieval` esiste ma non è chiamato dalla Console o dal react-loop. L'LLM riceve solo testo plain, non subgraph context.

### 🟡 G8 — `SensoriumSnapshot` cleanup manuale

`/api/sensorium` ha DELETE per cleanup ma non c'è scheduler automatico. Gli snapshot si accumulano nel DB.

---

## 5. Confronto con moduli precedenti

| Aspetto | Runs | Memory (CORE) | Governance | **Memory Domain (Advanced)** |
|---------|------|---------------|------------|------------------------------|
| Auth su tutte le API | ✅ | ✅ | ✅ | ✅ (100% coverage) |
| Error handling API (try/catch) | ✅ | ✅ | ✅ | ❌ (10/14 senza) |
| Adaptive polling | ✅ | ✅ | ✅ | ❌ (B7) |
| a11y (aria, keyboard) | ✅ | ✅ | ✅ | ❌ (G1) |
| Dark mode tokens | ✅ | ✅ | ✅ | ⚠️ (B3: 1 hardcoded) |
| Test integration | ✅ | ✅ | ✅ | ❌ (G3) |
| Security audit | ✅ | ✅ | ✅ | ❌ (C1: RCE via new Function) |

**Nota positiva**: Il modulo ha il miglior set di unit test tra tutti i moduli (8 file, ~1.500 LOC). Auth è 100% coverage. Design tokens sono quasi completi (1 violazione).

---

## 6. Piano di intervento (Fasi 2-4)

### Fase 2 — Sicurezza & robustezza (C1-C3, B1-B2)

1. **C1**: Sostituire `new Function()` con `node:vm.runInNewContext()` + timeout + sandbox object limitato
2. **C2**: Fix SQL INSERT in `fabric.ts:47` — usare due parametri distinti per weight e utilityScore
3. **C3**: Aggiungere try/catch a 10 API routes senza error handling strutturato
4. **B1**: Batch `updateDecayScores` con raw SQL UPDATE invece di N+1 loop
5. **B2**: Aggiungere `embedding String?` a `ContextSummary` + popolare alla creazione
6. **Test**: integration test per C1 (sandbox isolation) + C3 (error handling)

### Fase 3 — Bug fix & consistency (B3-B7)

1. **B3**: Sostituire `bg-zinc-950` con design token
2. **B4**: Fix cosine normalization in `searchContextHistory`
3. **B5**: Consolidare embedding storage tramite `vector-store.ts` façade
4. **B6**: Aggiungere debug logging ai silent catch in extractor.ts
5. **B7**: Integrare `useGovernanceData` (adaptive polling) in phase1/6/10
6. **Test**: unit test per ns-mem, context-engineering, grounded-inference, embedding-provider

### Fase 4 — UX & a11y (G1-G4)

1. **G1**: a11y completa (aria-label, role, aria-live, keyboard nav)
2. **G4**: Arricchire memory-context-domain con filtri, search unificata, export
3. **Test**: API route integration tests per le 14 routes

---

## 7. Metriche

- **File analizzati**: 36 (3 componenti, 14 API, 11 lib, 8 test, schema)
- **LOC totali modulo**: ~6.700 (lib) + ~950 (componenti) + ~870 (API) = ~8.500
- **Bug critici (C)**: 3
- **Bug medi (B)**: 7
- **Gap funzionali (G)**: 8
- **Test esistenti**: 8 file / ~1.500 LOC (buona coverage unit, zero integration)
- **Stima implementazione Fasi 2-4**: 3-4 giornate di lavoro

---

## Prossimo passo

Procedere con **Fase 2 — Sicurezza & robustezza** (C1-C3 + B1-B2), seguendo l'ordine del piano di intervento.
