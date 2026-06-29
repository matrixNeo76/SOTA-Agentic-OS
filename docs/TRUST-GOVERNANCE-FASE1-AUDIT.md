# Fase 1 — Audit & Gap Analysis: Modulo Trust & Governance

**Data**: 2026-06-29
**Modulo**: `governance` (CORE_AREAS[4])
**Scope**: Phase 4 (LTL+Taint+Normative) · Phase 5 (ERL+Red Lines) · Phase 9 (Delegation+HITL+Audit) · Phase 17 (Sovereign) · Admin Governance Tab · Conflict Resolution · Governance lib

---

## 1. Mappatura del modulo

### 1.1 Componenti UI

| File | LOC | Ruolo |
|------|-----|-------|
| `src/components/agentic/phase4.tsx` | 446 | LTL Monitor + Taint Tracking + Normative Gate + LTL Editor host |
| `src/components/agentic/phase5.tsx` | 330 | ERL Reflection + RAG heuristics + Red Lines library |
| `src/components/agentic/phase9.tsx` | 539 | Delegation + Approval Gates + Normative + Audit Ledger |
| `src/components/agentic/ltl-normative-editor.tsx` | 447 | LTL editor visuale (FSM preview) + Axiom editor |
| `src/components/workbench/sovereign-view.tsx` | 550 | Batch resolve blocked actions + filtri + axiom trail |
| `src/components/autonomous-dashboard/conflict-queue-panel.tsx` | 229 | Coda conflitti knowledge-claims + 5 strategie |
| `src/components/blocked-action/*` | — | Modal/inspector legacy (sovrascritto da sovereign-view) |
| `src/app/admin/page.tsx` (GovernanceTab) | 320 | Admin: BlockedAction, ApprovalGate, RedLine, LTL |

### 1.2 API Routes

| Route | Auth | Audit | WS publish | Note |
|-------|------|-------|------------|------|
| `GET/POST /api/admin/governance` | requireAdmin | ❌ | ❌ | 5 azioni: resolve-blocked, resolve-approval, toggle-ltl, add-redline, (no delete/update) |
| `GET/POST /api/admin/audit` | requireAdmin | n/a | n/a | Audit trail API keys/tenants |
| `GET/POST /api/blocked-actions` | requireAuth | ❌ | ✅ | register/resolve/pending/recent/stats |
| `GET/POST /api/verify` | requireAuth | ✅ AgentLog | ✅ | verify_event, taint_input, check_sink, evaluate_intent, add/delete_ltl, add/delete_axiom, preview_fsm |
| `GET/POST /api/reflect` | requireAuth | ✅ AgentLog | ✅ | reflect, retrieve, redlines, feedback |
| `GET/POST /api/retainer` | requireAuth | ✅ AuditLedger | ✅ | grant/revoke delegation, request/resolve approval, resolve_normative |
| `GET/POST /api/conflict-resolution` | ❌ | n/a | n/a | **NO AUTH!** create-claim, resolve, auto-resolve |

### 1.3 Lib / Kernel

| File | LOC | Responsabilità |
|------|-----|----------------|
| `src/lib/kernel/ltl-monitor.ts` | 783 | Parser LTL recursive descent, FSM compiler, monitor singleton |
| `src/lib/kernel/taint.ts` | 110 | Taint input/propagate/checkSink, activeFlows in-memory |
| `src/lib/kernel/normative.ts` | 114 | evaluateIntent, axioms CRUD, DEFAULT_AXIOMS |
| `src/lib/kernel/artificial-retainer.ts` | 423 | Delegations, Approval Gates, NormativeResolution, AuditLedger |
| `src/lib/kernel/sovereign-translator.ts` | 166 | BlockedAction CRUD + CockpitNarrative |
| `src/lib/kernel/erl.ts` | 269 | Reflection + Red Lines + Heuristics RAG |
| `src/lib/conflict-resolution/engine.ts` | 594 | Knowledge claims + conflict detection + 5 strategies |
| `src/lib/governance/*` | 8 files | Entity registry, naming rules, provenance, event taxonomy, agent lifecycle, knowledge-claims |

