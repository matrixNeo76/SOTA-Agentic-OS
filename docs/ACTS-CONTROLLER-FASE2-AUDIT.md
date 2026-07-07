# ACTS Controller — Audit & Hardening (Fase 2)

**Data**: 2026-07-07
**Modulo**: `phase3` (ACTS Controller) — Advanced/Internals
**Scope**: `src/lib/kernel/acts.ts` · `src/app/api/steering/route.ts` · `src/components/agentic/phase3.tsx` + integration sites (`executor.ts`, `console/route.ts`)

---

## 1. Mappatura

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/acts.ts` | 124 | Core: `decideStrategy` (FSM deterministica) + `steer` (persist + budget) + `steeringHistory` |
| `src/app/api/steering/route.ts` | 76 | API REST: GET vocab/storia/strategie + POST steer |
| `src/components/agentic/phase3.tsx` | 292 | UI: controller state + steering phrase + event history + auto-run |
| `src/lib/runtime/executor.ts` | (snippet) | Consumer 1: chiama `steer()` con parametri hardcoded in `executeTask` |
| `src/app/api/console/route.ts` | (snippet) | Consumer 2: chiama `steer()` nel loop di esecuzione piano |
| `prisma/schema.prisma` | 19 | Modelli `SteeringEvent` + `SteeringStrategy` |
| `tests/unit/phase3-toolmanager-core.test.ts` | (40 test ACTS) | Coverage esistente da Fase 3 |

### Stato pre-audit (post Fase 1-4)

I bug identificati nel Fase 1 audit precedente (`docs/PHASE3-TOOLMANAGER-FASE1-AUDIT.md`) sono tutti chiusi:
- ✅ B3 (dynamic Tailwind) → lookup map statica
- ✅ B6 (cycleCounter dead code) → rimosso
- ✅ G3 (refresh try/catch) → aggiunto
- ✅ G1 (zero test) → 37 unit test + 16 E2E smoke

Questo audit si concentra su **bug residui e gap architetturali** non coperti dal primo passaggio.

---

## 2. Criticità (Critical)

### 🔴 C1 — Steering phrase calcolata ma mai iniettata nel ReAct loop

**File**: `src/lib/runtime/executor.ts:252-307`, `src/app/api/console/route.ts:222-228`

`steer()` ritorna `{ strategy, phrase, tokenUsed, budgetRemaining }` ma in **entrambi** i consumer:
- `executor.ts`: usa solo `steeringResult.strategy`, la `phrase` è scartata
- `console/route.ts`: idem, usa `steerResult.strategy` + `budgetUsed`, la `phrase` è scartata
- `executeReActLoop` in `react-loop.ts`: non riceve la phrase come parametro, ha un `SYSTEM_PROMPT` statico

**Effetto**: l'intero ACTS Controller è **cosmetico a runtime**. Le steering phrases ("Prima di procedere, strutturiamo un piano…", "Aspetta, lasciami verificare…", etc.) non raggiungono mai l'LLM. Il `decideStrategy` FSM decide la strategia, la persiste su DB (audit trail), ma il modello principale non viene influenzato.

**Possibile impatto**: il sistema spende token per calcolare e persistere steering events che non hanno effetto cognitivo. L'audit trail è accurato ma il "cognitive steering" è inesistente.

### 🔴 C2 — `executor.ts` chiama `steer()` con parametri hardcoded (ignora stato reale)

**File**: `src/lib/runtime/executor.ts:252-260`

```ts
const steeringResult = await steer(
  taskDef.agentId,
  1000,          // budgetTotal hardcoded
  50,            // budgetUsed hardcoded
  1,             // step hardcoded
  'PLAN' as Strategy,  // lastStrategy hardcoded
  null,          // lastCheckPassed hardcoded
  0,             // errorsConsecutive hardcoded
)
```

Ogni task nel ReAct loop viene steerato con lo **stesso identico stato iniziale** → `decideStrategy` ritorna sempre `EXECUTE` (perché `lastStrategy === 'PLAN'` → EXECUTE). Lo steering non evolve mai durante l'esecuzione del piano.

**Effetto**: anche fixando C1 (iniettando la phrase), l'esecutore non avanzerebbe mai nello stato FSM. Solo `console/route.ts` mantiene stato tra iterazioni (`budgetUsed`, `lastStrategy`, `lastCheckPassed`, `errorsConsecutive`), ma è il path legacy.

### 🔴 C3 — `cycleId` collision risk: `generateTimeSortableId()` non è unico

**File**: `src/lib/utils.ts:21-27`, `src/lib/kernel/acts.ts:88`

```ts
export function generateTimeSortableId(): number {
  const minutesSince2024 = Math.floor((Date.now() - 1704067200000) / 60000)
  const counter = Math.floor(Math.random() * 100)  // 0-99
  return minutesSince2024 * 100 + counter
}
```

Il `counter` è casuale 0-99 → collision probability ~1% per chiamate nello stesso minuto. `SteeringEvent.cycleId` non ha constraint `@unique` (verificato nello schema), quindi collisioni silenziosamente creano record duplicati.

**Effetto**: in `phase3.tsx` UI la storia mostra `#{h.cycleId}` come identificatore → IDs duplicati confondono l'utente. In analisi forense (audit trail) non c'è modo di distinguere due eventi nello stesso minuto.

