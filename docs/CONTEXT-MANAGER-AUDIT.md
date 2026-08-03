# Context Manager — Audit & Hardening

**Data**: 2026-07-26
**Modulo**: `Context Manager` — Advanced/Internals (Phase 6 + Curator Phase 1)
**Scope**: `src/lib/kernel/context-engineering.ts` · `src/lib/kernel/curator.ts` · `src/app/api/context/route.ts` · `src/components/agentic/phase6.tsx` · `src/components/workbench/context-panel.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/context-engineering.ts` | 299 | Core: `recordToolCall` (ring buffer) + `assembleWorkingContext` (riassembliamento) + `summarizeAndEvict` (compressione narrativa) + `pruneOnly` + `updatePolicy` + `contextStats` + `searchContextHistory` (RAG) |
| `src/lib/kernel/curator.ts` | 105 | Curator: `gatherSensorium` (stato operativo) + `compileSensoriumXML` (formato XML) + `produceSensorium` (persist snapshot) |
| `src/app/api/context/route.ts` | 81 | API REST: GET assemble/stats/search + POST record_tool_call/update_policy/summarize_now |
| `src/components/agentic/phase6.tsx` | 346 | UI: ring buffer view + tool call recording + summarization + policy editor + search |
| `src/components/workbench/context-panel.tsx` | 109 | UI: workbench context panel (QuickStats + NodeInspector + LogInspector) |
| `prisma/schema.prisma` | 30 | Modelli `ToolCallEntry` + `ContextSummary` + `PruningPolicy` + `SensoriumSnapshot` |

### Stato pre-audit

Il modulo NON è stato auditato in precedenza. Nessun test esistente per `context-engineering.ts` o `curator.ts`. Il modulo è completamente sprovvisto di test coverage.

---

## 2. Criticità (Critical)

### 🔴 C1 — `recordToolCall` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`, `src/lib/runtime/react-loop.ts`

Come C3 del modulo ERL Red Lines: `recordToolCall` è esposto via API ma **non è chiamato da nessuna parte nel runtime**. L'executor esegue tool call via `dispatchTool` nel ReAct loop, ma non registra le coppie Tool Call/Response nel ring buffer del Context Manager.

**Effetto**: il ring buffer è sempre vuoto a runtime. `assembleWorkingContext` ritorna sempre `recentCalls: []` e `summary: null`. L'intero Context Engineering è **cosmetico** — funziona solo se un admin manualmente chiama `/api/context?action=record_tool_call`.

### 🔴 C2 — `curator.ts` usa `cycleCounter` module-level (stato in-memory perso su restart)

**File**: `src/lib/kernel/curator.ts:13, 30, 43-45`

```ts
let cycleCounter = 0

export async function gatherSensorium(): Promise<SensoriumData> {
  cycleCounter += 1
  // ...
  const queueDepth = (cycleCounter * 7) % 23
  const activeThreads = 1 + (cycleCounter % 4)
  const systemLoad = Math.min(0.95, 0.2 + (cycleCounter % 10) * 0.07)
```

`cycleCounter` è una variabile module-level. Su restart del processo, riparte da 0 → `queueDepth`, `activeThreads`, `systemLoad` ripartono da valori fake precalcolati invece di riflettere lo stato reale del sistema.

Inoltre, `queueDepth`, `activeThreads`, `systemLoad` sono **simulati** (formule matematiche su cycleCounter), non letti dal sistema reale (JobRecord queue, thread pool, CPU load).

**Effetto**: il Sensorium mostra metriche **fittizie** che non riflettono il vero stato del sistema. L'agente riceve informazioni errate su carico, coda e thread.

### 🔴 C3 — `assembleWorkingContext` fa `JSON.parse` senza try/catch su payload corrotti

**File**: `src/lib/kernel/context-engineering.ts:111-118`

```ts
recentCalls: recentCalls.reverse().map((c) => ({
  // ...
  callPayload: JSON.parse(c.callPayload),
  responsePayload: JSON.parse(c.responsePayload),
  // ...
}))
```

Se un `ToolCallEntry` ha `callPayload` o `responsePayload` non JSON valido (es. troncato per size limit, o corrotto), `JSON.parse` throwa e l'intero `assembleWorkingContext` fallisce → l'agente non riceve contesto di lavoro.

Manca try/catch con fallback (es. ritorna la stringa grezza o `null`).

---

## 3. Bug (Medium)

