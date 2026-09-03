# Model Encapsulator — Audit & Hardening

**Data**: 2026-09-02
**Modulo**: `Model Encapsulator` — Phase 10 (F10)
**Scope**: `src/lib/kernel/grounded-inference.ts` · `src/app/api/grounded/route.ts` · `src/components/agentic/phase10.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/grounded-inference.ts` | 258 | Core: `encapsulatedCall` + sandbox `vm.runInNewContext` + `extractScript` + `simulateLLMOutput` + `getOrCreatePolicy` + `updatePolicy` + `listSessions` + `groundingStats` |
| `src/app/api/grounded/route.ts` | 54 | API REST: GET sessions/stats + POST encapsulated_call/update_policy |
| `src/components/agentic/phase10.tsx` | 181 | UI: form Encapsulated Call + history sessioni |

### Schema Prisma (DB)

```prisma
model EncapsulatedSession {
  id              String   @id @default(cuid())
  agentId         String
  taskGoal        String
  contextInjected String   // JSON contesto minimale
  modelOutput     String   // output raw LLM
  parsedScript    String?  // script deterministico estratto
  sandboxResult   String?  // JSON risultato sandboxed
  sandboxOk       Boolean  @default(false)
  retryCount      Int      @default(0)
  status          String   @default("pending") // pending|executed|failed|sandbox_blocked
  createdAt       DateTime @default(now())
}

model EncapsulationPolicy {
  id                   String   @id @default(cuid())
  agentId              String   @unique
  maxRetries           Int      @default(3)
  contextBudget        Int      @default(2000) // token max iniettabili
  sandboxEnabled       Boolean  @default(true)
  forbidDirectMutation Boolean  @default(true)
  updatedAt            DateTime @updatedAt
}
```

### Stato pre-audit

Il modulo è stato parzialmente auditato nel ciclo Memory Domain (`docs/MEMORY-DOMAIN-FASE1-AUDIT.md`) con fix già applicati:
- ✅ C1/N9: `new Function()` sostituito con `vm.runInNewContext()` (sandbox reale con timeout 5s)
- ✅ 6 test esistenti in `tests/unit/memory-domain-core.test.ts` (smoke: session creation, stats, listSessions, sandbox env leak check)
- ✅ 4 test in `tests/integration/learn-domain-fase2.test.ts` (N9 sandbox isolation: blocks process, blocks require, allows safe ops, timeout)
- ✅ B7 fix Memory Domain: adaptive polling con Page Visibility API in phase10.tsx

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `encapsulatedCall` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1 degli altri moduli: `encapsulatedCall` è esposto via API ma **non chiamato dal runtime**. L'executor usa `executeReActLoop` (che chiama direttamente lo ZAI SDK) senza passare dal Model Encapsulator. Il pattern "stateless reasoning function" con reset esplicito della sessione è **cosmetico** — funziona solo se un admin manualmente chiama `/api/grounded?action=encapsulated_call`.

**Impatto**: la "Vulnerabilità dello Stato Latente" (LLM come archivio di memoria) non è mitigata a runtime. Un agente che chiama ripetutamente l'LLM via ReAct loop mantiene contesto cross-iterazione, violando il principio di incapsulamento.

### 🔴 C2 — `extractScript` non ha sanitizzazione (RCE risk residuo anche con sandbox)

**File**: `src/lib/kernel/grounded-inference.ts:162-177`

```ts
function extractScript(output: string): string | null {
  const fenced = output.match(/```(?:js|javascript)?\s*\n([\s\S]*?)\n```/)
  if (fenced) {
    const code = fenced[1].trim()
    const unwrapped = code.replace(/^function\s*\w*\s*\([^)]*\)\s*\{?/, '').replace(/\}\s*$/, '').trim()
    return unwrapped
  }
  const returnMatch = output.match(/^(return\s+[\s\S]+?);?\s*$/m)
  if (returnMatch) return returnMatch[1].trim()
  return null
}
```

Problemi:
1. **No size cap**: uno script di 1MB estratto da output LLM viene passato a `vm.runInNewContext` → DoS via parse cost
2. **No keyword blocklist**: script contenenti `process`, `require`, `fetch`, `global`, `constructor`, `__proto__` non vengono filtrati a priori
3. **Regex `return` match è multiline greedy**: può catturare contenuto arbitrario se LLM emette `return ...; ` in mezzo al testo

**Verifica sperimentale** (eseguita durante audit): `extractScript` su input malevoli ritorna script contenenti `process`, `fetch`, `constructor` senza warning. Anche se `vm.runInNewContext` blocca `process` a runtime (sandbox senza `process` nel context), l'assenza di size cap espone a DoS via parse di script enormi.

### 🔴 C3 — POST `/api/grounded` usa `requireAuth` invece di `requireAdmin`

**File**: `src/app/api/grounded/route.ts:30-44`

```ts
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)  // C3: dovrebbe essere requireAdmin
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'encapsulated_call') {
    // Esegue LLM call + sandbox → crea EncapsulatedSession
  }
  if (action === 'update_policy') {
    // Modifica EncapsulationPolicy → mutative
  }
}
```