---

## 3. Bug (Medium)

### 🟠 B1 — `decideStrategy` HALT threshold `< 50` non documentato/configurabile

**File**: `src/lib/kernel/acts.ts:58`

```ts
if (budgetRemaining < 50) return 'HALT'
```

La soglia 50 è magica e hardcoded. Per task con budget 100 → HALT al 50% (troppo aggressivo). Per task con budget 10000 → HALT a 9950 (quasi mai). Non c'è modo di configurare la soglia per piano/agent.

### 🟠 B2 — `errorsConsecutive >= 3` threshold magico, senza reset esplicito

**File**: `src/lib/kernel/acts.ts:59`

```ts
if (errorsConsecutive >= 3) return 'CHECK'
```

Il counter `errorsConsecutive` è gestito esternamente (dal caller) ma non c'è documentazione su quando resettarlo. In `console/route.ts:244` viene incrementato ma **mai resettato a 0** su success. In `phase3.tsx:99-100` viene resettato a 0 su check passed, ma il `phase3.tsx` è solo UI demo.

**Effetto**: in `console/route.ts`, dopo 3 errori il controller entra in loop CHECK infinito (perché `lastCheckPassed === false` → PLAN → EXECUTE → CHECK → PLAN → ...).

### 🟠 B3 — `phase3.tsx` auto-run loop dipendenze useEffect causano re-render eccessivi

**File**: `src/components/agentic/phase3.tsx:67-71`

```tsx
useEffect(() => {
  if (!autoRun) return
  const t = setInterval(() => doStep(), 1500)
  return () => clearInterval(t)
}, [autoRun, step, lastStrategy, lastCheckPassed, errorsConsecutive, budgetUsed, budgetTotal])
```

L'effetto dipende da 7 variabili di stato → ad ogni `doStep()` (che aggiorna 4-5 di esse) il `clearInterval` + `setInterval` scatta di nuovo. Il timing 1500ms è quindi approssimativo, e il callback `doStep` viene ricreato ad ogni render (stale closure risk).

**Effetto**: auto-run instabile, potenziali skip di step se il render è lento, memory leak se l'utente naviga via durante auto-run (l'effect cleanup è ok ma il `doStep` pending può ancora fireare).

### 🟠 B4 — `phase3.tsx` simula `lastCheckPassed` con `Math.random()` (no integration reale)

**File**: `src/components/agentic/phase3.tsx:95-101`

```tsx
if (d.strategy === 'CHECK') {
  const passed = Math.random() > 0.3  // simulazione
  setLastCheckPassed(passed)
  if (!passed) setErrorsConsecutive(errorsConsecutive + 1)
  else setErrorsConsecutive(0)
}
```

