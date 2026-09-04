# UX Architecture — SOTA Agentic OS

**Data**: 2026-09-04
**Status**: Design proposal
**Scope**: User experience layer above the 14 kernel modules

---

## 1. Problema

Il sistema ha **34 destinazioni di navigazione** (6 aree + 14 fasi Advanced + 5 tab workbench + Admin). L'unico modo reale per usare l'OS è **digitare un task nella Console** — tutto il resto è osservabilità/debug.

### Gap critici identificati

| Gap | API esiste | UI manca |
|-----|-----------|----------|
| Create Agent Wizard | ✅ `/api/agent-lifecycle {action:'register'}` | ❌ Nessun form |
| Per-run Tool/Model picker | ✅ `DEFAULT_MODELS` + `/api/tools` + `executeReActLoop({modelId})` | ❌ Console non passa modelId/allowedTools |
| Pipeline Builder visuale | ❌ Canvas è read-only | ❌ Nessun drag-drop |
| First-run wizard | ❌ Solo tour passivi | ❌ Nessun setup guidato |

---

## 2. Architettura target: 3 modalità d'uso

### Modalità 1: Quick Task (esistente, semplificata)
```
Console → digita task → "Esegui" → tutto automatico
```
Per utenti casuali. LLM sceglie piano, agenti, tool, modello.
**Miglioramento**: aggiungere selettore Tool/Modello opzionale.

### Modalità 2: Guided Pipeline (nuova)
```
Pipeline Builder → definisci task + agenti + dipendenze → "Esegui Pipeline"
```
Per utenti che vogliono controllo. Piano human-defined, executor lo esegue.
**Future work**: Canvas edit mode con drag-drop.

### Modalità 3: Agent Swarm (nuova)
```
Agent Manager → crea N agenti → assegna tool/skill/modello → "Launch Swarm"
```
Per utenti avanzati. Swarm con quorum/ESR.
**Primo step**: Create Agent Wizard.

---

## 3. Componenti da implementare

### 3.1 Create Agent Wizard (`create-agent-dialog.tsx`)

**Posizione**: `src/components/agentic/create-agent-dialog.tsx`
**Trigger**: Button "Crea Agente" in `Agents & Org` → Lifecycle tab
**API**: `POST /api/agent-lifecycle {action:'register'}`

**Form steps** (single dialog, non multi-page):
1. **Identity**: name (required), description (required), version (default '1.0.0')
2. **Role**: dropdown (orchestrator, curator, controller, verifier, reflective, custom)
3. **Model**: dropdown da `DEFAULT_MODELS` (6 modelli, raggruppati per specializzazione)
4. **Capabilities**: multi-select (text input, add/remove)
5. **Skills**: multi-select da `GET /api/skill-registry` (filter active)
6. **Parent Agent**: dropdown da `GET /api/agent-lifecycle` (optional)

**Data sources** (fetch on dialog open):
- `GET /api/router?action=models` → model list
- `GET /api/skill-registry` → skill list (filter `lifecycleState==='active'`)
- `GET /api/agent-lifecycle` → existing agents (for parent dropdown)

**POST body**:
```ts
{
  action: 'register',
  name: string,
  description: string,
  version: '1.0.0',
  roles: [{ name: role, permissions: [] }],
  capabilities: capabilities.map(name => ({ name, description: '' })),
  skills: selectedSkillUris,
  parentAgent: parentUri || undefined,
}
```

### 3.2 Console Tool/Model Selector (`console-input.tsx` extension)

**Posizione**: modify `src/components/console/console-input.tsx`
**Approach**: popover accanto al pulsante "Send"

**New props on `ConsoleInput`**:
```ts
// Existing
input, setInput, executing, onSend, onStop, onPlanOnly, skills
// New
modelId?: string
setModelId?: (id: string | undefined) => void
allowedTools?: string[]
setAllowedTools?: (tools: string[] | undefined) => void
```

