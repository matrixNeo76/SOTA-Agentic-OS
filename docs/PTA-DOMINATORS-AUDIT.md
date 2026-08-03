# PTA Dominators — Audit & Hardening

**Data**: 2026-07-26
**Modulo**: `PTA Dominators` — Advanced/Internals (Phase 7)
**Scope**: `src/lib/kernel/dominator-tree.ts` · `src/app/api/dominator/route.ts` · `src/components/agentic/phase7.tsx` · `prisma/schema.prisma` (ExecutionTrace + PrefixTreeAutomaton + TraceValidation)

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/dominator-tree.ts` | 383 | Core: `captureTrace` + `buildPTA` (costruzione albero) + `computeDominators` (dataflow algorithm) + `validateTrace` (coverage check) + `dominatorStats` + `getPTA` + `listTraces` |
| `src/app/api/dominator/route.ts` | 92 | API REST: GET pta/traces/stats + POST capture_trace/build_pta/validate_trace |
| `src/components/agentic/phase7.tsx` | 389 | UI: trace capture form + PTA builder + validation + PTA graph view + stats |
| `prisma/schema.prisma` | 35 | Modelli `ExecutionTrace` + `PrefixTreeAutomaton` + `TraceValidation` |

### Stato pre-audit

Il modulo NON è stato auditato in precedenza. **Zero test coverage**. Nessun consumer runtime (executor non chiama captureTrace/validateTrace).

---

## 2. Criticità (Critical)

### 🔴 C1 — API POST `/api/dominator` usa `requireAuth` invece di `requireAdmin`

**File**: `src/app/api/dominator/route.ts:41-42`

```ts
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)  // ← solo requireAuth
  // capture_trace, build_pta, validate_trace sono mutative
}
```

`capture_trace` crea ExecutionTrace (inquina il PTA con tracce false), `build_pta` sovrascrive il PTA esistente, `validate_trace` crea TraceValidation. Un viewer può eseguire tutte queste azioni.

### 🔴 C2 — `validateTrace` ha `break` che contraddice il commento "Non interrompere"

**File**: `src/lib/kernel/dominator-tree.ts:280-291`

```ts
for (const s of states) {
  if (current.children[s]) {
    current = nodes[current.children[s]]
    visitedNodeIds.push(current.id)
  } else {
    // Transizione non presente nel PTA: deviazione
    pathValid = false
    // Non interrompere: continuiamo per calcolare coverage sui dominatori
    // rimanenti tramite matching semantico dello stato
    break  // ← CONTRADDICE il commento!
  }
}
```

Il commento dice "Non interrompere: continuiamo per calcolare coverage", ma il codice fa `break`. Questo significa che se la traccia devia al step 3 di 10, i dominatori nei step 4-10 non sono mai valutati → coverage sottostimato → falsi reject.

### 🔴 C3 — `captureTrace` non valida input (states vuoto, workflowId vuoto)

**File**: `src/lib/kernel/dominator-tree.ts:44-61`

```ts
export async function captureTrace(workflowId, traceLabel, states, actions, outcome) {
  const trace = await db.executionTrace.create({
    data: {
      workflowId,  // può essere ''
      traceLabel,  // può essere ''
      statesJson: JSON.stringify(states),  // può essere '[]'
      actionsJson: JSON.stringify(actions),
      outcome,
    },
  })
  return trace.id
}
```

Nessuna validazione. `states = []` crea una traccia vuota che corrompe il PTA (path di lunghezza 0). `workflowId = ''` crea tracce senza workflow associato.

---

## 3. Bug (Medium)

### 🟠 B1 — `phase7.tsx` `refresh()` e `capture()` senza try/catch su fetch

**File**: `src/components/agentic/phase7.tsx:56-64, 77-97`

```ts
const refresh = async () => {
  const [tracesR, ptaR, statsR] = await Promise.all([
    fetch(...).then((r) => r.json()),  // no try/catch
    fetch(...).then((r) => r.json()),
    fetch(...).then((r) => r.json()),
  ])
}

