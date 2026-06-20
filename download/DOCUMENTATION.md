# SOTA Agentic OS — Documentazione Tecnica

> **Versione:** 0.3.0 · **Data:** 2026-06-20 · **Stack:** Next.js 16 + TypeScript + Prisma + Socket.io

Implementazione ingegneristica del blueprint "Sistema Operativo Agentico SOTA" con **9 micro-fasi** operative: stato/memoria persistente, orchestrazione DAG, steering ACTS, verifica formale LTL, riflessione ERL, context engineering, dominator trees, Lean4 formal verification, artificial retainer.

---

## Indice

1. [Stack Tecnologico](#1-stack-tecnologico)
2. [Avvio Rapido](#2-avvio-rapido)
3. [Architettura Generale](#3-architettura-generale)
4. [Le 9 Micro-Fasi](#4-le-9-micro-fasi)
5. [Schema Database](#5-schema-database)
6. [API Reference](#6-api-reference)
7. [Moduli Kernel](#7-moduli-kernel)
8. [Componenti Frontend](#8-componenti-frontend)
9. [Mini-Service WebSocket](#9-mini-service-websocket)
10. [Iterazioni e Cronologia](#10-iterazioni-e-cronologia)
11. [Note per Sviluppo Futuro](#11-note-per-sviluppo-futuro)

---

## 1. Stack Tecnologico

| Componente          | Tecnologia                                  | Note                                              |
|---------------------|---------------------------------------------|---------------------------------------------------|
| Framework           | Next.js 16 (App Router, Turbopack)          | Solo route `/` visibile all'utente                |
| Linguaggio          | TypeScript 5                                | Strict mode                                        |
| Styling             | Tailwind CSS 4 + shadcn/ui (New York)       | Componenti in `src/components/ui/`                |
| Database            | Prisma ORM + SQLite                          | `db/custom.db`                                    |
| State client        | Zustand                                      | `src/lib/store.ts`                                |
| Toast               | sonner                                       | `Toaster` in `src/app/page.tsx`                   |
| LLM                 | z-ai-web-dev-sdk                            | `import ZAI from 'z-ai-web-dev-sdk'` (export default) |
| WebSocket           | socket.io (server + client)                 | Mini-service separato su porte 3003/3004          |
| Embeddings          | TF-IDF semantico locale (256-dim)           | `src/lib/embeddings.ts`                           |
| Runtime             | Bun (dev)                                   | `bun run dev`                                     |

### Porte in uso

| Porta | Servizio                            | Avvio                                  |
|-------|-------------------------------------|----------------------------------------|
| 3000  | Next.js dev server                  | Auto via `.zscripts/dev.sh`            |
| 3003  | Socket.io (browser-facing)          | `cd mini-services/sensorium-ws && bun run dev` |
| 3004  | HTTP publish endpoint (Next → WS)   | Avviato insieme al 3003                |
| 81    | Caddy gateway                       | Auto                                   |

### Variabili d'ambiente (`.env`)

```
DATABASE_URL=file:/home/z/my-project/db/custom.db
```

---

## 2. Avvio Rapido

```bash
# 1. Avvia dev server Next.js (auto-avviato dall'ambiente)
#    Log: /home/z/my-project/dev.log

# 2. Avvia il mini-service WebSocket (per la live feed)
cd /home/z/my-project/mini-services/sensorium-ws
bun run dev
# Verifica: curl http://localhost:3004/health

# 3. Reset DB + seed dati di esempio
cd /home/z/my-project
rm -f db/custom.db
bun run db:push --skip-generate
python3 scripts/seed.py

# 4. Ricalcola embeddings con il modello TF-IDF v2
curl -X POST http://localhost:3000/api/embeddings

# 5. Apri l'app dal Preview Panel e clicca "Inizializza Sistema"
#    (oppure usa il seed Python al punto 3 che è equivalente)
```

### Comandi utili

```bash
bun run lint          # ESLint check (deve essere pulito)
bun run db:push       # Sincronizza schema Prisma con SQLite
bun run db:generate   # Rigenera Prisma Client
```

---

## 3. Architettura Generale

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (client)                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Next.js Page (/)                                         │   │
│  │  ├── Sidebar navigazione 5 fasi                           │   │
│  │  ├── Topbar (metriche live WS)                            │   │
│  │  ├── Overview (dashboard + LiveFeed)                      │   │
│  │  └── Phase1..5 (componenti interattivi)                   │   │
│  │                                                           │   │
│  │  Hooks: useDashboard (polling 5s)                         │   │
│  │         useSensoriumLive (WebSocket)                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            ↕ HTTP (fetch)                        │
│                            ↕ WebSocket (socket.io-client)        │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│  Next.js API Routes (/api/*)                                     │
│  ├── dashboard, sensorium, memory, patchboard                    │
│  ├── plan, compiled, steering, verify, reflect                   │
│  ├── embeddings, seed                                             │
│  └── ws-publish (helper → HTTP POST :3004/publish)               │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│  Kernel Modules (src/lib/kernel/)                                │
│  ├── patchboard.ts   · ns-mem.ts       · curator.ts              │
│  ├── scheduler.ts    · compiled-ai.ts  · acts.ts                 │
│  ├── ltl-monitor.ts  · taint.ts        · normative.ts · erl.ts   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │  SQLite (Prisma)        │  Mini-service WS
                │  20 tabelle             │  (porta 3003/3004)
                │  db/custom.db           │  mini-services/sensorium-ws/
                └─────────────────────────┘
```

### Flusso tipico di un'azione utente

1. User clicca un pulsante nella UI → fetch a `/api/<route>`
2. API route chiama uno o più moduli kernel
3. Kernel legge/scrive su SQLite via Prisma
4. API route pubblica evento WS via `publishAgentEvent()` (best-effort)
5. Browser riceve evento WS via `useSensoriumLive()` e aggiorna UI live
6. API route ritorna risposta HTTP al chiamante

---

## 4. Le 5 Micro-Fasi

### Fase 1 — Stato e Memoria Persistente

**Moduli:** `patchboard.ts`, `ns-mem.ts`, `curator.ts`

- **NS-Mem (3 livelli):**
  - Episodico: osservazioni timestampate con embedding + decay EMA
  - Semantico: entità coerenti con embedding vettoriale, aggiornamento EMA anti-drift
  - Logico: regole procedurali come DAG
- **PatchBoard:** stato globale = albero JSON. Tutte le mutazioni via JSON Patch (RFC 6902 subset) validate da kernel transazionale con scoping permessi (actor × path × op). Snapshot per replay.
- **Sensorium (Curator):** blocco XML compilato ad ogni ciclo cognitivo con stato operativo (queue, threads, load, eventi recenti). Iniettato nel prompt dell'LLM per consapevolezza ambientale a costo 0 token.

### Fase 2 — Orchestrazione e Compiled AI

**Moduli:** `scheduler.ts`, `compiled-ai.ts`

- **DynAMO:** l'LLM è forzato a produrre un piano JSON-Schema-validato. Validazione: schema + aciclicità + riferimenti dipendenze. Conversione in DAG topologico a batch paralleli.
- **Compiled AI:** codice generato dall'LLM dentro template pre-validati. Pipeline 4-stadi:
  1. **Safety** — token vietati (eval, require, fetch, process.exit, template literals)
  2. **Syntax** — parsing con `new Function()` sandbox
  3. **Execution** — smoke test con fixture
  4. **Accuracy** — assertion su risultato atteso
  
  Superati tutti → deployato come artefatto statico con costo inferenza marginale zero.

### Fase 3 — Steering (ACTS)

**Modulo:** `acts.ts`

- Controller ultraleggero decide la strategia successiva tra: `PLAN`, `EXECUTE`, `CHECK`, `REFLECT`, `HALT`
- Logica deterministica rule-based (no LLM qui → O(1) per decisione)
- Flusso: PLAN → EXECUTE → CHECK → (loop o REFLECT)
- HALT attivato da budget < 50 token o 3+ errori consecutivi
- Ogni strategia ha una **steering phrase** testuale iniettata nell'LLM per innescare deterministicamente il comportamento
- Vocabolario di 5 strategie con costo in token predefinito

### Fase 4 — Zero-Trust e Verifica Formale

**Moduli:** `ltl-monitor.ts`, `taint.ts`, `normative.ts`

- **AgentVerify (LTL Monitor):**
  - Parser LTL recursive descent con AST
  - Operatori supportati: `G(p)`, `F(p)`, `X(p)`, `!p`, `p && q`, `p || q`, `p -> q`, `p U q`
  - Compilatore AST → FSM con 7 pattern riconosciuti (G-plain, F, X, U, G→X, G→!b, G→F)
  - FSM persistenti in memoria tra eventi, reset dopo violazione
  - Overhead O(1) per evento
- **Taint Tracking:**
  - Input non fidati etichettati come `TAINTED`
  - 6 sink sensibili bloccanti (`tool_call:exec`, `file_write`, `network`, `db_write`, `deploy`, `delete`)
  - Previene attacchi MitE (Mind-in-the-Environment)
- **Cancello Normativo Stoico:**
  - Gerarchia assiomatica: P1 legale > P2 operativo > P3 efficienza
  - Intent valutato contro assiomi: violazione di priorità ≥ claimedPriority → BLOCK
  - Audit trail completo

### Fase 5 — Riflessione ed Evoluzione

**Modulo:** `erl.ts`

- **ERL (Experiential Reflective Learning):**
  - Dopo ogni operazione: analisi causale → estrazione euristica ("Quando X, devo Y")
  - Euristica memorizzata con embedding vettoriale per RAG futuro
- **AutoSOTA (Red Line System):**
  - Supervisore valuta ogni euristica contro 4 Red Lines non negoziabili
  - Red Lines: non ignorare limiti dataset, non bypassare security, non estrarre da casi anomali, mantieni tracciabilità
  - Controlla anche gli step dell'operazione, non solo l'euristica estratta
- **RAG semantico:** per nuovi task, recupera top-k euristiche rilevanti via cosine similarity

### Fase 6 — Context Engineering & Pruning

**Modulo:** `context-engineering.ts`

Risolve il "context rot": nei task con uso intensivo di tool, l'accumulo di risposte JSON/API distrugge le performance.

- **Ring-buffer:** mantiene solo le ultime N coppie Tool Call/Response nel prompt (default N=5)
- **Summarization asincrona:** quando le entry attive superano la threshold (default 10), il summarizer compatta le entry evicted in un log narrativo
- **Working context riassemblato:** `[Summary più recente] + [ultime N ToolCallEntry]` — quello che il Curator inietta nel prompt
- **Policy configurabile:** per ogni agente, N e threshold personalizzabili, auto-summarize on/off
- **RAG storico:** ricerca semantica nelle narrative dei summary passati

### Fase 7 — Dominator Trees (Validazione Sequenziale)

**Modulo:** `dominator-tree.ts`

Valida esecuzioni di workflow complessi (UI, API, automazione) tollerando il non-determinismo sequenziale.

- **PTA (Prefix Tree Automaton):** fusion di 2-10 tracce positive in un grafo unificato
- **Dominator Extraction:** algoritmo dataflow classico per identificare "stati essenziali" (dominatori) — stati che ogni esecuzione valida deve toccare
- **Dominator coverage:** per nuove tracce, calcola la frazione di dominatori raggiunti
  - coverage ≥ 1.0 + path valido → ACCEPT
  - coverage ≥ 0.7 → WARN (deviazione tollerabile, es. popup di caricamento saltato)
  - coverage < 0.7 → REJECT (deviazione critica, es. skip di uno stato essenziale)
- **Semantic matching:** stub per confronto semantico via LLM in caso di ambiguità

### Fase 8 — Lean4 Formal Verification

**Modulo:** `lean4-agent.ts`

Verifica matematica del codice e dei workflow prima e durante la loro evoluzione.

- **FormalContract:** per ogni nodo del DAG DynAMO, preconditions/postconditions + variableTypes
- **Auto-generazione:** contratti derivati automaticamente dal piano (dipendenze = precondizioni)
- **Verifica simbolica (emulazione Lean4):**
  - Type consistency: tutte le variabili usate hanno un tipo dichiarato
  - Dependency closure: le preconditions di un task devono essere soddisfatte dalle postconditions delle sue dipendenze
  - Postcondition ben formata: almeno una post per task
- **LeanEvolve:** quando un task fallisce:
  1. Recupera feedback formale (errori Lean4 localizzati)
  2. Riscrive l'istruzione del task fallito via LLM (stub deterministico)
  3. Ri-valida il workflow con la nuova istruzione
  4. Persisti evento evolve con cycle counter
- **Pseudo-Lean4 source:** generato per ogni workflow (strutture, predicati, theorem skeleton)

### Fase 9 — Artificial Retainer

**Modulo:** `artificial-retainer.ts`

Cambia il paradigma: da "chat" a "piattaforma di supervisione". Previene l'Agentic Literacy Debt.

- **DelegationContract:** scope di autorità esplicito per ogni agente
  - scope con pattern matching (es. `tool:exec`, `filesystem:/tmp/*`)
  - constraints: maxCalls, maxSpend, timeWindow, reversible
  - expiration + revoca con motivo
  - `checkAuthority(agentId, scope)` per validare a runtime
- **ApprovalGate (HITL):** gates di approvazione umana
  - Scatenati quando l'azione è irreversibile, viola LTL, o supera soglie
  - Status: pending → approved/rejected/expired
  - Auto-expire (default 24h)
- **NormativeResolution (Calcolo Normativo):** risoluzione conflitti prompt utente vs policy
  - Gerarchia: SAFETY (1) > OPERATIONAL (2) > AESTHETIC (3)
  - systemLevel < userLevel → BLOCK
  - systemLevel = userLevel → BLOCK (tie va a safety)
  - systemLevel > userLevel → MODIFY (azione modificata)
  - Axiom Trail auditabile per ogni decisione
- **AuditLedgerEntry:** registro comprensibile all'umano
  - Traduzione narrativa di ogni decisione (deleghe, gates, risoluzioni normative)
  - Flag `reversible` per identificare azioni irreversibili
  - Riferimento al DelegationContract quando applicabile

---

## 5. Schema Database

**File:** `prisma/schema.prisma` · 20 modelli · SQLite

### Fase 1 — Stato & Memoria

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `EpisodicMemory`     | Osservazioni timestampate con embedding + decay    |
| `SemanticEntity`     | Entità coerenti (vector DB simulato)               |
| `LogicalRule`        | Regole procedurali come nodi DAG                   |
| `PatchTransaction`   | Log audit di ogni JSON Patch (accepted/rejected)   |
| `GlobalState`        | Albero JSON condiviso (key-value)                  |
| `SensoriumSnapshot`  | Snapshot dei cicli cognitivi compilati             |

### Fase 2 — Orchestrazione

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `AgentPlan`          | Piani JSON-Schema-validati                         |
| `PlanTask`           | Task appartenenti a un piano (con dipendenze)      |
| `CompiledArtifact`   | Artefatti generati con esito 4-stadi               |
| `CompiledTemplate`   | Template pre-validati per Compiled AI              |

### Fase 3 — Steering

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `SteeringEvent`      | Log di ogni decisione del Controller ACTS          |
| `SteeringStrategy`   | Vocabolario di 5 strategie con budget cost         |

### Fase 4 — Verifica

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `LTLRule`            | Regole LTL attive (formula + severity)             |
| `VerificationEvent`  | Eventi valutati con verdict (accept/warn/reject)   |
| `TaintRecord`        | Input tainted con flow trace                       |
| `NormativeRule`      | Assiomi normativi con priorità 1-3                 |

### Fase 5 — Riflessione

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `Heuristic`          | Euristiche estratte con embedding + success rate   |
| `RedLine`            | Linee rosse non negoziabili (AutoSOTA)             |
| `ReflectionLog`      | Log di ogni riflessione con esito                  |

### Cross-cutting

| Modello    | Descrizione                                  |
|------------|----------------------------------------------|
| `AgentLog` | Audit trail globale di tutti gli agenti      |

### Fase 6 — Context Engineering

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `ToolCallEntry`      | Coppie Tool Call/Response nel ring buffer          |
| `ContextSummary`     | Riassunti narrativi generati dalla summarization   |
| `PruningPolicy`      | Policy per agente (windowSize, threshold, auto)    |

### Fase 7 — Dominator Trees

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `ExecutionTrace`     | Tracce di esecuzione catturate per training PTA    |
| `PrefixTreeAutomaton`| PTA fuso + dominatori per workflow                 |
| `TraceValidation`    | Validazioni di tracce con verdict e coverage       |

### Fase 8 — Lean4 Formal Verification

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `FormalContract`     | Contratti formali (pre/post conditions) per task   |
| `LeanEvolveEvent`    | Eventi di evoluzione con riscritura e ri-valida    |
| `VerifiedWorkflow`   | Snapshot di workflow verificati con sorgente Lean4 |

### Fase 9 — Artificial Retainer

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `DelegationContract` | Permessi concessi agli agenti (scope + constraints)|
| `ApprovalGate`       | Gates HITL pending/approved/rejected               |
| `NormativeResolution`| Risoluzioni conflitti prompt utente vs policy      |
| `AuditLedgerEntry`   | Voci del registro di delega comprensibili all'umano|

### Modifica schema

```bash
# Dopo aver editato prisma/schema.prisma:
bun run db:push

# Se il DB è corrotto o si vuole ripartire da zero:
rm -f db/custom.db
bun run db:push --skip-generate
python3 scripts/seed.py
curl -X POST http://localhost:3000/api/embeddings  # ricalcola embeddings
```

---

## 6. API Reference

Tutte le route sono in `src/app/api/<route>/route.ts`. Formato risposta: JSON.

### `/api/dashboard` (GET)
Aggrega metriche per la dashboard overview. Chiamato in polling ogni 5s dal frontend.

### `/api/seed` (POST)
Inizializza il DB con dati di esempio per tutte le 5 fasi. **Attenzione:** in caso di DB vuoto/illeggibile, preferire il seed Python (`scripts/seed.py`) che bypassa il client Prisma cached.

### `/api/sensorium` (GET, DELETE)
- GET: produce un nuovo ciclo cognitivo, ritorna `{ data, xml }`, pubblica su WS
- DELETE: svuota gli snapshot storici

### `/api/memory` (GET, POST)
- GET `?action=list|search|dag`: elenca memorie, ricerca semantica, recupera DAG
- POST `{type: 'episode'|'entity'|'rule', ...}`: registra nuovo elemento

### `/api/patchboard` (GET, POST)
- GET: stato globale corrente + ultime 30 transazioni
- POST `{actor, ops: PatchOp[]}`: applica transazione JSON Patch (validata + autorizzata)

### `/api/plan` (GET, POST)
- GET: elenca piani storici
- POST `{mode: 'generate', goal}` o `{mode: 'manual', plan}`: genera o valida piano

### `/api/compiled` (GET, POST)
- GET: elenca artefatti e template
- POST `{mode: 'generate', templateId, requirement}`: genera codice LLM e valida 4-stadi

### `/api/steering` (GET, POST)
- GET: vocabolario strategie + storia eventi
- POST `{agentId, budgetTotal, budgetUsed, step, lastStrategy, ...}`: esegue uno step

### `/api/verify` (GET, POST)
- GET `?section=ltl|taint|normative|events|all`: elenca dati di verifica
- POST `{action, ...}`:
  - `verify_event`: valuta evento contro FSM LTL
  - `taint_input`, `propagate`, `check_sink`: taint tracking
  - `evaluate_intent`: cancelllo normativo
  - `add_ltl`, `delete_ltl`: CRUD regole LTL
  - `validate_ltl`, `preview_fsm`: validazione e preview FSM (per editor visuale)
  - `add_axiom`, `delete_axiom`: CRUD assiomi normativi

### `/api/reflect` (GET, POST)
- GET `?action=list|retrieve|redlines`: elenca euristiche, RAG retrieval, red lines
- POST `{action: 'reflect', input}`: esegue riflessione ed estrae euristica
- POST `{action: 'feedback', heuristicId, success}`: aggiorna tasso di successo

### `/api/embeddings` (GET, POST)
- GET: dimensione + conteggi record
- POST: ricalcola tutti gli embeddings esistenti (migration dopo cambio modello)

### `/api/context` (GET, POST) — Fase 6
- GET `?action=assemble|stats|search&agentId=X`: working context riassemblato, statistiche, RAG storico
- POST `{action, ...}`:
  - `record_tool_call`: registra coppia Tool Call/Response nel ring buffer
  - `update_policy`: aggiorna windowSize/threshold/autoSummarize per agente
  - `summarize_now`: forza summarization immediata

### `/api/dominator` (GET, POST) — Fase 7
- GET `?action=pta|traces|stats&workflowId=X`: PTA, tracce, statistiche
- POST `{action, ...}`:
  - `capture_trace`: cattura una traccia positiva
  - `build_pta`: fonde tracce in PTA + estrae dominatori
  - `validate_trace`: valida una nuova traccia con coverage score

### `/api/lean` (GET, POST) — Fase 8
- GET `?action=workflows|evolve_events|stats`: workflow verificati, eventi evolve, statistiche
- POST `{action, ...}`:
  - `auto_contracts`: genera contratti formali dal piano
  - `verify`: verifica formale del workflow
  - `evolve`: LeanEvolve su task fallito (riscrive + ri-valida)

### `/api/retainer` (GET, POST) — Fase 9
- GET `?action=delegations|gates_pending|gates_recent|audit|normative|stats|check_authority`: vari elenchi
- POST `{action, ...}`:
  - `grant_delegation` / `revoke_delegation`: CRUD deleghe
  - `request_approval` / `resolve_approval`: HITL gates (NB: usare `gateAction` non `action` per il nome dell'azione del gate, per evitare collisione con il campo `action` del body)
  - `resolve_normative`: calcolo normativo su conflitto prompt utente vs policy

---

## 7. Moduli Kernel

Tutti in `src/lib/kernel/`.

### `patchboard.ts` — Kernel Transazionale
- `applyTransaction(actor, ops)`: valida, autorizza, applica atomico, persiste, logga
- `loadGlobalState()`: legge l'albero JSON dal DB
- `replayTransaction(txId)`: riproduce uno snapshot storico
- Permessi hardcoded in `DEFAULT_PERMISSIONS` (6 prefissi: `/system`, `/agents`, `/tasks`, `/memory`, `/metrics`, `/public`)

### `ns-mem.ts` — Memoria a 3 Livelli
- `recordEpisode(obs, source, agentId, tags)`: registra + EMA update su entità correlata
- `upsertEntity(name, type, description)`: crea/aggiorna entità semantica
- `addLogicalRule(ruleId, expression, deps, priority)`: aggiunge nodo DAG
- `semanticSearch(query, k)`: top-k entità per cosine similarity
- `memoryStats()`: conteggi per dashboard

### `curator.ts` — Compilatore Sensorium
- `produceSensorium()`: gather → compile XML → persist → ritorna
- `cycleId` basato su timestamp per evitare collisioni tra riavvii server
- Formato XML minimale con tag `<system>`, `<memory>`, `<recent_events>`

### `scheduler.ts` — DynAMO
- `validatePlan(plan)`: validazione JSON-Schema + aciclicità + riferimenti
- `topologicalBatches(tasks)`: schedulazione topologica in batch paralleli
- `persistPlan(spec)`: salva piano + task nel DB

### `compiled-ai.ts` — Pipeline Compiled AI
- `checkSafety(code)`: analisi statica per token vietati
- `checkSyntax(code)`: parsing con `new Function()` sandbox
- `checkExecution(code, fixture)`: smoke test
- `checkAccuracy(code, fixture, expected)`: assertion
- `runPipeline(name, templateId, code, fixture, expected)`: pipeline completa
- `BUILTIN_TEMPLATES`: 3 template predefiniti (compliance_check, authz_decision, risk_score)

### `acts.ts` — Controller Steering
- `decideStrategy(state)`: logica deterministica per scelta strategia
- `steer(agentId, budgetTotal, ...)`: registra evento, ritorna strategia + phrase
- `STEERING_VOCABULARY`: 5 strategie con phrase + budgetCost
- `cycleId` basato su timestamp

### `ltl-monitor.ts` — Monitor LTL
- Classe `LTLParser`: parser recursive descent per LTL → AST
- Funzione `compileAST(ast, rule)`: compilatore AST → FSM (7 pattern supportati)
- Classe `LTLMonitor` (singleton): carica regole, evaluta eventi, mantiene stati FSM
- `initMonitor()`: idempotente, ricarica solo se il numero di regole è cambiato
- `reloadMonitor()`: forza ricaricamento (dopo add/delete)
- `verifyEvent(eventLabel, eventType, payload)`: valuta evento + persiste + ritorna snapshot FSM
- `previewFSM(formula)`: validazione + preview per editor visuale

### `taint.ts` — Taint Tracking
- `taintInput(source, payload)`: marca input, ritorna taintId
- `propagateTaint(taintId, step)`: estende flow trace
- `checkSink(sink, taintIds)`: blocca sink sensibili con taint attivo
- 6 sink sensibili hardcoded in `SENSITIVE_SINKS`
- Flussi attivi mantenuti in `Map` in-memory

### `normative.ts` — Cancello Normativo
- `evaluateIntent(intent)`: valuta contro gerarchia assiomatica
- `addAxiom(axiom, priority)` / `deleteAxiom(id)`
- `DEFAULT_AXIOMS`: 6 assiomi di default (3 priorità 1, 2 priorità 2, 1 priorità 3)

### `erl.ts` — Riflessione ERL
- `reflectAndLearn(input)`: analisi causale → estrazione euristica → review Red Line → persistenza
- `retrieveHeuristics(taskDescription, k)`: RAG semantico top-k
- `feedbackHeuristic(id, success)`: aggiorna tasso di successo
- `DEFAULT_RED_LINES`: 4 red lines (2 absolute, 2 strong)
- Supervisore controlla euristica + step + razionali per intercettare bypass

### `context-engineering.ts` — Fase 6
- `recordToolCall(agentId, toolName, callPayload, responsePayload, tokenCost)`: registra + auto-summarize se supera threshold
- `assembleWorkingContext(agentId)`: ritorna `{summary, recentCalls, totalTokenCost}` per il Curator
- `summarizeAndEvict(agentId, windowSize)`: compatta entry evicted in narrative
- `updatePolicy(agentId, updates)`: windowSize/threshold/autoSummarize
- `searchContextHistory(agentId, query, k)`: RAG sui summary passati
- `contextStats(agentId?)`: conteggi per dashboard

### `dominator-tree.ts` — Fase 7
- `captureTrace(workflowId, traceLabel, states, actions, outcome)`: cattura traccia
- `buildPTA(workflowId)`: fonde tracce positive in PTA + calcola dominatori
- `computeDominators(graph)`: algoritmo dataflow classico (iterative fixpoint)
- `validateTrace(workflowId, states, threshold)`: coverage + verdict (accept/warn/reject)
- `semanticMatch(observedState, expectedState)`: stub per matching semantico via LLM
- `getPTA(workflowId)`: recupera PTA per visualizzazione

### `lean4-agent.ts` — Fase 8
- `autoGenerateContracts(planId)`: genera FormalContract da piano DynAMO
- `attachContracts(planId, contracts)`: associa contratti manuali
- `verifyWorkflow(planId)`: verifica simbolica (type consistency, dependency closure, postcondition)
  - Genera pseudo-Lean4 source
  - Ritorna `VerificationResult[]` per ogni task
- `leanEvolve(planId, failedTaskId, failureReason)`: recovery localizzato
  - Recupera feedback formale
  - Riscrive istruzione (stub deterministico)
  - Ri-valida workflow
  - Persisti evento evolve con cycle counter

### `artificial-retainer.ts` — Fase 9
- `grantDelegation(agentId, scope, constraints, grantedBy, expiresAt?)`: concedi delega
- `revokeDelegation(delegationId, revokeReason)`: revoca con motivo
- `checkAuthority(agentId, scope)`: verifica autorità a runtime (pattern matching)
- `requestApproval(agentId, action, payload, reason, expiresAt?)`: crea HITL gate
- `resolveApproval(gateId, decision, decidedBy, axiomTrail?)`: risolvi gate
- `resolveNormativeConflict(conflict)`: calcolo normativo O(1)
  - Gerarchia: SAFETY > OPERATIONAL > AESTHETIC
  - Ritorna verdict + modifiedAction + axiomTrail auditabile
- `listDelegations / listPendingGates / listRecentGates / listAuditLedger / listNormativeResolutions`: elenchi per UI
- `retainerStats()`: metriche per dashboard

### `embeddings.ts` — Embeddings Semantic v2
- `embed(text)`: 256-dim TF-IDF con alias dizionario + bigrammi + trigrammi
- `tokenize(text)`: normalizzazione con 80+ alias it/en + stopwords removal
- `cosine(a, b)`: similarity su vettori normalizzati L2
- `recomputeAllEmbeddings()`: migration di tutti i record esistenti
- `EMBED_DIM = 256`

---

## 8. Componenti Frontend

Tutti in `src/components/agentic/`.

### Layout & Navigazione

| File              | Componente         | Descrizione                                      |
|-------------------|--------------------|--------------------------------------------------|
| `sidebar.tsx`     | `Sidebar`, `MobileNav` | Navigazione 5 fasi + Overview, responsive    |
| `topbar.tsx`      | `Topbar`           | Metriche live (ciclo, load, queue, threads, WS) |

### Hook personalizzati

| File                    | Hook                  | Descrizione                                |
|-------------------------|-----------------------|--------------------------------------------|
| `use-dashboard.ts`      | `useDashboard()`      | Polling `/api/dashboard` ogni 5s           |
| `use-sensorium-live.ts` | `useSensoriumLive()`  | Connessione WebSocket a `/?XTransformPort=3003` |

### Pagine delle Fasi

| File         | Componente  | Tab presenti                                            |
|--------------|-------------|----------------------------------------------------------|
| `overview.tsx` | `Overview` | Dashboard 9 fasi + LiveFeed + Kernel Audit Log           |
| `phase1.tsx`  | `Phase1`    | Memoria · PatchBoard · Sensorium · DAG Logico            |
| `phase2.tsx`  | `Phase2`    | DynAMO Planner · Compiled AI                             |
| `phase3.tsx`  | `Phase3`    | Controller ACTS con step manuale + auto-run              |
| `phase4.tsx`  | `Phase4`    | LTL Monitor · Editor · Taint Tracking · Normative · Eventi |
| `phase5.tsx`  | `Phase5`    | Riflessione · RAG · Libreria · Red Lines                 |
| `phase6.tsx`  | `Phase6`    | Working Context · Registra · Policy · RAG Storico        |
| `phase7.tsx`  | `Phase7`    | Cattura Tracce · PTA + Dominators · Validazione · Storico|
| `phase8.tsx`  | `Phase8`    | Verifica · Sorgente Lean4 · LeanEvolve · Storico         |
| `phase9.tsx`  | `Phase9`    | Delegation · HITL Gates · Normative · Audit Ledger       |

### Componenti live

| File                  | Componente     | Descrizione                                            |
|-----------------------|----------------|--------------------------------------------------------|
| `live-feed.tsx`       | `LiveFeed`     | Pannello real-time: Sensorium + eventi + state diff   |
| `ltl-normative-editor.tsx` | `LTLNormativeEditor` | Editor visuale LTL con preview FSM + editor assiomi |

---

## 9. Mini-Service WebSocket

**Path:** `mini-services/sensorium-ws/`

### Architettura

- **Socket.io server** sulla porta **3003** (browser-facing)
  - Path: `/` (richiesto da Caddy)
  - Connessione client: `io('/?XTransformPort=3003', ...)`
- **HTTP publish endpoint** sulla porta **3004** (Next.js → WS)
  - `POST /publish` con body `{channel, payload}`: ritrasmette su tutti i client connessi
  - `GET /health`: ritorna `{ok, wsClients, uptime}`

### Canali event-bus

| Canale        | Payload                                                      | Emesso da               |
|---------------|--------------------------------------------------------------|-------------------------|
| `sensorium`   | `{cycleId, xml, queueDepth, activeThreads, systemLoad}`      | `/api/sensorium`        |
| `agent_event` | `{agentId, phase, event, level, payload}`                    | Tutte le API routes     |
| `state_diff`  | `{actor, ops, accepted, reason}`                             | `/api/patchboard`       |

### Helper pubblicazione (lato Next.js)

`src/lib/ws-publish.ts`:
```ts
import { publishSensorium, publishAgentEvent, publishStateDiff } from '@/lib/ws-publish'
// Tutte best-effort: falliscono silenziosamente se WS non attivo
```

### Avvio

```bash
cd mini-services/sensorium-ws
bun run dev
# Output: [sensorium-ws] Socket.io broadcast on port 3003
#         [sensorium-ws] HTTP publish endpoint on port 3004
```

---

## 10. Iterazioni e Cronologia

### v0.1.0 — Implementazione iniziale (5 fasi base)

- Tutti i moduli kernel
- Tutte le API routes
- UI completa con 5 fasi
- Seed Python per evitare problemi di client Prisma cached

### v0.2.0 — 4 miglioramenti di iterazione

1. **WebSocket live** — mini-service socket.io + `useSensoriumLive` hook + `LiveFeed` componente integrato in Overview e Topbar
2. **Embeddings semantici v2** — TF-IDF con 80+ alias it/en + bigrammi + trigrammi, 256 dimensioni. Migration API per ricalcolare record esistenti. Similarità significativa: 0.72 vs 0.20 di prima
3. **LTL esteso** — parser recursive descent completo con AST, 7 pattern FSM compilati, runtime persistente con snapshot. API nuove: `validate_ltl`, `preview_fsm`, `delete_ltl`
4. **Editor visuale LTL** — nuovo tab "Editor" in Fase 4 con validazione live, preview FSM come badge colorati, e editor inline degli assiomi normativi con gerarchia visuale

### v0.3.0 — Blueprint integrativo (Fasi 6-9)

Implementa le 4 lacune architetturali identificate dall'analisi LATS:

1. **Fase 6 — Context Engineering & Pruning** — risolve il "context rot" con ring buffer N coppie Tool Call/Response + summarization asincrona. Working context riassemblato = Summary + ultime N entry. Policy configurabile per agente. RAG storico sui summary.

2. **Fase 7 — Dominator Trees** — valida esecuzioni di workflow complessi tollerando il non-determinismo sequenziale. PTA fusion di tracce positive, estrazione dominatori via algoritmo dataflow, coverage score con threshold 0.7. Test verificato: `submit` riconosciuto come dominatore essenziale, trace che lo salta viene REJECT.

3. **Fase 8 — Lean4 Formal Verification** — traduce DAG DynAMO in FormalContract (pre/post conditions + variableTypes). Verifica simbolica: type consistency, dependency closure, postcondition ben formata. LeanEvolve: recovery localizzato su failure con riscritura LLM + ri-validazione. Pseudo-Lean4 source generato per ogni workflow.

4. **Fase 9 — Artificial Retainer** — cambia paradigma da "chat" a "piattaforma di supervisione". DelegationContract con scope + constraints, HITL gates per azioni irreversibili, Normative Calculus con gerarchia SAFETY > OPERATIONAL > AESTHETIC e Axiom Trail auditabile, Audit Ledger comprensibile all'umano. Test verificato: `OPERATIONAL vs SAFETY` → BLOCK, `SAFETY vs AESTHETIC` → MODIFY.

### Problemi noti risolti

- **Import ZAI**: `z-ai-web-dev-sdk` usa `export default`, non named export. Sintassi corretta: `import ZAI from 'z-ai-web-dev-sdk'`
- **DB readonly**: se il file `db/custom.db` viene rimosso e ricreato, il client Prisma cached ha un fd stale. Soluzione: `db.ts` usa un Proxy che verifica l'inode e ricrea il client se necessario
- **cycleId collisioni**: il cycleId in-memory si resetta ad ogni riavvio. Soluzione: cycleId basato su timestamp (`tsOffset * 1000 + counter`)
- **LTL monitor reset**: ogni `verifyEvent` chiamava `initMonitor()` che ricaricava le FSM da capo, perdendo lo stato. Soluzione: `initMonitor` idempotente, ricarica solo se il numero di regole è cambiato; `reloadMonitor` esplicito dopo add/delete
- **Prisma client schema mismatch**: dopo aver aggiunto nuovi modelli allo schema Prisma, il client cached del dev server non li riconosce (`Cannot read properties of undefined`). Soluzione: killare i processi next-server, cancellare `.next/`, riavviare `bun run dev`
- **Collisione campo `action`**: nella route `/api/retainer`, il campo `action` del body è usato per il dispatch, ma `request_approval` aveva anche `action` per il nome del gate (duplicazione JSON). Soluzione: rinominato in `gateAction`

---

## 11. Note per Sviluppo Futuro

### Aree di estensione自然

- **WebSocket service auto-start**: attualmente il mini-service WS deve essere avviato manualmente. Potrebbe essere integrato in `.zscripts/dev.sh`
- **Editor DAG visuale**: la Fase 2 mostra il DAG topologico come lista di batch. Un vero grafico interattivo (es. react-flow) migliorerebbe la UX
- **Persistenza FSM LTL**: gli stati FSM sono in-memory e si perdono al riavvio. Per produzione, persistere su DB
- **Taint tracking TTL**: i taint flows attivi non scadono mai. Aggiungere un TTL con cleanup automatico
- **Embeddings esterni**: integrazione con API embeddings reali (OpenAI, Cohere) come fallback del TF-IDF locale
- **LTL pattern composti**: supportare `G(F(p))`, `F(G(p))`, annidamenti complessi (richiede NFA invece di FSM)
- **Editor regole logiche DAG**: la Fase 1 mostra il DAG come lista. Un editor visuale con drag-and-drop dei nodi sarebbe utile
- **Multi-tenant**: l'OS attualmente è single-tenant. Per multi-tenant, aggiungere `tenantId` a tutte le tabelle e scoping nei moduli kernel
- **Audit trail export**: esportare AgentLog in formato JSONL per analisi esterne
- **Test suite**: non ci sono test automatici. Aggiungere test unitari per i moduli kernel (especially LTL parser, patchboard transactions, ERL supervisor)

### Convenzioni di codifica

- **Linguaggio UI**: italiano (labels, descriptions, toasts)
- **Linguaggio codice**: inglese (variabili, funzioni, commenti)
- **Commenti kernel**: descrivono il "cosa" e il "perché", non il "come"
- **Pattern API**: una route per entità, azioni via `action` nel body POST
- **Pattern WS**: best-effort publishing, mai bloccante per l'API route
- **Pattern errori**: `try/catch` nelle API routes, ritorno `{ok: false, error}` con status code appropriato
- **Lint**: `bun run lint` deve essere pulito prima di ogni commit

### Risoluzione problemi comuni

| Problema                              | Soluzione                                            |
|---------------------------------------|------------------------------------------------------|
| Pagina bianca con errore build        | `rm -rf .next && bun run dev` (cancella cache Turbopack) |
| DB readonly                           | `rm db/custom.db && bun run db:push && python3 scripts/seed.py` |
| API 500 con Prisma error              | Verifica che il file DB esista e sia scrivibile      |
| WS non si connette                    | Verifica `curl http://localhost:3004/health`         |
| LTL formula non valida                | Controlla il messaggio di errore del parser          |
| LiveFeed vuoto                        | Genera un evento da una qualsiasi fase (es. steering step) |

---

## Riferimenti

- **Blueprint originale**: 5 micro-fasi SOTA Agentic OS (convenzione con l'utente)
- **RFC 6902**: JSON Patch (subset implementato in `patchboard.ts`)
- **LTL**: Linear Temporal Logic — operatori G/F/X/U
- **FSM**: Finite State Machine (monitor runtime per LTL)
- **EMA**: Exponential Moving Average (anti-drift su NS-Mem)
- **DAG**: Directed Acyclic Graph (schedulazione topologica in `scheduler.ts`)

---

*Documentazione generata il 2026-06-20. Aggiornare ad ogni iterazione significativa.*
