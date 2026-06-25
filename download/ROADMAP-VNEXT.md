# SOTA Agentic OS — Roadmap vNext

**Da MVP a Cognitive Operating System — full open-source, governance-first, in 4 fasi (0.5 → 3)**

> Questo documento riscrive il piano di ampliamento originale agganciandolo ai componenti **già esistenti** nel repo (`matrixNeo76/SOTA-Agentic-OS`) e sostituendo ogni componente proprietario o sovradimensionato con alternative **open-source**. L'obiettivo non è riscrivere il sistema, ma farlo evolvere.

---

## Punto di partenza (stato attuale del repo)

Il sistema oggi è un'app **Next.js 16 + React 19 + TypeScript** con kernel a 25 moduli (F1–F23). Componenti reali già funzionanti e testati (158 test Vitest):

| Componente reale | Ruolo |
| --- | --- |
| **DynAMO** | Planner / generazione piani |
| **LTL monitor + Taint tracking** | Verifica formale, safety invariants |
| **ERL** (Experience-Reflective Learning) | Apprendimento riflessivo, euristiche, Red Lines |
| **ACTS** (Adaptive Cognitive Task Steering) | Steering cognitivo, 5 strategie |
| **Sovereign Validator** | HITL per azioni irreversibili |
| **Tool Ecosystem** | Tool firmati ECDSA, permessi a grana fine |
| **MCP Server/Client** | Interoperabilità |
| **Memoria episodica + embeddings** | MiniLM all-MiniLM-L6-v2 (384dim), Xenova |
| **Model Router** | Routing modelli (dominio Learn & Route) |

Stack: SQLite (dev) / PostgreSQL (prod) via Prisma 6, embeddings locali, Socket.IO, Zustand, Caddy.

Il piano vNext **estende** questo, non lo sostituisce.

---

## Principi guida della revisione

1. **Riusa i nomi reali.** Ogni livello del piano viene mappato sui moduli del kernel esistente (ERL, ACTS, DynAMO, LTL…), così l'evoluzione è incrementale.
2. **Kubernetes/Istio rimandati.** Per i prossimi 12 mesi sono overhead, non valore. Si usano Docker Compose e Railway (già nel tuo workflow) fino all'Enterprise Core.
3. **Tutto open-source.** Nessuna dipendenza proprietaria obbligatoria. Sostituiti i componenti cloud/closed con equivalenti self-hostable.
4. **Le feature AGI-oriented arrivano per ultime**, solo dopo che Memory Fabric, Context Graph e Runtime Kernel sono solidi.

---

## Sostituzioni open-source (vs. piano originale)

| Piano originale | Sostituzione open-source | Note |
| --- | --- | --- |
| Kubernetes + Istio | **Docker Compose** → poi **k3s** se serve cluster | Rimandato a fase 3; Railway per deploy gestito |
| Kafka / Redpanda | **NATS JetStream** (o **Redpanda Community**) | NATS è leggero, single-binary, ottimo per event mesh |
| GPT-5 / Claude (router) | **router multi-modello** con priorità a modelli locali (llama.cpp: Qwen3, Gemma) + fallback API | Coerente con il tuo setup llama-server |
| Embeddings OpenAI | **già open**: Xenova/MiniLM locale; opzione **bge-m3** / **nomic-embed** via Ollama | Zero costo, zero lock-in |
| Langfuse (cloud) | **Langfuse self-hosted** (è open-source, MIT) | Self-host su Docker |
| Vault (HashiCorp, BSL) | **Infisical** (open-source) o **OpenBao** (fork Vault, MPL) | OpenBao = Vault senza licenza BSL |
| MinIO/S3 | **MinIO** (AGPL) o **Garage** | Garage se vuoi licenza più permissiva |
| Apache AGE + pgvector | **mantieni**: entrambi open-source su PostgreSQL | AGE = grafo, pgvector = semantica |
| Observability stack | **OpenTelemetry + Prometheus + Grafana + Loki** | Tutto OSS, già nel tuo know-how |

---

# FASE 0.5 — Governance Foundation (settimane 1–3, prima di creare nodi)

**Obiettivo:** definire le regole dello schema *prima* di popolare il grafo. Costa pochi giorni ora; evita refactoring di massa dopo. Stesso principio della provenance: ciò che non imponi all'inizio non si retrofitta.

