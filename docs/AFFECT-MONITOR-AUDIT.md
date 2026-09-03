# Affect Monitor — Audit & Hardening

**Data**: 2026-09-02
**Modulo**: `Affect Monitor` — Phase 11 (F11)
**Scope**: `src/lib/kernel/affect-subsystem.ts` · `src/app/api/affect/route.ts` · `src/components/agentic/phase11.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/affect-subsystem.ts` | 211 | Core: `computeAffect` (desperation/frustration + decay) + `decideIntervention` + `getOrCreateThreshold` + `updateThreshold` + `affectHistory` + `affectStats` |
| `src/app/api/affect/route.ts` | 95 | API REST: GET history/stats + POST compute/update_threshold |
| `src/components/agentic/phase11.tsx` | 209 | UI: form telemetria + history samples + stat card |

### Schema Prisma (DB)

```prisma
model AffectSample {
  id                String   @id @default(cuid())
  agentId           String
  desperation       Float    // 0..1
  frustration       Float    // 0..1
  toolFailureRate   Float    // 0..1
  gateRejectRate    Float    // 0..1
  repeatedToolCalls Int      // count di chiamate ripetute allo stesso tool
  intervention      String?  // azione intrapresa dal Meta-Observer
  cycleId           Int
  timestamp         DateTime @default(now())
}

model AffectThreshold {
  id                   String   @id @default(cuid())
  agentId              String   @unique
  desperationCritical  Float    @default(0.7)
  frustrationCritical  Float    @default(0.7)
  cooldownMs           Int      @default(5000) // sleep forzato in ms
  tighteningPct        Float    @default(0.15) // riduzione soglia di accettazione
  updatedAt            DateTime @updatedAt
}
```

### Stato pre-audit

Il modulo è stato parzialmente auditato nel ciclo Learn Domain (`docs/LEARN-DOMAIN-FASE1-AUDIT.md`) con fix già applicati:
- ✅ N2: `update_threshold` richiede `requireAdmin` (era `requireAuth`)
- ✅ N6: `cycleCounter` module-level rimosso, sostituito con DB-backed count
- ✅ N10: adaptive polling con Page Visibility API in phase11.tsx
- ✅ 8 test in `tests/unit/affect-steering.test.ts` (Affect→Steering loop via `decideStrategy` in acts.ts)
- ✅ 4 test smoke in `tests/unit/learn-domain-core.test.ts` (computeAffect + stats)

Questo audit si concentra su **bug residui e gap non coperti**.

---

## 2. Criticità (Critical)

### 🔴 C1 — `computeAffect` non è integrato nell'executor (cosmetico a runtime)

**File**: `src/lib/runtime/executor.ts`

Come C1 degli altri moduli: `computeAffect` è esposto via API ma **non chiamato dal runtime**. L'executor non chiama mai `computeAffect` dopo ogni task, quindi:
- Le metriche desperation/frustration non sono mai calcolate a runtime
- Il Meta-Observer (intervention HALT/COOLDOWN/TIGHTEN) non interviene mai automaticamente
- Il feedback loop Affect→Steering (documentato in ARCHITECTURE.md) è **cosmetico** — funziona solo nei test `affect-steering.test.ts` che chiamano `decideStrategy` direttamente con frustration/desperation simulati

**Impatto**: i "death spirals" (cicli di fallimento infiniti) e il "reward hacking" non sono mitigati a runtime. L'agente può entrare in loop di errori senza che il Meta-Observer intervenga con cooldown/tightening.

### 🔴 C2 — `cycleId` N6 fix ha race condition (collisioni multi-istanza)

**File**: `src/lib/kernel/affect-subsystem.ts:55-57`

```ts
// N6 FIX: DB-backed cycleId instead of module-level counter
const sampleCount = await db.affectSample.count()
const cycleId = Math.floor(Date.now() / 1000) % 100000 * 1000 + (sampleCount % 1000)
```

