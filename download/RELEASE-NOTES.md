# SOTA Agentic OS — Release Notes

> **Versione corrente:** 0.9.0 (Release 1.2)
> **Data ultimo update:** 2026-06-22
> **Stato:** Workbench v2 completo — production-ready per internal tool

Questo documento traccia tutte le release del SOTA Agentic OS con changelog dettagliato, breaking changes, migration notes e metriche.

---

## Indice

- [Release 1.2 — Cost Modal + Branch + Share](#release-12--cost-modal--branch--share)
- [Release 1.1 — SSE Streaming + Cost Tracking + Drag-drop](#release-11--sse-streaming--cost-tracking--drag-drop)
- [Release 1.0 — Workbench v2 Core](#release-10--workbench-v2-core)
- [Pre-1.0 (v0.1.0 - v0.6.1)](#pre-10-v010---v061)

---

## Release 1.2 — Cost Modal + Branch + Share

**Data:** 2026-06-22 · **Durata:** 5 giorni · **Versione:** 0.9.0

### 🎯 Obiettivi

Estendere il workbench v2 con feature di produttività avanzata: cost breakdown dettagliato, branch conversazioni, e share con link pubblici.

### ✨ Nuove Feature

#### 1. Cost Breakdown Modal

**Componente:** `src/components/workbench/cost-breakdown-modal.tsx` (290 righe)

Modale a 5 tab accessibile cliccando la Cost pill nella status bar:

- **Tab Riepilogo**: 3 stat card (Totale/Oggi/Settimana) + budget progress bar con tone adattivo + tokens Input/Output + Top 3 contributor
- **Tab Per Agente**: lista con barre di progresso relative per ogni agente
- **Tab Per Modello**: breakdown per modello LLM con count chiamate
- **Tab Per Fase**: breakdown per fase (plan_generation, task_execution, steering, reflection, routing, compilation)
- **Tab Recenti**: ultime 30 voci di costo con timestamp, tokens, model, phase

**UX details**:
- Esc to close, backdrop click to close, body scroll lock
- Footer con total calls/tokens + timestamp aggiornamento
- Click su Cost pill apre il modale con tooltip "Click per dettagli"

#### 2. Cost Budget Alerts

**Implementazione:** `src/components/workbench/status-bar.tsx`

Toast non-spammy quando si superano le soglie giornaliere:

- **Warning** a $1: `⚠️ Budget warning: $X / $1` (duration 8s)
- **Danger** a $5: `🚨 Budget danger superato: $X / $5` (duration 10s)
- Fire solo quando si attraversa la soglia (non ad ogni poll) via `lastAlertRef`
- Reset automatico quando il costo scende sotto warn (es. nuovo giorno)

**Configurazione**:
- In-memory nel backend (default: warn=$1, danger=$5)
- Endpoint `POST /api/cost action=set_budget` per aggiornare le soglie
- Endpoint `GET /api/cost action=stats` ritorna anche `budget: { warn, danger }`

#### 3. Branch Conversation

**Schema Prisma** — nuovo modello `ConversationBranch`:
```prisma
model ConversationBranch {
  id            String   @id @default(cuid())
  parentId      String   // parent branch id (root has "root")
  messageId     String   // message id from which we forked
  title         String   // branch label
  taskText      String   // original task text
  messagesJson  String   // JSON array of messages snapshot
  createdAt     DateTime @default(now())
  @@index([parentId])
  @@index([createdAt])
}
```

**API** `src/app/api/conversation/branch/route.ts`:
- `POST action=create` — crea branch con snapshot messaggi fino al messageId
- `POST action=get` — recupera branch con messaggi parsati
- `POST action=delete` — elimina branch
- `GET` — lista tutti i branch (ultimi 50)

**UI** — Inline action `GitBranch` (user messages only):
- Hover su user message → 5 inline actions visibili (Copy/Retry/Edit/Branch/Share)
- Click Branch → trova indice messaggio, slice messaggi, POST a `/api/conversation/branch`
- Toast feedback: "Branch creato: {branchId} · N messaggi forkati"

#### 4. Share Conversation

**Schema Prisma** — nuovo modello `SharedConversation`:
```prisma
model SharedConversation {
  id            String   @id @default(cuid())
  token         String   @unique // signed URL token (128-bit hex)
  branchId      String
  title         String
  messagesJson  String   // snapshot of messages at share time
  createdBy     String
  expiresAt     DateTime?  // null = never expires
  viewCount     Int      @default(0)
  createdAt     DateTime @default(now())
  @@index([token])
}
```

**API** `src/app/api/conversation/share/route.ts`:
- `POST action=create` — genera token random (16 bytes hex), crea SharedConversation con expiration
- `POST action=view` — lookup by token, controlla expiration, increment viewCount, ritorna messaggi
- `POST action=revoke` — elimina shared conversation
- `GET` — lista shared conversations (admin)

**UI** — Inline action `Share2`:
- Hover su qualsiasi messaggio → Share button visibile
- Click → POST con `expiresInHours: 168` (7 giorni)
- Copia automatica del link `http://localhost:3000/share/{token}` negli appunti
- Toast: "Link condivisibile copiato! {url} · Scade tra 7 giorni"

**Route pubblica** `src/app/share/[token]/page.tsx` (170 righe):
- Pagina pubblica (no auth required) per visualizzare conversazione condivisa
- Header con logo SOTA + titolo + view count + badge "Shared"
- Thread messaggi con avatar brand (same styling as Console)
- Footer con expiration + creation date
- Loading state con spinner
- Error state per token non valido/scaduto
- ResultCard semplificato per assistant messages con step list

### 📦 File Creati

| File | Righe | Descrizione |
|------|-------|-------------|
| `src/app/api/cost/route.ts` | 62 | Cost stats + budget API |
| `src/components/workbench/cost-breakdown-modal.tsx` | 290 | Modal con 5 tab |
| `src/app/api/conversation/branch/route.ts` | 60 | Branch CRUD API |
| `src/app/api/conversation/share/route.ts` | 75 | Share API con signed token |
| `src/app/share/[token]/page.tsx` | 170 | Public share page |

### 📝 File Modificati

| File | Modifiche |
|------|-----------|
| `prisma/schema.prisma` | Aggiunti modelli `ConversationBranch` + `SharedConversation` |
| `src/components/workbench/status-bar.tsx` | Cost modal trigger + budget alerts + `/api/cost` polling |
| `src/components/workbench/inline-actions.tsx` | Aggiunti Branch + Share actions con API calls |
| `src/components/agentic/agent-console.tsx` | Passaggio `allMessages` + `messageId` a InlineActions |

### 🧪 Verifiche

| Test | Risultato |
|------|-----------|
| 146 test Vitest | ✅ Tutti passing (0 regressioni) |
| ESLint | ✅ 0 errors |
| TypeScript | ✅ 0 errors |
| Browser: Cost modal 5 tab | ✅ Tutti funzionanti con dati reali |
| Browser: Budget alerts | ✅ Threshold crossing detection |
| Browser: Branch action | ✅ Toast + API 200 |
| Browser: Share action | ✅ Toast + URL copiato |
| Browser: Share API view | ✅ viewCount increment |
| Browser: Public /share/[token] | ✅ Pagina pubblica rendera |

### 📊 Metriche

- **5 file creati** (~657 righe)
- **4 file modificati**
- **2 nuovi modelli Prisma** (ConversationBranch, SharedConversation)
- **3 nuove API routes** (cost, conversation/branch, conversation/share)
- **1 nuova route pubblica** (/share/[token])
- **0 regressioni** sui 146 test esistenti

---

## Release 1.1 — SSE Streaming + Cost Tracking + Drag-drop

**Data:** 2026-06-21 · **Durata:** 5 giorni · **Versione:** 0.8.0

### 🎯 Obiettivi

Sostituire il fake typewriter con true SSE streaming, implementare cost tracking end-to-end, e aggiungere drag-drop file nella Console.

### ✨ Nuove Feature

#### 1. True SSE Streaming

**Backend** `src/app/api/console/stream/route.ts` (380 righe):

Endpoint SSE che emette eventi per ogni fase dell'esecuzione:
- `plan_start` — avvio generazione piano
- `plan_chunk` — partial JSON del piano (ogni 3 token)
- `plan_complete` — piano completo validato + persistito
- `task_start` — avvio esecuzione task
- `task_chunk` — partial output del task
- `task_complete` — task completato con status
- `reflection_start` / `reflection_complete` — riflessione ERL
- `error` — errore con fase + messaggio
- `done` — risultato finale con summary

**Tech stack**:
- `zai.chat.completions.create({ stream: true })` per streaming reale token-by-token
- `ReadableStream` con `TextEncoder` per inviare SSE formattato
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
- `AbortController` per supportare stop button

**Frontend** `src/components/agentic/agent-console.tsx`:
- `send()` riscritto per usare `fetch()` con `ReadableStream` reader (POST + stream, non EventSource che è solo GET)
- Parser SSE custom che processa eventi separati da `\n\n`
- `updateAssistant()` helper per aggiornare il messaggio assistant in tempo reale
- Il messaggio assistant viene creato vuoto e aggiornato progressivamente

#### 2. Stop Button

**UI** in `agent-console.tsx`:
- Icona `Square` sostituisce `Loader2` spinner durante esecuzione
- Click → `abortController.abort()` → l'esecuzione si ferma graceful
- Messaggio: "⏹ Esecuzione interrotta dall'utente"
- Toast info: "Esecuzione interrotta"
- Helper text dinamico: "Invio per eseguire · Shift+Invio per nuova riga · Click ■ per interrompere"
- Gestione `AbortError` separata da altri errori

#### 3. Cost Tracking

**Kernel module** `src/lib/kernel/cost-ledger.ts` (130 righe):
- `recordCostEntry(input)` — registra voce di costo (best-effort, silent fail)
- `calculateCost(model, tokensIn, tokensOut)` — calcolo USD da pricing table
- `getCostStats()` — aggregazioni per dashboard

**Pricing table** (per 1K tokens USD):
| Modello | Input | Output |
|---------|-------|--------|
| zai-glm | $0.0001 | $0.0002 |
| gpt-4 | $0.03 | $0.06 |
| gpt-3.5-turbo | $0.001 | $0.002 |
| claude-3-opus | $0.015 | $0.075 |
| claude-3-sonnet | $0.003 | $0.015 |

**Schema Prisma** — nuovo modello `CostEntry`:
```prisma
model CostEntry {
  id         String   @id @default(cuid())
  agentId    String
  model      String
  phase      String   // plan_generation | task_execution | steering | reflection | routing | compilation
  tokensIn   Int
  tokensOut  Int
  cost       Float    // USD
  timestamp  DateTime @default(now())
  @@index([timestamp])
  @@index([agentId])
  @@index([model])
  @@index([phase])
}
```

**Hook in LLM calls** — integrato in `/api/console/stream`:
- Plan generation: `recordCostEntry({ agentId: 'planner', model: 'zai-glm', phase: 'plan_generation', ... })`
- Task execution: `recordCostEntry({ agentId: taskDef.agentId, model: 'zai-glm', phase: 'task_execution', ... })`
- Stima tokens: 1 token ≈ 4 caratteri (input + output)

**Dashboard estesa** — `/api/dashboard` ora ritorna `cost: CostStats`:
```json
{
  "cost": {
    "total": 0.0000138,
    "today": 0.0000138,
    "week": 0.0000138,
    "byAgent": [{ "agentId": "planner", "cost": 0.0000138, "calls": 1 }],
    "byModel": [{ "model": "zai-glm", "cost": 0.0000138, "calls": 1 }],
    "byPhase": [{ "phase": "plan_generation", "cost": 0.0000138, "calls": 1 }],
    "totalTokensIn": 75,
    "totalTokensOut": 63,
    "totalCalls": 1
  }
}
```

**Status Bar** `src/components/workbench/status-bar.tsx`:
- Sostituito placeholder "—" con valore reale da `/api/dashboard`
- Polling ogni 10s per refresh costo
- `formatCost()`: $0.00 per 0, $0.0000 per < $0.01, $X.XX altrimenti
- Tone adattivo: ok (< $1), warn ($1-$10), danger (>$10)
- Icona `DollarSign` sostituisce `AlertTriangle`

#### 4. Drag-drop Attachments

**UI** in `agent-console.tsx`:
- Input bar supporta drag-over con highlight visivo (border-primary/40 + bg-primary/5)
- Drop handler processa `e.dataTransfer.files`
- Per immagini: inserisce `[image: filename.png]` nel prompt
- Per altri file: inserisce `[file: filename.ext]` nel prompt
- Toast feedback "N file aggiunti al prompt"
- Auto-focus textarea dopo drop
- Overlay visivo durante drag con "Rilascia i file per aggiungerli al prompt"
- State `isDragging` per gestire visual feedback

### 📦 File Creati

| File | Righe | Descrizione |
|------|-------|-------------|
| `src/app/api/console/stream/route.ts` | 380 | SSE streaming endpoint |
| `src/lib/kernel/cost-ledger.ts` | 130 | Cost tracking kernel |

### 📝 File Modificati

| File | Modifiche |
|------|-----------|
| `prisma/schema.prisma` | Aggiunto modello `CostEntry` con indici |
| `src/app/api/dashboard/route.ts` | Aggiunto `cost: await getCostStats()` alla response |
| `src/components/agentic/agent-console.tsx` | send() riscritto per SSE + Stop button + drag-drop |
| `src/components/workbench/status-bar.tsx` | Cost pill con valore reale + polling |

### 🐛 Bug Risolti

1. **`steer()` signature mismatch** — la funzione accetta 7 argomenti posizionali, non un oggetto. Fix: chiamata con tutti gli argomenti.
2. **`verifyEvent()` signature** — accetta 3 argomenti (eventLabel, eventType, payload), non un oggetto.
3. **`verifyEvent()` return type** — `violations` è array di `{ ruleId, reason }`, non `string[]`. Fix: `.map(v => \`${v.ruleId}: ${v.reason}\`)`.
4. **`reflectAndLearn()` return type** — ritorna `{ heuristic: ExtractedHeuristic, approved, reviewReason, stored }`, non direttamente `heuristic`.
5. **`ReflectionInput.steps` type** — array di `{ action, result }`, non `string[]`.
6. **Prisma client non rigenerato** — dopo `db:push`, il client non veniva caricato dal dev server. Fix: kill forzato del processo next-server + rimozione del lock file + restart.
7. **Database reset accidentale** — `prisma db push --force-reset` ha cancellato i dati. Fix: restore dal backup + nuovo `db push` per aggiungere la tabella CostEntry.

### 🧪 Verifiche

| Test | Risultato |
|------|-----------|
| 146 test Vitest | ✅ Tutti passing |
| ESLint | ✅ 0 errors |
| TypeScript | ✅ 0 errors |
| Browser: SSE streaming | ✅ Eventi fluiscono, errori gestiti |
| Browser: Stop button | ✅ Icona Square, click interrompe |
| Browser: Cost tracking end-to-end | ✅ Task → recordCostEntry → dashboard → status bar |
| Browser: Drag-drop files | ✅ File rilasciati generano [image: name] / [file: name] |

### 📊 Metriche

- **2 file creati** (~510 righe)
- **4 file modificati**
- **1 nuovo modello Prisma** (CostEntry)
- **1 nuovo modulo kernel** (cost-ledger.ts)
- **1 nuova API route** (console/stream)
- **0 regressioni** sui 146 test esistenti

---

## Release 1.0 — Workbench v2 Core

**Data:** 2026-06-21 · **Durata:** 14 giorni (6 fasi) · **Versione:** 0.7.0

### 🎯 Obiettivi

Trasformare l'app da "dashboard tecnico" a "modern agent workbench" competitivo con Claude/Cursor, mantenendo l'architettura unica a 23 fasi + 3 trasversali.

### ✨ Nuove Feature (6 Fasi)

#### Fase 0 — Fondamenta (2gg)

**Store Zustand esteso** `src/lib/store.ts`:
- Aggiunto `activeView` (6 valori: console/canvas/timeline/cockpit/sovereign/phase)
- Aggiunto `contextPanelOpen`, `selectedItem`, `commandPaletteOpen`
- Logica auto-sync: `setActivePhase` deriva automaticamente `activeView`
- Toggle functions per context panel e command palette

**WorkspaceViews container** `src/components/workbench/workspace-views.tsx`:
- Tab bar dinamica con 5 viste core sempre visibili
- Tab "Phase" dinamico che appare quando si naviga a una delle 14 fasi
- Badge contatore rosso sul tab Sovereign quando ci sono action_blocked

**Refactor page.tsx**: usa `<WorkspaceViews />` + monta `<CommandPalette />` e `useCommandPalette()` hook globale.

#### Fase 1 — Command Palette + Status Bar (3gg)

**Command Palette** `src/components/workbench/command-palette.tsx` (327 righe):
- Basata su `cmdk` (Vercel, 8KB)
- Ricerca fuzzy custom con scoring (exact match > startsWith > word boundary > substring > char-sequence)
- 4 categorie: Azioni, Viste, Fasi, Tool & Utility
- Sezione "Recenti" persistita in localStorage (ultimi 5 comandi)
- Keyboard nav completa (↑↓ naviga, Enter seleziona, Esc chiude)
- Backdrop con blur, animazioni zoom-in + fade-in
- Remount on open per reset query (evita anti-pattern setState in effect)

**Command Registry** `src/components/workbench/command-registry.ts` (399 righe):
- Singleton con subscribe/notify pattern
- 34 comandi registrati: 5 azioni + 6 viste + 17 fasi + 6 tool/utility
- Hook `useSyncExternalStore` con cache intelligente (evita infinite loop)
- Builder functions: `buildCoreCommands`, `buildPhaseCommands`, `buildToolCommands`, `buildUtilityCommands`

**Hook globale** `src/components/workbench/use-command-palette.ts`:
- Listener globale per Cmd+K / Ctrl+K (toggle palette)
- Escape per chiudere
- Bonus: Cmd+\ per toggle context panel

**Status Bar** `src/components/workbench/status-bar.tsx`:
- 6 pillole real-time: Online/Offline, Ciclo #N, Queue, Threads, Load %, Cost (placeholder "—" in R1.0, valore reale in R1.1)
- Dati dal hook `useSensoriumLive` (WebSocket)
- Color tone adattivo: emerald (ok), amber (warn >70%), red (danger >90%)
- Click su pillola → naviga alla vista correlata

**Topbar integrato** `src/components/agentic/topbar.tsx`:
- StatusBar a sinistra (desktop ≥ md)
- Page title a sinistra (mobile < md)
- Cmd+K trigger button (con icona Command + kbd "K")

#### Fase 2 — Console Evolution Lite (3gg)

**Inline Actions** `src/components/workbench/inline-actions.tsx`:
- 3 azioni per user messages: Copy, Retry, Edit
- 1 azione per assistant messages: Copy
- Copy con fallback `document.execCommand('copy')` per contesti non-HTTPS

**Streaming Text** `src/components/workbench/streaming-text.tsx`:
- Pattern wrapper + inner con `key={text}` per remount su cambio testo
- Rivela 3 caratteri ogni 12ms (~250 chars/sec)
- Cursore lampeggiante ▋ in primary color durante streaming

**Attachment Preview** `src/components/workbench/attachment-preview.tsx`:
- Rileva 4 tipi: immagini (thumbnail + zoom), JSON blocks (collapsible), code blocks (header lang), URLs (link card)
- Max 5 attachments per messaggio

#### Fase 3 — Views Switching (3gg)

**Canvas View** `src/components/workbench/canvas-view.tsx` (619 righe):
- 3 tipi DAG switchabili: DynAMO Plan / Objective Tree / Lean Workflow
- Entity selector dropdown
- Status filter (Tutti/Done/Running/Failed/Pending)
- Click su nodo → context panel hook

**Timeline View** `src/components/workbench/timeline-view.tsx` (542 righe):
- Custom SVG (no libreria esterna)
- Lane-based layout per agente
- 7 categorie eventi colorate (plan/execute/verify/block/resolve/reflect/info)
- 3 filtri dropdown (Fase/Agente/Livello)
- Hover tooltips + detail panel espandibile

**Sovereign View** `src/components/workbench/sovereign-view.tsx` (460 righe):
- 6 stat tile (Totale/Pending/Approvate/Rifiutate/Modificate/Declassate)
- 2 filtri (Status/Source)
- Card espandibili con Axiom Trail + resolution form
- Batch approve all con conferma modale

#### Fase 4 — Context Panel (2gg)

**Layout resizable 3-zone** `src/app/page.tsx`:
- Desktop: layout 2-zone resizable con `react-resizable-panels` v4
- Workspace panel: default 70% quando context aperto, 100% quando chiuso
- Context panel: default 30%, min 20%, max 45%
- Mobile: workspace full-width, context panel via FAB + sheet

**ContextPanel** `src/components/workbench/context-panel.tsx`:
- Container che switcha contenuto in base a `selectedItem.type`
- Top bar con close button

**4 inspector dinamici**:
- `QuickStats` (default) — 5 sezioni real-time
- `NodeInspector` — dettagli nodo DAG per 3 tipi
- `LogInspector` — evento timeline con payload JSON
- `BlockedInspector` — azione bloccata con Axiom Trail + resolution form

**Mobile Sheet** — FAB + slide-up sheet con drag handle

#### Fase 5 — Polish & Animations (1gg)

**ViewTransition** `src/components/workbench/view-transition.tsx`:
- `AnimatePresence mode="wait"` per transizioni tra viste workspace
- Animazione: opacity 0→1 + slide y 8→0, duration 0.2s con ease-out custom

**Micro-interazioni Tailwind**:
- `active:scale-95` + `transition-all` su tutti i button interattivi

**Skeleton loaders** `src/components/workbench/skeletons.tsx`:
- 7 skeleton strutturati (4 inspector + 3 viste)
- Tutti i `Loader2 animate-spin` sostituiti con skeleton

### 📦 File Creati (18 file in `src/components/workbench/`)

| File | Righe | Componente |
|------|-------|------------|
| `workspace-views.tsx` | 234 | WorkspaceViews container |
| `command-palette.tsx` | 327 | CommandPalette |
| `command-registry.ts` | 399 | commandRegistry singleton |
| `use-command-palette.ts` | 43 | useCommandPalette hook |
| `status-bar.tsx` | 141 | StatusBar |
| `streaming-text.tsx` | 98 | StreamingText |
| `inline-actions.tsx` | 94 | InlineActions |
| `attachment-preview.tsx` | 245 | AttachmentPreview |
| `canvas-view.tsx` | 619 | CanvasView |
| `timeline-view.tsx` | 542 | TimelineView |
| `sovereign-view.tsx` | 460 | SovereignView |
| `context-panel.tsx` | 95 | ContextPanel + MobileContextSheet |
| `quick-stats.tsx` | 180 | QuickStats |
| `node-inspector.tsx` | 388 | NodeInspector |
| `log-inspector.tsx` | 200 | LogInspector |
| `blocked-inspector.tsx` | 290 | BlockedInspector |
| `view-transition.tsx` | 60 | ViewTransition + InspectorTransition |
| `skeletons.tsx` | 220 | 7 skeleton presets |

### 📝 File Modificati

| File | Modifiche |
|------|-----------|
| `src/lib/store.ts` | Esteso con activeView, contextPanelOpen, selectedItem, commandPaletteOpen |
| `src/app/page.tsx` | Refactor completo per WorkspaceViews + CommandPalette |
| `src/components/agentic/topbar.tsx` | Integrata StatusBar + Cmd+K trigger |
| `src/components/agentic/agent-console.tsx` | Importati 3 nuovi componenti (StreamingText, InlineActions, AttachmentPreview) |
| `src/app/globals.css` | Aggiunta utility no-scrollbar + streaming-caret animation |
| `src/components/ui/resizable.tsx` | Riscritto per react-resizable-panels v4 API |

### 🐛 Bug Risolti

1. **`react-resizable-panels` v4 API breaking change** — il componente shadcn usava `PanelGroup/PanelResizeHandle` che non esistono più in v4. Riscritto con `Group/Panel/Separator`.
2. **`Plan.goal` → `Plan.taskGoal`** — il tipo Plan aveva `goal` ma lo schema Prisma usa `taskGoal`.
3. **`PlanTask.dependencies` string → array** — lo schema Prisma salva come JSON string. Aggiunto `safeParseDeps()`.
4. **`VerifiedWorkflow.contractsJson` string → contracts array** — aggiunto parsing lato client.
5. **`addEventListener('click', handler)` type mismatch** — fix con cast `as EventListener`.
6. **`SelectedItem` type troppo restrittivo** — aggiunti casi `log` e `blocked` al union type.

### 🧪 Verifiche

| Test | Risultato |
|------|-----------|
| 146 test Vitest | ✅ Tutti passing (0 regressioni) |
| ESLint | ✅ 0 errors |
| TypeScript | ✅ 0 errors |
| Browser: navigazione 6 viste | ✅ Transizioni fade+slide fluide |
| Browser: Cmd+K command palette | ✅ 34 comandi, ricerca fuzzy |
| Browser: Context panel resizable | ✅ 4 inspector dinamici |
| Browser: Inline actions | ✅ Copy/Retry/Edit |
| Browser: Streaming typewriter | ✅ Cursore ▋ lampeggiante |
| Browser: Canvas/Timeline/Sovereign | ✅ Tutte e 3 viste operative |

### 📊 Metriche

- **18 file creati** in `src/components/workbench/`
- **~4.500 righe** di codice nuovo
- **6 file modificati**
- **3 dipendenze aggiunte**: cmdk, framer-motion, react-resizable-panels
- **0 regressioni** sui 146 test esistenti

---

## Pre-1.0 (v0.1.0 - v0.6.1)

### v0.6.1 — Console Agentica + UI/UX Polish + Bug Fix
- Console Agentica end-to-end con LLM reale
- UI/UX Redesign con palette brand-aligned
- Branding Integration
- Bug fix (cycleId overflow, PlanTask.createdAt, crypto.randomUUID)

### v0.6.0 — Production Hardening (Fasi 19-23 + T1-T3)
- F19 Quality: 146 test Vitest, 52% coverage
- F20 Auth: 4 ruoli RBAC + cookie HttpOnly
- F21 Crypto: ECDSA P-256 signing reale
- F22 Observability: Error tracking + metrics + tracing + backup
- F23 Scalability: DB adapter + WS pub/sub + job queue + FSM persist
- T1 DAG Integration: 3 visualizer React Flow
- T2 i18n base IT/EN
- T3 Dev Workflow: dev:clean, dev:full, db:backup, db:restore

### v0.5.0 — Blueprint integrativo 4 (Fasi 15-18)
- F15 Cockpit (Artificial Retainer UI)
- F16 Topological Observability (React Flow)
- F17 Sovereign Validator
- F18 Tool Ecosystem

### v0.4.1 — Ridisegno UI/UX
- Sidebar raggruppata in 7 categorie
- ArchitectureMap cliccabile
- CategoryKpis + QuickActions
- PhaseHeader uniforme + RelatedPhases

### v0.4.0 — Blueprint integrativo 3 (Fasi 10-14)
- F10 Grounded Inference
- F11 Affect Subsystem
- F12 AgentObjective BFS
- F13 ESR + Quorum
- F14 TimeRouter

### v0.3.0 — Blueprint integrativo 2 (Fasi 6-9)
- F6 Context Engineering & Pruning
- F7 Dominator Trees
- F8 Lean4 Formal Verification
- F9 Artificial Retainer

### v0.2.0 — 4 miglioramenti di iterazione
- WebSocket live
- Embeddings semantici v2 (TF-IDF 256-dim)
- LTL esteso (parser recursive descent + 7 pattern FSM)
- Editor visuale LTL

### v0.1.0 — Implementazione iniziale (5 fasi base)
- Tutti i moduli kernel
- Tutte le API routes
- UI completa con 5 fasi
- Seed Python

---

## Roadmap Future Release

### Release 1.3 — Workbench v2 Extensions (4 settimane)

- **D.1 Branch Navigation UI** (1 settimana) — branch tree visualization + switch + diff + merge
- **D.2 Share Analytics** (1 settimana) — view count tracking + geographic + referrer + dashboard
- **D.3 Cost Export & Budget Enforcement** (1 settimana) — CSV/PDF export + budget blocking + per-agent budget + webhook alerts
- **D.4 Advanced Inspector** (1 settimana) — custom inspector API + message/artifact/trace inspector

### Release 2.0 — Production Hardening (6 settimane)

- PostgreSQL migration
- Redis WS adapter
- Test coverage 80%
- Multi-tenant isolation
- External observability (Sentry + Prometheus)

### Release 2.1 — Ecosystem Integration (8 settimane)

- MCP Server/Client Adapter
- A2A Protocol Bridge
- Extension Lifecycle (hot-reload)
- Simulation & Benchmarking

---

## Statistiche Progetto

| Metrica | Valore |
|---------|--------|
| Versione corrente | 0.9.0 |
| Release completate | 1.0 + 1.1 + 1.2 |
| Giorni totali sviluppo R1.0-1.2 | 24 |
| File in `src/components/workbench/` | 18 |
| Righe codice workbench | ~4.500 |
| API routes totali | 37 |
| Modelli Prisma totali | 62 |
| Moduli kernel totali | 25 |
| Test Vitest | 146 (0 regressioni) |
| Dipendenze aggiunte R1.0-1.2 | 3 (cmdk, framer-motion, react-resizable-panels) |
| Keyboard shortcuts | 6 |
| Comandi command palette | 34+ |

---

*Release notes aggiornate il 2026-06-22 per Release 1.2.*
