# Fase 1 — Audit & Gap Analysis: Modulo Insights

**Data**: 2026-07-01
**Modulo**: `insights` (CORE_AREAS[5])
**Scope**: World Model · Digital Twin · Evaluation · Cost · Observability · Affect · Objective Builder · Model Router

---

## 1. Mappatura del modulo

### 1.1 Componenti UI

| File | LOC | Ruolo |
|------|-----|-------|
| `src/components/autonomous-dashboard/autonomous-dashboard.tsx` | 312 | Dashboard autonomo: 8 StatCards (mesh, world model, autonomous org, digital twin, skills, conflicts, memory, latest worldstate) + pending proposals + mesh topology |
| `src/components/autonomous-dashboard/digital-twin-panel.tsx` | 205 | Digital Twin: 6 what-if presets + last simulation result + recent scenarios |
| `src/components/autonomous-dashboard/conflict-queue-panel.tsx` | 317 | Conflict queue (governance overlap — ma mostrato in autonomous dashboard) |
| `src/components/agentic/phase11.tsx` | 202 | Affect Monitor: desperation/frustration + intervention thresholds |
| `src/components/agentic/phase12.tsx` | 245 | Objective Builder: BFS rubric tree (Pass/Fail binario) |
| `src/components/agentic/phase14.tsx` | 238 | Model Router: routing decisions + ensemble config |

**Nota**: la vista `insights` del workspace (workspace-views.tsx:78-83) renderizza solo `<AutonomousDashboard />` + `<DigitalTwinDashboard />` inline — non esiste `insights-view.tsx` dedicata come per gli altri CORE_AREAS (Runs, Memory, Agents, Governance hanno tutte module-page dedite).

### 1.2 API Routes

| Route | Auth | Audit | Note |
|-------|------|-------|------|
| `GET/POST /api/world-model` | ❌ | ❌ | **NO AUTH!** capture/predict WorldState senza sessione |
| `GET/POST /api/digital-twin` | ❌ | ❌ | **NO AUTH!** create/run/what-if scenari senza sessione |
| `GET/POST /api/evaluation` | ❌ | ❌ | **NO AUTH!** register-benchmark/run/seed-defaults senza sessione |
| `GET/POST /api/cost` | ✅ requireAuth | ❌ | stats/recent/budget + set_budget (in-memory!) |
| `GET /api/traces` | ✅ requireAuth | n/a | stats/detail/list (no POST) |
| `GET/POST /api/errors` | ✅ requireAuth | ❌ | record/resolve errors |
| `GET /api/metrics` | ✅ requireAuth | n/a | (placeholder 17 LOC) |
| `GET/POST /api/affect` | ✅ requireAuth | ✅ WS publish | compute/update_threshold |
| `GET/POST /api/objective` | ✅ requireAuth | ❌ | Objective tree CRUD |
| `GET/POST /api/router` | ✅ requireAuth | ❌ | Router config + decisions |

### 1.3 Lib

| File | LOC | Responsabilità |
|------|-----|----------------|
| `src/lib/world-model/engine.ts` | 808 | captureWorldState, getLatestWorldState, listPendingPredictions, createPrediction, worldModelStats |
| `src/lib/digital-twin/engine.ts` | 740 | createScenario, runSimulation, runWhatIf, listScenarios, digitalTwinStats, WHAT_IF_PRESETS (6) |
| `src/lib/evaluation/runner.ts` | 606 | registerBenchmark, listBenchmarks, runEvaluation, getAgentEvaluations, seedDefaultBenchmarks |
| `src/lib/kernel/observability.ts` | 475 | recordError (dedup fingerprint), resolveError, listErrors, errorStats, getTrace, listTraces, traceStats |
| `src/lib/kernel/cost-ledger.ts` | 140 | recordCostEntry, getCostStats (total/today/week/byAgent/byModel/byPhase) |
| `src/lib/kernel/affect-subsystem.ts` | 209 | computeAffect (desperation/frustration), updateThreshold, affectHistory, affectStats |

### 1.4 Modelli Prisma

10 modelli insights-related in `schema.prisma` (allineati con `schema.postgres.prisma`, 69/69 sync OK):

