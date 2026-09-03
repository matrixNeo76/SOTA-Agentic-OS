# Objective Builder — Audit & Hardening

**Data**: 2026-09-02
**Modulo**: `Objective Builder` — Phase 12 (F12)
**Scope**: `src/lib/kernel/agent-objective.ts` · `src/app/api/objective/route.ts` · `src/components/agentic/phase12.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/agent-objective.ts` | 255 | Core: `createObjectiveTree` + `generateTreeStructure` (BFS) + `generateSubGoal` (LLM+fallback) + `getObjectiveTree` + `evaluateNode` + `skipDescendants` + `checkTreeCompletion` + `objectiveStats` + `listTrees` |
| `src/app/api/objective/route.ts` | 64 | API REST: GET tree/list/stats + POST create_tree/evaluate_node |
| `src/components/agentic/phase12.tsx` | 267 | UI: form creazione + tree visualizer (con React Flow via dag-visualizers) + lista alberi |

### Schema Prisma (DB)

```prisma
model ObjectiveTree {
  id           String   @id @default(cuid())
  rootGoal     String   // obiettivo macro
  status       String   @default("drafted") // drafted|expanded|evaluating|done
  totalNodes   Int      @default(0)
  maxDepth     Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model ObjectiveNode {
  id           String   @id @default(cuid())
  treeId       String
  parentId     String?  // null per la root
  description  String   // sotto-obiettivo binario (Pass/Fail)
  depth        Int      // 0 = root
  weight       Float    @default(1.0) // peso (stop se < threshold)
  contextTier  String   @default("strategic") // strategic|methodological|implementation
  status       String   @default("pending") // pending|pass|fail|skipped
  evidence     String?  // JSON: prove raccolte
  evaluatedAt DateTime?
  createdAt    DateTime @default(now())
}
```

### Stato pre-audit

Il modulo è stato parzialmente auditato nei cicli Learn Domain e Plan Domain:
- ✅ Plan Domain B1: phase12.tsx ha try/catch su `loadTree`, `createTree`, `evalNode` (verificato — 3 funzioni con try/catch + toast.error)
- ✅ Insights G5: vista grafo per objective tree (implementata via `ObjectiveTreeVisualizer` in `dag-visualizers.tsx`)
- ✅ Learn Domain adaptive polling: phase12.tsx ha `setInterval` con Page Visibility API
- ⚠️ ARCHITECTURE.md nota F12 come "stub LLM" (ma `generateSubGoal` ha ZAI SDK call + fallback)
- ❌ 2 test smoke in `tests/unit/learn-domain-core.test.ts` (solo `objectiveStats` struttura + `listTrees` array)
- ❌ Consumer runtime: NESSUNO (createObjectiveTree non chiamato da executor/scheduler)

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `createObjectiveTree` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1 degli altri moduli: `createObjectiveTree` è esposto via API ma **non chiamato dal runtime**. L'executor non chiama `createObjectiveTree` per decomporre il `planGoal` in rubric tree prima dell'esecuzione. La "Costruzione Automatica Rubriche" è **cosmetica** — funziona solo se un admin manualmente chiama `/api/objective?action=create_tree`.

**Impatto**: i task esplorativi complessi non vengono decomposti automaticamente in criteri di successo densi. L'executor esegue il piano senza rubric tree, quindi non c'è valutazione gerarchica Pass/Fail durante l'esecuzione.

### 🔴 C2 — `generateSubGoal` LLM call non ha retry né size cap su output

**File**: `src/lib/kernel/agent-objective.ts:138-166`

```ts
async function generateSubGoal(parentGoal: string, branchIdx: number, depth: number): Promise<string> {
  // ...
  const fallback = `Verifica ${dim} di: ${parentGoal.slice(0, 60)}`
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({ ... })
    const output = completion.choices[0]?.message?.content?.trim()
    return output || fallback
  } catch {
    return fallback
  }
}
```

