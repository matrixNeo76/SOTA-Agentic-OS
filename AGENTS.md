# AGENTS.md — Guida per LLM Agenti

> Questo file aiuta i modelli LLM a comprendere rapidamente la struttura, le convenzioni e i pattern del progetto per lavorare in modo efficace.

---

## Identità del Progetto

**SOTA Agentic OS** — Sistema operativo per agenti autonomi con kernel transazionale, verifica formale LTL, e apprendimento riflessivo.

**Stack:** Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Prisma 6 + ZAI SDK + Socket.IO

---

## Regole Fondamentali

### 1. Sempre committare
Dopo ogni modifica significativa, eseguire `git add -A && git commit -m "descrizione"`. Il container può riavviarsi e perdere il lavoro non committato.

### 2. Verificare prima di committare
```bash
bunx tsc --noEmit   # 0 errori TypeScript
bun run lint         # 0 errori ESLint
bun run test         # Tutti i test passano
bun run build        # Build successful
```

### 3. Usare il dev server webpack (non turbopack)
```bash
bun run dev          # USA QUESTO (--webpack)
bun run dev:turbo    # NON USARE (bug CSS con @utility custom)
```

### 4. Tailwind v4 — no tailwind.config.ts
Il progetto usa Tailwind CSS 4 con `@theme inline` in `globals.css`. Il file `tailwind.config.ts` non deve essere creato — è dead code che confligge con `@theme inline`.

### 5. Token CSS — no hardcoded colors
Usare i token definiti in `globals.css` e `design-tokens.ts`:
- Status: `text-status-ok`, `bg-status-warn/10`, `border-status-danger/30`
- Category: `text-cat-foundation`, `bg-cat-orchestration/10`
- Brand: `bg-primary`, `text-primary`, `bg-primary/10`
- Surface: `bg-card` (elevated), `bg-popover` (overlay), `bg-background` (base)

**MAI** usare `text-emerald-600`, `bg-amber-500`, `text-red-600` direttamente.

### 6. Commenti — evitare pattern `*-`
Tailwind v4 scansiona anche i commenti e interpreta pattern come `status-*` come selettori CSS. Nei commenti usare "status tone" invece di "status-*".

---

## Struttura del Codice

### Directory chiave

| Path | Cosa contiene |
|------|--------------|
| `src/lib/kernel/` | 25 moduli kernel (logica pura, 0 dipendenze DB/LLM dirette) |
| `src/lib/stores/` | Zustand stores (data-store, transfer-store) |
| `src/lib/design-tokens.ts` | Design system unificato (COLORS, STATUS_TONES, helpers) |
| `src/lib/store.ts` | Navigation store (Zustand: activePhase, activeView, contextPanel) |
| `src/lib/auth/` | Session management + RBAC |
| `src/app/api/` | 37 API routes (runtime: nodejs) |
| `src/components/console/` | Chat agentica decomposta (8 file) |
| `src/components/cockpit/` | Control room (4 file: container + widgets + tabs + types) |
| `src/components/canvas/` | DAG visualizer (3 file) |
| `src/components/domains/` | 4 domini Inspect + _shared/ |
| `src/components/shared/` | 9 componenti condivisi + index.ts |
| `src/components/ui/` | shadcn/ui premium (Card, Button, Input, Badge, Tabs, Dialog) |
| `src/components/workbench/` | Workspace views, status bar, command palette, skeletons |
| `src/components/agentic/` | PhaseN.tsx (14 fasi), sidebar, topbar, overview |
| `prisma/schema.prisma` | 62 modelli DB |

### Pattern architetturale

```
UI Component (tsx)
    ↓ fetch
API Route (route.ts)
    ↓ import
Kernel Module (lib/kernel/*.ts) — logica pura
    ↓ import
DB (lib/db.ts → Prisma) / LLM (z-ai-web-dev-sdk)
```

