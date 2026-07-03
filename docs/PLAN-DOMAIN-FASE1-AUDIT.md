# Fase 1 — Audit & Gap Analysis: Modulo Plan Domain

**Data**: 2026-07-02
**Modulo**: `domain-plan` (ADVANCED_PHASES[1])
**Scope**: Phase 2 (DynAMO · Compiled AI) · Phase 7 (PTA · Dominators / Trace Validator) · Phase 8 (Lean4Agent) · Phase 12 (Objective Builder) · Scheduler · Executor (plan execution)

---

## 1. Mappatura del modulo

### 1.1 Componenti UI (4 file, ~1.026 LOC)

| File | LOC | Ruolo |
|------|-----|-------|
| `src/components/domains/plan-execute/plan-execute-domain.tsx` | 29 | Wrapper 3 tab: Planner (Phase2), Steering (Phase3), Objective (Phase12) |
| `src/components/agentic/phase2.tsx` | 370 | DynAMO plan generation + Compiled AI 4-stage pipeline |
| `src/components/agentic/phase7.tsx` | 382 | PTA dominator tree + trace validator + capture/validate UI |
| `src/components/agentic/phase12.tsx` | 245 | Objective Builder: BFS rubric tree (Pass/Fail binario) |

### 1.2 API Routes (6 routes)

| Route | LOC | Auth | Note |
|-------|-----|------|------|
| `GET/POST /api/plan` | 87 | requireAuth ✓ | List plans + LLM generate / manual create |
| `GET/POST /api/compiled` | 71 | requireAuth ✓ | Artifacts + templates + 4-stage pipeline |
| `GET/POST /api/dominator` | 92 | requireAuth ✓ | Traces + PTA + validate |
| `GET/POST /api/objective` | 64 | requireAuth ✓ | Tree CRUD + node evaluation |
| `GET/POST /api/lean` | 94 | requireAuth ✓ | Contracts + verify + evolve |
| `GET/POST /api/evaluation` | 61 | ❌ **NO AUTH** | Benchmarks + run + seed-defaults |

### 1.3 Lib files (6 file, ~2.146 LOC)

| File | LOC | Responsabilità |
|------|-----|----------------|
| `src/lib/kernel/scheduler.ts` | 164 | validatePlan, topologicalBatches, persistPlan |
| `src/lib/kernel/compiled-ai.ts` | 162 | checkSafety, checkSyntax, checkExecution, checkAccuracy, runPipeline |
| `src/lib/kernel/dominator-tree.ts` | 415 | captureTrace, buildPTA, computeDominators, validateTrace |
| `src/lib/kernel/lean4-agent.ts` | 393 | attachContracts, autoGenerateContracts, verifyWorkflow, leanEvolve |
| `src/lib/kernel/agent-objective.ts` | 255 | createObjectiveTree, generateTreeStructure, evaluateNode |
| `src/lib/runtime/executor.ts` | 757 | generateAndPersistPlan, executeTask, executePlan, recovery |

### 1.4 Modelli Prisma (11 modelli)

`AgentPlan` · `PlanTask` · `CompiledArtifact` · `CompiledTemplate` · `ExecutionTrace` · `PrefixTreeAutomaton` · `TraceValidation` · `FormalContract` · `LeanEvolveEvent` · `VerifiedWorkflow` · `ObjectiveTree` · `ObjectiveNode`

### 1.5 Test esistenti

| File | LOC | Coverage |
|------|-----|----------|
| `tests/unit/runtime-executor.test.ts` | 234 | Executor state machine, idempotency, recovery |
| `tests/unit/evaluation.test.ts` | 397 | Evaluation runner (benchmarks, metrics) |
| `tests/e2e/crash-resume.test.ts` | 520 | Crash recovery del executor (7 verification points) |

**Zero test** per: scheduler, compiled-ai, dominator-tree, lean4-agent, agent-objective.

---

## 2. Criticità (Critical / High)

### 🔴 C1 — `compiled-ai.ts` RCE via `new Function()` (peggio del Memory Domain)

**File**: `src/lib/kernel/compiled-ai.ts:47-92`

```ts
export function checkExecution(code: string, fixture: unknown): ValidationResult {
  const fn = new Function('input', code)  // Esegue codice LLM nel processo principale
  const result = fn(fixture)
}
```