### 0.5.1 — Entity Registry
- Registro canonico delle entità di prima classe: `Agent`, `Task`, `Workflow`, `Skill`, `Tool`, `Document`, `Decision`, `Experience`.
- Ogni entità ha un tipo, uno schema di attributi e regole di ciclo di vita dichiarate.

### 0.5.2 — Naming Rules (URI scheme)
- Identità stabili e interrogabili fin da subito:
  - `agent://planner`, `agent://research`
  - `skill://code-review`
  - `task://<uuid>`
- È ciò che mantiene il grafo navigabile quando avrà milioni di nodi.

### 0.5.3 — Provenance Schema
- Lo schema già definito (`created_by_agent/model`, `source`, `confidence`, `timestamp`) viene formalizzato qui come contratto obbligatorio per ogni nodo.

### 0.5.4 — Event Taxonomy
- Vocabolario eventi chiuso e versionato: `TaskCreated`, `TaskCompleted`, `TaskFailed`, `AgentSpawned`, `AgentStopped`, `DecisionTaken`.
- Base per l'Event Mesh di Fase 2 — definirlo ora evita divergenze di naming tra produttori e consumatori.

### 0.5.5 — Schema di modellazione (definito ora, enforcement dopo)
Questi schemi si **disegnano** in Fase 0.5 perché sono decisioni di modellazione; l'enforcement attivo arriva nella fase indicata.

- **Agent Identity & Lifecycle** (enforcement attivo in Fase 3):
  - Nodi: `Agent`, `AgentVersion`, `AgentRole`, `AgentCapability`, `AgentPolicy`.
  - Relazioni: `(:Agent)-[:HAS_ROLE]->(:AgentRole)`, `(:Agent)-[:USES_SKILL]->(:Skill)`, `(:Agent)-[:BOUND_BY]->(:AgentPolicy)`, `(:Agent)-[:UPGRADED_TO]->(:AgentVersion)`.
- **Knowledge-as-Claims** (motore di risoluzione in Fase 2–3):
  - Principio chiave: la conoscenza è un insieme di **claim**, non di verità. Modellarlo ora costa zero; riconvertire i nodi dopo no.
  - Nodi: `Claim`, `Evidence`, `Source`, `Conflict`.
  - Relazioni: `(:Claim)-[:SUPPORTED_BY]->(:Evidence)`, `(:Claim)-[:CONFLICTS_WITH]->(:Claim)`, `(:Conflict)-[:RESOLVED_BY]->(:Decision)`.

**Deliverable Fase 0.5:** registry, naming scheme, provenance schema, event taxonomy e gli schemi di Agent Lifecycle + Knowledge-as-Claims **definiti e documentati**. Nessun nodo di massa ancora creato.

---

# FASE 1 — MVP Core (mesi 1–4)

**Obiettivo:** rendere solide le tre fondamenta. Tutto gira con Docker Compose.

### 1.1 — Migrazione dati: SQLite → PostgreSQL + estensioni
- Promuovi PostgreSQL a default anche in dev.
- Abilita **pgvector** (semantica) e **Apache AGE** (grafo) sulla stessa istanza Postgres.
- Mantieni Prisma per i modelli relazionali; usa query SQL dirette per AGE/pgvector dove Prisma non arriva.

### 1.2 — Universal Context Graph (su Apache AGE)
- Nodi iniziali (sottoinsieme realistico): `Agent`, `Task`, `Workflow`, `Document`, `Conversation`, `Decision`, `Experience`, `Skill`, `Tool`, `Event`.
- Relazioni iniziali: `EXECUTED`, `GENERATED`, `RESULTED_IN`, `LEARNED_FROM`, `RELATED_TO`, `TRIGGERED`.
- Popola il grafo dagli eventi che il kernel già emette.

### 1.3 — Knowledge Provenance Layer (trasversale, obbligatorio dal primo nodo)
- **Ogni** nodo del Context Graph nasce con metadati di provenienza. Imposto come schema obbligatorio fin dall'inizio: retrofittarlo su un grafo già popolato è impraticabile.
```json
{
  "created_by_agent": "",
  "created_by_model": "",
  "source": "",
  "confidence": 0.92,
  "timestamp": ""
}
```
- Nuove relazioni di tracciabilità:
  - `(:Decision)-[:DERIVED_FROM]->(:Document)`
  - `(:BestPractice)-[:LEARNED_FROM]->(:Experience)`
  - `(:Prediction)-[:BASED_ON]->(:Evidence)`
