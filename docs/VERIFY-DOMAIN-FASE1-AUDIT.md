# Fase 1 — Audit & Gap Analysis: Modulo Verify Domain

**Data**: 2026-07-02
**Modulo**: `domain-verify` (ADVANCED_PHASES[2])
**Scope**: Phase 4 (LTL · Taint · Normative) · Phase 7 (PTA · Dominators) · Phase 8 (Lean4 · LeanEvolve) · Phase 13 (Swarm Coherence / ESR + Quorum)

---

## 1. Mappatura del modulo

### 1.1 Componenti UI (4 file, ~1.645 LOC)

| File | LOC | Ruolo | Fix precedenti verificati |
|------|-----|-------|--------------------------|
| `verify-trust-domain.tsx` | 32 | Wrapper 4 tab: LTL (Phase4), Trace (Phase7), Lean (Phase8), Swarm (Phase13) | n/a |
| `phase4.tsx` | 456 | LTL Monitor + Taint Tracking + Normative Gate + Editor | ✅ C6, B8 (Governance) |
| `phase7.tsx` | 389 | PTA dominator + trace validator + capture/validate | ✅ B2, B6, G1 (Plan Domain) |
| `phase8.tsx` | 432 | Lean4 formal verifier + LeanEvolve | ✅ B4 (Plan Domain lib) |
| `phase13.tsx` | 368 | Swarm Coherence: ESR belief sync + quorum voting | ❌ NEW — nessun fix precedente |

### 1.2 API Routes (5 routes)

| Route | LOC | Auth | Note |
|-------|-----|------|------|
| `GET/POST /api/verify` | 297 | requireAuth (read) / requireAdmin (mutative) ✅ | Gold standard — C4, B3, B5, G2b, G3 tutti presenti |
| `GET/POST /api/dominator` | 92 | requireAuth ✅ | Plan Domain — OK |
| `GET/POST /api/lean` | 94 | requireAuth ⚠️ | POST mutative dovrebbe essere requireAdmin |
| `GET/POST /api/esr` | 110 | requireAuth ⚠️ | POST mutative dovrebbe essere requireAdmin |
| `GET/POST /api/conflict-resolution` | 76 | requireAuth (GET) / requireAdmin (POST) ✅ | C1 fix presente |

### 1.3 Lib files (4 file chiave, ~2.354 LOC)

| File | LOC | Fix precedenti verificati |
|------|-----|--------------------------|
| `ltl-monitor.ts` | 889 | ✅ B2, B3, B5, G3 (Governance) — maturo |
| `taint.ts` | 183 | ✅ B6, B7 (Governance) — maturo |
| `esr-quorum.ts` | 288 | ❌ NEW — 10 bug identificati |
| `lean4-agent.ts` | 397 | ✅ B4 (Plan Domain) — ma 6 JSON.parse senza try/catch |

### 1.4 Modelli Prisma (13 modelli)

`LTLRule` · `VerificationEvent` · `TaintRecord` · `NormativeRule` · `PrefixTreeAutomaton` · `TraceValidation` · `FormalContract` · `LeanEvolveEvent` · `VerifiedWorkflow` · `Belief` · `ESRSyncEvent` · `QuorumVote` · `QuorumDecision`

### 1.5 Test esistenti

9 file di test coprono Phase 4/7 e cross-cutting (Governance + Plan Domain). **Zero test per Phase 8 (lean4-agent) e Phase 13 (esr-quorum)**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `/api/esr` POST senza requireAdmin (stessa classe di Governance C1/C4)

**File**: `src/app/api/esr/route.ts:59-60`

Tutte le 4 POST actions (`record_belief`, `sync_belief`, `propose_quorum`, `vote_quorum`) usano `requireAuth` invece di `requireAdmin`. Qualsiasi utente autenticato (incluso viewer) può:
- Registrare belief malevoli nella base epistemica
- Forgiare quorum verdicts (votare N volte)
- Iniettare conflitti sync tra agenti

### 🔴 C2 — `/api/lean` POST mutative senza requireAdmin

**File**: `src/app/api/lean/route.ts:40-42`

`auto_contracts` fa `deleteMany` + recreate (destructive overwrite). `verify` e `evolve` sono mutative. Tutte usano `requireAuth` invece di `requireAdmin`.

### 🔴 C3 — `voteQuorum` permette voti duplicati

**File**: `src/lib/kernel/esr-quorum.ts:208-252`

Nessun check se `voterAgentId` ha già votato su `decisionId`. Stesso agente può votare N volte per forged quorum. Nessun unique constraint nel DB.