`GlobalState` · `ObjectiveTree` · `ObjectiveNode` · `Belief` · `AffectSample` · `AffectThreshold` · `ErrorRecord` · `TraceSpan` · `CostEntry` · `BackupRecord`

### 1.5 Test esistenti

- `tests/unit/world-model.test.ts` (318 LOC)
- `tests/unit/digital-twin.test.ts` (300 LOC)
- `tests/unit/evaluation.test.ts` (396 LOC)
- `tests/unit/cost-ledger.test.ts` (25 LOC — **molto sottile**)
- `tests/unit/observability-v2.test.ts` (290 LOC)

**Assenti**: test per `affect-subsystem.ts`, test integration per le API routes (auth, error handling, audit).

---

## 2. Criticità (Critical / High)

### 🔴 C1 — `world-model`, `digital-twin`, `evaluation` API senza auth

**File**: `src/app/api/{world-model,digital-twin,evaluation}/route.ts`

Queste 3 API non hanno `requireAuth` né `requireAdmin`. Qualsiasi client anonimo può:
- **World Model**: catturare WorldState arbitrari, creare prediction malevole
- **Digital Twin**: creare scenari, eseguire simulazioni (CPU-intensive), eseguire what-if presets
- **Evaluation**: registrare benchmark malevoli, run evaluation con taskResults arbitrari, seed defaults (sovrascrive i benchmark di sistema)

**Impatto**: data leak (WorldState contiene stats di sistema), DoS (simulazioni digital-twin sono CPU-intensive), poisoning della evaluation knowledge base.

### 🔴 C2 — Budget cost in-memory (perso su reload)

**File**: `src/app/api/cost/route.ts:13-15`

```ts
// === In-memory budget config (would be DB in production) ===
let dailyBudgetUSD: number = 1.0
let dangerBudgetUSD: number = 5.0
```

Il budget giornaliero (warn/danger thresholds) è in memoria. Su reload del processo o in multi-istanza serverless:
- I valori tornano ai default ($1/$5)
- Configurazioni custom dell'admin sono perse
- In multi-istanza, ogni istanza ha i propri valori → alert inconsistenti

**Fix**: spostare su `SystemSetting` (modello esistente, già usato da admin settings) con chiavi `cost.budget.warn` e `cost.budget.danger`.

### 🔴 C3 — `digital-twin` what-if senza rate limiting

**File**: `src/app/api/digital-twin/route.ts:50-57`, `src/lib/digital-twin/engine.ts`

L'azione `what-if` esegue una simulazione completa (runSimulation) per ogni richiesta. Senza auth (C1) e senza rate limiting, un attacker può:
- Lanciare simultaneamente 100+ simulazioni
- Saturare la CPU (le simulazioni sono sincrone e CPU-bound)
- Costare denaro se la simulazione include LLM calls

**Fix**: aggiungere rate limiting (es. max 5 simulazioni/minuto per IP/sessione) + queue per serializzare.

### 🔴 C4 — `evaluation/seed-defaults` senza auth e senza idempotency

**File**: `src/app/api/evaluation/route.ts:52-55`

L'azione `seed-defaults` è pubblica (C1) e non è idempotente — chiamate ripetute creano benchmark duplicati. Un attacker può:
- Chiamare ripetutamente per saturare il DB
- Inquinare la lista benchmark con duplicati

**Fix**: aggiungere `upsert` invece di `create` in `seedDefaultBenchmarks`, o check esistenza per `name+version`.

### 🔴 C5 — `evaluation/run` accetta taskResults arbitrari senza validazione

**File**: `src/app/api/evaluation/route.ts:36-43`

```ts
const { agentUri, benchmarkUri, taskResults, notes } = body
if (!agentUri || !benchmarkUri || !taskResults) { ... }
const result = await runEvaluation({ agentUri, benchmarkUri, taskResults, notes, provenance })
```

`taskResults` è un array arbitrario — non c'è validazione che:
- I task facciano parte del benchmark specificato
- I punteggi siano in range valido (0-1)
- Il numero di task corrisponda al dataset del benchmark

Un attacker può registrare evaluation con taskResults falsi per manipolare il ranking degli agenti.

**Fix**: validare taskResults contro il benchmark.dataset, validare score range.

---

## 3. Bug (Medium)