- È il prerequisito che rende verificabile (non oracolare) il World Model di Fase 3.

### 1.4 — GraphRAG / Hybrid Retrieval Engine
- Il motore che unisce i due store: **pgvector = somiglianza**, **AGE = relazioni**.
- Pipeline: `Query → Vector Search → Graph Expansion → Subgraph Ranking → Context Builder → DynAMO`.
- DynAMO riceve un **sottografo contestuale**, non chunk isolati. È il salto qualitativo maggiore per le capacità di ragionamento.
- In Fase 1 perché è ciò che dà valore immediato al Context Graph appena popolato.

### 1.5 — Memory Fabric (evoluzione della memoria episodica esistente)
- **Episodic** → quella che hai già (esecuzioni, task, conversazioni).
- **Semantic** → embeddings MiniLM già presenti, indicizzati in pgvector.
- **Procedural** → output dell'**ERL** già esistente (euristiche, Red Lines, best practice).
- **Reasoning** → catene di ragionamento da DynAMO + ACTS.
- Questi non sono nuovi sistemi: sono **viste/strati** sopra moduli che già hai.

### 1.6 — Agent Runtime Kernel: checkpointing
- Estendi il kernel attuale con checkpoint deterministici:
  `execution_state`, `tool_state`, `memory_state`, `workflow_state`.
- Capacità target: **Resume**, **Replay**, **Rollback** (Fork e Simulation rimandati).
- Rollback si appoggia al PatchBoard transazionale già presente.

**Deliverable Fase 1:** Context Graph popolato con provenance su ogni nodo, GraphRAG che alimenta DynAMO con sottografi, Memory Fabric a 4 strati, kernel con resume/replay/rollback. Ancora monolite, ancora Docker Compose.

---

# FASE 2 — Enterprise Core (mesi 5–9)

**Obiettivo:** scalabilità, ingestione conoscenza, event-driven. Si introduce il message bus.

### 2.1 — Event-Driven Mesh (NATS JetStream)
- Eventi: `DocumentUploaded`, `TaskCreated`, `CodeChanged`, `DeploymentFailed`, `SLAWarning`, `HumanApprovalRequested`.
- Pipeline: `Event → NATS → Subscribers (agenti) → Actions`.
- NATS al posto di Kafka: single-binary, self-host banale, perfetto per la tua scala.

### 2.2 — Knowledge Extraction Engine
- Pipeline: `PDF/Email/Ticket/Repo/Wiki → OCR → Chunking → Entity/Relation Extraction → Embedding → Context Graph`.
- Tool open-source: **kreuzberg** (estrazione testo — è già nei tuoi link salvati), **Tesseract/OCRmyPDF** per OCR, **spaCy** per NER. Riusa la logica del tuo RAG Qdrant dove utile.

### 2.3 — Multi-Model Cognitive Router (formalizzazione del Model Router esistente)
- Task Classifier: `Simple / Medium / Complex / Critical`.
- Routing **local-first**: Simple→SLM locale (Gemma), Medium/Complex→Qwen3 locale o API, Critical→modello reasoning.
- Ottimizza su costo, latenza, accuratezza, disponibilità. Si integra col tuo llama-server adattivo.

### 2.4 — Code Intelligence Layer
- Parsing con **Tree-sitter** (open-source) → AST, Call Graph, Dependency Graph nei nodi AGE.
- **Incremental Git Sync**: `GitHub webhook → diff analyzer → update incrementale del grafo`.
- Relazioni: `(:Commit)-[:MUTATED]->(:Function)`, `(:Issue)-[:RESOLVED_BY]->(:Commit)`.

### 2.5 — Skill Registry (solo catalogo, in questa fase)
- Skill Registry strutturato (`name/description/tools/memory/constraints/examples/tests`) — riusa lo Skill Manager esistente.
- **Solo registro/catalogo.** La generazione autonoma di skill (Synthesis) è rimandata alla Fase 3: senza observability matura, memoria consolidata, code intelligence e testing affidabile, generare tool in autonomia significa costruire una fabbrica di skill prima di avere il controllo qualità.