Problemi:
1. **No retry**: se la prima chiamata LLM fallisce (rate limit 429, timeout), ritorna subito il fallback. Altri moduli (es. `grounded-inference.ts` Fase B B4) implementano retry logic con `maxRetries`.
2. **No size cap su output**: il system prompt chiede "max 80 chars" ma l'LLM potrebbe ignorare e ritornare 10KB. `output || fallback` non tronca → il `description` del nodo può essere enorme → DB bloat.
3. **`parentGoal.slice(0, 60)` nel fallback**: il fallback tronca, ma l'output LLM no — inconsistenza.

### 🔴 C3 — POST `/api/objective` usa `requireAuth` invece di `requireAdmin`

**File**: `src/app/api/objective/route.ts:35-38`

```ts
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)  // C3: dovrebbe essere requireAdmin
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'create_tree') {
    // Esegue LLM call (BFS con N chiamate) + crea ObjectiveTree/Nodi → mutative
  }
  if (action === 'evaluate_node') {
    // Modifica ObjectiveNode status (pass/fail) + skipDescendants + checkTreeCompletion → mutative
  }
}
```

Come C3 del modulo Model Encapsulator: le POST mutative dovrebbero richiedere `requireAdmin`. Qui invece:
- `create_tree` → esegue BFS con multiple LLM calls (cost reale, crea alberi nel DB) → qualsiasi viewer autenticato può innescare
- `evaluate_node` → modifica stato dei nodi (pass/fail) → qualsiasi viewer può marcare nodi come pass/fail senza autorizzazione

---

## 3. Bug (Medium)

### 🟠 B1 — `objectiveStats` fa 2 query sequenziali dopo Promise.all

**File**: `src/lib/kernel/agent-objective.ts:239-248`

```ts
export async function objectiveStats() {
  const [trees, nodes, completedTrees] = await Promise.all([...])  // 3 query
  const passNodes = await db.objectiveNode.count({ where: { status: 'pass' } })  // sequenziale
  const failNodes = await db.objectiveNode.count({ where: { status: 'fail' } })  // sequenziale
  return { trees, nodes, completedTrees, passNodes, failNodes }
}
```

Come B1/B3 degli altri moduli: 3 query in Promise.all + 2 sequenziali = 3 round-trip DB invece di 1.

### 🟠 B2 — `phase12.tsx` `refresh()` senza try/catch su fetch

**File**: `src/components/agentic/phase12.tsx:50-57`

```ts
const refresh = async () => {
  const [treesR, statsR] = await Promise.all([
    fetch('/api/objective?action=list').then((r) => r.json()),
    fetch('/api/objective?action=stats').then((r) => r.json()),
  ])
  setTrees(treesR.trees || [])
  setStats(statsR)
}
```

Come B1/B2 degli altri moduli: un fetch fallito fa throw unhandled rejection, rompe il polling `setInterval` e lascia la UI in stato stale. Nota: `loadTree`/`createTree`/`evalNode` hanno già try/catch (B1 Plan Domain fix), ma `refresh()` no.

### 🟠 B3 — `skipDescendants` ricorsiva senza depth guard (stack overflow risk)

**File**: `src/lib/kernel/agent-objective.ts:208-219`

```ts
async function skipDescendants(nodeId: string) {
  const children = await db.objectiveNode.findMany({ where: { parentId: nodeId } })
  for (const child of children) {
    if (child.status === 'pending') {
      await db.objectiveNode.update({ ... })
    }
    await skipDescendants(child.id)  // B3: ricorsione senza depth guard
  }
}
```

Se l'albero ha `MAX_DEPTH = 5` e `BRANCHING_FACTOR = 3`, la profondità massima è 5 livelli → ricorsione sicura. Ma se un caller esterno crea nodi con `parentId` ciclici (es. nodo A ha parent B, B ha parent A), la ricorsione diventa infinita → stack overflow. Mancano:
- Depth guard (es. `if (depth > 10) return`)
- Cycle detection (visited set)
- Iterative BFS invece di ricorsione