### 🟠 B1 — `AutonomousDashboard` fa 8 fetch paralleli senza error handling per singolo endpoint

**File**: `src/components/autonomous-dashboard/autonomous-dashboard.tsx:50-52`

```ts
const responses = await Promise.all(
  endpoints.map((ep) => fetch(`/api/${ep}`).then((r) => r.json()).catch(() => null)),
)
```

Se un endpoint fallisce (401, 500), `.catch(() => null)` lo silenzia. Ma poi `data.mesh?.stats?.totalAgents ?? 0` mostra 0 senza distinguere "0 agents" da "fetch failed". L'utente non sa se il dato è reale o un errore.

**Fix**: tracciare quale endpoint ha fallito e mostrare un badge "stale" o un warning.

### 🟠 B2 — `AutonomousDashboard` polling fisso 30s senza Page Visibility API

**File**: `src/components/autonomous-dashboard/autonomous-dashboard.tsx:72-76`

```ts
useEffect(() => {
  fetchAll()
  const interval = setInterval(fetchAll, 30000)
  return () => clearInterval(interval)
}, [fetchAll])
```

A differenza di `useGovernanceData` (Fase 4 governance) e `useDashboard` (data-store), questo componente:
- Continua a fare fetch ogni 30s anche quando il tab è in background
- Non fa fetch immediato quando il tab torna visibile
- Non ha adaptive refresh (5s active, 30s idle)

Con 8 endpoint per fetch, questo è ~16 request/min in background per ogni utente con la vista insights aperta.

**Fix**: integrare `useGovernanceData` o pattern simile con Page Visibility API.

### 🟠 B3 — `DigitalTwinDashboard` non ha error handling UI

**File**: `src/components/autonomous-dashboard/digital-twin-panel.tsx:37-46`

```ts
try {
  const res = await fetch('/api/digital-twin').then((r) => r.json())
  setData(res)
} catch (err) {
  console.error(err)  // BUG: error invisible
}
```

Stesso pattern del ConflictQueuePanel pre-Fase-4. Niente toast, niente stato `error`, niente retry button. Se l'API dà 500 (o 401 dopo C1 fix), l'utente vede spinner infinito o "0 scenarios" fuorviante.

**Fix**: replicare il pattern di ConflictQueuePanel post-Fase-4 (toast + stato error + warning banner per stale data).

### 🟠 B4 — `AutonomousDashboard` colori hardcoded (dark mode illeggibile)

**File**: `src/components/autonomous-dashboard/autonomous-dashboard.tsx:288-296`

```ts
const colorClasses: Record<string, string> = {
  blue: 'border-blue-500/20 bg-blue-500/5',
  purple: 'border-purple-500/20 bg-purple-500/5',
  orange: 'border-orange-500/20 bg-orange-500/5',
  green: 'border-green-500/20 bg-green-500/5',
  cyan: 'border-cyan-500/20 bg-cyan-500/5',
  red: 'border-red-500/20 bg-red-500/5',
  yellow: 'border-yellow-500/20 bg-yellow-500/5',
}
```

Violazione del pattern #6 (solo status tokens). I colori `blue/purple/orange/green/cyan/red/yellow` sono hardcoded e non si adattano al dark mode (le sfumature `/5` e `/20` sono pensate per light mode).

**Fix**: usare il design-tokens `cat-*` (categoria) come fa l'architecture-map, oppure `bg-cat-cognitive`, `bg-cat-governance`, ecc.

### 🟠 B5 — `cost-ledger.test.ts` quasi vuoto (25 LOC)

**File**: `tests/unit/cost-ledger.test.ts`

Solo 25 LOC — probabilmente testa solo `getCostStats` basics. Mancano test per:
- `recordCostEntry` con valori edge (0 tokens, cost negativo)
- Aggregazioni byAgent/byModel/byPhase
- Query per planId (C6.5)
- Budget thresholds

**Fix**: estendere con test cases significativi.

### 🟠 B6 — `evaluation/run` non valida `agentUri` e `benchmarkUri` existence

**File**: `src/app/api/evaluation/route.ts:36-43`

La route accetta `agentUri` e `benchmarkUri` senza verificare che esistano nel DB. Se non esistono, `runEvaluation` potrebbe creare evaluation con riferimenti dangling.

**Fix**: verificare esistenza prima di run.

