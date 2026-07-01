# SOTA Agentic OS — Quickstart Guide

> Integra l'OS nel tuo tool in **< 15 minuti**.
>
> Guide per: Claude Code · Cursor · VS Code · Antigravity · MCP generico · A2A generico · SDK REST

## Indice

1. [Prerequisiti](#prerequisiti)
2. [Creare un'API key](#creare-una-api-key)
3. [Claude Code](#claude-code)
4. [Cursor](#cursor)
5. [VS Code](#vs-code)
6. [Antigravity](#antigravity)
7. [MCP generico](#mcp-generico)
8. [A2A generico](#a2a-generico)
9. [SDK REST (qualsiasi linguaggio)](#sdk-rest)
10. [Tool MCP disponibili](#tool-mcp-disponibili)
11. [Risoluzione problemi](#risoluzione-problemi)

---

## Prerequisiti

- SOTA Agentic OS in esecuzione su `http://localhost:3000`
- Account admin (default: `admin@sota-os.local` / `admin123`)

```bash
# Verifica che l'OS sia attivo
curl http://localhost:3000/api/runtime
# → { "provider": "sqlite", "extensions": { "pgvector": false, "age": false }, ... }
```

---

## Creare un'API key

Tutte le integrazioni esterne usano un'API key con scope.

```bash
# Login per ottenere la sessione
SESSION=$(curl -s -X POST http://localhost:3000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"action":"login","email":"admin@sota-os.local","password":"admin123"}' \
  -c - | grep sota_session | awk '{print $NF}')

# Crea API key con scope read+exec
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: sota_session=$SESSION" \
  -d '{"name":"my-integration","scopes":["read","exec"]}'
```

Risposta:
```json
{
  "keyId": "sak_a1b2c3d4e5f6",
  "fullKey": "sak_a1b2c3d4e5f6_7a8b9c0d1e2f...",
  "warning": "Save this key now — the full key cannot be retrieved again."
}
```

**Salva `fullKey`** — non è più recuperabile. Useremo `SOTA_KEY` nelle guide seguenti.

---

## Claude Code

### Setup MCP

Aggiungi al file `~/.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "sota-os": {
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer SOTA_KEY"
      }
    }
  }
}
```

### Usa in conversazione

```
> Memorizza che il progetto usa Next.js 16

# Claude Code chiama: sota_memory_store({ layer: "semantic", content: "..." })

> Cerca nella memoria qualcosa su Next.js

# Claude Code chiama: sota_memory_search({ query: "Next.js" })

> Esegui un'analisi del codice

# Claude Code chiama: sota_run_create({ task: "Analizza il codice", async: true })

> Come va l'analisi?

# Claude Code chiama: sota_run_detail({ planId: "plan_..." })
```

Vedi anche: [docs/backplane-claude-code.md](../docs/backplane-claude-code.md) per una guida completa.

---

## Cursor

### Setup MCP

Cursor supporta MCP server via configurazione in `Settings → MCP Servers`:

1. Apri Cursor Settings → Features → MCP
2. Aggiungi un nuovo server:
   - **URL:** `http://localhost:3000/api/mcp`
   - **Headers:** `Authorization: Bearer SOTA_KEY`
3. Salva e riavvia Cursor

### Usa in chat

Cursor esporrà i 27 tool `sota_*` come funzioni disponibili all'LLM. Puoi chiedere:

```
> "Usa SOTA per memorizzare che stiamo usando Tailwind CSS 4"
> "Avvia un workflow SOTA per generare documentazione del codice"
> "Cerca nel Context Graph tutti gli agenti registrati"
```

---

## VS Code

### Setup MCP (con Continue o Cline)

**Cline extension:**

1. Installa l'estensione Cline da VS Code Marketplace
2. Apri Cline Settings → MCP Servers
3. Aggiungi:
   ```json
   {
     "sota-os": {
       "url": "http://localhost:3000/api/mcp",
       "headers": {
         "Authorization": "Bearer SOTA_KEY"
       }
     }
   }
   ```
4. Salva e ricarica la finestra

### Usa nell'editor

I tool `sota_*` saranno disponibili nei prompt di Cline:

```
> "Memorizza le decisioni di questa sessione in SOTA"
> "Avvia un run SOTA per refactor del modulo auth"
```

---

## Antigravity

Antigravity supporta MCP. Configurazione:

1. Apri Antigravity Settings → Integrations → MCP
2. Aggiungi server MCP con URL `http://localhost:3000/api/mcp`
3. Imposta header `Authorization: Bearer SOTA_KEY`
4. Testa la connessione (dovresti vedere 27 tool)

---

## MCP generico

Qualsiasi client che implementa MCP (Model Context Protocol) può connettersi:

```python
# Esempio Python con mcp-sdk
from mcp import Client

client = Client(
    url="http://localhost:3000/api/mcp",
    headers={"Authorization": "Bearer sak_..."}
)

# Initialize
await client.initialize()

# List tools
tools = await client.list_tools()
# → 27 tool con prefisso sota_

# Call a tool
result = await client.call_tool("sota_memory_search", {"query": "project architecture"})
```

```bash
# Test con curl
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sak_..." \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## A2A generico

Il protocollo A2A (Agent-to-Agent) permette a agenti esterni di delegare task.

### Discovery

```bash
# Scopri l'agent card
curl http://localhost:3000/.well-known/agent.json
```

```json
{
  "id": "sota-agentic-os",
  "name": "SOTA Agentic OS",
  "capabilities": { "streaming": true, "stateTransition": true },
  "endpoints": { "tasks": "/api/a2a/tasks" },
  "authentication": { "schemes": ["bearer"] }
}
```

### Submit task

```bash
curl -X POST http://localhost:3000/api/a2a/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sak_..." \
  -d '{
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Analizza il repository e genera un report" }]
    }
  }'
```

```json
{
  "id": "a2a-1234567890-abc123",
  "status": "working",
  "planId": "plan_1234567890",
  "jobId": "..."
}
```

### Poll status

```bash
curl http://localhost:3000/api/a2a/tasks?taskId=a2a-1234567890-abc123 \
  -H "Authorization: Bearer sak_..."
```

```json
{
  "id": "a2a-1234567890-abc123",
  "status": "completed",
  "result": { "parts": [{ "type": "text", "text": "..." }] },
  "artifacts": [...]
}
```

### Cancel

```bash
curl -X POST http://localhost:3000/api/a2a/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sak_..." \
  -d '{"action":"cancel","taskId":"a2a-1234567890-abc123"}'
```

---

## SDK REST

### OpenAPI spec

```bash
# Scarica la spec OpenAPI 3.0
curl http://localhost:3000/api/openapi > sota-openapi.json

# Genera client in qualsiasi linguaggio
npx openapi-generator-cli generate -i sota-openapi.json -g typescript-fetch -o ./sota-client
# o Python:
openapi-generator-cli generate -i sota-openapi.json -g python -o ./sota-client
```

### Esempio TypeScript

```typescript
const SOTA_URL = 'http://localhost:3000'
const SOTA_KEY = 'sak_a1b2c3d4e5f6_7a8b9c0d...'
const headers = { Authorization: `Bearer ${SOTA_KEY}` }

// List runs
const runs = await fetch(`${SOTA_URL}/api/runs/list?limit=10`, { headers })
  .then(r => r.json())

// Create run
const run = await fetch(`${SOTA_URL}/api/console/stream`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ task: 'Analyze code quality', mode: 'plan-only' }),
}).then(r => r.json())

// Search memory
const memories = await fetch(`${SOTA_URL}/api/admin/memory`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'search', query: 'architecture decisions' }),
}).then(r => r.json())
```

### Esempio Python

```python
import requests

SOTA_URL = "http://localhost:3000"
HEADERS = {"Authorization": "Bearer sak_..."}

# List runs
runs = requests.get(f"{SOTA_URL}/api/runs/list", headers=HEADERS).json()

# Search memory
result = requests.post(f"{SOTA_URL}/api/admin/memory", headers=HEADERS,
    json={"action": "search", "query": "architecture"}).json()

# A2A submit task
task = requests.post(f"{SOTA_URL}/api/a2a/tasks", headers=HEADERS,
    json={"message": {"role": "user", "parts": [{"type": "text", "text": "Generate tests"}]}}).json()
```

### Esempio cURL

```bash
# List all API keys
curl http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer sak_..."

# Get system stats
curl http://localhost:3000/api/admin/settings \
  -H "Authorization: Bearer sak_..."

# Get audit trail
curl "http://localhost:3000/api/admin/audit?sinceHours=1" \
  -H "Authorization: Bearer sak_..."

# Check quotas
curl http://localhost:3000/api/admin/quotas \
  -H "Authorization: Bearer sak_..."
```

---

## Tool MCP disponibili

27 tool totali, categorizzati per funzione:

| Categoria | Tool | Scope |
|-----------|------|-------|
| **Runs** | `sota_run_create`, `sota_run_list`, `sota_run_detail`, `sota_run_recover` | exec |
| **Memory** | `sota_memory_store`, `sota_memory_search` | exec / read |
| **Graph** | `sota_graph_create_node`, `sota_graph_create_edge`, `sota_context_graph_stats` | exec / read |
| **World Model** | `sota_world_model_capture/latest/predict` | read / exec |
| **Digital Twin** | `sota_digital_twin_whatif` | exec |
| **Autonomous Org** | `sota_autonomous_org_proposals/approve` | read / exec |
| **Agent Mesh** | `sota_agent_mesh_topology` | read |
| **Evaluation** | `sota_evaluation_stats` | read |
| **Conflicts** | `sota_conflict_resolution_list/resolve` | read / exec |
| **Cognitive GC** | `sota_cognitive_gc_stats/consolidate` | read / exec |
| **Router** | `sota_cognitive_router_classify` | read |
| **Skills** | `sota_skill_registry_search`, `sota_skill_synthesis_detect` | read |
| **Knowledge** | `sota_knowledge_extraction` | exec |
| **System** | `sota_mesh_stats`, `sota_llm_health` | read |

---

## Risoluzione problemi

| Problema | Causa | Soluzione |
|----------|-------|-----------|
| 401 Unauthorized | API key mancante o invalida | Verifica header `Authorization: Bearer sak_...` |
| 403 Insufficient scope | API key senza scope richiesto | Crea nuova key con scope `exec` |
| 429 Too Many Requests | Rate limit superato | Riduci frequenza o aumenta `rateLimitPerMin` |
| Connection refused | OS non in esecuzione | `bun run dev` o `docker compose up` |
| Tool non trovato | Nome tool errato | Esegui `tools/list` via MCP per elenco completo |
| A2A task non trovato | taskId errato o scaduto | Verifica con `GET /api/a2a/tasks?taskId=...` |
| OpenAPI spec vuota | Endpoint non raggiungibile | Verifica `GET /api/openapi` |

---

## Scopes

| Scope | Permessi |
|-------|----------|
| `read` | Query, monitoring, search |
| `exec` | Esecuzione workflow, scritture memoria/grafo |
| `admin` | Tutto (API keys, users, governance, settings) |

## Rate Limits

Default: 60 richieste/minuto per API key. Configurabile in `ApiKey.rateLimitPerMin`.

Headers di risposta:
- `X-RateLimit-Limit`: limite per minuto
- `X-RateLimit-Remaining`: richieste rimanenti
- `X-RateLimit-Reset`: timestamp reset (epoch ms)