Il risultato del CHECK è randomico al 70%. Non c'è integrazione con Phase 8 (Lean4 Verifier) o Phase 4 (Taint/LTL) per validare davvero i risultati intermedi.

**Effetto**: la UI dimostra il FSM ma non riflette il comportamento reale del sistema. Utenti che testano auto-run vedono pattern casuali.

### 🟠 B5 — `/api/steering` POST non valida input numerici (negativi/NaN)

**File**: `src/app/api/steering/route.ts:45-53`

```ts
const {
  agentId = 'controller',
  budgetTotal = 1000,   // accetta -1, NaN, Infinity
  budgetUsed = 0,       // accetta -1, NaN, Infinity, > budgetTotal
  step = 0,             // accetta -1, 3.5
  ...
} = body
```

Nessuna validazione. Un client può passare `budgetUsed: 99999999` (forza HALT), `step: -5` (comportamento FSM indefinito), `errorsConsecutive: 1e18`.

### 🟠 B6 — `SteeringStrategy` tabella opzionale (fallback silenzioso)

**File**: `src/app/api/steering/route.ts:19-26`

```ts
const [history, strategies] = await Promise.all([
  steeringHistory(agentId, 30),
  db.steeringStrategy.findMany(),
])
// ...
strategies: strategies.length ? strategies : Object.entries(STEERING_VOCABULARY).map(...)
```

Se la tabella `SteeringStrategy` è vuota (es. dopo DB reset), il fallback usa `STEERING_VOCABULARY` hardcoded. Ma se la tabella ha ANCHE solo 1 entry, il fallback non scatta e la UI mostra solo quella strategia → utente pensa che le 4 strategie mancanti non esistano.

**Effetto**: behaviour incoerente tra ambienti (dev con DB vuoto vs prod con seed parziale).

### 🟠 B7 — `steer()` non è idempotente (retry crea eventi duplicati)

**File**: `src/lib/kernel/acts.ts:96-105`

`steer()` crea sempre un nuovo `SteeringEvent`. Su retry di rete (fetch fallisce, client riprova) o su crash recovery, vengono creati record duplicati per lo stesso step logico.

Manca un idempotency key (es. `step + agentId + planId` unique constraint, o hash dello stato input).

---

## 4. Gap funzionali

### 🟡 G1 — Nessuna persistenza dello stato FSM tra richieste API

**File**: `src/app/api/steering/route.ts` (intero)

Lo stato FSM (`step`, `lastStrategy`, `lastCheckPassed`, `errorsConsecutive`, `budgetUsed`) è mantenuto solo lato client in `phase3.tsx` (useState) o in `console/route.ts` (variabili locali al singolo plan execution).

Non c'è modo di:
- Riprendere un ciclo cognitivo interrotto (es. dopo refresh browser)
- Condividere lo stato tra UI e executor
- Auditare la sequenza FSM come stato (solo come eventi)

Servirebbe un modello `SteeringState { agentId, planId, step, lastStrategy, lastCheckPassed, errorsConsecutive, budgetUsed, updatedAt }` upsert-ato ad ogni `steer()`.

### 🟡 G2 — Zero integrazione con Phase 11 (Affect) e Phase 5 (ERL)

**File**: `src/lib/kernel/acts.ts` (intero)

I `RelatedPhases` in `phase3.tsx:287` dichiarano integrazioni:
- `phase11` "Le sterzate ripetute aumentano la frustrazione" → non implementato
- `phase5` "Dalla memoria episodica estrai euristiche ERL" → non implementato
- `phase14` "Le strategie ACTS possono usare modelli diversi" → non implementato

Il ACTS è attualmente isolato. `decideStrategy` non legge affect state, non consulta ERL, non influenzare il model router.

### 🟡 G3 — `SteeringStrategy` DB table mai usata per override runtime

**File**: `prisma/schema.prisma:165-172`, `src/app/api/steering/route.ts:19`

