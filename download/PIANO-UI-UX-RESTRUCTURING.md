# SOTA Agentic OS — Piano di Ristrutturazione UI/UX

> **Versione:** 1.0 · **Data:** 2026-06-23 · **Stato:** Bozza di pianificazione (da approvare prima dell'implementazione)
> **Ambito:** Tutta la UI/UX dell'applicazione (esclusa Fase 5 — Observability, già posticipata)
> **Prerequisiti:** Fase 4 (MCP + Skills) completata · 207 test verdi · Build pulito

---

## Indice

1. [Sintesi della diagnosi](#1-sintesi-della-diagnosi)
2. [Principi guida della ristrutturazione](#2-principi-guida-della-ristrutturazione)
3. [Architettura target dell'informazione](#3-architettura-target-dellinformazione)
4. [Piano di lavoro in 6 sprint](#4-piano-di-lavoro-in-6-sprint)
5. [Sprint 1 — Fondamenta (3 giorni)](#sprint-1--fondamenta-3-giorni)
6. [Sprint 2 — Navigazione e Layout (3 giorni)](#sprint-2--navigazione-e-layout-3-giorni)
7. [Sprint 3 — Console & Console-First Experience (4 giorni)](#sprint-3--console--console-first-experience-4-giorni)
8. [Sprint 4 — Cockpit & Viste trasversali (4 giorni)](#sprint-4--cockpit--viste-trasversali-4-giorni)
9. [Sprint 5 — Fasi architetturali: consolidamento (5 giorni)](#sprint-5--fasi-architetturali-consolidamento-5-giorni)
10. [Sprint 6 — Polish, onboarding, accessibilità (3 giorni)](#sprint-6--polish-onboarding-accessibilita-3-giorni)
11. [Sistema di design: token, componenti, pattern](#5-sistema-di-design-token-componenti-pattern)
12. [Gestione dello stato: dal caos all'architettura](#6-gestione-dello-stato-dal-caos-allarchitettura)
13. [i18n: migrazione dal fittizio al reale](#7-i18n-migrazione-dal-fittizio-al-reale)
14. [Criteri di accettazione complessivi](#8-criteri-di-accettazione-complessivi)
15. [Rischi e mitigazioni](#9-rischi-e-mitigazioni)
16. [Metriche di successo](#10-metriche-di-successo)
17. [Out of scope (esplicitamente esclusi)](#11-out-of-scope-esplicitamente-esclusi)

---

## 1. Sintesi della diagnosi

L'analisi approfondita ha evidenziato un'architettura di base solida (store Zustand, 5 viste core, command palette, context panel resizable) ma afflitta da **7 categorie di problemi strutturali**:

### 1.1 Inconsistenza semantica
- "Phase" viene usato per 3 concetti diversi: `WorkspaceView='phase'` · `Phase='phase1'..'phase14'` · `PhaseView` come renderer condizionale.
- Il numero di fasi è dichiarato 4 volte con valori diversi: **23** (footer), **18** (metadata layout), **14** (i18n), **17** (reale nel type `Phase`).
- Mix IT/EN senza regola: la stessa Status Bar contiene "Ciclo" (IT) accanto a "Queue/Threads/Load/Cost" (EN). Cockpit tabs sono tutti EN mentre le card title sono IT.

### 1.2 Duplicazione massiccia
- 14 componenti `PhaseN.tsx` (~5.000 LOC totali) riscrivono lo stesso pattern: ~10 `useState`, `useEffect` con `refresh()`, form di input, lista, KPI, `<RelatedPhases />`.
- L'entità `BlockedAction` è gestita con stili duplicati in **3 file**: `sovereign-view.tsx:30-43`, `blocked-inspector.tsx:29-42`, `sovereign-modal.tsx:27-32`.
- `Cockpit > Log tab` e `TimelineView` fanno la stessa identica chiamata `/api/cockpit?tab=log`.

### 1.3 Dead code
- **26 di 48 componenti shadcn** (54%) non sono mai usati: accordion, alert-dialog, breadcrumb, calendar, carousel, chart, command, drawer, form, popover, sidebar, table, sonner-wrapper, ecc.
- `branding-showcase.tsx` (125 LOC) è orfano: definito ma mai importato.
- ~20 chiavi i18n in `i18n.ts` non sono più referenziate.

### 1.4 Over-engineering localizzato
- `command-registry.ts` implementa un **singleton con pattern subscribe/notify** per 33 comandi statici che non cambiano mai a runtime.
- Transfer state tra fasi via `sessionStorage` con TTL 60s — fragile, niente feedback se fallisce.
- **5 custom events globali** (`window.dispatchEvent`) per tab switch: `sota:tool-tab`, `sota:phase4-tab`, `sota:phase3-step`, `sota:show-shortcuts`, `sota:refresh`. Pattern non tipizzato, non debuggabile.

### 1.5 Sovraccarico informativo
- Sidebar desktop con **17 voci senza etichette di categoria** (solo MobileNav le mostra).
- Overview mostra **~50 dati numerici** in una schermata (ArchitectureMap 7 colonne × 2-3 righe + CategoryKpis 7 cards × 3 metriche + LiveFeed).
- Status Bar con 6 metriche su `h-7`.
- Phase9 (539 LOC) con 4 form + 4 liste + 1 stats card in una pagina.

### 1.6 Inconsistenza mobile/desktop
- Sidebar: 17 pulsanti flat su desktop, raggruppati per categoria su mobile.
- Titolo pagina: visibile solo mobile, nascosto desktop.
- Context panel: resizable su desktop, FAB+sheet su mobile.
- Default view **sbagliata**: `activePhase='overview'` + `activeView='console'` → l'utente atterra sulla Console ma la sidebar evidenzia "Dashboard".

### 1.7 Bug e anti-pattern
- Badge Sovereign conta eventi WS nel buffer (max 50 misti), non il count reale di azioni pending.
- `SovereignModalContainer` popup intrusivo con polling ogni 5s, nessuno snooze, nessun "non mostrare più".
- Auth gate solo client-side: accesso diretto a `/` bypassa il check, le API rispondono 401 ma la shell UI si carica.
- Login page hardcoda credenziali demo `admin@sota-os.local / admin123` come default value degli input.
- Componenti con >400 LOC: **8 file** monolitici (agent-console 738, canvas-view 637, sovereign-view 564, mcp-explorer 558, timeline-view 540, phase9 539, ltl-normative-editor 447, phase4 446).

### 1.8 Cosa FUNZIONA (preservare)
- Store Zustand ben disegnato per navigation state.
- Command palette Cmd+K con fuzzy search custom (score 1000→100).
- Context panel resizable con 4 modalità inspector.
- Dark mode via next-themes con token OKLCH in `globals.css`.
- 7 colori categoria consistenti tra sidebar/architecture-map/category-kpis/phase-header.
- Skeleton loaders per tutte le viste principali.
- Toast sonner con copertura quasi totale delle azioni.
- DAG visualizers condivisi (DynAMO/ObjectiveTree/LeanWorkflow) — buon riuso.
- WebSocket Sensorium per real-time updates.

---

## 2. Principi guida della ristrutturazione

### 2.1 Console-first, phase-second
La Console è il punto di ingresso naturale: l'utente parla con il sistema, il sistema decide quali fasi attivare. Le fasi architetturali diventano **spazi di ispezione e configurazione avanzata**, non la destinazione primaria. Questo ribalta l'attuale gerarchia dove la sidebar elenca 17 fasi come se fossero tutte equally important.

### 2.2 Progressive disclosure
- **Livello 1**: Console + Cockpit + Sovereign (azione).
- **Livello 2**: Canvas + Timeline (visualizzazione).
- **Livello 3**: Fasi architetturali (configurazione avanzata, raggruppate in 4 domini).
- **Livello 4**: Tool Manager, Skills, MCP (ecosistema, in una sezione dedicata).

Nessun utente deve vedere 17 voci di menu contemporaneamente.

### 2.3 Una sola fonte di verità per dato
- Status bar, context panel, sidebar badge, overview KPI devono leggere dallo stesso store cache, non fare 6 fetch concorrenti.
- Il count di azioni bloccate è uno solo, non 3 (WS buffer + API pending + SovereignModalContainer).

### 2.4 Coerenza linguistica
- **Una sola lingua alla volta** (IT default, EN toggle reale).
- Eliminare il mix nella stessa vista.
- Completare la migrazione i18n o rimuoverla deliberatamente (vedi §7).

### 2.5 Componenti piccoli e componibili
- Nessun componente >300 LOC senza giustificazione architetturale.
- Estrarre sottocomponenti condivisi: `EmptyState`, `ActionCard`, `RefreshButton`, `KVList`, `TagBadge`, `EntityList`.
- Riutilizzare i 26 componenti shadcn morti dove appropriato (alert-dialog, table, drawer, popover, form) invece di riscriverli.

### 2.6 Niente bypass fragili
- Eliminare `sessionStorage` per transfer state → usare store Zustand o URL params.
- Eliminare `window.dispatchEvent` → store Zustand con actions tipizzate.
- Eliminare il singleton command-registry → semplice array di comandi in `command-registry.ts` esportato come const.

### 2.7 Accessibilità come requisito
- Focus visibile su tutti gli elementi interattivi.
- ARIA labels su icone-only buttons.
- Tastiera completa per command palette, modali, tab navigation.
- Contrasto WCAG AA minimo.

---

## 3. Architettura target dell'informazione

### 3.1 Route map (da 3 a 7 pagine)

| Route | Tipo | Auth | Scopo |
|-------|------|------|-------|
| `/login` | Pubblica | No | Login (rimuovere credenziali demo hardcoded) |
| `/` | Privata | Sì | **Workbench** (Console-first) |
| `/inspect/[domain]` | Privata | Sì | Fasi architetturali raggruppate (4 domini) |
| `/ecosystem` | Privata | Sì | Tool Manager + Skills + MCP unificato |
| `/settings` | Privata | Sì | Profilo, preferenze, budget, API keys |
| `/share/[token]` | Pubblica | No | Conversazione condivisa (invariata) |
| `/onboarding` | Privata | Sì | Tour guidato al primo accesso |

Route mancanti da aggiungere: `not-found.tsx`, `error.tsx`, `loading.tsx` a livello root.

### 3.2 Layout target

```
┌──────────────────────────────────────────────────────────────────┐
│  Topbar: [≡] Breadcrumb / Title  ·  Status Bar  ·  [⌘K] [🌙] [⚙] │
├────────────┬─────────────────────────────────────────────────────┤
│            │                                                     │
│  Sidebar   │  Main Content Area                                  │
│  (collaps. │  ┌────────────────────────────────────────────────┐ │
│  w-14↔w-56)│  │                                                │ │
│            │  │  Active View (Console/Canvas/Timeline/Cockpit/ │ │
│  ▾ Action  │  │  Sovereign)                                    │ │
│    Console │  │                                                │ │
│    Cockpit │  │                                                │ │
│    Sovereign│  │                                                │ │
│  ▾ Inspect │  └────────────────────────────────────────────────┘ │
│    Memory  │  ┌────────────────────────────────────────────────┐ │
│    Plan    │  │  Context Panel (resizable, destra)             │ │
│    Verify  │  │  - QuickStats / Inspector / Help               │ │
│    Reflect │  │                                                │ │
│  ▾ Ecosystem│ └────────────────────────────────────────────────┘ │
│    Tools   │                                                     │
│    Skills  │                                                     │
│    MCP     │                                                     │
│  ▾ Account │                                                     │
│    Settings│                                                     │
│    Logout  │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

### 3.3 Gerarchia di navigazione (4 livelli instead of 17 voci flat)

**Action (3)** — Azione quotidiana
- Console (chat con il sistema)
- Cockpit (control room, 5 tab)
- Sovereign (azioni bloccate, HITL)

**Inspect (4)** — Configurazione avanzata, raggruppata per dominio cognitivo
- Memory & Context (ex phase1 + phase6 + phase10)
- Plan & Execute (ex phase2 + phase3 + phase12)
- Verify & Trust (ex phase4 + phase7 + phase8 + phase13)
- Learn & Route (ex phase5 + phase11 + phase14 + phase9)

**Ecosystem (3)** — Estensioni
- Tools (catalogo + install + builtin)
- Skills (CRUD + execute + builtin)
- MCP (connessioni esterne + esecuzioni)

**Account (2)**
- Settings (profilo, preferenze, budget, API keys)
- Logout

**Totale: 12 voci** instead of 17, raggruppate in 4 sezioni collapsable.

### 3.4 Mapping fasi attuali → nuovo raggruppamento

| Dominio | Fasi attuali | Justificazione |
|---------|--------------|----------------|
| **Memory & Context** | phase1 (Memory & State), phase6 (Context Manager), phase10 (Model Encapsulator) | Tutti gestiscono stato: memoria episodica, contesto conversazione, sessioni LLM |
| **Plan & Execute** | phase2 (Planner & Compiler), phase3 (Cognitive Steering), phase12 (Objective Builder) | Tutti coinvolti nella generazione/esecuzione del piano DynAMO |
| **Verify & Trust** | phase4 (Verification & Taint), phase7 (Trace Validator), phase8 (Formal Verifier), phase13 (Swarm Coherence) | Tutti responsabili di verifica formale o quorum di attendibilità |
| **Learn & Route** | phase5 (Reflective Learning), phase11 (Affect Monitor), phase14 (Model Router), phase9 (Human Retainer) | Tutti legati a feedback loop: apprendimento, affect, routing adattivo, delega umana |

Le 14 fasi non vengono **eliminate** — diventano **tab dentro i 4 domini**. Es: `/inspect/verify` mostra tab "LTL & Taint" · "Trace Validator" · "Lean4" · "Swarm".

---

## 4. Piano di lavoro in 6 sprint

**Durata totale stimata: 22 giorni lavorativi** (~4-5 settimane con buffer)

| Sprint | Durata | Focus | Output principale |
|--------|--------|-------|-------------------|
| 1 | 3gg | Fondamenta | Design tokens, i18n reale, store unificato, elimina dead code |
| 2 | 3gg | Navigazione & Layout | Sidebar 4-sezioni, topbar breadcrumb, routing `/inspect/[domain]` |
| 3 | 4gg | Console-first | AgentConsole refactor, empty states, onboarding tour |
| 4 | 4gg | Cockpit & Viste trasversali | Cockpit 5-tab pulito, CanvasView de-composizione, Timeline unify con Cockpit Log |
| 5 | 5gg | Fasi: consolidamento | 14 phase → 4 domini × tab, shared components, eliminare 5.000 LOC duplicati |
| 6 | 3gg | Polish & A11y | Accessibilità WCAG AA, keyboard nav, focus management, performance audit |

---

## Sprint 1 — Fondamenta (3 giorni)

### Obiettivo
Eliminare il technical debt di base prima di toccare la UI: design system, i18n, store dati, dead code.

### 1.1 Design tokens unificati (giorno 1)

**Problema attuale**: i colori categoria sono definiti in `store.ts:29-38` con valori Tailwind classi (`text-sky-600`), mentre `globals.css` usa token OKLCH. Disallineo.

**Azione**:
- Creare `src/lib/design-tokens.ts` con tutti i token: colori categoria, status tones (ok/warn/danger/info), spacing scale, font scale.
- Spostare `CATEGORY_COLORS` e `CATEGORY_LABELS` da `store.ts` a `design-tokens.ts`.
- Migrare i componenti per importare da `design-tokens.ts` invece di `store.ts`.
- Aggiornare `globals.css` per esporre gli stessi token come CSS variables: `--category-foundation`, `--category-orchestration`, ecc.

**Verifica**: nessun `text-sky-600` hardcoded nei componenti — tutti passano per `cn(categoryColor('foundation'))` o CSS var.

### 1.2 i18n reale o rimosso (giorno 1-2)

**Problema attuale**: i18n esiste ma copre solo ~30 chiavi, il 95% delle stringhe è hardcoded IT, il toggle IT/EN cambia solo il label del toggle stesso.

**Decisione binaria** (da approvare):
- **Opzione A** — Completare i18n: estrarre tutte le stringhe IT in chiavi, tradurre in EN, applicare `useI18n` ovunque. Costo: 3-4 giorni extra, spalmabili in Sprint 2-5.
- **Opzione B** — Rimuovere i18n: eliminare `i18n.ts`, `use-i18n.ts`, il toggle in topbar, defaultare a IT. Costo: mezza giornata. Reintrodurre i18n in futuro quando ci sarà budget.

**Raccomandazione**: Opzione B per ora (prodotto alpha, target italiano), reintrodurre i18n in Fase 6 (SaaS) con `next-intl` invece del sistema custom.

**Azione presunta (Opzione B)**:
- Eliminare `src/lib/i18n.ts` e `src/lib/use-i18n.ts`.
- Rimuovere `<LangToggle />` da `topbar.tsx`.
- Rimuovere `sota_lang` localStorage key.
- Aggiornare `lang="it"` in `layout.tsx` (già corretto).

### 1.3 Store dati unificato (giorno 2)

**Problema attuale**: 6 polling concorrenti per gli stessi dati. Nessuna cache. Transfer state via sessionStorage fragile.

**Azione**:
- Creare `src/lib/stores/data-store.ts` (Zustand) con cache per:
  - `dashboardStats` (refresh 5s, condiviso da Overview/Sidebar/QuickStats/StatusBar)
  - `blockedActions` (refresh 10s, condiviso da SovereignView/SovereignModal/BlockedInspector/Sidebar badge)
  - `costStats` (refresh 30s, condiviso da StatusBar/CostBreakdownModal)
  - `sensoriumLive` (WS, già esistente)
- Migrare `use-dashboard.ts`, polling in `sovereign-modal.tsx`, polling in `status-bar.tsx` per usare lo store.
- Eliminare `sessionStorage` transfer state in `related-phases.tsx:32-44` → sostituire con `data-store.ts` action `setTransferState(phase, payload)`.

**Verifica**: grep `setInterval` in `src/components/` deve restituire ≤3 risultati (WS reconnect, cost alerts threshold check, sensorium keepalive).

### 1.4 Elimina dead code (giorno 3)

**Azione**:
- Eliminare `src/components/agentic/branding-showcase.tsx` (orfano).
- Eliminare i 26 componenti shadcn mai usati: `accordion, alert-dialog, aspect-ratio, breadcrumb, calendar, carousel, chart, checkbox, collapsible, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, radio-group, sidebar, slider, sonner, table, toggle-group`.
  - **Eccezioni da tenere** (verificare uso futuro in Sprint 2-5): `alert-dialog` (per conferme distruttive), `table` (per liste strutturate), `popover` (per tooltip avanzati), `form` (per form validation). Spostarli in `src/components/ui/_reserved/` con commento "// Reserved for Sprint 2-5".
- Eliminare chiavi i18n orfane (`sota_dashboard_subtitle`, `sota_phases_count`, ecc.).
- Eliminare codice morto in `workspace-views.tsx:104` (handler commentato).

**Verifica**: `bun run build` passa, `bun run test` passa, dimensione bundle ridotta ≥5%.

### 1.5 Elimina custom events globali (giorno 3)

**Problema attuale**: 5 `window.dispatchEvent` per tab switch (`sota:tool-tab`, `sota:phase4-tab`, ecc.).

**Azione**:
- Aggiungere allo store Zustand: `pendingTabSwitch: { phase: string; tab: string } | null`.
- Sostituire `window.dispatchEvent(new CustomEvent('sota:tool-tab', { detail: 'skills' }))` con `setPendingTabSwitch({ phase: 'tools', tab: 'skills' })`.
- Nei componenti Phase, leggere `pendingTabSwitch` e applicare il tab switch in `useEffect`, poi pulire con `clearPendingTabSwitch()`.

**Verifica**: grep `dispatchEvent` in `src/components/` deve restituire 0 risultati.

### Criteri di accettazione Sprint 1
- [ ] `src/lib/design-tokens.ts` esistente e importato da tutti i componenti categoria-colorati
- [ ] i18n rimosso (Opzione B) o completato (Opzione A)
- [ ] `src/lib/stores/data-store.ts` esistente, ≤3 `setInterval` in tutta la codebase UI
- [ ] ≥1 file orfano eliminato, ≥20 componenti shadcn morti eliminati o riservati
- [ ] 0 `window.dispatchEvent` in `src/components/`
- [ ] `bun run test` ≥207 test verdi (più eventuali nuovi test per data-store)
- [ ] `bun run build` passa
- [ ] Bundle size ridotto ≥5%

---

## Sprint 2 — Navigazione e Layout (3 giorni)

### Obiettivo
Ristrutturare sidebar, topbar, routing per la nuova gerarchia a 4 sezioni.

### 2.1 Sidebar 4-sezioni (giorno 1)

**Problema attuale**: 17 voci flat senza etichette categoria su desktop.

**Azione**:
- Riscrivere `src/components/agentic/sidebar.tsx` con 4 sezioni collapsable:
  - `Action` (Console, Cockpit, Sovereign) — sempre espansa
  - `Inspect` (4 domini) — espandibile
  - `Ecosystem` (Tools, Skills, MCP) — espandibile
  - `Account` (Settings, Logout) — sempre espansa
- Ogni sezione ha un header con icona + label + count badge (es. "Inspect · 4").
- Etichette categoria visibili SEMPRE (non solo mobile).
- Section collapse state persistente in `localStorage` (key `sota_sidebar_sections`).
- Sidebar collapse globale (w-56 ↔ w-14) invariato, ma icone-only mostra tooltip al hover.

**Verifica**: screenshot prima/dopo. La nuova sidebar mostra ≤12 voci per sezione espansa, mai 17 flat.

### 2.2 Topbar con breadcrumb (giorno 2)

**Problema attuale**: nessun breadcrumb, titolo visibile solo mobile, su desktop si vede solo StatusBar.

**Azione**:
- Riscrivere `src/components/agentic/topbar.tsx`:
  - Sinistra: `[≡ sidebar toggle]` + breadcrumb gerarchico (es. `Inspect / Verify & Trust / LTL & Taint`).
  - Centro: StatusBar (invariata ma con max-width e responsive wrap).
  - Destra: `[⌘K]` command palette trigger + `[🌙]` theme toggle + `[⚙]` settings + user menu.
- Breadcrumb costruito da `activeView + activePhase + activeTab` nello store.
- Titolo pagina sempre visibile (non solo mobile).
- StatusBar su mobile: collapse in un singolo pill "Status: OK" che apre un popover con i dettagli.

**Verifica**: l'utente sa sempre "dove sono" guardando la topbar, su qualsiasi viewport.

### 2.3 Routing `/inspect/[domain]` (giorno 2-3)

**Problema attuale**: single-page app, nessun deep-link possibile a una fase specifica.

**Azione**:
- Aggiornare `src/app/page.tsx` per leggere query params e sincronizzare con store:
  - `?view=console&phase=overview` (default)
  - `?view=inspect&domain=verify&tab=ltl`
  - `?view=ecosystem&tab=skills`
- Creare `src/app/inspect/[domain]/page.tsx` come route dedicata per i 4 domini.
- Creare `src/app/ecosystem/page.tsx` per Tools/Skills/MCP.
- Aggiornare store Zustand per sync bidirezionale URL ↔ state via `useSearchParams` + `router.replace`.
- Aggiornare `setActivePhase` per aggiornare anche l'URL.

**Verifica**: copiare-incollare URL in un'altra tab riproduce lo stesso stato. Back/forward browser funziona.

### 2.4 Bug fix: default view (giorno 3)

**Problema attuale**: `activePhase='overview'` + `activeView='console'` → l'utente atterra su Console ma sidebar evidenzia "Dashboard".

**Azione**:
- In `store.ts`, default state: `activePhase: 'overview'`, `activeView: 'phase'` (overview è una "phase view").
- `setActivePhase('overview')` setta `activeView: 'phase'`.
- Overview renderizza `<Overview />` come PhaseView.
- Al primo caricamento, l'utente vede la Dashboard (con architettura + KPI + live feed), NON la Console.
- Aggiungere CTA prominente in Overview: "Inizia a parlare con il sistema" → va alla Console.

**Verifica**: primo accesso mostra Dashboard, sidebar evidenzia "Action > Console" rimane spento finché l'utente non ci clicca.

### 2.5 Auth gate reale (giorno 3)

**Problema attuale**: nessun middleware Next.js, accesso diretto a `/` bypassa il check.

**Azione**:
- Creare `src/middleware.ts` con logica:
  - Whitelist path pubblici: `/login`, `/share/[token]`, `/api/auth`, `/api/health`, `/api/mcp` (MCP server per client esterni), asset statici.
  - Tutti gli altri path: verificare cookie `sota_session`, se assente redirect `/login?next=<original>`.
- Aggiornare `login/page.tsx` per leggere `?next=` e redirect lì dopo login.
- Rimuovere credenziali demo hardcoded dagli input default value (lasciare solo nel placeholder).

**Verifica**: visitare `/` in incognito senza cookie → redirect `/login`. Dopo login, redirect a `/` o al path originale.

### Criteri di accettazione Sprint 2
- [ ] Sidebar con 4 sezioni, ≤12 voci per sezione, etichette categoria visibili desktop
- [ ] Topbar con breadcrumb + titolo sempre visibile + StatusBar responsive
- [ ] Route `/inspect/[domain]` e `/ecosystem` funzionanti con deep-link
- [ ] Default view corretta (Dashboard al primo accesso)
- [ ] `src/middleware.ts` blocca accessi non autenticati
- [ ] Credenziali demo non più hardcoded come default value
- [ ] Back/forward browser naviga correttamente tra stati
- [ ] `bun run test` ≥207 verdi, build passa

---

## Sprint 3 — Console & Console-First Experience (4 giorni)

### Obiettivo
Trasformare la Console da "uno dei 17 componenti" al cuore dell'esperienza. Refactor del monolite (738 LOC).

### 3.1 Decomposizione AgentConsole (giorno 1-2)

**Problema attuale**: `agent-console.tsx` è 738 LOC con tutto dentro: state messaggi, drag-drop, suggestions, streaming, attachments, inline actions.

**Azione**:
- Spezzare in 5 sottocomponenti in `src/components/console/`:
  - `ConsoleHeader.tsx` — toolbar (model selector, mode toggle, clear button)
  - `MessageList.tsx` — rendering messaggi user/assistant con attachment preview
  - `MessageBubble.tsx` — singolo messaggio + InlineActions hover
  - `ConsoleInput.tsx` — textarea + suggestions chips + submit button + drag-drop
  - `ConsoleSuggestions.tsx` — 4 suggestion chips iniziali (separate per testabilità)
- Estraire hook `useConsoleStream` (SSE) in `src/hooks/use-console-stream.ts`.
- Estrarre hook `useConsoleAttachments` (drag-drop + preview) in `src/hooks/use-console-attachments.ts`.
- `AgentConsole` diventa orchestrator ≤150 LOC.

**Verifica**: ogni sottocomponente ≤200 LOC, testabile isolato.

### 3.2 Empty state della Console (giorno 2)

**Problema attuale**: la Console ha 4 suggestion chips ma niente welcome screen per nuovi utenti.

**Azione**:
- Creare `ConsoleWelcome.tsx` con:
  - Hero: "Ciao, sono SOTA. Posso pianificare, eseguire, verificare e imparare."
  - 3 capability cards: "Pianifica un task" / "Verifica una regola LTL" / "Analizza codice" — click → prepopola input con prompt template.
  - 4 suggestion chips esistenti (invariate).
  - "Ultima conversazione" con link se esiste almeno una conversazione salvata.
- Sostituire `MessageList` vuoto con `<ConsoleWelcome />` quando `messages.length === 0`.

**Verifica**: nuovo utente vede una console accogliente, non un vuoto grigio.

### 3.3 Skill suggestions inline (giorno 3)

**Problema attuale**: le skill esistono (Fase 4) ma l'utente deve andare su `Tool Manager > Skills` per scoprirle.

**Azione**:
- In `ConsoleInput`, aggiungere "skill picker" popover (icona `Sparkles` a sinistra del textarea).
- Click → popover con search + lista skill (chiamata `/api/skills?action=suggest&input=<currentInput>`).
- Click su una skill → prepopola il prompt con il template + mostra i placeholder da riempire.
- Auto-suggest: mentre l'utente digita, se `suggestSkills` restituisce match con score >10, mostra un toast "Skill rilevante: <name> — usa?".

**Verifica**: l'utente scopre le skill dalla Console senza dover navigare.

### 3.4 Onboarding tour (giorno 4)

**Problema attuale**: nessun tour, nessun tooltip al primo accesso.

**Azione**:
- Creare `src/components/onboarding/onboarding-tour.tsx` con `react-joyride` (o custom con framer-motion).
- 5 step al primo accesso (rilevato da `localStorage.onboarding_completed === undefined`):
  1. Welcome: "SOTA Agentic OS — sei nel posto giusto" (centered modal)
  2. Console: "Inizia qui. Scrivi un task, il sistema pianifica ed esegue."
  3. Cmd+K: "Premi Cmd+K ovunque per accedere a tutto rapidamente."
  4. Sovereign: "Quando un'azione richiede approvazione, appare qui. Non ti blocca."
  5. Inspect: "Per configurare fasi avanzate, vai in Inspect. Ma non serve per iniziare."
- Skip button: "Salta il tour" → imposta `localStorage.onboarding_completed = 'skipped'`.
- Completamento: `localStorage.onboarding_completed = 'completed'`.
- Re-trigger da Settings → "Ripeti tour".

**Verifica**: nuovo utente vede il tour una volta. Vecchi utenti non lo vedono.

### 3.5 Sovereign modal: snooze + non-mostrare-più (giorno 4)

**Problema attuale**: `SovereignModalContainer` popup intrusivo ogni 5s, nessuno snooze.

**Azione**:
- Aggiungere header al modal: "Approvazione richiesta · [Snooze 5min] [Snooze 30min] [Non mostrare più questa sessione]"
- Snooze: `localStorage.sovereign_snooze_until = <timestamp>` → il container salta il polling fino a quel timestamp.
- "Non mostrare più questa sessione": `sessionStorage.sovereign_dismissed = 'true'` → fino al prossimo login.
- Mantenere il badge rosso sulla sidebar `Action > Sovereign` per ricordare all'utente che ci sono azioni pending.
- Click sul badge → apre il modal regardless del snooze.

**Verifica**: l'utente può lavorare senza essere interrotto, ma vede sempre il badge.

### Criteri di accettazione Sprint 3
- [ ] `AgentConsole` ≤150 LOC, 5 sottocomponenti ≤200 LOC ciascuno
- [ ] `ConsoleWelcome` visibile per nuovi utenti con 3 capability cards
- [ ] Skill picker nella Console input, auto-suggest con score >10
- [ ] Onboarding tour 5-step al primo accesso, skippabile, re-triggerabile da Settings
- [ ] Sovereign modal con snooze 5/30min + dismiss sessione
- [ ] Badge Sovereign sempre visibile anche con snooze attivo
- [ ] Test per `useConsoleStream`, `useConsoleAttachments`, `ConsoleWelcome`
- [ ] Build + 207+ test verdi

---

## Sprint 4 — Cockpit & Viste trasversali (4 giorni)

### Obiettivo
Pulire il Cockpit (5 tab), de-comporre CanvasView (637 LOC), unificare Timeline con Cockpit Log.

### 4.1 Cockpit: 5 tab puliti (giorno 1-2)

**Problema attuale**: Cockpit ha 5 tab ma "Log" è duplicato con TimelineView. `cockpit.tsx` è 421 LOC monolite.

**Azione**:
- Ristrutturare in `src/components/cockpit/`:
  - `CockpitContainer.tsx` (≤100 LOC) — tab orchestrator
  - `NarrativeTab.tsx` — narrativa ad alto livello (invariata)
  - `LogTab.tsx` — MERGE con TimelineView: stessa vista con filtri (phase/agent/level)
  - `SchedulerTab.tsx` — scheduler tasks
  - `CyclesTab.tsx` — cycle history
  - `SafetyTab.tsx` — azioni bloccate + HITL (sinergia con Sovereign)
- Aggiornare `TimelineView` per essere un "Cockpit Log con filtri avanzati" — click su "Apri in Timeline" dal Cockpit Log tab → passa alla vista Timeline (stessa data source, più filtri).
- SensoriumWidget e AffectGauge rimangono persistenti sopra i tab.

**Verifica**: Cockpit Log e Timeline non duplicano più la chiamata `/api/cockpit?tab=log`.

### 4.2 CanvasView de-composizione (giorno 2-3)

**Problema attuale**: `canvas-view.tsx` è 637 LOC, gestisce 3 tipi di DAG con 3 set di stati.

**Azione**:
- Spezzare in `src/components/canvas/`:
  - `CanvasContainer.tsx` (≤100 LOC) — selector DAG type + routing
  - `DynamoCanvas.tsx` — DAG piani DynAMO
  - `ObjectiveCanvas.tsx` — BFS tree objective
  - `LeanCanvas.tsx` — workflow Lean4
  - `CanvasToolbar.tsx` — selector + status filter + zoom controls
  - `CanvasNodePalette.tsx` — sidebar nodi trascinabili (se applicabile)
- Condividere `dag-visualizers.tsx` (già riusato, invariato).
- CanvasView diventa orchestrator ≤100 LOC.

**Verifica**: ogni sottocomponente ≤200 LOC, testabile isolato.

### 4.3 SovereignView refactor (giorno 3)

**Problema attuale**: `sovereign-view.tsx` è 564 LOC, duplica stili di BlockedAction in 3 file.

**Azione**:
- Estrarre `src/components/blocked-action/`:
  - `BlockedActionCard.tsx` — card riutilizzabile (una definizione di SOURCE_STYLE/STATUS_STYLE)
  - `BlockedActionList.tsx` — lista con filtri
  - `BlockedActionInspector.tsx` — detail + resolve form (rimpiazza `blocked-inspector.tsx`)
  - `BlockedActionModal.tsx` — modale (rimpiazza `sovereign-modal.tsx`)
  - `blocked-action-styles.ts` — costanti condivise (SOURCE_STYLE, STATUS_STYLE)
- SovereignView diventa orchestrator che usa `BlockedActionList` + `BlockedActionInspector`.
- Eliminare le 3 definizioni duplicate di SOURCE_STYLE/STATUS_STYLE.

**Verifica**: grep `SOURCE_STYLE` restituisce 1 risultato (in `blocked-action-styles.ts`).

### 4.4 Context panel: phase-aware (giorno 4)

**Problema attuale**: Context panel mostra sempre `QuickStats` quando nessun item è selezionato, anche se l'utente è in una fase specifica.

**Azione**:
- Aggiungere al store: `contextPanelMode: 'quickstats' | 'phase' | 'inspector' | 'help'`.
- Quando l'utente naviga in una fase, `contextPanelMode = 'phase'` e il panel mostra un `PhaseInspector` phase-specific.
- Ogni fase definisce il proprio `PhaseInspector` (es. Phase4 mostra "regole LTL attive" + "taint sources" + "normative axioms").
- L'utente può tornare a `QuickStats` con un toggle in cima al panel.
- Quando l'utente seleziona un item (node/log/blocked), `contextPanelMode = 'inspector'` automaticamente.
- Aggiungere 4° mode `'help'` con docs inline per la fase corrente.

**Verifica**: navigando tra fasi, il context panel aggiorna il contenuto contestualmente.

### Criteri di accettazione Sprint 4
- [ ] `cockpit.tsx` ≤100 LOC, 5 sottocomponenti tab ≤200 LOC ciascuno
- [ ] Cockpit Log e Timeline non duplicano fetch
- [ ] `canvas-view.tsx` ≤100 LOC, 4 sottocomponenti ≤200 LOC ciascuno
- [ ] `sovereign-view.tsx` ≤200 LOC, `blocked-action-styles.ts` unica fonte
- [ ] Context panel phase-aware con 4 modalità
- [ ] Eliminate 3 duplicazioni di SOURCE_STYLE/STATUS_STYLE
- [ ] Test per nuovi sottocomponenti
- [ ] Build + test verdi

---

## Sprint 5 — Fasi architetturali: consolidamento (5 giorni)

### Obiettivo
Trasformare i 14 monoliti `PhaseN.tsx` (~5.000 LOC) in 4 domini × tab, con componenti condivisi.

### 5.1 Componenti condivisi (giorno 1)

**Problema attuale**: ogni PhaseN riscrive form/list/refresh/empty state/KPI/related-phases.

**Azione**:
Creare `src/components/shared/`:
- `EmptyState.tsx` — props: `icon`, `title`, `description`, `actionLabel?`, `onAction?`. Sostituisce i 14 empty state inline.
- `RefreshButton.tsx` — bottone "Aggiorna" standardizzato con loading state. Sostituisce 14 ripetizioni.
- `EntityList.tsx<T>` — lista generica con search, filter, pagination, empty state. Props: `items`, `renderItem`, `searchKeys`, `filterOptions?`.
- `EntityForm.tsx` — form generico con validation, submit, cancel. Props: `fields`, `onSubmit`, `onCancel`.
- `KVList.tsx` — lista key-value per detail panel.
- `TagBadge.tsx` — badge con colore categoria + tooltip.
- `StatCard.tsx` — card KPI compatta (unifica `StatCard` di ToolManager + `PhaseKpi`).
- `SectionCard.tsx` — card con header + content + footer opzionale.
- `ConfirmDialog.tsx` — wrapper shadcn `alert-dialog` per conferme distruttive (rimpiazza `confirm()` nativo).

**Verifica**: ogni componente ha test, story (se storybook), documentazione JSDoc.

### 5.2 Dominio Memory & Context (giorno 2)

**Problema attuale**: phase1 (442 LOC), phase6 (339 LOC), phase10 (174 LOC) = 955 LOC separati.

**Azione**:
- Creare `src/components/domains/memory-context/`:
  - `MemoryContextContainer.tsx` (≤100 LOC) — 3 tab orchestrator
  - `EpisodicMemoryTab.tsx` — ex phase1 episodi + entità (≤250 LOC)
  - `ContextManagerTab.tsx` — ex phase6 ring buffer + summaries (≤250 LOC)
  - `ModelEncapsulatorTab.tsx` — ex phase10 sessions + sandbox (≤200 LOC)
- Route: `/inspect/memory` mostra il container con 3 tab.
- Sidebar `Inspect > Memory & Context` → navigate to route.
- Usare `EntityList`, `RefreshButton`, `EmptyState` condivisi.

**Verifica**: 955 LOC → ~700 LOC totali con componenti condivisi. -27%.

### 5.3 Dominio Plan & Execute (giorno 2-3)

**Problema attuale**: phase2 (370 LOC), phase3 (273 LOC), phase12 (245 LOC) = 888 LOC separati.

**Azione**:
- Creare `src/components/domains/plan-execute/`:
  - `PlanExecuteContainer.tsx` — 3 tab orchestrator
  - `PlannerTab.tsx` — ex phase2 DynAMO + Compiled AI
  - `SteeringTab.tsx` — ex phase3 ACTS vocab + step
  - `ObjectiveTab.tsx` — ex phase12 BFS tree
- Condividere `DynamoDagVisualizer` e `ObjectiveTreeVisualizer` da `dag-visualizers.tsx`.
- Route: `/inspect/plan`.

**Verifica**: 888 LOC → ~650 LOC. -27%.

### 5.4 Dominio Verify & Trust (giorno 3-4)

**Problema attuale**: phase4 (446 LOC), phase7 (382 LOC), phase8 (432 LOC), phase13 (368 LOC) = 1.628 LOC separati. Phase4 ha anche `ltl-normative-editor.tsx` (447 LOC) sub-component.

**Azione**:
- Creare `src/components/domains/verify-trust/`:
  - `VerifyTrustContainer.tsx` — 4 tab orchestrator
  - `LtlTaintTab.tsx` — ex phase4 + `ltl-normative-editor` merged (eliminare duplicazione LTL inline)
  - `TraceValidatorTab.tsx` — ex phase7 PTA + dominators
  - `FormalVerifierTab.tsx` — ex phase8 Lean4 contratti
  - `SwarmTab.tsx` — ex phase13 beliefs + quorum
- Eliminare duplicazione LTL tra phase4.tsx e ltl-normative-editor.tsx (stessa logica definita 2 volte).
- Route: `/inspect/verify`.

**Verifica**: 1.628 LOC + 447 (sub) = 2.075 → ~1.400 LOC. -33%.

### 5.5 Dominio Learn & Route (giorno 4-5)

**Problema attuale**: phase5 (330 LOC), phase11 (202 LOC), phase14 (238 LOC), phase9 (539 LOC — il più grande) = 1.309 LOC separati.

**Azione**:
- Creare `src/components/domains/learn-route/`:
  - `LearnRouteContainer.tsx` — 4 tab orchestrator
  - `ReflectiveTab.tsx` — ex phase5 ERL + euristiche + red lines
  - `AffectTab.tsx` — ex phase11 desperation/frustration
  - `RouterTab.tsx` — ex phase14 decisions + ensemble
  - `RetainerTab.tsx` — ex phase9 (decomposto in 3 sottocomponenti: `DelegationsList`, `GatesList`, `AuditTrail` — phase9 è troppo grande per stare in un solo tab)
- Route: `/inspect/learn`.

**Verifica**: 1.309 LOC → ~1.000 LOC. -24%.

### 5.6 Related phases → Contextual links (giorno 5)

**Problema attuale**: `RelatedPhases` con `links` array hardcoded per ogni fase, rischio drift.

**Azione**:
- Sostituire `RelatedPhases` con `ContextualLinks` basato su `ARCHITECTURE_FLOWS` (già esistente in `related-phases.tsx:46-90`).
- I link sono bidirezionali: se A linka B, B linka A automaticamente.
- Renderizzare come chip cliccabili in fondo al container di dominio, non in ogni tab.
- Click → naviga al dominio/tab correlato con transfer state (es. "apri LTL rule X in Verify tab").

**Verifica**: nessun `links={[...]}` hardcoded nei componenti phase. Tutto derivato da `ARCHITECTURE_FLOWS`.

### Criteri di accettazione Sprint 5
- [ ] 8 componenti condivisi in `src/components/shared/`
- [ ] 4 domini in `src/components/domains/` con tab orchestrator
- [ ] LOC totali fasi ridotti ≥25% (da ~5.000 a ~3.700)
- [ ] Eliminata duplicazione LTL in phase4
- [ ] Phase9 decomposto in 3 sottocomponenti
- [ ] `RelatedPhases` rimosso, sostituito da `ContextualLinks` derivato
- [ ] Route `/inspect/{memory,plan,verify,learn}` funzionanti
- [ ] Build + test verdi

---

## Sprint 6 — Polish, onboarding, accessibilità (3 giorni)

### Obiettivo
Rendere il prodotto accessibile (WCAG AA), performante, e polished.

### 6.1 Accessibilità WCAG AA (giorno 1-2)

**Azione**:
- Aggiungere `aria-label` a tutti gli icon-only buttons (grep `size-3` in componenti per trovarli).
- Aggiungere `role="tablist"`, `role="tab"`, `aria-selected` ai tab di tutte le viste.
- Focus visibile: `focus-visible:ring-2 focus-visible:ring-ring` su tutti gli elementi interattivi.
- Keyboard navigation completa:
  - Tab/Shift+Tab per spostarsi tra elementi focusable.
  - Arrow keys per navigare tra tab.
  - Enter/Space per attivare.
  - Esc per chiudere modali/popover.
- Contrasto verificato con axe-core (script `bunx axe-core-check`).
- Screen reader test con NVDA/VoiceOver su flussi chiave (login, console, command palette).

**Verifica**: 0 violazioni axe-core critiche, ≤3 violazioni minori (contrast ratio borderline).

### 6.2 Performance audit (giorno 2)

**Azione**:
- Bundle analysis con `@next/bundle-analyzer`.
- Verificare che nessun componente importi intere librerie (es. `import * as Icons from 'lucide-react'`).
- Code-splitting: i 4 domini `/inspect/*` sono lazy-loaded con `next/dynamic`.
- Memoizzazione: `React.memo` sui sottocomponenti che ricevono props stabili (es. `MessageBubble`).
- Virtualizzazione liste lunghe (>50 item) con `@tanstack/react-virtual` (es. timeline log, episodi memory).
- Verificare Lighthouse score ≥80 su tutte le route principali.

**Verifica**: Lighthouse Performance ≥80, Bundle principale ≤300KB gzipped.

### 6.3 Empty states uniformi (giorno 3)

**Azione**:
- Audit di tutti gli empty state (lista vuota, no data, error).
- Sostituire tutti con `EmptyState` condiviso.
- Ogni empty state ha: icona, titolo, descrizione, CTA (se applicabile).
- Esempi:
  - "Nessun episodio memoria. Manda un task alla Console per iniziare." + CTA "Vai alla Console"
  - "Nessuna regola LTL. Crea la prima regola di safety." + CTA "Crea regola"
  - "Nessuna connessione MCP. Connetti un server esterno." + CTA "Connetti"

**Verifica**: grep `text-muted-foreground italic` (pattern empty state vecchio) restituisce 0 risultati.

### 6.4 Loading states uniformi (giorno 3)

**Azione**:
- Uniformare skeleton loaders: ogni vista ha il suo skeleton dedicato in `skeletons.tsx` (già esistente, estendere).
- Route-level `loading.tsx` per `/inspect/[domain]` e `/ecosystem`.
- Suspense boundary nei container di dominio.
- Eliminare `Loader2 animate-spin` inline dove esiste uno skeleton dedicato.

**Verifica**: ogni route mostra skeleton appropriato durante il caricamento, mai blank screen.

### 6.5 Error states uniformi (giorno 3)

**Azione**:
- Creare `src/app/error.tsx` (route-level error boundary).
- Creare `src/app/not-found.tsx` custom.
- Error state nei componenti: ogni fetch ha try/catch che mostra `ErrorState` con retry button.
- Error state ha: icona, messaggio, "Riprova" button, "Segnala problema" link (mailto o GitHub issue).

**Verifica**: simulare errori di rete (Chrome DevTools offline) mostra ErrorState invece di toast rossi.

### Criteri di accettazione Sprint 6
- [ ] axe-core: 0 violazioni critiche
- [ ] Lighthouse Performance ≥80
- [ ] Bundle principale ≤300KB gzipped
- [ ] Tutti gli empty state usano `EmptyState` condiviso
- [ ] Tutte le route hanno `loading.tsx` + `error.tsx`
- [ ] `not-found.tsx` custom esistente
- [ ] Keyboard navigation completa verificata
- [ ] Build + test verdi

---

## 5. Sistema di design: token, componenti, pattern

### 5.1 Token gerarchici

```typescript
// src/lib/design-tokens.ts
export const tokens = {
  color: {
    category: {
      core: 'var(--category-core)',
      foundation: 'var(--category-foundation)',
      orchestration: 'var(--category-orchestration)',
      cognitive: 'var(--category-cognitive)',
      trust: 'var(--category-trust)',
      learning: 'var(--category-learning)',
      governance: 'var(--category-governance)',
      infrastructure: 'var(--category-infrastructure)',
    },
    status: {
      ok: 'var(--status-ok)',        // emerald
      warn: 'var(--status-warn)',    // amber
      danger: 'var(--status-danger)', // red
      info: 'var(--status-info)',    // sky
      muted: 'var(--status-muted)',  // zinc
    },
  },
  spacing: { xs: '0.5rem', sm: '0.75rem', md: '1rem', lg: '1.5rem', xl: '2rem' },
  font: {
    size: { xs: '0.625rem', sm: '0.75rem', base: '0.875rem', lg: '1rem', xl: '1.25rem' },
    weight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  },
  radius: { sm: '0.25rem', md: '0.5rem', lg: '0.75rem', full: '9999px' },
} as const
```

### 5.2 Componenti condivisi (Sprint 5 §5.1)

8 componenti in `src/components/shared/`:
- `EmptyState`, `RefreshButton`, `EntityList<T>`, `EntityForm`, `KVList`, `TagBadge`, `StatCard`, `SectionCard`, `ConfirmDialog`

### 5.3 Pattern consolidati

- **Refresh pattern**: ogni lista ha `RefreshButton` che chiama `refresh()` dallo store dati.
- **Form pattern**: `EntityForm` con validation sincrona + async, loading state, error display.
- **List pattern**: `EntityList<T>` con search/filter/pagination/empty state.
- **Detail pattern**: `KVList` per proprietà + `SectionCard` per sezioni.
- **Confirm pattern**: `ConfirmDialog` per tutte le azioni distruttive (delete, revoke, reject).

---

## 6. Gestione dello stato: dal caos all'architettura

### 6.1 Store Zustand multi-slice

```
src/lib/stores/
├── navigation-store.ts    (esistente, esteso) — activeView, activePhase, activeTab, selectedItem, contextPanelMode
├── data-store.ts          (nuovo) — dashboardStats, blockedActions, costStats, sensoriumLive
├── console-store.ts       (nuovo) — messages, isStreaming, attachments, suggestions
├── transfer-store.ts      (nuovo) — pendingTabSwitch, contextualLinks payload
└── ui-store.ts            (nuovo) — sidebarCollapsed, sidebarSections (collapse state), contextPanelSize, theme
```

### 6.2 Eliminazione anti-pattern

| Anti-pattern | Sostituzione |
|--------------|--------------|
| `window.dispatchEvent('sota:tool-tab')` | `transferStore.setPendingTabSwitch({ phase, tab })` |
| `sessionStorage.setItem('sota_transfer_*')` | `transferStore.setTransferPayload(phase, payload)` |
| `setInterval` in componenti | `dataStore` con refresh automatico (configurabile) |
| `localStorage` per UI state | `uiStore` con persist middleware Zustand |
| Polling concorrente | `dataStore` cache con `getData() → Promise<T>` (deduped) |

### 6.3 Sincronizzazione URL ↔ state

```typescript
// src/lib/stores/navigation-store.ts (extended)
useEffect(() => {
  const url = new URL(window.location.href)
  url.searchParams.set('view', activeView)
  if (activePhase) url.searchParams.set('phase', activePhase)
  if (activeTab) url.searchParams.set('tab', activeTab)
  router.replace(url.toString(), { scroll: false })
}, [activeView, activePhase, activeTab])
```

---

## 7. i18n: migrazione dal fittizio al reale

### 7.1 Decisione: rimozione temporanea (Opzione B)

**Razionale**: il prodotto è alpha, target italiano, il 95% delle stringhe è già hardcoded IT. Completare i18n richiede 3-4 giorni extra per estrarre ~500 stringhe. Meglio reintrodurre i18n in Fase 6 (SaaS) con `next-intl` (standard de facto) invece del sistema custom attuale.

### 7.2 Azioni di rimozione

1. Eliminare `src/lib/i18n.ts` e `src/lib/use-i18n.ts`.
2. Rimuovere `<LangToggle />` da `topbar.tsx`.
3. Rimuovere `sota_lang` localStorage key (cleanup in `onboarding-tour.tsx` se necessario).
4. Aggiornare `lang="it"` in `layout.tsx` (già corretto).
5. Mantenere i18n key stringhe nei commenti dei componenti per futura migrazione: `// i18n: "Nuova skill"` per facilitare l'estrazione automatica futura.

### 7.3 Piano futuro (Fase 6)

- Installare `next-intl` (Next.js official i18n).
- Configurare 2 locale: `it` (default), `en`.
- Estrarre stringhe con `bunx next-intl extract`.
- Traduzioni in `src/messages/{it,en}.json`.
- Server components + client components support nativo.
- Routing `/it/...` e `/en/...` opzionale (per SEO futura).

---

## 8. Criteri di accettazione complessivi

La ristrutturazione è considerata completa quando:

### 8.1 Architettura
- [ ] 4 domini `/inspect/{memory,plan,verify,learn}` + `/ecosystem` funzionanti
- [ ] Sidebar con 4 sezioni, ≤12 voci per sezione
- [ ] Topbar con breadcrumb + titolo sempre visibile
- [ ] Deep-link via URL params funzionante
- [ ] `src/middleware.ts` auth gate attivo

### 8.2 Codebase
- [ ] Nessun componente >300 LOC senza giustificazione
- [ ] 8 componenti condivisi in `src/components/shared/`
- [ ] 0 `window.dispatchEvent` in `src/components/`
- [ ] 0 `sessionStorage` per transfer state
- [ ] ≤3 `setInterval` in tutta la UI
- [ ] 0 duplicazioni di SOURCE_STYLE/STATUS_STYLE
- [ ] Dead code eliminato (26 componenti shadcn, branding-showcase, i18n orfano)

### 8.3 UX
- [ ] Onboarding tour 5-step al primo accesso
- [ ] Empty state uniformi con `EmptyState` condiviso
- [ ] Sovereign modal con snooze + dismiss
- [ ] Context panel phase-aware con 4 modalità
- [ ] Default view corretta (Dashboard al primo accesso)
- [ ] IT consistente (niente mix IT/EN nella stessa vista)

### 8.4 Performance & A11y
- [ ] Lighthouse Performance ≥80
- [ ] axe-core: 0 violazioni critiche
- [ ] Bundle principale ≤300KB gzipped
- [ ] Route-level `loading.tsx` + `error.tsx` + `not-found.tsx`

### 8.5 Quality
- [ ] `bun run test` ≥250 test verdi (+43 vs baseline 207)
- [ ] `bun run lint` 0 errori
- [ ] `bun run build` passa
- [ ] TypeScript strict mode 0 errori

---

## 9. Rischi e mitigazioni

### 9.1 Rischio: regressioni funzionali durante refactor

**Probabilità**: alta · **Impatto**: alto

**Mitigazione**:
- Mantenere i 14 `PhaseN.tsx` originali come `_legacy/` finché i 4 domini non sono completi e testati.
- Feature flag `NEXT_PUBLIC_USE_NEW_DOMAINS=true|false` per switch runtime.
- Ogni sprint ha test di regressione sul flusso Console → Plan → Execute → Verify → Reflect.
- Rollback plan: revert dello sprint in blocco se >5 bug critici.

### 9.2 Rischio: scope creep

**Probabilità**: alta · **Impatto**: medio

**Mitigazione**:
- Ogni sprint ha criteri di accettazione binari (sì/no).
- "Nice to have" spostati in backlog separato.
- Timeout per sprint: se non finito in tempo, tagliare scope non spostare deadline.
- Demo end-of-sprint con stakeholder per validare prima di proseguire.

### 9.3 Rischio: collisione con Fase 5 (Observability)

**Probabilità**: bassa · **Impatto**: basso

**Mitigazione**:
- Fase 5 esplicitamente esclusa (vedi §11).
- Se emerge bisogno di observability durante refactor, documentarlo in `FASE-5-OSSERVABILITA.md` senza implementarlo.

### 9.4 Rischio: rotture API durante refactor store

**Probabilità**: media · **Impatto**: alto

**Mitigazione**:
- Il refactor store è solo UI-side, le API non vengono toccate.
- `data-store.ts` legge dalle stesse API esistenti.
- Test di integrazione per ogni endpoint toccato indirettamente.

### 9.5 Rischio: perdita di funzionalità minori durante consolidamento

**Probabilità**: media · **Impatto**: medio

**Mitigazione**:
- Prima di eliminare un `PhaseN.tsx`, verificare che tutte le sue funzionalità siano migrate con un test di parità.
- Checklist di funzionalità per ogni fase (es. phase4: LTL create/list/test/delete + taint track + normative axioms + axiom trail).
- Se una funzionalità è marginale e non usata, documentarla in `DEPRECATED.md` invece di migrarla ciecamente.

---

## 10. Metriche di successo

### 10.1 Metriche quantitative

| Metrica | Prima | Target | Misura |
|---------|-------|--------|--------|
| Componenti >400 LOC | 8 | 0 | grep + script |
| Componenti >300 LOC | ~13 | ≤3 | grep + script |
| LOC totali UI custom | ~15.000 | ~10.000 (-33%) | cloc |
| Componenti shadcn morti | 26 | 0 (eliminati o riservati) | grep import |
| `window.dispatchEvent` | 5 | 0 | grep |
| `sessionStorage` transfer | 1 | 0 | grep |
| `setInterval` in UI | ≥6 | ≤3 | grep |
| Empty state inline | ~14 | 0 (tutti `EmptyState`) | grep |
| Mix IT/EN in stessa vista | ~20 | 0 | code review |
| Lighthouse Performance | ? | ≥80 | Lighthouse |
| Test totali | 207 | ≥250 | vitest |
| Bundle gzipped | ? | ≤300KB | bundle-analyzer |

### 10.2 Metriche qualitative

- **Tempo per completare task "Approva azione bloccata"**: da 3 click a 1 click (modal auto-popup con snooze non invadente).
- **Tempo per completare task "Installa un tool"**: da 3 click a 2 click (sidebar diretta a `/ecosystem`).
- **Onboarding completion rate**: target ≥80% (misurato via `localStorage.onboarding_completed`).
- **Error rate utente**: target -50% (misurato via future Fase 5 Sentry, posticipata).

---

## 11. Out of scope (esplicitamente esclusi)

I seguenti elementi NON fanno parte di questo piano di ristrutturazione UI/UX:

1. **Fase 5 — Observability** (Sentry, Prometheus, Jaeger, OpenTelemetry): già posticipata, documentata in `FASE-5-OSSERVABILITA.md`.
2. **Backend API refactor**: le 41 API routes restano invariate. Solo il consumo lato UI cambia.
3. **Database schema**: i 4 nuovi modelli Prisma di Fase 4 (Skill, McpConnection, ExternalTool, ToolExecutionLog) restano invariati.
4. **Nuove feature funzionali**: nessuna nuova capability, solo consolidamento di quelle esistenti.
5. **Mobile native app**: l'app resta web responsive, niente PWA installabile in questo sprint.
6. **Real-time collaboration multi-utente**: escluso, anche se l'architettura WebSocket lo supporterebbe.
7. **Templating/branding custom per tenant**: escluso, si valuta in Fase 6 (SaaS multi-tenant).
8. **A/B testing infrastructure**: escluso, si valuta in Fase 6.
9. **Storybook**: si valuta post-Sprint 5 se i componenti condivisi sono stabilizzati.
10. **Migration a Tailwind v5 o Next.js 17**: escluso, si resta su stack attuale (Tailwind v4, Next.js 16).

---

## Appendice A: Mappatura file pre → post refactor

### File da eliminare
- `src/components/agentic/branding-showcase.tsx` (orfano)
- `src/lib/i18n.ts` (Opzione B)
- `src/lib/use-i18n.ts` (Opzione B)
- `src/components/ui/{accordion,alert-dialog,aspect-ratio,breadcrumb,calendar,carousel,chart,checkbox,collapsible,command,context-menu,drawer,form,hover-card,input-otp,menubar,navigation-menu,pagination,popover,radio-group,sidebar,slider,sonner,table,toggle-group}.tsx` (26 morti — salvo riservati per Sprint 2-5)
- `src/components/agentic/phase{1..14}.tsx` (dopo migrazione a domini, mantenuti come `_legacy/` finché validati)

### File da creare
- `src/lib/design-tokens.ts`
- `src/lib/stores/{data-store,console-store,transfer-store,ui-store}.ts`
- `src/components/shared/{EmptyState,RefreshButton,EntityList,EntityForm,KVList,TagBadge,StatCard,SectionCard,ConfirmDialog}.tsx`
- `src/components/console/{ConsoleHeader,MessageList,MessageBubble,ConsoleInput,ConsoleSuggestions,ConsoleWelcome}.tsx`
- `src/components/onboarding/onboarding-tour.tsx`
- `src/components/blocked-action/{BlockedActionCard,BlockedActionList,BlockedActionInspector,BlockedActionModal,blocked-action-styles}.tsx`
- `src/components/cockpit/{CockpitContainer,NarrativeTab,LogTab,SchedulerTab,CyclesTab,SafetyTab}.tsx`
- `src/components/canvas/{CanvasContainer,DynamoCanvas,ObjectiveCanvas,LeanCanvas,CanvasToolbar}.tsx`
- `src/components/domains/memory-context/{MemoryContextContainer,EpisodicMemoryTab,ContextManagerTab,ModelEncapsulatorTab}.tsx`
- `src/components/domains/plan-execute/{PlanExecuteContainer,PlannerTab,SteeringTab,ObjectiveTab}.tsx`
- `src/components/domains/verify-trust/{VerifyTrustContainer,LtlTaintTab,TraceValidatorTab,FormalVerifierTab,SwarmTab}.tsx`
- `src/components/domains/learn-route/{LearnRouteContainer,ReflectiveTab,AffectTab,RouterTab,RetainerTab}.tsx`
- `src/app/inspect/[domain]/page.tsx`
- `src/app/ecosystem/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/onboarding/page.tsx`
- `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/loading.tsx`
- `src/middleware.ts`

### File da modificare pesantemente
- `src/app/page.tsx` (routing-aware)
- `src/app/layout.tsx` (rimozione i18n se Opzione B)
- `src/components/agentic/sidebar.tsx` (4 sezioni)
- `src/components/agentic/topbar.tsx` (breadcrumb + titolo)
- `src/components/agentic/agent-console.tsx` (decomposizione, ≤150 LOC)
- `src/components/workbench/workspace-views.tsx` (route-aware)
- `src/components/workbench/canvas-view.tsx` (decomposizione, ≤100 LOC)
- `src/components/workbench/sovereign-view.tsx` (refactor, ≤200 LOC)
- `src/components/agentic/cockpit.tsx` (decomposizione, ≤100 LOC)
- `src/components/agentic/tool-manager.tsx` (route `/ecosystem`)
- `src/lib/store.ts` (estensione con URL sync)

### File invariati
- Tutte le API routes in `src/app/api/`
- `src/lib/kernel/*` (tutto il backend kernel)
- `src/lib/auth/*`
- `prisma/schema.prisma`
- `src/components/ui/{button,badge,card,input,label,textarea,scroll-area,tabs,select,progress,dialog,switch,toast,avatar,dropdown-menu,resizable,separator,sheet,skeleton,toaster,toggle,tooltip}.tsx` (22 usati)

---

## Appendice B: Glossario dei termini

- **Dominio**: raggruppamento di fasi architetturali correlate (4 totali: Memory & Context, Plan & Execute, Verify & Trust, Learn & Route).
- **Fase architetturale**: sottosistema del kernel SOTA (14 totali, ex phase1-phase14).
- **Vista core**: modalità di visualizzazione trasversale (5 totali: Console, Canvas, Timeline, Cockpit, Sovereign).
- **Inspector**: pannello di dettaglio context-aware (Node, Log, Blocked, Phase, Help).
- **Context panel**: pannello laterale destro resizable, mostra QuickStats o Inspector phase-aware.
- **Command palette**: overlay Cmd+K con 33+ comandi statici e fuzzy search.
- **HITL**: Human-In-The-Loop, azioni che richiedono approvazione umana (Sovereign).

---

> **Nota finale**: Questo piano è una capsula di pianificazione. Ogni sprint ha criteri di accettazione binari e rollback plan. L'implementazione può iniziare immediatamente dopo approvazione, sprint per sprint, con demo end-of-sprint per validare prima di proseguire. Tempo totale stimato: **22 giorni lavorativi** (~4-5 settimane con buffer).