### 🟠 B4 — `generateTreeStructure` non persiste progressivamente (crash risk)

**File**: `src/lib/kernel/agent-objective.ts:35-79`

```ts
export async function createObjectiveTree(rootGoal: string): Promise<...> {
  const tree = await db.objectiveTree.create({ ... })
  const treeStructure = await generateTreeStructure(rootGoal)  // B4: genera tutto in memoria
  // ... poi persiste ricorsivamente
}
```

`generateTreeStructure` costruisce l'intero albero in memoria prima di persistere. Con `MAX_DEPTH=5` e `BRANCHING_FACTOR=3`, l'albero può avere fino a `1 + 3 + 9 + 27 + 81 + 243 = 364` nodi. Ogni nodo chiama `generateSubGoal` che fa una LLM call → 364 LLM calls sequenziali. Se il processo crasha a metà, l'albero resta in stato `drafted` con 0 nodi persistiti.

**Fix**: persistere ogni nodo appena generato (streaming), non tutto in blocco alla fine.

### 🟠 B5 — `evaluateNode` non valida `status` enum a runtime

**File**: `src/lib/kernel/agent-objective.ts:184`

```ts
export async function evaluateNode(nodeId: string, status: 'pass' | 'fail' | 'skipped', evidence?: unknown) {
  const updated = await db.objectiveNode.update({
    where: { id: nodeId },
    data: {
      status,  // B5: type union, ma no runtime validation
      ...
```

Come B3 del modulo Delegation HITL (`resolveBlockedAction`): `status: 'pass' | 'fail' | 'skipped'` è solo type union TypeScript. A runtime, qualunque stringa viene persistita come `status` nel DB. Se il caller passa `status: 'unknown'`, viene persistito senza errori.

### 🟠 B6 — `evidence` JSON.stringify senza size cap

**File**: `src/lib/kernel/agent-objective.ts:189`

```ts
evidence: evidence ? JSON.stringify(evidence) : null,
```

Come C3 degli altri moduli: `evidence` (oggetto arbitrario) viene JSON-stringified senza size cap. Se il caller passa un oggetto enorme (es. intero trace di esecuzione), viene persistito interamente nel DB → bloat.

---

## 4. Gap funzionali

### 🟡 G1 — Zero unit test specifici per `generateTreeStructure`, `evaluateNode`, `skipDescendants`

I 2 test in `learn-domain-core.test.ts` testano solo `objectiveStats` struttura e `listTrees` array. Mancano test per:
- `generateTreeStructure` in isolamento (BFS con arresto peso, context tier per depth, branching factor)
- `createObjectiveTree` lifecycle (crea tree + nodi, totalNodes/maxDepth corretti)
- `evaluateNode` (pass/fail/skipped, skipDescendants su fail, checkTreeCompletion)
- `getObjectiveTree` (ritorna tree + nodes ordinati per depth)
- `generateSubGoal` fallback path (LLM fail → deterministic)

### 🟡 G2 — `phase12.tsx` nessun a11y (aria-label, role=status)

**File**: `src/components/agentic/phase12.tsx`

267 LOC senza `aria-*` o `role` su button e stats grid. Come G2 degli altri moduli. Nota: `ObjectiveTreeVisualizer` (dag-visualizers) è un componente separato — la sua a11y è fuori scope di questo audit.

### 🟡 G3 — `phase12.tsx` `createTree`/`evalNode` non hanno parse-safe su `r.json()`

**File**: `src/components/agentic/phase12.tsx:80-98, 100-117`

```ts
const createTree = async () => {
  // ...
  const d = await r.json()  // G3: può throware se risposta non JSON
  if (!r.ok) { toast.error(...) }
  // ...
}
```

`loadTree`/`createTree`/`evalNode` hanno try/catch esterno (B1 Plan Domain fix), ma `r.json()` può throware su risposta non JSON (500 con body HTML). Il catch esterno mostra "Create tree failed: Unexpected token <" — non user-friendly. Come G3 del modulo Model Encapsulator Fase C: parse-safe con `try/catch` interno + fallback a `r.text()`.