La tabella `SteeringStrategy` esiste (con `triggerPhrase`, `budgetCost`, `active`) ma:
- `steer()` usa sempre `STEERING_VOCABULARY` hardcoded (ignora il DB)
- Non c'è API per modificare `SteeringStrategy` (nessun POST `/api/steering?action=update_strategy`)
- Il seed (`/api/seed/route.ts:117`) popola la tabella ma poi non viene consultata

**Effetto**: admin non può customizzare phrases/budget senza redeploy.

### 🟡 G4 — `decideStrategy` non ha transizioni REFLECT

**File**: `src/lib/kernel/acts.ts:48-71`

La strategia `REFLECT` è definita nel vocabolario (cost 100 tok) ma `decideStrategy` **non la ritorna mai** in nessuno stato. L'unico modo per ottenere REFLECT è... non c'è. È dead code.

Il flow FSM è: `PLAN → EXECUTE → CHECK → (PLAN|EXECUTE) → ...` — REFLECT non appare mai. Manca una regola tipo "dopo N cicli completati, REFLECT per consolidare euristiche".

### 🟡 G5 — Nessun test integration che verifica `steer()` end-to-end via API

**File**: `tests/` (manca)

I test esistenti coprono:
- ✅ `decideStrategy` unit test (11 casi, FSM puro)
- ✅ `STEERING_VOCABULARY` structure (3 test)
- ✅ `steer()` ritorna structure corretta (1 test)
- ❌ **Manca**: integration test che verifica `POST /api/steering` → DB write → `GET /api/steering` ritorna l'evento appena creato
- ❌ **Manca**: test che verifica il flusso completo `decideStrategy` → `steer` → DB → storia

### 🟡 G6 — `phase3.tsx` history mostra `cycleId` come `number` ma UI dice `#{h.cycleId}`

**File**: `src/components/agentic/phase3.tsx:23, 276`

```tsx
type HistoryItem = { id: string; cycleId: number; ... }
// ...
<span className="text-[10px] text-muted-foreground">#{h.cycleId}</span>
```

Il `cycleId` è un Int grosso (es. `20438521`) — display come `#20438521` è illegale. Dovrebbe essere abbreviato (es. `#8521` o un counter sequenziale per agent).

---

## 5. Piano di intervento (3 fasi)

### Fase A — Funzionale (C1, C2, G1) — fixa l'effettività del ACTS

1. **C1**: Iniettare `steeringResult.phrase` nel ReAct loop:
   - Aggiungere `steeringPhrase?: string` a `ReActOptions`
   - In `executeReActLoop`, prependere la phrase al `context` o al system prompt
   - Aggiornare `executor.ts` e `console/route.ts` per passare la phrase
2. **C2**: Sostituire parametri hardcoded in `executor.ts` con stato reale:
   - Mantenere `lastStrategy`, `budgetUsed`, `errorsConsecutive` come variabili nel `executePlan` loop (come fa `console/route.ts`)
   - Passare lo stato aggiornato ad ogni `steer()` call
3. **G1**: Aggiungere modello `SteeringState` + upsert in `steer()`:
   - `prisma/schema.prisma`: nuovo modello con `agentId + planId` unique
   - `steer()`: upsert dello stato ad ogni chiamata
   - `GET /api/steering?agentId=X&planId=Y`: ritorna anche `currentState`
   - `phase3.tsx`: fetch stato iniziale su refresh, non da useState locale

### Fase B — Sicurezza & robustezza (C3, B1, B2, B5, B7)

1. **C3**: Rimpiazzare `generateTimeSortableId()` con `cuid()` per `cycleId` (stringa univoca):
   - Cambiare `SteeringEvent.cycleId` da `Int` a `String`
   - Aggiornare `phase3.tsx` type + display
   - Migration script per dati esistenti
2. **B1**: Rendere `HALT` threshold configurabile:
   - Aggiungere `haltThreshold?: number` a `steer()` (default 50)
   -leggere da `SteeringStrategy` o da env `ACTS_HALT_THRESHOLD`
