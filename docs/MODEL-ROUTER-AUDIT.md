# Model Router — Audit & Hardening

**Data**: 2026-09-02
**Modulo**: `Model Router` — Phase 14 (F14)
**Scope**: `src/lib/kernel/time-router.ts` · `src/app/api/router/route.ts` · `src/components/agentic/phase14.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/time-router.ts` | 325 | Core: `extractFeatures` + `scoreModels` (classificatore) + `route` (gate selettivo + ensemble fallback + LLM call + dedup cache) + `simulateModelOutput` + `getOrCreateConfig` + `updateConfig` + `listRoutingDecisions` + `routerStats` |
| `src/app/api/router/route.ts` | 95 | API REST: GET decisions/stats/models/features + POST route/update_config |
| `src/components/agentic/phase14.tsx` | 243 | UI: form Route Prompt + feature display + storico decisioni |

### Schema Prisma (DB)

```prisma
model FoundationModel {
  id           String   @id @default(cuid())
  modelId      String   @unique
  name         String
  specialization String  // code|reasoning|math|logic|general
  costPer1kTokens Float @default(0.0)
  avgLatencyMs Int      @default(500)
  active       Boolean  @default(true)
}

model RoutingDecision {
  id           String   @id @default(cuid())
  agentId      String
  inputHash    String   // hash del prompt input per dedup
  inputFeatures String  // JSON: feature estratte
  primaryModel String   // modello scelto come leader
  confidence   Float    // confidenza del router
  margin       Float    // margine tra top-2 modelli
  diversity    Float    // diversità tra predizioni
  routedTo     String   // primary|ensemble|critic
  ensembleModels String? // JSON: modelli usati in ensemble
  finalOutput  String?  // output finale
  createdAt    DateTime @default(now())
}

model RouterConfig {
  id           String   @id @default(cuid())
  marginThreshold Float @default(0.2)
  diversityThreshold Float @default(0.3)
  minConfidence Float   @default(0.6)
  enableEnsemble Boolean @default(true)
  enableCritic Boolean  @default(true)
  updatedAt    DateTime @updatedAt
}
```

### Stato pre-audit

Il modulo è stato auditato nel ciclo Learn Domain (`docs/LEARN-DOMAIN-FASE1-AUDIT.md`) con fix già applicati:
- ✅ N1: POST `update_config` richiede `requireAdmin` (era `requireAuth`) + AgentLog
- ✅ N3: ensemble/critic routing documentato come future work (single LLM call)
- ✅ N4: LLM error message non persistito nel DB (usa `null` + flag `llmError`)
- ✅ N5: `inputHash` dedup implementato (cache hit ritorna decision esistente)
- ✅ N8: `phase14.tsx` JSON.parse in try/catch (ensembleModels)
- ✅ N10: phase14.tsx adaptive polling con Page Visibility API
- ✅ 5 test in `tests/unit/learn-domain-core.test.ts` (extractFeatures struttura, empty prompt, routerStats, DEFAULT_MODELS, listRoutingDecisions)

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `route()` result non è applicato all'LLM call nel react-loop (routing cosmetico)

**File**: `src/lib/runtime/react-loop.ts:150, 309`