**Importante:** I moduli kernel NON importano mai direttamente `@prisma/client` o `z-ai-web-dev-sdk`. L'accesso a DB/LLM avviene tramite le API routes che usano `lib/db.ts` e dynamic import di ZAI.

---

## Store Zustand

### Navigation store (`src/lib/store.ts`)
```typescript
useStore() → {
  activePhase: Phase,           // 'overview' | 'console' | 'domain-memory' | ...
  activeView: WorkspaceView,    // 'console' | 'canvas' | 'timeline' | 'cockpit' | 'sovereign' | 'phase'
  contextPanelOpen: boolean,
  contextPanelMode: 'quickstats' | 'phase' | 'inspector' | 'help',
  selectedItem: SelectedItem,
  commandPaletteOpen: boolean,
  // ...setters
}
```

### Data store (`src/lib/stores/data-store.ts`)
```typescript
useDataStore() → {
  dashboard: DashboardData | null,     // KPI globali (cache 5s)
  blockedPending: any[],               // Azioni bloccate (cache 10s)
  cost: any,                           // Cost tracking (cache 30s)
  affect: any,                         // Telemetria affettiva (cache 5s)
  logs: LogEntry[],                    // Log eventi (cache 10s)
  fetchDashboard(force?), fetchBlocked(force?), fetchCost(force?), ...
  refreshAll(),
}
```

**Pattern:** `startGlobalRefresh()` / `stopGlobalRefresh()` gestiscono un singolo interval condiviso (singleton). Non creare `setInterval` dedicati nei componenti.

---

## Componenti UI Premium

### Design system (`globals.css`)
- **Surface 3 livelli:** `--surface-base` (app bg), `--surface-elevated` (cards), `--surface-overlay` (modals)
- **Brand:** `--brand` oklch(0.52 0.19 245) — blu elettrico
- **7 category desaturati:** `--cat-foundation` through `--cat-infrastructure` (chroma 0.08-0.14)
- **5 status tones:** `--status-ok/warn/danger/info/muted`
- **Shadow 4 livelli:** `shadow-sm` through `shadow-xl`
- **Radius 6 sistematici:** `rounded-xs`(4px) through `rounded-2xl`(20px)

### Componenti shadcn premium (`src/components/ui/`)
- **Card:** `bg-card rounded-lg border shadow-sm hover:shadow-md` + header strutturato
- **Button:** `active:scale-[0.98]` + `focus-visible:ring-2 ring-primary/30` + prop `loading`
- **Input:** `h-10 bg-card shadow-sm focus:border-primary focus:ring-2 ring-primary/15`
- **Badge:** 8 varianti (`default/success/warning/danger/info/secondary/destructive/outline`)
- **Tabs:** `bg-muted/40 border rounded-md` + active `bg-card shadow-sm`
- **Dialog:** `bg-popover rounded-xl shadow-xl backdrop-blur-sm` + slide-in-from-top-4

### Componenti shared (`src/components/shared/`)
- `EmptyState` — icon + title + description + optional CTA
- `StatCard` / `StatCardGrid` — KPI card con tone colors
- `SectionCard` — Card con header (icon + title + description + action)
- `FormField` / `FormSection` — form standardizzato
- `DynamicIcon` — renderizza icone da nome string (lint-safe, no component-during-render)
- `KVList` — lista key-value
- `TagBadge` — badge con 7 varianti
- `RefreshButton` — bottone Aggiorna con loading state
- `ConfirmDialog` — wrapper alert-dialog

---

## Fasi Architetturali (F1-F23)