### 1.4 Modelli Prisma

15 modelli governance-related in `schema.prisma` (allineati con `schema.postgres.prisma`, 69/69 sync OK):

`LTLRule` · `VerificationEvent` · `TaintRecord` · `NormativeRule` · `Heuristic` · `RedLine` · `ReflectionLog` · `DelegationContract` · `ApprovalGate` · `NormativeResolution` · `AuditLedgerEntry` · `BlockedAction` · `CockpitNarrative` · `ConflictNode` · `ClaimNode`

### 1.5 Test esistenti

- `tests/unit/ltl-monitor.test.ts` (211 LOC)
- `tests/unit/taint.test.ts` (159 LOC)
- `tests/unit/normative.test.ts` (153 LOC)
- `tests/unit/conflict-resolution.test.ts` (315 LOC)

**Assenti**: test per `artificial-retainer.ts` (delegations, gates, audit), `sovereign-translator.ts` (blocked actions), admin governance API.

---

## 2. Criticità (Critical / High)

### 🔴 C1 — `conflict-resolution` API senza auth

**File**: `src/app/api/conflict-resolution/route.ts:13,21`

L'endpoint GET e POST non hanno `requireAuth`/`requireAdmin`. Qualsiasi client anonimo può:
- Leggere tutti i conflitti knowledge-claims (anche sensibili)
- Creare claim malevoli (`create-claim`)
- Risolvere conflitti (`resolve`) bypassando la gerarchia normative
- Auto-resolvere in batch (`auto-resolve`)

**Impatto**: bypass totale della governance, data leak, poisoning della knowledge base.

### 🔴 C2 — data-store legge `.actions` ma API restituisce `.items`

**File**: `src/lib/stores/data-store.ts:199-200`

```ts
const pending = p ? ((await p.json()).actions || []) : []  // BUG: API ritorna { items: [...] }
const all = a ? ((await a.json()).actions || []) : []
```

L'API `/api/blocked-actions` restituisce `{ items: [...] }` (vedi `route.ts:20,25`). La data-store legge `.actions` (inesistente) → array vuoto.

**Effetto**: `blockedPending` e `blockedRecent` sono **sempre vuoti** nella `SovereignView`. L'intera vista governance del workspace mostra "no actions" anche quando ci sono centinaia di blocked actions pending.

### 🔴 C3 — data-store chiama `?action=all` che non esiste

**File**: `src/lib/stores/data-store.ts:190`

```ts
safeFetch('/api/blocked-actions?action=all', ...)  // BUG: API non riconosce 'all'
```

L'API riconosce solo `pending | recent | stats`. `action=all` ritorna HTTP 400 `{ error: 'Action non riconosciuta' }`. Anche se C2 fosse fixato, `blockedRecent` rimarrebbe vuoto.

**Fix**: cambiare `?action=all` → `?action=recent` (che è semanticamente ciò che si vuole: lista tutti i recenti).

### 🔴 C4 — Phase 4/5/9 usano `requireAuth` ma modificano regole governance

**File**: `src/app/api/verify/route.ts:46-47`, `src/app/api/reflect/route.ts:40-41`, `src/app/api/retainer/route.ts:67-68`, `src/app/api/blocked-actions/route.ts:37-38`

Qualsiasi utente autenticato (anche non admin) può:
- `POST /api/verify` `add_ltl`, `delete_ltl`, `add_axiom`, `delete_axiom` → modifica regole LTL e assiomi normativi
- `POST /api/retainer` `grant_delegation`, `revoke_delegation`, `request_approval`, `resolve_approval`, `resolve_normative` → concede/revoca deleghe e risolve gates
- `POST /api/blocked-actions` `register`, `resolve` → risolve blocked actions (HITL bypass)
- `POST /api/reflect` `reflect`, `feedback` → inietta euristiche