Come C4 degli altri moduli (Delegation HITL `retainer/route.ts`, `blocked-actions/route.ts`): le POST mutative dovrebbero richiedere `requireAdmin`. Qui invece:
- `encapsulated_call` → esegue LLM call (cost reale, potenziale sandbox RCE se N9 fallisce) → qualsiasi viewer autenticato può innescare
- `update_policy` → modifica `EncapsulationPolicy` (es. disabilita sandbox) → qualsiasi viewer autenticato può disabilitare la sandbox per un agente

---

## 3. Bug (Medium)

### 🟠 B1 — `modelOutput` persistito senza size cap (DB bloat risk)

**File**: `src/lib/kernel/grounded-inference.ts:88-98`

```ts
const session = await db.encapsulatedSession.create({
  data: {
    agentId: call.agentId,
    taskGoal: call.taskGoal,
    contextInjected: truncatedContext,  // capped (contextBudget * 4)
    modelOutput,                       // B1: NO size cap!
    parsedScript: parsedScript ?? undefined,  // B1: NO size cap!
    sandboxOk: false,
    retryCount: 0,
    status: parsedScript ? 'pending' : 'executed',
  },
})
```

`contextInjected` è troncato a `policy.contextBudget * 4` caratteri, ma `modelOutput` e `parsedScript` non hanno cap. Se l'LLM ritorna 100KB di output (es. script generato molto lungo), viene persistito interamente nel DB. Lo stesso `sandboxResult` (riga 106) non ha cap.

### 🟠 B2 — `phase10.tsx` `refresh()` senza try/catch su fetch

**File**: `src/components/agentic/phase10.tsx:34-41`

```ts
const refresh = async () => {
  const [sessR, statsR] = await Promise.all([
    fetch('/api/grounded?action=sessions').then((r) => r.json()),
    fetch('/api/grounded?action=stats').then((r) => r.json()),
  ])
  setSessions(sessR.sessions || [])
  setStats(statsR)
}
```

Come B2 degli altri moduli (phase9.tsx Fase B fix): un fetch fallito (network error, server 500, body non JSON) fa throw unhandled rejection, rompe il polling `setInterval` e lascia la UI in stato stale.

### 🟠 B3 — `parsedScript` può essere `undefined` (TypeScript bug)

**File**: `src/lib/kernel/grounded-inference.ts:93`

```ts
parsedScript: parsedScript ?? undefined,
```

`parsedScript` ha tipo `string | null` (ritorno di `extractScript`), ma `parsedScript ?? undefined` lo converte a `string | undefined`. Il campo Prisma è `String?` (nullable), quindi `undefined` viene convertito a `null` implicitamente, ma il codice TypeScript dovrebbe passare `null` esplicitamente per chiarezza. Bug minore ma genera warning ESLint `no-unnecessary-condition`.

### 🟠 B4 — `encapsulatedCall` ignora `policy.maxRetries` (policy cosmetica)

**File**: `src/lib/kernel/grounded-inference.ts:44-130`

Il campo `maxRetries` è persistito in `EncapsulationPolicy` ma `encapsulatedCall` non implementa retry logic. Se la prima chiamata LLM fallisce, ritorna `LLM Error: ...` nel `modelOutput` senza retry. La policy è **cosmetica** — `maxRetries: 3` non viene rispettato.

### 🟠 B5 — `simulateLLMOutput` non ha size cap su context serializzato

**File**: `src/lib/kernel/grounded-inference.ts:183-210`

```ts
function simulateLLMOutput(taskGoal: string, context: Record<string, unknown>): string {
  const inputKeys = Object.keys(context)
  if (inputKeys.length > 0) {
    const firstKey = inputKeys[0]
    const val = context[firstKey]
    if (Array.isArray(val)) {
      return `Ecco la trasformazione... ${firstKey}...`
    }
  }
  return `Analisi completata per "${taskGoal}". Il contesto contiene ${inputKeys.length} campi.`
}
```

`simulateLLMOutput` viene chiamato come fallback se l'LLM fallisce. Il `taskGoal` viene interpolato senza size cap. Se un caller passa `taskGoal` di 100KB, l'output simulato (e poi persistito come `modelOutput`) contiene tutto il taskGoal → DB bloat.

### 🟠 B6 — `runPipeline` importato ma mai usato (dead import)

**File**: `src/lib/kernel/grounded-inference.ts:15`

```ts
import { runPipeline } from './compiled-ai' // riusa la sandbox 4-stadi
```

Il commento dice "riusa la sandbox 4-stadi" ma `runPipeline` non viene mai chiamato nel file. Dead import che può confondere (fa pensare che la sandbox 4-stadi di `compiled-ai` sia in uso, mentre il codice usa `vm.runInNewContext` locale).

---

## 4. Gap funzionali

### 🟡 G1 — Zero test specifici per `extractScript` e `executeSandbox` in isolamento