Il fix N6 ha rimosso il module-level counter (che collideva tra istanze serverless) ma ha introdotto una **race condition**: 2 chiamate `computeAffect` simultanee leggono entrambe `sampleCount = N` prima che l'altra persista → entrambe ottengono lo stesso `cycleId = ts + N`. 

**Verifica sperimentale** (eseguita durante audit):
```
Call A reads sampleCount=N → cycleId = ts+N
Call B reads sampleCount=N → cycleId = ts+N  ← COLLISION
```

Il cycleId dovrebbe essere univoco per sample. Con la formula attuale, 2 chiamate simultanee producono lo stesso cycleId.

### 🔴 C3 — `intervention` string è persistita senza size cap

**File**: `src/lib/kernel/affect-subsystem.ts:91-102`

```ts
await db.affectSample.create({
  data: {
    agentId: input.agentId,
    desperation,
    frustration,
    toolFailureRate,
    gateRejectRate,
    repeatedToolCalls: input.repeatedToolCalls,
    intervention,  // C3: string persistita senza size cap
    cycleId,
  },
})
```

`intervention` è costruita da `decideIntervention` che concatena fino a 5 interventi con valori float formattati. In condizioni normali è ~200 char, ma se `threshold.tighteningPct` o `frustration.toFixed(2)` producono valori inaspettati, la stringa può crescere. Come C3 degli altri moduli: size cap difensivo su payload persistito.

---

## 3. Bug (Medium)

### 🟠 B1 — `phase11.tsx` `refresh()` senza try/catch su fetch

**File**: `src/components/agentic/phase11.tsx:36-43`

```ts
const refresh = async () => {
  const [histR, statsR] = await Promise.all([
    fetch(`/api/affect?action=history&agentId=${agentId}`).then((r) => r.json()),
    fetch('/api/affect?action=stats').then((r) => r.json()),
  ])
  setHistory(histR.history || [])
  setStats(statsR)
}
```

Come B2 degli altri moduli (phase10.tsx Fase B fix): un fetch fallito (network error, server 500, body non JSON) fa throw unhandled rejection, rompe il polling `setInterval` e lascia la UI in stato stale.

### 🟠 B2 — `phase11.tsx` `compute()` senza error handling

**File**: `src/components/agentic/phase11.tsx:55-74`

```ts
const compute = async () => {
  const r = await fetch('/api/affect', { ... })
  const d = await r.json()  // B2: può throware se risposta non JSON
  if (d.ok) {
    if (d.intervention) { toast.warning(...) }
    else { toast.success(...) }
    refresh()
  }
  // B2: no else for !d.ok → errore silente se API ritorna {ok: false}
}
```

- `r.json()` può throware se risposta non JSON (500 con body HTML)
- Nessun `toast.error` se `d.ok === false` (errore silente)
- Nessun try/catch esterno per network error

### 🟠 B3 — `affectStats` fa query sequenziali dopo Promise.all

**File**: `src/lib/kernel/affect-subsystem.ts:187-211`

```ts
export async function affectStats() {
  const [samples, agents, interventions] = await Promise.all([...])  // 3 query parallel
  const recent = await db.affectSample.findMany({  // sequenziale dopo Promise.all
    orderBy: { timestamp: 'desc' },
    take: 100,
    select: { desperation: true, frustration: true },
  })
  // ...
}
```

Come B1 del modulo Delegation HITL: 4 query totali (3 in Promise.all + 1 sequenziale) invece di 4 in un unico Promise.all. Inoltre, `recent` carica 100 samples per calcolare `avgDesperation`/`avgFrustration` — una `aggregate` SQL sarebbe più efficiente di caricare 100 righe in memoria.

### 🟠 B4 — `decideIntervention` non usa `cooldownMs` e `tighteningPct` dal threshold

**File**: `src/lib/kernel/affect-subsystem.ts:118-141`

```ts
function decideIntervention(
  desperation: number,
  frustration: number,
  threshold: { desperationCritical: number; frustrationCritical: number; cooldownMs: number; tighteningPct: number }
): string {
  // ...
  interventions.push(`TIGHTEN_ACCEPTANCE_THRESHOLD:-${(threshold.tighteningPct * 100).toFixed(0)}%`)
  interventions.push(`COOLDOWN:${threshold.cooldownMs}ms`)
  // ...
}
```