Queste sono operazioni amministrative che devono richiedere `requireAdmin`.

**Impatto**: qualsiasi utente può disabilitare tutte le Red Lines e LTL rules, sbloccare azioni bloccate, concedersi deleghe.

### 🔴 C5 — Admin Governance API non scrive in audit ledger né pubblica WS

**File**: `src/app/api/admin/governance/route.ts:84-93, 109-117, 128, 136-139`

Le operazioni `resolve-blocked`, `resolve-approval`, `toggle-ltl`, `add-redline` aggiornano il DB ma:
- ❌ Non creano `AuditLedgerEntry`
- ❌ Non creano `AgentLog`
- ❌ Non chiamano `publishAgentEvent`

Confronto con `/api/retainer` (8 chiamate) e `/api/verify` (9 chiamate) che lo fanno correttamente.

**Effetto**: le azioni dell'admin non sono tracciate. Impossibile fare forensics su "chi ha approvato X" o "chi ha disabilitato la regola LTL-002".

### 🔴 C6 — Bug visivo: `borderColor: 'status-danger'` non è un colore CSS

**File**: `src/components/agentic/phase4.tsx:390`, `src/components/agentic/ltl-normative-editor.tsx:409`

```tsx
<div style={{ borderColor: PRIORITY_LABEL[p]?.color.replace('bg-', '') }}>
// PRIORITY_LABEL[1].color = 'bg-status-danger'
// 'bg-status-danger'.replace('bg-', '') = 'status-danger'  → non è un colore valido!
```

`borderColor: 'status-danger'` viene ignorato dal browser. I bordi left-border degli assiomi normativi sono invisibili.

**Fix**: usare classi Tailwind dinamiche tramite `cn()` o una lookup table con colori hex/Tailwind validi.

### 🔴 C7 — `evaluateIntent` logica bloccante errata

**File**: `src/lib/kernel/normative.ts:79`

```ts
if (ax.priority <= intent.claimedPriority) {
  // La regola violata ha priorità >= dell'intenzione → BLOCK
```

Il commento dice "priorità >= dell'intenzione", ma il codice usa `<=`. Convenzione: priorità 1 = massima, 3 = minima.

Caso: regola violata priority=3 (efficienza), intent claimedPriority=3 → `3 <= 3` = true → BLOCK.

Ma la logica dovrebbe essere: blocca solo se la regola violata ha priorità **strettamente superiore** (valore numerico **minore**) dell'intenzione. Stessa priorità dovrebbe andare a `accept` o `warn`, non bloccare.

**Test case che fallisce**:
```
intent: "ottimizza token usage" (priority 3)
assioma violato: "ottimizza token quando possibile" (priority 3)
→ BLOCK (sbagliato, dovrebbe ACCEPT o WARN)
```

**Fix**: cambiare `<=` in `<`.

### 🔴 C8 — `resolveNormativeConflict` tie-break errato

**File**: `src/lib/kernel/artificial-retainer.ts:291-298`

```ts
} else if (NORMATIVE_HIERARCHY[systemLevel] === NORMATIVE_HIERARCHY[userLevel]) {
  verdict = 'block'  // tie-break a favore della safety
```

Se `systemLevel === userLevel === AESTHETIC`, perché bloccare? "Tie-break a favore della safety" ha senso solo se uno dei due è SAFETY. Il commento è fuorviante.

**Test case che fallisce**:
```
userInstruction: "usa colore blu" (AESTHETIC)
systemPolicy: "usa colore rosso" (AESTHETIC)
→ BLOCK (sbagliato, dovrebbe MODIFY o ACCEPT con preferenza utente)
```

**Fix**: tie-break a favore del system (più conservativo) solo se `systemLevel === SAFETY`. Altrimenti `MODIFY`.

### 🔴 C9 — `checkAuthority` match pattern weak

**File**: `src/lib/kernel/artificial-retainer.ts:114`

```ts
if (d.scope === scope || d.scope === '*' || scope.startsWith(d.scope)) {
```

