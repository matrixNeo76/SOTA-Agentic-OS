# Swarm Coherence — Audit & Hardening

**Data**: 2026-09-02
**Modulo**: `Swarm Coherence` — Phase 13 (F13)
**Scope**: `src/lib/kernel/esr-quorum.ts` · `src/app/api/esr/route.ts` · `src/components/agentic/phase13.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/esr-quorum.ts` | 308 | Core: `recordBelief` (belief lineage + superseded) + `getBeliefLineage` + `syncBelief` (ESR replication) + `proposeQuorumAction` + `voteQuorum` (atomic increment) + `listBeliefs`/`listSyncEvents`/`listQuorumDecisions`/`getQuorumVotes` + `esrStats` |
| `src/app/api/esr/route.ts` | 174 | API REST: GET beliefs/lineage/sync_events/quorum_decisions/quorum_votes/stats + POST record_belief/sync_belief/propose_quorum/vote_quorum |
| `src/components/agentic/phase13.tsx` | 393 | UI: 3 tab (Beliefs, ESR Sync, Quorum) + stats grid + forms |

### Schema Prisma (DB)

```prisma
model Belief {
  id           String   @id @default(cuid())
  agentId      String
  content      String
  beliefType   String   // summary|evidence|plan|observation
  embedding    String   // JSON array di float
  lineageId    String?  // belief genitore
  confidence   Float    @default(1.0)
  superseded   Boolean  @default(false)
  version      Int      @default(1)
  createdAt    DateTime @default(now())
}

model ESRSyncEvent {
  id             String   @id @default(cuid())
  sourceAgentId  String
  targetAgentId  String
  beliefId       String
  syncStatus     String   @default("pending") // pending|synced|conflict
  conflictReason String?
  timestamp      DateTime @default(now())
}

model QuorumVote {
  id             String   @id @default(cuid())
  workflowJoinId String
  action         String
  voterAgentId   String
  vote           String   // accept|reject
  reason         String?
  confidence     Float    @default(1.0)
  timestamp      DateTime @default(now())
}

model QuorumDecision {
  id              String   @id @default(cuid())
  workflowJoinId  String
  action          String
  requiredQuorum  Int      @default(2)
  acceptCount     Int      @default(0)
  rejectCount     Int      @default(0)
  verdict         String   @default("pending") // pending|accepted|rejected
  decidedAt       DateTime?
  createdAt       DateTime @default(now())
}
```

### Stato pre-audit

Il modulo è stato auditato nel ciclo Verify Domain (`docs/VERIFY-DOMAIN-FASE1-AUDIT.md`) con fix già applicati:
- ✅ C1: POST `/api/esr` richiede `requireAdmin` (era `requireAuth`)
- ✅ C3: `voteQuorum` previene voti duplicati (check `voterAgentId` esistente)
- ✅ C4: `voteQuorum` usa atomic `increment` (no race condition)
- ✅ B1: phase13.tsx tutte le 4 action functions hanno try/catch + toast.error
- ✅ B4: `getBeliefLineage` depth limit (max 20) per cyclic lineage
- ✅ B5: `syncBelief` preserva version history (source version + 1)
- ✅ B7: phase13.tsx adaptive polling con Page Visibility API
- ✅ B9: phase13.tsx auto-fill belief ID (no return on first click)
- ✅ C6: AgentLog writes su tutte le mutative actions (record_belief, sync_belief, propose_quorum, vote_quorum)
- ✅ 11 test in `tests/unit/verify-domain-core.test.ts` (recordBelief, listBeliefs, getBeliefLineage B4, esrStats, proposeQuorumAction, voteQuorum pending/accepted/rejected, C3 duplicate, listQuorumDecisions)

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `recordBelief`/`syncBelief` non sono integrati nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1 degli altri moduli: `recordBelief` e `syncBelief` sono esposti via API ma **non chiamati dal runtime**. L'executor non registra belief durante l'esecuzione dei task, né sincronizza belief tra agenti che collaborano allo stesso piano. Il "Belief Lineage" e l'"ESR replication" sono **cosmetici** — funzionano solo se un admin manualmente chiama `/api/esr?action=record_belief`.

