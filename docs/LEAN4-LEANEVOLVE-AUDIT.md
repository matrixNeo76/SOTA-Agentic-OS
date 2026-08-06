# Lean4 LeanEvolve — Audit & Hardening

**Data**: 2026-07-26
**Modulo**: `Lean4 LeanEvolve` — Advanced/Internals (Phase 8)
**Scope**: `src/lib/kernel/lean4-agent.ts` · `src/app/api/lean/route.ts` · `src/components/agentic/phase8.tsx` · `prisma/schema.prisma` (FormalContract + LeanEvolveEvent + VerifiedWorkflow)

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/lean4-agent.ts` | 424 | Core: `attachContracts` + `autoGenerateContracts` + `verifyWorkflow` (symbolic verifier) + `leanEvolve` (LLM rewrite + revalidate) + `leanStats` + `listVerifiedWorkflows` + `listEvolveEvents` |
| `src/app/api/lean/route.ts` | 99 | API REST: GET workflows/evolve_events/stats + POST auto_contracts/verify/evolve |
| `src/components/agentic/phase8.tsx` | 464 | UI: plan selector + contract generation + verification + evolve + Lean4 source view + workflow graph |
| `prisma/schema.prisma` | 35 | Modelli `FormalContract` + `LeanEvolveEvent` + `VerifiedWorkflow` |

### Stato pre-audit

Il modulo è stato parzialmente auditato nel ciclo Verify Domain (`docs/VERIFY-DOMAIN-FASE1-AUDIT.md`) con fix già applicati:
- ✅ B3: JSON.parse con try/catch su planJson + preconditions/postconditions/variableTypes
- ✅ B4: Regex invece di includes per closure check
- ✅ B8: createMany per attachContracts (no N+1)
- ✅ C2: requireAdmin su POST mutative
- ✅ C5: planJson aggiornato prima di re-verify in leanEvolve

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `leanEvolve` fa `JSON.parse(plan?.planJson)` senza try/catch (linea 319)

**File**: `src/lib/kernel/lean4-agent.ts:319`

```ts
const planJson = JSON.parse(plan?.planJson || '{}')
```

A differenza di `autoGenerateContracts` (linea 84) e `verifyWorkflow` (linea 133) che hanno try/catch su questo stesso parse, `leanEvolve` non lo ha. Se `planJson` è corrotto, `leanEvolve` crasha con un errore non gestito → l'API ritorna 500 con stack trace.

### 🔴 C2 — `verifyWorkflow` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1 degli altri moduli: `verifyWorkflow` e `leanEvolve` sono esposti via API ma **non chiamati dal runtime**. L'executor esegue task senza verificare formalmente i contratti, e non chiama `leanEvolve` quando un task fallisce.

### 🔴 C3 — `verifyWorkflow` crea un nuovo `VerifiedWorkflow` ad ogni chiamata (no idempotency)

**File**: `src/lib/kernel/lean4-agent.ts:265-274`

```ts
const workflow = await db.verifiedWorkflow.create({
  data: { planId, contractsJson: ..., leanSource, verified, deployed: false, version: 1 },
})
```

Ogni chiamata a `verifyWorkflow` crea un nuovo record `VerifiedWorkflow` con `version: 1` hardcoded. Su retry o chiamate ripetute, il DB si riempie di snapshot duplicati. Inoltre, `version` non viene incrementato — dovrebbe essere `max(existing version) + 1`.

---

## 3. Bug (Medium)

### 🟠 B1 — `leanEvolve` non ha size cap su `rewrittenInstruction` e `failureReason`

**File**: `src/lib/kernel/lean4-agent.ts:322, 360-373`

```ts
const deterministicRewrite = `${originalDescription} [LeanEvolve v${cycle}: ...]`
// ...
await db.leanEvolveEvent.create({
  data: { ..., rewrittenInstruction, failureReason, leanFeedback, ... },
})
```

Se l'LLM genera un'istruzione molto lunga, o `failureReason` è enorme (es. stack trace), viene persistito senza limiti. Come B4/B7 degli altri moduli.

### 🟠 B2 — `leanStats` fa 6 query separate invece di usare `Promise.all` per tutte

**File**: `src/lib/kernel/lean4-agent.ts:390-398`

```ts
const [contracts, verifiedWorkflows, evolveEvents] = await Promise.all([...])
const verifiedContracts = await db.formalContract.count({ where: { verified: true } })
const deployedWorkflows = await db.verifiedWorkflow.count({ where: { deployed: true } })
const successfulEvolve = await db.leanEvolveEvent.count({ where: { revalidated: true } })
```

Le ultime 3 query sono sequenziali invece di essere in `Promise.all` con le prime 3. 6 round-trip DB invece di 1.

### 🟠 B3 — `phase8.tsx` `refresh()` e `evolve()` senza try/catch su fetch

**File**: `src/components/agentic/phase8.tsx:47-52`

```ts
const refresh = async () => {
  const [plansR, statsR, wfR, evR] = await Promise.all([
    fetch('/api/plan').then((r) => r.json()),
    fetch('/api/lean?action=stats').then((r) => r.json()),
    fetch('/api/lean?action=workflows').then((r) => r.json()),
    fetch('/api/lean?action=evolve_events').then((r) => r.json()),
  ])
```

Come B1/B6 degli altri moduli: `refresh()` non ha try/catch. `generateContracts` e `verify` hanno try/catch (preesistente), ma `refresh` e potenzialmente `evolve` no.

### 🟠 B4 — `verifyWorkflow` fa N+1 query su `formalContract.update` (linea 252-258)

**File**: `src/lib/kernel/lean4-agent.ts:252-258`

```ts
for (const t of tasks) {
  // ...
  await db.formalContract.update({
    where: { id: c.id },
    data: { verified, verificationLog: JSON.stringify({ errors, warnings }) },
  })
}
```

Aggiorna ogni contratto individualmente nel loop. Con 20 task = 20 query UPDATE sequenziali. Dovrebbe usare `Promise.all` o batch update.

### 🟠 B5 — `autoGenerateContracts` non valida `planId` (può essere vuoto)

**File**: `src/lib/kernel/lean4-agent.ts:75-80`

```ts
export async function autoGenerateContracts(planId: string) {
  const plan = await db.agentPlan.findUnique({ where: { id: planId } })
  if (!plan) throw new Error(`Piano ${planId} non trovato`)
```

Se `planId = ''`, `findUnique` ritorna null → throw con messaggio `Piano  non trovato`. Non c'è validazione esplicita prima della query.

---

## 4. Gap funzionali

### 🟡 G1 — Zero test per `lean4-agent.ts` (16 test in verify-domain-core ma non specifici per leanEvolve)

I 16 test esistenti in `verify-domain-core.test.ts` coprono `verifyWorkflow` e `autoGenerateContracts` ma non `leanEvolve`, `leanStats`, `listVerifiedWorkflows`, `listEvolveEvents`.

### 🟡 G2 — `phase8.tsx` nessun a11y (aria-label, role=status)

464 LOC senza `aria-*` o `role`.

### 🟡 G3 — `verifyWorkflow` non persiste `VerifiedWorkflow` con `version` incrementale

Come C3: `version: 1` hardcoded. Dovrebbe leggere `max(version)` esistente per quel `planId` e incrementare.

### 🟡 G4 — `leanEvolve` non ha cap sul numero di cicli (loop infinito potenziale)

**File**: `src/lib/kernel/lean4-agent.ts:309`

```ts
const cycle = (lastEvolve?.cycle || 0) + 1
```

Non c'è cap: se `leanEvolve` viene chiamato ripetitivamente (es. bug nel caller, o retry loop), `cycle` cresce indefinitamente. Dovrebbe esserci un `MAX_EVOLVE_CYCLES = 10` oltre il quale throw.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & robustezza (C1, C2, C3, B5)

1. **C1**: `leanEvolve` try/catch su `JSON.parse(plan?.planJson)`
2. **C2**: Integrare `verifyWorkflow` nell'executor (dopo autoGenerateContracts, prima del ReAct loop)
3. **C3**: `verifyWorkflow` usa `upsert` o calcola `version = max + 1` invece di `create` con `version: 1`
4. **B5**: Validazione `planId` non vuoto in `autoGenerateContracts` e `verifyWorkflow`

### Fase B — Robustezza (B1, B2, B3, B4, G4)

1. **B1**: Size cap su `rewrittenInstruction` (10KB) e `failureReason` (5KB)
2. **B2**: `leanStats` tutte le 6 query in `Promise.all`
3. **B3**: `phase8.tsx` try/catch su `refresh()`
4. **B4**: `verifyWorkflow` batch update con `Promise.all`
5. **G4**: `leanEvolve` cap cicli (MAX_EVOLVE_CYCLES = 10)

### Fase C — UX & completamento (G1, G2, G3)

1. **G1**: Unit test per `leanEvolve`, `leanStats`, `listVerifiedWorkflows`, `listEvolveEvents`
2. **G2**: a11y in `phase8.tsx`
3. **G3**: `verifyWorkflow` version incrementale (assorbito in C3)

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 4 (1 core + 1 API + 1 UI + 1 schema) |
| LOC totali | ~990 |
| Bug critici (C) | 3 |
| Bug medi (B) | 5 |
| Gap funzionali (G) | 4 |
| Test esistenti | 16 (verify-domain-core, non specifici leanEvolve) |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3+B5) — sicurezza & effettività. **Critica**.
2. **Fase B** (B1+B2+B3+B4+G4) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: leanEvolve crash su planJson corrotto (try/catch mancante)
- C2: verifyWorkflow non chiamato dall'executor (cosmetico)
- C3: VerifiedWorkflow duplicati (no version incrementale)

Tempo stimato: 1 giornata.