`scope.startsWith(d.scope)` permette bypass: delegation `tool:exec` autorizza `tool:executor`, `tool:exec_malicious`, ecc.

**Esempio exploit**: agente ha delega per `tool:exec` (sandbox). Richiede `tool:exec_privileged` → autorizzato perché `tool:exec_privileged`.startsWith(`tool:exec`).

**Fix**: richiedere match esatto o pattern con wildcard esplicita (`tool:exec*` o `tool:exec/*`).

### 🔴 C10 — Auto-expire gates non implementato

**File**: `src/lib/kernel/artificial-retainer.ts:151-169`

`requestApproval` imposta `expiresAt` (default 24h) ma nessuna logica controlla periodicamente se i gates sono scaduti. `listPendingGates` ritorna gates con `status: 'pending'` anche se `expiresAt` è passato da mesi.

La `VALID_CHOICES` in admin governance API include `'expired'` ma non c'è endpoint o job che lo invochi.

**Effetto**: gates pending rimangono per sempre, l'admin deve risolverli manualmente.

---

## 3. Bug (Medium)

### 🟠 B1 — Admin governance UI usa `gate.requestedAt` ma API restituisce `createdAt`

**File**: `src/app/admin/page.tsx:1263`, `src/app/api/admin/governance/route.ts:42-43`

```tsx
// UI
Requested: {gate.requestedAt ? new Date(gate.requestedAt).toLocaleString() : '—'}
// API response
createdAt: g.createdAt.toISOString(),  // requestedAt non esiste
```

**Effetto**: il campo "Requested" mostra sempre "—".

### 🟠 B2 — `validateLTLFormula` check insensato

**File**: `src/lib/kernel/ltl-monitor.ts:716-718`

```ts
const pattern = (LTLMonitor.getInstance() as any).detectPattern
  ? 'unknown'
  : detectPatternExternal(ast)
```

Controlla se esiste un metodo `detectPattern` su `LTLMonitor` (che non esiste). Se esistesse, ritornerebbe `'unknown'` invece del pattern reale. Codice morto + bug logico.

**Fix**: rimuovere il check e usare direttamente `detectPatternExternal(ast)`.

### 🟠 B3 — `addLTLRule` non gestisce `ruleId` duplicato

**File**: `src/lib/kernel/ltl-monitor.ts:683-690`

`LTLRule.ruleId` è `@unique`. Se si tenta di aggiungere una regola con `ruleId` esistente, Prisma lancia `P2002` e la route ritorna 500 senza context.

**Fix**: catch `Prisma.PrismaClientKnownRequestError` con `code === 'P2002'` e ritornare 409 Conflict.

### 🟠 B4 — `add-redline` non gestisce `description @unique`

**File**: `src/app/api/admin/governance/route.ts:132-140`, `prisma/schema.prisma:237` (`description String @unique`)

Stesso problema di B3: due Red Line con stessa descrizione → 500 generico.

### 🟠 B5 — `deleteAxiom` / `deleteLTLRule` usano `updateMany` con `where: { id }`

**File**: `src/lib/kernel/normative.ts:104-108`, `src/lib/kernel/ltl-monitor.ts:694-699`

```ts
await db.normativeRule.updateMany({ where: { id }, data: { active: false } })
```