**Impatto**: la "Divergenza Epistemica" (agenti paralleli che leggono dati diversi o estraggono riassunti divergenti) non è mitigata a runtime. Due agenti che lavorano allo stesso piano possono arrivare a conclusioni divergenti senza che il sistema lo rilevi.

### 🔴 C2 — `proposeQuorumAction`/`voteQuorum` non sono integrati nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1, ma per il quorum semantico: `proposeQuorumAction` e `voteQuorum` non sono chiamati ai "join point del DAG" come previsto dall'ARCHITECTURE.md. L'executor non propone quorum quando task paralleli convergono (join point), né i validatori indipendenti votano.

**Impatto**: il "Quorum Semantico" (certificazione multi-validatore per azioni critiche ai join point) è cosmetico. Nessuna azione è effettivamente certificata da quorum a runtime.

### 🔴 C3 — `content` e `reason` persistiti senza size cap (DB bloat risk)

**File**: `src/lib/kernel/esr-quorum.ts:64, 242`

```ts
// recordBelief
const belief = await db.belief.create({
  data: {
    agentId: input.agentId,
    content: input.content,  // C3: no size cap!
    ...
  },
})

// voteQuorum
await db.quorumVote.create({
  data: {
    ...
    reason,  // C3: no size cap!
    ...
  },
})
```

Come C3/B1 degli altri moduli: `content` (belief testuale) e `reason` (motivazione voto) sono persistiti senza size cap. Un caller malevolo o buggy può passare `content` di 1MB → DB bloat. Lo stesso `action` in `proposeQuorumAction` e `conflictReason` in `syncBelief` non hanno cap.

---

## 3. Bug (Medium)

### 🟠 B1 — `voteQuorum` non gestisce tie (acceptCount == rejectCount == requiredQuorum)

**File**: `src/lib/kernel/esr-quorum.ts:254-259`

```ts
let verdict: 'pending' | 'accepted' | 'rejected' = 'pending'
if (newAccept >= decision.requiredQuorum) {
  verdict = 'accepted'
} else if (newReject >= decision.requiredQuorum) {
  verdict = 'rejected'
}
```

Se `requiredQuorum = 2` e 2 voter votano accept + 2 voter votano reject (4 voti totali), il primo che raggiunge 2 vince. Ma se i voti arrivano nell'ordine accept→reject→accept→reject, il verdict è 'accepted' dopo il 3° voto (2 accept), anche se poi arriva un 2° reject. Non c'è gestione del tie esplicita — il primo che raggiunge il quorum vince, anche se l'altro lato poi pareggia.

**Fix**: aggiungere `else if (newAccept === newReject && newAccept >= decision.requiredQuorum)` → verdict 'rejected' (tie va a safety, come nel normative calculus C8 fix).

### 🟠 B2 — `phase13.tsx` `refresh()` catch silente (no toast.error)

**File**: `src/components/agentic/phase13.tsx:69-71`

```ts
} catch (e: any) {
  console.error('[phase13] refresh failed:', e?.message)
}
```

A differenza degli altri moduli (B2 fix pattern: toast.error user-friendly), phase13 `refresh()` ha solo `console.error` — nessun `toast.error`. L'utente non vede feedback su failure di caricamento. Come B2 degli altri moduli.

### 🟠 B3 — `recordBelief` non valida `beliefType` enum a runtime

**File**: `src/lib/kernel/esr-quorum.ts:34-75`

```ts
export async function recordBelief(input: BeliefInput): Promise<...> {
  // ...
  const belief = await db.belief.create({
    data: {
      beliefType: input.beliefType,  // B3: type union, ma no runtime validation
      ...
```