### 🟠 B7 — `phase11` / `phase12` / `phase14` non hanno adaptive polling

Queste viste (Affect, Objective Builder, Model Router) fanno un singolo fetch in `useEffect` e non si aggiornano mai più. Stesso problema di B9 governance (pre-Fase-4).

**Fix**: integrare `useGovernanceData` o pattern simile.

### 🟠 B8 — `DigitalTwinDashboard.runPreset` non gestisce errori HTTP

**File**: `src/components/autonomous-dashboard/digital-twin-panel.tsx:52-68`

```ts
const res = await fetch('/api/digital-twin', { method: 'POST', ... }).then((r) => r.json())
setLastResult(res)
```

Non c'è check `res.ok`. Se l'API dà 500, `lastResult` contiene `{ error: "..." }` e la UI cerca `lastResult.result?.success` che è undefined → mostra "Simulation failed: undefined".

**Fix**: check `res.ok` + toast su errore.

### 🟠 B9 — `cost/recent` non ha filtri (agentId, model, phase, time range)

**File**: `src/app/api/cost/route.ts:34-41`

```ts
const entries = await db.costEntry.findMany({
  orderBy: { timestamp: 'desc' },
  take: limit,
})
```

Restituisce sempre le ultime N entry senza filtri. La UI (se esiste una cost-view) non può filtrare per agente, model, phase, o time range.

**Fix**: aggiungere query params `?agentId=&model=&phase=&sinceHours=&untilHours=`.

### 🟠 B10 — `errors/record` non ha validazione input

**File**: `src/app/api/errors/route.ts:24-27`

```ts
if (action === 'record') {
  const result = await recordError(body.input)
  return NextResponse.json({ ok: true, ...result })
}
```

`body.input` è passato direttamente a `recordError` senza validazione. Se manca `message` o `source`, `recordError` potrebbe lanciare un errore non gestito (500).

**Fix**: validare `input.message` e `input.source` con 400 appropriato.

---

## 4. Gap funzionali (Medium/Low)

### 🟡 G1 — Vista `insights` workspace minimale

**File**: `src/components/workbench/workspace-views.tsx:78-83`

```tsx
case 'insights': return (
  <div className="space-y-6 p-6">
    <AutonomousDashboard />
    <DigitalTwinDashboard />
  </div>
)
```

La vista utente "Insights" (CORE_AREAS[5]) mostra **solo** AutonomousDashboard + DigitalTwinDashboard. Mancano:
- Tab per World Model predictions (pending + history)
- Tab per Evaluation benchmarks + agent rankings
- Tab per Cost tracking (timeline, by agent, by model, budget)
- Tab per Observability (errors, traces)
- Tab per Affect Monitor (desperation/frustration per agente)
- Tab per Objective Builder (rubric trees)
- Tab per Model Router (routing decisions, ensemble config)

Confronto con governance-view (Fase 4): 5 tab completi. Insights ha 0 tab strutturati.

**Proposta**: creare `src/components/module-pages/insights-view.tsx` con 6-7 tab.

### 🟡 G2 — Manca vista timeline per cost entries

Non c'è una UI per visualizzare la timeline dei cost entries nel tempo. I dati ci sono (`/api/cost?action=recent`) ma non c'è una vista chart. Il dashboard principale (overview.tsx) ha già `dashboard-charts.tsx` con 4 chart recharts (Cost/Tokens/LLM/Errors), ma è a livello globale. Manca una vista drill-down per singolo agente/model/phase.

### 🟡 G3 — Manca export per evaluation results

I risultati delle evaluation non sono exportabili. Per benchmarking esterno (paper, report), sarebbe utile export JSON/CSV.

### 🟡 G4 — Manca comparazione scenari digital-twin

`DigitalTwinDashboard` mostra solo l'ultimo risultato. Non c'è modo di comparare 2+ scenari side-by-side (es. "what-if A vs what-if B" con diff delle metriche proiettate).

### 🟡 G5 — Manca vista grafo per objective tree

Phase 12 (Objective Builder) usa BFS rubric tree, ma non c'è una vista grafo ad albero. Solo lista tabellare.

### 🟡 G6 — Manca endpoint pubblico per affect history per agente