### 2.6 — Observability & Governance (full OSS)
- **OpenTelemetry + Prometheus + Grafana + Loki**, **Langfuse self-hosted**.
- Metriche: cost, latency, token usage, success/failure rate, memory hit rate, tool accuracy.
- Governance: RBAC (già presente), audit trail, data lineage, policy engine, **Human Approval Gates** = il tuo Sovereign Validator.

### 2.7 — Agent Evaluation Layer (distinto dall'observability)
- **Observability** dice quanto costa, quanto è lento, quanti token usa. **Evaluation** dice *quanto è bravo*. Sono cose diverse e servono entrambe.
- Dataset: `Tasks`, `Benchmarks`, `Historical Cases`, `Golden Paths`.
- Metriche: Task Success, Tool Accuracy, Hallucination Rate, Policy Compliance, Reasoning Quality.
- Nodi AGE: `Benchmark`, `Evaluation`, `Metric`. Relazioni: `(:Agent)-[:ACHIEVED]->(:Evaluation)`, `(:Evaluation)-[:MEASURED_BY]->(:Metric)`.
- Prerequisito per sapere se la Skill Synthesis di Fase 3 produce skill *buone* e se un upgrade d'agente è miglioramento o regressione.

### 2.8 — Knowledge Conflict Resolution Engine (motore attivo)
- Lo schema Knowledge-as-Claims è già definito in Fase 0.5; qui si attiva il **motore**: rilevamento di `(:Claim)-[:CONFLICTS_WITH]->(:Claim)` e risoluzione via `(:Conflict)-[:RESOLVED_BY]->(:Decision)`.
- Pesatura basata su `confidence` + provenienza (`source`) dei claim in conflitto.
- In Fase 2 perché solo ora hai abbastanza conoscenza nel grafo da generare conflitti reali. Fondamentale per World Model e Digital Twin di Fase 3.

### 2.9 — Cognitive Garbage Collection (Memory Curator Agent)
- Consolidamento (100 task simili → 1 procedural memory).
- Decadimento: `weight = utility_score × recency_score`.
- Archiviazione a livelli: Hot (Postgres) → Warm → Cold (MinIO/Garage).

**Deliverable Fase 2:** sistema event-driven, ingestione documenti/codice nel grafo, router formalizzato, skill registry catalogato, evaluation layer attivo, conflict resolution attivo, GC cognitiva, observability completa. Deploy su Railway o k3s.

---

# FASE 3 — AGI-Oriented (mesi 10–12+)

**Obiettivo:** capacità predittive e auto-organizzazione. **Solo dopo** che le fasi 1–2 sono stabili.

### 3.1 — World Model Layer
- Trasforma dati → comprensione. Analizza task, eventi, repo, SLA, performance, decisioni.
- Produce: `WorldState`, `Prediction`, `Risk`, `Opportunity` (nuovi nodi nel grafo).

### 3.2 — Digital Twin Engine
- Simula workflow, agenti, deploy, incident.
- What-if analysis, scenario planning, impact/risk forecasting.
- Si appoggia a Fork + Simulation del Runtime Kernel (rimandati dalla Fase 1).

### 3.3 — Agent Identity & Lifecycle (enforcement attivo)
- Lo schema (`AgentVersion`, `AgentRole`, `AgentCapability`, `AgentPolicy`) è già modellato in Fase 0.5; qui diventa operativo perché gli agenti diventano **entità persistenti**.
- Versioning e upgrade (`UPGRADED_TO`), binding delle policy (`BOUND_BY`), tracciamento di chi ha creato un agente, quale versione era attiva, quali skill aveva, quali performance (collegate alle `Evaluation` di Fase 2).
- Senza questo la governance dell'Autonomous Organization è ingestibile.

### 3.4 — Hierarchical Agent Mesh (completa)
- Executive (CEO Agent) → Strategic (Architect/Planner/Research/World Model) → Operational (Coding/QA/Security/Data/Support) → Specialized (domain agents).
- Estende i domini Inspect già presenti.

### 3.5 — Skill Synthesis + Meta Agent Compiler
- Quando manca una skill → `DynAMO → Meta Agent → code gen → sandbox test → validation → Skill Registry`.
- La sandbox riusa il Tool Ecosystem firmato ECDSA per i permessi.
- Le skill generate sono valutate dall'Evaluation Layer di Fase 2 prima dell'ammissione al registry.
- Qui in Fase 3 perché le dipendenze (observability, evaluation, memoria consolidata, code intelligence, testing) esistono già dalle fasi precedenti.