Come B5 del modulo Objective Builder: `beliefType: 'summary' | 'evidence' | 'plan' | 'observation'` è solo type union TypeScript. La route `/api/esr` valida `beliefType` (C6 fix Verify Domain), ma `recordBelief` in `esr-quorum.ts` no — se chiamato direttamente da altro codice (es. futuro executor integration C1), può persistire valori arbitrari.

### 🟠 B4 — `voteQuorum` non valida `vote` enum a runtime

**File**: `src/lib/kernel/esr-quorum.ts:216-222`

```ts
export async function voteQuorum(
  decisionId: string,
  voterAgentId: string,
  vote: 'accept' | 'reject',  // B4: type union, ma no runtime validation
  ...
```

Come B3 sopra: la route valida `vote` (C6 fix), ma `voteQuorum` in `esr-quorum.ts` no. Se chiamato direttamente, può persistire valori arbitrari come `vote: 'abstain'`.

### 🟠 B5 — `syncBelief` non valida `sourceAgentId !== targetAgentId`

**File**: `src/lib/kernel/esr-quorum.ts:118-122`

```ts
export async function syncBelief(
  sourceAgentId: string,
  targetAgentId: string,
  beliefId: string
): Promise<{ syncStatus: 'synced' | 'conflict'; reason?: string }> {
```

Se `sourceAgentId === targetAgentId`, la funzione replica il belief nello stesso agente → crea un duplicato (stesso content, stesso agentId, versione +1). Non è un crash, ma è uno spreco di DB space e può confondere `listBeliefs` (che filtra `superseded: false` ma mostra entrambi i duplicati).

**Fix**: throw esplicito se `sourceAgentId === targetAgentId`.

### 🟠 B6 — `esrStats` non include metriche utili (conflictRate, quorumCompletionRate)

**File**: `src/lib/kernel/esr-quorum.ts:291-308`

```ts
return {
  beliefs,
  syncEvents,
  conflicts,
  quorumDecisions,
  acceptedQuorum,
  rejectedQuorum,
}
```

Mancano:
- `conflictRate` (conflicts / syncEvents, % di sync con conflitto)
- `quorumCompletionRate` ((acceptedQuorum + rejectedQuorum) / quorumDecisions, % decisioni risolte)
- `pendingQuorum` (quorumDecisions - acceptedQuorum - rejectedQuorum, decisioni ancora pending)
- `avgConfidence` (media confidence dei belief attivi, per monitorare qualità epistemica)

Come G4 degli altri moduli.

---

## 4. Gap funzionali

### 🟡 G1 — Zero unit test per `syncBelief` conflitto, `getBeliefLineage` catena lunga, `voteQuorum` tie

I 11 test in `verify-domain-core.test.ts` coprono:
- `recordBelief` (creazione, embedding, listBeliefs)
- `getBeliefLineage` (depth limit B4)
- `esrStats` (struttura)
- `proposeQuorumAction` + `voteQuorum` (pending, accepted, rejected, C3 duplicate)

Mancano test per:
- `syncBelief` conflitto (target ha belief simile ma divergente → syncStatus='conflict')
- `syncBelief` synced (nessun conflitto → replica + version +1)
- `syncBelief` source belief non trovato → conflict
- `getBeliefLineage` catena lunga (3+ versioni, verifica ordinamento)
- `voteQuorum` tie (accept == reject == requiredQuorum — quando B1 sarà fixato)
- `listSyncEvents` / `getQuorumVotes` / `listQuorumDecisions` (ordinamento, limit)

### 🟡 G2 — `phase13.tsx` nessun a11y (aria-label, role=status)

**File**: `src/components/agentic/phase13.tsx`

393 LOC senza `aria-*` o `role` su button e stats grid. Come G2 degli altri moduli.

### 🟡 G3 — `phase13.tsx` 4 action functions non hanno parse-safe su `r.json()`

**File**: `src/components/agentic/phase13.tsx:92, 112, 129, 145`

```ts
const d = await r.json()  // G3: può throware se risposta non JSON
```