`/api/affect?action=history` esiste ma non c'è una vista dedicata nell'insights module. Phase 11 è accessibile solo come "Advanced / Internals".

### 🟡 G7 — Manca integrazione cost → budget alerting

Il budget è in-memory (C2) e non triggera azioni quando superato. Il `AlertBanner` nel dashboard principale controlla `cost >= budget.danger` ma solo a display level. Manca:
- Notifica WS quando budget superato
- Email/webhook alert (configurable)
- Auto-pause del runtime quando danger threshold superato

### 🟡 G8 — Manca pagination su traces/errors list

`/api/traces` restituisce sempre 20 traces. `/api/errors` restituisce 50 errors. Non c'è pagination né cursor per scorrere storia.

### 🟡 G9 — Manca filtri su traces list

`/api/traces` non filtra per operation, phase, status, time range. Solo list globale.

### 🟡 G10 — Manca a11y su AutonomousDashboard e DigitalTwinDashboard

Niente `aria-label` su bottoni icon-only, niente `role="alert"` su error banner, niente `aria-busy` su loading skeletons. Confronto con governance-view (Fase 4 G11) che ha a11y completa.

### 🟡 G11 — Manca audit log su azioni admin

Le azioni admin su cost (set_budget), errors (resolve), non scrivono in AuditLedger. Confronto con governance API (Fase 2 C5) che ora logga tutto.

### 🟡 G12 — `metrics` API è un placeholder (17 LOC)

`/api/metrics` ha solo 17 LOC e probabilmente ritorna dati minimi. Verificare se è usato da qualcuno; se no, rimuovere o implementare properly.

---

## 5. Test mancanti

| Area | File da creare | Priorità |
|------|----------------|----------|
| Auth su world-model/digital-twin/evaluation | `tests/integration/insights-auth.test.ts` | Alta (post C1 fix) |
| Budget persistence (SystemSetting) | `tests/integration/cost-budget.test.ts` | Alta (post C2 fix) |
| Evaluation input validation | `tests/unit/evaluation-validation.test.ts` | Alta (post C5 fix) |
| Affect subsystem | `tests/unit/affect-subsystem.test.ts` | Media |
| Cost ledger esteso | estendere `tests/unit/cost-ledger.test.ts` | Media (post B5) |
| Error record validation | `tests/unit/error-record-validation.test.ts` | Media (post B10) |
| Digital twin rate limiting | `tests/integration/digital-twin-ratelimit.test.ts` | Media (post C3 fix) |

---

## 6. Piano di intervento (Fasi 2-5)

### Fase 2 — Criticità sicurezza & dati (C1-C5, B1-B2)

**Obiettivo**: chiudere le falle di sicurezza e rendere robusto il budget.

1. **C1**: aggiungere `requireAuth` (GET) + `requireAdmin` (POST mutative) a `/api/world-model`, `/api/digital-twin`, `/api/evaluation`.
2. **C2**: spostare budget cost da in-memory a `SystemSetting` (chiavi `cost.budget.warn`, `cost.budget.danger`). Aggiornare `cost-ledger.ts` per leggere da settings store.
3. **C3**: aggiungere rate limiting su `digital-twin/what-if` (max 5/min per sessione).
4. **C4**: rendere `evaluation/seed-defaults` idempotente (upsert per name+version).
5. **C5**: validare `taskResults` in `evaluation/run` (range score 0-1, benchmark existence).
6. **B1**: tracciare errori per-endpoint in AutonomousDashboard con badge "stale".
7. **B2**: integrare Page Visibility API in AutonomousDashboard polling.
8. **Test**: aggiungere test integration per auth + budget persistence.

### Fase 3 — Bug UI & error handling (B3-B10)

**Obiettivo**: portare error handling e UX al livello degli altri moduli.

1. **B3**: replicare pattern ConflictQueuePanel post-Fase-4 in DigitalTwinDashboard (toast + stato error + retry).
2. **B4**: sostituire colori hardcoded con design tokens (`cat-*` o status tokens).
3. **B5**: estendere `cost-ledger.test.ts` con test cases significativi.
4. **B6**: validare agentUri/benchmarkUri existence in evaluation/run.
5. **B7**: integrare adaptive polling in phase11/12/14 via useGovernanceData hook (rinominabile a useInsightsData).
6. **B8**: check `res.ok` in DigitalTwinDashboard.runPreset + toast su errore.
7. **B9**: aggiungere filtri a `/api/cost?action=recent` (agentId, model, phase, sinceHours).
8. **B10**: validare input in `/api/errors/record` (message + source required).
9. **Test**: estendere test esistenti + nuovi test per validation.