`id` è `@id` (univoco). `updateMany` è eccessivo e hide bugs (nessun errore se l'id non esiste).

**Fix**: usare `update` (lancia `P2025` se non trovato) o ritornare 404 esplicito.

### 🟠 B6 — `taintInput`/`checkSink` usano Map in-memory (perdono stato su reload)

**File**: `src/lib/kernel/taint.ts:25, 47`

```ts
const activeFlows: Map<string, TaintFlow> = new Map()
```

In produzione (Next.js serverless o multi-istanza), ogni istanza ha la sua Map. I taintIds creati su istanza A non sono riconosciuti su istanza B. Inoltre, su reload del processo, tutti i flussi attivi sono persi (ma i TaintRecord rimangono nel DB).

**Effetto**: `checkSink` può non bloccare sink che consumano taint registrati in un'altra istanza.

**Fix**: spostare `flowTrace` completamente nel DB (già parzialmente fatto in `TaintRecord.flowTrace`). Sostituire `activeFlows` con query DB.

### 🟠 B7 — `clearExpiredFlows` è vuoto

**File**: `src/lib/kernel/taint.ts:100-103`

```ts
export function clearExpiredFlows(): void {
  // In una implementazione reale, scadenza basata su TTL.
  // Qui manteniamo tutti i flussi attivi per la sessione.
}
```

Commento ammette che non è implementato. Memory leak: `activeFlows` cresce indefinitamente.

### 🟠 B8 — `JSON.parse` unsafe in phase9

**File**: `src/components/agentic/phase9.tsx:485`

```tsx
const decision = JSON.parse(a.decision)
```

Se `a.decision` è malformato (o null), crasha il componente. Stesso pattern in `phase4.tsx:304` per `flowTrace`.

**Fix**: wrap in try/catch con fallback `{}` o `[]`.

### 🟠 B9 — `phase4` / `phase5` / `phase9` non hanno adaptive polling

A differenza di `overview.tsx` (che usa `useDashboard` con adaptive refresh 5s/30s + Page Visibility), le phase legacy fanno un singolo fetch in `useEffect(() => refresh(), [])` e non si aggiornano mai più.

L'admin GovernanceTab usa `useAdminData` che fa un singolo fetch. Per vedere nuove blocked actions o gates, l'admin deve cliccare "Refresh".

**Fix**: integrare adaptive polling o esporre un `useGovernanceData` hook che usa il data-store unificato.

### 🟠 B10 — `addAxiom` non valida duplicati né priorità

**File**: `src/lib/kernel/normative.ts:100-102`

- Non controlla se l'assioma esiste già (testo identico)
- Non valida `priority` ∈ {1, 2, 3}

**Fix**: validazione + `findFirst` per dedup.

### 🟠 B11 — Admin `StatBox` usa colori hardcoded

**File**: `src/app/admin/page.tsx:117`

```tsx
const colorClass = tone === 'ok' ? 'text-green-600' : tone === 'warn' ? 'text-yellow-600' : tone === 'danger' ? 'text-red-600' : ''
```

Violazione del pattern #6 (solo status tokens). In dark mode `text-green-600` è illeggibile.

**Fix**: `tone === 'ok' ? 'text-status-ok' : 'text-status-warn' : 'text-status-danger'`.

### 🟠 B12 — ConflictQueuePanel non ha error handling

**File**: `src/components/autonomous-dashboard/conflict-queue-panel.tsx:47-56, 62-81`

```ts
try {
  const res = await fetch('/api/conflict-resolution').then((r) => r.json())
  setData(res)
} catch (err) {
  console.error(err)  // BUG: error invisible all'utente
}
```

Niente toast, niente stato `error`. Se l'API dà 500 (o 401 dopo C1 fix), l'utente vede spinner infinito o "0 pending" fuorviante.

---

## 4. Gap funzionali (Medium/Low)

### 🟡 G1 — Vista `governance` del workspace minimale

**File**: `src/components/workbench/workspace-views.tsx:76-81`

```tsx
case 'governance': return (
  <div className="space-y-6 p-6">
    <ConflictQueuePanel />
    <SovereignView />
  </div>
)
```

La vista utente "Trust & Governance" (CORE_AREAS[4]) mostra **solo** conflict queue + sovereign. Mancano:
- Phase 4: LTL/Taint/Normative (editor + tester)
- Phase 5: Red Lines library + ERL reflection
- Phase 9: Delegations + HITL Gates + Audit Ledger
- Stat cards aggregate (total blocked, pending gates, active delegations, LTL rules count)

Confronto con `agents-org-view.tsx` (5 tab completi, 5 fasi) e `runs-view.tsx` (5 fasi). Il modulo governance è il meno completo tra i CORE_AREAS.

**Proposta**: creare `src/components/module-pages/governance-view.tsx` con 5 tab: Overview (KPI) · Sovereign (blocked) · LTL & Taint · Red Lines & Reflection · Delegations & Audit.

### 🟡 G2 — Manca CRUD completa per Red Lines

L'admin può solo `add-redline`. Non può:
- Modificare `description` / `rationale` / `severity`
- Disattivare (toggle `active`)
- Eliminare

Stesso gap per NormativeRule: si può `add_axiom` / `delete_axiom` (soft delete) ma non modificare priorità o testo.

### 🟡 G3 — Manca endpoint per "test LTL rule" prima del salvataggio

L'editor LTL ha `preview_fsm` (validazione sintattica) ma non "simula questa regola su una sequenza di eventi di test". Utile per validare semanticamente prima del deploy.

### 🟡 G4 — Audit Ledger non ha filtri/pagination/export

**File**: `src/components/agentic/phase9.tsx:466-522`, `src/lib/kernel/artificial-retainer.ts:388-394`

`listAuditLedger(limit=50, agentId?)` ritorna gli ultimi 50 entries. La UI mostra tutti in una ScrollArea. Non ci sono:
- Filtri per date range
- Filtri per `gate` (delegation/hitl/normative)
- Filtri per `outcome` (granted/revoked/approved/rejected/block)
- Export JSON/CSV (pattern già usato in runs-view e memory-view)
- Pagination

### 🟡 G5 — Audit Ledger API non esposta come endpoint pubblico

L'`AuditLedgerEntry` è accessibile solo via `/api/retainer?action=audit`. Per integrazioni esterne (SIEM, compliance tool) sarebbe utile un endpoint `/api/admin/audit/ledger` con filtri e pagination (simile a `/api/admin/audit` per API keys).

### 🟡 G6 — Taint Tracking non integrato nel runtime

`taintInput` / `checkSink` sono chiamabili solo manualmente via API tester (Phase 4 UI). Il runtime (`src/lib/runtime/executor.ts`) non chiama automaticamente `taintInput` quando riceve input da `user_chat` / `api_response`, né `checkSink` prima di eseguire tool call sensibili.

**Effetto**: il taint tracking è "demo-only", non protegge realmente l'esecuzione.

### 🟡 G7 — LTL Monitor non integrato nel runtime

Come G6: `verifyEvent` è chiamabile solo manualmente. Il runtime non pubblica eventi su state changes (plan, check, execute, error, reflect, halt, success) al monitor LTL. Le FSM non vengono mai valutate in produzione.

### 🟡 G8 — Red Lines non valutate automaticamente da ERL

`reflectAndLearn` (in `erl.ts`) valuta le Red Lines quando si riflette su un'operazione. Ma non c'è un hook che valuta le Red Lines **prima** di eseguire qualsiasi azione sensibile (tool call, deploy, delete).

### 🟡 G9 — No "approval gate expiration" job

Manca uno scheduled job (o un middleware su ogni richiesta) che marque `expired` i gates con `expiresAt < now()`. Vedi C10.

### 🟡 G10 — `ConflictingClaims` non ha UI per visualizzare il conflict graph

La `phase4` mostra LTL/Taint/Normative, ma la conflict resolution (`knowledge-claims`) non ha una vista grafo (Claim → Evidence → Source → Conflict). Solo una lista tabellare.

### 🟡 G11 — No keyboard shortcuts / a11y

Le viste `phase4`, `phase5`, `phase9`, `ltl-normative-editor` non hanno:
- `aria-label` sui bottoni icon-only (Trash2, Refresh)
- `role="button"` / `tabIndex` sugli elementi cliccabili
- Keyboard navigation (Enter per submit, Esc per cancel)
- Loading skeletons (usano spinner centrato)

Confronto con `agents-org-view.tsx` (Fase 5) che ha tutti questi.

### 🟡 G12 — No dark mode testing

Le classi Tailwind nelle phase legacy usano pattern misti:
- `bg-status-warn` (token) ✓
- `bg-zinc-100 dark:bg-zinc-800` (hardcoded) ✗ — vedi `SEVERITY_STYLE.log` in `phase4.tsx:31`

In dark mode, `bg-zinc-100` è quasi bianco → illeggibile.

---

## 5. Test mancanti

| Area | File da creare | Priorità |
|------|----------------|----------|
| `artificial-retainer.ts` | `tests/unit/artificial-retainer.test.ts` | Alta |
| `sovereign-translator.ts` | `tests/unit/sovereign-translator.test.ts` | Alta |
| Admin governance API | `tests/integration/admin-governance.route.test.ts` | Alta |
| Auth su conflict-resolution | `tests/integration/conflict-resolution.auth.test.ts` | Alta (post C1 fix) |
| Auth su verify/reflect/retainer/blocked-actions (requireAdmin) | `tests/integration/governance-admin-auth.test.ts` | Alta (post C4 fix) |
| Auto-expire gates | `tests/unit/approval-gate-expire.test.ts` | Media (post C10 fix) |
| `checkAuthority` pattern matching | `tests/unit/check-authority.test.ts` | Alta (post C9 fix) |
| `evaluateIntent` boundary cases | estendere `tests/unit/normative.test.ts` | Alta (post C7 fix) |
| `resolveNormativeConflict` tie-break | `tests/unit/normative-tiebreak.test.ts` | Alta (post C8 fix) |
| Data-store blocked actions field mapping | `tests/unit/data-store-blocked.test.ts` | Alta (post C2/C3 fix) |

---

## 6. Piano di intervento (Fasi 2-5)

### Fase 2 — Criticità sicurezza & dati (C1-C5, B1-B2)

**Obiettivo**: chiudere le falle di sicurezza e rendere funzionante la vista Sovereign.

1. **C1**: aggiungere `requireAuth` (lettura) e `requireAdmin` (scrittura) a `/api/conflict-resolution`.
2. **C4**: cambiare `requireAuth` → `requireAdmin` per azioni mutative in `/api/verify`, `/api/reflect`, `/api/retainer`, `/api/blocked-actions`. Mantenere `requireAuth` per GET (lettura).
3. **C2 + C3**: fix `data-store.ts` — leggere `.items`, usare `?action=recent` invece di `?action=all`.
4. **C5**: aggiungere `AuditLedgerEntry` + `publishAgentEvent` in `/api/admin/governance` per tutte le POST.
5. **B1**: allineare `gate.requestedAt` → `gate.createdAt` (UI o API).
6. **B2**: rimuovere codice morto in `validateLTLFormula`.
7. **Test**: aggiungere test integration per auth e audit logging.

### Fase 3 — Bug logici & UI (C6-C10, B3-B8)

**Obiettivo**: correggere la logica normative e i bug visivi.

1. **C6**: fix `borderColor` con classi Tailwind valide.
2. **C7**: fix `evaluateIntent` `<=` → `<`.
3. **C8**: fix tie-break solo se `systemLevel === SAFETY`.
4. **C9**: fix `checkAuthority` pattern matching (match esatto o wildcard esplicita).
5. **C10**: implementare auto-expire (job su ogni GET `/api/retainer?action=gates_pending` o middleware).
6. **B3 + B4**: gestire `P2002` (unique constraint) con 409 Conflict.
7. **B5**: sostituire `updateMany` con `update` + 404 su not found.
8. **B6 + B7**: spostare `activeFlows` su DB; implementare TTL decay.
9. **B8**: wrap `JSON.parse` in try/catch.
10. **Test**: estendere `normative.test.ts`, `taint.test.ts`, nuovo `check-authority.test.ts`.

### Fase 4 — UX & CRUD (G1-G5, B9-B12)

**Obiettivo**: portare la vista governance al livello delle altre CORE_AREAS.

1. **G1**: creare `src/components/module-pages/governance-view.tsx` con 5 tab: Overview · Sovereign · LTL & Taint · Red Lines & Reflection · Delegations & Audit.
2. **G2**: aggiungere `update-redline`, `toggle-redline`, `delete-redline`, `update-axiom`, `toggle-axiom` alla admin governance API + UI.
3. **G3**: aggiungere `simulate_ltl` action a `/api/verify` (test su sequenza eventi).
4. **G4**: filtri + pagination + export JSON/CSV per Audit Ledger.
5. **G5**: nuovo endpoint `/api/admin/audit/ledger` con filtri.
6. **B9**: integrare adaptive polling via data-store o nuovo `useGovernanceData` hook.
7. **B11**: sostituire `text-green-600` ecc. con `text-status-*`.
8. **B12**: error handling in `ConflictQueuePanel` con toast + stato `error`.
9. **Test**: integration test per nuovi endpoint CRUD.

### Fase 5 — Integrazione runtime & a11y (G6-G12)

**Obiettivo**: rendere la governance effettivamente enforced + accessibilità.

1. **G6**: integrare `taintInput` nel runtime quando si riceve input esterno; `checkSink` prima di ogni tool call sensibile.
2. **G7**: pubblicare eventi state-change al LTL monitor dal runtime (plan/check/execute/error/reflect/halt/success).
3. **G8**: valutare Red Lines prima di azioni sensibili (hook nel `executor.ts`).
4. **G9**: scheduled job o middleware per auto-expire gates (fortifica C10).
5. **G10**: vista grafo per conflict resolution (Claim → Evidence → Conflict).
6. **G11**: a11y completa (aria-label, role, tabIndex, keyboard nav, skeletons) su tutte le viste governance.
7. **G12**: audit dark mode — sostituire `bg-zinc-100 dark:bg-zinc-800` con token.
8. **Test**: E2E test che verifica taint + LTL + red lines effettivamente bloccano azioni nel runtime.

---

## 7. Confronto con moduli precedenti

| Aspetto | Runs | Memory | Agents | **Governance** |
|---------|------|--------|--------|-----------------|
| Vista module-page dedicata | ✅ | ✅ | ✅ | ❌ (solo ConflictQueue + Sovereign) |
| Tab strutturati | 5 | 5 | 5 | 0 (workspace) / 4 (admin) |
| Auth corretta (requireAdmin per mutative) | ✅ | ✅ | ✅ | ❌ (C4) |
| Audit log su operazioni admin | ✅ | ✅ | ✅ | ❌ (C5) |
| Adaptive polling | ✅ | ✅ | ✅ | ❌ (B9) |
| Export JSON/CSV | ✅ | ✅ | ✅ | ❌ (G4) |
| Error handling UI (toast) | ✅ | ✅ | ✅ | ⚠️ parziale (B12) |
| a11y (aria, keyboard, skeletons) | ✅ | ✅ | ✅ | ❌ (G11) |
| Dark mode tokens | ✅ | ✅ | ✅ | ⚠️ parziale (C6, B11, G12) |
| Test integration | ✅ | ✅ | ✅ | ❌ (solo unit) |

**Conclusione**: il modulo governance è il meno maturo tra i CORE_AREAS. Le criticità C1-C5 sono bloccanti per la sicurezza e devono essere fixate prima di qualsiasi deploy production.

---

## 8. Metriche

- **File analizzati**: 18 (componenti, API, lib, schema, admin)
- **LOC totali modulo**: ~4.800
- **Bug critici (C)**: 10
- **Bug medi (B)**: 12
- **Gap funzionali (G)**: 12
- **Test mancanti**: 10 file
- **Stima implementazione Fasi 2-5**: 4-5 giornate di lavoro

---

## Prossimo passo

Procedere con **Fase 2 — Criticità sicurezza & dati** (C1-C5 + B1-B2), seguendo l'ordine del piano di intervento. Tutti i fix saranno accompagnati da test integration e commit atomici.
