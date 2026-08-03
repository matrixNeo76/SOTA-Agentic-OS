# Blueprint Integrativo 5 — Production Hardening & Quality Gates
**Versione**: 0.6.0 · **Data**: 2026-06-20 · **Obiettivo**: colmare il gap tra "demo tecnica" e "sistema production-ready"

> Salvato come riferimento per implementazione incrementale. Questo blueprint è ortogonale alle 18 fasi esistenti: non modifica l'architettura cognitiva, aggiunge il layer di hardening per deployment reali.

---

## 📋 Premessa Strategica

L'analisi critica di v0.5.0 ha identificato **5 macro-aree di lacuna** che impediscono al sistema di essere deployato in ambienti reali:

| Area | Criticità | Impatto operativo |
|------|-----------|-------------------|
| **Quality Assurance** | Zero test automatici | Regressioni silenziose, refactoring pericoloso |
| **Security Production** | Auth assente, signing simulato, taint senza TTL | Single-tenant forzato, vulnerabilità supply-chain |
| **Scalability** | SQLite single-writer, WS single-instance | Collasso sotto carico concorrente |
| **Observability** | Nessun error tracking, backup, monitoring | Blind spot operativi, data loss |
| **UX Integration** | DAG visualizer non integrati, UI solo IT | Valore architetturale non sfruttato |

Questo blueprint introduce **5 nuove micro-fasi (19-23)** + **3 miglioramenti trasversali** per trasformare il prototipo in un OS agentico production-grade, senza alterare l'architettura esistente delle 18 fasi.

---

## 🎯 Tabella Sinottica

| Fase | Nome | Dominio | Risolve | Priorità |
|------|------|---------|---------|----------|
| **19** | Quality Infrastructure | Testing & CI | Zero test automatici | 🔴 P0 |
| **20** | Authentication & Multi-Tenancy | Identity & Access | Auth assente, single-tenant | 🔴 P0 |
| **21** | Cryptographic Trust Layer | Supply-chain security | Signing/emulazioni fragili | 🟡 P1 |
| **22** | Production Observability Stack | Monitoring & DR | Blind spot operativi | 🟡 P1 |
| **23** | Scalability & Persistence | Infrastructure | SQLite/WS bottleneck | 🟢 P2 |

**Trasversali**:
- **T1**: DAG Visualizer Integration (UX)
- **T2**: Internationalization (i18n it/en)
- **T3**: Developer Workflow Hardening (DX)

---

## 🔷 Fase 19 — Quality Infrastructure

### Obiettivo
Eliminare il rischio di regressioni silenziose con una suite di test automatizzati a 3 livelli (unit, integration, E2E) e gate CI obbligatori.

### Componenti logici
- **Test Runner** — framework nativo TypeScript con supporto ESM, parallel execution, coverage nativa
- **Browser Test Harness** — automazione browser per flussi UI critici (Cockpit, Sovereign Modal, Tool Manager)
- **Coverage Reporter** — soglie minime per categoria: kernel ≥ 80%, API ≥ 60%, UI ≥ 50%
- **Test Fixtures Registry** — dataset deterministici per LTL formulas, agent events, mock plans
- **CI Gate Enforcer** — blocco merge se coverage scende sotto soglia o test falliscono

### Moduli kernel da testare (priorità decrescente)
| Modulo | Tipo test | Casi critici |
|--------|-----------|--------------|
| LTL Monitor | Unit | Parser AST, FSM compilation, 7 pattern, idempotenza init |
| Patchboard | Unit + Integration | JSON Patch validation, permission scoping, atomicity, replay |
| Normative | Unit | Gerarchia SAFETY>OPERATIONAL>AESTHETIC, tie-breaking |
| Taint | Unit | Flow propagation, sink blocking, TTL expiry |
| ERL | Unit | Red line enforcement, heuristic extraction, RAG retrieval |
| Sovereign Translator | Unit | LTL→IT translation, axiom trail generation |
| Artificial Retainer | Integration | Delegation check, normative resolution, gate lifecycle |

