# SOTA Agentic OS — Fase 5: Osservabilità, Monitoraggio e Prontezza Produzione

> **Versione:** Draft 1.0 · **Data creazione:** 2026-06-22 · **Stato:** Posticipato (da riprendere in futuro)
> **Prerequisiti:** Fase 4 completata (MCP Server/Client + Skill Management)
> **Durata stimata:** 12-15 giorni lavorativi una volta avviata

---

## Indice

1. [Contesto e Motivazione](#1-contesto-e-motivazione)
2. [Servizi Posticipati (recuperati da Fase 1-3)](#2-servizi-posticipati-recuperati-da-fase-1-3)
3. [Architettura di Osservabilità Target](#3-architettura-di-osservabilità-target)
4. [Componenti Fase 5 — Dettaglio Implementativo](#4-componenti-fase-5--dettaglio-implementativo)
5. [Piano di Implementazione Sequenziale](#5-piano-di-implementazione-sequenziale)
6. [Configurazione e Variabili d'Ambiente](#6-configurazione-e-variabili-dambiente)
7. [Criteri di Accettazione](#7-criteri-di-accettazione)
8. [Impatto su Codice Esistente](#8-impatto-su-codice-esistente)
9. [Considerazioni sui Costi](#9-considerazioni-sui-costi)
10. [Rischi e Mitigazioni](#10-rischi-e-mitigazioni)
11. [Estensioni Future (oltre Fase 5)](#11-estensioni-future-oltre-fase-5)
12. [Checklist di Ripartenza](#12-checklist-di-ripartenza)

---

## 1. Contesto e Motivazione

### 1.1 Perché questa fase esiste

Nelle fasi precedenti (Fase 1 infrastruttura, Fase 2 intelligenza reale, Fase 3 workbench, Fase 4 MCP/skills) abbiamo costruito un sistema funzionalmente completo ma **operativamente cieco**: sappiamo che il sistema funziona perché i test passano (166 unit + 41 integration = 207 test), ma non abbiamo visibilità su cosa succede in produzione quando:

- Un utente remoto incontra un errore 500 non riproducibile localmente
- Le chiamate LLM diventano lentissime senza spiegazione
- Un deploy introduce una regressione di performance invisibile
- I costi superano il budget senza che nessuno venga avvisato in tempo
- Una race condition in Redis pub/sub si manifesta solo sotto carico reale

Questa fase trasforma SOTA Agentic OS da "demo che funziona" a "sistema osservabile in produzione". Il principio guida è la **triade di osservabilità**: logs, metrics, traces — ciascuna con il suo strumento specializzato, integrate tramite OpenTelemetry per evitare vendor lock-in.

### 1.2 Cosa è stato esplicitamente posticipato

Durante la pianificazione di Fase 1, l'utente ha chiesto di posticipare tre servizi critici per concentrarsi prima su MCP e Skill Management (Fase 4):

| Servizio | Categoria | Posticipato da | Motivazione |
|----------|-----------|----------------|-------------|
| **Sentry** | Error tracking + performance | Fase 1 (Track 6) | Necessario solo quando il sistema ha utenti reali |
| **Prometheus** | Metrics collection | Fase 1 (Track 6) | richiede prima volume di traffico reale |
| **Jaeger** | Distributed tracing | Fase 1 (Track 6) | Richiede prima che MCP esternalizzi chiamate |

Questi tre servizi formano il nucleo di Fase 5. Senza di essi, qualsiasi problema in produzione è "best-effort debugging" via log grep — non sostenibile oltre pochi utenti.

### 1.3 Quando attivare questa fase

**Trigger di attivazione consigliati** (almeno uno deve essere vero):

1. **Primi 10 utenti reali** esterni al team di sviluppo
2. **Primo incidente di produzione** non diagnosticabile dai log esistenti
3. **SLA contrattuali** con clienti (anche informali)
4. **On-call rotation** istituita (anche di 1 persona)
5. **Costi mensili LLM > $500** che giustificano monitoring granulare

Se nessun trigger è attivo, è legittimo mantenere posticipata questa fase. Il sistema attuale con `audit-log.ts` (hash chain SHA-256) e logging strutturato via `pino` è sufficiente fino a ~50 utenti interni.

---

## 2. Servizi Posticipati (recuperati da Fase 1-3)

### 2.1 Sentry — Error Tracking & Performance Monitoring

**Categoria:** Observability / Error tracking
**Vendor:** Sentry (SaaS) o self-hosted
**Costo stimato:** $26/mese (Team plan, 50k errors) — gratuito fino a 5k errors/mese

#### 2.1.1 Cosa risolve

Sentry cattura automaticamente eccezioni non gestite, errori di runtime, crash del browser, e promise rejection. Attualmente questi errori vengono persi perché:

- I `console.error` lato server non vengono salvati da nessuna parte
- Gli errori client-side sono visibili solo se l'utente apre DevTools
- Le regressioni introdotte da un deploy vengono scoperte solo quando un utente si lamenta
- Le performance perceived (LCP, FID, CLS) non sono misurate

#### 2.1.2 Integrazione — Server-side

```typescript
// src/lib/observability/sentry-server.ts
import * as Sentry from '@sentry/nextjs';

export function initSentryServer() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.APP_VERSION, // es. "0.10.0"
    tracesSampleRate: 0.1, // 10% delle transazioni (non 100% per costi)
    profilesSampleRate: 0.1,
    integrations: [
      Sentry.prismaIntegration(), // cattura query Prisma lente
      Sentry.redisIntegration(),  // errori connessione Redis
    ],
    beforeSend(event) {
      // Filtra PII — fondamentale per GDPR
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers?.authorization) {
        delete event.request.headers.authorization;
      }
      return event;
    },
  });
}
```

#### 2.1.3 Integrazione — Client-side

```typescript
// src/lib/observability/sentry-client.ts
import * as Sentry from '@sentry/nextjs';

export function initSentryClient() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.01, // 1% sessioni normali
    replaysOnErrorSampleRate: 1.0,  // 100% sessioni con errore
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,         // GDPR: maschera tutto il testo
        blockAllMedia: true,       // no screenshot di contenuti
      }),
    ],
  });
}
```

#### 2.1.4 Punti di strumentazione specifici

- **API routes** (37 routes esistenti): `withSentry()` wrapper automatico
- **Kernel modules** (F1-F23): `Sentry.captureException` nei catch blocks
- **LLM calls** (ZAI SDK): transazione custom `llm.complete` con span per token streaming
- **Prisma queries**: automatico via integration, ma aggiungere `transaction()` span per le 65 tabelle
- **WebSocket pub/sub**: breadcrumb manuale su ogni messaggio Redis

#### 2.1.5 Source maps upload

Configurare in `next.config.ts`:

```typescript
const { withSentryConfig } = require('@sentry/nextjs');

module.exports = withSentryConfig(nextConfig, {
  org: 'sota-agentic',
  project: 'agentic-os',
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Upload source maps solo in CI, non localmente
});
```

### 2.2 Prometheus — Metrics Collection

**Categoria:** Observability / Metrics
**Vendor:** Self-hosted (preferibile) o Grafana Cloud
**Costo stimato:** $0 self-hosted su Railway add-on, ~$20/mese managed

#### 2.2.1 Cosa risolve

Prometheus raccoglie metriche time-series con cardinalità controllata. A differenza dei log (che sono eventi discreti), le metriche sono aggregazioni continue che permettono di:

- Vedere trend (es. "le chiamate LLM sono aumentate del 40% in 7 giorni")
- Impostare alerting basato su soglie (es. "error rate > 5% per 5 minuti")
- Costruire dashboard Grafana con query PromQL
- Calcolare SLO/SLA in modo oggettivo

#### 2.2.2 Metriche custom da esporre

```typescript
// src/lib/observability/metrics.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();

// === Metriche di business ===
export const llmCallsTotal = new Counter({
  name: 'sota_llm_calls_total',
  help: 'Total LLM API calls',
  labelNames: ['phase', 'status', 'model'] as const,
  registers: [registry],
});

export const llmCallDuration = new Histogram({
  name: 'sota_llm_call_duration_seconds',
  help: 'LLM call duration in seconds',
  labelNames: ['phase', 'model'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120], // 8 buckets
  registers: [registry],
});

export const llmCostUsd = new Counter({
  name: 'sota_llm_cost_usd_total',
  help: 'Total LLM cost in USD',
  labelNames: ['phase', 'model'] as const,
  registers: [registry],
});

// === Metriche di sistema ===
export const activeWorkspaces = new Gauge({
  name: 'sota_active_workspaces',
  help: 'Number of active workspaces',
  labelNames: ['organization_id'] as const,
  registers: [registry],
});

export const websocketConnections = new Gauge({
  name: 'sota_websocket_connections',
  help: 'Current WebSocket connections',
  registers: [registry],
});

export const redisPubSubLag = new Histogram({
  name: 'sota_redis_pubsub_lag_seconds',
  help: 'Redis pub/sub message latency',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

// === Metriche kernel F1-F23 ===
export const phaseExecutionTotal = new Counter({
  name: 'sota_phase_execution_total',
  help: 'Micro-phase executions',
  labelNames: ['phase_id', 'outcome'] as const, // outcome: success|failure|timeout
  registers: [registry],
});

export const agentDecisionsTotal = new Counter({
  name: 'sota_agent_decisions_total',
  help: 'Agent decisions taken',
  labelNames: ['strategy', 'outcome'] as const, // strategy: ACTS phases
  registers: [registry],
});
```

#### 2.2.3 Endpoint `/metrics`

```typescript
// src/app/api/metrics/route.ts
import { registry } from '@/lib/observability/metrics';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  // Proteggere l'endpoint in produzione con basic auth o IP whitelist
  const authHeader = _req.headers.get('authorization');
  if (process.env.METRICS_BASIC_AUTH) {
    const expected = `Basic ${Buffer.from(process.env.METRICS_BASIC_AUTH).toString('base64')}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const metrics = await registry.metrics();
  return new NextResponse(metrics, {
    headers: { 'Content-Type': registry.contentType },
  });
}

export const runtime = 'nodejs';
```

#### 2.2.4 Alerting rules (PromQL)

```yaml
# prometheus/alerts.yml
groups:
  - name: sota-critical
    rules:
      - alert: HighLLMErrorRate
        expr: |
          rate(sota_llm_calls_total{status="error"}[5m])
          / rate(sota_llm_calls_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "LLM error rate > 5% per 5 minuti"

      - alert: LLMCallSlow
        expr: |
          histogram_quantile(0.95, rate(sota_llm_call_duration_seconds_bucket[5m])) > 30
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "P95 LLM latency > 30s"

      - alert: BudgetExceeded
        expr: sota_llm_cost_usd_total > 500
        labels:
          severity: critical
        annotations:
          summary: "Costo LLM totale > $500"

      - alert: WebSocketConnectionsDropped
        expr: |
          delta(sota_websocket_connections[5m]) < -10
        for: 2m
        labels:
          severity: warning
```

### 2.3 Jaeger + Distributed Tracing

**Categoria:** Observability / Distributed tracing
**Vendor:** Jaeger (self-hosted) o Tempo (Grafana Cloud)
**Costo stimato:** $0 self-hosted, ~$50/messe managed su Grafana Cloud

#### 2.3.1 Cosa risolve

Con MCP (Fase 4) il sistema esternalizza chiamate a tool esterni: un singolo comando utente può attraversare 5+ servizi (frontend → API route → kernel → MCP server → external tool → kernel → DB → WebSocket → frontend). Senza distributed tracing:

- Impossibile capire dove si trova il bottleneck
- Impossibile correlare errori cross-service
- Impossibile determinare se un timeout è nel MCP server o nel tool esterno

Jaeger visualizza lo span tree completo con temporizzazione per ogni hop.

#### 2.3.2 OpenTelemetry setup

```typescript
// src/lib/observability/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export function initTracing() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  const traceExporter = new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: 'sota-agentic-os',
      [SEMRESATTRS_SERVICE_VERSION]: process.env.APP_VERSION ?? 'dev',
    }),
    traceExporter,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          // Non tracciare /metrics e health checks
          return req.url === '/metrics' || req.url === '/api/health';
        },
      }),
      new ExpressInstrumentation(),
    ],
  });

  sdk.start();
  process.on('SIGTERM', () => sdk.shutdown());
}
```

#### 2.3.3 Span custom per micro-fasi

```typescript
// src/lib/observability/phase-tracing.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('sota-agentic.kernel');

export async function tracedPhaseExecution<T>(
  phaseId: string,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(`phase.${phaseId}.execute`, async (span) => {
    span.setAttribute('phase.id', phaseId);

    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

#### 2.3.4 Trace propagation verso MCP

Quando Fase 4 expose MCP tools, ogni chiamata MCP deve propagare il `traceparent` header:

```typescript
// src/lib/mcp/client.ts (Fase 4, da estendere in Fase 5)
import { context, propagation } from '@opentelemetry/api';

export async function callMcpTool(toolName: string, args: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Inietta il contesto di trace corrente negli header
  propagation.inject(context.active(), headers);

  const response = await fetch(`${MCP_SERVER_URL}/tools/${toolName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });

  return response.json();
}
```

#### 2.3.5 Sampling strategy

- **Prod:** 10% sampling (HeadSampling) — bilanciato per costi vs visibilità
- **Staging:** 100% sampling — debugging completo
- **Dev:** 100% sampling, exporter verso Jaeger UI locale

```typescript
// In tracing.ts, aggiungere:
import { ParentBasedSampler, TraceIdRatioBasedSampler, AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';

const sampler = new ParentBasedSampler({
  rootSampler: process.env.NODE_ENV === 'production'
    ? new TraceIdRatioBasedSampler(0.1)
    : new AlwaysOnSampler(),
});
```

---

## 3. Architettura di Osservabilità Target

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js Application                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  OpenTelemetry SDK (unica sorgente di telemetria)         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │
│  │  │   Traces     │  │   Metrics    │  │    Logs      │    │  │
│  │  │  (OTLP)      │  │  (prom-cl)   │  │  (pino → ?)  │    │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │  │
│  └─────────┼─────────────────┼─────────────────┼─────────────┘  │
└────────────┼─────────────────┼─────────────────┼────────────────┘
             │                 │                 │
             ▼                 ▼                 ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │   Jaeger     │  │ Prometheus   │  │  Loki        │
     │   (UI)       │  │  (scrape     │  │  (log        │
     │              │  │   /metrics)  │  │   aggregation│
     └──────────────┘  └──────┬───────┘  │   via OTLP)  │
                              │          └──────────────┘
                              ▼
                       ┌──────────────┐
                       │   Grafana    │
                       │ (dashboards, │
                       │  alerting)   │
                       └──────────────┘

                ┌──────────────┐
                │   Sentry     │  ← Error tracking standalone
                │  (SaaS)      │     (non fa parte della triade OTel)
                └──────────────┘
```

### 3.1 Principi architetturali

1. **OpenTelemetry come unico SDK** — niente strumentazione vendor-specific diretta (eccetto Sentry per gli errori non gestiti, che è il suo sweet spot)
2. **Export verso backend intercambiabili** — Jaeger può diventare Tempo, Prometheus può diventare VictoriaMetrics, senza toccare il codice
3. **Cardinalità controllata** — niente `user_id` come label (esplosione di serie), usare `organization_id` al massimo
4. **PII never leaves the app** — log/metrics/traces non contengono mai contenuto conversazionale, solo metadati (phase_id, status, duration)
5. **Sampling differenziato per env** — dev/staging 100%, prod 10% traces + 100% metrics

### 3.2 Stack raccomandato (self-hosted su Railway)

| Servizio  | Add-on Railway        | Costo/mese | RAM   |
|-----------|-----------------------|------------|-------|
| Jaeger    | Container custom      | $5         | 512MB |
| Prometheus| Container custom      | $10        | 1GB   |
| Grafana   | Container custom      | $5         | 256MB |
| Loki      | Container custom      | $5         | 512MB |
| **Totale**|                       | **$25/mo** | 2.3GB |

In alternativa, **Grafana Cloud Free Tier** offre 50GB metrics + 50GB logs + 50GB traces gratuitamente — sufficiente per i primi 6-12 mesi.

---

## 4. Componenti Fase 5 — Dettaglio Implementativo

Oltre ai 3 servizi posticipati, Fase 5 aggiunge componenti complementari necessari per rendere l'osservabilità actionable.

### 4.1 Health Check Avanzati

L'endpoint `/api/health` attuale risponde solo `200 OK`. Estendere per coprire tutte le dipendenze:

```typescript
// src/app/api/health/route.ts (esteso)
export async function GET() {
  const checks = await Promise.allSettled([
    checkPostgres(),    // SELECT 1
    checkRedis(),       // PING
    checkZaiLlm(),      // mini call (cached 60s)
    checkMcpServer(),   // POST /health (Fase 4 dependency)
  ]);

  const status = checks.every(r => r.status === 'fulfilled') ? 200 : 503;
  const body = {
    status: status === 200 ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION,
    checks: {
      postgres: checks[0].status,
      redis: checks[1].status,
      llm: checks[2].status,
      mcp: checks[3].status,
    },
  };

  return NextResponse.json(body, { status });
}
```

### 4.2 Alerting & On-Call (AlertManager + Slack/PagerDuty)

Configurare AlertManager collegato a Prometheus per routing alert:

```yaml
# alertmanager/config.yml
route:
  receiver: 'slack-default'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: ['severity="critical"']
      receiver: 'pagerduty-critical'
    - matchers: ['severity="warning"']
      receiver: 'slack-warnings'

receivers:
  - name: 'slack-default'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#sota-alerts'

  - name: 'slack-warnings'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#sota-warnings'

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '${PAGERDUTY_KEY}'
```

### 4.3 Log Aggregation (Loki via OTLP)

Sostituire il logging pino-only con pipeline strutturata verso Loki:

```typescript
// src/lib/observability/logger.ts
import pino from 'pino';
import { trace, context } from '@opentelemetry/api';

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    log(record) {
      // Inietta trace_id e span_id per correlazione in Loki
      const span = trace.getSpan(context.active());
      if (span) {
        const spanContext = span.spanContext();
        record.trace_id = spanContext.traceId;
        record.span_id = spanContext.spanId;
      }
      return record;
    },
  },
});

export const logger = baseLogger;
```

In Loki, query per trace_id recupera tutti i log + il trace Jaeger — correlazione completa.

### 4.4 Uptime Monitoring (esterno)

Per uptime esterno (5 regioni globali), usare **UptimeRobot free tier** o **BetterStack**:

- Ping HTTPS `/api/health` ogni 30s
- Keyword monitoring: deve contenere `"healthy"`
- 5 regioni: US-East, US-West, EU-West, EU-Central, AP-Southeast
- Alert via email se 2+ regioni falliscono per 1 minuto

### 4.5 Performance Budgets (Web Vitals)

Integrare `next/web-vitals` con reporting a Prometheus:

```typescript
// src/app/layout.tsx (estendere)
'use client';
import { useReportWebVitals } from 'next/web-vitals';
import { browserMetrics } from '@/lib/observability/browser-metrics';

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    browserMetrics.webVital({
      name: metric.name,
      value: metric.value,
      rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
    });
  });
  return null;
}
```

Metriche tracked: LCP, FID/INP, CLS, TTFB, FCP — con alert se P75 > soglia per 1h.

### 4.6 Dashboard Grafana Predefinite

Creare 5 dashboard JSON provisioned:

1. **Overview** — KPI principali (active users, LLM calls/min, error rate, cost/hour)
2. **LLM Performance** — latency P50/P95/P99 per fase, costo per fase, error rate
3. **Kernel Phases** — execution count, duration, failure rate per F1-F23
4. **Infrastructure** — PostgreSQL connections, Redis ops/s, WebSocket connections
5. **Business** — workspaces created, branches, shares, conversions (da estendere in Fase 6 billing)

Tutte le dashboard salvate in `infra/grafana/dashboards/*.json` con provisioning automatico.

---

## 5. Piano di Implementazione Sequenziale

### Track 7.1 — Sentry (giorni 1-3)

| Giorno | Task | Output |
|-------|------|--------|
| 1 | Setup account Sentry + progetto Next.js | DSN + auth token |
| 1 | Installazione `@sentry/nextjs`, init server/client | Wrapper attivi |
| 2 | Strumentazione API routes (37) + kernel modules | `withSentry()` applicato |
| 2 | Configurazione source maps upload in CI | Stack traces leggibili |
| 3 | Filtri PII/GDPR + test con errore artificiale | Evento visibile in Sentry |

**Dipendenze:** Nessuna (può partire subito)
**Rischi:** Costi se `tracesSampleRate` troppo alto

### Track 7.2 — OpenTelemetry + Jaeger (giorni 3-7)

| Giorno | Task | Output |
|-------|------|--------|
| 3 | Installazione OTel SDK + setup exporter OTLP | Tracing base attivo |
| 4 | Span custom per F1-F23 (kernel phases) | Trace visualizzabili in Jaeger |
| 5 | Trace propagation verso MCP server (richiede Fase 4) | End-to-end trace |
| 6 | Sampling differenziato per env | Costi controllati |
| 7 | Dashboard Jaeger UI configurata | UI utilizzabile |

**Dipendenze:** Fase 4 (MCP) completata per trace propagation
**Rischi:** Overhead performance se sampling non configurato

### Track 7.3 — Prometheus + Grafana (giorni 7-11)

| Giorno | Task | Output |
|-------|------|--------|
| 7 | Deploy Prometheus + Grafana su Railway | Servizi running |
| 8 | Metriche custom (llm, phases, websocket, cost) | Endpoint `/metrics` popolato |
| 9 | 5 dashboard Grafana predefinite | Dashboard JSON committati |
| 10 | AlertManager + regole PromQL | Alert routing configurato |
| 11 | Integrazione Slack/PagerDuty + test alert | Alert end-to-end funzionante |

**Dipendenze:** Track 7.2 (per metriche OTel-derivate)
**Rischi:** Esplosione cardinalità se label mal progettate

### Track 7.4 — Health checks + Web Vitals (giorni 11-13)

| Giorno | Task | Output |
|-------|------|--------|
| 11 | Health check avanzato multi-dependency | Endpoint 503 su degraded |
| 12 | Web Vitals reporting → Prometheus | Metriche LCP/CLS/INP tracked |
| 13 | Uptime monitoring esterno (UptimeRobot) | 5 regioni monitorate |

**Dipendenze:** Track 7.3
**Rischi:** LLM check può causare alert storm se rate-limited

### Track 7.5 — Loki + Documentazione (giorni 13-15)

| Giorno | Task | Output |
|-------|------|--------|
| 13 | Deploy Loki + pino-to-OTLP pipeline | Log centralizzati |
| 14 | Correlazione trace_id ↔ log in Grafana | Query cross-source |
| 15 | Documentazione runbook + onboarding team | `OBSERVABILITY-RUNBOOK.md` |

**Dipendenze:** Track 7.2 + 7.3

---

## 6. Configurazione e Variabili d'Ambiente

### 6.1 Nuove variabili d'ambiente

Aggiungere a `.env.example` e Railway:

```bash
# === Sentry ===
SENTRY_DSN=                          # server-side
NEXT_PUBLIC_SENTRY_DSN=              # client-side (stesso DSN)
SENTRY_AUTH_TOKEN=                   # CI source maps upload
SENTRY_ORG=sota-agentic
SENTRY_PROJECT=agentic-os

# === OpenTelemetry ===
OTEL_EXPORTER_OTLP_ENDPOINT=https://jaeger.internal:4318
OTEL_SERVICE_NAME=sota-agentic-os
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production

# === Prometheus / Grafana ===
METRICS_BASIC_AUTH=user:password    # basic auth per /metrics
GRAFANA_ADMIN_PASSWORD=              # admin Grafana
PAGERDUTY_KEY=                       # routing critical alerts
SLACK_WEBHOOK_URL=                   # routing warnings

# === UptimeRobot (external) ===
UPTIMEROBOT_API_KEY=
```

### 6.2 Nuove dipendenze npm

```json
{
  "dependencies": {
    "@sentry/nextjs": "^8.0.0",
    "@opentelemetry/sdk-node": "^1.25.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.52.0",
    "@opentelemetry/instrumentation-http": "^0.52.0",
    "@opentelemetry/instrumentation-express": "^0.40.0",
    "@opentelemetry/api": "^1.9.0",
    "prom-client": "^15.1.0"
  },
  "devDependencies": {
    "@types/prom-client": "^2.0.0"
  }
}
```

### 6.3 File di configurazione infra

```
infra/
├── docker-compose.observability.yml   # per dev locale
├── prometheus/
│   ├── prometheus.yml
│   └── alerts.yml
├── alertmanager/
│   └── config.yml
├── grafana/
│   ├── datasources.yml
│   ├── dashboards/
│   │   ├── overview.json
│   │   ├── llm-performance.json
│   │   ├── kernel-phases.json
│   │   ├── infrastructure.json
│   │   └── business.json
│   └── provisioning.yml
└── jaeger/
    └── jaeger-config.yml
```

---

## 7. Criteri di Accettazione

La Fase 5 è considerata completa quando **tutti** i seguenti criteri sono soddisfatti:

### 7.1 Sentry
- [ ] Errore artificiale in `/api/console/stream` appare in Sentry entro 5s con stack trace leggibile
- [ ] Source maps caricati in CI (build di produzione)
- [ ] Session replay attivo per sessioni con errore (1.0 sample rate)
- [ ] PII filter verificato: cookies e auth headers rimossi
- [ ] Performance monitoring attivo (transazioni HTTP tracciate al 10%)

### 7.2 Prometheus
- [ ] Endpoint `/metrics` esposto e protetto da basic auth
- [ ] Prometheus scrape configurato con intervallo 15s
- [ ] 5 dashboard Grafana importate e funzionanti
- [ ] Almeno 8 metriche custom definite (llm, phases, websocket, cost)
- [ ] Alert `HighLLMErrorRate` testato end-to-end (trigger → Slack)

### 7.3 Jaeger / Distributed Tracing
- [ ] Trace visibile in Jaeger UI per una richiesta `/api/console/stream` completa
- [ ] Span custom per almeno 5 micro-fasi kernel (F1, F10, F14, F17, F23)
- [ ] Trace propagation verso MCP server verificata (se Fase 4 completata)
- [ ] Sampling 10% in prod, 100% in staging
- [ ] Correlazione trace_id ↔ log in Loki funzionante

### 7.4 Componenti complementari
- [ ] Health check restituisce 503 quando PostgreSQL down (testato)
- [ ] Web Vitals LCP/CLS/INP tracked in Prometheus
- [ ] UptimeRobot configurato su 5 regioni
- [ ] Runbook operativo `OBSERVABILITY-RUNBOOK.md` scritto
- [ ] Onboarding team completato (1h sessione)

### 7.5 Non-regression
- [ ] Tutti i 207 test esistenti (166 unit + 41 integration) passano
- [ ] Bundle size client-side aumenta < 50KB (Sentry + OTel)
- [ ] Overhead server-side < 5% latency P95
- [ ] Costo mensile osservabilità < $30 (self-hosted) o < $100 (managed)

---

## 8. Impatto su Codice Esistente

### 8.1 File da modificare (NO breaking changes)

| File | Modifica | Rischio |
|------|----------|---------|
| `next.config.ts` | Wrap con `withSentryConfig` | Basso |
| `src/app/api/health/route.ts` | Estendere checks | Basso |
| `src/app/layout.tsx` | Aggiungere `<WebVitalsReporter />` | Basso |
| `src/instrumentation.ts` (nuovo) | Init Sentry + OTel | Basso |
| `src/lib/kernel/phase-runner.ts` | Wrap con `tracedPhaseExecution` | Medio |
| `src/lib/llm/zai-client.ts` | Aggiungere metrics + span | Medio |
| `src/lib/redis/pubsub.ts` | Aggiungere metric lag | Basso |
| 37 API routes | Wrap con `withSentry()` | Basso (meccanico) |

### 8.2 Test da aggiungere

```typescript
// tests/unit/observability/metrics.test.ts
describe('Metrics registry', () => {
  it('exposes llm_calls_total with correct labels', async () => {
    llmCallsTotal.inc({ phase: 'F10', status: 'success', model: 'zai-glm' });
    const output = await registry.metrics();
    expect(output).toContain('sota_llm_calls_total');
    expect(output).toContain('phase="F10"');
  });

  it('does not leak PII in metrics', () => {
    llmCallsTotal.inc({ phase: 'F10', status: 'success', model: 'zai-glm' });
    // Verifica che nessuna label contenga user_id, email, conversation_id
    expect(registry.getMetricsAsJSON()).not.toMatch(/user_\d+|@/);
  });
});
```

Target: +20 test unit + 5 test integration = **232 test totali**

---

## 9. Considerazioni sui Costi

### 9.1 Costo mensile stimato (post Fase 5)

| Voce | Self-hosted | Managed (Grafana Cloud) |
|------|-------------|------------------------|
| Sentry Team | $26 | $26 |
| Jaeger (Railway container) | $5 | incluso |
| Prometheus (Railway container) | $10 | incluso |
| Grafana (Railway container) | $5 | incluso |
| Loki (Railway container) | $5 | incluso |
| UptimeRobot | $0 | $0 |
| **Totale** | **$51/mo** | **$26/mo** (free tier, 6-12 mesi) |

### 9.2 Costi nascosti da monitorare

- **Sentry replay storage**: 1% sessioni × utenti × dimensione replay → può esplodere
- **OTel exporter batch**: se troppo aggressivo, aumenta latency API
- **Prometheus storage**: retention 15gg default, estendere a 90gg = +3x storage
- **Loki ingestion**: log verbose in debug possono costare $100+/mo

### 9.3 Strategia di contenimento

1. **Sampling differziato**: 10% traces, 1% replays normali, 100% errori
2. **Retention aggressiva**: 15 giorni traces, 30 giorni metrics, 90 giorni logs
3. **Alert su costo**: PromQL `increase(sota_llm_cost_usd_total[1h]) > 10` → Slack
4. **Cardinality cap**: nessuna label con `user_id`, `conversation_id`, `message_id`

---

## 10. Rischi e Mitigazioni

### 10.1 Performance overhead

**Rischio:** OTel + Sentry + prom-client possono aggiungere 5-15% overhead alle richieste.

**Mitigazione:**
- Sampling 10% in produzione (traces), 100% metrics (overhead trascurabile)
- Batch export OTel (500ms o 512 batch size)
- Disabilitare `browserTracingIntegration` in dev locale
- Benchmark prima/dopo con `autocannon` su `/api/console/stream`

### 10.2 Privacy e GDPR

**Rischio:** Tracce e log possono contenere contenuto conversazionale → violazione GDPR.

**Mitigazione:**
- Whitelist di attributi tracciabili (mai payload completo)
- `beforeSend` Sentry filtra cookies/headers/auth
- Log pino: level info+, mai debug in prod con payload
- Data Processing Agreement con Sentry (DPA standard disponibile)

### 10.3 Vendor lock-in

**Rischio:** Dipendenza da Sentry specifico.

**Mitigazione:**
- OTel come SDK universale → backend sostituibile (Sentry → Bugsnag → Datadog)
- Metriche in formato Prometheus standard → VictoriaMetrics, Thanos, Mimir compatibili
- Export trace in OTLP → Jaeger, Tempo, Datadog, Honeycomb compatibili

### 10.4 Alert fatigue

**Rischio:** Troppi alert → team inizia a ignorarli.

**Mitigazione:**
- Massimo 5 alert critical (page PagerDuty)
- Alert warning → Slack solo, no page
- `for: 5m` minimo per evitare flapping
- Review mensile alert attivi → silenzare quelli non actionable

### 10.5 Complessità operativa

**Rischio:** 4 nuovi servizi (Jaeger, Prom, Grafana, Loki) da mantenere.

**Mitigazione:**
- Container Docker con healthcheck + restart policy
- Backup config in Git (`infra/` directory)
- Considerare Grafana Cloud per esternalizzare maintenance
- Runbook per ogni alert critical (root cause + fix step)

---

## 11. Estensioni Future (oltre Fase 5)

### 11.1 Fase 6 — Billing & SaaS Conversion (post Fase 5)

- Stripe integration (subscription, metered usage)
- Usage-based billing con metriche già esposte in Prometheus
- Invoice generation + dunning
- Free tier enforcement via middleware

### 11.2 Fase 7 — Multi-region & Scale

- Read replicas PostgreSQL
- Redis cluster (non single instance)
- CDN per assets statici
- Edge runtime per routes geograficamente sensibili

### 11.3 Fase 8 — Compliance & Certifications

- SOC 2 Type II (richiede 6+ mesi di osservabilità continua — Fase 5 è prerequisito)
- ISO 27001
- Penetration testing annuale
- Bug bounty program

### 11.4 Fase 9 — AI Reliability

- A/B testing framework per prompt engineering
- Evaluation pipeline automatica (LLM-as-judge)
- Drift detection su performance LLM
- Cost optimization suggestions via agent

---

## 12. Checklist di Ripartenza

Quando si deciderà di avviare la Fase 5, seguire questo ordine:

### Pre-flight (1 giorno)
- [ ] Verificare che Fase 4 (MCP + Skills) sia completata e stabile
- [ ] Backup completo database PostgreSQL
- [ ] Snapshot Railway environment
- [ ] Creare account Sentry,PagerDuty (o confermare Slack webhook)
- [ ] Allocare 2.5GB RAM su Railway per container osservabilità

### Avvio (giorni 1-3)
- [ ] Track 7.1 — Sentry setup completo e verificato
- [ ] Primo errore reale catturato (anche artificiale)
- [ ] Team ha accesso Sentry dashboard

### Sviluppo (giorni 3-15)
- [ ] Track 7.2 — OpenTelemetry + Jaeger
- [ ] Track 7.3 — Prometheus + Grafana + AlertManager
- [ ] Track 7.4 — Health checks + Web Vitals + UptimeRobot
- [ ] Track 7.5 — Loki + documentazione

### Chiusura (giorno 15)
- [ ] Tutti i criteri di accettazione soddisfatti
- [ ] Runbook pubblicato
- [ ] Onboarding team completato
- [ ] Retrospettiva: cosa ha funzionato, cosa migliorare
- [ ] Aggiornare `ROADMAP.md` principale con stato Fase 5

### Post-chiusura (settimana +1)
- [ ] Review alert attivi (silence false positives)
- [ ] Tuning sampling rate in base a volume reale
- [ ] Costo reale vs stimato, aggiornare budget
- [ ] Pianificare Fase 6 (Billing) basandosi su metriche raccolte

---

## Riferimenti

- **Documentazione correlata:** `ROADMAP.md`, `DOCUMENTATION.md`, `STRATEGY.md`
- **Skill precedente completata:** Fase 4 — MCP Server/Client + Skill Management
- **Trigger di attivazione:** vedere sezione [1.3](#13-quando-attivare-questa-fase)
- **Documentazione OpenTelemetry:** https://opentelemetry.io/docs/
- **Sentry Next.js SDK:** https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **Prometheus best practices:** https://prometheus.io/docs/practices/

---

> **Nota finale:** Questo documento è una capsula temporale — racchiude tutte le decisioni prese al momento del posticipo, in modo che quando la Fase 5 sarà avviata non sarà necessario ricostruire il contesto. Aggiornare il documento man mano che si implementa, segnando con ✅ i task completati.
