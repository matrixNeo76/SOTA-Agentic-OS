# Delegation HITL Audit — Audit & Hardening

**Data**: 2026-07-26
**Modulo**: `Delegation HITL Audit` — Advanced/Internals (Phase 9 + Phase 17)
**Scope**: `src/lib/kernel/artificial-retainer.ts` · `src/lib/kernel/sovereign-translator.ts` · `src/app/api/retainer/route.ts` · `src/app/api/blocked-actions/route.ts` · `src/components/agentic/phase9.tsx` · `src/components/workbench/sovereign-view.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/artificial-retainer.ts` | 566 | Core: DelegationContract (grant/revoke/checkAuthority) + ApprovalGate (request/resolve/expire) + NormativeResolution (resolveNormativeConflict) + AuditLedger (logAuditEntry) + retainerStats |
| `src/lib/kernel/sovereign-translator.ts` | 166 | Sovereign: registerBlockedAction + resolveBlockedAction + generateExplanation + listPending/Recent + blockedStats + CockpitNarratives |
| `src/app/api/retainer/route.ts` | 144 | API REST: GET delegations/gates/audit/normative/stats/check_authority + POST grant/revoke/request_approval/resolve_approval/resolve_normative |
| `src/app/api/blocked-actions/route.ts` | 67 | API REST: GET pending/recent/stats + POST register/resolve |
| `src/components/agentic/phase9.tsx` | 553 | UI: delegation form + approval gates + audit ledger + normative + stats |
| `src/components/workbench/sovereign-view.tsx` | 550 | UI: blocked actions queue + source filter + resolution |

### Stato pre-audit

Il modulo è stato parzialmente auditato nel ciclo Trust & Governance (`docs/TRUST-GOVERNANCE-FASE1-AUDIT.md`) con fix già applicati:
- ✅ C4: requireAdmin su POST mutative (retainer + blocked-actions)
- ✅ C5: logAuditEntry esposta come pubblica
- ✅ C8: tie-break normative non blocca a parità non-SAFETY
- ✅ C9: matchesScope robusto (no startsWith bypass)
- ✅ C10: expirePendingGates lazy + throttle
- ✅ B3: grantDelegation logga grantedBy
- ✅ 118 test esistenti (governance-ux-crud + governance-auth-audit + governance-bugfix + governance-hooks)

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `checkAuthority` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1 degli altri moduli: `checkAuthority` è esposto via API ma **non chiamato dal runtime**. L'executor esegue task senza verificare se l'agente ha l'autorità (DelegationContract) per l'azione richiesta. Il sistema di deleghe è **cosmetico** — funziona solo se un admin manualmente chiama `/api/retainer?action=check_authority`.

### 🔴 C2 — `registerBlockedAction` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

`registerBlockedAction` (sovereign-translator.ts) dovrebbe essere chiamato quando un gate di sicurezza (LTL/Taint/Normative) blocca un'azione, per registrarla nella coda HITL. Ma l'executor non lo chiama — le azioni bloccate dai gate non appaiono nella coda HITL.

### 🔴 C3 — `resolveApproval` non ha size cap su `axiomTrail` e `reason`

**File**: `src/lib/kernel/artificial-retainer.ts:217-235, 240-275`

```ts
const gate = await db.approvalGate.create({
  data: { ..., payload: JSON.stringify(payload), reason, ... },
})
// ...
await db.approvalGate.update({
  data: { ..., axiomTrail: axiomTrail ? JSON.stringify(axiomTrail) : null, ... },
})
```

`payload`, `reason`, e `axiomTrail` sono persistiti senza size cap. Come B1/B7 degli altri moduli — DB bloat risk.

---

## 3. Bug (Medium)

### 🟠 B1 — `retainerStats` fa 3 query sequenziali dopo il Promise.all iniziale

**File**: `src/lib/kernel/artificial-retainer.ts:542-565`

```ts
const [activeDelegations, ...] = await Promise.all([...]) // 6 query
const approvedGates = await db.approvalGate.count(...)     // sequenziale
const rejectedGates = await db.approvalGate.count(...)     // sequenziale
const blockedResolutions = await db.normativeResolution.count(...) // sequenziale
```

Come B2 del modulo Lean4: 3 query sequenziali invece di essere nel Promise.all.

### 🟠 B2 — `phase9.tsx` `refresh()` senza try/catch su fetch

**File**: `src/components/agentic/phase9.tsx:70-77`

```ts
const refresh = async () => {
  const [...] = await Promise.all([
    fetch('/api/retainer?action=delegations').then((r) => r.json()),
    // ... 5 more fetch senza try/catch
  ])
```