### Livelli di test
- **Unit** — moduli kernel isolati, mock DB e dipendenze esterne
- **Integration** — API routes con DB reale (test container o in-memory), flussi cross-modulo
- **E2E** — flussi utente completi: "blocca azione → sovereign resolve", "LTL violation → halt", "tool install → permission grant"

### Gate CI obbligatori
- Coverage kernel ≥ 80%
- Coverage API ≥ 60%
- Zero test failing
- Lint pulito
- Build production senza warning

### Criteri di verifica
- Esecuzione completa suite in < 60 secondi
- Coverage report generato ad ogni run
- Test riproducibili deterministicamente (no flaky tests)

---

## 🔷 Fase 20 — Authentication & Multi-Tenancy

### Obiettivo
Rendere il sistema multi-user con ruoli, audit autenticato, e isolamento tenant per deployment SaaS.

### Componenti logici
- **Identity Provider** — gestione credenziali (email/password + OAuth provider pluggabili)
- **Session Manager** — token stateless con refresh rotation, revoca immediata
- **RBAC Engine** — 4 ruoli gerarchici (Admin, Operator, Viewer, Sovereign) con permission matrix
- **Tenant Isolator** — scoping automatico di tutte le query DB per tenantId
- **Audit Logger** — tracciamento autenticato di ogni azione (userId, action, resource, outcome, IP)
- **Route Protector** — middleware che intercetta tutte le route e verifica sessione + ruolo + tenant

### Modello ruoli
| Ruolo | Permessi |
|-------|----------|
| **Admin** | Full control, user management, tenant config, audit review |
| **Operator** | Execute actions, approve gates, view all phases |
| **Viewer** | Read-only access a tutte le fasi |
| **Sovereign** | Risolvere blocked actions (subset di Operator con privilegio specifico) |

### Flusso autenticazione
1. Utente → login page → credentials validate
2. Sessione creata → token HttpOnly cookie + CSRF token
3. Middleware intercetta ogni request → verifica token valido + ruolo appropriato + tenant matching
4. Ogni operazione kernel riceve `context.userId` e `context.tenantId` per audit e scoping
5. Logout → token revocato immediatamente (blacklist in-memory con TTL)

### Migrazione dati esistenti
- Tutti i record esistenti assegnati a tenant `default`
- Seed iniziale crea user admin con credenziali generate
- Campo `actor` nelle PatchTransaction mappato a `userId` autenticato
- Backfill audit trail per operazioni pre-auth (marker `legacy`)

### Criteri di verifica
- Accesso senza auth → 401 su tutte le route protette
- Viewer non può eseguire azioni write
- Tenant A non vede dati di Tenant B
- Audit trail contiene userId per ogni operazione post-migrazione

---

## 🔷 Fase 21 — Cryptographic Trust Layer

### Obiettivo
Sostituire le emulazioni crittografiche con implementazioni reali production-grade, eliminando i vettori di attacco supply-chain.

### 21.1 — Real Tool Signing

**Stato attuale**: signature SHA-256 di stringa concatenata → falsificabile da chiunque conosca l'algoritmo.

**Target**: firma asimmetrica ECDSA con keypair per-publisher.

**Componenti logici**:
- **KeyPair Generator** — generazione curva P-256 per ogni publisher registrato
- **Manifest Signer** — firma del tool manifest (toolId, name, version, publisher, permissions) con chiave privata
- **Signature Verifier** — verifica con chiave pubblica del publisher prima dell'installazione
- **Publisher Registry** — storage chiavi pubbliche con fingerprint e stato revoca
- **Key Rotation** — supporto per multiple chiavi attive per publisher con graceful deprecation