I test esistenti in `tests/unit/memory-domain-core.test.ts` testano `encapsulatedCall` end-to-end (smoke), ma non testano:
- `extractScript` con input malevoli (RCE patterns, script enormi, multiline return)
- `executeSandbox` con script contenenti `this.constructor.constructor`, `__proto__`, `global`
- `getOrCreatePolicy` default values
- `updatePolicy` upsert behavior
- `groundingStats` accuratezza numerica (mock con N sessioni)

### 🟡 G2 — `phase10.tsx` nessun a11y (aria-label, role=status)

**File**: `src/components/agentic/phase10.tsx`

181 LOC senza `aria-*` o `role`. I button "Aggiorna", "Esegui Encapsulated Call" non hanno `aria-label`. La stats grid non ha `role=status` + `aria-live=polite`. Come G2 del modulo Delegation HITL Fase C.

### 🟡 G3 — `phase10.tsx` non ha error handling su `runCall` fetch

**File**: `src/components/agentic/phase10.tsx:53-68`

```ts
const runCall = async () => {
  let ctx: unknown
  try { ctx = JSON.parse(contextData) } catch { toast.error('Context data non è JSON valido'); return }
  const r = await fetch('/api/grounded', { ... })
  const d = await r.json()  // G3: può throware se risposta non JSON
  if (d.ok) { ... } else toast.error(d.error)
}
```

`r.json()` può throware se la risposta è 500 con body HTML (es. errore Next.js dev mode). Come G3 del modulo Delegation HITL Fase C: parse-safe con `try/catch` interno + fallback a `r.text()` per logging.

### 🟡 G4 — `groundingStats` non include metriche utili (failed, pending, sandboxOk)

**File**: `src/lib/kernel/grounded-inference.ts:250-258`

```ts
export async function groundingStats() {
  const [sessions, executed, sandboxBlocked, policies] = await Promise.all([...])
  return { sessions, executed, sandboxBlocked, policies }
}
```

Mancano:
- `failed` (status='failed')
- `pending` (status='pending')
- `sandboxOk` (sandboxOk=true, status='executed')
- `avgRetryCount` (media retryCount)
- `totalContextInjected` (somma lunghezze contextInjected, per monitorare bloat)

La UI phase10.tsx mostra solo 4 stat card (sessions/executed/sandboxBlocked/policies), ma con `failed` e `pending` mancanti non si vede se ci sono sessioni che non sono state completate.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3)

1. **C1**: Integrare `encapsulatedCall` nell'executor come opzione (pre-ReAct loop, con policy check). Non bloccante (fail-open).
2. **C2**: Sanitizzazione `extractScript`:
   - Size cap (10KB su script estratto)
   - Keyword blocklist (`process`, `require`, `fetch`, `global`, `constructor`, `__proto__`)
   - Throw se script contains blocked keyword (logged ma non eseguito)
3. **C3**: POST `/api/grounded` con `requireAdmin` invece di `requireAuth`

### Fase B — Robustezza (B1, B2, B4, B5, B6)

1. **B1**: Size cap su `modelOutput` (50KB), `parsedScript` (10KB), `sandboxResult` (50KB) con marker `[truncated]`
2. **B2**: `phase10.tsx` `refresh()` con try/catch + toast.error + preserva stato
3. **B4**: Implementare retry logic in `encapsulatedCall` (rispetta `policy.maxRetries`)
4. **B5**: `simulateLLMOutput` tronca `taskGoal` a 1KB prima di interpolare
5. **B6**: Rimuovere dead import `runPipeline` (no behavioral change)

### Fase C — UX & completamento (G1, G2, G3, G4)

1. **G1**: Unit test per `extractScript` (RCE patterns, size cap, multiline), `executeSandbox` (constructor/proto chain), `getOrCreatePolicy` (defaults), `updatePolicy` (upsert), `groundingStats` (accuracy)
2. **G2**: a11y in `phase10.tsx` (aria-label su button, role=status su stats grid)
3. **G3**: `phase10.tsx` `runCall` parse-safe con `try/catch` su `r.json()` + fallback `r.text()`
4. **G4**: `groundingStats` con 3 metriche aggiuntive (failed, pending, sandboxOk) + UI phase10.tsx con stat card aggiuntive

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 3 (1 core + 1 API + 1 UI) |
| LOC totali | ~493 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 10 (6 unit + 4 integration N9 sandbox) |
| Consumer runtime | 0 (modulo cosmetico) |
| Fix preesistenti | C1/N9 (sandbox vm), B7 (adaptive polling) |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3) — sicurezza & effettività. **Critica**.
   - C1: encapsulatedCall integrato in executor (encapsulation non più cosmetica)
   - C2: extractScript sanitizzato (no RCE/DoS via script malevolo)
   - C3: POST /api/grounded requireAdmin (no privilege escalation per policy mutation)
2. **Fase B** (B1+B2+B4+B5+B6) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: encapsulatedCall integrato in executor (encapsulation non più cosmetica a runtime)
- C2: extractScript sanitizzato (no RCE/DoS via script malevolo)
- C3: POST /api/grounded requireAdmin (no privilege escalation per policy mutation)

Tempo stimato: 1 giornata.