Stessa vulnerabilità del Memory Domain (C1), ma **peggio** perché:
1. **Designed-in execution**: compiled-ai.ts è progettato per eseguire codice LLM
2. **Safety check bypassable**: il blocklist `FORBIDDEN_TOKENS` usa `.includes()` — bypassabile con concatenazione stringhe, Function constructor escape, async escape
3. **No isolation**: codice gira nel processo Next.js principale con accesso a `process.env`, `require`, `fs`, `child_process`
4. **Any authenticated user** può inviare requirement → LLM genera codice → esecuzione con privilegi completi

**Bypass vectors**: `input.constructor.constructor('return process')()`, `globalThis['ev'+'al'](...)`, `setTimeout(() => require('fs')...)`, `Promise.resolve().then(async () => require('child_process')...)`

### 🔴 C2 — `/api/evaluation` senza auth (già identificato in Insights Fase 1)

**File**: `src/app/api/evaluation/route.ts`

GET e POST non hanno `requireAuth`. Utenti anonimi possono:
- Registrare benchmark malevoli
- Run evaluation con taskResults arbitrari (manipolazione ranking)
- Seed defaults (sovrascrive benchmark di sistema)

### 🔴 C3 — LLM JSON parsing fragile in 2 punti del Plan Domain

**File**: `src/app/api/plan/route.ts:60`, `src/lib/runtime/executor.ts:142`

```ts
const jsonMatch = raw.match(/\{[\s\S]*\}/)  // greedy, no markdown strip
if (!jsonMatch) throw new Error('LLM non ha prodotto JSON valido')
plan = JSON.parse(jsonMatch[0])  // no retry, no fallback
```

Stesso pattern fragile fixato in `/api/console/route.ts` (Fase console). Mancano:
- Strip markdown code blocks (` ```json ... ``` `)
- Retry su parse failure
- Fallback deterministico
- Gestione multi-JSON objects

---

## 3. Bug (Medium)

### 🟠 B1 — Phase12 zero error handling

**File**: `src/components/agentic/phase12.tsx`

Nessuna delle 3 azioni (`loadTree`, `createTree`, `evalNode`) ha try/catch. `toast.success` è mostrato su `d.ok` ma **nessun `toast.error`** su fallimento. Se LLM fallisce o DB va in timeout, l'utente non riceve feedback.

### 🟠 B2 — Phase7 `JSON.parse` in render senza try/catch

**File**: `src/components/agentic/phase7.tsx:356`

```tsx
const states = JSON.parse(t.statesJson)  // crash se JSON malformato
```

Se un trace record ha `statesJson` corrotto, l'intero tab crasha.

### 🟠 B3 — `semanticMatch` dead code in dominator-tree.ts

**File**: `src/lib/kernel/dominator-tree.ts:359`

`semanticMatch` è esportata ma **mai chiamata** da `validateTrace`. Feature incompleta o codice morto.

### 🟠 B4 — `lean4-agent.ts:197` loose `includes` check

```ts
if (!depPost.some((p) => p.includes(`task.${dep}.status`) && p.includes('completed')))
```

Una postcondition come `task.T1.status = 'not-completed'` passa il check (contiene entrambe le substring). Dovrebbe essere regex o strict equality.

### 🟠 B5 — Hardcoded colors in phase2.tsx

| Linea | Classe | Fix |
|-------|--------|-----|
| 159, 194 | `bg-gray-400` | `bg-muted-foreground/40` |
| 295 | `bg-zinc-950 text-zinc-100` | `bg-muted text-foreground` |

### 🟠 B6 — `stats.avgCoverage >= 0.7` senza null guard

**File**: `src/components/agentic/phase7.tsx:132`

`stats.avgCoverage` può essere `null`/`undefined`. La comparison throwa `TypeError`. La riga successiva usa `(stats.avgCoverage || 0).toFixed(2)` — guard inconsistente.

### 🟠 B7 — `persistPlan` N+1 writes

**File**: `src/lib/kernel/scheduler.ts:149-160`

Crea tasks uno per uno in un `for` loop. Dovrebbe usare nested `tasks: { create: [...] }` come fa `executor.ts:164-171`.

---

## 4. Gap funzionali (Medium/Low)

### 🟡 G1 — No adaptive polling in phase2/7/12

Tutti e 3 i componenti usano single `useEffect(() => { refresh() }, [])`. Se un piano è in `running` state via background job, l'UI non si aggiorna finché l'utente non clicca "Aggiorna".

### 🟡 G2 — a11y zero in tutti i 3 componenti

