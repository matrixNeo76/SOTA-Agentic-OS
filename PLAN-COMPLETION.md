# PIANO DI COMPLETAMENTO — Dalle funzionalità "che sembrano funzionare" a quelle reali

> Analisi fatta **eseguendo e leggendo il codice** (non i doc), su `claude/repo-audit-plan-3tf6or`.
> I 3 piani precedenti (`PLAN.md`, `PLAN-INTEROP.md`, `PLAN-UIUX.md`) sono in gran parte
> **realizzati**: l'executor durevole esiste ed è reale, l'auth M2M c'è, MCP espone i Run,
> A2A è collegato all'executor, c'è un worker che parte al boot. Ma restano **buchi precisi**
> dove un modulo *appare* funzionante (test verdi, UI presente, endpoint risponde) ma
> **non fa il lavoro reale** che promette. Questo piano elenca solo quei buchi e come chiuderli.

## Metodo dell'audit

Verificato leggendo i file sorgente, non i commenti:
- `src/lib/runtime/{executor,react-loop,tool-dispatcher,builtin-tools}.ts`
- `src/lib/{embeddings,llm-client/client}.ts`
- `src/lib/{world-model,digital-twin,autonomous-org,conflict-resolution}/`
- `src/lib/auth/api-key.ts`, `src/app/api/mcp/route.ts`, `src/lib/a2a/protocol.ts`
- `src/instrumentation.ts`, `src/lib/kernel/scalability.ts`, `src/lib/skill-sandbox/sandbox.ts`
- `src/app/api/admin/settings/route.ts`, `src/lib/db.ts`

## Cosa è REALE (da non rifare)

- **Executor durevole** (`runtime/executor.ts`): plan generation via LLM reale, state machine
  persistente su DB, `topologicalBatches` con dispatch parallelo (`Promise.all`), checkpoint
  per task, `recoverOrphanedPlans()` al boot, journal su `ExecutionTrace`. **Funziona davvero.**
- **ReAct loop** (`runtime/react-loop.ts`): tool-calling nativo ZAI/GLM, OBSERVE reale, fallback testo.
- **Builtin tools** (7): `filesystem.read/write/list`, `http.fetch`, `memory.search`, `graph.query`,
  `web.search` — **eseguono davvero** (fs reale, fetch reale).
- **Worker** (`scalability.startWorker`) avviato da `instrumentation.ts`, processa `execute_plan`/`recover_plan`.
- **Auth M2M** (`auth/api-key.ts`): API key `sak_*` con SHA-256, scopes read/exec/admin, fallback sessione.
- **MCP**: espone `sota_run_create/list/detail/recover` (non solo stato) + auth via `requireApiAuth`.
- **A2A** (`a2a/protocol.ts`): task lifecycle mappato su `startExecution({ async: true })`.

---

## I BUCHI REALI (in ordine di priorità)

### C0 — Residui ambiente z-ai hardcoded (rompono portabilità ed esecuzione) — **P0**

Path `/home/z/my-project` (inesistente in questo ambiente) ancora hardcoded in:
- `src/lib/db.ts` → `DEFAULT_SQLITE_PATH = '/home/z/my-project/db/custom.db'` (default su path inesistente)
- `src/lib/runtime/builtin-tools.ts` → `ALLOWED_READ_PATHS`/`ALLOWED_WRITE_PATHS` default a `/home/z/my-project/...`
  → **i filesystem tool di default puntano a cartelle inesistenti**: ogni `filesystem.read/write`
  fuori da `/tmp` fallisce silenziosamente.
- `src/lib/kernel/observability.ts`, `src/app/api/admin/settings/route.ts`, `.env`

**Fix:** derivare i default dalla repo (`process.cwd()`) o da env; `db.ts` default a `./db/custom.db`
relativo; `builtin-tools` default a `cwd`+`/tmp`+`upload/download`. Validazione fail-fast all'avvio.
**Accettazione:** clone pulito su qualsiasi macchina → app parte, filesystem tool leggono/scrivono
in path reali, nessun riferimento a `/home/z`.

### C1 — Moduli "AGI" sono euristiche rule-based, non ragionamento LLM — **P0 (il cuore del problema)**

