# PIANO — Da control-plane a OS agentico eseguibile e durevole

> Stato analizzato eseguendo il codice (non solo i doc): 533/533 test pass, `src/`
> 0 errori TypeScript. Infrastruttura (memoria, governance, pianificazione,
> checkpointing, observability) **già presente e testata**. Manca il **motore di
> esecuzione durevole** che trasforma i piani in lavoro reale e riprende dopo
> un'interruzione.

## Contesto verificato (cosa esiste già)

- `/api/console` **è già un esecutore reale**, ma con limiti strutturali:
  - esegue **sincronamente dentro una singola richiesta HTTP** (`for` loop sui
    task) → se il processo/req si interrompe, **tutto è perso, nessun resume**;
  - **non** chiama i checkpoint (`autoCheckpoint`/`resumeFromCheckpoint` esistono
    in `src/lib/checkpoint/checkpoint.ts` ma non sono collegati qui);
  - **non esegue tool reali**: `executeTaskWithLLM` produce solo testo dell'LLM,
    niente loop ReAct né dispatch di tool;
  - ignora i `topologicalBatches` (esegue in serie, niente parallelismo reale);
  - essendo request-scoped, va in timeout sui workflow lunghi.
- `tool-registry.ts` = solo permessi/catalogo, **non esegue** tool.
- `scalability.ts` ha `startWorker` ma **non viene mai avviato** (nessun
  `instrumentation.ts`).
- `checkpoint.ts` ha `resume`/`rollback` ma dichiara "For now: return the state
  for the caller to apply" — **non esiste un caller**.

Conclusione: il motore non va costruito da zero, ma **evoluto** da questa base.

---

## Workstream 0 — Sblocco produzione (quick wins, 0 logica nuova)

### 0.1 — Fix build (redis/nats)
- In `next.config.ts`: marcare `redis` e `nats` come pacchetti esterni
  server-side (`serverExternalPackages`) **oppure** dichiararli
  `optionalDependencies` in `package.json`. Così l'`import()` dinamico con
  `.catch()` in `src/lib/event-mesh/mesh.ts` non rompe più il bundling.
- **Accettazione:** `next build` esce 0 in un checkout pulito senza redis/nats
  installati.

### 0.2 — DB path configurabile (default attuale, override possibile)
- Eliminare l'hardcode `DB_PATH = '/home/z/my-project/db/custom.db'` in
  `src/lib/db.ts` e il path fisso in `.env`.
- Nuova logica: leggere da `DATABASE_URL`; se assente, **default = il path z-ai
  attuale** (retro-compatibile). Derivare il path-per-inode dalla stessa URL
  invece che da una costante.
- Aggiungere `.env.example` documentato + validazione fail-fast all'avvio.
- **Accettazione:** l'app gira sia col default z-ai (zero config) sia con
  `DATABASE_URL` custom (sqlite o postgres) senza toccare il codice.

---

## Workstream 1 — Runtime Executor durevole (IL motore — priorità assoluta)

Obiettivo: da "loop dentro una request" a "macchina a stati persistente,
ripartibile, con tool reali".

### 1.1 — Estrarre l'esecutore dalla route
- Spostare la logica da `/api/console` in `src/lib/runtime/executor.ts`. La route
  diventa thin trigger ("avvia/osserva"), non "esegue".

### 1.2 — Macchina a stati persistente sui `PlanTask`
- Usare `topologicalBatches` per il dispatch (parallelismo reale dei task
  indipendenti), non più l'ordine lineare.
- Ogni transizione di stato (`ready → running → done/failed/blocked`) scritta su
  DB **prima** di procedere → lo stato vive nel DB, non nel processo.

### 1.3 — Checkpoint wiring + recovery al boot (requisito "resistere alle interruzioni")
- Chiamare `autoCheckpoint` ad ogni step/tool-call (task corrente, batch, output
  parziali).
- **Recovery boot:** all'avvio del worker, scansionare i task `running` orfani e
  ripartire via `resumeFromCheckpoint` **dall'ultimo step**, non da capo.
- **Idempotenza:** ogni step con id deterministico così il replay non duplica
  effetti.
- **Event journal append-only:** registrare ogni output non-deterministico
  (risposte LLM, risultati tool) usando i modelli esistenti
  `ExecutionTrace`/`PrefixTreeAutomaton` come log di replay → ripartenza
  bit-identica.
- **Accettazione:** killare il processo a metà workflow; al riavvio il workflow
  riprende e completa senza rieseguire i task già fatti.

### 1.4 — Esecuzione reale dei tool (loop ReAct)
- Sostituire `executeTaskWithLLM` (solo testo) con loop **pensa → chiama tool →
  osserva → ripeti**, usando il tool-calling dell'LLM (ZAI/GLM).
