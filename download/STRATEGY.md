# SOTA Agentic OS — Strategia Commerciale

> **Versione:** 1.0 · **Data:** 2026-06-22 · **Stato:** Track 0 completato, pronto per Track 2
>
> Questo documento definisce le 5 decisioni strategiche bloccanti per trasformare SOTA Agentic OS in un prodotto commerciale SaaS multi-tenant. Tutte le decisioni sono prese e incorporate nel piano esecutivo (39 settimane, 10 mesi).

---

## Indice

1. [Target Market](#1-target-market)
2. [Pricing Model](#2-pricing-model)
3. [Tenant Model](#3-tenant-model)
4. [Compliance](#4-compliance)
5. [Self-Hosted](#5-self-hosted)
6. [Architettura Target](#6-architettura-target)
7. [Sequenza Esecutiva](#7-sequenza-esecutiva)
8. [KPI e Success Metrics](#8-kpi-e-success-metrics)

---

## 1. Target Market

### Decisione: Piattaforma orizzontale con preset di settore

**Non** verticalizziamo su un singolo settore. Costruiamo una **piattaforma generica** con preset configurabili che si adattano ai principali tipi di target verticali.

### Razionale

- **Massimizza addressable market** — non limitiamo il TAM a un solo settore
- **Settori target iniziali** (preset):
  1. **Fintech** — compliance-heavy, tool finanziari, LTL rules per transazioni
  2. **Healthcare** — HIPAA compliance, patient data isolation, clinical workflows
  3. **Dev Tools** — CI/CD integration, code review automation, security scanning
  4. **Research** — experiment tracking, hypothesis testing, paper generation
  5. **Generic** — preset default per qualsiasi organizzazione

- **Preset includono**: compliance rules, LTL safety rules, tool predefiniti, euristiche di settore, UI customization (label, colori, workflow)

### Implementazione

- Modello `SectorPreset` in Prisma con configurazione JSON
- Onboarding: "Che tipo di organizzazione sei?" → applica preset
- Marketplace di preset di settore (post-GA, community-driven)

---

## 2. Pricing Model

### Decisione: Freemium + Pay-per-token (ibrido Claude/Gemini/Zhipu)

Ispirato ai modelli di Claude, Gemini e Zhipu ma con adattamenti per multi-tenant.

### Piano Tariffario

| Piano | Prezzo | Task/mese | Workspaces | Utenti | API | Self-hosted | Target |
|-------|--------|-----------|------------|--------|-----|-------------|--------|
| **Free** | €0 | 50 | 1 personale | 1 | No | No | Trial, individui |
| **Pro** | €19/mese | 1.000 | 5 personali | 1 | Pay-per-token | No | Professionisti, freelancer |
| **Team** | €39/utente/mese | 3.000/utente | Illimitati condivisi | 5-50 | 500K token inclusi, poi pay-per-token | No | PMI, team |
| **Enterprise** | Custom | Illimitati | Illimitati | Illimitati | Inclusi | ✅ Sì | Grandi aziende |

### API Usage-Based (pay-per-token)

| Modello | Input (per 1M token) | Output (per 1M token) |
|---------|---------------------|----------------------|
| zai-glm (economica) | €0.10 | €0.20 |
| zai-glm-flash (veloce) | €0.05 | €0.10 |
| gpt-4o | €2.50 | €10.00 |
| claude-3.5-sonnet | €3.00 | €15.00 |
| gemini-1.5-pro | €1.25 | €5.00 |

### Logica Key

- Ogni tenant ha un **credito token mensile** incluso nel piano
- Oltre soglia: **pay-per-token** con top-up automatico o manuale
- **Cost tracking** già implementato (R1.1) — estendere con per-tenant metering
- **Budget enforcement** (Track 4) — blocca chiamate quando budget superato

### Implementazione

- Stripe Billing con subscription + metered usage
- `CostEntry` model esistente esteso con `organizationId` (Track 2)
- Plan limits enforcement: task/day, workspaces, users, API calls
- Credit system: incluso nel piano + top-up

---

## 3. Tenant Model

### Decisione: 3-level — Organization → Workspace → User

```
Organization (tenant)
├── id, name, plan, compliancePreset, createdAt
├── Users (membri org)
│   └── UserWorkspace (M2M: user × workspace + role)
├── Workspaces
│   ├── Personali (ownerId = user, sharedWithOrg = false)
│   └── Condivisi (ownerId = null/org, sharedWithOrg = true)
└── Settings (billing, compliance, limits)
```

### Regole di Isolamento

1. **Organization isolation**: Org A non vede dati Org B (scoping DB rigoroso)
2. **Workspace isolation**: Workspace X non vede Workspace Y (stessa org, se non condivisi)
3. **User isolation**: User non vede workspace altrui senza permesso (RBAC)

### Ruoli

**Organization roles**:
- `owner` — fatturazione, gestione utenti, delete org
- `admin` — gestione workspaces condivisi, invitare utenti
- `member` — accesso a workspaces assegnati

**Workspace roles**:
- `owner` — creatore workspace, può eliminare
- `editor` — può creare/modificare task, branch, share
- `viewer` — sola lettura

### Implementazione

- Ogni modello Prisma esistente riceve `organizationId` + `workspaceId` (opzionale)
- Prisma middleware: scoping automatico a 2 livelli
- `AsyncLocalStorage` per tenant + workspace context
- API: header `X-Organization-Id` + `X-Workspace-Id` required
- UI: organization switcher + workspace switcher nel topbar

---

## 4. Compliance

### Decisione: GDPR + SOC 2 Type II + CCPA

Implementeremo **tutte le compliance necessarie e importanti** per coprire EU + US enterprise.

### GDPR (Unione Europea)

- **Data export**: endpoint `/api/gdpr/export` — ZIP con tutti i dati utente
- **Right to be forgotten**: `/api/gdpr/delete` — cancellazione completa + audit
- **Consent management**: cookie banner + tracking opt-in
- **DPA template**: generabile dinamicamente
- **Data residency**: opzione EU-only data center (post-GA)

### SOC 2 Type II (US Enterprise)

- **Audit log immutabile**: tutte le azioni privilegiate (sovereign resolve, tool revoke, budget changes, user create/delete)
- **Access control documentation**: auto-generata da RBAC
- **Encryption at rest**: PostgreSQL TDE + encryption filesystem
- **Encryption in transit**: TLS 1.3 ovunque
- **Incident response**: runbook documentato + alerting
- **Penetration testing**: annuale, terze parti

### CCPA (California)

- **"Do Not Sell My Info"** endpoint
- **Data deletion request** flow (simile GDPR)
- **Privacy policy** aggiornata con CCPA disclosures

### Implementazione

- Settimana 13 dedicata a compliance implementation (Track 6.3)
- Settimana 33 dedicata a compliance legale (Track 7.4)
- Audit log esteso in Track 6.2

---

## 5. Self-Hosted

### Decisione: Docker + Kubernetes per Enterprise, air-gapped support

**SaaS hosted** (Free/Pro/Team): multi-tenant su cloud (AWS/GCP)
**Self-hosted** (Enterprise): Docker + Kubernetes, air-gapped support

### Strategia

- `Dockerfile` multi-stage per Next.js + PostgreSQL + Redis + WS service
- `docker-compose.yml` per setup single-node (semplice, < 1 ora)
- `k8s/` manifests per deployment Kubernetes (Helm chart)
- **License server**: `POST /api/license/validate` con offline grace period 7 giorni
- **Air-gapped install**: tutti gli asset (LLM model weights se locale, dependencies) bundled
- **Auto-update mechanism**: opzionale, opt-in (Enterprise può disabilitare)

### Requisiti Self-Hosted Enterprise

- Docker 24+ o Kubernetes 1.28+
- PostgreSQL 16+ (non SQLite per self-hosted)
- Redis 7+ (per WS cluster + job queue)
- 16GB RAM minimo, 32GB raccomandato
- 100GB storage minimo
- LLM: ZAI SDK (cloud) o modello locale (bundled)

### Implementazione

- Settimana 31 dedicata a self-hosted packaging (Track 8)
- License-based: ogni installazione Enterprise richiede licenza valida
- Supporto air-gapped: nessuna dipendenza da servizi esterni (eccetto LLM se cloud)

---

## 6. Architettura Target

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (client)                                                │
│  ├── SaaS: https://app.sota-os.com                              │
│  └── Self-hosted: https://sota.internal.customer.com            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│  Load Balancer (Caddy / AWS ALB)                                 │
│  ├── TLS 1.3 termination                                         │
│  ├── Sticky sessions per WS                                      │
│  └── Rate limiting (Redis-backed)                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│  Next.js App (3+ istanze, autoscaling)                           │
│  ├── 36 API routes (multi-tenant scoped)                        │
│  ├── SSE streaming (Console)                                     │
│  ├── Stripe webhook handler                                      │
│  └── Auth + RBAC + Tenant scoping                                │
└──────┬─────────────────────┬──────────────────┬─────────────────┘
       │                     │                  │
┌──────┴──────┐    ┌────────┴────────┐  ┌──────┴──────────────┐
│ PostgreSQL  │    │ Redis Cluster   │  │ BullMQ Job Queue    │
│ (multi-     │    │ (WS pub/sub +   │  │ (backup, FSM,       │
│  tenant)    │    │  rate limiting +│  │  taint cleanup,     │
│ 62 modelli  │    │  sessions)      │  │  embeddings)        │
└─────────────┘    └─────────────────┘  └─────────────────────┘
       │
┌──────┴──────────────────────────────────────────────────────────┐
│  Observability Stack                                             │
│  ├── Sentry (error tracking + alerting)                         │
│  ├── Prometheus + Grafana (metrics + dashboards)                │
│  ├── Jaeger (distributed tracing)                                │
│  └── S3 (backup + audit log archive)                            │
└──────────────────────────────────────────────────────────────────┘
       │
┌──────┴──────────────────────────────────────────────────────────┐
│  External Services                                               │
│  ├── ZAI SDK (LLM, already integrated)                          │
│  ├── Stripe (billing)                                           │
│  ├── SMTP (email notifications)                                 │
│  └── Slack (alerting webhooks)                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Sequenza Esecutiva

```
FASE 1 — Fondamenta Production-Grade (Settimane 1-14)
   Sett 1     │ Track 0 — Decisione + Audit + Riconciliazione ✅
   Sett 2-4   │ Track 2.1 — Migrazione PostgreSQL
   Sett 5-6   │ Track 2.2 — Multi-tenant 3-level (Org → Workspace → User)
   Sett 7-8   │ Track 2.3 — Redis + Job Queue persistente
   Sett 9     │ Track 2.4 — Sector Presets + Test coverage 80%
   Sett 10    │ Track 2.5 — Hardening finale
   Sett 11-12 │ Track 6.1-6.2 — Security (rate limit, validation, CSRF, audit)
   Sett 13    │ Track 6.3 — Compliance (GDPR + SOC2 + CCPA)
   Sett 14    │ Fase 1 integration test + Go/No-Go gate

FASE 2 — Intelligenza Reale (Settimane 15-17)
   Sett 15    │ Embeddings neurali + ri-taratura soglie
   Sett 16    │ Stub cognitivi → LLM (F10/F14/F17)
   Sett 17    │ Loop Affect→Steering + Narrative auto-gen

FASE 3 — Chiusura Workbench (Settimane 18-21)
   Sett 18    │ Branch tree UI
   Sett 19    │ Budget enforcement + Export
   Sett 20    │ Share analytics + Advanced inspector
   Sett 21    │ i18n completo

FASE 4 — Observability + Ecosystem (Settimane 22-25)
   Sett 22    │ Sentry + Error tracking
   Sett 23    │ Prometheus + Grafana
   Sett 24    │ Jaeger + Distributed tracing
   Sett 25    │ MCP Server/Client

FASE 5 — Commerciale (Settimane 26-35)
   Sett 26-28 │ Track 7.1 — Billing Stripe + Token metering + Plan limits
   Sett 29-30 │ Track 7.2 — Onboarding + Self-service + Docs portal
   Sett 31    │ Track 8 — Self-hosted Docker + K8s + License
   Sett 32    │ Track 7.3 — SLA + Status page + Support
   Sett 33    │ Track 7.4 — Compliance legale + Privacy + DPA
   Sett 34-35 │ Beta privata (5-10 clienti)

BETA PUBBLICA + GA (Settimane 36-39)
   Sett 36-37 │ Beta pubblica
   Sett 38    │ Stabilizzazione
   Sett 39    │ GA launch
```

**Durata totale:** 39 settimane (~10 mesi)

---

## 8. KPI e Success Metrics

### KPI per Fase

| Fase | KPI | Target |
|------|-----|--------|
| Fase 1 | Multi-tenant isolation test | 100% pass |
| Fase 1 | API p95 latency | < 500ms |
| Fase 1 | 100 client concorrenti | Zero data loss |
| Fase 2 | RAG precision@5 | +30% vs TF-IDF |
| Fase 2 | Stub cognitivi rimossi | 8/8 (F10/F14/F17 + 5 partial) |
| Fase 3 | Branch UI usability test | 5/5 utenti completano task |
| Fase 3 | i18n coverage | 100% IT + EN + 3a lingua |
| Fase 4 | Sentry alert latency | < 5s |
| Fase 4 | MCP integration test | Claude Desktop usa tool SOTA |
| Fase 5 | Beta NPS | ≥ 7 |
| Fase 5 | Self-hosted deploy time | < 1 ora |
| GA | Signup → first task | < 10 min |
| GA | 30-day retention | ≥ 40% |
| GA | MRR target (6 mesi post-GA) | €50K/mese |

### Budget Stimato

| Fase | Settimane | Costo stimato (€) |
|------|-----------|-------------------|
| Fase 1 — Fondamenta | 14 | 28.000 |
| Fase 2 — Intelligenza | 3 | 6.000 |
| Fase 3 — Workbench | 4 | 8.000 |
| Fase 4 — Observability | 4 | 8.000 |
| Fase 5 — Commerciale | 10 | 20.000 |
| Infrastruttura (10 mesi) | 39 | 40.000 |
| Legale + Compliance | - | 8.000 |
| **Totale stimato** | **39 settimane** | **~118.000€** |

---

## Decisioni Tecniche Chiave (Sintesi)

| Decisione | Scelta | Ragione |
|-----------|--------|---------|
| Target | Orizzontale con preset settoriali | Flessibilità mercato, massimizza TAM |
| Pricing | Freemium + pay-per-token (stile Claude) | Onboarding basso friction + monetization usage |
| Tenant | 3-level: Org → Workspace → User | Workspaces personali + condivisi come richiesto |
| Compliance | GDPR + SOC 2 + CCPA | Copre EU + US enterprise |
| Self-hosted | Docker + K8s per Enterprise | Air-gapped + license-based |
| Database | PostgreSQL multi-tenant | Sostituisce SQLite |
| WS | Redis cluster | Sostituisce in-memory |
| Job Queue | BullMQ + Redis | Sostituisce in-memory |
| Embeddings | Neurali (bge-small/e5 locale) | Sostituisce TF-IDF |
| LLM stub | ZAI SDK reale in F10/F14/F17 | Chiude gap credibilità |
| Billing | Stripe + metered usage | Subscription + pay-per-token |
| Observability | Sentry + Prometheus + Jaeger | Production-grade monitoring |
| Ecosystem | MCP Server/Client | Integrazione Claude Desktop + altri |

---

## Track 0 — Deliverable Completati

| Deliverable | Status | File |
|-------------|--------|------|
| STRATEGY.md | ✅ Completato | `download/STRATEGY.md` |
| STUB-AUDIT.md | ✅ Completato | `download/STUB-AUDIT.md` |
| STATS.md (riconciliazione) | ✅ Completato | `download/STATS.md` |
| Badge STUB in UI | ✅ Completato | F4, F6, F7, F8, F10, F12, F14 |
| Documentazione reconciliata | ✅ Completato | DOCUMENTATION, UI-UX, ROADMAP, RELEASE-NOTES, README |
| Script audit-stubs.ts | ✅ Completato | `scripts/audit-stubs.ts` |
| Script count-stats.ts | ✅ Completato | `scripts/count-stats.ts` |

---

*Strategia commerciale definita il 2026-06-22. Track 0 completato, pronto per Track 2 (Migrazione PostgreSQL).*