Il file `llm-client/client.ts` definisce helper LLM per questi moduli, ma **i moduli non li chiamano**.
Solo 4 file importano `llm-client`: `cognitive-router`, `kernel/erl`, `skill-synthesis`, e il client stesso.
Conseguenza: ciò che è venduto come "World Model / Digital Twin / Autonomous Org / Conflict Resolution"
sono **catene di `if/else` su soglie numeriche** — sembrano AI (producono nodi, predizioni, proposte)
ma non ragionano.

| Modulo | Stato reale | Funzione LLM esistente ma **mai chiamata** |
|---|---|---|
| `world-model/engine.ts` | `runRuleBasedPredictor` (6 regole a soglia) | `generatePredictionWithLLM` → **dead code** |
| `conflict-resolution/engine.ts` | confronto numerico di `confidence` | `explainConflictResolutionWithLLM` → **dead code** |
| `digital-twin/engine.ts` | `projectMetrics` rule-based, CI ±15% fissi | nessuna |
| `autonomous-org/governor.ts` | `generateAutoProposals` (5 regole) | nessuna |
| `agent-mesh/topology.ts` | `requestPeerQuorum` vota su keyword | nessuna |

**Fix:** collegare ogni modulo a `llmComplete()` con il pattern già esistente (LLM primario +
fallback rule-based deterministico). Concretamente:
- world-model: chiamare `generatePredictionWithLLM` dentro `runRuleBasedPredictor` (o un nuovo
  `runPredictor`) e usare le regole solo come fallback.
- conflict-resolution: chiamare `explainConflictResolutionWithLLM` in `resolveConflict` per la
  spiegazione, e opzionalmente un giudizio LLM quando le confidence sono vicine.
- digital-twin: usare LLM per stimare l'impatto dello scenario (con le regole come prior/fallback).
- autonomous-org: usare LLM per generare/prioritizzare proposte dai segnali del WorldState.
**Accettazione:** con LLM disponibile, l'output di questi moduli cambia col contenuto (non solo
con le soglie); con LLM spento, fallback rule-based identico a oggi (zero regressioni nei test).
Rimuovere o cablare il dead code di `client.ts`.

### C2 — Tool esterni (registrati / MCP) non eseguono — **P1**

- `tool-dispatcher.executeRegistered()` ritorna **sempre** errore: *"Registered tool has no
  execution endpoint configured"*. Quindi **solo i 7 builtin funzionano**; qualunque tool
  registrato nel Tool Ecosystem (DB `Tool`) è inerte.
- Esiste `src/lib/mcp-client/client.ts` (client MCP) ma **non è collegato** al dispatcher
  (commento esplicito: *"WS1.4d aggiungerà supporto MCP client"*).

**Fix:** in `executeRegistered`, leggere un campo `endpoint`/`transport` dal record `Tool`
(aggiungere allo schema se manca) e: (a) `kind=http` → `fetch` con timeout/scope; (b) `kind=mcp`
→ usare `mcp-client` per `tools/call` sul server esterno. Audit invariato.
**Accettazione:** registro un tool HTTP e un tool MCP dal pannello, l'agente li chiama nel ReAct
loop e ne riceve il risultato reale.

### C3 — Embeddings non semantici (TF-IDF locale) — **P1**

`embeddings.ts` = hashing TF-IDF 256-dim + dizionario di alias hardcoded. Similarità debole,
dipendente dall'ortografia/alias, non dal significato. `vector-store` è pronto a ricevere un
embedder reale ma **nessuno è collegato**. Su SQLite la ricerca vettoriale è lineare.

