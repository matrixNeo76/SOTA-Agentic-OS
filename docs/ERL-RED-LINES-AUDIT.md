# ERL Red Lines — Audit & Hardening

**Data**: 2026-07-26
**Modulo**: `ERL Red Lines` — Advanced/Internals (Phase 5 + Governance Hooks)
**Scope**: `src/lib/kernel/erl.ts` · `src/lib/runtime/governance-hooks.ts` · `src/app/api/reflect/route.ts` · `src/app/api/admin/governance/route.ts` (Red Line CRUD) · `src/components/module-pages/governance-view.tsx` (RedLinesTab)

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/erl.ts` | 269 | ERL core: `extractHeuristic` (LLM + rule-based fallback) + `supervisorReview` (Red Line check su euristiche) + `reflectAndLearn` pipeline + `retrieveHeuristics` (RAG) + `feedbackHeuristic` + `listRedLines` |
| `src/lib/runtime/governance-hooks.ts` | 279 | Runtime hooks: `markExternalInputTainted` (G6) + `checkToolCallSink` (G6) + `publishStateChangeToLTL` (G7) + `evaluateRedLinesForAction` (G8) + `preExecuteGate` (composite) |
| `src/app/api/reflect/route.ts` | 81 | API REST: GET retrieve/redlines/list + POST reflect/feedback |
| `src/app/api/admin/governance/route.ts` | 471 (Red Line section ~190) | Admin API: add-redline, toggle-redline, update-redline, delete-redline con audit + WS publish |
| `src/components/module-pages/governance-view.tsx` | (RedLinesTab ~170) | UI: lista Red Lines + add/edit/toggle/delete inline |
| `tests/unit/erl.test.ts` | 250 | Test esistenti: 17 test (DEFAULT_RED_LINES structure + heuristic extraction logic) |
| `tests/integration/governance-hooks.test.ts` | (snippet) | Test esistenti: G6/G7/G8 hooks |
| `prisma/schema.prisma` | 32 | Modelli `Heuristic` + `RedLine` + `ReflectionLog` |

### Stato pre-audit

Il modulo è stato parzialmente auditato nel ciclo Trust & Governance (report `docs/TRUST-GOVERNANCE-FASE1-AUDIT.md`) per quanto riguarda auth API e CRUD. Questo audit si concentra su **bug logici del supervisorReview, gap nel governance-hooks runtime, e robustezza del Red Line matching** non coperti prima.

---

## 2. Criticità (Critical)

### 🔴 C1 — `supervisorReview` usa regex hardcoded, ignora Red Lines custom del DB

**File**: `src/lib/kernel/erl.ts:143-174`

```ts
async function supervisorReview(heuristic, input): Promise<{ approved, reason }> {
  const redLines = await db.redLine.findMany({ where: { active: true } })
  const lines = redLines.length ? redLines.map(...) : DEFAULT_RED_LINES

  // Regola 1: euristica da caso anomalo
  if (input.steps.length < 2) { return { approved: false, ... } }

  // Regola 2: bypass di sicurezza (REGEX HARDCODED)
  const safetyBypass = /bypass|disable.*security|.../i.test(combinedText)
  if (safetyBypass) { return { approved: false, ... } }

  // Regola 3: ignora limiti dei dataset (REGEX HARDCODED)
  const dataIgnore = /assume.*(all|infinite|unlimited).*data|.../i.test(combinedText)
  if (dataIgnore) { return { approved: false, ... } }

  return { approved: true, reason: 'Superato controllo Red Line' }
}
```

Il `supervisorReview` carica le Red Lines dal DB (`redLines.length ? ... : DEFAULT_RED_LINES`) ma poi **ignora completamente la lista caricata** e usa 3 regex hardcoded che matchano solo 2 delle 4 Red Lines default ("bypass sicurezza" e "limiti dataset"). Le altre 2 Red Lines default ("singoli casi anomali" e "tracciabilità") e **tutte le Red Lines custom aggiunte via admin API** non sono mai checkate.

**Effetto**: l'admin può aggiungere quante Red Lines vuole via `/api/admin/governance?action=add-redline`, ma `supervisorReview` non le valuterà mai. Il gate è **cosmetico per Red Lines custom**.

### 🔴 C2 — `evaluateRedLinesForAction` (governance-hooks) usa substring match con token overlap troppo largo

**File**: `src/lib/runtime/governance-hooks.ts:174-220`

```ts
const rlTokens = rlDescLower.split(/[\s\-_]+/).filter(w => w.length > 4)
const keywordOverlap = rlTokens.some(token => actionLower.includes(token))