### 🟠 B1 — `searchContextHistory` ricalcola embedding di tutti i 50 summary ad ogni query

**File**: `src/lib/kernel/context-engineering.ts:282-299`

```ts
export async function searchContextHistory(agentId: string, query: string, k = 3) {
  const q = embed(query)
  const summaries = await db.contextSummary.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const scored = summaries.map((s) => {
    const emb = embed(s.narrative)  // RICALCOLA ogni volta!
    let dot = 0
    for (let i = 0; i < q.length; i++) dot += q[i] * emb[i]
    return { ... similarity: dot }
  })
```

Come B3 del modulo ERL: carica 50 summary e ricalcola `embed()` per ognuno ad ogni query. Con 50 summary × 256-dim embedding, sono 12.800 operazioni per query.

Il commento dice "costo trascurabile" ma in realtà `embed()` chiama un modello (anche se leggero) e su 50 chiamate per query diventa significativo. Dovrebbe persistere l'embedding nel DB (campo `embedding` su `ContextSummary`).

### 🟠 B2 — `summarizeAndEvict` non ha size cap sulla narrativa

**File**: `src/lib/kernel/context-engineering.ts:155-168`

```ts
const lines: string[] = []
if (previousSummary) {
  lines.push(previousSummary.narrative)  // APPEND narrativa precedente
  lines.push('---')
}
lines.push(`[${new Date().toISOString()}] Azioni evicted (${toEvict.length}):`)
for (const e of toEvict) {
  lines.push(`- ${e.toolName}(${callPreview}) → ${respPreview}`)
}
const narrative = lines.join('\n')
```

La narrativa cresce ad ogni summarization perché appende la narrativa precedente + nuove entry. Dopo 100+ cicli di summarization, la narrativa può diventare enorme (MB di testo) → il `ContextSummary.narrative` diventa più grande del contesto originale che doveva comprimere.

Manca: troncamento della narrativa precedente (es. mantieni solo ultime 500 righe o 5KB).

### 🟠 B3 — `updatePolicy` non valida input (windowSize=0, threshold negativa)

**File**: `src/lib/kernel/context-engineering.ts:241-255`

```ts
export async function updatePolicy(agentId, updates) {
  return db.pruningPolicy.upsert({
    // ... update: updates  ← nessuna validazione
  })
}
```

`windowSize: 0` → `assembleWorkingContext` ritorna 0 entry (contesto vuoto).
`summarizeThreshold: -1` → summarization triggera ad ogni tool call.
`windowSize: 999999` → nessun pruning, contesto cresce indefinitamente.

Manca validazione: `windowSize` deve essere `>= 1` e `<= 100`, `summarizeThreshold` deve essere `>= windowSize`.

### 🟠 B4 — API POST `/api/context` non usa `requireAdmin` per azioni mutative

**File**: `src/app/api/context/route.ts:45-81`

```ts
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)  // ← solo requireAuth, non requireAdmin
  // ...
  if (action === 'record_tool_call') { ... }
  if (action === 'update_policy') { ... }
  if (action === 'summarize_now') { ... }
}
```

`record_tool_call`, `update_policy`, `summarize_now` sono azioni mutative che modificano lo stato del Context Manager. Un viewer può:
- Registrare tool call falsi (inquinare il ring buffer)
- Cambiare la policy (windowSize=0 → contesto vuoto per tutti gli agenti)
- Forzare summarization (perdere dati non ancora pronti)

Come C3 del modulo Phase3+Tools: dovrebbe usare `requireAdmin` per azioni mutative.

### 🟠 B5 — `curator.ts` `generateTimeSortableId` collision risk (stesso modulo ACTS)

**File**: `src/lib/kernel/curator.ts:33`

```ts
const cycleId = generateTimeSortableId()
```

Come C3 del modulo ACTS Controller: `generateTimeSortableId()` usa counter casuale 0-99 → collision risk ~1% per chiamate nello stesso minuto. `SensoriumSnapshot.cycleId` ha `@unique` constraint, quindi collisioni causano errori 500.

### 🟠 B6 — `phase6.tsx` auto-refresh non ha try/catch su fetch

**File**: `src/components/agentic/phase6.tsx:59-60`

```ts
fetch(`/api/context?action=assemble&agentId=${agentId}`).then((r) => r.json()),
fetch('/api/context?action=stats').then((r) => r.json()),
```