Come B1/B3 degli altri moduli: unhandled rejection su network error.

### 🟠 B3 — `sovereign-translator.ts` `resolveBlockedAction` non valida `choice` enum

**File**: `src/lib/kernel/sovereign-translator.ts:47-52`

```ts
export async function resolveBlockedAction(
  blockedId: string,
  choice: ResolutionChoice,  // 'approved' | 'modified' | 'downgraded' | 'rejected'
  ...
```

Il type `ResolutionChoice` è un union, ma a runtime non c'è validazione. Se il caller passa `choice: 'unknown'`, viene persistito come status nel DB senza errori.

### 🟠 B4 — `grantDelegation` non valida `scope` non vuoto

**File**: `src/lib/kernel/artificial-retainer.ts:36-42`

```ts
export async function grantDelegation(agentId, scope, constraints, grantedBy, expiresAt) {
  const delegation = await db.delegationContract.create({
    data: { agentId, scope, ... },  // scope può essere ''
  })
```

Come B5 degli altri moduli: `scope=''` crea una delega vuota che non ha significato.

### 🟠 B5 — `blockedActions` API POST non ha try/catch su body parsing

**File**: `src/app/api/blocked-actions/route.ts:43-46`

```ts
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const body = await req.json()  // no try/catch → 500 su JSON invalido
```

Come B4 degli altri moduli: `req.json()` throwa su body non JSON.

---

## 4. Gap funzionali

### 🟡 G1 — Zero test specifici per `sovereign-translator.ts`

I 118 test esistenti coprono governance generale ma non `sovereign-translator.ts` in isolamento. Mancano test per: `registerBlockedAction`, `resolveBlockedAction`, `generateExplanation`, `blockedStats`, `recordNarrative`, `listNarratives`.

### 🟡 G2 — `phase9.tsx` nessun a11y (aria-label, role=status)

553 LOC senza `aria-*` o `role`.

### 🟡 G3 — `sovereign-view.tsx` nessun try/catch su fetch

**File**: `src/components/workbench/sovereign-view.tsx`

Il componente ha fetch per caricare blocked actions ma senza try/catch.

### 🟡 G4 — `checkAuthority` non valida expirazione in modo atomico

**File**: `src/lib/kernel/artificial-retainer.ts:127-140`

```ts
for (const d of delegations) {
  if (matchesScope(d.scope, scope)) {
    if (d.expiresAt && d.expiresAt < new Date()) {
      continue  // skip expired, ma non marca come expired nel DB
    }
    return { authorized: true, ... }
  }
}
```

Le deleghe scadute non vengono disattivate nel DB (come fa `expirePendingGates` per i gates). Rimangono `active: true` anche se scadute → query future le caricano inutilmente.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3, B4, B5)

1. **C1**: Integrare `checkAuthority` nell'executor (prima del ReAct loop, non bloccante)
2. **C2**: Integrare `registerBlockedAction` quando un gate blocca (LTL/Taint/Normative)
3. **C3**: Size cap su `payload` (50KB), `reason` (5KB), `axiomTrail` (10KB) in `requestApproval`/`resolveApproval`
4. **B4**: Validazione `scope` non vuoto in `grantDelegation`
5. **B5**: try/catch su body parsing in `blocked-actions/route.ts`

### Fase B — Robustezza (B1, B2, B3, G4)

1. **B1**: `retainerStats` tutte le 9 query in `Promise.all`
2. **B2**: `phase9.tsx` try/catch su `refresh()`
3. **B3**: `resolveBlockedAction` valida `choice` enum a runtime
4. **G4**: `checkAuthority` marca deleghe scadute come `active: false`

### Fase C — UX & completamento (G1, G2, G3)

1. **G1**: Unit test per `sovereign-translator.ts` (registerBlockedAction, resolveBlockedAction, generateExplanation, blockedStats)
2. **G2**: a11y in `phase9.tsx`
3. **G3**: `sovereign-view.tsx` try/catch su fetch

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 6 (2 core + 2 API + 2 UI) |
| LOC totali | ~2.050 |
| Bug critici (C) | 3 |
| Bug medi (B) | 5 |
| Gap funzionali (G) | 4 |
| Test esistenti | 118 (governance suite, non specifici sovereign-translator) |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3+B4+B5) — sicurezza & effettività. **Critica**.
2. **Fase B** (B1+B2+B3+G4) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: checkAuthority integrato nell'executor (deleghe non più cosmetiche)
- C2: registerBlockedAction integrato (azioni bloccate appaiono nella coda HITL)
- C3: Size cap su payload/reason/axiomTrail (no DB bloat)

Tempo stimato: 1 giornata.