if (actionContainsDesc || descContainsAction || keywordOverlap) {
  blocking.push(...)
}
```

Il matching ha 3 strategie, ma `keywordOverlap` è **troppo aggressiva**: qualsiasi token >4 caratteri della Red Line description che appare come substring nell'azione triggera il blocco. Esempi di falsi positivi:
- Red Line "Non ignorare i limiti dei dataset" → token "ignorare", "limiti", "dataset" → blocca action "leggi dataset utenti" (che è legittimo)
- Red Line "Non bypassare policy di sicurezza" → token "bypassare", "policy", "sicurezza" → blocca action "aggiorna policy di sicurezza" (che è legittimo)

**Effetto**: il gate blocca azioni legittime, creando falsi positivi che l'utente non capisce. L'admin deve disabilitare Red Lines per far funzionare il sistema.

### 🔴 C3 — `governance-hooks` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`, `src/lib/runtime/tool-dispatcher.ts`

Come G2/G3 del modulo LTL Taint Normative (prima di Fase B), anche `governance-hooks.ts` è **completamente disconnesso dal runtime**:
- `preExecuteGate` non è chiamato da `executeTask` o `dispatchTool`
- `evaluateRedLinesForAction` non è chiamato prima di tool call sensibili
- `markExternalInputTainted` non è chiamato su input utente
- `publishStateChangeToLTL` non è chiamato su state-change del runtime

**Effetto**: l'intero modulo `governance-hooks.ts` (279 LOC) è **cosmetico**. I test integration lo verificano in isolamento, ma a runtime nessun flusso lo attraversa.

---

## 3. Bug (Medium)

### 🟠 B1 — `extractHeuristic` LLM parse regex è fragile (single-language)

**File**: `src/lib/kernel/erl.ts:72`

```ts
const match = result.heuristic.match(/(?:when|quando)\s+(.+?)[,]\s*(?:i should|devo|dovrei)\s+(.+)/i)
```

La regex matcha solo formato "When X, I should Y" o "Quando X, devo Y". Ma l'LLM può produrre:
- "If X then Y" (senza "when")
- "Per X, esegui Y" (senza "devo")
- "Quando X: Y" (con duepunti invece di virgola)
- Heuristic in altre lingue (francese, tedesco)

Se il match fallisce, cade nel fallback `trigger: result.heuristic.slice(0, 80), action: result.heuristic` — che duplica il testo in trigger e action, rendendo il RAG inutile (trigger e action sono semanticamente identici).

### 🟠 B2 — `feedbackHeuristic` è silent no-op se heuristic non esiste

**File**: `src/lib/kernel/erl.ts:248-257`

```ts
export async function feedbackHeuristic(id: string, success: boolean) {
  const h = await db.heuristic.findUnique({ where: { id } })
  if (!h) return  // silent no-op
  // ...
}
```

Come B3 del modulo Taint (prima di Fase C): se l'ID non esiste, ritorna silenziosamente. Il caller non sa se il feedback è stato registrato o meno. Inoltre, `successRate` è calcolato come media mobile ma non c'è cap su `appliedCount` (overflow potenziale dopo milioni di applicazioni).

### 🟠 B3 — `retrieveHeuristics` carica TUTTE le euristiche in memoria per cosine similarity

**File**: `src/lib/kernel/erl.ts:228-243`

```ts
export async function retrieveHeuristics(taskDescription: string, k = 5) {
  const q = embed(taskDescription)
  const all = await db.heuristic.findMany({ where: { redLineOk: true } })  // CARICA TUTTE
  const scored = all.map((h) => ({ ... similarity: cosine(q, deserialize(h.embedding)) }))
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, k)
}
```