### 3.6 — Autonomous Organization Layer
- Il sistema crea agenti, skill, workflow, team; ottimizza processi; riorganizza la memoria; apprende in autonomia.
- Tutto sotto i Human Approval Gates del Sovereign Validator.

**Deliverable Fase 3:** predizione, simulazione, gerarchia completa, skill auto-generate, auto-organizzazione governata.

---

## Schema finale (stack rivisto)

```
┌─────────────────────────────────────────────┐
│ FASE 3  Autonomous Organization Layer        │
│         Skill Synthesis + Meta Agent Compiler│
│         Hierarchical Agent Mesh (completa)   │
│         Agent Lifecycle (enforcement attivo) │
│         Digital Twin Engine                  │
│         World Model Layer                    │
├─────────────────────────────────────────────┤
│ FASE 2  Cognitive Garbage Collection         │
│         Knowledge Conflict Resolution (attivo)│
│         Agent Evaluation Layer               │
│         Skill Registry (solo catalogo)       │
│         Code Intelligence (Tree-sitter)      │
│         Knowledge Extraction (kreuzberg/OCR) │
│         Cognitive Router (Model Router++)    │
│         Event Mesh (NATS JetStream)          │
│         Observability OSS (OTel/Graf/Loki)   │
├─────────────────────────────────────────────┤
│ FASE 1  Agent Runtime Kernel + Checkpoint    │
│         Memory Fabric (su ERL/ACTS/DynAMO)   │
│         GraphRAG / Hybrid Retrieval          │
│         Knowledge Provenance (su ogni nodo)  │
│         Universal Context Graph (AGE)        │
│         PostgreSQL + AGE + pgvector          │
│         Docker Compose                       │
├─────────────────────────────────────────────┤
│ FASE   Entity Registry · Naming (URI)        │
│  0.5   Provenance Schema · Event Taxonomy    │
│        Agent Lifecycle (schema)              │
│        Knowledge-as-Claims (schema)          │
├─────────────────────────────────────────────┤
│ ESISTE  Kernel F1–F23 · LTL · ERL · ACTS     │
│         DynAMO · Sovereign · MCP · ECDSA     │
│         Next.js 16 · Prisma 6 · 158 test     │
└─────────────────────────────────────────────┘
```

---

## Riepilogo decisioni chiave

- **Schema presto, motori dopo**: le decisioni di modellazione (naming, provenance, agent lifecycle, knowledge-as-claims) si fissano in Fase 0.5 perché costano nulla ora ed enormi refactoring dopo; i motori attivi (conflict resolution, lifecycle enforcement, synthesis) arrivano quando esistono le precondizioni.
- **Non riscrivere**: estendi il kernel esistente, mantieni i 158 test come rete di sicurezza.
- **Governance Foundation prima dei nodi**: Entity Registry, naming URI (`agent://`, `skill://`, `task://`), event taxonomy chiusa, provenance obbligatoria.
- **Postgres unico**: relazionale (Prisma) + grafo (AGE) + semantica (pgvector) sulla stessa istanza.
- **GraphRAG in Fase 1**: pgvector + AGE uniti in un Hybrid Retrieval che dà a DynAMO sottografi contestuali invece di chunk.
- **Knowledge = Claims, non Truth**: la conoscenza è modellata come claim con evidenza e confidenza fin dall'inizio; i conflitti si risolvono via Decision.
- **Observability ≠ Evaluation**: la prima misura costo/latenza, la seconda misura quanto l'agente è bravo. Entrambe in Fase 2.
- **Skill: Registry in Fase 2, Synthesis in Fase 3**; ogni skill generata passa per l'Evaluation Layer.
- **Agent lifecycle**: schema in Fase 0.5, enforcement attivo in Fase 3 quando gli agenti diventano persistenti.
- **NATS al posto di Kafka**, **Docker/k3s al posto di Kubernetes+Istio** per i primi 12 mesi.
- **Local-first sui modelli**, coerente col tuo llama-server.
- **100% open-source**: OpenBao/Infisical, Langfuse self-host, MinIO/Garage, Tree-sitter, kreuzberg, spaCy, NATS.
- **Sequenza obbligata**: World Model e Digital Twin solo dopo Memory Fabric + Context Graph + Runtime Kernel.