Le fetch nel `refresh()` non hanno try/catch. Su network error o 500, generano unhandled promise rejection. Come G3 del modulo ACTS (fixato in Fase C).

### 🟠 B7 — `recordToolCall` non ha size cap su `callPayload` e `responsePayload`

**File**: `src/lib/kernel/context-engineering.ts:36-44`

```ts
const entry = await db.toolCallEntry.create({
  data: {
    // ...
    callPayload: JSON.stringify(callPayload),
    responsePayload: JSON.stringify(responsePayload),
    // ...
  },
})
```

`callPayload` e `responsePayload` sono stringified senza limiti. Un tool che ritorna 10MB di JSON → DB bloat + slow queries su `assembleWorkingContext`. Come B4 del modulo LTL (fixato con size cap 10KB).

### 🟠 B8 — `searchContextHistory` usa dot product invece di cosine similarity

**File**: `src/lib/kernel/context-engineering.ts:293-295`

```ts
let dot = 0
for (let i = 0; i < q.length; i++) dot += q[i] * emb[i]
return { ... similarity: dot }
```

Usa dot product grezzo invece di cosine similarity (che normalizza per magnitudo). Se gli embedding hanno magnitudo diverse (es. narrative più lunghe → embedding con valori più grandi), il dot product è biased. Dovrebbe usare `cosine(q, emb)` come `retrieveHeuristics` in ERL.

---

## 4. Gap funzionali

### 🟡 G1 — Zero test per `context-engineering.ts` e `curator.ts`

**File**: `tests/` (manca)

Nessun test esistente. Funzioni critiche non testate:
- `recordToolCall` (ring buffer + summarization trigger)
- `assembleWorkingContext` (riassembliamento + JSON.parse)
- `summarizeAndEvict` (compressione + evict)
- `updatePolicy` (validazione)
- `contextStats` (aggregazioni)
- `searchContextHistory` (RAG)
- `produceSensorium` (XML compilation + persist)

### 🟡 G2 — `assembleWorkingContext` non integrato nel ReAct loop

**File**: `src/lib/runtime/react-loop.ts`

Come C1: il ReAct loop dovrebbe chiamare `assembleWorkingContext` per iniettare il contesto di lavoro nel system prompt, ma non lo fa. L'LLM riceve solo il task + context base, senza il ring buffer delle tool call recenti.

### 🟡 G3 — `curator.ts` metriche simulate, non reali

**File**: `src/lib/kernel/curator.ts:43-45`

`queueDepth`, `activeThreads`, `systemLoad` sono calcolati da formule su `cycleCounter`, non letti dal sistema reale. Dovrebbero essere:
- `queueDepth`: `db.jobRecord.count({ where: { status: 'queued' } })`
- `activeThreads`: processo count o `db.jobRecord.count({ where: { status: 'running' } })`
- `systemLoad`: `os.loadavg()[0]` o CPU usage reale

### 🟡 G4 — `phase6.tsx` non ha a11y (aria-label, role)

**File**: `src/components/agentic/phase6.tsx`

Nessun `aria-*` o `role` nei 346 LOC del componente. Come G2 del modulo ACTS (fixato in Fase C).

### 🟡 G5 — `searchContextHistory` non persiste embedding dei summary

**File**: `src/lib/kernel/context-engineering.ts:289`

Il commento dice "non memorizziamo embedding dei summary per semplicità; ricalcoliamo al volo". Ma questo causa B1 (50 embed per query). Dovrebbe aggiungere campo `embedding` a `ContextSummary` e persistere al creation time.

### 🟡 G6 — `context-panel.tsx` non ha refresh automatico (adaptive polling)

**File**: `src/components/workbench/context-panel.tsx`

Il panel mostra QuickStats + Inspector ma non si aggiorna automaticamente. L'utente deve cliccare "Aggiorna" manualmente. Come N10 del modulo Learn Domain (fixato con adaptive polling 30s + Page Visibility API).

### 🟡 G7 — Nessun integration test end-to-end Context Manager

**File**: `tests/` (manca)

Manca un integration test che:
1. Registra tool call → verifica ring buffer
2. Supera threshold → verifica summarization + evict
3. Assembla working context → verifica summary + recent calls
4. Search history → verifica RAG results

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3, B4, B5)

1. **C1+G2**: Integrare `recordToolCall` nell'executor:
   - In `executeTask` o `dispatchTool`: dopo ogni tool call, chiama `recordToolCall`
   - In `react-loop.ts`: prima del LLM call, chiama `assembleWorkingContext` e inietta nel context
   - Non bloccante (fail-open se Context Manager fallisce)