Carica tutte le euristiche dal DB, deserializza ogni embedding, calcola cosine similarity in JS. Con 10.000+ euristiche:
- Memoria: ~10MB di embedding serializzati
- CPU: 10.000 cosine calculations per query
- Latency: secondi invece di millisecondi

Manca indice vectoriale (pgvector) o pre-filtering. Il sistema non scala.

### 🟠 B4 — `supervisorReview` non logga quale Red Line ha bloccato

**File**: `src/lib/kernel/erl.ts:143-174`

Quando `supervisorReview` blocca, ritorna `reason: 'Red Line: "Non bypassare policy di sicurezza per efficienza"'` — ma il testo è hardcoded nel reason, non derivato dalla Red Line che ha matchato. Se l'admin aggiunge una Red Line custom che dovrebbe bloccare qualcosa, e il supervisorReview la checkasse (C1 fix), non ci sarebbe modo di sapere **quale** Red Line ha bloccato.

Manca: `blockingRedLine: { id, description, severity }` nel return type.

### 🟠 B5 — `evaluateRedLinesForAction` non distingue severity (absolute vs strong vs soft)

**File**: `src/lib/runtime/governance-hooks.ts:174-220`

Tutte le Red Lines che matchano vengono bloccate allo stesso modo, indipendentemente dalla severity:
- `absolute` dovrebbe bloccare sempre
- `strong` dovrebbe bloccare ma permettere override con approval
- `soft` dovrebbe solo warnare, non bloccare

Il return type ha `blockingRedLines: { id, description, severity }[]` ma `allowed` è sempre `false` se ce n'è almeno una, ignorando la severity.

### 🟠 B6 — `DEFAULT_RED_LINES` non ha campo `id`, `listRedLines` finge ID finti

**File**: `src/lib/kernel/erl.ts:259-269`

```ts
export async function listRedLines() {
  const rows = await db.redLine.findMany({ where: { active: true } })
  return rows.length ? rows : DEFAULT_RED_LINES.map((r, i) => ({
    id: `default-${i}`,  // ID finto
    description: r.description,
    // ...
  }))
}
```

Quando il DB è vuoto, `listRedLines` ritorna ID finti (`default-0`, `default-1`). Se l'UI usa questi ID per `toggleRedLine` o `deleteRedLine`, l'API ritorna 404 perché nel DB non esistono. L'utente non può modificare le Red Lines default finché non vengono seedate.

### 🟠 B7 — `reflectAndLearn` non gestisce race condition su `operationId` duplicati

**File**: `src/lib/kernel/erl.ts:179-223`

`reflectAndLearn` crea sempre un nuovo `ReflectionLog` e `Heuristic`. Se chiamato due volte con lo stesso `operationId` (es. retry su crash), crea duplicati. `ReflectionLog.operationId` non ha unique constraint, e `Heuristic.source` non è unique.

Manca idempotency: `operationId` dovrebbe essere unique su `ReflectionLog` per prevenire duplicati su retry.

### 🟠 B8 — `governance-hooks` fallisce aperto (fail-open) su tutti gli errori

**File**: `src/lib/runtime/governance-hooks.ts` (tutto il file)

Ogni hook ha `catch (err) { return { allowed: true, ... } }` — fail-open. Se il DB è giù, o c'è un errore di rete, **tutti i gate diventano transparenti**. Questo è per design (non bloccare il runtime su errori infrastrutturali), ma:
- Non c'è opzione `failClose: true` per ambienti critici
- Non c'è alerting quando un hook fallisce (solo `console.error`)
- Non c'ena rate limiting sui fallimenti (un errore persistente spamma il log)

---

## 4. Gap funzionali

### 🟡 G1 — Zero integrazione `preExecuteGate` nell'executor

**File**: `src/lib/runtime/executor.ts`

Come C3: `preExecuteGate` non è chiamato da nessuna parte nel runtime. L'executor dovrebbe chiamarlo prima del ReAct loop o prima di tool call sensibili, ma non lo fa.

### 🟡 G2 — `supervisorReview` non usa le Red Lines caricate per il matching

**File**: `src/lib/kernel/erl.ts:143-174`

Come C1: la lista `lines` è caricata ma non usata per il matching. Le regex sono hardcoded. Dovrebbe:
1. Per ogni Red Line attiva, compilare la `description` in un matcher (substring o regex derivata)
2. Testare l'euristica + step contro ogni Red Line
3. Ritornare `blockingRedLine` con ID e description