Nessun `aria-label`, `role`, `tabIndex`, `onKeyDown`. Confronto con `dashboard-widgets.tsx` (10+ aria-label, role="alert", aria-live="polite").

### 🟡 G3 — Zero unit test per 5 moduli core

Mancano test per: `scheduler.ts` (validatePlan, topologicalBatches), `compiled-ai.ts` (checkSafety, runPipeline), `dominator-tree.ts` (buildPTA, computeDominators), `lean4-agent.ts` (verifyWorkflow), `agent-objective.ts` (generateTreeStructure).

### 🟡 G4 — No API route integration tests

Zero test route-level per le 6 API del modulo Plan Domain.

### 🟡 G5 — `FormalContract`/`ObjectiveNode` missing FK relations

`planId` e `parentId` sono bare strings senza FK. Cascade-delete non funziona → risk di record orfani.

### 🟡 G6 — `recoverOrphanedPlans` serial execution

**File**: `src/lib/runtime/executor.ts:580-585`

Esegue `executePlan` in un `for` loop seriale. 100 piani orfani = boot time lineare.

### 🟡 G7 — `agent-objective.ts` BFS sequenziale blocca su LLM

`generateSubGoal` chiama LLM in modo sequenziale durante BFS. 243 nodi × 2-3s = ~10min worst case. Dovrebbe parallelizzare o streamare.

---

## 5. Piano di intervento (Fasi 2-4)

### Fase 2 — Sicurezza & robustezza (C1-C3, B1-B2)

1. **C1**: Sostituire `new Function()` in `compiled-ai.ts` con `node:vm.runInNewContext()` (stesso fix del Memory Domain)
2. **C2**: Aggiungere `requireAuth`/`requireAdmin` a `/api/evaluation` (già fixato in Insights Fase 2 — verificare se il fix è arrivato)
3. **C3**: Creare `src/lib/llm-client/parse-json.ts` helper condiviso + applicare a `/api/plan` e `executor.ts`
4. **B1**: Aggiungere try/catch + toast.error a phase12 (createTree, evalNode, loadTree)
5. **B2**: Wrap `JSON.parse(t.statesJson)` in try/catch in phase7 render
6. **Test**: integration test per C1 (sandbox isolation) + C3 (JSON parsing robustness)

### Fase 3 — Bug fix & consistency (B3-B7, G1)

1. **B3**: Rimuovere o wire-in `semanticMatch` in dominator-tree.ts
2. **B4**: Fix loose `includes` check in lean4-agent.ts → regex
3. **B5**: Sostituire hardcoded colors in phase2.tsx con design tokens
4. **B6**: Aggiungere null guard a `stats.avgCoverage`
5. **B7**: Batch `persistPlan` con nested create
6. **G1**: Integrare adaptive polling in phase2/7/12
7. **Test**: unit test per scheduler, compiled-ai, dominator-tree

### Fase 4 — UX & a11y (G2-G4)

1. **G2**: a11y completa (aria-label, role, keyboard nav)
2. **G3**: Unit test per lean4-agent, agent-objective
3. **G4**: API route integration tests

---

## 6. Confronto con moduli precedenti

| Aspetto | Governance | Insights | Memory Domain | **Plan Domain** |
|---------|------------|----------|---------------|-----------------|
| Auth su tutte le API | ✅ | ✅ | ✅ | ❌ (evaluation) |
| Error handling API | ✅ | ✅ | ✅ (Fase 2) | ⚠️ (4/6 routes) |
| RCE vulnerability | ✅ (fixato) | n/a | ✅ (fixato) | ❌ (compiled-ai) |
| LLM JSON parsing | ✅ (fixato) | n/a | n/a | ❌ (plan + executor) |
| Adaptive polling | ✅ | ✅ | ✅ (Fase 3) | ❌ |
| a11y | ✅ | ✅ | ❌ | ❌ |
| Unit test core | ✅ | ✅ | ✅ (Fase 3) | ❌ (5 moduli) |

---

## 7. Metriche

- **File analizzati**: 16 (4 componenti, 6 API, 6 lib)
- **LOC totali modulo**: ~3.641
- **Bug critici (C)**: 3
- **Bug medi (B)**: 7
- **Gap funzionali (G)**: 7
- **Test esistenti**: 3 file (executor, evaluation, crash-resume)
- **Stima implementazione Fasi 2-4**: 3-4 giornate

---

## Prossimo passo

Procedere con **Fase 2 — Sicurezza & robustezza** (C1-C3 + B1-B2).