### 🔴 C4 — `voteQuorum` race condition (lost update)

**File**: `src/lib/kernel/esr-quorum.ts:228-249`

Read-then-write pattern: due voti concorrenti leggono `acceptCount=1`, entrambi calcolano `2`, entrambi scrivono `2` → count finale è `2` invece di `3`. Dovrebbe usare `{ increment: 1 }` dentro transazione.

### 🔴 C5 — `leanEvolve` non applica il rewrite

**File**: `src/lib/kernel/lean4-agent.ts:283-358`

`rewrittenInstruction` è salvato in `LeanEvolveEvent` ma **mai scritto back** in `AgentPlan.planJson`. La ri-validazione gira contro il piano originale → produce lo stesso risultato. La feature è effettivamente un no-op.

### 🔴 C6 — Zero audit trail per operazioni Phase 13

**File**: `src/lib/kernel/esr-quorum.ts`, `src/app/api/esr/route.ts`

`record_belief`, `sync_belief`, `propose_quorum`, `vote_quorum` non scrivono né `AgentLog` né `AuditLedgerEntry`. Forensics su "chi ha forgiato questo quorum verdict?" impossibile.

---

## 3. Bug (High/Medium)

### 🟠 B1 — Phase 13 zero error handling

**File**: `src/components/agentic/phase13.tsx`

Nessuna delle 4 action functions (`recordBelief`, `syncBelief`, `proposeQuorum`, `voteQuorum`) ha try/catch. `refresh()` non ha catch. Silent failures su tutti gli errori di rete/API.

### 🟠 B2 — Phase 8 visualizer passa dati sbagliati

**File**: `src/components/agentic/phase8.tsx:290-292`

`r.warnings` passato come `preconditions` e `r.errors` come `postconditions` al `LeanWorkflowVisualizer`. Semanticamente errato — warnings/errors sono stringhe di issue, non predicate di contract.

### 🟠 B3 — `lean4-agent.ts` 6 JSON.parse senza try/catch

**File**: `src/lib/kernel/lean4-agent.ts:81, 128, 167, 168, 169, 195`

Stesso pattern B2 del Plan Domain (mai applicato qui). `planJson` corrotto → crash con `SyntaxError` non gestito.

### 🟠 B4 — `getBeliefLineage` N+1 + no depth limit

**File**: `src/lib/kernel/esr-quorum.ts:80-92`

Walks lineage tree con `findUnique` per livello. Nessun depth limit — cyclic lineage → loop infinito.

### 🟠 B5 — `syncBelief` resetta version a 1

**File**: `src/lib/kernel/esr-quorum.ts:157`

Il belief replicato parte da version=1 anche se source è v5. Perde history.

### 🟠 B6 — Phase 4 + 8 hardcoded colors

- `phase4.tsx:31`: `bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300` (G12 partial)
- `phase8.tsx:314`: `bg-zinc-950 text-zinc-100` (Plan Domain B5 — mai applicato a phase8)

### 🟠 B7 — Phase 8 + 13 no adaptive polling

Phase 8 e Phase 13 usano single `useEffect(() => { refresh() }, [])`. UI va stale fino a manual refresh.

### 🟠 B8 — `attachContracts` N+1 writes

**File**: `src/lib/kernel/lean4-agent.ts:49-62`

Sequential `create` in for loop. Dovrebbe usare `createMany`.

### 🟠 B9 — Phase 13 `syncBelief` confusing UX

**File**: `src/components/agentic/phase13.tsx:88-93`

Primo click imposta belief ID e ritorna senza synccare. Utente deve cliccare due volte.

### 🟡 B10 — Phase 13 hardcoded voter IDs

**File**: `src/components/agentic/phase13.tsx:333-340`

`'verifier-1'` e `'verifier-2'` hardcoded. Non configurabili.

### 🟡 B11 — No input validation in `/api/esr`

`beliefType`, `requiredQuorum`, `vote` accettati senza validazione.

### 🟡 B12 — `QuorumVote` schema misuse

`workflowJoinId` riutilizzato per `decisionId`. Nessun FK proper.

---

## 4. Gap funzionali

### 🟡 G1 — Zero a11y in tutti i 4 componenti

Nessun `aria-label`, `role`, `tabIndex`, `onKeyDown`. Gap noto da Governance G11 + Plan Domain G2.

### 🟡 G2 — Zero unit test per esr-quorum.ts e lean4-agent.ts