L'intervento è solo una **stringa descrittiva** (`TIGHTEN_ACCEPTANCE_THRESHOLD:-15%`, `COOLDOWN:5000ms`, `HALT:dual_critical_state`). Non c'è **nessun consumer** di questa stringa: l'executor non la legge per stringere effettivamente le soglie, non applica il cooldown, non inietta caution prompt. L'intervento è **puramente cosmetico** anche se C1 fosse risolto.

### 🟠 B5 — `updateThreshold` non valida range dei valori

**File**: `src/lib/kernel/affect-subsystem.ts:162-171`

```ts
export async function updateThreshold(
  agentId: string,
  updates: { desperationCritical?: number; frustrationCritical?: number; cooldownMs?: number; tighteningPct?: number }
) {
  return db.affectThreshold.upsert({
    where: { agentId },
    create: { agentId, ...updates },
    update: updates,
  })
}
```

Nessuna validazione:
- `desperationCritical` può essere > 1.0 (invalido, fuori dal range 0..1)
- `frustrationCritical` può essere negativo
- `cooldownMs` può essere 0 o negativo (loop infinito)
- `tighteningPct` può essere > 1.0 (100%+ tightening non ha senso)

La route `/api/affect/route.ts` filtra per tipo (`typeof === 'number'`) ma non per range.

### 🟠 B6 — `affectStats` `recent` aggregation inefficiente

**File**: `src/lib/kernel/affect-subsystem.ts:193-203`

```ts
const recent = await db.affectSample.findMany({
  orderBy: { timestamp: 'desc' },
  take: 100,
  select: { desperation: true, frustration: true },
})
const avgDesperation = recent.length
  ? recent.reduce((s, r) => s + r.desperation, 0) / recent.length
  : 0
```

Carica 100 righe dal DB e calcola la media in JS. Con Prisma `aggregate` sarebbe una singola query SQL:
```ts
const result = await db.affectSample.aggregate({
  _avg: { desperation: true, frustration: true },
  where: { ...filtro ultimi 100 },
})
```
Questo richiede però un filtro su "ultimi 100 per timestamp" che Prisma non supporta nativamente in aggregate (serve subquery). Alternativa: `findMany` con `take: 100` è accettabile se i samples sono pochi, ma in produzione con migliaia di samples al giorno diventa un bottleneck.

---

## 4. Gap funzionali

### 🟡 G1 — Zero unit test specifici per `decideIntervention` e `getOrCreateThreshold`

I 8 test in `affect-steering.test.ts` testano `decideStrategy` (in acts.ts), non le funzioni interne di affect-subsystem. I 4 test smoke in `learn-domain-core.test.ts` testano `computeAffect` end-to-end ma non:
- `decideIntervention` in isolamento (interventi per desperation-only, frustration-only, dual critical, HALT)
- `getOrCreateThreshold` default values (0.7, 0.7, 5000, 0.15) e riuso
- `updateThreshold` upsert (create + update + partial)
- `affectStats` accuracy (avgDesperation, avgFrustration calcolati correttamente)
- `affectHistory` ordinamento e limit

### 🟡 G2 — `phase11.tsx` nessun a11y (aria-label, role=status)

**File**: `src/components/agentic/phase11.tsx`

209 LOC senza `aria-*` o `role`. I button "Aggiorna", "Calcola Metriche Affettive" non hanno `aria-label`. La stats grid non ha `role=status` + `aria-live=polite`. Come G2 degli altri moduli.

### 🟡 G3 — `phase11.tsx` `compute` non ha parse-safe su `r.json()`

**File**: `src/components/agentic/phase11.tsx:65`

Come G3 del modulo Model Encapsulator Fase C: `r.json()` può throware se risposta non JSON. Parse-safe con `try/catch` interno + fallback a `r.text()` per logging.

### 🟡 G4 — `affectStats` manca metriche utili (intervention rate, last intervention, peak values)

