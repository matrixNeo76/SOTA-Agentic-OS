# SOTA Agentic OS — Backplane Mode per Claude Code

> **Caso d'uso killer:** collega Claude Code (o qualsiasi client MCP) a SOTA Agentic OS
> per ottenere **memoria persistente** tra sessioni, **governance** (red-lines + approvazioni),
> e **workflow durevoli** che riprendono dopo i crash.

## Prerequisiti

1. SOTA Agentic OS in esecuzione su `http://localhost:3000`
2. Un'API key con scope `exec` (vedi sotto)

## Setup in 3 minuti

### 1. Crea un'API key

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: sota_session=<your-session>" \
  -d '{"name":"claude-code","scopes":["read","exec"]}'
```

Risposta:
```json
{
  "keyId": "sak_a1b2c3d4e5f6",
  "fullKey": "sak_a1b2c3d4e5f6_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b",
  "warning": "Save this key now — the full key cannot be retrieved again."
}
```

### 2. Configura Claude Code

Aggiungi al file di configurazione MCP di Claude Code (`~/.claude/mcp_servers.json`):

```json
{
  "mcpServers": {
    "sota-os": {
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer sak_a1b2c3d4e5f6_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b"
      }
    }
  }
}
```

### 3. Riavvia Claude Code

Claude Code ora vede 27 tool MCP con prefisso `sota_`. Puoi usarli nelle conversazioni.

## Cosa puoi fare

### Memoria persistente (tra sessioni)

```
> "Ricorda che il progetto usa PostgreSQL 16 con pgvector"

Claude Code chiama: sota_memory_store({
  layer: "semantic",
  agentUri: "agent://claude-code",
  content: "Il progetto usa PostgreSQL 16 con pgvector"
})
```

Nella sessione successiva:
```
> "Che database usa il progetto?"

Claude Code chiama: sota_memory_search({ query: "database progetto" })
→ Ritorna il ricordo dalla sessione precedente
```

### Esecuzione di workflow durevoli

```
> "Esegui un'analisi del codice nel repository"

Claude Code chiama: sota_run_create({
  task: "Analizza il codice nel repository e produci un report",
  async: true
})
→ Ritorna { planId: "plan_12345", jobId: "..." }

> "Come va l'analisi?"

Claude Code chiama: sota_run_detail({ planId: "plan_12345" })
→ Mostra tasks completati, in corso, risultati parziali
```

Il workflow **sopravvive ai crash**: se l'OS si riavvia, il recovery boot riprende
i task running dalla coda JobRecord.

### Governance (HITL)

Se un'azione è rischiosa (es. deploy in produzione), il Sovereign Validator la blocca:

```
> "Deploya in produzione"

Claude Code chiama: sota_run_create({ task: "Deploy in produzione", async: true })
→ Il workflow viene eseguito ma l'azione di deploy viene bloccata dall'LTL monitor

> "Ci sono azioni bloccate?"

Claude Code chiama: sota_run_detail({ planId: "..." })
→ Mostra task con status "blocked"

→ L'utente approva dal pannello Admin → Governance → Blocked Actions
```

### Esplorazione del Context Graph

```
> "Mostrami tutti gli agenti nel sistema"

Claude Code chiama: sota_graph_query({ entityType: "Agent" })
→ Ritorna la lista di agenti dalla mesh
```

## Tool MCP disponibili (27)

| Categoria | Tool | Scope richiesto |
|-----------|------|-----------------|
| **Runs** | `sota_run_create`, `sota_run_list`, `sota_run_detail`, `sota_run_recover` | exec |
| **Memory** | `sota_memory_store`, `sota_memory_search` | exec / read |
| **Graph** | `sota_graph_create_node`, `sota_graph_create_edge`, `sota_context_graph_stats` | exec / read |
| **World Model** | `sota_world_model_capture`, `sota_world_model_latest`, `sota_world_model_predict` | read / exec |
| **Digital Twin** | `sota_digital_twin_whatif` | exec |
| **Autonomous Org** | `sota_autonomous_org_proposals`, `sota_autonomous_org_approve` | read / exec |
| **Agent Mesh** | `sota_agent_mesh_topology` | read |
| **Evaluation** | `sota_evaluation_stats` | read |
| **Conflicts** | `sota_conflict_resolution_list`, `sota_conflict_resolution_resolve` | read / exec |
| **Cognitive GC** | `sota_cognitive_gc_stats`, `sota_cognitive_gc_consolidate` | read / exec |
| **Router** | `sota_cognitive_router_classify` | read |
| **Skills** | `sota_skill_registry_search`, `sota_skill_synthesis_detect` | read |
| **Knowledge** | `sota_knowledge_extraction` | exec |
| **System** | `sota_mesh_stats`, `sota_llm_health` | read |

## Scopes

| Scope | Permessi |
|-------|----------|
| `read` | Tutte le query e i tool di monitoring |
| `exec` | Esecuzione workflow, scritture in memoria/grafo, tool call |
| `admin` | Tutto (incluso gestione utenti, API keys, governance) |

## Risoluzione problemi

**401 Unauthorized:** Verifica che l'API key sia corretta e non scaduta.

**403 Insufficient scope:** L'API key non ha lo scope richiesto. Crea una nuova key con scope `exec`.

**Connection refused:** Verifica che l'OS sia in esecuzione su `http://localhost:3000`.