Le 4 funzioni (`recordBelief`, `syncBelief`, `proposeQuorum`, `voteQuorum`) hanno try/catch esterno (B1 Verify Domain fix), ma `r.json()` può throware su risposta non JSON. Il catch esterno mostra "Record belief failed: Unexpected token <" — non user-friendly. Come G3 degli altri moduli: parse-safe con `try/catch` interno + fallback `r.text()`.

### 🟡 G4 — `esrStats` manca metriche derivate (assorbito in B6)

Vedi B6 sopra — `conflictRate`, `quorumCompletionRate`, `pendingQuorum`, `avgConfidence`. La UI phase13.tsx mostra solo 5 stat card, ma senza `conflictRate` e `quorumCompletionRate` non si vede la proporzione di problemi.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3)

1. **C1**: Integrare `recordBelief` nell'executor (post-task, registra belief summary del risultato). Non bloccante (fail-open). Se conflict con belief precedente, emette evento WS.
2. **C2**: Integrare `proposeQuorumAction` + `voteQuorum` ai join point del DAG (quando task paralleli convergono). L'executor propone quorum e N validatori (agenti indipendenti) votano. Non bloccante (fail-open).
3. **C3**: Size cap su `content` (10KB), `reason` (2KB), `action` (1KB), `conflictReason` (2KB) con marker `[truncated]`.

### Fase B — Robustezza (B1, B2, B3, B4, B5)

1. **B1**: `voteQuorum` gestisce tie (accept == reject == requiredQuorum → verdict 'rejected', tie va a safety)
2. **B2**: `phase13.tsx` `refresh()` con toast.error (non solo console.error)
3. **B3**: `recordBelief` valida `beliefType` enum a runtime
4. **B4**: `voteQuorum` valida `vote` enum a runtime
5. **B5**: `syncBelief` valida `sourceAgentId !== targetAgentId` (throw su self-sync)

### Fase C — UX & completamento (G1, G2, G3, G4/B6)

1. **G1**: Unit test per `syncBelief` (conflitto/synced/not found), `getBeliefLineage` catena lunga, `voteQuorum` tie (post B1), `listSyncEvents`/`getQuorumVotes`/`listQuorumDecisions`
2. **G2**: a11y in `phase13.tsx` (aria-label su button, role=status su stats grid)
3. **G3**: `phase13.tsx` 4 action functions parse-safe con `try/catch` su `r.json()`
4. **G4/B6**: `esrStats` con 4 metriche derivate (conflictRate, quorumCompletionRate, pendingQuorum, avgConfidence) + UI phase13.tsx con stat card aggiuntive

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 3 (1 core + 1 API + 1 UI) |
| LOC totali | ~875 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 11 (in verify-domain-core: recordBelief, listBeliefs, getBeliefLineage B4, esrStats, proposeQuorumAction, voteQuorum 4 scenari, C3 duplicate, listQuorumDecisions) |
| Consumer runtime | 0 (modulo cosmetico) |
| Fix preesistenti | C1 (requireAdmin), C3 (duplicate vote), C4 (atomic increment), B1 (try/catch), B4 (depth limit), B5 (version history), B7 (adaptive polling), B9 (auto-fill), C6 (AgentLog + validation) |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3) — sicurezza & effettività. **Critica**.
   - C1: recordBelief integrato in executor (belief lineage non più cosmetico)
   - C2: proposeQuorumAction+voteQuorum ai join point (quorum semantico non più cosmetico)
   - C3: size cap su content/reason/action/conflictReason (no DB bloat)
2. **Fase B** (B1+B2+B3+B4+B5) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4/B6) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: recordBelief integrato in executor (divergenza epistemica non più cosmetica)
- C2: proposeQuorumAction+voteQuorum ai join point (quorum semantico non più cosmetico)
- C3: size cap su content/reason (no DB bloat su belief/voti enormi)

Tempo stimato: 1 giornata.