**File**: `src/lib/kernel/affect-subsystem.ts:204-211`

```ts
return {
  samples,
  agents: agents.length,
  interventions,
  avgDesperation,
  avgFrustration,
}
```

Mancano:
- `interventionRate` (interventions / samples, % di cicli con intervento)
- `peakDesperation` / `peakFrustration` (max storico, per capire gravità)
- `lastIntervention` (timestamp + intervention dell'ultimo intervento, per UI)
- `agentsInCriticalState` (count di agenti con desperation/frustration > critical nella loro ultima sample)

La UI phase11.tsx mostra solo 4 stat card (samples/agents/interventions/avgDesperation), ma senza `interventionRate` e `agentsInCriticalState` non si vede la proporzione di cicli problematici.

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3)

1. **C1**: Integrare `computeAffect` nell'executor (post-task, prima del reflection). Non bloccante (fail-open). Se `intervention` è settato, emette evento WS per UI + logga audit.
2. **C2**: Fix race condition cycleId — usa `Date.now() % 100000 * 1000 + Math.floor(Math.random() * 1000)` (random invece di sampleCount) oppure timestamp millisecondi (no collision entro stessa ms).
3. **C3**: Size cap su `intervention` string (1KB) con marker `[truncated]`.

### Fase B — Robustezza (B1, B2, B3, B5, B6)

1. **B1**: `phase11.tsx` `refresh()` con try/catch + toast.error + preserva stato
2. **B2**: `phase11.tsx` `compute()` con parse-safe `r.json()` + toast.error su `!d.ok` + catch esterno network error
3. **B3**: `affectStats` — `recent` aggregation in Promise.all con le altre 3 query (1 round-trip DB)
4. **B5**: `updateThreshold` valida range (0..1 per critical/pct, > 0 per cooldownMs)
5. **B6**: `affectStats` — usa `aggregate` Prisma se possibile, altrimenti mantieni `findMany` ma con `take: 100` documentato come "best-effort avg"

### Fase C — UX & completamento (G1, G2, G3, G4)

1. **G1**: Unit test per `decideIntervention` (4 scenari: desperation-only, frustration-only, dual critical, no intervention), `getOrCreateThreshold` (defaults + riuso), `updateThreshold` (upsert), `affectStats` (accuracy), `affectHistory` (ordinamento)
2. **G2**: a11y in `phase11.tsx` (aria-label su button, role=status su stats grid)
3. **G3**: `phase11.tsx` `compute` parse-safe (assorbito in B2 se Fase B viene fatta)
4. **G4**: `affectStats` con 3 metriche aggiuntive (interventionRate, peakDesperation/peakFrustration, agentsInCriticalState) + UI phase11.tsx con stat card aggiuntive

**Nota**: B4 (`decideIntervention` cosmetico) è **assorbito in C1** — se C1 integra `computeAffect` nell'executor, l'intervention stringa deve essere consumata (almeno loggata + WS event). L'effettivo tightening/cooldown richiede modifiche più profonde all'executor (steering injection, sleep mechanism) che esulano dallo scope di questo audit.

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 3 (1 core + 1 API + 1 UI) |
| LOC totali | ~515 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 12 (8 affect-steering + 4 learn-domain-core smoke) |
| Consumer runtime | 0 (modulo cosmetico) |
| Fix preesistenti | N2 (requireAdmin), N6 (DB-backed cycleId — con race condition C2), N10 (adaptive polling) |
| Stima Fase A | 1 giornata |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3) — sicurezza & effettività. **Critica**.
   - C1: computeAffect integrato in executor (affect monitor non più cosmetico)
   - C2: cycleId race condition fix (no collisioni multi-istanza)
   - C3: intervention size cap (no DB bloat)
2. **Fase B** (B1+B2+B3+B5+B6) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: computeAffect integrato in executor (death spirals prevention non più cosmetica)
- C2: cycleId race condition fix (no collisioni tra computeAffect simultanee)
- C3: intervention size cap (no DB bloat su stringhe di intervento lunghe)

Tempo stimato: 1 giornata.