### 🟡 G3 — Zero API integration test per /api/esr e /api/lean

### 🟡 G4 — Schema missing FKs e indexes

- `FormalContract.planId` → bare string, no FK
- `QuorumVote` → no `decisionId` field, no unique constraint
- `Belief.lineageId` → self-reference senza FK
- `TaintRecord.createdAt` → no index (TTL decay full scan)

### 🟡 G5 — `clearExpiredFlows` mai chiamato

B7 fix implementato ma nessuno scheduler lo invoca. TaintRecords accumulano.

### 🟡 G6 — Pseudo-Lean4 presentato come reale

UI non avvisa che l'output è pseudo-Lean4 demo, non verification reale.

---

## 5. Confronto con moduli precedenti

| Aspetto | Governance | Plan Domain | **Verify Domain** |
|---------|------------|-------------|-------------------|
| Auth (requireAdmin per mutative) | ✅ | ✅ | ❌ (esr + lean) |
| RCE vulnerability | ✅ fixato | ✅ fixato | ✅ (nessuna nuova) |
| LLM JSON parsing | ✅ fixato | ✅ fixato | ✅ (nessun LLM JSON in Phase 13) |
| Duplicate vote prevention | n/a | n/a | ❌ (C3) |
| Race condition | n/a | n/a | ❌ (C4) |
| Audit trail | ✅ | n/a | ❌ (C6) |
| Adaptive polling | ✅ | ✅ | ⚠️ (phase7 only) |
| a11y | ✅ | ❌ | ❌ |
| Unit test core | ✅ | ✅ | ❌ (esr + lean) |

**Nota positiva**: Phase 4 e Phase 7 sono mature (Governance + Plan Domain fix verificati). I problemi sono concentrati in **Phase 8 (lean4-agent)** e **Phase 13 (esr-quorum)** — entrambi NEW territory.

---

## 6. Piano di intervento (Fasi 2-4)

### Fase 2 — Sicurezza & data integrity (C1-C6, B3)

1. **C1**: `requireAdmin` su POST `/api/esr` (split read-only/mutative)
2. **C2**: `requireAdmin` su POST mutative `/api/lean`
3. **C3**: Duplicate vote prevention in `voteQuorum` + unique constraint schema
4. **C4**: Race condition fix con `{ increment: 1 }` dentro `$transaction`
5. **C5**: Fix `leanEvolve` per applicare `rewrittenInstruction` al planJson
6. **C6**: `AgentLog` writes su `/api/esr` mutative actions
7. **B3**: Wrap `lean4-agent.ts` JSON.parse in try/catch (6 occorrenze)
8. **Test**: integration test per C1/C2 (auth), C3 (duplicate vote), C4 (race)

### Fase 3 — Bug fix & validation (B1-B2, B4-B9, B11)

1. **B1**: try/catch + toast.error su tutte phase13 actions
2. **B2**: Fix phase8 visualizer dati (passare contracts reali, non warnings/errors)
3. **B4**: Depth limit (20) in `getBeliefLineage`
4. **B5**: Fix `syncBelief` version (source version + 1)
5. **B6**: Sostituire hardcoded colors in phase4 + phase8
6. **B7**: Adaptive polling in phase8 + phase13
7. **B8**: Batch `attachContracts` con `createMany`
8. **B9**: Fix `syncBelief` UX (auto-sync on first click)
9. **B11**: Input validation in `/api/esr`
10. **Test**: unit test per esr-quorum + lean4-agent

### Fase 4 — Schema & a11y (B10, B12, G1-G4)

1. **B10**: Configurable voter IDs in phase13
2. **B12**: Schema fix — `QuorumVote.decisionId` FK + unique constraint
3. **G1**: a11y completa su tutti i 4 componenti
4. **G4**: Schema indexes + FKs
5. **G6**: Pseudo-Lean4 warning banner
6. **Test**: API integration tests per /api/esr e /api/lean

---

## 7. Metriche

- **File analizzati**: 13 (4 componenti, 5 API, 4 lib)
- **LOC totali modulo**: ~4.011
- **Bug critici (C)**: 6
- **Bug medi (B)**: 12
- **Gap funzionali (G)**: 6
- **Test esistenti**: 9 file (Phase 4/7 + cross-cutting)
- **Moduli senza test**: 2 (esr-quorum, lean4-agent)
- **Stima implementazione Fasi 2-4**: 4-5 giornate

---

## Prossimo passo

Procedere con **Fase 2 — Sicurezza & data integrity** (C1-C6 + B3).