**Flusso installazione tool**:
1. Publisher genera keypair → pubblica pubblica sul registry
2. Publisher firma manifest → distribuisce tool + signature
3. Utente installa → OS verifica signature con chiave pubblica registry
4. Se verifica fallisce → installazione bloccata, evento audit `tool_install_rejected`
5. Se publisher revocato → tutti i tool di quel publisher marcati `untrusted`

### 21.2 — Real Semantic Embeddings

**Stato attuale**: TF-IDF 256-dim con dizionario 80 alias → nessuna comprensione semantica reale.

**Target**: embeddings neurali locali con fallback a provider esterni.

**Componenti logici**:
- **Local Embedding Engine** — modello lightweight (384-dim) eseguito on-device via runtime WASM/native
- **Remote Embedding Adapter** — interfaccia pluggabile per provider esterni (OpenAI, Cohere, etc.)
- **Embedding Router** — decide local vs remote based on: costo, latenza, privacy policy, qualità richiesta
- **Migration Tool** — ricalcolo massivo embeddings esistenti quando cambia il modello
- **Similarity Threshold Calibrator** — auto-calibrazione soglie cosine similarity su dataset di riferimento

**Strategia ibrida**:
- Task interni (RAG euristiche, memory search) → embeddings locali (zero costo, zero latenza)
- Task esterni (tool semantic matching, user query understanding) → embeddings remoti (qualità superiore)
- Fallback automatico: se remoto unavailable → locale con warning audit

### 21.3 — LTL NFA Compiler

**Stato attuale**: 7 pattern LTL semplici supportati, nessun annidamento.

**Target**: supporto completo LTL con NFA (Non-deterministic Finite Automata).

**Componenti logici**:
- **Full LTL Parser** — supporto operatori composti: `G(F(p))`, `F(G(p))`, `p W q` (weak until), `p R q` (release)
- **NFA Compiler** — traduzione AST → NFA con costruzione tableau
- **NFA Simulator** — esecuzione evento-by-evento con mantenimento stato corrente
- **Optimization Layer** — minimizzazione NFA per ridurre overhead runtime
- **Backward Compatibility** — i 7 pattern esistenti mappati su NFA equivalenti (zero breaking change)

**Criteri di verifica**:
- Tool installato con signature invalida → bloccato
- Embedding remoto fallisce → fallback locale trasparente
- Formula `G(F(p))` valutata correttamente su sequenza eventi

---

## 🔷 Fase 22 — Production Observability Stack

### Obiettivo
Eliminare i blind spot operativi con error tracking, metriche, tracing distribuito, e disaster recovery.

### 22.1 — Error Tracking

**Componenti logici**:
- **Error Collector** — intercetta errori non gestiti (kernel, API, UI) con stack trace completo
- **Deduplicator** — raggruppa errori identici per evitare flood
- **Context Enricher** — aggiunge a ogni errore: userId, tenantId, phase, cycleId, recent agent events
- **Alerting Router** — notifica canali (email, webhook, Slack) basata su severity e frequenza
- **Resolution Tracker** — stato errore (open, acknowledged, resolved) con assegnazione owner

**Integrazione kernel**:
- Ogni `try/catch` nelle API routes pubblica errore al collector
- Kernel modules wrappati da error boundary che cattura eccezioni non gestite
- UI errori catturati da error boundary React con report automatico

### 22.2 — Metrics & Telemetry

**Componenti logici**:
- **Metrics Exporter** — esposizione metriche in formato standard (Prometheus-compatible)
- **Metric Categories**:
  - **System**: CPU, memory, DB connections, WS clients
  - **Business**: cycles/min, actions blocked, gates resolved, LTL violations
  - **Quality**: test coverage, error rate, p95 latency
  - **Affective**: desperation/frustration avg, halt events
- **Time-Series Storage** — retention configurabile (7d granular, 90d aggregated)
- **Dashboard Templates** — viste preconfigurate per: operations, security, product

### 22.3 — Distributed Tracing

