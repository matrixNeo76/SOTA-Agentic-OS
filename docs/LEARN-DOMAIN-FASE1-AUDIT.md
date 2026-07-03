# Fase 1 — Audit & Gap Analysis: Modulo Learn Domain

**Data**: 2026-07-02
**Modulo**: `domain-learn` (ADVANCED_PHASES[3])
**Scope**: Phase 5 (ERL · Red Lines) · Phase 11 (Affect Monitor) · Phase 14 (Model Router) · Phase 9 (Delegation · HITL · Audit)

---

## 1. Mappatura del modulo

### 1.1 Componenti UI (4 file, ~1.316 LOC)

| File | LOC | Ruolo | Fix precedenti verificati |
|------|-----|-------|--------------------------|
| `learn-route-domain.tsx` | 32 | Wrapper 4 tab: Reflect (Phase5), Affect (Phase11), Router (Phase14), Retainer (Phase9) | n/a |
| `phase5.tsx` | 330 | ERL reflection + RAG heuristics + Red Lines library | ✅ Governance C4 (POST requireAdmin) |
| `phase11.tsx` | 203 | Affect Monitor: desperation/frustration + intervention thresholds | ✅ Insights auth |
| `phase14.tsx` | 239 | Model Router: routing decisions + config + features extraction | ❌ NEW — nessun fix precedente |
| `phase9.tsx` | 546 | Delegation + HITL Gates + Normative + Audit Ledger | ✅ Governance C4 + B8 |

### 1.2 API Routes (5 routes)

| Route | LOC | Auth | Note |
|-------|-----|------|------|
| `GET/POST /api/reflect` | 82 | requireAuth (GET) / requireAdmin (POST) ✅ | Governance C4 fix presente |
| `GET/POST /api/affect` | 63 | requireAuth ⚠️ | POST `update_threshold` dovrebbe essere requireAdmin |
| `GET/POST /api/router` | 65 | requireAuth ⚠️ | POST `update_config` dovrebbe essere requireAdmin |
| `GET/POST /api/retainer` | 145 | requireAuth (GET) / requireAdmin (POST) ✅ | Governance C4 fix presente |
| `GET/POST /api/objective` | 64 | requireAuth ✅ | Plan Domain — OK |

### 1.3 Lib files (5 file, ~1.590 LOC)

| File | LOC | Fix precedenti verificati |
|------|-----|--------------------------|
| `erl.ts` | 269 | ✅ Governance (Red Lines, supervisorReview) |
| `affect-subsystem.ts` | 209 | ✅ Insights auth — ma cycleCounter module-level |
| `time-router.ts` | 292 | ❌ NEW — ensemble è cosmetic, error leak to DB |
| `artificial-retainer.ts` | 567 | ✅ Governance C8/C9/C10/C5 tutti presenti |
| `agent-objective.ts` | 256 | ✅ Plan Domain B1 — ma zero unit test |

### 1.4 Modelli Prisma (13 modelli)

`Heuristic` · `RedLine` · `ReflectionLog` · `AffectSample` · `AffectThreshold` · `RoutingDecision` · `RouterConfig` · `FoundationModel` · `DelegationContract` · `ApprovalGate` · `NormativeResolution` · `AuditLedgerEntry` · `ObjectiveTree` · `ObjectiveNode`

### 1.5 Test esistenti

| File | Coverage |
|------|----------|
| `tests/unit/erl.test.ts` (250 LOC) | DEFAULT_RED_LINES + extraction logic |
| Governance integration tests | C8/C9/C10 su artificial-retainer |
| **Zero test** per: `time-router.ts`, `affect-subsystem.ts`, `agent-objective.ts` |

---

## 2. Criticità (Critical / High)

### 🔴 N1 — `/api/router` POST `update_config` senza requireAdmin

**File**: `src/app/api/router/route.ts:39`

`update_config` muta la **globale** RouterConfig (margin, diversity, minConfidence, enableEnsemble, enableCritic) usando solo `requireAuth`. Qualsiasi utente autenticato può cambiare il comportamento di routing del sistema. Stessa classe di Governance C4.