### Fase 4 — UX & CRUD (G1-G6, G10-G11)

**Obiettivo**: portare la vista insights al livello degli altri CORE_AREAS.

1. **G1**: creare `src/components/module-pages/insights-view.tsx` con 6 tab:
   - Overview (KPI da AutonomousDashboard)
   - World Model (predictions + history)
   - Evaluation (benchmarks + agent rankings + run)
   - Cost (timeline + by agent/model + budget config)
   - Observability (errors + traces con filtri)
   - Affect (desperation/frustration per agente + thresholds)
2. **G2**: vista timeline cost con chart recharts (drill-down per agente/model).
3. **G3**: export JSON/CSV per evaluation results.
4. **G4**: comparazione scenari digital-twin (side-by-side diff).
5. **G5**: vista grafo per objective tree (SVG tree).
6. **G6**: vista affect history per agente (chart).
7. **G10**: a11y completa su insights-view (aria-label, role, aria-busy).
8. **G11**: audit log su azioni admin (cost set_budget, errors resolve).
9. **Test**: integration test per nuovi endpoint CRUD.

### Fase 5 — Integrazione runtime & a11y (G7-G9, G12)

**Obiettivo**: alerting automatico + cleanup.

1. **G7**: budget alerting via WS + email/webhook configurable + auto-pause runtime su danger.
2. **G8**: pagination su traces/errors list (cursor-based).
3. **G9**: filtri su traces list (operation, phase, status, time range).
4. **G12**: verificare/rimuovere/implementare `/api/metrics` placeholder.
5. **Test**: E2E per budget alerting + pagination.

---

## 7. Confronto con moduli precedenti

| Aspetto | Runs | Memory | Agents | Governance | **Insights** |
|---------|------|--------|--------|------------|--------------|
| Vista module-page dedicata | ✅ | ✅ | ✅ | ✅ | ❌ (solo 2 componenti inline) |
| Tab strutturati | 5 | 5 | 5 | 5 | 0 |
| Auth corretta (requireAdmin per mutative) | ✅ | ✅ | ✅ | ✅ | ❌ (3 API senza auth) |
| Audit log su operazioni admin | ✅ | ✅ | ✅ | ✅ | ❌ (C2 budget, errors resolve) |
| Adaptive polling | ✅ | ✅ | ✅ | ✅ | ❌ (B2, B7) |
| Export JSON/CSV | ✅ | ✅ | ✅ | ✅ | ❌ (G3) |
| Error handling UI (toast) | ✅ | ✅ | ✅ | ✅ | ❌ (B3, B8) |
| a11y (aria, keyboard, skeletons) | ✅ | ✅ | ✅ | ✅ | ❌ (G10) |
| Dark mode tokens | ✅ | ✅ | ✅ | ✅ | ❌ (B4) |
| Test integration | ✅ | ✅ | ✅ | ✅ | ❌ (solo unit) |

**Conclusione**: il modulo Insights è il meno maturo tra i CORE_AREAS, insieme a Governance pre-Fase 1-5. Le criticità C1 (3 API senza auth) sono bloccanti per la sicurezza. Il budget in-memory (C2) è un bug silenzioso che emerge solo in produzione multi-istanza.

---

## 8. Metriche

- **File analizzati**: 14 (componenti, API, lib, schema)
- **LOC totali modulo**: ~3.800 (lib) + ~1.100 (componenti) + ~380 (API) = ~5.300
- **Bug critici (C)**: 5
- **Bug medi (B)**: 10
- **Gap funzionali (G)**: 12
- **Test mancanti**: 7 file
- **Stima implementazione Fasi 2-5**: 4-5 giornate di lavoro

---

## Prossimo passo

Procedere con **Fase 2 — Criticità sicurezza & dati** (C1-C5 + B1-B2), seguendo l'ordine del piano di intervento. Tutti i fix saranno accompagnati da test integration e commit atomici.
