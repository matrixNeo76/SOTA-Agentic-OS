# LTL Taint Normative — Audit & Hardening

**Data**: 2026-07-23
**Modulo**: `LTL Taint Normative` — Advanced/Internals
**Scope**: `src/lib/kernel/ltl-monitor.ts` · `src/lib/kernel/taint.ts` · `src/lib/kernel/normative.ts` · `src/components/agentic/ltl-normative-editor.tsx` · `src/app/api/verify/route.ts` + integration sites (`executor.ts`, `console/route.ts`)

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/ltl-monitor.ts` | 890 | LTL monitor: parser + compilatore AST→FSM + runtime + 6 default rules + simulate/preview |
| `src/lib/kernel/taint.ts` | 184 | Taint tracking: taintInput/propagateTaint/checkSink + TTL decay |
| `src/lib/kernel/normative.ts` | 215 | Normative gate: evaluateIntent + 6 default axioms + CRUD |
| `src/components/agentic/ltl-normative-editor.tsx` | 447 | UI: editor LTL + form assiomi + taint panel |
| `src/app/api/verify/route.ts` | 297 | API REST: GET sezioni + POST 12 azioni (validate, verify, taint, normative) |
| `src/components/agentic/phase4.tsx` | (snippet) | UI: Taint demo (taintInput/checkSink manuali) |
| `tests/unit/ltl-monitor.test.ts` | 211 | Test esistenti: 6 test |
| `tests/unit/normative.test.ts` | 153 | Test esistenti: 14 test |
| `tests/unit/taint.test.ts` | 159 | Test esistenti: 16 test |

### Stato pre-audit

Questo modulo è stato parzialmente auditato nel ciclo Trust & Governance (report `docs/TRUST-GOVERNANCE-FASE1-AUDIT.md`), ma l'audit era focalizzato su auth API e errori CRUD. Questo audit si concentra su **bug logici del LTL engine, gap nel taint tracking, e robustezza runtime** non coperti prima.

---

## 2. Criticità (Critical)

### 🔴 C1 — LTL monitor: singleton in-memory perde stato su restart/process crash

**File**: `src/lib/kernel/ltl-monitor.ts:617-642`

```ts
const monitor = LTLMonitor.getInstance()  // singleton in-memory
let monitorInitialized = false
let lastRuleCount = -1