**Componenti logici**:
- **Trace Propagator** — genera traceId all'ingresso API, propaga attraverso kernel modules
- **Span Collector** — ogni operazione kernel (LTL verify, patchboard apply, sovereign resolve) genera span
- **Trace Visualizer** — UI per esplorare trace complete con waterfall view
- **Sampling Strategy** — 100% per errori, 10% per successo (configurabile)

**Flusso tracing**:
1. Request arriva → traceId generato
2. Ogni chiamata kernel → span creato con parent traceId
3. Span pubblicati su collector con timing, metadata, status
4. UI permette query: "mostra tutte le trace con errore negli ultimi 1h"

### 22.4 — Backup & Disaster Recovery

**Componenti logici**:
- **Automated Backup Scheduler** — cron job con frequenza configurabile (default: ogni 6h)
- **Backup Validator** — verifica integrità backup (checksum + test restore su DB temporaneo)
- **Retention Policy** — mantiene ultime N backup (default: 7 giornalieri, 4 settimanali)
- **Point-in-Time Recovery** — restore a timestamp specifico usando backup + WAL (Write-Ahead Log)
- **Off-site Replication** — copia backup su storage remoto (S3-compatible)

**Criteri di verifica**:
- Errore non gestito → report creato in < 5s
- Metriche esposte e scrape-abili
- Trace completa visibile per ogni request
- Backup restaurato con zero data loss

---

## 🔷 Fase 23 — Scalability & Persistence

### Obiettivo
Rimuovere i colli di bottiglia infrastrutturali per supportare carico concorrente e horizontal scaling.

### 23.1 — Database Migration (SQLite → PostgreSQL)

**Stato attuale**: SQLite single-writer, lock contention sotto carico, no replication.

**Target**: PostgreSQL con connection pooling, replication, e failover automatico.

**Componenti logici**:
- **Schema Translator** — conversione automatica schema Prisma da SQLite a PostgreSQL (tipi, indici, vincoli)
- **Migration Tool** — trasferimento dati esistenti con validazione integrità
- **Connection Pooler** — gestione pool connessioni con reuse e timeout
- **Read Replica Router** — routing query read-only su repliche, write su primary
- **Failover Handler** — promozione automatica replica se primary down

**Vantaggi**:
- Multiple writers concorrenti (no lock contention)
- Replication per disaster recovery
- Query optimization avanzata
- Supporto JSON nativo per GlobalState

### 23.2 — WebSocket Horizontal Scaling

**Stato attuale**: Socket.io single-instance, se crasha perde tutti i client.

**Target**: Socket.io cluster con pub/sub backend.

**Componenti logici**:
- **Pub/Sub Adapter** — bridge tra Socket.io e message broker (Redis-compatible)
- **Session Store** — stato sessioni WebSocket condiviso tra istanze
- **Load Balancer** — distribuzione client su multiple istanze WS (sticky sessions)
- **Health Checker** — monitoraggio istanze WS, rimozione automatica se unhealthy
- **Graceful Shutdown** — drain connessioni prima di terminare istanza

**Architettura cluster**:
- N istanze WS dietro load balancer
- Tutte collegate al medesimo pub/sub broker
- Publish da Next.js → broker → broadcast a tutte le istanze → client connessi
- Se istanza crasha → client reconnect su altra istanza (transparent)

### 23.3 — Job Queue & Background Processing

**Componenti logici**:
- **Job Queue** — accodamento operazioni asincrone (embeddings recompute, summarization, backup)
- **Worker Pool** — esecuzione parallela job con concurrency configurabile
- **Retry Strategy** — retry esponenziale con dead letter queue per job falliti
- **Priority Queue** — job critici (sovereign resolve) precedono job batch (embeddings)
- **Job Monitor** — UI per visualizzare coda, job in esecuzione, falliti

**Job migrati da sincroni ad asincroni**:
- `recomputeAllEmbeddings` → job batch con progress reporting
- `summarizeAndEvict` → job triggered da threshold
- Backup scheduler → job ricorrente
- LTL FSM persistence → job periodico checkpoint