**Fix:** introdurre un `EmbeddingProvider` selezionabile via env:
- default `local` (l'attuale TF-IDF, zero-config);
- `ollama` (bge-m3 / nomic-embed) o API (OpenAI/voyage) quando configurato.
Cablare in `vector-store.storeEmbedding` + `recomputeAllEmbeddings`. Gestire dimensione variabile.
**Accettazione:** con provider reale attivo, due testi sinonimi ma senza parole comuni hanno
cosine > 0.6; con `local`, comportamento odierno invariato.

### C4 — Skill sandbox senza isolamento reale — **P2**

`skill-sandbox/sandbox.ts` è `try/catch` + regex su pattern proibiti (ammesso nei commenti).
Una skill non fidata gira **nello stesso processo** con accesso pieno.

**Fix:** eseguire la skill in `worker_threads`/`node:vm` con timeout, memoria limitata, e
whitelist tool reale. Mantenere l'API `runSkillInSandbox` invariata.
**Accettazione:** una skill che tenta `require('fs')`/loop infinito/over-memory viene terminata
e isolata, non impatta il processo principale.

### C5 — MCP server: manca il transport Streamable HTTP/SSE — **P2**

`/api/mcp` è solo **POST request/response** JSON-RPC. I client MCP standard (Claude Desktop,
Cursor, VS Code) si aspettano **Streamable HTTP** (handshake, session id, notifiche) o stdio.
Auth e tool giusti ci sono già — manca solo il transport, quindi serve glue per connettersi.

**Fix:** aggiungere risposta `text/event-stream` con session id e endpoint event; pubblicare un
piccolo bridge **stdio** (`scripts/mcp-stdio.ts`) per le config locali di Claude Code/Desktop.
**Accettazione:** aggiungo l'OS come server MCP in Claude Code con URL+token (o comando stdio)
senza glue custom e i tool compaiono nativamente.

### C6 — Admin/Settings: lettura sì, scrittura no — **P2**

`GET /api/admin/settings` legge config **live** (provider DB, LLM health, mesh, integration).
Ma la config è **basata su env**: il POST non può cambiarla a runtime → la UI "salva" ciò che
non persiste senza restart.

**Fix:** introdurre una tabella `SystemSetting` (key/value) come override runtime; loader che
fa merge `DB-override > env > default`; le sezioni mutabili (modello LLM default, backend mesh,
Langfuse on/off, tool paths) diventano davvero scrivibili. Restano read-only solo quelle che
richiedono restart (es. `DATABASE_URL`), marcate come tali.
**Accettazione:** cambio il modello LLM default da UI, l'esecuzione successiva lo usa senza restart.

### C7 — Postgres/pgvector parziale & test crash/resume mancante — **P3**

- `prisma/schema.postgres.prisma` copre ~15 modelli vs 67 dello schema SQLite → la modalità
  Postgres+pgvector reale non è completa; il vector search nativo non è esercitato.
- I ~514 test coprono i moduli ma **non** il percorso end-to-end **kill → resume** dell'executor
  (proprio la promessa centrale del sistema).

**Fix:** completare `schema.postgres.prisma` (generarlo dallo schema SQLite con annotazioni
`vector`), e aggiungere un test e2e che: avvia un piano, simula crash a metà batch (orphan
`running`), invoca `recoverOrphanedPlans`, verifica che i task `done` non vengano rieseguiti e
il piano completi.
**Accettazione:** test e2e crash/resume verde; `db:push` su Postgres con schema completo.

---

## Sequenza consigliata

1. **C0** (mezza giornata) — sblocca l'esecuzione reale dei filesystem tool e la portabilità. Prerequisito.
2. **C1** — rende "intelligenti" i moduli che oggi fingono. È il valore percepito mancante.
3. **C2** — rende utili i tool esterni (oltre ai 7 builtin).
4. **C3** — memoria semantica reale (migliora retrieval, GraphRAG, conflict detection).
5. **C5 + C6** — interop plug-and-play e admin davvero operativo.
6. **C4 + C7** — hardening (isolamento) e durabilità verificata + scaling Postgres.

## Principio trasversale: "reale con fallback"

Ogni fix deve preservare il pattern già usato in `llm-client`: **capacità reale quando le
dipendenze (LLM/embedder/Postgres) sono disponibili, fallback deterministico identico a oggi
quando non lo sono**. Così i ~514 test restano verdi e l'app gira zero-config in dev, ma in
produzione le funzionalità diventano realmente operative.

## Note di verifica

- `node_modules` non è presente nel checkout corrente di questo ambiente → build/test non
  eseguiti qui; i numeri (514 test, 0 TS error nei moduli) provengono dai worklog e vanno
  riconfermati con `bun install && bun test` prima del merge.
- I `Math.random()` trovati nei moduli core (world-model, digital-twin, evaluation, conflict)
  sono **solo generazione di ID** — non metriche fasulle. Le metriche fasulle sono altrove:
  le **euristiche rule-based** di C1.
</content>
</invoke>