| Fase | Nome | Kernel Module | Stato |
|------|------|---------------|-------|
| F1 | Memory & State | ns-mem, patchboard | ✅ Completo |
| F2 | Planner & Compiler | scheduler, compiled-ai | ✅ Con LLM |
| F3 | Cognitive Steering | acts | ✅ Completo |
| F4 | Verification & Taint | ltl-monitor, taint, normative | ✅ Completo |
| F5 | Reflective Learning | erl | ✅ Con LLM |
| F6 | Context Manager | context-engineering | ✅ Completo |
| F7 | Trace Validator | dominator-tree | ⚠️ Stub semantico |
| F8 | Formal Verifier | lean4-agent | ⚠️ Stub LLM |
| F9 | Human Retainer | artificial-retainer | ✅ Completo |
| F10 | Model Encapsulator | compiled-ai | ✅ Con LLM |
| F11 | Affect Monitor | affect-subsystem | ✅ Completo |
| F12 | Objective Builder | agent-objective | ⚠️ Stub LLM |
| F13 | Swarm Coherence | esr-quorum | ✅ Completo |
| F14 | Model Router | time-router | ⚠️ Stub LLM |
| MCP | Server/Client | mcp-client, skill-manager | ✅ Completo |
| Cost | Cost tracking | cost-ledger | ✅ Completo |
| Auth | Authentication | auth/session, auth/rbac | ✅ Completo |
| Trust | ECDSA signing | crypto-trust | ✅ Completo |

---

## Convenzioni di Codice

### TypeScript
- Strict mode attivo
- Evitare `any` — usare `unknown` per catch blocks
- Tipizzare esplicitamente return types delle funzioni pubbliche

### Nomenclatura
- **File:** kebab-case (`message-bubble.tsx`, `data-store.ts`)
- **Componenti:** PascalCase (`MessageBubble`, `SensoriumWidget`)
- **Functions:** camelCase (`fetchDashboard`, `setActivePhase`)
- **Constants:** UPPER_SNAKE (`SECTIONS`, `DEFAULT_EXPANDED`)
- **Types:** PascalCase (`Phase`, `WorkspaceView`, `DashboardData`)

### CSS
- Usare classi Tailwind, non CSS inline (tranne per dynamic values)
- `cn()` utility per classi condizionali
- Token CSS via `@theme inline` in globals.css
- `@utility` per custom utilities (shimmer, hover-lift, etc.)

### API Routes
- `export const runtime = 'nodejs'` (mai edge)
- Pattern: `POST` con `body.action` per CRUD multi-azione
- Auth: verificare cookie `sota_session` tramite `verifySession()`

### Commit messages
- Inglese o italiano (coerente entro il stesso scope)
- Formato: `<tipo>: <descrizione>` (es. `Fix sidebar: replace old structure with premium SECTIONS`)

---

## Errori Comuni da Evitare

1. **`tee dev.log` nello script dev** → causa recompilazione infinita (file watcher loop)
2. **Pattern `status-*` nei commenti** → Tailwind v4 lo interpreta come selettore CSS
3. **`var(--status-ok)/10`** → non funziona in Tailwind v4 arbitrary values. Usare `bg-status-ok/10` (classi native via `@theme inline`)
4. **Creare componenti durante render** → `const Icon = getIcon(name); return <Icon />` viola `react-hooks/static-components`. Usare `DynamicIcon` shared
5. **`setInterval` nei componenti** → usare `startGlobalRefresh()` / `stopGlobalRefresh()` dal data-store
6. **`window.dispatchEvent`** → usare `useTransferStore` Zustand
7. **Non committare** → il container può riavviarsi e perdere tutto

---

## Come Aggiungere una Nuova Vista

1. Creare il componente in `src/components/<area>/`
2. Aggiungere il case in `workspace-views.tsx` → `PhaseView()` switch
3. Aggiungere la voce in `sidebar.tsx` → `SECTIONS`
4. Aggiungere il type in `store.ts` → `Phase`
5. Aggiornare `use-url-sync.ts` → `VALID_PHASES`
6. Commit: `git add -A && git commit -m "Add new view: <name>"`

---

## Risorse

- **Design system:** `src/app/globals.css` + `src/lib/design-tokens.ts`
- **Worklog:** `worklog.md` (cronologia sessioni)
- **Piani:** `download/ANALISI-TOT-PIANO-MICROFASI.md`
- **Diagramma architetturale:** `ARCHITECTURE.md` + `DIAGRAM.md`