3. **B2**: Documentare e standardizzare `errorsConsecutive` reset:
   - `decideStrategy` non resetta (giusto, è compito del caller)
   - Aggiungere commento esplicito
   - Verificare che `console/route.ts` resetti su success (BUG: non lo fa)
4. **B5**: Validazione input in `/api/steering` POST:
   - `budgetTotal`: number, > 0, < 1e6
   - `budgetUsed`: number, >= 0, <= budgetTotal
   - `step`: integer, >= 0
   - `errorsConsecutive`: integer, >= 0, < 100
   - `lastStrategy`: enum ['PLAN','EXECUTE','CHECK','REFLECT','HALT']
5. **B7**: Idempotency key per `steer()`:
   - Aggiungere `step + agentId + planId` come unique constraint su `SteeringEvent`
   - `steer()` fa upsert invece di create

### Fase C — UX & completamento (B3, B4, B6, G3, G4, G5, G6)

1. **B3**: Stabilizzare auto-run loop in `phase3.tsx`:
   - Usare `useRef` per `doStep` invece di ricreare la funzione
   - Rimuovere `step, lastStrategy, ...` dalle dipendenze useEffect (usare ref)
   - Interval fisso 1500ms, non influenzato da re-render
2. **B4**: Integrare CHECK con Phase 8 (Lean4 Verifier) o Phase 4 (LTL):
   - In `phase3.tsx`, su strategy=CHECK, chiamare `/api/lean?action=verify` o `/api/ltl`
   - Sostituire `Math.random()` con risultato reale
3. **B6**: Uniformare `SteeringStrategy` fallback:
   - Se tabella vuota → seeda con `STEERING_VOCABULARY` (one-shot al primo GET)
   - Se tabella ha entry → mostra solo quelle (no fallback silenzioso)
4. **G3**: Implementare `steer()` con lookup da `SteeringStrategy` DB:
   - `steer()` legge `db.steeringStrategy.findUnique({ where: { name: strategy } })`
   - Se trovata e `active=true`, usa `triggerPhrase` + `budgetCost` dal DB
   - Fallback a `STEERING_VOCABULARY` solo se record non esiste
5. **G4**: Aggiungere transizione REFLECT a `decideStrategy`:
   - Regola: "dopo 5 CHECK passati, ritorna REFLECT"
   - Oppure: "dopo `step % 10 === 0 && step > 0`, ritorna REFLECT"
   - Aggiungere test unit
6. **G5**: Integration test end-to-end:
   - `POST /api/steering` → `GET /api/steering` → verifica evento in storia
   - `steer()` con stato A → `steer()` con stato B → verifica FSM transition
   - Idempotency: `steer()` 2 volte con stesso input → 1 evento (post B7)
7. **G6**: Display `cycleId` abbreviato in `phase3.tsx`:
   - Se `cycleId` è Int lungo → mostra `#` + ultime 4 cifre
   - Oppure: counter incrementale nella UI (`#1, #2, #3, ...`)

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 6 (3 core + 2 consumer + 1 schema) |
| LOC totali | ~580 |
| Bug critici (C) | 3 |
| Bug medi (B) | 7 |
| Gap funzionali (G) | 6 |
| Test esistenti | 40+ unit (post Fase 3) |
| Stima implementazione Fase A | 1 giornata |
| Stima implementazione Fase B | 0.5 giornata |
| Stima implementazione Fase C | 1 giornata |
| **Totale stimato** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+G1) — senza questa, ACTS è cosmetico. **Critica.**
2. **Fase B** (C3+B5+B7) — sicurezza e robustezza. **Alta.**
3. **Fase C** (B3+B4+G3+G4+G5+G6) — UX e completamento. **Media.**

B1, B2, B6 possono essere inseriti in Fase B o C a seconda della disponibilità.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve il problema più grave (C1+C2: ACTS è attualmente cosmetico a runtime) con sforzo contenuto (1 giornata).