### 🔴 N2 — `/api/affect` POST `update_threshold` senza requireAdmin

**File**: `src/app/api/affect/route.ts:30`

`update_threshold` muta AffectThreshold per qualsiasi agentId usando solo `requireAuth`. Qualsiasi utente può abbassare le soglie critiche per disabilitare gli interventi del Meta-Observer.

### 🔴 N3 — `time-router.ts` ensemble è puramente cosmetic

**File**: `src/lib/kernel/time-router.ts:174-188`

`route()` calcola `routedTo: 'primary' | 'ensemble' | 'critic'` ma **esegue sempre una singola** `zai.chat.completions.create()` indipendentemente dalla decisione. I modelli ensemble sono calcolati ma mai invocati. La feature "ensemble fallback" promessa dai commenti non è implementata.

### 🔴 N4 — LLM error message persistito nel DB

**File**: `src/lib/kernel/time-router.ts:186-188`

```ts
finalOutput = `LLM Error: ${e.message}. ${simulateModelOutput(features)}`
```

Error message (può includere stack/env hints) viene persistito in `RoutingDecision.finalOutput` ed esposto via `/api/router?action=decisions`. Nessun segnale di errore all'UI.

---

## 3. Bug (Medium)

### 🟠 N5 — `inputHash` dedup mai implementato

**File**: `src/lib/kernel/time-router.ts:153`

Il campo `inputHash` è calcolato (sha256 troncato 16 char) con commento "hash del prompt input per dedup" ma **nessun `findFirst` check** esiste. Stesso prompt → N righe duplicate. Schema manca `@unique`.

### 🟠 N6 — `cycleCounter` module-level (collisioni multi-istanza)

**File**: `src/lib/kernel/affect-subsystem.ts:28,55`

`let cycleCounter = 0` a livello modulo. In serverless/multi-istanza, ogni pod ha il proprio counter. La formula `Math.floor(Date.now()/1000)%100000 * 1000 + (cycleCounter%1000)` produce lo stesso cycleId per richieste concorrenti nello stesso secondo su pod diversi.

### 🟠 N7 — `client.ts` 3 funzioni LLM con JSON parsing fragile

**File**: `src/lib/llm-client/client.ts:258-268, 319-328, 382-391`

`extractHeuristicWithLLM`, `classifyTaskWithLLM`, `generatePredictionWithLLM` usano ancora `output.match(/\{[\s\S]*\}/)` + raw `JSON.parse`. L'helper `parseLlmJson` esiste (Plan Domain Fase 2) ma non è usato qui. ERL usa `extractHeuristicWithLLM` → fragile.

### 🟠 N8 — `phase14.tsx` JSON.parse senza try/catch in render

**File**: `src/components/agentic/phase14.tsx:168`

`JSON.parse(d.ensembleModels)` in render senza try/catch. Stesso pattern B8 fixato in phase9. Corrupted DB row → crash dell'intero history tab.

### 🟠 N9 — `grounded-inference.ts` RCE via `new Function()` (cross-domain)

**File**: `src/lib/kernel/grounded-inference.ts:139`

Stessa vulnerabilità C1 fixata in `compiled-ai.ts` (Plan Domain Fase 2) e `grounded-inference.ts` (Memory Domain Fase 2). Questo file è in Memory Domain scope ma il fix del Memory Domain Fase 2 sembra non essere arrivato (verificare).

### 🟠 N10 — Phase 5/9/11/14 senza adaptive polling

Tutti e 4 i componenti usano single `useEffect(() => { refresh() }, [])`. Memory Domain (phase1/6/10), Plan Domain (phase2/7/12), Verify Domain (phase8/13) hanno ricevuto B7 fix — Learn Domain phases sono state saltate.

---

## 4. Gap funzionali (Low)

### 🟡 N11 — a11y zero in tutti i 4 componenti

Nessun `aria-label` su bottoni icon-only (Trash2 in phase9), nessun `role`, nessun keyboard handler. Gap noto da tutti gli audit precedenti.