const capture = async () => {
  const r = await fetch(...)  // no try/catch
  const d = await r.json()
}
```

Come B6 degli altri moduli: unhandled promise rejection su network error. `buildPta` ha try/catch ma `refresh` e `capture` no.

### 🟠 B2 — `buildPTA` fa `JSON.parse(trace.statesJson)` senza try/catch

**File**: `src/lib/kernel/dominator-tree.ts:95`

```ts
const states: DiscreteState[] = JSON.parse(trace.statesJson)
```

Se `statesJson` è corrotto (es. troncato, o creato prima di un cambio formato), `JSON.parse` throwa e l'intero `buildPTA` fallisce. Come C3 del modulo Context Manager.

### 🟠 B3 — `validateTrace` fa `JSON.parse` su 4 campi senza try/catch

**File**: `src/lib/kernel/dominator-tree.ts:266-273`

```ts
const nodes: Record<string, PTANode> = JSON.parse(ptaRow.nodesJson)
const dominators: string[] = JSON.parse(ptaRow.dominatorsJson)
const acceptNodeIds: string[] = JSON.parse(ptaRow.acceptNodeIds)
```

Se uno qualsiasi di questi campi JSON è corrotto, `validateTrace` crasha. Come C3 del modulo Context Manager.

### 🟠 B4 — No size cap su `statesJson` e `actionsJson`

**File**: `src/lib/kernel/dominator-tree.ts:55-56`

```ts
statesJson: JSON.stringify(states),   // no size limit
actionsJson: JSON.stringify(actions), // no size limit
```

Come B7 del modulo Context Manager: payload enormi → DB bloat.

### 🟠 B5 — `dominatorStats` carica 100 TraceValidation per calcolare avg

**File**: `src/lib/kernel/dominator-tree.ts:343-353`

```ts
const recentValidations = await db.traceValidation.findMany({
  orderBy: { timestamp: 'desc' },
  take: 100,
  select: { verdict: true, dominatorCoverage: true },
})
const avgCoverage = recentValidations.reduce(...)
```

Carica 100 record per calcolare media. Con Prisma `aggregate` sarebbe O(1) query invece di O(100) transfer.

### 🟠 B6 — `computeDominators` non ha ciclo di guardia sul while

**File**: `src/lib/kernel/dominator-tree.ts:187-209`

```ts
let changed = true
while (changed) {
  changed = false
  // ... modifica doms ...
  if (...) { changed = true }
}
```

Il dataflow algorithm è garantito convergere su grafi aciclici (PTA è un albero), ma non c'è cap esplicito sul numero di iterazioni. Se il grafo avesse cicli (bug nella costruzione del PTA), potrebbe loopare indefinitamente.

---

## 4. Gap funzionali

### 🟡 G1 — Zero test per `dominator-tree.ts`

Nessun test esistente. Funzioni critiche non testate: `captureTrace`, `buildPTA`, `computeDominators`, `validateTrace`, `dominatorStats`, `getPTA`.

### 🟡 G2 — `phase7.tsx` nessun a11y (aria-label, role)

349 LOC senza `aria-*` o `role`. Come G4 degli altri moduli.

### 🟡 G3 — `captureTrace` non integrato nell'executor (cosmetico a runtime)

Come C1 degli altri moduli: `captureTrace` è esposto via API ma non chiamato dal runtime. L'executor dovrebbe catturare tracce automaticamente durante l'esecuzione dei task.

### 🟡 G4 — `validateTrace` non gestisce PTA con 0 dominatori

**File**: `src/lib/kernel/dominator-tree.ts:295-297`

```ts
const dominatorCoverage = dominators.length > 0
  ? passedDominatorIds.length / dominators.length
  : 1.0  // ← se 0 dominators, coverage = 1.0 (sempre accept)
```

Se il PTA ha 0 dominatori (es. una sola traccia, nessun branch), `coverage = 1.0` → sempre accept. Questo è semanticamente discutibile: una traccia completamente errata verrebbe accettata.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & robustezza (C1, C2, C3, B2, B3)

1. **C1**: `requireAdmin` su POST `/api/dominator` per azioni mutative
2. **C2**: Rimuovere `break` in `validateTrace`, continuare simulazione con fallback
3. **C3**: Validazione input in `captureTrace` (states non vuoto, workflowId non vuoto)
4. **B2**: `buildPTA` try/catch su `JSON.parse(trace.statesJson)`
5. **B3**: `validateTrace` try/catch su tutti i `JSON.parse`

### Fase B — Robustezza (B1, B4, B5, B6)

1. **B1**: `phase7.tsx` try/catch su `refresh()` e `capture()`
2. **B4**: Size cap su `statesJson`/`actionsJson` (50KB)
3. **B5**: `dominatorStats` usa `aggregate` invece di caricare 100 record
4. **B6**: `computeDominators` cap iterazioni (max 1000)

### Fase C — UX & completamento (G1, G2, G3, G4)

1. **G1**: Unit test per `buildPTA`, `computeDominators`, `validateTrace`
2. **G2**: a11y in `phase7.tsx`
3. **G3**: Integrazione `captureTrace` nell'executor (non bloccante)
4. **G4**: `validateTrace` con 0 dominators → warn invece di accept

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 4 (1 core + 1 API + 1 UI + 1 schema) |
| LOC totali | ~860 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 0 |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3+B2+B3) — sicurezza & robustezza. **Critica**.
2. **Fase B** (B1+B4+B5+B6) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: requireAdmin su mutative (viewer non può più inquinare PTA)
- C2: validateTrace non più break su deviazione (coverage accurato)
- C3: captureTrace valida input (no tracce vuote/corrotte)

Tempo stimato: 1 giornata.