export async function initMonitor(): Promise<void> {
  const dbRules = await db.lTLRule.findMany({ where: { active: true } })
  if (monitorInitialized && dbRules.length === lastRuleCount) {
    return  // skip reload
  }
  // ...
}
```

Il monitor LTL è un **singleton in-memory**. Lo stato FSM di ogni regola (es. `EXPECTING_B`, `WAITING_B`) è perso su:
- Restart del processo (dev server, deploy)
- Crash (OOM, exception non gestita)
- Scale-out multi-istanza (richieste diverse hitano istanze diverse)

**Effetto**: regole come `G(error -> F reflect)` perdono lo stato "in attesa di reflect" → la regola non viene mai violata anche se reflect non arriva mai. Il monitor è **cosmetico in produzione**.

### 🔴 C2 — LTL `G(a -> X b)` non gestisce eventi multipli `a` consecutivi

**File**: `src/lib/kernel/ltl-monitor.ts:514-530`

```ts
case 'G->X': {
  // ...
  if (r.state === 'EXPECTING_B') {
    if (bTrue) {
      r.state = aTrue ? 'EXPECTING_B' : 'IDLE'
    } else {
      r.state = 'VIOLATED'
    }
  } else {
    // IDLE
    if (aTrue) r.state = 'EXPECTING_B'
  }
  break
}
```

Se arrivano due `a` consecutivi (`a, a, b`):
1. Primo `a`: IDLE → EXPECTING_B ✓
2. Secondo `a`: EXPECTING_B, ma `aTrue=true` e `bTrue=false` → **VIOLATED** (sbagliato!)

La semantica LTL `G(a -> X b)` richiede che **ogni** `a` sia seguito da `b` al prossimo step. Con due `a` consecutivi, il secondo `a` dovrebbe "sovrascrivere" l'attesa del primo, non violare. La FSM non ha un contatore o stack di attese pending.

**Effetto**: regola `LTL-001` (`G(high_risk -> X human_approval)`) genera falsi positivi se due tool call high-risk avvengono in step consecutivi.

### 🔴 C3 — Taint `checkSink` non propaga a tutti i sink futuri (one-shot block)

**File**: `src/lib/kernel/taint.ts:84-147`

```ts
export async function checkSink(sink, taintIds) {
  // ...
  for (const record of records) {
    // ...
    await db.taintRecord.update({
      where: { id: record.id },
      data: { flowTrace: JSON.stringify(flowTrace), blocked: true },
    })
  }
  // ...
}
```

Quando un taint blocca un sink, viene marcato `blocked: true`. Ma `blocked` non viene **mai resettato**. Se lo stesso taintId viene poi passato a un altro sink sensibile, il record è già `blocked=true` → `checkSink` lo conta di nuovo nei `blockedFlows` (perché la query filtra solo per `createdAt > ttlCutoff`, non per `blocked`).

**Effetto**: lo stesso taint appare ripetutamente nei `blockedFlows` di sink diversi, inflazionando i log e confondendo l'audit. Inoltre, `checkSink` non previene realmente il flusso: il chiamante deve controllare `result.allowed`, ma se non lo fa (bug nel consumer), l'operazione procede.

---

## 3. Bug (Medium)

### 🟠 B1 — LTL parser non valida nomi proposizione (caratteri speciali)

**File**: `src/lib/kernel/ltl-monitor.ts:199-212`

```ts
private parseAtom(): AST {
  const t = this.peek()
  // ...
  if (!t || /(!|&&|\|\||->|\(|\)|G|F|X|U)/.test(t)) {
    throw new Error(`Atomo atteso, trovato: ${t}`)
  }
  this.consume(t)
  return { kind: 'prop', name: t }
}
```

La regex accetta qualsiasi stringa che non sia un operatore, incluse:
- `123` (numero puro)
- `high-risk` (con trattino, ma poi `evalAST` fa `eventLabel === node.name` — se l'evento è `high_risk` non matcha `high-risk`)
- `tainted!` (con punto esclamativo attaccato)
- stringhe vuote dopo split

Manca validazione: `^[a-zA-Z_][a-zA-Z0-9_]*$`.

### 🟠 B2 — Normative `evaluateIntent` non valida `claimedPriority` range

**File**: `src/lib/kernel/normative.ts:64-100`

```ts
export async function evaluateIntent(intent: Intent): Promise<NormativeVerdict> {
  // ...
  if (ax.priority < intent.claimedPriority) {
    return { allowed: false, ... }
  }
  // ...
}
```

`intent.claimedPriority` non è validato. Un caller può passare `claimedPriority: 0` o `claimedPriority: -5` → `ax.priority < 0` è sempre falso → **nessun assioma blocca mai**. O `claimedPriority: 999` → tutti gli assiomi bloccano.

Manca: `if (![1,2,3].includes(intent.claimedPriority)) throw new Error(...)`.

### 🟠 B3 — Taint `propagateTaint` è silent no-op se taintId non esiste

**File**: `src/lib/kernel/taint.ts:59-75`

```ts
export async function propagateTaint(taintId: string, step: string): Promise<void> {
  const record = await db.taintRecord.findUnique({ where: { id: taintId }, ... })
  if (!record) {
    return  // silent no-op
  }
  // ...
}
```

Se il caller passa un taintId inesistente (typo, o taint scaduto), `propagateTaint` ritorna silenziosamente. Il caller non sa che la propagazione non è avvenuta → il flusso tainted non è tracciato.

Manca: throw `TaintNotFoundError` o ritornare `{ propagated: boolean, reason?: string }`.

### 🟠 B4 — LTL `verifyEvent` non ha rate limiting / size cap su `payload`

**File**: `src/lib/kernel/ltl-monitor.ts:653-674`

```ts
export async function verifyEvent(eventLabel, eventType, payload) {
  // ...
  await db.verificationEvent.create({
    data: {
      eventType,
      payload: JSON.stringify(payload),  // no size limit
      // ...
    },
  })
  // ...
}
```

`payload` è stringified e persistito senza limiti. Un caller può passare payload enormi (es. 10MB di JSON) → DB bloat + slow queries. Manca `payload.slice(0, 10000)` o simile.

### 🟠 B5 — Normative `evaluateIntent` non logga il verdict su DB

**File**: `src/lib/kernel/normative.ts:64-100`

`evaluateIntent` ritorna il verdict ma **non lo persiste**. Solo l'API route (`/api/verify`) fa `db.agentLog.create` se chiamata via API. Ma se un consumer interno (es. executor) chiama `evaluateIntent` direttamente, il verdict è perso.

Manca: persistenza opzionale su `NormativeEvaluation` table (o riusa `agentLog`).

### 🟠 B6 — LTL `evalEvent` resetta stato dopo violazione, perdendo contesto

**File**: `src/lib/kernel/ltl-monitor.ts:484-494`

```ts
if (r.fsm.violating.has(r.state)) {
  violations.push({ ... })
  if (r.spec.severity === 'block') verdict = 'reject'
  // ...
  // Reset after violation (per continuare a monitorare)
  r.state = r.fsm.initial
}
```

Dopo una violazione, lo stato FSM è resettato a `initial`. Questo significa che se ci sono **due violazioni consecutive** della stessa regola, solo la prima viene registrata; la seconda è "mascherata" dal reset.

**Effetto**: in un loop `execute → check → execute → check → ...` dove ogni `check` dovrebbe essere seguito da `execute` ma non lo è (LTL-003), solo il primo `check` viene flaggato.

### 🟠 B7 — Taint `SENSITIVE_SINKS` è hardcoded, non configurabile

**File**: `src/lib/kernel/taint.ts:20-23`

```ts
const SENSITIVE_SINKS = [
  'tool_call:exec', 'tool_call:file_write', 'tool_call:network',
  'tool_call:db_write', 'tool_call:deploy', 'tool_call:delete',
]
```

La lista è hardcoded. Admin non può aggiungere sink sensibili (es. `tool_call:email`, `tool_call:slack_post`) senza redeploy. Dovrebbe essere su `SystemSetting` o tabella dedicata.

### 🟠 B8 — LTL `compileAST` ritorna `null` silenziosamente per pattern non supportati

**File**: `src/lib/kernel/ltl-monitor.ts:288-330`

```ts
function compileAST(ast: AST, rule: LTLRuleSpec): CompiledFSM | null {
  if (ast.kind === 'G') { ... }
  if (ast.kind === 'F') { ... }
  if (ast.kind === 'X') { ... }
  if (ast.kind === 'U') { ... }
  return buildGFSM(ast, rule)  // fallback: tratta come G(p)
}
```

Pattern annidati complessi (es. `G(F(p))`, `G(p U q)`, `F(G(p))`) non sono supportati esplicitamente ma **non throwano** — cadono nel fallback `buildGFSM(ast, rule)` che li tratta come `G(p)` atomico. Questo è semanticamente sbagliato: `G(F(p))` significa "infinitamente spesso p", non "sempre p".

Manca: throw `UnsupportedPatternError` o ritornare `null` esplicito + skip nella `loadRules`.

---

## 4. Gap funzionali

### 🟡 G1 — LTL monitor non persiste stato FSM su DB

**File**: `src/lib/kernel/ltl-monitor.ts:430-615` (intero LTLMonitor class)

Lo stato FSM (`r.state`, `r.history`) è in-memory. Manca un modello `LTLRuleState { ruleId, currentState, history, updatedAt }` persistito. Questo risolverebbe C1 (perdita stato su restart) e permetterebbe di riprendere il monitoraggio dopo crash.

### 🟡 G2 — Zero integrazione Taint ↔ Executor runtime

**File**: `src/lib/runtime/executor.ts`

L'executor chiama `verifyEvent` (LTL) ma **non chiama mai** `taintInput`/`propagateTaint`/`checkSink`. Il taint tracking è completamente disconnesso dal runtime: funziona solo se un admin manualmente chiama `/api/verify?action=taint_input`.

Manca: integrazione automatica in `executeTask` dove:
1. Input utente → `taintInput(source='user', payload)`
2. Ogni step del ReAct loop → `propagateTaint(taintId, step)`
3. Prima di tool call sensibili → `checkSink(sink, taintIds)`

### 🟡 G3 — Normative `evaluateIntent` non chiamato da nessun consumer runtime

**File**: `src/lib/runtime/executor.ts`, `src/app/api/console/route.ts`

Come G2, `evaluateIntent` è esposto solo via API. L'executor non valuta mai le intenzioni prima di eseguire task. Il normative gate è **cosmetico a runtime** (come era ACTS prima di Fase A).

Manca: chiamata a `evaluateIntent` in `executeTask` prima del ReAct loop, con `intent` costruito da `taskDef`.

### 🟡 G4 — LTL `simulateLTL` non gestisce regole `severity: 'block'` correttamente

**File**: `src/lib/kernel/ltl-monitor.ts:833-889`

```ts
const tempMonitor = new LTLMonitor()
tempMonitor.loadRules([{ ruleId: 'SIM', formula, description: 'simulation', severity: 'warn' }])
```

La simulazione forza sempre `severity: 'warn'`, ignorando la severity reale della regola. Quindi una regola `block` simulata produce solo `warn`, non `reject`. Utente non vede il comportamento reale.

Manca: accettare `severity` come parametro o leggere dal DB se la regola esiste.

### 🟡 G5 — Taint `checkSink` non registra il blocco su `agentLog` o `verificationEvent`

**File**: `src/lib/kernel/taint.ts:84-147`

Quando `checkSink` blocca un flusso, aggiorna `TaintRecord.blocked=true` ma **non crea un `agentLog` o `verificationEvent`**. Solo l'API route fa logging, ma i consumer interni (futuri) non avrebbero audit trail.

Manca: opzione `auditLog?: boolean` in `checkSink` che crea un `verificationEvent` con `eventType='taint_block'`.

### 🟡 G6 — LTL editor UI non mostra stato FSM corrente delle regole attive

**File**: `src/components/agentic/ltl-normative-editor.tsx`

L'UI mostra le regole e la preview FSM, ma non mostra lo **stato runtime** delle FSM (es. "LTL-001 è in stato EXPECTING_B dal step 5"). Manca una sezione "Runtime State" che chiama `snapshot()` del monitor.

### 🟡 G7 — Nessun test integration end-to-end LTL → Taint → Normative

**File**: `tests/` (manca)

I test esistenti sono unit test isolati. Manca un integration test che:
1. Crea un taint → propaga → chiama checkSink (verifica blocco)
2. Crea regola LTL → verifica evento → verifica violazione
3. Crea assioma → valuta intent → verifica blocco

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & robustezza (C1, C2, C3, B1, B2, B4)

1. **C1**: Persistere stato FSM su DB:
   - Nuovo modello `LTLRuleState { ruleId, currentState, history (JSON), updatedAt }`
   - `initMonitor()` carica stato da DB invece di in-memory
   - `evalEvent()` upserta stato dopo ogni step
   - Test: restart simulato (ricarica monitor) → stato preservato
2. **C2**: Gestire `a` consecutivi in `G(a -> X b)`:
   - Aggiungere contatore `pendingBCount` a RuntimeRule
   - Ogni `a` incrementa, ogni `b` resetta a 0, violazione solo se `b` non arriva e `pendingBCount > 0` al prossimo step
   - Test: sequenza `a, a, b` → no violazione
3. **C3**: Taint `blocked` reset + `checkSink` idempotency:
   - Aggiungere `blocked: false` alla query `findMany` (ignora già bloccati)
   - Oppure: `blocked` diventa `blockedAtSink: string | null` per tracciare quale sink ha bloccato
   - Test: stesso taintId passato a 2 sink diversi → solo il primo blocca
4. **B1**: Validare nomi proposizione LTL:
   - Regex `^[a-zA-Z_][a-zA-Z0-9_]*$` in `parseAtom`
   - Test: `123` → error, `high-risk` → error, `high_risk` → ok
5. **B2**: Validare `claimedPriority` in `evaluateIntent`:
   - `if (![1,2,3].includes(intent.claimedPriority)) throw new InvalidPriorityError`
   - Test: `claimedPriority: 0` → throws
6. **B4**: Size cap su `verifyEvent` payload:
   - `payload.slice(0, 10000)` prima di `JSON.stringify` (o tronca dopo)
   - Test: payload 50KB → troncato a 10KB

### Fase B — Funzionale (G1, G2, G3, B5, B6)

1. **G1**: (assorbito in C1 — stato FSM persistito)
2. **G2**: Integrare Taint in executor:
   - In `executeTask`: se `taskDef.input` è user-provided, `taintInput('user', input)`
   - In ReAct loop: `propagateTaint(taintId, 'thought:' + iter.thought.slice(0,50))`
   - Prima di `dispatchTool` in tool-dispatcher: `checkSink('tool_call:'+toolName, taintIds)`
   - Test integration: taint fluisce da input → thought → tool call bloccato
3. **G3**: Integrare Normative in executor:
   - In `executeTask` prima del ReAct loop: `evaluateIntent({ agentId, action: taskDef.description, ... })`
   - Se `verdict.allowed === false` → skip task + log
   - Test integration: task che viola assioma priority 1 → blocked
4. **B5**: `evaluateIntent` persiste verdict:
   - Aggiungere `auditLog?: boolean` param (default true)
   - Se true, crea `agentLog` con payload = verdict
   - Test: `evaluateIntent` con auditLog=true → agentLog creato
5. **B6**: LTL `evalEvent` non resettare stato dopo violazione:
   - Rimuovere `r.state = r.fsm.initial` dopo violazione
   - Tenere stato corrente per continuare a monitorare
   - Test: 2 violazioni consecutive → 2 violations registrate

### Fase C — UX & completamento (B3, B7, B8, G4, G5, G6, G7)

1. **B3**: `propagateTaint` ritorna `{ propagated: boolean, reason?: string }`:
   - Se taintId non esiste → `{ propagated: false, reason: 'taintId not found' }`
   - Test: propagate con taintId inesistente → propagated=false
2. **B7**: `SENSITIVE_SINKS` da `SystemSetting`:
   - Chiave `taint.sensitive_sinks` (comma-separated)
   - `checkSink` legge da settings (con fallback hardcoded)
   - Test: aggiungi sink via settings → checkSink lo riconosce
3. **B8**: `compileAST` throw per pattern non supportati:
   - Rimuovere fallback `buildGFSM(ast, rule)`
   - Throw `UnsupportedPatternError` con messaggio descrittivo
   - `loadRules` skip regole non supportate (con log)
   - Test: `G(F(p))` → throws
4. **G4**: `simulateLTL` accetta `severity` param:
   - Default 'warn', ma se regola esiste nel DB usa la sua severity
   - Test: simulate con severity='block' → verdict='reject' su violazione
5. **G5**: `checkSink` opzione `auditLog`:
   - Se true, crea `verificationEvent` con `eventType='taint_block'`
   - Test: checkSink con auditLog=true → verificationEvent creato
6. **G6**: UI editor mostra stato runtime FSM:
   - Nuova sezione "Runtime State" che chiama `GET /api/verify?section=runtime`
   - Nuova action `runtime_state` in API che ritorna `monitor.snapshot()`
   - Test UI: verifica sezione renderizzata
7. **G7**: Integration test end-to-end:
   - `tests/integration/ltl-taint-normative-e2e.test.ts`
   - 3 scenari: Taint flow block, LTL violation, Normative block
   - Test: flow completo da input → block

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 7 (3 core + 1 API + 1 UI + 2 consumer) |
| LOC totali | ~2.174 |
| Bug critici (C) | 3 |
| Bug medi (B) | 8 |
| Gap funzionali (G) | 7 |
| Test esistenti | 36 (6 LTL + 14 Normative + 16 Taint) |
| Stima Fase A | 1.5 giornate |
| Stima Fase B | 1 giornata |
| Stima Fase C | 1 giornata |
| **Totale stimato** | **3.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3+B1+B2+B4) — sicurezza & robustezza. **Critica**.
2. **Fase B** (G2+G3+B5+B6) — integrazione runtime. **Alta** (attualmente cosmetico).
3. **Fase C** (B3+B7+B8+G4+G5+G6+G7) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: stato FSM perso su restart (monitor cosmetico in prod)
- C2: falsi positivi su `a` consecutivi
- C3: taint block inflazionato nei log

Tempo stimato: 1.5 giornate.
