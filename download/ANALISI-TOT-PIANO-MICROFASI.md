# SOTA Agentic OS — Analisi ToT e Piano Micro-Fasi

> **Versione:** 1.0 · **Data:** 2026-06-24
> **Metodo:** Tree-of-Thought (ToT) reasoning
> **Stato app:** Post-redesign (13 sprint completati: 6 architetturali + 7 redesign premium)

---

## Indice

1. [Metodologia ToT](#1-metodologia-tot)
2. [Albero di analisi — 5 rami](#2-albero-di-analisi--5-rami)
3. [Ramo A: Funzionalità e Completezza](#ramo-a-funzionalit%C3%A0-e-completezza)
4. [Ramo B: Sicurezza e Robustezza](#ramo-b-sicurezza-e-robustezza)
5. [Ramo C: Qualità del Codice](#ramo-c-qualit%C3%A0-del-codice)
6. [Ramo D: Performance e Scalabilità](#ramo-d-performance-e-scalabilit%C3%A0)
7. [Ramo E: UX e Consistenza Visiva](#ramo-e-ux-e-consistenza-visiva)
8. [Matrice di criticità](#3-matrice-di-criticit%C3%A0)
9. [Piano in micro-fasi](#4-piano-in-micro-fasi)
10. [Riepilogo esecutivo](#5-riepilogo-esecutivo)

---

## 1. Metodologia ToT

Il ragionamento Tree-of-Thought decompone l'analisi in **5 rami indipendenti**, ciascuno valutato su 3 livelli di profondità:

```
                    ┌── A. Funzionalità ──→ Completezza / Stub / Gap
                    │
                    ├── B. Sicurezza ──→ Auth / Validation / Attack surface
ToT Root ──────────┤
                    ├── C. Qualità Codice ──→ TS errors / Typing / Tests
                    │
                    ├── D. Performance ──→ Polling / Bundle / N+1 / WS
                    │
                    └── E. UX/Visiva ──→ Colori residui / Empty states / Mobile
```

Per ogni ramo:
1. **Osservazione oggettiva** (dati dall'audit)
2. **Valutazione criticità** (critical / high / medium / low)
3. **Raccomandazione** (azione specifica)

---

## 2. Albero di analisi — 5 rami

### Ramo A: Funzionalità e Completezza

#### A1. Kernel modules — stato implementazione

| Categoria | Moduli | Stato | Criticità |
|-----------|--------|-------|-----------|
| **Completamente implementati** | ltl-monitor, normative, taint, erl, patchboard, acts, scheduler, context-engineering | ✅ Logica completa, testati (5/8) | Low |
| **Implementati con stub LLM** | grounded-inference, time-router, sovereign-translator, agent-objective, lean4-agent | ⚠️ Logica base OK, ma LLM call è simulata | **High** |
| **Implementati con stub semantico** | dominator-tree (semantic match stub) | ⚠️ Stub deterministico | Medium |
| **Simulati parzialmente** | curator (simula queue/threads), tool-registry (signature simulata) | ⚠️ Funziona ma non realistico | Medium |
| **Completi senza DB** | affect-subsystem, cost-ledger, crypto-trust, esr-quorum, ns-mem, observability, scalability, compiled-ai, artificial-retainer | ✅ Logica completa | Low |

**Verdetto A1:** 5 moduli hanno stub LLM che vanno sostituiti con chiamate ZAI reali per funzionare in produzione. 2 moduli hanno simulazioni non realistiche.

#### A2. API routes — stato implementazione

- **37 route handlers** totali
- **34/37 non hanno auth check** (solo `/auth`, `/health`, `/mcp` sono whitelistate dal middleware, ma le route stesse non verificano la sessione)
- Il middleware blocca accessi senza cookie a livello di path, ma le API stesse sono "trust the cookie" senza verifica del token
- `category-kpis.tsx` ancora presente ma non importato (orphan)
- `branding-showcase.tsx` ancora presente ma non importato (orphan, 5.7KB dead code)

**Verdetto A2:** Il middleware è il unico gate di sicurezza. Se bypassato (es. da un altro servizio interno), tutte le API sono esposte.

#### A3. Fasi architetturali — maturità

| Fase | Componente UI | API | Kernel | Stato |
|------|---------------|-----|--------|-------|
| F1 Memory & State | ✅ Phase1 (442 LOC) | ✅ /memory, /patchboard | ✅ ns-mem, patchboard | Funziona |
| F2 Planner | ✅ Phase2 (370 LOC) | ✅ /plan, /compiled | ✅ scheduler, compiled-ai | Funziona con LLM |
| F3 Steering | ✅ Phase3 (273 LOC) | ✅ /steering | ✅ acts | Funziona |
| F4 Verify & Taint | ✅ Phase4 (446 LOC) | ✅ /verify | ✅ ltl-monitor, taint, normative | Funziona |
| F5 Reflective | ✅ Phase5 (330 LOC) | ✅ /reflect | ✅ erl | Funziona con LLM |
| F6 Context | ✅ Phase6 (339 LOC) | ✅ /context | ✅ context-engineering | Funziona |
| F7 Trace | ✅ Phase7 (382 LOC) | ✅ /traces, /dominator | ⚠️ dominator-tree (stub) | Parziale |
| F8 Lean4 | ✅ Phase8 (432 LOC) | ✅ /lean | ⚠️ lean4-agent (stub LLM) | Parziale |
| F9 Retainer | ✅ Phase9 (539 LOC) | ✅ /retainer | ✅ artificial-retainer | Funziona |
| F10 Encapsulator | ✅ Phase10 (174 LOC) | ✅ /console | ✅ compiled-ai | Funziona |
| F11 Affect | ✅ Phase11 (202 LOC) | ✅ /affect | ✅ affect-subsystem | Funziona |
| F12 Objective | ✅ Phase12 (245 LOC) | ✅ /objective | ⚠️ agent-objective (stub) | Parziale |
| F13 Swarm | ✅ Phase13 (368 LOC) | ✅ /esr | ✅ esr-quorum | Funziona |
| F14 Router | ✅ Phase14 (238 LOC) | ✅ /router | ⚠️ time-router (stub LLM) | Parziale |
| MCP | ✅ ToolManager | ✅ /mcp, /mcp-client | ✅ mcp-client, skill-manager | Funziona |
| Cost | ✅ CostModal | ✅ /cost | ✅ cost-ledger | Funziona |
| Console | ✅ AgentConsole | ✅ /console/stream | ✅ use-console-stream | Funziona con LLM |

**Verdetto A3:** 12/17 aree funzionali complete, 5 parziali (stub LLM da sostituire).

---

### Ramo B: Sicurezza e Robustezza

#### B1. Autenticazione API

- Middleware (`src/middleware.ts`) blocca path privati senza cookie → ✅
- Ma **34/37 API route non verificano il token internamente** → ⚠️ High
- Se il middleware viene bypassato (reverse proxy misconfigured, internal network), tutte le API sono esposte
- Soluzione: ogni API route dovrebbe chiamare `verifySession(token)` e estrarre `tenantId`

#### B2. Input validation

- **Spot validation**: poche route validano input (es. `/api/auth` controlla email/password, `/api/console` controlla task non vuoto)
- **Nessuna validazione sistematica**: niente Zod schema, niente express-validator, niente class-validator
- Le route accettano qualsiasi JSON body e fanno destructuring senza validare tipi
- Risk: crash runtime su input malformato, SQL injection (mitigato da Prisma parameterized queries)

#### B3. Rate limiting

- `src/lib/rate-limit.ts` esiste ma è usato solo in poche route
- Nessun rate limiting sistematico su route sensibili (/console/stream, /api/auth login)
- Risk: brute force login, DoS su LLM streaming

#### B4. TypeScript errors che causano runtime crash

| File | Errore | Severity |
|------|--------|----------|
| `api/console/route.ts:318` | `string | undefined` non assegnabile a `string` | **Critical** — crash su error path |
| `api/console/route.ts:323` | `ErrorDetail | undefined` non assegnabile a `ErrorDetail` | **Critical** — crash su error path |
| `category-kpis.tsx:101` | Operatore `>` su `string | number` | Medium — file orphan, non usato |
| `phase1.tsx:90` | Proprietà duplicata in object literal | Medium — possibile bug logico |
| `sidebar.tsx:122` | `currentIcon` non esiste su JSX.IntrinsicElements | Low — file legacy residuo |
| `skeletons.tsx:29` | `style` non accettato dal componente | Low — skeleton visivo |
| `embeddings.ts:88` | Proprietà duplicata | Medium — possibile bug |
| `dominator-tree.ts:198,218` | Overload non matcha | Medium — tipi Prisma |
| `grounded-inference.ts:113` | `string | null` non assegnabile a `string | undefined` | Low |
| `scalability.ts:372` | Proprietà `ruleId_state` non esiste | Medium — schema mismatch |
| `tool-registry.ts:190` | Argomento non assegnabile a `never` | Medium — tipo Prisma |

**Verdetto B4:** 2 errori critical in `/api/console/route.ts` che possono causare crash runtime quando un task fallisce.

---

### Ramo C: Qualità del Codice

#### C1. Test coverage

| Metrica | Valore | Target | Gap |
|---------|--------|--------|-----|
| File di test | 6 | 25+ | -19 |
| Test totali | 119 | 300+ | -181 |
| Kernel modules testati | 5/25 (20%) | 80% | -60% |
| Componenti testati | 0 | 50+ | -50 |
| API integration test | 0 | 37 | -37 |
| Coverage tool | non configurato | 80% | -80% |

**Moduli kernel senza test (priorità per LOC):**
1. `scalability.ts` (481 LOC)
2. `observability.ts` (474 LOC)
3. `artificial-retainer.ts` (423 LOC)
4. `dominator-tree.ts` (402 LOC)
5. `lean4-agent.ts` (380 LOC)
6. `time-router.ts` (278 LOC)
7. `crypto-trust.ts` (274 LOC)
8. `esr-quorum.ts` (288 LOC)

#### C2. Loose typing

- **27 occorrenze `any`** in kernel modules
- `ltl-monitor.ts` ha 13 `as any` (AST traversal non tipizzata)
- `catch (e: any)` pattern diffuso
- Soluzione: tipizzare AST nodes con union types, usare `unknown` per catch

#### C3. Dead code

| File | Size | Stato |
|------|------|-------|
| `branding-showcase.tsx` | 5.7KB | Orphan, mai importato |
| `category-kpis.tsx` | 3.5KB | Sostituito da StatCardGrid, ancora presente |
| `dev.log` | variabile | Generato dal vecchio script `tee`, non più necessario |

---

### Ramo D: Performance e Scalabilità

#### D1. Polling

- **6 setInterval attivi** in componenti (ridotto da 6 sprint fa, ma ancora presenti)
- `data-store.ts` ha `startGlobalRefresh` con intervallo 5s per dashboard/blocked/affect + 30s per cost
- SovereignView ha polling 10s dedicato (duplica il data-store)
- Cockpit ha polling 5s per affect (duplica il data-store)
- Console WS ha reconnect logic ma non testato sotto disconnect prolungato

#### D2. Bundle size

- **18 componenti lazy-loaded** via `next/dynamic` (domini + fasi legacy + ToolManager + Overview)
- AgentConsole, Cockpit, CanvasView, TimelineView, SovereignView caricati eagerly
- `@xenova/transformers` (embeddings) è pesante (~2MB) ma caricato dinamicamente
- Nessun bundle analyzer configurato

#### D3. N+1 queries

- Dashboard API (`/api/dashboard`) fa ~15 query Prisma separate (una per fase) — non ottimizzato ma accettabile per SQLite
- Cockpit API fa 5 fetch separate (una per tab) — caricamento a cascata
- Soluzione: batch queries con `Promise.all` o Prisma `include`

#### D4. WebSocket

- Sensorium WS (`use-sensorium-live.ts`) gestisce reconnect con exponential backoff
- Buffer eventi limitato a 50 (evita memory leak)
- Ma niente heartbeat/ping → dead connections non rilevate

---

### Ramo E: UX e Consistenza Visiva

#### E1. Colori hardcoded residui

- **299 occorrenze** di classi Tailwind hardcoded (`emerald-`, `amber-`, `red-`, `sky-`, `violet-`, `pink-`, `cyan-`) in componenti
- Hotspot: `phase1.tsx`, `phase4.tsx`, `phase8.tsx`, `phase9.tsx`, `dag-visualizers.tsx`, `sovereign-view.tsx`
- Soluzione: migrare a `status-*` e `cat-*` token nativi

#### E2. Empty states inline residui

- **55 occorrenze** di `text-muted-foreground italic` (pattern empty state inline)
- Non tutti sono empty state — alcuni sono hint text legittimi
- Stimato ~30-35 sono empty state reali che dovrebbero usare `EmptyState` shared

#### E3. Form senza validation

- Tutti i PhaseN.tsx hanno form con `Input` + `Button` ma niente validation client-side
- Niente error display inline
- Niente required field indicators
- `FormField` shared esiste ma non è ancora usato nei PhaseN

#### E4. Mobile responsiveness

- Sidebar desktop-only con MobileNav dropdown
- Context panel: FAB + sheet su mobile
- Topbar: StatusBar nascosta su mobile, titolo visibile
- Tabelle/liste: overflow-x-auto su mobile
- Non testato su device reali

---

## 3. Matrice di criticità

| ID | Problema | Ramo | Severity | Sforzo | Impatto |
|----|----------|------|----------|--------|---------|
| C1 | TS error `api/console/route.ts:318,323` | B | **Critical** | 1h | Crash su error path |
| C2 | 34/37 API senza auth interna | B | **Critical** | 8h | Security hole |
| C3 | 5 kernel modules con stub LLM | A | **High** | 16h | Funzionalità core non reale |
| C4 | Test coverage 20% kernel | C | **High** | 24h+ | Regression risk |
| C5 | Input validation spot | B | **High** | 8h | Crash/bug risk |
| C6 | 299 colori hardcoded | E | **Medium** | 8h | Inconsistenza visiva |
| C7 | 55 empty state inline | E | **Medium** | 4h | UX inconsistente |
| C8 | Dead code (3 file) | C | **Medium** | 0.5h | Manutenibilità |
| C9 | 27 `any` in kernel | C | **Medium** | 4h | Type safety |
| C10 | Polling duplicato (sovereign/cockpit) | D | **Medium** | 2h | Performance |
| C11 | Form senza validation | E | **Low** | 8h | UX |
| C12 | N+1 queries dashboard | D | **Low** | 4h | Performance (SQLite OK) |
| C13 | WS senza heartbeat | D | **Low** | 2h | Reliability |
| C14 | No bundle analyzer | D | **Low** | 1h | Visibility |

---

## 4. Piano in micro-fasi

**Principio:** ogni micro-fase è **indipendente**, **verificabile** (build + test + lint), e **completa in sé** (non lascia codice rotto).

### Fase Alpha — Stabilizzazione Critica (3 micro-fasi, ~10h)

#### α1 — Fix TypeScript error critical (1h)
- Fix `api/console/route.ts:318,323` (2 errori che causano crash su error path)
- Fix `category-kpis.tsx:101` (eliminare file orphan)
- Fix `phase1.tsx:90` (proprietà duplicata)
- Fix `embeddings.ts:88` (proprietà duplicata)
- **Output:** 0 errori TypeScript critici, build pulito

#### α2 — Eliminazione dead code (0.5h)
- Eliminare `branding-showcase.tsx` (orphan)
- Eliminare `category-kpis.tsx` (sostituito)
- Eliminare `dev.log` (non più generato)
- **Output:** 0 file orfani

#### α3 — Auth interna API routes (8h)
- Creare `src/lib/auth/require-auth.ts` helper: verifica cookie → estrae tenantId → ritorna user o 401
- Applicare a tutte le 34 API route senza auth
- Pattern: `const { userId, tenantId } = await requireAuth(req)`
- **Output:** 34 route protette, 0 route senza auth

### Fase Beta — Funzionalità Reale (4 micro-fasi, ~20h)

#### β1 — Sostituire stub LLM in grounded-inference (3h)
- `grounded-inference.ts:66,68` — sostituire `simulateLLMOutput` con `zai.chat.completions.create`
- Gestione errori + timeout + fallback
- Test: verificare che la chiamata LLM restituisca output reale
- **Output:** F10 funziona con LLM reale

#### β2 — Sostituire stub LLM in time-router (3h)
- `time-router.ts:174-175,206-209` — sostituire `simulateModelOutput` con chiamata ZAI
- Test: verificare routing adattivo
- **Output:** F14 funziona con LLM reale

#### β3 — Sostituire stub in agent-objective (4h)
- `agent-objective.ts:40,136` — sostituire generazione albero simulata con LLM
- Test: verificare decomposizione obiettivo
- **Output:** F12 funziona con LLM reale

#### β4 — Sostituire stub in lean4-agent + dominator-tree (6h)
- `lean4-agent.ts:276` — sostituire instruction generation stub
- `dominator-tree.ts:339,350` — implementare semantic match (anche semplice: cosine similarity su embeddings)
- Test: verificare generazione contratti
- **Output:** F7 + F8 funzionano

### Fase Gamma — Qualità e Sicurezza (4 micro-fasi, ~16h)

#### γ1 — Input validation sistematica (6h)
- Installare Zod
- Creare schema per ogni API route body
- Pattern: `const schema = z.object({ ... }); const parsed = schema.parse(body)`
- Applicare alle 37 route (priorità: /console, /auth, /plan, /skills, /mcp-client)
- **Output:** 0 route senza validazione

#### γ2 — Test kernel modules — batch 1 (4h)
- Scrivere test per: `scalability.ts`, `observability.ts`, `artificial-retainer.ts`
- Target: +30 test
- **Output:** 8/25 kernel testati (32%)

#### γ3 — Test kernel modules — batch 2 (4h)
- Scrivere test per: `dominator-tree.ts`, `lean4-agent.ts`, `time-router.ts`, `crypto-trust.ts`, `esr-quorum.ts`
- Target: +40 test
- **Output:** 13/25 kernel testati (52%)

#### γ4 — Fix `any` typing in ltl-monitor (2h)
- Sostituire 13 `as any` con tipi AST union
- Creare `type ASTNode = FormulaNode | OperatorNode | ...`
- **Output:** 0 `any` in ltl-monitor

### Fase Delta — Consistenza Visiva (3 micro-fasi, ~10h)

#### δ1 — Migrare colori hardcoded a token (4h)
- Sostituire `emerald-*` → `status-ok`, `amber-*` → `status-warn`, `red-*` → `status-danger`, `sky-*` → `status-info`
- Hotspot: phase1, phase4, phase8, phase9, dag-visualizers, sovereign-view
- **Output:** 0 colori hardcoded status

#### δ2 — Consolidare empty states (3h)
- Identificare i ~30 empty state inline reali (vs hint text)
- Sostituire con `EmptyState` shared + icon + CTA
- **Output:** 0 empty state inline

#### δ3 — Applicare FormField nei PhaseN (3h)
- Sostituire Label + Input + error sparso con `FormField` shared
- Applicare a phase1, phase4, phase8, phase9
- **Output:** 4 phase con form standardizzati

### Fase Epsilon — Performance e Polish (3 micro-fasi, ~6h)

#### ε1 — Eliminare polling duplicato (2h)
- SovereignView: usare `useDataStore.fetchBlocked` invece di polling 10s dedicato
- Cockpit: usare `useDataStore.fetchAffect` invece di polling 5s dedicato
- **Output:** 2 setInterval eliminati

#### ε2 — WebSocket heartbeat (2h)
- Aggiungere ping/pong every 30s in `use-sensorium-live.ts`
- Rilevare dead connections e triggerare reconnect
- **Output:** WS reliability migliorata

#### ε3 — Bundle analyzer + audit (2h)
- Installare `@next/bundle-analyzer`
- Analizzare bundle, identificare heavy imports
- Ottimizzare se necessario
- **Output:** Lighthouse Performance ≥80

---

## 5. Riepilogo esecutivo

### Stato attuale: **70% production-ready**

| Dimensione | Score | Note |
|------------|-------|------|
| Funzionalità | 75% | 12/17 aree complete, 5 con stub LLM |
| Sicurezza | 40% | Middleware OK, ma API senza auth interna + niente validation |
| Qualità codice | 50% | 20% test coverage, 14 TS errors, 27 `any` |
| Performance | 70% | Polling ottimizzato, lazy loading, ma duplicati residui |
| UX/Visiva | 85% | Redesign premium completato, ma 299 colori hardcoded residui |

### Piano: 5 fasi, 17 micro-fasi, ~62h totali

| Fase | Micro-fasi | Ore | Priorità |
|------|-----------|-----|----------|
| **Alpha** — Stabilizzazione | 3 | 10h | Immediata |
| **Beta** — Funzionalità reale | 4 | 20h | Alta |
| **Gamma** — Qualità e sicurezza | 4 | 16h | Alta |
| **Delta** — Consistenza visiva | 3 | 10h | Media |
| **Epsilon** — Performance | 3 | 6h | Bassa |

### Criticità #1: **2 TS error in api/console/route.ts** (crash runtime)
### Criticità #2: **34 API senza auth interna** (security hole)
### Criticità #3: **5 kernel stub LLM** (funzionalità core simulata)

Il piano è strutturato per essere **incrementale e sicuro**: ogni micro-fase lascia il sistema in stato funzionante, verificabile con build + test + lint.