### 23.4 — FSM & Taint Persistence

**Stato attuale**: FSM LTL e taint flows in-memory → persi al riavvio.

**Target**: persistenza su DB con checkpoint periodici.

**Componenti logici**:
- **FSM Snapshotter** — serializzazione stato FSM su DB ogni N eventi o ogni M secondi
- **FSM Restorer** — caricamento stato FSM da DB all'avvio
- **Taint TTL Manager** — scadenza automatica taint flows dopo TTL configurabile (default: 1h)
- **Taint Cleanup Job** — rimozione periodica taint expired

**Criteri di verifica**:
- Riavvio server → FSM stato ripristinato identico
- 100 client concorrenti → zero lock contention
- 10 istanze WS → broadcast sincrono
- Job queue → zero job persi su crash worker

---

## 🔷 Trasversale T1 — DAG Visualizer Integration

### Obiettivo
Sfruttare i 3 visualizzatori React Flow già implementati integrandoli nelle pagine di fase corrispondenti.

### Integrazioni
| Pagina attuale | Componente da integrare | Sostituisce |
|----------------|------------------------|-------------|
| Phase2 (DynAMO Planner) | `DynAMODagVisualizer` | Lista testuale task |
| Phase8 (Lean4 Verification) | `LeanWorkflowVisualizer` | Lista testuale workflow |
| Phase12 (AgentObjective) | `ObjectiveTreeVisualizer` | Lista testuale rubriche |

### Modalità integrazione
- **Layout split**: visualizer a sinistra (60%), dettagli/controlli a destra (40%)
- **Interazione bidirezionale**: click nodo visualizer → highlight dettaglio; click dettaglio → zoom nodo visualizer
- **Filtri sincronizzati**: filtro stato (done/running/failed) applicato sia a lista che a grafo
- **Fallback**: se React Flow non renderizza (errore), mostra lista testuale come fallback

### Criteri di verifica
- Tutte le 3 pagine mostrano grafo interattivo di default
- Click nodo → dettaglio aggiornato < 100ms
- Filtro stato → grafo e lista sincronizzati

---

## 🔷 Trasversale T2 — Internationalization (i18n)

### Obiettivo
Supportare multiple lingue (IT + EN come default) per apertura a community internazionale.

### Componenti logici
- **Translation Registry** — storage coppie key-value per ogni lingua
- **Translation Keys** — identificatori stabili indipendenti dalla lingua (es. `phase1.title`, `cockpit.tab.narrative`)
- **Language Detector** — rilevamento lingua preferita (browser, user preference, URL)
- **Language Switcher** — UI per cambio lingua runtime (persistito in user preferences)
- **Fallback Strategy** — se chiave mancante nella lingua corrente → fallback a EN → fallback a key name

### Scope traduzione
- **UI labels** — tutti i testi visibili (sidebar, topbar, phase headers, buttons, tooltips)
- **System messages** — toast notifications, error messages, success confirmations
- **Sovereign explanations** — traduzioni LTL→lingua naturale (attualmente solo IT)
- **Audit ledger** — voci registro comprensibili nella lingua utente

### Lingue supportate (MVP)
- **Italiano** (default, retrocompatibile)
- **English** (completo)

### Estensibilità futura
- Aggiunta nuova lingua = nuovo file traduzioni, zero modifiche codice
- Traduzioni crowd-sourced (export/import JSON)
- Lingua per-tenant (tutti utenti tenant vedono stessa lingua)

### Criteri di verifica
- Switch lingua → tutta UI tradotta istantaneamente
- Nessuna stringa hardcoded nel codice (solo chiavi)
- Lingua preferita persistita tra sessioni

---

## 🔷 Trasversale T3 — Developer Workflow Hardening

### Obiettivo
Eliminare i workflow dolorosi documentati in "Note per Sviluppo Futuro" e "Problemi noti risolti".