2. **C2+G3**: Sostituire metriche simulate con reali:
   - `queueDepth`: `db.jobRecord.count({ where: { status: 'queued' } })`
   - `activeThreads`: `db.jobRecord.count({ where: { status: 'running' } })`
   - `systemLoad`: `os.loadavg()[0] / os.cpus().length`
   - Rimuovere `cycleCounter` module-level
3. **C3**: `assembleWorkingContext` try/catch su JSON.parse:
   - Se parse fallisce, ritorna stringa grezza o null
   - Non far crashare l'intera funzione per un entry corrotta
4. **B4**: API POST `/api/context` usa `requireAdmin` per azioni mutative:
   - `record_tool_call`, `update_policy`, `summarize_now` → requireAdmin
   - Split: read-only actions con requireAuth, mutative con requireAdmin
5. **B5**: Sostituire `generateTimeSortableId` con `cuid()` per `SensoriumSnapshot.cycleId`
   - Cambiare `cycleId` da Int a String (come C3 del modulo ACTS)

### Fase B — Robustezza (B1, B2, B3, B7, B8)

1. **B1+G5**: Persistere embedding dei summary nel DB:
   - Aggiungere campo `embedding` a `ContextSummary`
   - In `summarizeAndEvict`: calcola e persisti embedding al creation time
   - In `searchContextHistory`: usa embedding persistito invece di ricalcolare
2. **B2**: Size cap sulla narrativa:
   - Troncare narrativa precedente a 5KB prima di appendere nuove entry
   - Mantenere solo ultime 100 righe
3. **B3**: Validazione `updatePolicy`:
   - `windowSize`: integer >= 1, <= 100
   - `summarizeThreshold`: integer >= windowSize, <= 1000
   - `autoSummarize`: boolean
   - Throw o 400 se invalido
4. **B7**: Size cap su `callPayload` e `responsePayload`:
   - Troncare a 50KB ciascuno con marker `[truncated]`
   - Come B4 del modulo LTL
5. **B8**: `searchContextHistory` usa `cosine` invece di dot product:
   - Importa `cosine` da `@/lib/embeddings`
   - Sostituisci dot product con `cosine(q, emb)`

### Fase C — UX & completamento (B6, G1, G4, G6, G7)

1. **B6**: `phase6.tsx` try/catch su fetch:
   - Come G3 del modulo ACTS
2. **G1**: Unit test per tutte le funzioni di `context-engineering.ts` e `curator.ts`:
   - `recordToolCall` (ring buffer + summarization trigger)
   - `assembleWorkingContext` (JSON.parse robusto)
   - `summarizeAndEvict` (compressione + evict)
   - `updatePolicy` (validazione)
   - `contextStats` (aggregazioni)
   - `searchContextHistory` (RAG con cosine)
   - `produceSensorium` (XML + persist)
3. **G4**: a11y in `phase6.tsx`:
   - aria-label su button, role=status su metriche
4. **G6**: Adaptive polling in `context-panel.tsx`:
   - setInterval 30s + Page Visibility API
5. **G7**: Integration test end-to-end:
   - record tool call → ring buffer → threshold → summarize → assemble → search

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 6 (2 core + 1 API + 2 UI + 1 schema) |
| LOC totali | ~840 |
| Bug critici (C) | 3 |
| Bug medi (B) | 8 |
| Gap funzionali (G) | 7 |
| Test esistenti | 0 (zero coverage) |
| Stima Fase A | 1.5 giornate |
| Stima Fase B | 1 giornata |
| Stima Fase C | 1 giornata |
| **Totale stimato** | **3.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3+B4+B5) — effettività + sicurezza. **Critica**.
   - C1: recordToolCall integrato nell'executor (non più cosmetico)
   - C2: metriche reali invece di simulate
   - C3: JSON.parse robusto
   - B4: requireAdmin su mutative
   - B5: cycleId collision fix
2. **Fase B** (B1+B2+B3+B7+B8) — robustezza. **Alta**.
3. **Fase C** (B6+G1+G4+G6+G7) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: Context Manager non più cosmetico (recordToolCall + assembleWorkingContext integrati)
- C2: Sensorium con metriche reali (non più simulate)
- C3: JSON.parse robusto (no crash su dati corrotti)

Tempo stimato: 1.5 giornate.