**Wire through**:
1. `use-console-stream.ts`: add `modelId`, `allowedTools` to POST body
2. `src/lib/validation/schemas.ts`: extend `consoleTaskSchema` with optional fields
3. `src/app/api/console/stream/route.ts`: pass through to `startExecution`
4. `executor.ts` → `executeReActLoop({ modelId })` (already supported from Fase A)

---

## 4. Wireframe: Create Agent Dialog

```
┌─────────────────────────────────────────────────────┐
│  Create Agent                                    ✕  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Name *          [_________________________]        │
│  Description *   [_________________________________│
│                   _______________________________]   │
│  Version          [1.0.0____________________]        │
│                                                     │
│  ─── Role & Model ─────────────────────────────     │
│  Role            [▼ orchestrator              ]     │
│  Model           [▼ GLM-4.6 (general)       ]       │
│                                                     │
│  ─── Capabilities ─────────────────────────────     │
│  [+ Add capability]                                 │
│  [code-analysis ✕] [bug-detection ✕]                │
│                                                     │
│  ─── Skills ───────────────────────────────────     │
│  [☑ Code Review]  [☐ Bug Triage]                    │
│  [☐ Research]     [☐ Custom Prompt]                 │
│                                                     │
│  ─── Parent Agent (optional) ──────────────────     │
│  [▼ None                          ]                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│                        [Cancel]  [Create Agent]      │
└─────────────────────────────────────────────────────┘
```

## 5. Wireframe: Console con Tool/Model picker

```
┌─────────────────────────────────────────────────────┐
│  Console                                    [⚙ Auto] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [chat messages...]                                 │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │ Type your task...                            │  │
│  │                                              │  │
│  │                                              │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [✨ Skill]  [⚙ Model: Auto ▼]  [🔧 Tools: All ▼]  │
│                                                     │
│  [Solo piano]                           [Send ⏎]   │
└─────────────────────────────────────────────────────┘
```

**Popover "Model"**: mostra `DEFAULT_MODELS` con specializzazione + costo
**Popover "Tools"**: mostra tool installati con checkbox, "All" di default

---

## 6. File da creare/modificare

### Nuovi file
| File | Scope |
|------|-------|
| `src/components/agentic/create-agent-dialog.tsx` | Create Agent Wizard (Dialog + form) |

### File modificati
| File | Modifica |
|------|----------|
| `src/components/console/console-input.tsx` | Add modelId/allowedTools selectors |
| `src/components/console/use-console-stream.ts` | Pass modelId/allowedTools to POST body |
| `src/lib/validation/schemas.ts` | Extend consoleTaskSchema with modelId, allowedTools |
| `src/app/api/console/stream/route.ts` | Thread modelId through to startExecution |

### Future work (non in questo sprint)
| File | Scope |
|------|-------|
| `src/components/workbench/canvas-view.tsx` | Add edit mode for Pipeline Builder |
| `src/components/onboarding/first-run-wizard.tsx` | Active first-run wizard |
| `src/components/console/template-picker.tsx` | Template library in Console welcome |

---

## 7. Flusso dati end-to-end

### Create Agent
```
User clicks "Crea Agente"
  → Dialog opens, fetches /api/router?action=models + /api/skill-registry + /api/agent-lifecycle
  → User fills form
  → POST /api/agent-lifecycle {action:'register', name, description, roles, capabilities, skills}
  → registerAgent() persists GraphNode(Agent) + GraphNode(AgentVersion) + GraphEdges
  → Agent appears in /api/agent-lifecycle GET list
  → Toast "Agent created"
  → Dialog closes
```

### Console con Model/Tool picker
```
User selects model "GLM-4.6 Code" and tools ["filesystem-browser"]
  → ConsoleInput passes modelId='glm-4.6-code', allowedTools=['filesystem-browser']
  → useConsoleStream.send() adds to POST body
  → /api/console/stream receives {task, mode, modelId, allowedTools}
  → startExecution({task, modelId, allowedTools})
  → executePlan → executeTask → executeReActLoop({modelId, allowedTools})
  → zai.chat.completions.create({model: 'glm-4.6-code', ...})
  → dispatchTool() respects allowedTools whitelist
```
