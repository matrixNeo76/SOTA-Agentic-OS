# SOTA Agentic OS — Roadmap & Analisi Critica

> **Versione:** 0.6.0 · **Data:** 2026-06-20 · **Stato**: Prototipo avanzato (NON production-ready)

Questo documento complementa `DOCUMENTATION.md` (che descrive cosa è implementato) con un'analisi onesta dei gap, delle criticità persistenti, e della roadmap evolutiva realistica.

---

## Indice

1. [Analisi Critica: Blueprint vs Implementazione Reale](#1-analisi-critica-blueprint-vs-implementazione-reale)
2. [Criticità Persistenti](#2-criticità-persistenti-non-risolte-in-v060)
3. [Gap Funzionali Rilevanti](#3-gap-funzionali-rilevanti)
4. [Valutazione di Utilizzo Concreto](#4-valutazione-di-utilizzo-concreto)
5. [Roadmap Evolutiva Realistica](#5-roadmap-evolutiva-realistica)
6. [Metriche di Successo](#6-metriche-di-successo-stato-attuale-vs-target)
7. [Raccomandazione Strategica](#7-raccomandazione-strategica)

---

## 1. Analisi Critica: Blueprint vs Implementazione Reale

### Stato reale delle fasi v0.6.0

| Fase Blueprint | Stato reale | Livello completezza |
|----------------|-------------|---------------------|
| **F19 Quality** | 146 test Vitest, 52% coverage | 🟡 Parziale (target era 80%) |
| **F20 Auth** | Login + 4 ruoli + cookie HttpOnly | 🟢 Implementata (ma no multi-tenant reale) |
| **F21 Crypto** | ECDSA P-256 reale + PublisherKey | 🟢 Implementata |
| **F22 Observability** | Error tracking + metrics + tracing + backup | 🟡 Locale (no Sentry/Prometheus reale) |
| **F23 Scalability** | DB adapter + WS pub/sub + job queue + FSM persist | 🔴 Solo adapter pattern, nessuna migrazione reale |
| **T1 DAG Integration** | 3 visualizer integrati in F2/F8/F12 | 🟢 Implementata |
| **T2 i18n** | 60+ chiavi IT/EN + language switcher | 🟡 Base (incompleto su messaggi e fasi) |
| **T3 Dev Workflow** | dev:clean, dev:full, UUID v7, auto-start WS | 🟢 Implementata |

### Cosa è stato PROMESSO ma NON realizzato

| Promessa Blueprint | Realtà v0.6.0 |
|--------------------|---------------|
| PostgreSQL migration | ❌ Solo adapter pattern, SQLite ancora in uso |
| Redis WS adapter | ❌ Solo interfaccia, in-memory ancora |
| Job queue production | ❌ In-memory, no BullMQ/Redis |
| Multi-tenant isolation | ❌ Solo auth utente, no tenantId scoping |
| Test coverage 80% | ❌ Solo 52% raggiunto |
| Off-site backup | ❌ Solo locale con checksum |
| Error tracking esterno | ❌ Locale con dedup, no Sentry |
| Metrics Prometheus reale | ❌ Exporter locale, no scraping esterno |
| LTL NFA compiler | ❌ Solo 7 pattern FSM, no annidamento |
| Embeddings neurali | ❌ TF-IDF locale, no modello reale |

---

## 2. Criticità Persistenti (non risolte in v0.6.0)

### 2.1 — SQLite è ancora il database di produzione

La documentazione dice: *"Adapter pattern pronto per migrazione PostgreSQL (cambiare DATABASE_URL)"*

**Realtà**: cambiare `DATABASE_URL` non basta. Ci sono:
- Query SQLite-specific (es. `json_extract`, `datetime('now')`)
- Tipi incompatibili (JSON nativo PostgreSQL vs TEXT SQLite)
- Transazioni con semantica diversa
- Nessun test di migrazione dati
- Nessun benchmark comparativo

**Impatto**: sotto carico concorrente, il sistema collassa ancora.

### 2.2 — Test coverage 52% è insufficiente per production

146 test sono un ottimo inizio, ma:
- Manca coverage su API routes (le più critiche per integration)
- Manca E2E testing (Playwright menzionato ma non implementato)
- Manca testing su flussi cross-modulo (es. sovereign resolve completo)
- 52% significa che metà del codice non è testato

**Impatto**: regressioni silenziose ancora possibili.

### 2.3 — Observability è locale, non production-grade

- Error tracking: locale con dedup, ma no alerting esterno (Slack, email, PagerDuty)
- Metrics: exporter locale, ma no Prometheus server che scrapa
- Tracing: `traced()` helper, ma no Jaeger/Zipkin backend
- Backup: locale con checksum, ma no off-site replication

**Impatto**: se il server crasha, perdi tutto. Se c'è un errore, nessuno lo sa.

### 2.4 — Multi-tenant è un'illusione

La Fase 20 ha:
- ✅ Autenticazione utente
- ✅ Ruoli (Admin/Operator/Sovereign/Viewer)
- ❌ **Nessun `tenantId` nei modelli DB** (solo nel modello User, non scoping)
- ❌ **Nessuno scoping automatico nelle query**
- ❌ **Nessuna isolation tra tenant**

**Impatto**: se due aziende usano lo stesso deploy, vedono i dati l'una dell'altra.

### 2.5 — WebSocket è ancora single-instance

La Fase 23.2 dice: *"interfaccia in-memory (dev) + Redis-ready (prod)"*

**Realtà**:
- Nessuna implementazione Redis adapter
- Se il WS service crasha, perdi tutti i client
- Non puoi scalare orizzontalmente

**Impatto**: 100 client concorrenti = collo di bottiglia.

### 2.6 — Job queue è in-memory

La Fase 23.3 ha `enqueueJob()` con priorità e retry, ma:
- I job sono nel DB (JobRecord) ma il worker è in-memory
- Se il server crasha, i job in esecuzione sono persi
- Nessun dead letter queue reale
- Nessun worker distribuito

**Impatto**: job critici (backup, FSM checkpoint) possono essere persi.

---

## 3. Gap Funzionali Rilevanti

### 3.1 — i18n incompleto

60+ chiavi sono poche per un'app con 28 sezioni. Attualmente:
- Solo label principali tradotte (topbar, overview, login, categorie)
- Messaggi errore ancora hardcoded IT
- Nomi fasi non tradotti (usano `PHASES` array statico)
- Tooltips e descrizioni non tradotti
- Toast notifications in italiano hardcoded

**Impatto**: switch lingua = UI mista IT/EN.

### 3.2 — Real LLM integration ancora stub

La documentazione dice: *"i moduli GroundedInference (F10), TimeRouter (F14) e SovereignTranslator (F17) usano stub deterministici"*

**Realtà**:
- **F10 (GroundedInference)**: `simulateLLMOutput()` genera script deterministici, non chiama l'LLM
- **F14 (TimeRouter)**: `scoreModels()` è rule-based, non XGBoost reale; `simulateModelOutput()` è stub
- **F17 (SovereignTranslator)**: `generateExplanation()` usa template, non LLM
- **F2 (Planner)**: usa ZAI SDK per generazione piani (questo è reale ✓)
- **F2 (CompiledAI)**: usa ZAI SDK per generazione codice (questo è reale ✓)

**Impatto**: il sistema non usa LLM per le decisioni cognitive critiche (steering, routing, spiegazioni).

### 3.3 — Cockpit narrative auto-generation mancante

Le voci `CockpitNarrative` sono registrate manualmente via API. Non c'è auto-generazione dagli eventi AgentLog.

**Impatto**: tab Narrative del Cockpit è vuoto senza intervento manuale.

### 3.4 — LTL pattern composti non supportati

Solo 7 pattern FSM semplici. `G(F(p))`, `F(G(p))`, `p W q` (weak until), `p R q` (release) richiedono NFA non implementato.

**Impatto**: espressioni LTL reali (es. "eventualmente sempre sicuro") non validabili.

### 3.5 — Embeddings non neurali

TF-IDF 256-dim con dizionario 80 alias. Funziona per correlazione lessicale ma non ha comprensione semantica reale.

**Impatto**: RAG retrieval e semantic search hanno precisione limitata.

---

## 4. Valutazione di Utilizzo Concreto

### ✅ Utilizzabile per:

| Use Case | Valutazione | Note |
|----------|-------------|------|
| **Demo tecnica / POC** | 🟢 Eccellente | 23 fasi impressionanti, architettura solida |
| **Research / Academic** | 🟢 Eccellente | Formal verification, affect subsystem, ESR sono research-grade |
| **Internal tool single-user** | 🟡 Accettabile | Funziona, ma con limitazioni performance |
| **Consulting demo** | 🟢 Eccellente | Visual impact alto, architettura spiegabile |
| **Learning / Education** | 🟢 Eccellente | Esempio completo di OS agentico |

### ❌ NON utilizzabile per:

| Use Case | Valutazione | Motivo |
|----------|-------------|--------|
| **Multi-tenant SaaS** | 🔴 Non pronto | No tenant isolation, no scoping |
| **Enterprise production** | 🔴 Non pronto | SQLite, no observability esterna, no backup off-site |
| **High-concurrency** | 🔴 Non pronto | SQLite single-writer, WS single-instance |
| **Mission-critical** | 🔴 Non pronto | 52% test coverage, no disaster recovery |
| **Public-facing API** | 🔴 Non pronto | Auth base, no rate limiting, no API keys |

### 🟡 Utilizzabile con limitazioni per:

| Use Case | Limitazioni |
|----------|-------------|
| **Team interno (< 10 utenti)** | SQLite OK per basso carico, auth sufficiente |
| **Prototipo enterprise** | Dimostrabile, ma non deployabile senza hardening |
| **Vertical POC (legal, finance)** | Architettura adatta, ma mancano integration specifiche |

---

## 5. Roadmap Evolutiva Realistica

### Fase A: Production-Ready Hardening (4-6 settimane)

**Obiettivo**: rendere il sistema realmente deployabile in produzione.

#### A.1 — Completa F23 Scalability (2 settimane)
- **Migrazione reale SQLite → PostgreSQL**
  - Script migrazione dati con validazione
  - Adattamento query SQLite-specific
  - Test performance comparativo
  - Rollback plan
- **Redis WS adapter reale**
  - Implementazione `@socket.io/redis-adapter`
  - Test cluster con 3 istanze
  - Load balancing con sticky sessions
- **Job queue production**
  - Integrazione BullMQ + Redis
  - Worker persistente con graceful shutdown
  - Dead letter queue reale
  - Monitoring dashboard

**Criterio di uscita**: 100 client concorrenti, zero data loss su crash.

#### A.2 — Completa F22 Observability (1 settimana)
- **Sentry integration** per error tracking
- **Prometheus + Grafana** per metrics
- **Jaeger** per distributed tracing
- **S3 backup** con retention policy

**Criterio di uscita**: errore → alert in < 5s, metrics scrapeabili.

#### A.3 — Completa F20 Multi-Tenancy (1 settimana)
- **Aggiungi `tenantId`** a tutti i modelli DB
- **Middleware tenant scoping** automatico
- **Test isolation** tra tenant
- **Tenant management UI**

**Criterio di uscita**: Tenant A non vede dati di Tenant B.

#### A.4 — Aumenta Test Coverage (2 settimane)
- **API routes testing** (integration)
- **E2E testing** con Playwright
- **Cross-modulo flows** (sovereign resolve, LTL violation)
- **Target: 80% coverage**

**Criterio di uscita**: CI gate bloccante se coverage < 80%.

---

### Fase B: Ecosystem Integration (8 settimane)

**Obiettivo**: aprire il sistema all'ecosistema esterno.

#### B.1 — F24 Protocol Interoperability (3 settimane)
- **MCP Server Adapter** (esponi tool come MCP)
- **MCP Client Adapter** (consuma tool esterni)
- **A2A Protocol Bridge** (agent-to-agent)
- **Protocol Router** (decidi quale usare)

**Criterio di uscita**: Claude Desktop può usare i nostri tool via MCP.

#### B.2 — F25 Extension Lifecycle (2 settimane)
- **Hot-reload engine** per extension
- **Sandbox executor** (V8 isolate)
- **Dependency resolver**
- **Marketplace client**

**Criterio di uscita**: installa extension senza restart.

#### B.3 — F26 Economic & Resilience (2 settimane)
- **Cost tracking** granulare per agent/task
- **Circuit breaker** per servizi esterni
- **Retry con backoff** esponenziale
- **Budget enforcement**

**Criterio di uscita**: dashboard costi real-time, circuit breaker testato.

#### B.4 — F27 Simulation & Benchmarking (1 settimana)
- **Mock LLM provider**
- **Scenario builder**
- **Benchmark framework**
- **Regression detection**

**Criterio di uscita**: simulation mode funzionante, benchmark eseguibile.

---

### Fase C: Polish & Specialization (4 settimane)

#### C.1 — Completa i18n (1 settimana)
- Traduci tutte le 28 sezioni
- Traduci messaggi errore
- Traduci tool names e tooltips
- Test switch lingua completo

#### C.2 — Real LLM Integration (2 settimane)
- Integra ZAI SDK in F10 (GroundedInference)
- Integra ZAI SDK in F14 (TimeRouter scoring)
- Integra ZAI SDK in F17 (SovereignTranslator explanations)
- Sostituisci stub deterministici
- Test quality output

#### C.3 — F28 Advanced Perception (1 settimana)
- PDF parser
- Semantic diff engine
- Anomaly detection comportamentale

---

## 6. Metriche di Successo — Stato Attuale vs Target

| Metrica | v0.6.0 attuale | Target A (production) | Target B (ecosystem) |
|---------|----------------|----------------------|---------------------|
| Test coverage | 52% | 80% | 85% |
| Database | SQLite | PostgreSQL | PostgreSQL + read replicas |
| WS instances | 1 (in-memory) | 3 (Redis cluster) | N (auto-scaling) |
| Multi-tenant | No (solo auth) | Sì (tenant isolation) | Sì + tenant management |
| Error tracking | Locale | Sentry + alerting | + anomaly detection |
| Backup | Locale | S3 off-site | + point-in-time recovery |
| LLM integration | Stub (F10/F14/F17) | Reale (ZAI SDK) | + fallback chain |
| Protocolli esterni | 0 | 1 (MCP) | 3 (MCP, A2A, ACP) |
| Extension lifecycle | Statico | Hot-reload | + marketplace |
| Cost tracking | No | Sì | + budget enforcement |
| i18n coverage | 60+ chiavi (parziale) | Completo IT/EN | + 3 lingue |
| LTL pattern | 7 FSM semplici | + NFA composti | + model checking |

---

## 7. Raccomandazione Strategica

### Se il tuo obiettivo è:

#### 🎓 Research / Demo / Education
**Stato attuale: ✅ PRONTO**
- Non serve ulteriore hardening
- 23 fasi sono sufficienti per dimostrare l'architettura
- Pubblicabile come paper/tesi

**Prossimo step**: scrivere paper/tesi, presentare a conferenze.

#### 🏢 Internal Tool (team < 10 utenti)
**Stato attuale: 🟡 QUASI PRONTO**
- Completa Fase A.1 (PostgreSQL migration) — 2 settimane
- Completa Fase A.4 (test coverage 80%) — 2 settimane
- Deploy interno con limitazioni accettate

**Prossimo step**: Fase A (4 settimane), poi deploy.

#### 🚀 SaaS Multi-Tenant / Enterprise
**Stato attuale: ❌ NON PRONTO**
- Completa Fase A completa (6 settimane)
- Completa Fase B (8 settimane)
- Totale: 14 settimane di hardening

**Prossimo step**: Fase A + B (14 settimane), poi beta privata.

#### 💼 Prodotto Commerciale
**Stato attuale: ❌ LONTANO**
- Completa Fase A + B + C (18 settimane)
- Aggiungi: billing, onboarding, support, SLA
- Totale: 6+ mesi di sviluppo

**Prossimo step**: validazione mercato con POC, poi roadmap 6 mesi.

---

## Valutazione Finale Onesta

### Punti di forza reali
1. **Architettura cognitiva completa** — 23 fasi coprono l'intero ciclo agentico
2. **Formal verification** — LTL + Lean4 è raro e valido
3. **Affect subsystem** — telemetria emotiva è unica
4. **Sovereign Validator** — human-in-the-loop strutturato
5. **Documentazione eccellente** — esempio di come documentare

### Limitazioni reali
1. **Production readiness** — 52% test coverage, SQLite, no observability esterna
2. **Scalability** — single-instance, single-writer DB
3. **Multi-tenancy** — solo auth, no isolation
4. **Real LLM usage** — molti moduli sono ancora stub
5. **Ecosystem integration** — sistema chiuso, no MCP/A2A

### Verdetto

**v0.6.0 è un prototipo avanzato eccellente, ma NON è production-ready.**

- Per **demo/research**: 9/10
- Per **internal tool**: 6/10 (dopo Fase A.1 + A.4)
- Per **SaaS/enterprise**: 3/10 (dopo Fase A + B)

**Raccomandazione**: se vuoi usarlo in produzione, investi 6 settimane in Fase A. Se è per demo/research, è già ottimo così.

---

*Documento generato il 2026-06-20. Aggiornare ad ogni cambio di direzione strategica.*