### 🟡 G3 — Nessun test per `supervisorReview` con Red Lines custom

**File**: `tests/unit/erl.test.ts`

I 17 test esistenti coprono `DEFAULT_RED_LINES` structure e `extractHeuristicRuleBased` logic. Non c'è test che:
- Verifichi che `supervisorReview` blocca con Red Lines custom del DB
- Verifichi che `supervisorReview` non blocca con euristiche legittime
- Verifichi il return type `blockingRedLine`

### 🟡 G4 — `evaluateRedLinesForAction` non ha test per falsi positivi

**File**: `tests/integration/governance-hooks.test.ts`

I test esistenti verificano che il hook blocca azioni che matchano, ma non verificano che **non** blocca azioni legittime con overlap parziale. Manca test per:
- Red Line "non ignorare dataset" + action "leggi dataset" → dovrebbe ALLOW
- Red Line "non bypassare sicurezza" + action "aggiorna sicurezza" → dovrebbe ALLOW

### 🟡 G5 — `TOOL_SINK_MAP` in governance-hooks è hardcoded, duplica `SENSITIVE_SINKS` di taint.ts

**File**: `src/lib/runtime/governance-hooks.ts:53-73`

`TOOL_SINK_MAP` mappa tool names a sink categories, ma è hardcoded e duplica la logica di `SENSITIVE_SINKS` (ora configurabile via SystemSetting, dopo B7 del modulo Taint). I due sistemi non sono sincronizzati: se l'admin aggiunge un sink via SystemSetting, `TOOL_SINK_MAP` non lo riconosce.

### 🟡 G6 — `reflectAndLearn` non persiste l'embedding se `embed()` fallisce

**File**: `src/lib/kernel/erl.ts:201-213`

```ts
const emb = embed(`${heuristic.trigger} ${heuristic.action} ${heuristic.context}`)
await db.heuristic.create({
  data: { ... embedding: serialize(emb), ... },
})
```

Se `embed()` throwa (es. modello non disponibile), l'intero `reflectAndLearn` fallisce e l'euristica è persa. Manca fallback: se embed fallisce, persisti con embedding vuoto o nullo, e marca per re-embedding asincrono.

### 🟡 G7 — Nessun test integration end-to-end ERL → Red Line → Heuristic storage

**File**: `tests/` (manca)

Manca un integration test che:
1. Crea una Red Line custom via admin API
2. Chiama `reflectAndLearn` con input che viola la Red Line custom
3. Verifica che l'euristica NON è persistita su `Heuristic`
4. Verifica che `ReflectionLog.redLineFlag = true`

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3, B4, B6)

1. **C1 + G2**: Riscrivere `supervisorReview` per usare Red Lines caricate dal DB:
   - Per ogni Red Line attiva, compilare `description` in matcher (substring case-insensitive)
   - Testare combined text contro ogni Red Line
   - Ritornare `blockingRedLine: { id, description, severity }` nel result
   - Mantenere le 3 regex hardcoded come check aggiuntivi (non sostitutivi)
2. **C2**: Migliorare matching di `evaluateRedLinesForAction`:
   - Rimuovere `keywordOverlap` con token >4 (troppo aggressivo)
   - Usare solo `actionContainsDesc` o `descContainsAction` (substring match esatto)
   - Aggiungere opzione `matchMode: 'exact' | 'keyword'` per flessibilità
3. **C3 + G1**: Integrare `preExecuteGate` in `executor.ts`:
   - Chiamare prima del ReAct loop in `executeTask`
   - Se `!allowed` → `step.status = 'blocked'`, skip esecuzione
   - Non bloccante (fail-open) per backward compat
4. **B4**: `supervisorReview` ritorna `blockingRedLine` strutturato:
   - Aggiornare return type: `{ approved, reason, blockingRedLine?: { id, description, severity } }`
   - `reflectAndLearn` propaga `blockingRedLine` nel result
5. **B6**: `listRedLines` seeda DEFAULT_RED_LINES se DB vuoto:
   - Invece di fingere ID, creare record nel DB al primo GET
   - L'admin può poi toggle/delete normalmente