### Miglioramenti
| Problema attuale | Soluzione |
|------------------|-----------|
| WS service avviato manualmente | Auto-start integrato in dev script |
| DB readonly dopo rimozione/ricreazione | Connection handling robusto (non workaround Proxy) |
| Prisma client cached issues | Script `dev:clean` che resetta cache e rigenera client |
| CycleId collisioni | UUID v7 time-sortable (non timestamp+counter) |
| Collisioni campo `action` nei body | REST verbs corretti (non dispatch via `action`) |
| Zero containerization | Dockerfile + docker-compose per riproducibilità |

### Nuovi comandi dev
- `dev` — avvia tutto (Next.js + WS + DB) in unico processo
- `dev:clean` — reset completo cache e rigenerazione
- `dev:docker` — avvia stack completo in container
- `db:backup` — backup manuale con timestamp
- `db:restore` — restore da backup specifico

### Containerizzazione
- **Next.js container** — app production build
- **WS container** — Socket.io service
- **DB container** — PostgreSQL (dopo migrazione Fase 23)
- **Reverse proxy container** — routing + TLS termination
- **Compose profile** — sviluppo vs produzione

### Criteri di verifica
- `dev` avvia tutto con zero configurazione manuale
- `dev:docker` riproduce ambiente identico su qualsiasi macchina
- Zero workaround Proxy per DB handling

---

## 📊 Matrice delle Dipendenze

```
Fase 19 (Quality) ←── indipendente (prerequisito per tutte)
    │
    ├──→ Fase 20 (Auth) ←── indipendente
    │         │
    │         └──→ Fase 22.1 (Error Tracking con userId)
    │
    ├──→ Fase 21 (Crypto) ←── indipendente
    │         │
    │         ├──→ Fase 21.1 (Tool Signing)
    │         ├──→ Fase 21.2 (Embeddings)
    │         └──→ Fase 21.3 (LTL NFA)
    │
    ├──→ Fase 22 (Observability)
    │         │
    │         ├──→ Fase 22.1 (Error Tracking) ←── dipende da Fase 20
    │         ├──→ Fase 22.2 (Metrics)
    │         ├──→ Fase 22.3 (Tracing)
    │         └──→ Fase 22.4 (Backup)
    │
    └──→ Fase 23 (Scalability)
              │
              ├──→ Fase 23.1 (PostgreSQL) ←── indipendente
              ├──→ Fase 23.2 (WS Cluster) ←── indipendente
              ├──→ Fase 23.3 (Job Queue)
              └──→ Fase 23.4 (FSM/Taint Persistence)

Trasversali:
T1 (DAG Integration) ←── indipendente (solo UI)
T2 (i18n) ←── indipendente (solo UI)
T3 (Dev Workflow) ←── indipendente (solo DX)
```

---

## 🗓️ Roadmap di Rilascio (semplificata per implementazione incrementale)

### Release 0.6.0-alpha (~1 settimana)
**Focus**: Quality + Dev Workflow (prerequisiti per tutto il resto)
- Fase 19 (test suite kernel per i 5 moduli più critici, coverage ≥ 80%)
- T3 essenziali: script `dev:clean`, auto-start WS in dev, fix cycleId con UUID v7
- Documentazione dei test

**Criterio di uscita**: zero test failing, dev workflow pulito, coverage kernel ≥ 80%

### Release 0.6.0-beta (~2 settimane)
**Focus**: Auth + UX
- Fase 20 light (NextAuth.js email/password, RBAC 4 ruoli)
- T1 (DAG visualizer integration in F2/F8/F12)
- T2 base (i18n UI labels IT/EN)

**Criterio di uscita**: auth funzionante, DAG integrati, UI bilingue

### Release 0.6.0-rc (~3 settimane)
**Focus**: Crypto + Observability
- Fase 21 (real ECDSA signing, embeddings adapter, LTL NFA subset)
- Fase 22 (error tracking, metrics, tracing, backup)

