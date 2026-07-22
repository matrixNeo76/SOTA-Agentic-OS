# SOTA Agentic OS — Quick Start Guide

> **Caso d'uso reale**: Customer Support Automation per azienda SaaS "Acme Cloud"

## Prerequisiti

- Node.js 18+ / Bun
- SQLite (incluso, default)
- Account ZAI SDK (opzionale — fallback deterministico se assente)

## Installazione (5 minuti)

```bash
# 1. Clona il repo
git clone https://github.com/matrixNeo76/SOTA-Agentic-OS.git
cd SOTA-Agentic-OS

# 2. Installa dipendenze
npm install

# 3. Configura il database
npx prisma db push
npx prisma generate

# 4. Bootstrap demo data (agenti, red lines, KB, etc.)
npx tsx scripts/bootstrap-demo.ts

# 5. Avvia il dev server
npm run dev
```

## Accesso

Apri [http://localhost:3000](http://localhost:3000)

**Credenziali admin**:
- Email: `admin@sota-os.local`
- Password: `admin123`

## Demo Page

Visita **[http://localhost:3000/demo](http://localhost:3000/demo)** per una guida interattiva che ti porta attraverso tutti i moduli con un caso d'uso concreto.

## Caso d'Uso: Customer Support Automation

### Scenario
Acme Cloud è una SaaS con 4 piani (Free/Pro/Team/Enterprise). Riceve ~50 ticket/giorno tra:
- Billing (fatturazione, rimborsi, subscription)
- Technical (API errors, webhook, integrazioni)
- General (feature request, domande)

### Architettura

```
Customer Ticket
    ↓
┌─────────────────────────────────┐
│  Orchestrator (executive)       │
│  - Coordina il workflow         │
└──────────┬──────────────────────┘
           ↓ supervises
┌──────────┴──────────┐
│  Triage (strategic) │  → classifica e route
│  QA Reviewer        │  → reviewa risposte
└──────────┬──────────┘
           ↓ delegates to
┌──────────┴──────────┐
│  Billing Specialist │  → rimborsi, fatture
│  Technical Support  │  → API, webhook, debug
└─────────────────────┘
```

### Governance Layer

**3 Red Lines** (non-negotiable):
- ❌ Never process refund > $500 without human approval
- ❌ Never share customer PII with third-party tools
- ❌ Never escalate to manager without QA review

**3 LTL Rules** (temporal logic):
- ⏰ SLA: every ticket must eventually get a response
- 🔒 Refund requests require human approval (next step)
- ✅ Every response draft must be QA reviewed

**5 Normative Axioms**:
- GDPR compliance (priority 1)
- SLA 24h (priority 1)
- Escalation policy (priority 2)
- Audit trail (priority 2)
- Customer-facing tone (priority 3)

### Knowledge Base (5 entry)

1. **Refund Policy** (billing, procedural) — soglie approvazione
2. **API Rate Limit Guide** (technical, procedural) — troubleshooting 429
3. **Triage Playbook** (triage, procedural) — classificazione ticket
4. **Subscription Plans** (billing, semantic) — pricing matrix
5. **Integration Issues** (technical, episodic) — casi risolti storici

## Come Provarlo

### 1. Dashboard
- Vedi KPI live: 5 agenti attivi, 0 ticket (popola dopo), cost tracking
- Budget alerts: warn $1/day, danger $5/day

### 2. Console (interazione LLM)
Apri la Console e incolla questi ticket reali:

```
Customer: "I'm getting 429 errors on your API. My company is Acme Corp, plan Pro. Need this fixed ASAP!"
```

```
Customer: "I was charged twice for my Pro subscription this month. Invoice #INV-2024-8829. Want a refund."
```

```
Customer: "Webhook not firing after last update. Checked docs but can't figure it out."
```

L'LLM:
1. Marca l'input come **tainted** (governance hook)
2. Pianifica la risposta (orchestrator)
3. Cerca nella KB (`kb.search` tool — pre-execute gate verifica red lines)
4. Redige risposta
5. QA review (LTL check: `G(response_drafted -> X qa_reviewed)`)
6. Invia risposta + registra cost entry

### 3. Runs (workflow multi-agente)
Crea un piano: "Process 10 pending support tickets"
- Orchestrator assegna a Triage
- Triage classifica e route a Billing/Technical
- Specialist risolve, QA reviewa
- HITL gates su rimborsi > $500

### 4. Memory
- Browse le 5 KB entries
- Search semantica: "refund policy" → trova entry billing
- Graph view: agent → KB entry → source

### 5. Agents
- Mesh gerarchico: 5 agenti con 4 edges
- Lifecycle states: active/idle/busy
- Metrics per agent

### 6. Governance
- 3 Red Lines attive (visibili nel tab Red Lines)
- 3 LTL Rules (tab LTL & Taint)
- Audit Ledger: tutte le azioni admin tracciate
- Sovereign View: blocked actions se red line violata

### 7. Insights
- Cost tracking: total, today, by agent/model/phase
- Budget config (modificabile, audit-logged)
- Observability: errors + traces con filtri
- Affect: desperation/frustration per agente

## Production Checklist

### ✅ Completato (Fasi 1-5)
- [x] 6 CORE modules (Dashboard, Runs, Memory, Agents, Governance, Insights)
- [x] Auth su tutte le API (requireAuth/requireAdmin)
- [x] Governance enforcement nel runtime (taint + LTL + red lines)
- [x] Budget persistente + alerting WS
- [x] Audit trail su operazioni admin
- [x] a11y completa (aria-label, role, keyboard)
- [x] Dark mode tokens
- [x] 106+ test integration passing

### ⚠️ Da configurare per production
- [ ] LLM API key reale (ZAI SDK o OpenAI) — attualmente usa fallback deterministico
- [ ] PostgreSQL + pgvector (per embeddings semantici) — SQLite per dev
- [ ] NATS/Redis per event mesh (opzionale — WS funziona in-process)
- [ ] Langfuse per observability esterna (opzionale)
- [ ] HTTPS reverse proxy (nginx/caddy)
- [ ] Backup automatici (`npm run db:backup`)

### Configurazione LLM
Il sistema usa ZAI SDK con fallback deterministico. Per usare LLM reale:

1. Ottieni API key da [Z.ai](https://z.ai)
2. Vai su **Admin → Settings → LLM**
3. Inserisci la API key nel campo `llm.api_key`
4. Verifica con un test nella Console

Oppure imposta la variabile d'ambiente:
```bash
ZAI_API_KEY=your-key-here
```

## Struttura del Progetto

```
src/
├── app/
│   ├── api/          # 81 API routes
│   ├── admin/        # Admin panel (6 tab)
│   ├── demo/         # Demo page (caso d'uso reale)
│   ├── login/        # Auth page
│   └── page.tsx      # Main workbench
├── components/
│   ├── module-pages/ # 5 viste CORE (runs, memory, agents, governance, insights)
│   ├── agentic/      # 14 phase components (advanced)
│   ├── workbench/    # Workspace shell
│   └── ui/           # shadcn/ui components
├── lib/
│   ├── kernel/       # 24 moduli kernel (ltl, taint, normative, cost, etc.)
│   ├── runtime/      # Executor + react-loop + tool-dispatcher + governance-hooks
│   ├── auth/         # Session + RBAC
│   └── settings/     # SystemSetting store (DB-persisted)
├── scripts/
│   ├── bootstrap-demo.ts  # Demo data seeding
│   └── check-schema-sync.ts
└── tests/
    ├── unit/         # 46 test files
    └── integration/  # Auth, budget, governance, insights tests
```

## API Reference

Tutte le 81 API routes sono documentate in `/api/openapi`. Principali:

| Endpoint | Method | Auth | Descrizione |
|----------|--------|------|-------------|
| `/api/auth` | POST | - | Login/logout |
| `/api/dashboard` | GET | user | KPI aggregati |
| `/api/console/stream` | POST | user | LLM streaming |
| `/api/runs/*` | GET/POST | user | Workflow management |
| `/api/memory/*` | GET/POST | user | Knowledge base |
| `/api/agent-mesh` | GET/POST | user | Agent mesh |
| `/api/verify` | GET/POST | user/admin | LTL + taint + normative |
| `/api/retainer` | GET/POST | user/admin | Delegations + HITL gates |
| `/api/cost` | GET/POST | user/admin | Cost tracking + budget |
| `/api/errors` | GET/POST | user/admin | Error tracking |
| `/api/traces` | GET | user | Distributed tracing |
| `/api/admin/*` | GET/POST | admin | Admin operations |

## Troubleshooting

**Build error: `Module not found: remark-gfm`**
```bash
npm install remark-gfm
```

**Database non inizializzato**
```bash
npx prisma db push
npx prisma generate
npx tsx scripts/bootstrap-demo.ts
```

**Login non funziona**
- Verifica che l'admin user esista: `npx tsx scripts/bootstrap-demo.ts`
- Credenziali: `admin@sota-os.local` / `admin123`

**LLM non risponde**
- Il sistema usa fallback deterministico se non c'è API key
- Per LLM reale: Admin → Settings → `llm.api_key`

## Licenza

MIT — vedi [LICENSE](LICENSE)