### 🟡 N12 — Error handling parziale in phase5/9/11/14

`if (d.ok) {…}` branch senza `else toast.error()`. `refresh()` senza try/catch. Inconsistente con phase9 `resolveGate` che ha proper error handling.

### 🟡 N13 — Zero unit test per 3 moduli core

`time-router.ts`, `affect-subsystem.ts`, `agent-objective.ts` non hanno unit test.

### 🟡 N14 — `eslint-disable` pattern

Tutti i 4 componenti usano `// eslint-disable-next-line react-hooks/set-state-in-effect` invece di ristrutturare.

### 🟡 N15 — `FoundationModel` DB table mai usata

Schema ha `FoundationModel` table ma `time-router.ts` usa `DEFAULT_MODELS` hardcoded. Aggiungere un modello richiede change al codice.

---

## 5. Verifica fix precedenti

| Audit | Fix | Status |
|-------|-----|--------|
| Governance C4 | `/api/reflect` POST → requireAdmin | ✅ Presente |
| Governance C4 | `/api/retainer` POST → requireAdmin | ✅ Presente |
| Governance C5 | `logAuditEntry` exported | ✅ Presente |
| Governance C8 | tie-break SAFETY-only | ✅ Presente |
| Governance C9 | `matchesScope` robusto | ✅ Presente (11 casi documentati) |
| Governance C10 | `expirePendingGates` lazy + throttle | ✅ Presente |
| Governance B8 | phase9 JSON.parse try/catch | ✅ Presente |
| Insights | `/api/affect` requireAuth | ✅ Presente (ma N2: update_threshold dovrebbe essere requireAdmin) |
| Plan Domain C3 | `parseLlmJson` helper | ✅ Esiste (ma N7: non usato da client.ts) |

---

## 6. Piano di intervento (Fasi 2-3)

### Fase 2 — Sicurezza & data integrity (N1-N4, N7-N9)

1. **N1**: `requireAdmin` su POST `/api/router` + `publishAgentEvent` + `AgentLog`
2. **N2**: `requireAdmin` su POST `/api/affect` `update_threshold` (mantenere `compute` come requireAuth)
3. **N3**: Documentare ensemble come future work O implementare `Promise.all` di chiamate LLM parallele
4. **N4**: Non persistere error message in `finalOutput` — usare `null` + flag di errore
5. **N7**: Refactoring `client.ts` per usare `parseLlmJson` helper esistente
6. **N8**: Wrap `JSON.parse(d.ensembleModels)` in try/catch in phase14 render
7. **N9**: Verificare/fixare `grounded-inference.ts` RCE (cross-domain Memory Domain)
8. **Test**: integration test per N1/N2 (auth) + N3 (ensemble) + N8 (JSON robustness)

### Fase 3 — Bug fix & UX (N5-N6, N10-N13)

1. **N5**: `@unique` su `inputHash` + `findFirst` check in `route()`
2. **N6**: Sostituire `cycleCounter` con DB-backed sequence
3. **N10**: Adaptive polling (30s + Page Visibility API) in phase5/9/11/14
4. **N12**: `else toast.error()` + try/catch su tutte le `refresh()` e action functions
5. **N13**: Unit test per `time-router.ts`, `affect-subsystem.ts`, `agent-objective.ts`
6. **Test**: unit test per 3 moduli core

---

## 7. Metriche

- **File analizzati**: 15 (4 componenti, 5 API, 5 lib, schema, test)
- **LOC totali modulo**: ~2.906 (lib) + ~1.316 (componenti) + ~416 (API) = ~4.638
- **Bug critici (N)**: 4 (N1-N4)
- **Bug medi (N)**: 5 (N5-N9)
- **Gap funzionali (N)**: 6 (N10-N15)
- **Moduli senza test**: 3 (time-router, affect-subsystem, agent-objective)
- **Stima implementazione Fasi 2-3**: 3-4 giornate

---

## Prossimo passo

Procedere con **Fase 2 — Sicurezza & data integrity** (N1-N4, N7-N9).