### 🟡 G4 — `objectiveStats` manca metriche utili (passRate, avgDepth, avgNodesPerTree)

**File**: `src/lib/kernel/agent-objective.ts:239-248`

```ts
return { trees, nodes, completedTrees, passNodes, failNodes }
```

Mancano:
- `passRate` (passNodes / (passNodes + failNodes), % di nodi che passano)
- `avgNodesPerTree` (nodes / trees, media nodi per albero)
- `avgMaxDepth` (media maxDepth degli alberi)
- `pendingNodes` (nodi non ancora valutati)
- `completionRate` (completedTrees / trees, % alberi completati)

La UI phase12.tsx mostra solo 5 stat card, ma senza `passRate` e `completionRate` non si vede la proporzione di successo.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3)

1. **C1**: Integrare `createObjectiveTree` nell'executor (pre-plan generation, se il task è esplorativo). Non bloccante (fail-open). Se il tree viene creato, emette evento WS per UI.
2. **C2**: `generateSubGoal` con retry logic (max 2 retry) + size cap su output (200 char, tronca con marker). Rispetta il system prompt "max 80 chars".
3. **C3**: POST `/api/objective` con `requireAdmin` invece di `requireAuth`.

### Fase B — Robustezza (B1, B2, B3, B5, B6)

1. **B1**: `objectiveStats` — 5 query in `Promise.all` (1 round-trip DB)
2. **B2**: `phase12.tsx` `refresh()` con try/catch + toast.error + preserva stato
3. **B3**: `skipDescendants` — aggiungi depth guard (max 10) + visited set per cycle detection (defensive)
4. **B5**: `evaluateNode` valida `status` enum a runtime (throw su valori non ammessi)
5. **B6**: `evidence` size cap (10KB JSON-stringified con marker `[truncated]`)

### Fase C — UX & completamento (G1, G2, G3, G4)

1. **G1**: Unit test per `generateTreeStructure` (BFS, context tier, arresto peso), `createObjectiveTree` lifecycle, `evaluateNode` (pass/fail/skipped + skipDescendants), `getObjectiveTree`, `generateSubGoal` fallback
2. **G2**: a11y in `phase12.tsx` (aria-label su button, role=status su stats grid)
3. **G3**: `phase12.tsx` `createTree`/`evalNode`/`loadTree` parse-safe con `try/catch` su `r.json()`
4. **G4**: `objectiveStats` con 4 metriche aggiuntive (passRate, avgNodesPerTree, avgMaxDepth, completionRate) + UI phase12.tsx con stat card aggiuntive

**Nota**: B4 (`generateTreeStructure` non persiste progressivamente) è un refactoring significativo (streaming persist invece di batch). Rimandato a un audit futuro — l'impatto pratico è limitato perché `MAX_DEPTH=5` limita l'albero a ~364 nodi, e il crash mid-generation è raro. Documentato come known limitation.

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 3 (1 core + 1 API + 1 UI) |
| LOC totali | ~586 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 2 (smoke in learn-domain-core: objectiveStats struttura + listTrees array) |
| Consumer runtime | 0 (modulo cosmetico) |
| Fix preesistenti | B1 Plan Domain (try/catch su loadTree/createTree/evalNode), G5 Insights (vista grafo), adaptive polling |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3) — sicurezza & effettività. **Critica**.
   - C1: createObjectiveTree integrato in executor (rubric tree non più cosmetico)
   - C2: generateSubGoal retry + size cap (no DB bloat, no rate limit failure)
   - C3: POST /api/objective requireAdmin (no privilege escalation)
2. **Fase B** (B1+B2+B3+B5+B6) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: createObjectiveTree integrato in executor (decomposizione automatica non più cosmetica)
- C2: generateSubGoal retry + size cap (robustezza LLM, no DB bloat)
- C3: POST /api/objective requireAdmin (no privilege escalation su evaluate_node)

Tempo stimato: 1 giornata.