Il `route()` function calcola `primaryModel`, `confidence`, `routedTo` e persiste la decisione. Tuttavia, il `react-loop.ts` (chiamato dall'executor) **non usa il `modelId` dal routing result**:

```ts
// react-loop.ts:150
const completion = await zai.chat.completions.create({
  messages: messages as any,
  ...(tools.length > 0 && { tools: tools as any }),
  max_tokens: 500,
  // C1: manca model: routedModel.modelId
})
```

Il `getRoutedModel` in `acts.ts:466` viene chiamato da `steer()` e ritorna `routedModel` nel result, ma l'executor non lo passa al react-loop. Il routing è **cosmetico**: il modello è scelto e loggato, ma l'LLM call usa sempre il modello default dello ZAI SDK.

**Impatto**: l'"Adaptive Routing" (massimizzare performance riducendo tempi e costi) non è effettivo. Tutti i prompt vanno allo stesso modello, indipendentemente dalle feature estratte (code/math/logic/complexity).

### 🔴 C2 — `finalOutput` persistito senza size cap (DB bloat risk)

**File**: `src/lib/kernel/time-router.ts:223-237`

```ts
const decision = await db.routingDecision.create({
  data: {
    agentId,
    inputHash,
    inputFeatures: JSON.stringify(features),  // C2: no size cap
    primaryModel: primary.modelId,
    confidence,
    margin,
    diversity,
    routedTo,
    ensembleModels: ensembleModels ? JSON.stringify(ensembleModels) : null,  // C2: no size cap
    finalOutput: outputForCaller,  // C2: no size cap!
  },
})
```

Come C3 degli altri moduli: `finalOutput` (LLM output), `inputFeatures` (JSON features), `ensembleModels` (JSON array) sono persistiti senza size cap. Un LLM output di 100KB viene salvato interamente nel DB → bloat.

### 🔴 C3 — `updateConfig` non valida range dei valori

**File**: `src/lib/kernel/time-router.ts:278-290`

```ts
export async function updateConfig(updates: {
  marginThreshold?: number
  diversityThreshold?: number
  minConfidence?: number
  enableEnsemble?: boolean
  enableCritic?: boolean
}) {
  // C3: nessuna validazione range
  const existing = await db.routerConfig.findFirst()
  if (existing) {
    return db.routerConfig.update({ where: { id: existing.id }, data: updates })
  }
  return db.routerConfig.create({ data: updates })
}
```

Come B5 del modulo Affect Monitor: nessuna validazione range su `marginThreshold`, `diversityThreshold`, `minConfidence` (devono essere in [0, 1]). Un admin può impostare `minConfidence: 5.0` → nessun routing soddisfa mai la soglia → sempre ensemble → cost explosion.

---

## 3. Bug (Medium)

### 🟠 B1 — `phase14.tsx` `refresh()` senza try/catch su fetch

**File**: `src/components/agentic/phase14.tsx:50-57`

```ts
const refresh = async () => {
  const [decR, statsR] = await Promise.all([
    fetch('/api/router?action=decisions').then((r) => r.json()),
    fetch('/api/router?action=stats').then((r) => r.json()),
  ])
  setDecisions(decR.decisions || [])
  setStats(statsR)
}
```

Come B1/B2 degli altri moduli: un fetch fallito fa throw unhandled rejection, rompe il polling `setInterval` e lascia la UI in stato stale.

### 🟠 B2 — `phase14.tsx` `route()` senza try/catch né parse-safe

**File**: `src/components/agentic/phase14.tsx:74-87`

```ts
const route = async () => {
  const r = await fetch('/api/router', { ... })
  const d = await r.json()  // B2: può throware se risposta non JSON
  if (d.ok) {
    // ...
  }
  // B2: no else for !d.ok → errore silente
}
```

- `r.json()` può throware su risposta non JSON (500 con body HTML)
- Nessun `toast.error` se `d.ok === false` (errore silente)
- Nessun try/catch esterno per network error
- `features` fetch (riga 67-69) ha lo stesso problema

### 🟠 B3 — `routerStats` fa query sequenziale dopo Promise.all

**File**: `src/lib/kernel/time-router.ts:299-325`

```ts
export async function routerStats() {
  const [decisions, ensemble, critic, primary] = await Promise.all([...])  // 4 query
  const recent = await db.routingDecision.findMany({  // sequenziale
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { primaryModel: true },
  })
  // ...
}
```

Come B1/B3 degli altri moduli: 4 query in Promise.all + 1 sequenziale (recent per topModel) = 2 round-trip DB invece di 1.

### 🟠 B4 — `route()` non ha retry logic su LLM failure

**File**: `src/lib/kernel/time-router.ts:203-217`

```ts
try {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({ ... })
  finalOutput = completion.choices[0]?.message?.content || 'No output from model.'
} catch (e: any) {
  llmError = e.message
  finalOutput = null
}
```

Come B4 del modulo Model Encapsulator: se la prima chiamata LLM fallisce (rate limit 429, timeout), ritorna subito il fallback `simulateModelOutput`. Nessun retry.

### 🟠 B5 — `FoundationModel` DB table mai usata (N15 non fixato)

**File**: `src/lib/kernel/time-router.ts:25-32`

```ts
export const DEFAULT_MODELS: FoundationModelSpec[] = [
  { modelId: 'glm-4.6', name: 'GLM-4.6', specialization: 'general', ... },
  // ...
]
```

Lo schema Prisma ha `FoundationModel` table, ma `time-router.ts` usa `DEFAULT_MODELS` hardcoded. Aggiungere un modello richiede change al codice, non una query DB. N15 del Learn Domain audit era stato identificato ma non fixato.

### 🟠 B6 — `extractFeatures` regex possono essere lente su prompt enormi (ReDoS risk)

**File**: `src/lib/kernel/time-router.ts:64-66`

```ts
const hasCode = /```|function\s*\(|return\s+|const\s+|let\s+|class\s+/.test(prompt)
const hasMath = /[∫∑√π≤≥≠∞±×÷]|[a-z]\^[0-9]|[a-z]_[0-9]|\b(equation|theorem|proof|integral)\b/i.test(prompt)
const hasLogic = /\b(if|then|else|forall|exists|implies|and|or|not)\b|→|↔|∀|∃|∧|∨|¬/.test(prompt)
```

Le regex non sono catastroficamente backtracking-prone, ma su prompt di 1MB+ possono essere lente. Mancano:
- Size cap su `prompt` prima di `extractFeatures` (1MB max)
- Timeout su regex evaluation

---

## 4. Gap funzionali

### 🟡 G1 — Zero unit test per `scoreModels`, `route`, `getOrCreateConfig`, `updateConfig`, `simulateModelOutput`

I 5 test in `learn-domain-core.test.ts` coprono solo `extractFeatures` struttura, `routerStats`, `DEFAULT_MODELS`, `listRoutingDecisions`. Mancano test per:
- `scoreModels` in isolamento (scoring per dominio, complessità, costo)
- `route` lifecycle (primary/ensemble/critic, dedup cache N5, llmError N4)
- `getOrCreateConfig` default values
- `updateConfig` upsert behavior
- `simulateModelOutput` fallback format

### 🟡 G2 — `phase14.tsx` nessun a11y (aria-label, role=status)

**File**: `src/components/agentic/phase14.tsx`

243 LOC senza `aria-*` o `role` su button e stats grid. Come G2 degli altri moduli.

### 🟡 G3 — `phase14.tsx` `route()` e `features` fetch non hanno parse-safe su `r.json()`

**File**: `src/components/agentic/phase14.tsx:68, 80`

Come G3 degli altri moduli: `r.json()` può throware su risposta non JSON. Parse-safe con `try/catch` interno + fallback `r.text()`.

### 🟡 G4 — `routerStats` manca metriche utili (ensembleRate, avgConfidence, cacheHitRate)

**File**: `src/lib/kernel/time-router.ts:317-325`

```ts
return {
  decisions,
  ensemble,
  critic,
  primary,
  topModel: topModel ? topModel[0] : 'none',
  topModelPct: topModel && recent.length ? topModel[1] / recent.length : 0,
}
```

Mancano:
- `ensembleRate` ((ensemble + critic) / decisions, % routing non-primary)
- `avgConfidence` (media confidence delle decisions recenti)
- `cacheHitRate` (decisions cached / decisions total, % dedup cache hit — richiede campo `cached` nel DB o count separato)
- `avgMargin` (media margin, per monitorare qualità routing)

Come G4 degli altri moduli.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3)

1. **C1**: Integrare `route()` result nel react-loop: passare `model: routedModel.modelId` a `zai.chat.completions.create`. L'executor deve ricevere `routedModel` da `steer()` e passarlo al react-loop.
2. **C2**: Size cap su `finalOutput` (50KB), `inputFeatures` (10KB), `ensembleModels` (2KB) con marker `[truncated]`.
3. **C3**: `updateConfig` valida range: `marginThreshold`/`diversityThreshold`/`minConfidence` in [0, 1], `enableEnsemble`/`enableCritic` boolean.

### Fase B — Robustezza (B1, B2, B3, B4, B6)

1. **B1**: `phase14.tsx` `refresh()` con try/catch + toast.error + preserva stato
2. **B2**: `phase14.tsx` `route()` e `features` fetch con parse-safe + toast.error su `!d.ok`
3. **B3**: `routerStats` — `recent` query in `Promise.all` con le altre 4 (1 round-trip DB)
4. **B4**: `route()` retry logic su LLM failure (max 2 retry con backoff)
5. **B6**: `extractFeatures` size cap su prompt (1MB max, tronca prima di regex)

### Fase C — UX & completamento (G1, G2, G3, G4)

1. **G1**: Unit test per `scoreModels` (scoring per dominio/complessità/costo), `route` lifecycle (primary/ensemble/critic, dedup, llmError), `getOrCreateConfig`/`updateConfig`, `simulateModelOutput`
2. **G2**: a11y in `phase14.tsx` (aria-label su button, role=status su stats grid)
3. **G3**: `phase14.tsx` `route()`/`features` parse-safe (assorbito in B2)
4. **G4**: `routerStats` con 3 metriche aggiuntive (ensembleRate, avgConfidence, avgMargin) + UI phase14.tsx con stat card aggiuntive

**Nota**: B5 (`FoundationModel` DB table) è un refactoring che richiede migration + seeding. Rimandato a future work — documentato come known limitation (N15 Learn Domain).

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 3 (1 core + 1 API + 1 UI) |
| LOC totali | ~663 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 5 (in learn-domain-core: extractFeatures, routerStats, DEFAULT_MODELS, listRoutingDecisions) |
| Consumer runtime | `acts.ts:466` getRoutedModel (cosmetico — result non applicato al react-loop) |
| Fix preesistenti | N1 (requireAdmin), N3 (ensemble future work), N4 (error not persisted), N5 (dedup cache), N8 (JSON.parse try/catch), N10 (adaptive polling) |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3) — sicurezza & effettività. **Critica**.
   - C1: route() result applicato al react-loop (routing non più cosmetico)
   - C2: size cap su finalOutput/inputFeatures/ensembleModels (no DB bloat)
   - C3: updateConfig valida range (no cost explosion da config invalido)
2. **Fase B** (B1+B2+B3+B4+B6) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: route() result applicato al react-loop (adaptive routing non più cosmetico)
- C2: size cap su finalOutput/inputFeatures (no DB bloat su LLM output enormi)
- C3: updateConfig valida range (no cost explosion da config invalido)

Tempo stimato: 1 giornata.
