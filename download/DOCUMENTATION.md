# SOTA Agentic OS — Documentazione Tecnica

> **Versione:** 0.6.0 · **Data:** 2026-06-20 · **Stack:** Next.js 16 + TypeScript + Prisma + Socket.io + React Flow + Vitest
>
> **⚠️ Stato**: Prototipo avanzato, NON production-ready. Per analisi critica, gap e roadmap vedere `ROADMAP.md`.

Questo documento descrive cosa è **realmente implementato** nel codice. Le promesse non realizzate, i gap e la roadmap evolutiva sono documentati separatamente in `ROADMAP.md`.

---

## Indice

1. [Stack Tecnologico](#1-stack-tecnologico)
2. [Avvio Rapido](#2-avvio-rapido)
3. [Architettura Generale](#3-architettura-generale)
4. [Le 23 Micro-Fasi + 3 Trasversali](#4-le-23-micro-fasi--3-trasversali)
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

## 4. Le 18 Micro-Fasi

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

### Fase 10 — Grounded Inference (Model Encapsulator)

**Modulo:** `grounded-inference.ts`

Risolve la "Vulnerabilità dello Stato Latente": l'LLM è degradato a funzione logica stateless.

- **Model Encapsulator:** inietta contesto minimale, azzerando la sessione LLM ad ogni iterazione
- **Anti-mutazione diretta:** l'LLM sintetizza script di parsing deterministici che l'OS esegue in sandbox isolata
- **Information Pass-Through Limitato:** contesto troncato al budget di token (default 2000)
- **Policy configurabile:** maxRetries, contextBudget, sandboxEnabled, forbidDirectMutation
- Test verificato: script `return input.results.filter(...)` generato, eseguito in sandbox, risultato restituito

### Fase 11 — Affect Subsystem

**Modulo:** `affect-subsystem.ts`

Previene "death spirals" e "reward hacking" tramite telemetria affettiva.

- **Disperazione:** aumenta con gate rejects (peso 0.35 per reject), decay 5%/ciclo
- **Frustrazione:** aumenta con tool failures (0.20) + repeated calls (0.15)
- **Meta-Observer:** interviene se metriche > soglia critica (default 0.7):
  - `TIGHTEN_ACCEPTANCE_THRESHOLD` (es. -15%)
  - `COOLDOWN` (sleep forzato, default 5000ms)
  - `INJECT_CAUTION_PROMPT` (avviso nel prompt)
  - `HALT:dual_critical_state` se entrambe critiche
- **Soglie configurabili** per agente
- Test verificato: 5 tool fails + 4 gate rejects + 3 repeated → HALT scattato

### Fase 12 — AgentObjective (BFS Rubric Tree)

**Modulo:** `agent-objective.ts`

Decomposizione automatica di obiettivi macro in rubriche Pass/Fail.

- **BFS decomposition:** branching factor 3, peso dimezzato ad ogni livello
- **Arresto basato sul peso:** stop se weight < 0.1 o depth >= 5
- **Context tier gerarchico:**
  - Livello 0: `strategic` (abstract, overview)
  - Livello 1-2: `methodological` (documentazione)
  - Livello 3+: `implementation` (codice, log)
- **Valutazione Pass/Fail/Skip:** nodo fail → tutti i discendenti skippati
- Test verificato: albero 13 nodi, profondità 2, generato da "Ottimizza il deploy del microservizio auth"

### Fase 13 — ESR + Semantic Quorum

**Modulo:** `esr-quorum.ts`

Risolve la "Divergenza Epistemica" tra agenti paralleli.

- **Belief Lineage:** ogni convinzione traccia il proprio genitore (versioning)
  - Auto-superseded se nuova convinzione ha cosine similarity > 0.85 con precedente
- **ESR (Epistemic State Replication):** replica convinzioni tra agenti
  - syncStatus: `synced` se sim > 0.9 o identico, `conflict` se 0.7 < sim < 0.9
  - Coerenza eventuale
- **Quorum Semantico:** meccanismo di Join per DAG
  - `proposeQuorumAction(workflowJoinId, action, requiredQuorum)`
  - Validatori votano accept/reject
  - Verdict: `accepted` quando acceptCount >= requiredQuorum
- Test verificato: 2 vote accept → quorum ACCEPTED

### Fase 14 — TimeRouter

**Modulo:** `time-router.ts`

Routing adattivo per massimizzare performance e ridurre costi.

- **Feature extraction:** lunghezza, token estimate, hasCode, hasMath, hasLogic, complexity, domain
- **Classificatore leggero** (semplificato, in produzione XGBoost):
  - Score per modello basato su match dominio/specializzazione
  - Bonus per task complessi, penalità per costi alti su task semplici
- **Gate Selettivo** con soglie configurabili:
  - `marginThreshold` (τm = 0.2): differenza minima tra top-2 modelli
  - `diversityThreshold` (τd = 0.3): diversità massima tollerata
  - `minConfidence` (0.6): confidenza minima per routing diretto
- **Routing outcomes:**
  - `primary`: modello leader singolo (alta confidenza + alto margine + bassa diversità)
  - `ensemble`: fallback a top-3 modelli pesati
  - `critic`: primary + modello critic specializzato
- **6 modelli default:** GLM-4.6 (general/code/reason/math/logic) + GLM-4.5 Flash
- Test verificato: code prompt → glm-4.6-code; simple prompt → glm-4.5-flash

### Fase 15 — Cockpit (Plancia di comando Artificial Retainer)

**Componenti:** `cockpit.tsx`, `cockpit/route.ts` (API), `sovereign-translator.ts` (recordNarrative)

Abbandona il paradigma "chat-centrico" in favore di una Web GUI multi-pannello a 5 tab.

- **Tab Narrative**: timeline ad alto livello delle azioni dell'agente (modello `CockpitNarrative`)
- **Tab Log**: traccia tecnica completa con filtri per fase/agente/livello (AgentLog)
- **Tab Scheduler**: task `PlanTask` in background con stato (pending/ready/running/done/failed)
- **Tab Cycles**: dettaglio cicli cognitivi (SensoriumSnapshot + SteeringEvent)
- **Tab Safety**: azioni bloccate `BlockedAction` pending da risolvere come Sovereign Validator

**Widget persistente Sensorium** (sempre in cima al Cockpit):
- Ciclo corrente, queue depth, active threads, system load
- Aggiornato via WebSocket (`useSensoriumLive` hook)

**Affect Gauge** (cruscotto telemetria affettiva):
- Barra orizzontale animata per Disperazione e Frustrazione
- Soglie colorate: verde < 0.4, ambra < 0.7, rosso ≥ 0.7
- Bordo rosso della card quando stato critico

**Accesso**: sidebar categoria CORE, voce "Cockpit" (icona Gauge)

### Fase 16 — Topological Observability (React Flow)

**Componente:** `dag-visualizers.tsx`

Visualizzazione grafi interattiva per i 3 tipi di DAG del sistema. Installato `reactflow@11.11.4`.

- **`DynAMODagVisualizer`** (per Fase 2 - Planner):
  - Task come nodi con archi di dipendenza
  - Colore per stato: done=verde, running=blu, failed=rosso, pending=grigio
  - Batch paralleli raggruppati orizzontalmente
  - Archi animati per task in esecuzione
  - MiniMap con colorazione per stato

- **`ObjectiveTreeVisualizer`** (per Fase 12 - Objective Builder):
  - Layout gerarchico con nodi colorati per contextTier
    - strategic = sky, methodological = violet, implementation = emerald
  - Status: pass=verde, fail=rosso, skipped=grigio, pending=indaco
  - Badge peso (w=0.333) e livello (L0, L1, …)

- **`LeanWorkflowVisualizer`** (per Fase 8 - Formal Verifier):
  - Nodi con pre/post-conditions count come badge
  - Colore verde se verified, rosso se failed
  - Archi animati per task non verificati
  - Layout orizzontale basato su ordine topologico

Tutti i visualizzatori hanno: Background dots, Controls, MiniMap, fitView automatico, attribution nascosto.

### Fase 17 — Sovereign Validator

**Moduli:** `sovereign-translator.ts` (kernel), `sovereign-modal.tsx` (UI), `blocked-actions/route.ts` (API)

L'utente è **Sovereign Validator**: risolve le azioni bloccate dai cancelli di sicurezza con override strutturato.

- **`registerBlockedAction(input)`**: registra azione bloccata con Axiom Trail
  - Sorgenti: `ltl` | `taint` | `normative` | `hitl_gate`
  - Auto-genera spiegazione in italiano via `generateExplanation()`
  - Pubblica evento WebSocket `action_blocked`

- **`resolveBlockedAction(blockedId, choice, resolvedBy, details)`**: 4 opzioni di risoluzione
  - `approved`: approva assumendo responsabilità
  - `modified`: modifica parametri strumento
  - `downgraded`: declassa task
  - `rejected`: rifiuta definitivamente

- **Modale Sovereign** (`SovereignModalContainer`):
  - Dialog che si auto-apre quando ci sono `BlockedAction` pending
  - Polling su `/api/blocked-actions?action=pending` ogni 5s
  - Si apre anche su evento WebSocket `action_blocked`
  - Mostra: azione tentata, spiegazione in linguaggio naturale, Axiom Trail esplicito (step × rule × result), nota di risoluzione opzionale
  - 4 bottoni di risoluzione con icone distinte
  - Navigazione tra multiple azioni pending ("1 di N")

- **Traduttore LTL → italiano**: converte `G(high_risk -> X human_approval)` in "Ogni azione ad alto rischio richiede approvazione umana nel passo successivo"

### Fase 18 — Tool Ecosystem (Package Manager Agentico)

**Moduli:** `tool-registry.ts` (kernel), `tool-manager.tsx` (UI), `tools/route.ts` (API)

I tool non vengono scelti per similarità semantica (anti-Hallucination Squatting), ma risolti tramite signature crittografica.

- **`installTool(spec, installedBy)`**: installa tool con signature SHA-256
  - Signature = `sha256:` + hash(toolId:name:version:publisher)
  - Crea tutti i 10 permessi predefiniti come negati (principio minimo privilegio)

- **`revokeTool(toolId, reason)`**: revoca tool (disattiva, non elimina per audit)
- **`setPermission(toolId, scope, granted, constraint)`**: permessi a grana fine
- **`checkToolPermission(toolId, scope)`**: verifica a runtime prima di eseguire il tool

- **10 scope predefiniti:**
  - `filesystem:read` / `filesystem:write`
  - `network:get` / `network:post`
  - `tool:exec`
  - `db:read` / `db:write`
  - `process:spawn`
  - `env:read`
  - `secret:access`

- **3 Tool predefiniti (BUILTIN_TOOLS):**
  - `github-integration` v1.2.0 (sota-os-official)
  - `filesystem-browser` v0.9.1 (sota-os-official)
  - `web-search` v2.0.0 (sota-os-official)

- **UI Tool Manager** (3 tab):
  - **Installati**: lista tool + dettaglio con pannello permessi a grana fine (Switch per ogni scope)
  - **Installa**: form per tool custom con signature auto-generata
  - **Predefiniti**: BUILTIN_TOOLS con badge "Installato" se già presenti

- **Integrazione con Fase 8 (Lean4)**: i permessi concessi alimentano direttamente le pre/post-conditions dei contratti formali

**Accesso**: sidebar categoria GOVERNANCE, voce "Tool Manager" (icona Package)

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

### Fasi 15-18 — Cockpit, Sovereign, Tool Ecosystem

| Modello              | Descrizione                                        |
|----------------------|----------------------------------------------------|
| `CockpitNarrative`   | Voci narrative ad alto livello per il tab Narrative|
| `BlockedAction`      | Azioni bloccate in attesa di risoluzione umana     |
| `Tool`               | Tool installati con signature crittografica SHA-256|
| `ToolPermission`     | Permessi a grana fine per ogni tool (10 scope)     |

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

### `/api/cockpit` (GET) — Fase 15
- `?tab=narrative`: voci narrative ad alto livello (CockpitNarrative)
- `?tab=log`: traccia tecnica (AgentLog, ultimi 100)
- `?tab=scheduler`: task in background (PlanTask con plan)
- `?tab=cycles`: snapshot Sensorium + steering events
- `?tab=safety`: LTL rules + pending gates + taint records + blocked actions
- Default: aggrega tutti i tab (compatto)

### `/api/blocked-actions` (GET, POST) — Fase 17
- GET `?action=pending|recent|stats`: azioni bloccate
- POST `{action, ...}`:
  - `register`: registra nuova azione bloccata con Axiom Trail
  - `resolve`: risolvi con choice (approved|modified|downgraded|rejected)

### `/api/tools` (GET, POST) — Fase 18
- GET `?action=list|stats|builtin`: elenca tool, statistiche, tool predefiniti
- POST `{action, ...}`:
  - `install`: installa nuovo tool con signature auto-generata
  - `revoke`: revoca tool (disattiva)
  - `set_permission`: toggle permesso scope
  - `check_permission`: verifica autorizzazione a runtime

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

### `sovereign-translator.ts` — Fase 17
- `registerBlockedAction(input)`: registra azione bloccata con Axiom Trail
  - Sorgenti: ltl | taint | normative | hitl_gate
  - Auto-genera spiegazione in italiano via `generateExplanation()`
  - Pubblica evento WebSocket `action_blocked`
- `resolveBlockedAction(blockedId, choice, resolvedBy, details?)`: 4 opzioni (approved|modified|downgraded|rejected)
- `listPendingBlocked(limit) / listRecentBlocked(limit)`: elenchi per UI
- `blockedStats()`: metriche per dashboard
- `recordNarrative(agentId, narrative, level, cycleId?, relatedPhase?)`: registra voce per tab Narrative del Cockpit
- `listNarratives(limit, level?)`: recupera narratives

### `tool-registry.ts` — Fase 18
- `installTool(spec, installedBy)`: installa tool con signature SHA-256
  - Signature = `sha256:` + hash(toolId:name:version:publisher)
  - Crea 10 permessi predefiniti come negati (minimo privilegio)
- `revokeTool(toolId, reason)`: revoca tool (disattiva per audit)
- `setPermission(toolId, scope, granted, grantedBy, constraint?)`: permessi a grana fine
- `checkToolPermission(toolId, scope)`: verifica a runtime
- `listTools(includeRevoked)`: elenca tool con permessi
- `toolStats()`: metriche per dashboard
- `AVAILABLE_SCOPES`: 10 scope predefiniti (filesystem:read/write, network:get/post, tool:exec, db:read/write, process:spawn, env:read, secret:access)
- `BUILTIN_TOOLS`: 3 tool ufficiali (github-integration, filesystem-browser, web-search)

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
| `overview.tsx` | `Overview` | Dashboard 14 fasi + ArchitectureMap + CategoryKpis + QuickActions + LiveFeed + Branding |
| `cockpit.tsx` | `Cockpit`  | Narrative · Log · Scheduler · Cycles · Safety + Sensorium widget + Affect gauge |
| `phase1.tsx`  | `Phase1`    | Memoria · PatchBoard · Sensorium · DAG Logico            |
| `phase2.tsx`  | `Phase2`    | DynAMO Planner · Compiled AI                             |
| `phase3.tsx`  | `Phase3`    | Controller ACTS con step manuale + auto-run              |
| `phase4.tsx`  | `Phase4`    | LTL Monitor · Editor · Taint Tracking · Normative · Eventi |
| `phase5.tsx`  | `Phase5`    | Riflessione · RAG · Libreria · Red Lines                 |
| `phase6.tsx`  | `Phase6`    | Working Context · Registra · Policy · RAG Storico        |
| `phase7.tsx`  | `Phase7`    | Cattura Tracce · PTA + Dominators · Validazione · Storico|
| `phase8.tsx`  | `Phase8`    | Verifica · Sorgente Lean4 · LeanEvolve · Storico         |
| `phase9.tsx`  | `Phase9`    | Delegation · HITL Gates · Normative · Audit Ledger       |
| `phase10-14.tsx` | `Phase10-14` | (Fasi 10-14, vedi sezione 4 per dettagli)             |
| `tool-manager.tsx` | `ToolManager` | Installati · Installa · Predefiniti + pannello permessi |
| `sovereign-modal.tsx` | `SovereignModalContainer` | Modale auto-apertura per azioni bloccate |

### Componenti live

| File                  | Componente     | Descrizione                                            |
|-----------------------|----------------|--------------------------------------------------------|
| `live-feed.tsx`       | `LiveFeed`     | Pannello real-time: Sensorium + eventi + state diff   |
| `ltl-normative-editor.tsx` | `LTLNormativeEditor` | Editor visuale LTL con preview FSM + editor assiomi |
| `architecture-map.tsx`| `ArchitectureMap` | Mappa architetturale 14 fasi cliccabile con flussi   |
| `category-kpis.tsx`   | `CategoryKpis` + `QuickActions` | 7 card KPI per categoria + 4 bottoni one-click |
| `dag-visualizers.tsx` | `DynAMODagVisualizer` + `ObjectiveTreeVisualizer` + `LeanWorkflowVisualizer` | 3 visualizzatori React Flow |
| `sovereign-modal.tsx` | `SovereignModalContainer` | Modale auto-apertura per azioni bloccate con Axiom Trail |
| `phase-header.tsx`    | `PhaseHeader` + `PhaseKpi` + `PhaseKpiGrid` | Header uniforme per tutte le pagine di fase |
| `related-phases.tsx`  | `RelatedPhases` + `link` + `ARCHITECTURE_FLOWS` | Cross-linking tra fasi con transfer state |
| `branding-showcase.tsx` | `BrandingShowcase` | Pannello branding kit con palette e asset |

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

### v0.4.0 — Blueprint integrativo 3 (Fasi 10-14)

Risolve 5 vulnerabilità critiche per deployment industriali:

1. **Fase 10 — Grounded Inference** — Model Encapsulator che degrada l'LLM a funzione stateless. Contesto azzerato ad ogni iterazione, script di parsing eseguiti in sandbox isolata. Anti-pattern "Generative Model as Data Worker" eliminato.

2. **Fase 11 — Affect Subsystem** — Telemetria affettiva (Desperation + Frustration) con Meta-Observer che interviene con cooldown e tightening delle soglie. Previene death spirals e reward hacking. Test verificato: HALT scattato su dual critical state.

3. **Fase 12 — AgentObjective BFS** — Decomposizione BFS di obiettivi macro in rubriche Pass/Fail con arresto basato sul peso. Context tier gerarchico: strategic → methodological → implementation.

4. **Fase 13 — ESR + Quorum** — Belief Lineage con auto-superseded, Epistemic State Replication con coerenza eventuale, Quorum Semantico come meccanismo di Join per DAG. Risolve la divergenza epistemica tra swarm.

5. **Fase 14 — TimeRouter** — Router classificatore con feature extraction, Gate Selettivo su τm (margine) e τd (diversità), Ensemble Fallback. 6 modelli Foundation default (GLM-4.6 family + Flash).

### v0.4.1 — Ridisegno UI/UX

Ridisegno completo dell'interfaccia utente:
- **Sidebar raggruppata** in 7 categorie tematiche (CORE, FOUNDATION, ORCHESTRATION, COGNITIVE, TRUST, LEARNING, GOVERNANCE, INFRASTRUCTURE)
- **Rinominazione descrittiva** di tutte le 14 fasi (es. "Fase 1" → "Memory & State")
- **ArchitectureMap**: mappa visuale cliccabile delle 14 fasi con 6 flussi architetturali
- **CategoryKpis**: 7 card compatte per categoria con 4 metriche ciascuna
- **QuickActions**: 4 bottoni one-click per flussi comuni
- **PhaseHeader uniforme**: icona grande + nome + badge categoria + sottotitolo
- **RelatedPhases**: cross-linking tra fasi con transfer state via sessionStorage
- **Badge live** nella sidebar per fasi con stati critici

### v0.5.0 — Blueprint integrativo 4 (Fasi 15-18)

Completa l'OS con il livello di Presentazione, Governance e Interazione Umana:

1. **Fase 15 — Cockpit (Artificial Retainer UI)** — Plancia di comando a 5 tab (Narrative, Log, Scheduler, Cycles, Safety) che abbandona il paradigma chat-centrico. Widget persistente Sensorium + Affect Gauge animato con soglie colorate.

2. **Fase 16 — Topological Observability (React Flow)** — 3 visualizzatori grafi interattivi: DynAMODagVisualizer (piani), ObjectiveTreeVisualizer (rubriche), LeanWorkflowVisualizer (workflow formali). MiniMap, Controls, fitView automatico.

3. **Fase 17 — Sovereign Validator** — Modale auto-apertura per azioni bloccate dai cancelli di sicurezza. Axiom Trail esplicito in linguaggio naturale. 4 opzioni di override: Approva, Modifica, Declassa, Rifiuta. Traduttore LTL → italiano.

4. **Fase 18 — Tool Ecosystem** — Package manager agentico con signature crittografica SHA-256. 10 scope permessi a grana fine. 3 tool predefiniti (github-integration, filesystem-browser, web-search). Integrazione con Lean4: i permessi alimentano le pre/post-conditions.

### v0.6.0 — Production Hardening (Fasi 19-23 + T1-T3)

Trasforma il prototipo in sistema production-ready con 5 release incrementali:

**Release 0.6.0-alpha** — Quality Infrastructure + Dev Workflow:
- **Fase 19** — 146 test unitari (Vitest) per LTL Monitor, Patchboard, Normative, Taint, ERL, Embeddings. Coverage 52%+ sui moduli testabili. Fixtures deterministici.
- **T3** — Script `dev:clean`, `dev:full`, `db:backup`, `db:restore`. UUID v7 time-sortable per cycleId. Auto-start WS service.

**Release 0.6.0-beta** — Auth + DAG Integration + i18n:
- **Fase 20** — Authentication & RBAC: 4 ruoli (Admin/Operator/Sovereign/Viewer), session management con cookie HttpOnly, login page dedicata, default admin auto-creato.
- **T1** — DAG Visualizer Integration: 3 visualizzatori React Flow integrati in Phase2 (Grafo DAG), Phase8 (Grafo workflow), Phase12 (Grafo albero).
- **T2** — i18n base IT/EN: 60+ chiavi traduzione, hook `useI18n`, language switcher in topbar, auto-detect browser, persistenza localStorage.

**Release 0.6.0-rc** — Crypto + Observability:
- **Fase 21** — Cryptographic Trust: ECDSA P-256 signing reale (crypto nativo Node), PublisherKey registry, `installSignedTool` con firma asimmetrica, `verifyInstalledTool` con chiave pubblica. API `/api/publishers`.
- **Fase 22** — Observability Stack: Error tracking con dedup fingerprint, Metrics exporter formato Prometheus, Distributed tracing con `traced()` helper, Backup scheduler con checksum SHA-256 + retention 7 backup. API `/api/errors`, `/api/metrics`, `/api/traces`, `/api/backup`.

**Release 0.6.0-stable** — Scalability & Persistence:
- **Fase 23.1** — DB Adapter: `getDatabaseProvider()` rileva SQLite vs PostgreSQL, `getDatabaseInfo()` per dashboard. Adapter pattern pronto per migrazione PostgreSQL (cambiare DATABASE_URL).
- **Fase 23.2** — WS Pub/Sub Adapter: interfaccia in-memory (dev) + Redis-ready (prod). `getWSPubSubStats()` per monitoring cluster.
- **Fase 23.3** — Job Queue: `enqueueJob()` con priorità (0=normal, 1=high, 2=critical), `processNextJob()` con retry esponenziale (max 3 retry), worker pool con `startWorker()`/`stopWorker()`. 6 job types: embeddings_recompute, summarize, backup, fsm_checkpoint, taint_cleanup, session_cleanup.
- **Fase 23.4** — FSM & Taint Persistence: `checkpointFSMStates()` salva snapshot FSM su DB, `restoreFSMStates()` ripristina all'avvio, `cleanupExpiredTaints()` con TTL configurabile (default 60 min), `createTaintFlowWithTTL()` per taint con scadenza automatica.

### Problemi noti risolti

- **Import ZAI**: `z-ai-web-dev-sdk` usa `export default`, non named export. Sintassi corretta: `import ZAI from 'z-ai-web-dev-sdk'`
- **DB readonly**: se il file `db/custom.db` viene rimosso e ricreato, il client Prisma cached ha un fd stale. Soluzione: `db.ts` usa un Proxy che verifica l'inode e ricrea il client se necessario
- **cycleId collisioni**: il cycleId in-memory si resetta ad ogni riavvio. Soluzione: cycleId basato su timestamp (`tsOffset * 1000 + counter`)
- **LTL monitor reset**: ogni `verifyEvent` chiamava `initMonitor()` che ricaricava le FSM da capo, perdendo lo stato. Soluzione: `initMonitor` idempotente, ricarica solo se il numero di regole è cambiato; `reloadMonitor` esplicito dopo add/delete
- **Prisma client schema mismatch**: dopo aver aggiunto nuovi modelli allo schema Prisma, il client cached del dev server non li riconosce (`Cannot read properties of undefined`). Soluzione: killare i processi next-server, cancellare `.next/`, riavviare `bun run dev`
- **Collisione campo `action`**: nella route `/api/retainer`, il campo `action` del body è usato per il dispatch, ma `request_approval` aveva anche `action` per il nome del gate (duplicazione JSON). Soluzione: rinominato in `gateAction`. Stesso problema in `/api/esr` con `propose_quorum`: rinominato in `quorumAction`.
- **Icon components during render**: la regola ESLint `react-hooks/static-components` blocca l'assegnazione `const Icon = getIcon(name)` durante il render. Soluzione: usare una `ICON_MAP` statica a livello modulo invece di una funzione `getIcon` chiamata nel corpo del componente.

---

## 11. Note per Sviluppo Futuro

> ⚠️ Per analisi critica completa, gap detailati e roadmap evolutiva realistica, vedere **`ROADMAP.md`**.

### Stato Implementazione Onesto (Stub vs Reale)

Le seguenti sezioni indicano onestamente quali moduli usano implementazioni reali e quali usano stub deterministici:

| Modulo | Implementazione | Note |
|--------|----------------|------|
| F1 Patchboard | ✅ Reale | JSON Patch transazionale con permessi |
| F1 NS-Mem | ✅ Reale | 3 livelli con EMA (TF-IDF locale, no embeddings neurali) |
| F1 Sensorium | ✅ Reale | XML compilato dal Curator |
| F2 DynAMO | ✅ Reale | LLM (ZAI SDK) per generazione piani |
| F2 CompiledAI | ✅ Reale | LLM (ZAI SDK) + validazione 4-stadi sandbox |
| F3 ACTS | ✅ Reale | Controller rule-based deterministico |
| F4 LTL Monitor | 🟡 Parziale | 7 pattern FSM; no NFA per pattern composti |
| F4 Taint | ✅ Reale | Flow tracking + sink blocking (TTL in F23.4) |
| F4 Normative | ✅ Reale | Gerarchia SAFETY>OPERATIONAL>AESTHETIC |
| F5 ERL | ✅ Reale | Estrazione euristiche + Red Lines + RAG (TF-IDF) |
| F6 Context Manager | ✅ Reale | Ring buffer + summarization deterministica |
| F7 Dominator Trees | ✅ Reale | PTA + dataflow algorithm + coverage |
| F8 Lean4 | 🟡 Parziale | Verifica simbolica emulata, no runtime Lean4 reale |
| F9 Artificial Retainer | ✅ Reale | Delegation + HITL + Normative Calculus |
| F10 GroundedInference | 🟡 Stub | `simulateLLMOutput()` deterministico, no LLM reale |
| F11 Affect Monitor | ✅ Reale | Metriche telemetria + Meta-Observer |
| F12 Objective Builder | ✅ Reale | BFS decomposition con peso + context tier |
| F13 ESR + Quorum | ✅ Reale | Belief lineage + sync + quorum voting |
| F14 TimeRouter | 🟡 Stub | `scoreModels()` rule-based, `simulateModelOutput()` stub |
| F15 Cockpit | ✅ Reale | 5 tab + Sensorium widget + Affect gauge |
| F16 DAG Visualizer | ✅ Reale | React Flow con 3 visualizzatori integrati |
| F17 Sovereign Validator | 🟡 Parziale | `generateExplanation()` template-based, no LLM |
| F18 Tool Ecosystem | ✅ Reale | ECDSA P-256 signing + 10 scope permessi |
| F19 Quality | 🟡 Parziale | 146 test, 52% coverage (target 80%) |
| F20 Auth | 🟡 Parziale | Login + RBAC, no multi-tenant isolation |
| F21 Crypto | ✅ Reale | ECDSA P-256 con crypto nativo Node |
| F22 Observability | 🟡 Locale | Error/metrics/tracing/backup locali, no esterni |
| F23 Scalability | 🔴 Adapter | Pattern pronto, no migrazione reale (SQLite ancora) |
| T1 DAG Integration | ✅ Reale | 3/3 visualizer integrati |
| T2 i18n | 🟡 Base | 60+ chiavi, UI principale tradotta, messaggi parziali |
| T3 Dev Workflow | ✅ Reale | dev:clean, dev:full, db:backup, db:restore, UUID v7 |

### Aree di estensione

- **WebSocket service auto-start**: il mini-service WS deve essere avviato manualmente (`dev:full` lo automatizza parzialmente)
- **Time-Slider Audit Ledger**: componente per riavvolgere l'esecuzione cronologicamente (Fase 16, non implementato)
- **Indicatori cromatici Tainted**: bordo rosso tratteggiato per dati non fidati in tutto l'app (Fase 17, non implementato)
- **Embeddings neurali**: il TF-IDF locale funziona ma non ha comprensione semantica reale. Integrare modello locale o API esterna
- **LTL NFA compiler**: supportare `G(F(p))`, `F(G(p))`, `p W q`, `p R q` richiede NFA non implementato
- **Real LLM integration**: F10 (GroundedInference), F14 (TimeRouter), F17 (SovereignTranslator) usano stub. Integrare ZAI SDK
- **Multi-tenant isolation**: aggiungere `tenantId` a tutti i modelli DB + scoping automatico nelle query
- **PostgreSQL migration**: l'adapter pattern è pronto ma la migrazione reale richiede adattamento query SQLite-specific
- **Redis WS adapter**: l'interfaccia è pronta ma l'implementazione Redis reale non è stata fatta
- **Test coverage 80%**: 146 test coprono 52%, mancano API routes + E2E + cross-modulo
- **i18n completo**: 60+ chiavi sono insufficienti per tutte le 28 sezioni + messaggi + tooltips
- **Cockpit narrative auto-generation**: le voci narrative sono manuali, auto-generare da AgentLog via LLM
- **Containerizzazione**: Dockerfile + docker-compose per riproducibilità ambiente
- **Editor regole logiche DAG**: la Fase 1 mostra il DAG come lista. Un editor visuale con drag-and-drop sarebbe utile
- **Audit trail export**: esportare AgentLog in formato JSONL per analisi esterne

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
| SovereignModal non si apre            | Verifica `curl http://localhost:3000/api/blocked-actions?action=pending` per azioni pending |
| Cockpit tab vuoto                     | Genera eventi nella fase corrispondente (es. PlanTask per Scheduler) |
| Tool non installabile                 | Verifica che toolId sia univoco (non già installato) |
| React Flow non renderizza             | Verifica che `import 'reactflow/dist/style.css'` sia presente |

---

## Riferimenti

- **Blueprint originale**: 5 micro-fasi SOTA Agentic OS (convenzione con l'utente)
- **Blueprint integrativo 2**: Fasi 6-9 (Context Engineering, Dominator Trees, Lean4, Artificial Retainer)
- **Blueprint integrativo 3**: Fasi 10-14 (Grounded Inference, Affect, Objective, ESR, TimeRouter)
- **Blueprint integrativo 4**: Fasi 15-18 (Cockpit, Topological Observability, Sovereign Validator, Tool Ecosystem)
- **RFC 6902**: JSON Patch (subset implementato in `patchboard.ts`)
- **LTL**: Linear Temporal Logic — operatori G/F/X/U
- **FSM**: Finite State Machine (monitor runtime per LTL)
- **EMA**: Exponential Moving Average (anti-drift su NS-Mem)
- **DAG**: Directed Acyclic Graph (schedulazione topologica in `scheduler.ts`)
- **PTA**: Prefix Tree Automaton (Fase 7, fusion tracce)
- **Dominator Tree**: teoria dei compilatori per identificare nodi essenziali (Fase 7)
- **Lean4**: linguaggio formale a tipi dipendenti (Fase 8, emulato)
- **Belief Lineage**: tracciamento versioni convinzioni agenti (Fase 13)
- **Semantic Quorum**: consensus distribuito per Join DAG (Fase 13)
- **Artificial Retainer**: paradigma UI dove l'utente è mandante, non interlocutore (Fasi 9, 15)
- **Sovereign Validator**: ruolo umano di validazione con Axiom Trail (Fase 17)
- **React Flow**: libreria visualizzazione grafi interattivi (Fase 16)
- **Axiom Trail**: catena logica auditabile delle decisioni di sicurezza (Fasi 9, 17)

---

*Documentazione generata il 2026-06-20. Aggiornare ad ogni iterazione significativa.*