- Dispatcher di esecuzione tool reale: collegare permessi (`tool-registry`) →
  esecuzione effettiva (function/HTTP/MCP client), dentro la sandbox.
- Rinforzare `skill-sandbox` (oggi try/catch) con isolamento vero
  (`worker_threads`/VM + timeout + limiti) per i tool non fidati.
- **MCP client** (oggi siete solo MCP *server*): permettere all'esecutore di
  orchestrare tool MCP esterni.
- **Accettazione:** un task tipo "leggi X e scrivi Y" esegue davvero la
  lettura/scrittura via tool, non descrive soltanto.

### 1.5 — Worker persistente + bootstrap
- Creare `instrumentation.ts` (o processo separato `dev:full`) che all'avvio
  accenda: job worker (`startWorker`, oggi mai avviato), GC scheduler,
  integration layer, recovery boot.
- Coda durevole sui `JobRecord` esistenti; backend selezionabile (in-memory
  default, Redis/NATS in prod via env).
- **Accettazione:** avvii il server e il worker processa la coda autonomamente,
  visibile in `/api/jobs`.

---

## Workstream 2 — Pannello Admin & Settings (la UI che oggi fa poco)

Oggi esiste solo `tool-manager.tsx` e le pagine `/`, `/autonomous`, `/login`.

### 2.1 — Nuova sezione `/admin` (auth role-gated)
- **Settings generali:** `DATABASE_URL`, provider LLM/modello default, chiavi
  (z-ai/GLM, opzionale OpenAI/Anthropic), backend event-mesh
  (in-memory/Redis/NATS), Langfuse on/off — leggibili/scrivibili da UI.
- **Tool & Permessi:** evolvere `tool-manager` per registrare tool *eseguibili*
  (endpoint/MCP), impostare scope/permessi, testare un tool dal pannello.
- **Runtime/Workers:** stato worker, coda job, task `running`/orfani, pulsanti
  start/stop/recover, lista checkpoint con resume/rollback manuale.
- **Governance:** gestione RedLine/NormativeRule/ApprovalGate da UI.
- **Memoria:** browser del Context Graph + ricerca semantica + GC manuale.
- **Utenti/Tenant:** gestione utenti, ruoli, multi-tenant (oggi abbozzato).
- **Accettazione:** un admin configura DB, LLM, tool e avvia/recupera workflow
  **senza toccare file**.

### 2.2 — Observability live
- Stream in tempo reale dell'esecuzione (eventi `publishAgentEvent` già esistono
  via WS) con HITL: interrompere, approvare, correggere un workflow a metà run.

---

## Sequenza consigliata e dipendenze

1. **WS0** (~mezza giornata) → sblocca build e deploy. Prerequisito per tutto.
2. **WS1.1–1.3** → cuore: executor durevole + resume. Valore principale per
   "workflow + interruzioni".
3. **WS1.4** → tool reali (rende i workflow *utili*, non solo testo).
4. **WS1.5** → worker autonomo (rende l'OS *sempre attivo*).
5. **WS2** → pannello admin (rende tutto *governabile* senza dev).

WS0 e l'impalcatura di WS2 sono indipendenti e parallelizzabili; WS1.3 dipende da
1.2; WS1.4 da 1.1.

## Bivio architetturale (decisione del team)
Durabilità in WS1.3, due strade:
- **(A)** costruire il durable execution sul DB/journal esistente — più
  controllo, più codice. *(Il piano assume A perché riusa ciò che c'è.)*
- **(B)** integrare un motore durevole esterno (Temporal/Restate) usando il
  sistema come layer memoria+governance — meno codice core, +1 dipendenza infra.

---

## Gap residui per il "vero SOTA" (oltre WS0–WS2)
- **Embeddings reali**: oggi TF-IDF/hashing locale a 256 dim (similarità debole);
  l'interfaccia `vector-store` è pronta a ricevere un embedder reale
  (Ollama/bge o API).
- **Migrazione pgvector reale**: `schema.postgres.prisma` è parziale (15 modelli
  vs 67); su SQLite il vector search è lineare → non scala.
- **Hardening sicurezza**: sandbox vera, secrets management, rate limiting,
  multi-tenant completo.
- **Test sull'executor**: i 533 test coprono i moduli infrastrutturali;
  l'esecutore durevole va coperto end-to-end (incluso il crash/resume).
- **Errori TypeScript nei test** (13, in 6 file) — non bloccano il runtime
  (vitest transpila senza typecheck) ma andrebbero sistemati.
</content>
</invoke>