**Criterio di uscita**: tool signing verificato, error tracking attivo, backup automatici

### Release 0.6.0-stable (~4 settimane)
**Focus**: Scalability
- Fase 23 (PostgreSQL adapter con fallback SQLite, WS cluster adapter, job queue, persistence)
- Documentazione completa, migration guide

**Criterio di uscita**: 100 client concorrenti, zero data loss su crash, multi-tenant

---

## ✅ Criteri di Accettazione Globali

### Quality Gates
- [ ] Coverage kernel ≥ 80%
- [ ] Coverage API ≥ 60%
- [ ] Zero test failing
- [ ] Zero lint error
- [ ] Build production senza warning

### Security Gates
- [ ] Auth obbligatoria su tutte le route
- [ ] Tool signing verificato con ECDSA
- [ ] Audit trail completo con userId
- [ ] Taint flows con TTL
- [ ] Zero hardcoded secrets

### Performance Gates
- [ ] 100 client WebSocket concorrenti
- [ ] 1000 API requests/minuto senza degradazione
- [ ] P95 latency < 500ms
- [ ] Zero data loss su crash

### UX Gates
- [ ] DAG visualizer integrati in tutte le pagine
- [ ] UI completamente tradotta IT/EN
- [ ] Zero workflow manuali per dev
- [ ] Error tracking attivo con alerting

### Operability Gates
- [ ] Backup automatici ogni 6h
- [ ] Metrics esposte e scrape-abili
- [ ] Tracing completo per ogni request
- [ ] Containerizzazione completa

---

## 📈 Metriche di Successo

| Metrica | v0.5.0 attuale | v0.6.0 target |
|---------|----------------|---------------|
| Test coverage | 0% | ≥ 80% kernel |
| Autenticazione | Assente | Multi-user + RBAC |
| Tool signing | SHA-256 simulato | ECDSA reale |
| Error tracking | Nessuno | Completo con alerting |
| Backup | Manuale | Automatico ogni 6h |
| DB concurrency | 1 writer | Unlimited (PostgreSQL) |
| WS instances | 1 | N (cluster) |
| Lingue supportate | 1 (IT) | 2 (IT/EN) |
| DAG visualizer integrati | 0/3 | 3/3 |
| Containerizzazione | No | Sì (Docker Compose) |

---

## 🎯 Conclusioni

Il blueprint 0.6.0 trasforma SOTA Agentic OS da **demo tecnica impressionante** a **sistema production-ready** attraverso:

1. **Quality Infrastructure** — elimina il rischio di regressioni
2. **Authentication** — abilita deployment multi-user/SaaS
3. **Cryptographic Trust** — rimuove vulnerabilità supply-chain
4. **Observability** — elimina blind spot operativi
5. **Scalability** — rimuove colli di bottiglia infrastrutturali

Le 5 nuove fasi (19-23) + 3 trasversali (T1-T3) sono **orthogonali** alle 18 esistenti: non modificano l'architettura cognitiva del sistema, ma aggiungono il layer di hardening necessario per deployment reali.

**Stima effort totale**: 10-16 settimane (incrementale, 4 release)
**Rischio principale**: migrazione SQLite → PostgreSQL (Fase 23.1) richiede testing estensivo
**Dipendenza critica**: Fase 19 (test) deve essere completata prima di tutte le altre per garantire non-regressione

Il sistema risultante (23 fasi + 3 trasversali) sarà competitivo con research paper recenti su:
- Formal verification (LTL NFA completo)
- Affective computing (telemetria + observability)
- Supply-chain security (real signing)
- Multi-agent coordination (ESR + quorum + auth)
- Human-in-the-loop (Sovereign Validator + audit)

---

*Blueprint approvato per implementazione incrementale · Prossimo step: iniziare da Release 0.6.0-alpha (Fase 19 + T3 essenziali) come prerequisito per tutte le altre.*