### Fase B — Robustezza (B1, B2, B3, B5, B7, B8)

1. **B1**: Rendere LLM parse regex più robusto:
   - Aggiungere pattern alternativi: "If X then Y", "Per X esegui Y", "Quando X: Y"
   - Se nessun match, split su prima frase come trigger, seconda come action
   - Test con 5+ formati diversi
2. **B2**: `feedbackHeuristic` ritorna `{ updated: boolean, reason?: string }`:
   - Se ID non esiste → `{ updated: false, reason: 'heuristic not found' }`
   - Cap su `appliedCount` a 1M (overflow protection)
3. **B3**: `retrieveHeuristics` usa pgvector o pre-filtering:
   - Se pgvector disponibile, usa `cosineSearch` nativo
   - Altrimenti, limit a top 100 by `appliedCount * successRate` prima di cosine
   - Test con 1000+ euristiche
4. **B5**: `evaluateRedLinesForAction` distingue severity:
   - `absolute` → block (allowed=false)
   - `strong` → block ma ritorna `overridable: true`
   - `soft` → warn (allowed=true ma ritorna `warnings[]`)
5. **B7**: `reflectAndLearn` idempotency:
   - Aggiungere `@@unique` su `ReflectionLog.operationId`
   - Se operationId esiste già, ritorna risultato esistente (no duplicati)
6. **B8**: Governance hooks fail-close opzione:
   - Aggiungere `failMode: 'open' | 'close'` a SystemSetting
   - Se `close`, errori bloccano invece di allow
   - Alerting via `publishAgentEvent` quando hook fallisce

### Fase C — UX & completamento (B3 fallback, G3, G4, G5, G6, G7)

1. **G3**: Test per `supervisorReview` con Red Lines custom:
   - Crea Red Line custom nel DB
   - Chiama `reflectAndLearn` con input che viola
   - Verifica blockingRedLine nel result
2. **G4**: Test per falsi positivi in `evaluateRedLinesForAction`:
   - Red Line "non ignorare dataset" + action "leggi dataset" → ALLOW
   - Red Line "non bypassare sicurezza" + action "aggiorna sicurezza" → ALLOW
3. **G5**: Sincronizzare `TOOL_SINK_MAP` con `getSensitiveSinks()`:
   - `checkToolCallSink` legge da SystemSetting (come `checkSink` dopo B7)
   - Rimuovere `TOOL_SINK_MAP` hardcoded
4. **G6**: `reflectAndLearn` fallback embedding:
   - Se `embed()` fallisce, persisti con embedding vuoto `[]`
   - Marca `Heuristic.needsEmbedding = true` per re-embedding asincrono
   - `retrieveHeuristics` skip euristiche con embedding vuoto
5. **G7**: Integration test end-to-end:
   - Crea Red Line custom → reflectAndLearn viola → Heuristic non persistita
   - Crea Red Line custom → reflectAndLearn passa → Heuristic persistita
   - preExecuteGate blocca action con Red Line attiva

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 7 (2 core + 2 API + 1 UI + 2 test) |
| LOC totali | ~1.400 |
| Bug critici (C) | 3 |
| Bug medi (B) | 8 |
| Gap funzionali (G) | 7 |
| Test esistenti | 17 unit + integration governance-hooks |
| Stima Fase A | 1.5 giornate |
| Stima Fase B | 1.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale stimato** | **4 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3+B4+B6) — effettività + sicurezza. **Critica**.
   - C1+G2: supervisorReview usa Red Lines custom (non più cosmetico)
   - C2: matching meno aggressivo (no falsi positivi)
   - C3+G1: preExecuteGate integrato in executor (non più cosmetico)
2. **Fase B** (B1+B2+B3+B5+B7+B8) — robustezza. **Alta**.
3. **Fase C** (G3+G4+G5+G6+G7) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: supervisorReview ignora Red Lines custom (gate cosmetico per admin)
- C2: evaluateRedLinesForAction troppo aggressivo (falsi positivi bloccano azioni legittime)
- C3: governance-hooks non integrato in executor (cosmetico a runtime)

Tempo stimato: 1.5 giornate.
