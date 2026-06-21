# SOTA Agentic OS — Documentazione UI/UX

> **Versione documento:** 1.0
> **Data:** 21 giugno 2026
> **Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind CSS v4 · shadcn/ui (new-york) · Radix Primitives · lucide-react · next-themes · socket.io-client
> **Lingua UI:** Italiano (con toggle EN)
> **Tagline:** "INTELLIGENT · SECURE · AUTONOMOUS — 23 fasi · kernel transazionale + LTL + ERL + Lean4 + Sovereign + Cockpit"

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Architettura UI e Stack](#2-architettura-ui-e-stack)
3. [Design System](#3-design-system)
4. [Shell Applicativa](#4-shell-applicativa)
5. [Login Page](#5-login-page)
6. [Sidebar e MobileNav](#6-sidebar-e-mobilenav)
7. [Topbar](#7-topbar)
8. [Dashboard / Overview](#8-dashboard--overview)
9. [Console Agentica](#9-console-agentica)
10. [Cockpit](#10-cockpit)
11. [Tool Manager](#11-tool-manager)
12. [Sovereign Modal](#12-sovereign-modal)
13. [LTL & Normative Editor](#13-ltl--normative-editor)
14. [Moduli di Fase (1-14)](#14-moduli-di-fase-1-14)
15. [Componenti Condivisi](#15-componenti-condivisi)
16. [Hook Condivisi](#16-hook-condivisi)
17. [Pattern UX Trasversali](#17-pattern-ux-trasversali)
18. [Accessibilità](#18-accessibilità)
19. [Internazionalizzazione](#19-internazionalizzazione)
20. [Osservazioni e Raccomandazioni](#20-osservazioni-e-raccomandazioni)

---

## 1. Introduzione

**SOTA Agentic OS** è un sistema operativo agentico web che fornisce una plancia di comando unificata per gestire agenti autonomi con un kernel transazionale, verifica formale LTL, validazione Lean4, validator umano (Sovereign) e un ecosystem di tool firmati ECDSA. L'applicazione è strutturata come una Single Page Application costruita su Next.js App Router in cui la navigazione avviene lato client tramite uno store Zustand che mantiene la `activePhase` corrente.

### Moduli principali dell'applicativo

L'interfaccia è organizzata gerarchicamente in sei macro-aree:

| Macro-area | Moduli inclusi |
|---|---|
| **Core** | Dashboard, Console Agentica, Cockpit |
| **Foundation** | Phase 1 (Memory & State), Phase 6 (Context Manager) |
| **Orchestration** | Phase 2 (Planner & Compiler), Phase 7 (Trace Validator), Phase 12 (Objective Builder) |
| **Cognitive** | Phase 3 (Cognitive Steering), Phase 10 (Model Encapsulator), Phase 11 (Affect Monitor) |
| **Trust** | Phase 4 (Verification & Taint), Phase 8 (Formal Verifier), Phase 13 (Swarm Coherence) |
| **Learning** | Phase 5 (Reflective Learning) |
| **Governance** | Phase 9 (Human Retainer), Tool Manager |
| **Infrastructure** | Phase 14 (Model Router) |

In totale, sono **18 voci di navigazione** (3 core + 14 fasi + Tool Manager) più una schermata di login separata.

### Filosofia di design

L'interfaccia adotta una estetica **devtool/IDE-like** con:

- **Densità informativa elevata** — font piccoli (10–13px), padding contenuti, molte informazioni per schermata.
- **Monospace per dati tecnici** — IDs, formule LTL, JSON, token count, versioni e signature sono sempre in `font-mono` per allineamento tabulare e leggibilità.
- **Color coding semantico coerente** — emerald (success/pass), sky (info/running), amber (warn/blocked/pending), red (error/failed/reject/irreversibile), violet (reflect/ensemble), zinc (neutral).
- **Branding cinematografico** — palette navy `#0a0a2e` + viola `#3a1e6a` + ciano `#00d4ff` per la login, mentre l'app autenticata usa token Tailwind con brand primary **viola indaco** (`oklch(0.45 0.18 270)`).
- **Dark mode first-class** — next-themes con `attribute="class"`, default light, OS-aware, tutte le classi di colore hanno variante `dark:`.
- **Italian-first copy** — tutti i label, toast e empty state sono in italiano; toggle EN disponibile nel topbar.

---

## 2. Architettura UI e Stack

### Stack tecnologico

| Strato | Tecnologia |
|---|---|
| **Framework** | Next.js 16 (App Router, RSC + Client Components) |
| **Lingua** | TypeScript |
| **Styling** | Tailwind CSS v4 (`@theme inline`, OKLCH) + utility classes |
| **UI Primitives** | shadcn/ui (stile `new-york`), Radix UI primitives |
| **Iconografia** | `lucide-react` (17 icone whitelistate + molte altre) |
| **State globale** | Zustand (`@/lib/store` — `activePhase`, `setActivePhase`) |
| **Real-time** | `socket.io-client` (namespace `/` con query param `XTransformPort=3003`) |
| **Temi** | `next-themes` (`attribute="class"`, `defaultTheme="light"`, `enableSystem`) |
| **Toast** | shadcn Radix Toast (attivo) + Sonner (definito ma non montato) |
| **Font** | Geist Sans + Geist Mono via `next/font/google` |
| **Grafici DAG** | `reactflow` con Background, Controls, MiniMap |
| **i18n** | Sistema custom zero-dependency (IT/EN) |
| **Auth** | Cookie session + `/api/auth` (GET status, POST login/logout) |
| **Database** | Prisma + SQLite (`db/custom.db`) |

### Struttura del routing client-side

L'app è una SPA: una volta autenticati, l'utente atterra su `/` dove il componente `page.tsx` legge `activePhase` dallo store Zustand e renderizza il componente corretto. Non ci sono route multiple se non `/login` e `/`. Questo significa:

- **Nessun caricamento pagina** tra le navigazioni — tutto è istantaneo.
- **Lo stato UI persiste** tra le navigazioni (es. scroll position di una lista, filtri impostati, form parzialmente compilati).
- **Lo state lato server va rifetchato** quando si torna su un modulo (nessun cache automatico, ma i dati restano in memoria finché il componente è montato).

### Layout shell

```
┌─────────────────────────────────────────────────────────┐
│ Topbar (h-14, brand + theme/lang/user)                  │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│          │                                              │
│ Sidebar  │            Main content                      │
│ (w-56 /  │   (activePhase component)                    │
│  w-14)   │                                              │
│          │                                              │
│          │                                              │
├──────────┴──────────────────────────────────────────────┤
│ Footer (hidden on console): "SOTA Agentic OS · 23 fasi" │
└─────────────────────────────────────────────────────────┘
```

Su mobile (< 768px), la sidebar viene sostituita da una `MobileNav` sticky in alto che apre un dropdown a tutto schermo.

---

## 3. Design System

### 3.1 Sistema di colori (OKLCH)

Il design system è definito interamente in `src/app/globals.css` usando la sintassi Tailwind v4 `@theme inline` con valori **OKLCH** per una gamma cromatica più ampia e percepita uniformemente.

#### Brand palette (login e branding showcase)

| Colore | Hex | Uso |
|---|---|---|
| Background dark | `#0a0a2e` | Pannello sinistro login, tile branding |
| Purple | `#3a1e6a` | Accento secondario |
| Accent blue | `#00d4ff` | Ciano brand, link, highlight |
| White | `#ffffff` | Testo su sfondo scuro |
| Silver | `#c0c0c0` | Testo secondario su sfondo scuro |

#### App palette (token Tailwind, light mode)

| Token | Valore OKLCH | Descrizione |
|---|---|---|
| `--background` | `oklch(0.99 0.001 250)` | Quasi bianco, leggermente cool |
| `--foreground` | `oklch(0.18 0.02 260)` | Quasi nero, cool |
| `--card` | `oklch(1 0 0)` | Bianco puro per le card |
| `--primary` | `oklch(0.45 0.18 270)` | **Viola indaco** — colore brand principale |
| `--primary-foreground` | `oklch(0.98 0.002 250)` | Testo su primary |
| `--secondary` / `--muted` | `oklch(0.96 0.005 260)` | Superfici secondarie |
| `--muted-foreground` | `oklch(0.52 0.012 260)` | Testo secondario |
| `--accent` | `oklch(0.95 0.008 260)` | Hover/selection |
| `--destructive` | `oklch(0.55 0.22 25)` | Rosso caldo per errori |
| `--border` | `oklch(0.92 0.004 260)` | Bordi sottili |
| `--ring` | `oklch(0.45 0.18 270)` | Mirrors primary |
| `--sidebar` | `oklch(0.98 0.002 260)` | Sfondo sidebar |

#### Dark mode tokens

| Token | Valore OKLCH | Note |
|---|---|---|
| `--background` | `oklch(0.14 0.015 260)` | Carbone cool profondo |
| `--card` / `--popover` | `oklch(0.18 0.018 260)` | Superficie elevata |
| `--primary` | `oklch(0.60 0.20 270)` | Viola più luminoso per contrasto |
| `--border` | `oklch(1 0 0 / 8%)` | Bianco traslucido |
| `--input` | `oklch(1 0 0 / 12%)` | Bianco traslucido più visibile |
| `--sidebar` | `oklch(0.16 0.018 260)` | Leggermente più scuro del bg |

#### Palette chart (data viz)

```
--chart-1: oklch(0.55 0.20 270)  → viola
--chart-2: oklch(0.60 0.15 200)  → ciano
--chart-3: oklch(0.65 0.18 150)  → verde
--chart-4: oklch(0.70 0.18 60)   → ambra
--chart-5: oklch(0.60 0.20 350)  → magenta
```

I 5 colori coprono l'intero wheel hue per disambiguare serie multiple nei grafici.

#### Colori semantici (categoriaspecifici)

Oltre ai token Tailwind, il codice applica convenzioni colore coerenti per categorie e stati:

| Categoria fase | Colore | Esempio uso |
|---|---|---|
| `core` | primary (viola) | Dashboard, Console, Cockpit |
| `foundation` | sky | Memory, Context Manager |
| `orchestration` | emerald | Planner, Trace Validator, Objective Builder |
| `cognitive` | violet | Cognitive Steering, Model Encapsulator, Affect Monitor |
| `trust` | red | Verification, Formal Verifier, Swarm Coherence |
| `learning` | amber | Reflective Learning |
| `governance` | pink | Human Retainer, Tool Manager |
| `infrastructure` | cyan | Model Router |

Questi colori vengono applicati all'icona dell'header di fase, all'etichetta di categoria nella sidebar e nella architecture map, e ai dot di stato.

### 3.2 Tipografia

| Famiglia | Font | Caratteristiche OpenType |
|---|---|---|
| Sans (body) | Geist Sans | `cv01, cv03, cv04, cv11` (alternate glyphs) |
| Mono (dati) | Geist Mono | — |

**Scale di dimensioni (Tailwind defaults usati):**

| Class | px | Uso tipico |
|---|---|---|
| `text-lg` | 18px | Page heading (PhaseHeader title, Dialog title) |
| `text-base` | 16px | Raramente usato |
| `text-sm` | 14px | Body text, button label, toast title |
| `text-xs` | 12px | Badge, descrizioni, empty state, label KPI |
| `text-[11px]` | 11px | Dettagli tecnici, hint |
| `text-[10px]` | 10px | Mono IDs, filename, timestamp, label categoria |
| `text-[9px]` | 9px | Hex colori branding, tag mono piccoli |

**Pesi:** `font-medium` (500) per button/badge, `font-semibold` (600) per card title/dialog title/toast title. `font-bold` (700) solo per valori KPI mono e badge status.

**Numeri tabulari:** `tabular-nums` su tutti i valori KPI e badge contatore per evitare jitter quando i numeri cambiano.

### 3.3 Spaziature e layout

| Token | Valore | Uso |
|---|---|---|
| `--radius` | `0.5rem` (8px) | Base radius |
| radius-sm | 4px | Elementi piccoli |
| radius-md | 6px | Elementi medi (button default) |
| radius-lg | 8px | Card, dialog |
| radius-xl | 12px | Card rounded-xl, result card |

**Altezze standard componente:**
- Button: `h-8` (sm), `h-9` (default), `h-10` (lg), `size-9` (icon)
- Sidebar: `w-56` espansa / `w-14` collassata / `w-72` mobile
- Topbar: `h-14`
- ScrollArea: `h-72` (piccola), `h-80` (media), `h-96` (grande), `h-[28rem]` (audit ledger phase 9)

**Breakpoint responsive:**

| Breakpoint | px | Comportamento |
|---|---|---|
| `sm` | 640 | Toggle 1-col → 2-col |
| `md` | 768 | Sidebar desktop/mobile switch, KPI grid 4-col |
| `lg` | 1024 | Sidebar espansa default, grid 7-col architettura |
| `xl` | 1280 | Max-width content `max-w-7xl` |

### 3.4 Componenti shadcn/ui installati

L'app ha installato l'intero catalogo shadcn/ui (new-york variant). I principali usati sono:

| Componente | Varianti | Uso principale |
|---|---|---|
| `Button` | default, destructive, outline, secondary, ghost, link + sizes sm/default/lg/icon | Ogni azione |
| `Card` + subcomponents | — | Layout phase, result card, KPI |
| `Badge` | default, secondary, destructive, outline | Status, IDs, tag |
| `Input` / `Textarea` | — | Form controls |
| `Label` | — | Form labels |
| `Select` | — | Dropdown |
| `Switch` | — | Toggle permission, auto-summarize |
| `Tabs` | — | Moduli multi-tab (cockpit, tool manager, fasi) |
| `ScrollArea` | — | Liste scrollabili con h fissa |
| `Dialog` | con `showCloseButton?: boolean` | Sovereign Modal |
| `Progress` | — | Token budget, affect gauge, complexity bar |
| `Tooltip` | — | Sidebar collassata hover |
| `DropdownMenu` | — | User menu nel topbar |
| `Toast` (Radix) | default, destructive | Toast attivo |
| `Sonner` | — | Definito ma non montato |
| `Sheet` | — | Sidebar mobile |
| `Sidebar` (primitives) | sidebar/floating/inset + offcanvas/icon/none | Sidebar shell (custom, non usato direttamente) |

### 3.5 Dark mode

- **Libreria:** `next-themes` ThemeProvider in `layout.tsx` con `attribute="class"`, `defaultTheme="light"`, `enableSystem`, `disableTransitionOnChange`.
- **CSS:** `@custom-variant dark (&:is(.dark *))` (Tailwind v4 syntax).
- **Hydration:** `<html suppressHydrationWarning>` per gestire il flash di tema.
- **Toggle:** icon button nel topbar (Sun/Moon), solo dopo `mounted` per evitare mismatch SSR.
- **Pattern colore dark:** tutte le classi semantiche hanno `dark:` variant. Esempi:
  - `text-emerald-600 dark:text-emerald-400`
  - `bg-amber-50 dark:bg-amber-950/10`
  - `dark:bg-destructive/60` (ammorbidisce il rosso in dark)
  - `dark:bg-input/30 dark:border-input` per outline variant

### 3.6 Animazioni custom

```css
[data-state="active"][role="tab"] { transition: color 0.15s ease; }
main > div { animation: fadeIn 0.15s ease; }
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
```

- Fade-in al cambio di fase (0.15s).
- Transizione colore sui tab attivi.
- Tutte le altre animazioni derivano da `tailwindcss-animate` (plugin ancora attivo): `animate-in`, `animate-out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`.

### 3.7 Scrollbar custom

Scrollbar thin (6×6 px) con thumb traslucido:
```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: oklch(0.5 0 0 / 0.3); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: oklch(0.5 0 0 / 0.5); }
```

### 3.8 Toast system

**Situazione attuale (doppia implementazione):**

1. **shadcn Radix Toast** (`use-toast.ts` + `toast.tsx` + `toaster.tsx`) — **attivo**, montato in `layout.tsx`.
   - `TOAST_LIMIT = 1` (un toast alla volta)
   - `TOAST_REMOVE_DELAY = 1000000` ms (~16 min, mai auto-rimossi)
   - Varianti: `default`, `destructive`
   - Posizione: top-full-width su mobile, bottom-right max 420px su desktop
   - Swipe-to-dismiss supportato

2. **Sonner** (`sonner.tsx`) — **definito ma non montato**.
   - Integrazione con next-themes
   - Map token popover → styling consistente

L'API usata nei componenti agentic è la prima (via `useToast()` o `toast()` imperativo). Solo la Console Agentica usa anche `sonner` importato direttamente (`toast.success/error` da `sonner`).

---

## 4. Shell Applicativa

### 4.1 Root Layout (`src/app/layout.tsx`)

Configura lo shell HTML globale, font, theme provider e toaster.

```tsx
<html lang="it" suppressHydrationWarning>
  <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
    <Toaster />  {/* shadcn Radix toaster */}
  </body>
</html>
```

**Metadata SEO/branding:**
- Title: "SOTA Agentic OS — Sistema Operativo Agentico"
- Description: "INTELLIGENT · SECURE · AUTONOMOUS — 23 fasi · kernel transazionale + LTL + ERL + Lean4 + Sovereign + Cockpit"
- Keywords: Agentic OS, LTL, ACTS, ERL, Lean4, Sovereign Validator, Cockpit, Tool Ecosystem
- Favicon: `/favicon-32.png`, `/favicon.ico`
- OG image: `/og-image.png` (1200×630)

### 4.2 Home page router (`src/app/page.tsx`)

Componente client che:
1. Verifica autenticazione (`fetch /api/auth` → redirect `/login` se non autenticato)
2. Renderizza la shell: `<Sidebar />` + `<MobileNav />` + `<Topbar />` + `<main>` + `<Footer />`
3. Legge `activePhase` dallo store Zustand e renderizza il componente corretto
4. Monta `<SovereignModalContainer />` per gestire globalmente i blocked actions

**Phase router (switch condizionale):**
```tsx
{activePhase === 'overview' && <Overview />}
{activePhase === 'console' && <AgentConsole />}     // layout flex-col, footer hidden
{activePhase === 'cockpit' && <Cockpit />}
{activePhase === 'phase1' && <Phase1 />}
// ... phase2 .. phase14
{activePhase === 'tools' && <ToolManager />}
```

**Footer (hidden per Console):**
```tsx
<footer className="border-t px-4 py-2 text-[10px] text-muted-foreground bg-background/50 flex justify-between">
  <span>SOTA Agentic OS · 23 fasi + 3 trasversali</span>
  <span className="font-mono">v0.6.0</span>
</footer>
```

---

## 5. Login Page

Il login (`src/app/login/page.tsx`) è una schermata split a due pannelli che adotta un'estetica **cinematografica** distinta dal resto dell'app.

### Layout

```
┌──────────────────────────┬──────────────────────────┐
│                          │                          │
│   Pannello brand (50%)   │   Pannello form (50%)    │
│   - bg #0a0a2e           │   - bg-background        │
│   - banner.png op-30     │   - max-w-sm             │
│   - grid CSS overlay     │   - form login           │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

Su mobile, il pannello brand viene nascosto (`hidden lg:flex lg:w-1/2`) e il form occupa tutto lo schermo.

### Pannello brand (sinistro)

- Sfondo `bg-[#0a0a2e]` con `/banner.png` come background image `opacity-30`
- Overlay gradient `from-[#0a0a2e]/80 via-[#0a0a2e]/60 to-[#0a0a2e]/90`
- **Grid CSS decorativa** — linee `#00d4ff22` celle 40px `opacity-5` per estetica sci-fi/OS
- **Top**: SOTA logo (`/logo-transparent.png`, `size-12`) + "SOTA Agentic OS" + label "Operating System"
- **Headline**: "Il sistema operativo" + span ciano "per agenti autonomi" (4xl bold)
- **Subhead**: "23 fasi operative · kernel transazionale · verifica formale LTL · Lean4 · Sovereign Validator · Tool Ecosystem con ECDSA"
- **Pill tag mono**: `LTL · Lean4 · ERL · ESR · ACTS · ECDSA` (bordered `border-white/20`)
- **Footer**: "INTELLIGENT · SECURE · AUTONOMOUS"

### Pannello form (destro)

- Heading "Accedi" (2xl bold) + subtext
- **Email field**: icon `<Mail>` prefix, `pl-10 h-11`, prefilled `admin@sota-os.local`
- **Password field**: icon `<Lock>` prefix, show/hide toggle (`<Eye>`/`<EyeOff>`), prefilled `admin123`
- **Submit button** `w-full h-11`:
  - Idle: "Accedi →" con `<ArrowRight>`
  - Loading: `<Loader2 animate-spin>` "Accesso in corso…"
- **Demo hint**: "Credenziali demo: admin@sota-os.local / admin123" in `<code>`
- **Footer**: "INTELLIGENT · SECURE · AUTONOMOUS" in `text-[10px]`

### Interazioni

- Enter-to-submit su entrambi i campi
- Password show/hide con eye toggle
- Loading state con spinner
- Toast feedback (`Benvenuto, ${name}` o errore)
- Auto-redirect a `/` se già autenticati (useEffect al mount)
- Logout → redirect `/login`

---

## 6. Sidebar e MobileNav

Il componente `src/components/agentic/sidebar.tsx` espone sia la sidebar desktop che la MobileNav.

### 6.1 Sidebar desktop

- `aside` `hidden md:flex`, `w-14` (collassata) o `w-56` (espansa), `transition-all duration-200`
- **Header** (`h-14 border-b`): logo `/logo-transparent.png` (`size-8 rounded`) + "SOTA OS" small caps + "AGENTIC" 8px uppercase tracking-wider. Collassata → solo logo.
- **Nav** (`flex-1 overflow-y-auto py-3`): itera `CATEGORY_ORDER` (8 categorie in ordine fisso).
- **Footer** (`border-t p-1.5`): toggle collapse button (`<PanelLeftClose>` ↔ `<PanelLeft>`).

#### Items di navigazione (18 totali)

| Categoria | Items |
|---|---|
| **core** | Dashboard (LayoutDashboard), Console (Terminal), Cockpit (Gauge) |
| **foundation** | P1 Memory & State (Database), P6 Context Manager (Scissors) |
| **orchestration** | P2 Planner & Compiler (Workflow), P7 Trace Validator (GitFork), P12 Objective Builder (Target) |
| **cognitive** | P3 Cognitive Steering (Compass), P10 Model Encapsulator (Boxes), P11 Affect Monitor (HeartPulse) |
| **trust** | P4 Verification & Taint (ShieldCheck), P8 Formal Verifier (FunctionSquare), P13 Swarm Coherence (Network) |
| **learning** | P5 Reflective Learning (Sparkles) |
| **governance** | P9 Human Retainer (UserCog), Tool Manager (Package) |
| **infrastructure** | P14 Model Router (Shuffle) |

#### Stato attivo e hover

```tsx
<button className={cn(
  'w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
)}>
  <Icon className="size-4 shrink-0" />
  <span className="text-[13px] leading-tight truncate">{p.name}</span>
</button>
```

Quando collassata: solo icona centrata, `title` attributo mostra il nome su hover.

#### Badge live (status indicators)

Pill colorate sulla destra (`ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold text-white`):

| Modulo | Badge | Colore | Significato |
|---|---|---|---|
| `phase9` | pending gates count | amber `bg-amber-500` | Gates in attesa |
| `phase11` | interventions count | red `bg-red-500` | Interventi meta-observer |
| `phase4` | verification rejects | red `bg-red-500` | Verifiche fallite |
| `cockpit` | blocked pending | red `bg-red-500` | Azioni bloccate in coda |

Modalità collassata: piccolo dot `size-1.5 rounded-full` all'angolo top-right dell'icona.

### 6.2 MobileNav

- `md:hidden border-b bg-sidebar sticky top-0 z-40`
- Trigger button mostra icona fase corrente + mini logo + nome + `<ChevronDown>` (ruota 180° quando aperto)
- Apre dropdown `absolute left-0 right-0 ... max-h-[70vh] overflow-y-auto shadow-lg` con tutte le categorie
- Label categoria: `text-[9px] font-bold uppercase tracking-wide` colorate per categoria
- Backdrop `fixed inset-0 z-30` per chiudere su outside-click

---

## 7. Topbar

Il componente `src/components/agentic/topbar.tsx` è un header compatto 56px (`h-14`).

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Page Title           [🌙] [IT▼] [👤 Admin ▼]            │
└─────────────────────────────────────────────────────────┘
```

### Sezione sinistra: page title

```tsx
<h2 className="text-sm font-semibold text-muted-foreground truncate">
  {activePhase === 'overview' ? 'Dashboard' : currentPhase.name}
</h2>
```

### Sezione destra: controlli (3 button)

1. **Theme toggle** (`size-8` button, solo dopo `mounted`):
   - Dark attivo → `<Sun>` per switchare a light
   - Light attivo → `<Moon>` per switchare a dark
   - `setTheme(theme === 'dark' ? 'light' : 'dark')`

2. **Language toggle** (`h-8 px-2` button):
   - Mostra `lang.toUpperCase()` (IT/EN)
   - `setLang(lang === 'it' ? 'en' : 'it')`
   - Persistente in `localStorage('sota_lang')`

3. **User dropdown** (solo se `user` presente):
   - Trigger: avatar `/avatar.png` (`size-6 rounded-full`) + nome/email prefix + `<ChevronDown>`
   - `<DropdownMenuContent align="end" className="w-52">`:
     - Header: name (sm font-medium) + email (xs muted)
     - Separator
     - Logout item (`text-red-600 dark:text-red-400`) con `<LogOut>` icon

### Flusso auth

```tsx
useEffect(() => {
  fetch('/api/auth').then(r => r.json()).then(d => d.authenticated && setUser(d.user))
}, [])

function logout() {
  fetch('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) })
  router.push('/login')
}
```

---

## 8. Dashboard / Overview

Il componente `src/components/agentic/overview.tsx` è la home autenticata.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ "N eventi registrati"          [Aggiorna] [Inizializza] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│            Architecture Map (7-col grid)                │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│            Category KPIs (7-col grid)                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│            Live Feed (real-time WS)                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Container: `space-y-6 sm:space-y-8 max-w-7xl mx-auto` con padding `p-4 sm:p-6 lg:p-8`.

### Stati

#### Loading skeleton

```tsx
{skeleton ? (
  <>
    <div className="h-6 w-32 bg-muted animate-pulse rounded" />
    <div className="h-48 bg-muted animate-pulse rounded-lg" />
  </>
) : null}
```

#### Empty state

Quando il sistema non è inizializzato (`phase1.episodic === 0 && phase2.plans === 0 && phase4.verificationEvents === 0`):
- Messaggio: "Sistema non inizializzato"
- Bottone "Inizializza" (`<Rocket>`) → POST `/api/seed` → toast "Sistema inizializzato" + refresh

#### Stato popolato

- Messaggio: "{N} eventi registrati" (da `data.agentLogsTotal`)
- Solo bottone "Aggiorna" (`<RefreshCw>`)

### Sottocomponenti inclusi

1. **`<ArchitectureMap />`** — mappa visuale navigabile di tutte le 14 fasi organizzate per categoria (vedi §15.1)
2. **`<CategoryKpis data={data} />`** — griglia 7-col di KPI compatti (vedi §15.2)
3. **`<LiveFeed />`** — stream real-time di eventi da WebSocket Sensorium (vedi §15.3)

---

## 9. Console Agentica

Il componente `src/components/agentic/agent-console.tsx` è l'interfaccia conversazionale ChatGPT-style che orchestrazione l'esecuzione di task via LLM.

### 9.1 Layout generale

```tsx
<div className="flex flex-col h-full min-h-0">
  {/* Conversation thread (scrollable) */}
  <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain min-h-0">
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {messages.length === 0 ? <WelcomeScreen /> : <MessageList />}
      {executing && <LiveExecutionBubble />}
    </div>
  </div>

  {/* Input bar (sticky bottom) */}
  <div className="border-t bg-background/95 backdrop-blur shrink-0">
    <div className="max-w-3xl mx-auto p-2 sm:p-3">
      <InputBar />
    </div>
  </div>
</div>
```

Il footer dell'app viene nascosto quando la Console è attiva per massimizzare lo spazio verticale.

### 9.2 Welcome screen (empty state)

Quando `messages.length === 0`:
- Centro schermo con logo brand `/logo-transparent.png` (`size-10 sm:size-12`)
- Titolo "Console Agentica"
- Subtitle che descrive il flusso PLAN → EXECUTE → LTL → reflection
- **Suggestion grid** (`grid grid-cols-1 sm:grid-cols-2 gap-2`): 4 chip cliccabili con icone lucide:

| Suggerimento | Icona | Descrizione esempio |
|---|---|---|
| Pianifica un task | `<Brain>` | "Analizza le metriche Q3 e produci un report" |
| Verifica un'azione | `<Shield>` | "Controlla se posso eseguire un deploy in produzione" |
| Esegui rapidamente | `<Zap>` | "Genera una funzione fibonacci in Python" |
| Debug | `<Terminal>` | "Trova il bug in questo snippet di codice" |

Ogni chip è un button `text-left p-3 rounded-xl border hover:border-primary/30 hover:bg-accent/30 transition-all group`. Click → `send(s.desc)` (bypassa la textarea).

### 9.3 Message bubbles

#### User bubble (destra)

```tsx
<div className="flex justify-end">
  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2">
    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
  </div>
</div>
```

#### Assistant bubble (sinistra, con avatar brand)

```tsx
<div className="flex items-start gap-3">
  <img src="/avatar.png" alt="" className="size-8 rounded-full object-cover shrink-0 border border-border" />
  <div className="flex-1 min-w-0 space-y-3">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Agente</span>
      <span className="text-[10px] text-muted-foreground">{time}</span>
    </div>
    <p className="text-sm break-words ...">{msg.content}</p>
    {msg.errors && <ErrorList errors={msg.errors} />}
    {msg.result && <ResultCard result={msg.result} />}
  </div>
</div>
```

### 9.4 Live execution bubble

Quando `executing === true`, viene appeso un bubble animato dopo gli altri messaggi:

```tsx
<div className="flex items-start gap-3">
  <div className="relative shrink-0">
    <img src="/avatar.png" className="size-8 rounded-full ..." />
    <div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-primary flex items-center justify-center">
      <Loader2 className="size-2 animate-spin text-primary-foreground" />
    </div>
  </div>
  <div className="flex-1 min-w-0">
    <span>Agente</span><span>esecuzione in corso…</span>
    {liveLog.length > 0 && (
      <div className="rounded-lg bg-zinc-950 text-zinc-300 p-2.5 font-mono text-[10px] max-h-32 overflow-y-auto">
        {liveLog.map(line => <div key={...}>{line}</div>)}
      </div>
    )}
  </div>
</div>
```

Caratteristiche:
- Mini spinner overlay sull'avatar (badge bottom-right `size-3 rounded-full bg-primary`)
- Terminal-style log box sempre dark (`bg-zinc-950 text-zinc-300 font-mono text-[10px]`)
- Log line format: `[P{phase}] {agentId}: {event}`
- Cap a 50 entries
- Auto-scroll sul nuovo log

I log arrivano in tempo reale dal WebSocket Sensorium (hook `useSensoriumLive`). Solo l'evento più recente (`events[0]`) viene processato quando `executing === true`.

### 9.5 ResultCard (risultato espandibile)

Card bordata con header clickable:

#### Header (sempre visibile)

- Icona stato:
  - `allDone` → `<CheckCircle2>` emerald (verde)
  - `someFailed` → `<AlertTriangle>` amber
  - `allFailed` → `<XCircle>` red
- Testo goal
- Summary mono: `12/15 completati · 2 falliti · 1 bloccati · 4.2s`
- Chevron toggle (`<ChevronDown>` / `<ChevronRight>`)

#### Body espanso

1. **StepRow list** — una riga per ogni task eseguito (vedi §9.6)
2. **Error rows** per task falliti (`border-red-500/20 bg-red-50 dark:bg-red-950/10`)
3. **LTL violation rows** (`border-amber-500/20 bg-amber-50 dark:bg-amber-950/10`) con lista puntata delle violazioni
4. **DAG toggle button**: "Mostra grafo DAG" / "Nascondi grafo DAG"
   - Container: `h-48 sm:h-64 border rounded-lg overflow-hidden`
   - Renderizza `<DynAMODagVisualizer>` (vedi §15.4)
5. **Reflection block** (in fondo):
   - Approvato → `<Sparkles>` emerald + euristica estratta in italico
   - Red Line attivata → `<AlertTriangle>` amber + motivo

### 9.6 StepRow (riga task espandibile)

```tsx
<div>
  <div className={cn('flex items-center gap-2 py-1',
    hasDetails && 'cursor-pointer hover:bg-accent/30 rounded')} onClick={toggle}>
    <Icon className={cn('size-3.5 shrink-0', config.color, step.status === 'running' && 'animate-spin')} />
    <span className="text-xs font-mono text-muted-foreground shrink-0 w-6">{step.taskId}</span>
    <span className="text-xs truncate flex-1 min-w-0">{step.description}</span>
    {StratIcon && <span><StratIcon className="size-2.5" />{step.strategy}</span>}
    <span className="text-[10px] font-mono">{(durationMs/1000).toFixed(1)}s</span>
    {ltlVerdict !== 'accept' && <span>LTL {ltlVerdict}</span>}
    {hasDetails && <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />}
  </div>
  {expanded && hasDetails && (
    <div className="ml-6 mt-1 mb-2 p-2.5 rounded-lg bg-muted/30 text-xs space-y-1 break-words">
      {/* result, error, suggestion */}
    </div>
  )}
</div>
```

#### Status icons e colori

| Status | Icon | Colore |
|---|---|---|
| `pending` | Clock | muted-foreground |
| `running` | Loader2 (spin) | sky-500 |
| `done` | CheckCircle2 | emerald-500 |
| `failed` | XCircle | red-500 |
| `blocked` | AlertTriangle | amber-500 |

#### Strategy icons

| Strategy | Icon |
|---|---|
| `PLAN` | Brain |
| `EXECUTE` | Zap |
| `CHECK` | Shield |
| `REFLECT` | Sparkles |
| `HALT` | AlertTriangle |

`hasDetails = (step.result && step.status !== 'done') || !!step.error` — i task `done` non sono espandibili.

### 9.7 ErrorList (errori strutturati)

Card colorate per ogni errore:

```tsx
<div className={cn('rounded-lg border p-3',
  err.recoverable ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/10'
                  : 'border-red-500/30 bg-red-50 dark:bg-red-950/10')}>
  <Icon className={cn('size-4 shrink-0 mt-0.5', err.recoverable ? 'text-amber-500' : 'text-red-500')} />
  <span>{err.phase}</span>
  <Badge variant="outline">{err.recoverable ? 'Ripristinabile' : 'Bloccante'}</Badge>
  <p>{err.message}</p>
  {err.suggestion && <p className="text-[11px] italic">→ {err.suggestion}</p>}
</div>
```

#### Icone errore per fase

| Fase | Icona |
|---|---|
| `plan_generation` | Brain |
| `steering` | Compass |
| `ltl_verification` | Shield |
| `task_execution` | Zap |
| `reflection` | Sparkles |
| `unknown` (network/HTTP) | AlertTriangle |

Le network failure vengono catturate e convertite in un messaggio assistant sintetico con errore `unknown` + suggestion "Riprova tra qualche secondo".

### 9.8 Input bar

```tsx
<div className="relative">
  <Textarea
    ref={inputRef}
    value={input}
    onChange={e => setInput(e.target.value)}
    onKeyDown={handleKeyDown}
    placeholder="Descrivi il task da eseguire…"
    className="min-h-[44px] max-h-[120px] resize-none pr-24 text-sm"
    rows={1}
  />
  <div className="absolute right-2 bottom-2 flex items-center gap-1">
    <Button variant="ghost" size="sm" onClick={() => send(input, true)}>Solo piano</Button>
    <Button size="icon" className="rounded-lg" disabled={!input || executing} onClick={() => send(input)}>
      {executing ? <Loader2 className="animate-spin" /> : <ArrowUp />}
    </Button>
  </div>
</div>
<p className="text-[10px] text-muted-foreground text-center hidden sm:block">
  Invio per eseguire · Shift+Invio per nuova riga
</p>
```

#### Comportamenti

- **Enter-to-send**: `if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }`
- **Shift+Enter** per nuova riga
- **Textarea auto-resize**:
  ```tsx
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])
  ```
  Reset a `auto` poi imposta `scrollHeight` capped a 120px (~5 righe).
- **Solo piano mode**: invia con `planOnly=true`, l'API risponde con "Piano generato: N task in M batch" invece di eseguire
- **Send button**: `bg-primary text-primary-foreground` quando abilitato, `bg-muted text-muted-foreground` quando disabilitato

### 9.9 State management

```tsx
const [messages, setMessages] = useState<Message[]>([])
const [input, setInput] = useState('')
const [executing, setExecuting] = useState(false)
const [liveLog, setLiveLog] = useState<string[]>([])
const scrollRef = useRef<HTMLDivElement>(null)
const inputRef = useRef<HTMLTextAreaElement>(null)
const executingRef = useRef(false) // ref to prevent stale closure
```

`executingRef` mirror di `executing` per evitare stale-closure nell'async `send()` closure.

#### Generazione ID

A causa dell'assenza di Secure Context nel Preview Panel (che rompe `crypto.randomUUID()`), gli ID vengono generati custom:

```tsx
let idCounter = 0
function genId() {
  idCounter++
  return `msg-${Date.now()}-${idCounter}`
}
```

### 9.10 Mobile responsiveness

- `max-w-3xl mx-auto` per centrare il thread
- Padding scalato: `px-3 sm:px-4 py-4 sm:py-6`
- Welcome grid: `grid-cols-1 sm:grid-cols-2`
- Icon size scalato: `size-10 sm:size-12`, `size-7 sm:size-8`
- Helper text "Invio per eseguire…" `hidden sm:block`
- DAG container: `h-48 sm:h-64`
- `min-h-0` sullo scroll area critico per il flex parent su mobile

---

## 10. Cockpit

Il componente `src/components/agentic/cockpit.tsx` è la plancia di comando operativa per il monitoraggio real-time.

### 10.1 Layout generale

```
┌─────────────────────────────────────────────────────────┐
│ PhaseHeader: "Cockpit"               [Aggiorna]         │
├──────────────────────────┬──────────────────────────────┤
│                          │                              │
│   SensoriumWidget        │   AffectGauge                │
│   (4 KPI tiles)          │   (Desperazione/Frustrazione)│
│                          │                              │
├──────────────────────────┴──────────────────────────────┤
│ [Narrative][Log][Scheduler][Cycles][Safety]             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│            Tab content (ScrollArea)                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ RelatedPhases: P11, P4, P9, P2                          │
└─────────────────────────────────────────────────────────┘
```

Container: `p-4 md:p-6 space-y-4`.

### 10.2 SensoriumWidget (persistente)

Mini-card con 4 KPI tiles in `grid grid-cols-4 gap-3`:

```tsx
function Widget({ icon: Icon, label, value, warn }) {
  return (
    <div className="bg-muted/30 rounded-md p-2.5 text-center">
      <Icon className={cn('size-4 mx-auto mb-1', warn ? 'text-amber-500' : 'text-muted-foreground')} />
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn('text-base font-bold font-mono', warn && 'text-amber-600 dark:text-amber-400')}>
        {value}
      </div>
    </div>
  )
}
```

Tile mostrate:
- **Ciclo** (#N) — id del ciclo corrente
- **Queue** (depth) — profondità coda
- **Threads** (active) — thread attivi
- **Load** (%) — carico sistema, amber-warn se > 0.7

### 10.3 AffectGauge (persistente)

Due barre orizzontali di progresso per Desperazione e Frustrazione:

```tsx
<Progress value={desperation * 100} className="h-2" indicatorClassName={cn(
  desperation >= 0.7 ? 'bg-red-500' : desperation >= 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
)} />
```

- Soglia `>= 0.7` → rosso
- Soglia `>= 0.4` → ambra
- Sotto → emerald
- Animazione `transition-all duration-500`
- Card border va `border-red-500/40` e titolo `<Flame>` diventa red quando `critical = desperation >= 0.7 || frustration >= 0.7`
- Dati fetched da `/api/affect?action=stats` con polling ogni 5s (separate interval dal refresh tab)

### 10.4 Tabs (5 tabs in `grid grid-cols-5 w-full`)

#### Tab 1: Narrative

Log narrativo degli agenti con border-left colorato per livello:
- `critical` → `border-l-2 border-red-500`
- `warn` → `border-l-2 border-amber-500`
- `info` → `border-l-2 border-sky-500`

Empty state: "Nessuna narrativa…" italico.

#### Tab 2: Log

Righe monospace con badge phase `P{phase}`, agentId, event, timestamp. No empty state esplicito.

#### Tab 3: Scheduler

`ScrollArea h-96` di card task:

```tsx
<li className="text-xs border rounded-md p-2.5">
  <Badge variant="outline" className="font-mono">{t.taskId}</Badge>
  <Badge variant="secondary" className={cn('text-[10px]',
    t.status === 'done' && 'bg-emerald-500',
    t.status === 'running' && 'bg-sky-500',
    t.status === 'failed' && 'bg-red-500',
    t.status === 'pending' && 'bg-zinc-400',
  )}>{t.status}</Badge>
  <span className="text-[10px] font-mono">{t.agentId}</span>
  <div className="text-[11px]">{t.description}</div>
  <div className="text-[10px] text-muted-foreground mt-1 truncate">Piano: {t.plan?.taskGoal}</div>
</li>
```

Empty state: "Nessun task. Genera un piano in Planner & Compiler."

#### Tab 4: Cycles

Grid 2-col che mostra:
- **Cycle snapshots** — load, queue depth, threads
- **Steering events** — strategy + token usati

#### Tab 5: Safety

Card bordate ambra per le azioni bloccate (`border-amber-500/40`) con `<pre>` che mostra la spiegazione leggibile.

**Empty state (sistema in salute)**:
```
✓ (CheckCircle2 emerald)
"Nessuna azione bloccata. Il sistema è in salute."
```

### 10.5 Color coding status (cross-tab)

| Status | Colore |
|---|---|
| `done` / `pass` / `accept` | emerald-500 |
| `running` | sky-500 |
| `pending` / `info` | zinc-400 / sky-500 border |
| `failed` / `reject` / `error` | red-500 / red-700 (con `dark:text-red-400`) |
| `warn` / `blocked` | amber-500 |
| `critical` | red border-l-2 |

### 10.6 Refresh behavior

- `refresh(tab)` fired su ogni cambio tab E quando `tab` cambia via `useEffect`
- Affect gauge ha polling proprio ogni 5s
- No polling globale per il tab content una volta caricato → l'utente deve click Refresh o cambiare tab e tornare
- No loading spinner nei tab → empty state finché i dati arrivano

---

## 11. Tool Manager

Il componente `src/components/agentic/tool-manager.tsx` è l'interfaccia admin per installare, revocare e gestire i permessi a grana fine sui tool firmati ECDSA.

### 11.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│ PhaseHeader: "Tool Manager"           [Aggiorna]        │
├─────────────────────────────────────────────────────────┤
│ StatCard × 5: Tool totali · Attivi · Revocati · Perm ·  │
│               Concessi                                   │
├─────────────────────────────────────────────────────────┤
│ [Installati][Installa][Predefiniti]                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Tab content                                           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ RelatedPhases: P8, P9, P4, cockpit                      │
└─────────────────────────────────────────────────────────┘
```

### 11.2 StatCard row

`grid grid-cols-2 md:grid-cols-5 gap-3` di card:

```tsx
function StatCard({ icon: Icon, label, value, highlight, warn }) {
  return (
    <div className="bg-card border rounded-md p-3">
      <Icon className="size-4 text-muted-foreground mb-1" />
      <div className={cn('text-2xl font-bold font-mono',
        highlight && 'text-emerald-600 dark:text-emerald-400',
        warn && value > 0 && 'text-amber-600 dark:text-amber-400')}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}
```

Tile: Tool totali, Attivi (highlight emerald), Revocati (warn amber se >0), Permessi, Concessi (highlight emerald).

### 11.3 Tabs (3 tabs in `grid grid-cols-3 w-full`)

#### Tab 1: Installati

Layout 2-col `grid lg:grid-cols-[1fr,1.5fr] gap-4`:

**Lista sinistra** (ScrollArea `h-96`):
```tsx
<button className={cn('w-full text-left text-xs border rounded-md p-2.5 transition-colors',
  selectedTool?.id === t.id ? 'border-primary bg-primary/10' : 'hover:bg-muted/50',
  !t.active && 'opacity-50')}>
  <Package className="size-3.5 inline" /> {name}
  <Badge>v{version}</Badge>
  {!active && <Badge className="bg-red-500">revocato</Badge>}
  <div className="text-[10px] text-muted-foreground">
    {grantedCount}/{totalCount} permessi · {toolId}
  </div>
</button>
```

**Detail panel destra** (render solo se `selectedTool`):
- Header: Package icon + name + version/publisher + Revoca button (red-tinted outline)
- Description text
- **Signature box** (`border rounded-md p-2 bg-muted/30`): `<KeyRound>` emerald + signature mono
- **Permessi a grana fine** (sezione):
  ```tsx
  <div className={cn('flex items-center gap-2 text-xs border rounded-md p-2',
    p.granted ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border')}>
    {p.granted ? <Unlock className="text-emerald-500" /> : <Lock className="text-muted-foreground" />}
    <code className="font-mono">{p.scope}</code>
    <Switch checked={p.granted} onCheckedChange={...} disabled={!selectedTool.active} />
  </div>
  ```
- Lista scrollabile `max-h-60 overflow-y-auto`
- Permessi granted → background verde; locked → neutro
- Switch disabilitato se tool revocato

#### Tab 2: Installa

Form `grid md:grid-cols-2 gap-3` con campi:
- Tool ID, Name, Version, Publisher (4 input)
- Description (full-width)
- Installa button → POST `/api/tools { action: 'install' }`

Validazione: toast error se `toolId`, `name`, `version` vuoti. Success: toast con signature troncata (`d.signature.slice(0, 16)…`), reset form, refresh.

#### Tab 3: Predefiniti

Sottocomponente `BuiltinTools` che fetcha `/api/tools?action=builtin` e renderizza `grid md:grid-cols-3 gap-3` di card. Ogni card:
- Icona + name + version/publisher + description
- Se già installato → Badge "Installato" (emerald)
- Altrimenti → button "Installa"

### 11.4 Livelli di controllo

1. **Tool-level**: Revoca button → POST `action: 'revoke'` con reason. Imposta `active=false`; list item `opacity-50` + badge "revocato" rosso; tutti i permission switch disabilitati.
2. **Permission-level**: Switch toggle → POST `action: 'set_permission'` con `{ toolId, scope, granted: !granted }`. Update ottimistico locale (no refetch completo).

### 11.5 Real-time

Nessun WebSocket. Solo Refresh manuale. Nessun interval (a differenza del cockpit).

---

## 12. Sovereign Modal

Il componente `src/components/agentic/sovereign-modal.tsx` è una Dialog globale che si auto-apre quando il WebSocket riporta `action_blocked`, presentando all'operatore umano (Sovereign Validator) un'azione bloccata e 4 scelte di risoluzione.

### 12.1 Trigger

`SovereignModalContainer` è un container non-rendering (`if (!current) return null`) che si iscrive a `useSensoriumLive()` events. Due trigger:

1. **Polling**: ogni 5s, `GET /api/blocked-actions?action=pending`
2. **WebSocket**: quando arriva un evento con `event === 'action_blocked'`, re-fetch immediato dei pending

Auto-open via `<Dialog open={!!current} onOpenChange={() => {}}>` — `onOpenChange` vuoto previene la chiusura manuale (forza la risoluzione).

Multipli pending vengono accodati via `currentIdx` ("1 di 3 azioni in attesa").

### 12.2 Content

Dialog body (`max-w-2xl`):

#### Action attempted box

`border rounded-md p-3 bg-muted/30` con:
- Source badge colorato per `SOURCE_STYLE`:
  - `ltl` → red
  - `taint` → amber
  - `normative` → violet
  - `hitl_gate` → pink
- Agent ID mono badge
- Timestamp
- Action quotata in bold: `"${current.action}"`

#### Readable explanation

`<pre className="whitespace-pre-wrap bg-muted/50 rounded-md p-3 mt-1 max-h-32 overflow-auto">` — preserva formattazione, scrollabile.

#### Axiom Trail (condizionale)

Se `JSON.parse(current.axiomTrail)` ha successo: lista di `{step, rule, result}` con border-left accent `border-primary/40 pl-2 py-1`. Ogni item mostra mono `step` badge, la regola, e `→ result` se presente.

#### Resolution note (Textarea opzionale)

2 righe, placeholder "Es. Approvato dopo verifica manuale del file di log".

### 12.3 Actions footer

4 button in `DialogFooter flex-wrap gap-2`:

| Button | Variant | Icon | Choice |
|---|---|---|---|
| Approva (assumi responsabilità) | `bg-emerald-600 hover:bg-emerald-700` | CheckCircle2 | `approved` |
| Modifica parametri | outline | Wrench | `modified` |
| Declassa task | outline | ArrowDownCircle | `downgraded` |
| Rifiuta | destructive | Ban | `rejected` |

Lo stato `resolving` disabilita tutti e 4 i button durante la request. Dopo risoluzione: `toast.success`, clear note, re-fetch pending, reset `currentIdx` a 0.

### 12.4 Error handling

- `try/catch` attorno a `resolve()` → `toast.error(e.message)` su network failure
- Nessun error display inline nella dialog (solo toast)
- Il polling 5s `try/catch` silenzioso (errori ignorati)

---

## 13. LTL & Normative Editor

Il componente `src/components/agentic/ltl-normative-editor.tsx` è un editor a 3 card per gestire regole di sicurezza Linear Temporal Logic (con preview FSM live) e assiomi normativi (con gerarchia di priorità).

### 13.1 Layout

3 card stacked:

1. **Editor Visuale Regole LTL** — input formula + preview FSM
2. **Regole LTL Attive** — lista regole esistenti
3. **Editor Assiomi Normativi** — form add + lista raggruppata per priorità

### 13.2 Form editor LTL

- **Rule ID** Input (default `LTL-007`, auto-incrementa a `LTL-008` dopo save)
- **Severity** Select: `block` (rifiuta azione), `warn` (solo avviso), `log` (silenzioso)
- **Formula LTL** Input `font-mono` con **live border coloring**:
  ```tsx
  className={cn('font-mono',
    preview?.valid === true && 'border-emerald-500',
    preview?.valid === false && 'border-red-500')}
  ```
- **Descrizione** Input
- **9 pattern shortcut button** in `flex flex-wrap gap-1.5`: `G(p)`, `F(p)`, `X(p)`, `G(a -> X b)`, `G(a -> !b)`, `G(a -> F b)`, `p U q`, `G(p && q)`, `G(!p || q)`. Click → set formula text.

### 13.3 Validation feedback

Debounced 400ms via `/api/verify` con `action: 'preview_fsm'`:

```tsx
useEffect(() => {
  if (!newFormula.trim()) { setPreview(null); return }
  setValidating(true)
  const t = setTimeout(async () => {
    const r = await fetch('/api/verify', { method: 'POST',
      body: JSON.stringify({ action: 'preview_fsm', formula: newFormula }) })
    const d = await r.json()
    setPreview(d)
  }, 400)
  return () => clearTimeout(t)
}, [newFormula])
```

Feedback row sotto l'input:
- Validating: `<RefreshCw className="size-3 animate-spin" /> validazione…`
- Valid: `<CheckCircle2 className="size-3 text-emerald-500" /> pattern: <code>{preview.pattern}</code>`
- Invalid: `<XCircle className="size-3 text-red-500" /> {preview.error}`

### 13.4 FSM preview

Quando `preview.valid && preview.states` esistono, pannello bordato renderizza:
- Title "FSM Compilata" con pattern badge
- Descrizione
- Flex-wrap grid di state chip, colorati per `STATE_STYLE`:
  - `initial` → sky border + bg
  - `accepting` → emerald
  - `violating` → red
  - `pending` → amber
- Ogni chip: state name + type label (iniziale/accettante/violazione/in attesa)
- Legend row di dot colorati in fondo

### 13.5 Save rule

Bottone "Salva Regola" **disabilitato a meno che `preview?.valid`** — hard client-side gate.

Validazione addizionale: `ruleId` e `formula` non vuoti (toast error altrimenti).

Successo: toast, auto-increment ruleId, refresh lista.

### 13.6 Rule list

ScrollArea `h-72 pr-2` di card regola:
- `Badge variant="outline" font-mono` per ruleId
- Severity badge con colori custom (block=red, warn=amber, log=zinc, con `dark:` variants)
- Inline `<code>` con formula LTL (truncated)
- Trash2 ghost button per delete (imposta `active=false` via `delete_ltl` action)
- Descrizione opzionale

Empty state: "Nessuna regola." italico.

### 13.7 Axiom editor

- Form add: `grid md:grid-cols-[1fr,200px,auto]` — text input + priority Select + Add button
- Priority levels: `1 - Legale`, `2 - Operativo`, `3 - Efficienza`
- Assiomi raggruppati per priorità, ogni gruppo ha border-left colorato (`border-l-4`) e count badge
- Assiomi default (id starts with `default-`) → badge "default" + **non cancellabili** (delete button nascosto)
- Assiomi utente → Trash2 button che appare solo su hover (`opacity-0 group-hover:opacity-100`)
- Gruppo vuoto → "nessuno" italico placeholder

---

## 14. Moduli di Fase (1-14)

Tutti i 14 moduli di fase condividono lo stesso scheletro UI:

```
┌─────────────────────────────────────────────────────────┐
│ PhaseHeader: [Icon] Title                [Aggiorna]     │
│              subtitle                                   │
├─────────────────────────────────────────────────────────┤
│ KPI strip (2-5 StatCard in grid responsive)             │
├─────────────────────────────────────────────────────────┤
│ [Tabs...]                                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Tab content (cards, forms, lists)                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ RelatedPhases (chips outline con理由)                   │
└─────────────────────────────────────────────────────────┘
```

Container standard: `p-4 md:p-6 space-y-4`.

### 14.1 Phase 1 — Memory & State

- **Categoria:** foundation · **Icona:** Database
- **Subtitle:** "NS-Mem · PatchBoard · Sensorium"
- **Purpose:** Cockpit per tre layer foundational — Neuro-Symbolic Memory (episodica + semantica + regole logiche), PatchBoard (kernel transazionale JSON Patch), Sensorium (snapshot XML compilato ogni ciclo cognitivo dal Curator).

**KPI strip (4):** Episodi · Entità semantiche · Regole logiche · EMA decay medio

**Tabs (4):**

1. **Memoria** — Due form side-by-side:
   - "Registra Episodio" (textarea + Registra button)
   - "Crea Entità Semantica" (name input + type select module/agent/system/concept + description + Aggiungi)
   - Sotto: due liste scrollabili — "Episodi Recenti" (decay badge, source, #tags, observation, timestamp, `border-l-2 border-primary/40`) e "Entità Semantiche" (type badge, mono name, description truncated, EMA badge)

2. **PatchBoard** — Form "Invia Transazione JSON Patch":
   - actor select (kernel/orchestrator/curator/scheduler/reflective)
   - op select (add/replace/remove/test)
   - JSON-pointer path input con hint prefissi validi (`/system /agents /tasks /memory /metrics /public`)
   - JSON value input
   - "Applica Transazione" button
   - Side-by-side: live JSON tree dello stato globale in `<pre>` (mono, muted bg)
   - Sotto: Audit Trail — ✓/✗ icon, op badge, mono path, "by actor", timestamp

3. **Sensorium** — Card con "Nuovo Ciclo" button; mini-stat row (Cycle #, Queue depth, Active threads, System load %); `<pre>` con XML raw su `bg-zinc-950 text-zinc-100` (estetica terminale)

4. **DAG Logico** — "Grafo DAG delle Regole Logiche": ogni regola come card bordata con ruleId badge, priority badge (Pn), expression in `<code>` chip, "dipende da: A → B" line. Catena aciclica visualizzata come frecce testo.

**Related:** phase6 (context), phase13 (belief sync), phase3 (cognitive cycle), phase5 (heuristics)

### 14.2 Phase 2 — Planner & Compiler

- **Categoria:** orchestration · **Icona:** Workflow
- **Subtitle:** "DynAMO · Compiled AI"
- **Purpose:** Modulo 2-in-1 — (a) DynAMO Planner genera piani multi-agente LLM-driven con JSON-schema validation e li converte in DAG di batch parallelizzabili; (b) Compiled AI genera codice da requisiti NL dentro template pre-validati e lo passa in un pipeline safety a 4 stadi.

**Tabs (3):**

1. **DynAMO Planner** — Goal textarea (default "Analizza le metriche di vendita Q3…") + "Genera Piano via LLM" button (spinner state). Dopo generazione, due card side-by-side:
   - "Piano JSON Validato" (taskId badge, agent color dot — orchestrator=emerald, curator=sky, controller=violet, verifier=amber, reflective=pink — agentId mono, description, "dipende: …")
   - "Schedulazione Topologica" (batches listati con `border-l-2 border-primary/40`, ogni batch mostra count di task paralleli come dot+id badges)
   - Sotto: "Piani Storici" (status badge, goal, agent count)

2. **Grafo DAG** — React Flow visualization (`DynAMODagVisualizer`). Empty state: italico hint a generare piano prima.

3. **Compiled AI** — Template select + requirement input + "Genera e Valida" button. Result card:
   - Header con Rocket (deployed) o ShieldCheck (non deployato) icon + "DEPLOYED" badge
   - Generated code in `<pre>` terminal block
   - Grid 2×2 / 4-col di stage result tiles (Safety / Syntax / Execution / Accuracy) emerald (PASS) o red (FAIL)
   - Per-stage reasoning lines
   - "Artefatti Compilati" list (deployed/layer icon, mono name, 4 ✓/✗ badges S/Y/E/A)

**Related:** phase8 (Lean4 verify), phase7 (trace validation), phase5 (reflect on outcome), phase9 (HITL gate)

### 14.3 Phase 3 — Cognitive Steering

- **Categoria:** cognitive · **Icona:** Compass
- **Subtitle:** "ACTS Controller"
- **Purpose:** Driva il ciclo cognitivo deterministico PLAN / EXECUTE / CHECK / REFLECT / HALT (ACTS) per un Controller agent. Mostra la steering phrase iniettata nell'LLM e traccia il consumo del token budget.

**Layout (no tabs, 3-col grid):**

- **Left card (Controller State):**
  - Token-budget Progress bar con colore adattivo (red <20%, amber 20-50%, default altrimenti)
  - Mini-stat grid 2×2: Step, Errori consecutivi, Ultima strategia, Check passato (SÌ/NO/—)
  - Budget-total numeric input (disabled quando step > 0)
  - 3 button: "Step" (Play icon), "Auto-run / Stop" (toggle outline/destructive, Zap/Square), "Reset" (RotateCcw)

- **Right card (Steering Phrase Corrente, span 2 cols):**
  - Callout colorato (`STRATEGY_STYLE[lastStrategy].bg`) con strategy icon + strategy badge + phrase in italico
  - "Vocabolario di Sterzate" — grid 2-col di 5 strategy card (PLAN/EXECUTE/CHECK/REFLECT/HALT) con icon, mono name, budget-cost badge, description, italic phrase. La card attiva ha border 2px evidenziato.

**Strategy color map:** PLAN=sky, EXECUTE=emerald, CHECK=amber, REFLECT=violet, HALT=red

**Bottom card:** "Storia degli Steering Event" — ScrollArea h-64, audit log con strategy icon, badge, cycleId, phrase, tokenUsed

**Interazioni:**
- Step (singolo ciclo), Auto-run (interval 1500ms finché HALT), Reset
- CHECK outcome simulato client-side (`Math.random() > 0.3`)
- HALT strategy auto-disabilita il loop + `toast.info('HALT: budget esaurito o soglia di sicurezza')`

**Related:** phase1, phase10, phase14, phase11

### 14.4 Phase 4 — Verification & Taint

- **Categoria:** trust · **Icona:** ShieldCheck
- **Subtitle:** "LTL · Taint · Normative"
- **Purpose:** Layer di safety runtime con tre meccanismi — LTL monitoring (FSM-compiled), taint tracking (untrusted input flows), "Cancello Normativo Stoico" (gerarchia assiomatica).

**Tabs (5):**

1. **LTL Monitor** — Test form: state-label select (high_risk, human_approval, tainted, sensitive_call, check, execute, error, reflect), event-type input, payload input. Sotto: "Regole LTL Attive" list (ruleId badge, severity badge, LTL formula in mono code chip, description)

2. **Editor** — Embed `<LTLNormativeEditor />` (vedi §13)

3. **Taint Tracking** — Due form side-by-side:
   - "Marca Input come Tainted" (source select user_chat/api_response/external_feed/file_input, payload textarea, Taint Input button)
   - "Test Sink Sensibile" (sink select tool_call:exec/file_write/network/db_write/deploy/delete, taint IDs comma-separated input, destructive "Verifica Sink" button)
   - Sotto: "Taint Records" — blocked icon (XCircle red) o filter icon (amber), source badge, taint-label badge, optional `BLOCCATO` destructive badge, timestamp, italic payload, `flow: A → B → C` trace line

4. **Normative** — "Cancello Normativo Stoico" form: action input, priority select (1 Legale / 2 Operativo / 3 Efficienza), rationale input, axiom select. Sotto: "Gerarchia Assiomatica" — 3 priority group con border-left colorato (red/amber/sky), ognuno listando i propri assiomi come bullet

5. **Eventi** — "Eventi di Verifica" audit log (h-96 ScrollArea) con verdict icon (accept=emerald CheckCircle2, warn=amber AlertTriangle, reject=red XCircle), state label, verdict badge, reason, timestamp

**Related:** phase9, phase8, phase11, phase13

### 14.5 Phase 5 — Reflective Learning

- **Categoria:** learning · **Icona:** Sparkles
- **Subtitle:** "ERL · Red Lines"
- **Purpose:** Experience-Based Reflection Learning (ERL). Dopo un'operazione, l'agente riflette su goal/steps/outcome, estrae un'euristica "when X then Y", e AutoSOTA la verifica contro Red Lines non-negoziables prima di memorizzarla. Include RAG retrieval semantico sulla libreria euristiche.

**Tabs (4):**

1. **Riflessione** — Form: goal input, outcome select (success/failure/partial), steps textarea (mono, formato "azione: risultato" uno per riga), context input. "Rifletti ed Estrai Euristica" button. Sotto: "Log Riflessioni Recenti" — entry con outcome icon (emerald/red/amber), outcome badge, optional `RED LINE` destructive badge, euristica estratta in italico, analisi in mono `<pre>`

2. **RAG Euristiche** — Search input + Recupera button. Risultati: card con `sim <float>` mono badge, "usata N× · X% ok" badge, `<strong>Trigger:</strong>` e `<strong>Action:</strong>` lines. Enter-key trigger search

3. **Libreria** — "Libreria Euristiche" list (h-96) — CheckCircle2 (emerald), `Red Line OK` badge, usage stats, creation date, "Quando: …" / "Allora: …" / "Contesto: …" / optional `src:` mono line

4. **Red Lines** — Card con Shield icon header. List con red left-border (`border-l-4 border-red-500`), AlertTriangle icon, severity badge (destructive se `absolute`, altrimenti secondary), description, rationale indentato

**Related:** phase2, phase8 (LeanEvolve), phase12 (rubric), phase1

### 14.6 Phase 6 — Context Manager

- **Categoria:** foundation · **Icona:** Scissors
- **Subtitle:** "Ring buffer · Summaries"
- **Purpose:** Gestisce il contesto di lavoro di ogni agente come ring buffer di coppie recenti tool-call/response, auto-summarizzando le entry vecchie per risparmiare token. Fornisce RAG search sugli storici summary.

**KPI strip (4):** Active calls · Evicted calls · Summaries · Token salvati (highlight emerald, `<Coins>` icon)

**Tabs (4):**

1. **Working Context** — Optional "Summary" card (narrative `<pre>` con cycleId + covered-count). Sotto: "Ultime N coppie Tool Call/Response" — item con toolName mono badge, token-cost badge, timestamp, poi grid 2-col con CALL payload JSON e RESP payload JSON in mini `<pre>`. Sotto: outline "Forza Summarization ora" button con Scissors icon

2. **Registra** — Form: agentId, toolName, callPayload + responsePayload JSON textareas (mono), tokenCost numeric input, Registra button

3. **Policy** — Window-size numeric (1–50), summarize-threshold numeric, auto-summarize `Switch` con label descrittiva, "Salva Policy per <agentId>" button

4. **RAG Storico** — Search input + Cerca button; risultati con similarity badge, cycle # badge, narrative `<pre>` truncated (500 char max)

**Re-fetch:** quando `agentId` cambia (`useEffect([agentId])`)

**Related:** phase1, phase10, phase14, phase3

### 14.7 Phase 7 — Trace Validator

- **Categoria:** orchestration · **Icona:** GitFork
- **Subtitle:** "PTA · Dominators"
- **Purpose:** Cattura tracce positive di esecuzione di un workflow, le fonde in un Prefix Tree Automaton (PTA), estrae dominator states (checkpoint essenziali), e valida nuove tracce per dominator coverage.

**KPI strip (4):** Tracce catturate · PTA costruiti · Validazioni · Avg coverage (highlight emerald se ≥0.7)

**Tabs (4):**

1. **Cattura Tracce** — Form: workflowId, traceLabel, states (comma-separated), actions (optional, comma-separated), outcome come 3-button toggle group (success/partial/failure), "Cattura Traccia" button

2. **PTA + Dominators** — Header con "Costruisci PTA" button. Summary badges: #nodi, #accept, #dominatori essenziali (violet). "Dominatori" section: violet badges list. "Grafo PTA" ScrollArea (h-64): ogni node è una card colorata per role — start=sky border, accept=emerald border, dominator=violet bg+border. Mostra node ID, state, role badges, depth, `→ childState→childId` transitions

3. **Validazione** — Input per trace da validare, hint "Prova a saltare uno stato (es. ometti 'loading')…", "Valida" button. Result box: verdict icon (ACCEPT=emerald / WARN=amber / REJECT=red), verdict badge, coverage badge, path-valid badge, reason text, "Dominatori raggiunti: N / M" counter

4. **Storico** — List tracce catturate per workflow corrente: workflowId badge, outcome badge, trace label, timestamp, mono `states: A → B → C` line

**Re-fetch:** quando `workflowId` cambia

**Related:** phase2, phase8, phase12, phase9

### 14.8 Phase 8 — Formal Verifier

- **Categoria:** trust · **Icona:** FunctionSquare
- **Subtitle:** "Lean4 · LeanEvolve"
- **Purpose:** Verifica formale pre-execution dei piani DynAMO — auto-genera contratti Lean4-style (pre/post-conditions) dai task del piano, verifica well-formedness di tipo/dependency/postcondition, e fornisce LeanEvolve recovery (LLM riscrive le istruzioni dei task falliti poi re-verifica).

**KPI strip (4):** Contratti · Verificati (emerald) · Workflow verificati · "LeanEvolve success" come `N/M`

**Plan selector card:** horizontal wrap di button piano selezionabili; selected ha `border-primary bg-primary/10`. Ognuno mostra goal, status · agentCount · id-suffix.

**Tabs (5):**

1. **Verifica** — Two-button pipeline: "1. Auto-genera Contratti" → "2. Verifica Workflow" (entrambi async con spinners). Result: top banner (emerald se verified, red se failed) con workflowId. Per-task result list — card con ✓/✗ icon, taskId badge, optional `N warn` amber badge, optional `N errori` red badge, poi bulleted error/warning lists

2. **Grafo** — React Flow visualization (`LeanWorkflowVisualizer`) dei contratti. Empty state hint

3. **Sorgente Lean4** — Big `<pre>` (h-96) su `bg-zinc-950 text-zinc-100` con pseudo-Lean4 source auto-generato

4. **LeanEvolve** — Form: failed-taskId input, failure-reason input, "Esegui LeanEvolve" button (async). Sotto: "Eventi LeanEvolve" list — `cycle N` badge, failed-taskId badge, re-verified/pending colored badge, failure reason, rewritten instruction in italici (truncated 100 char)

5. **Storico** — "Workflow Verificati" list — verified/deployed icons, version badge, planId mono, deployed badge, timestamp

**Related:** phase2, phase5, phase7, phase4

### 14.9 Phase 9 — Human Retainer

- **Categoria:** governance · **Icona:** UserCog
- **Subtitle:** "Delegation · HITL · Audit"
- **Purpose:** Governance human-in-the-loop: scopa l'autorità degli agenti via delegations, forza approval gates per azioni irreversibili/LTL-violating/spend-threshold, risolve conflitti user-instruction-vs-system-policy via gerarchia normative, e mantiene un audit ledger human-readable.

**KPI strip (5):** Deleghe attive · Gates pending (highlight amber se >0) · Gates approvati · Gates rifiutati · Voci audit

**Tabs (4):**

1. **Delegation** — "Concedi Delega" form: agentId, scope (es. `tool:exec`, `filesystem:/tmp/*`), constraints JSON textarea, grantedBy input, "Concedi" button. Sotto: "Deleghe Attive" list — agentId badge, scope mono badge, active/revoked colored badge, grantedBy, revoke button (Trash2) quando attiva, constraints JSON in mono

2. **HITL Gates** — "Richiedi Approvazione" form: agentId, action, payload JSON textarea, reason input, "Crea Gate" button. Conditional "Gates Pending" card (amber-themed, `border-amber-500/40 bg-amber-50`) — ogni pending gate ha agentId badge, pending badge, action title, reason, e due grandi button: "Approva" (emerald) e "Rifiuta" (destructive). Sotto: "Gates Recenti" list con status icons (approved/rejected/pending) e status badges

3. **Normative** — "Calcolo Normativo" form con due pannelli side-by-side (user instruction + level select; system policy + level select), levels = SAFETY(1)/OPERATIONAL(2)/AESTHETIC(3). "Risolvi Conflitto" button. Result box: verdict icon (accept=emerald / block=red / modify=amber), verdict badge, hierarchy trail (es. "SAFETY > OPERATIONAL"), optional italic "Modified action: …", "Axiom Trail (auditabile)" `<pre>` con decision JSON. Sotto: "Risoluzioni Normative Recenti" list

4. **Audit Ledger** — Big ledger (`h-[28rem]` ScrollArea). Ogni entry: agentId badge, gate/action badge, outcome badge (granted/approved=emerald, revoked/rejected/block=red, modify=amber), optional `irreversibile` red badge, timestamp, action description, `readableNarrative` in italic muted box

**Related:** phase4, phase11, phase13, phase2

### 14.10 Phase 10 — Model Encapsulator

- **Categoria:** cognitive · **Icona:** Boxes
- **Subtitle:** "Stateless LLM · Sandbox"
- **Purpose:** Chiamata stateless a un LLM con solo un contesto minimale (nessuno stato persistente lato modello); se l'LLM emette uno script, viene eseguito in sandbox isolata piuttosto che direttamente contro dati reali.

**KPI strip (4):** Sessioni · Eseguite (highlight) · Sandbox block (amber se >0) · Policy

**Tabs (2) — fase più semplice:**

1. **Encapsulated Call** — Form: agentId, taskGoal, contextData JSON textarea (mono), hint sul token budget truncation (default 2000), "Esegui Encapsulated Call" button (Play icon)

2. **Storico Sessioni** — List (h-96). Ogni entry: agentId mono badge, status icon (executed=emerald CheckCircle2, sandbox_blocked=red XCircle, failed=amber AlertTriangle), status badge, optional `sandbox` Lock badge, timestamp, taskGoal text, model output truncated, optional mono sandbox result block

**Toast variants:** "Sandbox ha bloccato lo script", "Script generato e eseguito in sandbox ✓", "Chiamata incapsulata completata (no script)"

**Related:** phase6, phase14, phase3, phase4

### 14.11 Phase 11 — Affect Monitor

- **Categoria:** cognitive · **Icona:** HeartPulse
- **Subtitle:** "Desperation · Frustration"
- **Purpose:** Traccia telemetria "affettiva" degli agenti — `desperation` (gate rejects × 0.35, decay 5%/ciclo) e `frustration` (tool failures × 0.20 + repeated calls × 0.15). Quando le soglie sono superate, scatta un Meta-Observer intervention (es. forza HALT o HITL).

**KPI strip (4):** Samples · Agenti monitorati · Interventi (amber se >0) · Avg desperation (amber se >0.5)

**Tabs (2):**

1. **Calcola Metriche** — Form: agentId input, poi grid 5-col di numeric input (Tool failures, Tool calls, Gate rejects, Gate attempts, Repeated calls). Description mostra la formula: `Disperazione = gateRejects × 0.35 (decay 5%/ciclo)` / `Frustrazione = toolFailures × 0.20 + repeatedCalls × 0.15`. "Calcola Metriche Affettive" button

2. **Storico** — List (h-96). Ogni sample: `#cycleId` badge, optional `INTERVENTION` red badge con AlertTriangle, timestamp. Due Progress bar side-by-side: Desperation (Flame icon red) e Frustrazione (Snowflake icon sky), ognuna con mono numeric value e color-adaptive fill (red >0.7, amber >0.4). Se intervento presente, red-tinted mono box in fondo con intervention text + Shield icon

**Re-fetch:** quando `agentId` cambia

**Related:** phase4, phase9, phase3, phase5

### 14.12 Phase 12 — Objective Builder

- **Categoria:** orchestration · **Icona:** Target
- **Subtitle:** "BFS Rubric Tree"
- **Purpose:** Decompone un macro goal in un hierarchical rubric tree via BFS (branching factor 3, weight halved per level, stop se weight <0.1 o depth ≥5). Ogni nodo può essere valutato Pass/Fail/Skipped.

**KPI strip (5):** Alberi · Nodi · Completati (highlight) · Pass · Fail (warn se >0)

**Tabs (3):**

1. **Crea Albero** — Macro-goal input + "Crea Albero BFS" button. Dopo creazione, "Albero Decomposto" card: ogni nodo come card indentata `marginLeft: depth * 20px` (albero visuale). Card border color = context tier (strategic=sky, methodological=violet, implementation=emerald). Row: status icon (pass=emerald CheckCircle2, fail=red XCircle, skipped=muted SkipForward, pending=null), `L<depth>` badge, tier badge, `w=<weight>` mono, description. Per pending nodes: inline mini-button "Pass" (emerald) / "Fail" (red). Per evaluated nodes: status badge

2. **Grafo Albero** — React Flow hierarchical visualization (`ObjectiveTreeVisualizer`)

3. **Esplora Alberi** — List alberi esistenti con status badge, `N nodi` badge, `L<maxDepth>` badge, root goal, "Esplora" button per caricare

**Related:** phase2, phase5, phase7, phase8

### 14.13 Phase 13 — Swarm Coherence

- **Categoria:** trust · **Icona:** Network
- **Subtitle:** "Belief sync · Quorum"
- **Purpose:** Gestisce belief synchronization tra agenti paralleli (ESR — Eventual Sync Replication) e quorum-based decisions per azioni che richiedono validatori multipli indipendenti.

**KPI strip (5):** Beliefs · Sync events · Conflitti (warn se >0) · Quorum · Accepted (highlight)

**Tabs (3):**

1. **Beliefs** — "Registra Belief" form: agentId, type select (summary/evidence/plan/observation), content input. Sotto: "Beliefs Attivi" list — agentId mono badge, beliefType badge, `v<version>` badge, `conf=<float>` badge, timestamp, content text. Registra belief con stesso agent+type → supersede quello precedente (toast: "Convinzione precedente marcata come superseded")

2. **ESR Sync** — Form: source agent, target agent, belief ID (auto-default al primo belief). "Sincronizza" button. Sotto: "Sync Events" list — synced=emerald CheckCircle2 o conflict=red AlertTriangle, `source→target` mono badge, sync-status badge (red bg se conflict), conflict reason o "OK"

3. **Quorum** — "Proponi Quorum" form: workflow join ID, action, required-quorum numeric (1–5). Sotto: "Decisioni Quorum" list — joinId badge, verdict badge (accepted=emerald / rejected=red / pending=amber), action, accept/reject/required counts. Per pending decisions: inline button "Accept (v1)", "Accept (v2)", "Reject" che simulano due verifier agent che votano

**Related:** phase2, phase1, phase5, phase9

### 14.14 Phase 14 — Model Router

- **Categoria:** infrastructure · **Icona:** Shuffle
- **Subtitle:** "Adaptive routing · Ensemble"
- **Purpose:** Selezione adattiva del modello — estrae feature dal prompt (domain, length, token estimate, complexity, hasCode/hasMath/hasLogic), score i modelli candidati, e ruota via Selective Gate verso uno di: Primary (singolo modello alta confidenza), Ensemble (multipli quando confidenza/margin bassi), o Critic (modello di verifica addizionale).

**KPI strip (5):** Decisioni · Primary (highlight) · Ensemble (warn) · Critic (warn) · Top model (small text, 12-char truncated)

**Tabs (2):**

1. **Route Prompt** — Form: agentId, prompt textarea (mono, default contiene un esempio JS bug-finding). **Live feature panel** (appare mentre l'utente scrive, debounced 400ms): "Feature Estratte" grid con Domain / Length / Tokens / Complexity / hasCode / hasMath / hasLogic, + Complexity Progress bar. "Route" button. Result toast: PRIMARY success / ENSEMBLE o CRITIC warning

2. **Storico Decisioni** — List (h-96). Ogni entry card colorata per route (`primary`=emerald bg, `ensemble`=amber bg, `critic`=violet bg). Row: agentId badge, route label badge (color-coded), primary-model badge OR lista ensemble-model badges, timestamp. Sotto: 3-col mini-grid con conf / margin / diversity mono values. Optional truncated `→ finalOutput` italic line

**Route style map:** primary=emerald, ensemble=amber, critic=violet

**Live data:** `useEffect([prompt])` con 400ms `setTimeout` chiama `/api/router?action=features&prompt=...` per ricalcolare le feature live mentre l'utente scrive

**Related:** phase10, phase3, phase11, phase4

### 14.15 Tabella riepilogativa fasi

| # | Titolo | Categoria | Icona | Tabs | Live | Pattern UI primario |
|---|---|---|---|---|---|---|
| 1 | Memory & State | foundation | Database | 4 | No | KPIs + forms + JSON tree + XML block + DAG list |
| 2 | Planner & Compiler | orchestration | Workflow | 3 | No | LLM gen + DAG visualizer + 4-stage pipeline grid |
| 3 | Cognitive Steering | cognitive | Compass | — | Sì (1500ms) | Live state + colored strategy callout + audit log |
| 4 | Verification & Taint | trust | ShieldCheck | 5 | No | 5 test panels + severity-colored lists |
| 5 | Reflective Learning | learning | Sparkles | 4 | No | Reflection form + RAG + heuristic library + red-line list |
| 6 | Context Manager | foundation | Scissors | 4 | Re-fetch agent | KPIs + ring-buffer + policy + RAG |
| 7 | Trace Validator | orchestration | GitFork | 4 | Re-fetch wf | Trace capture + PTA graph + validate box |
| 8 | Formal Verifier | trust | FunctionSquare | 5 | No | Plan selector + 2-step verify + Lean4 + LeanEvolve |
| 9 | Human Retainer | governance | UserCog | 4 | No | Delegation + HITL gates + normative + audit ledger |
| 10 | Model Encapsulator | cognitive | Boxes | 2 | No | Minimal: call form + session history |
| 11 | Affect Monitor | cognitive | HeartPulse | 2 | Re-fetch agent | Telemetry form + dual-progress history |
| 12 | Objective Builder | orchestration | Target | 3 | No | BFS tree + React Flow + explore list |
| 13 | Swarm Coherence | trust | Network | 3 | No | Belief + sync + quorum voting |
| 14 | Model Router | infrastructure | Shuffle | 2 | Sì (400ms) | Prompt + live feature panel + colored history |

---

## 15. Componenti Condivisi

### 15.1 Architecture Map

`src/components/agentic/architecture-map.tsx` — Mappa visuale navigabile di tutte le 14 fasi organizzate per categoria.

**Layout:** `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2` (responsive 2→7 colonne).

7 categorie in ordine fisso: foundation, orchestration, cognitive, trust, learning, governance, infrastructure.

Ogni categoria è una colonna con:
- Header colorato `text-[10px] font-medium uppercase tracking-wide pb-1.5 border-b` (colore da `CATEGORY_COLORS[cat]`)
- Lista di fase button:
  ```tsx
  <button className={cn('w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all',
    active ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-accent/50')}>
    <Icon className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
    <span className={cn('text-xs leading-tight truncate', active && 'font-medium')}>{p.name}</span>
  </button>
  ```

Click → `setActivePhase(p.id)` (Zustand). Stato attivo: tint primary + ring, icona primary, text medium.

**Compattissimo:** text-[10px] header, text-xs label, size-3.5 icon, py-2 padding. Pura navigazione, no data display.

### 15.2 Category KPIs

`src/components/agentic/category-kpis.tsx` — Grid 7-col di KPI compatti sulla dashboard.

**Layout:** `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3`.

Ogni categoria è un div clickable (`cursor-pointer group`):
- Label categoria: `text-[10px] font-medium uppercase tracking-wide mb-2` colorato
- Metric list: `space-y-1.5`, ogni row `flex items-baseline justify-between`:
  - Label: `text-[11px] text-muted-foreground`
  - Value: `text-sm font-mono font-semibold tabular-nums` colorato per tone:
    - `ok` + value >0 → emerald
    - `warn` → amber
    - `danger` → red
    - no tone → foreground

**Categorie e metric:**

| Categoria | Colore | Fase primaria | Metric |
|---|---|---|---|
| Foundation | sky | phase1 | Episodi, Context, Tok salvati (ok) |
| Orchestration | emerald | phase2 | Piani, Tracce, Alberi |
| Cognitive | violet | phase3 | Steering, Sessioni, Allerte (danger se >0) |
| Trust | red | phase4 | LTL ev, Contratti, Quorum (ok) |
| Learning | amber | phase5 | Euristiche, Riflessioni |
| Governance | pink | phase9 | Deleghe, Gates (warn se >0), Tool |
| Infra | cyan | phase14 | Routing, Primary (ok), Errors (danger se >0) |

Click → naviga alla fase primaria della categoria.

### 15.3 Live Feed

`src/components/agentic/live-feed.tsx` — Stream real-time compatto dal WebSocket Sensorium, mostra gli ultimi 15 eventi con connection status, level indicator e timestamp italiani.

**Header:** `<Radio>` icon (emerald se connesso, muted se no) + label "Live Events" / "Disconnesso"

**Empty state:** "In attesa di eventi…" italico

**Event list:** `space-y-1 max-h-48 overflow-y-auto`, ogni event row:
```tsx
<div className="flex items-center gap-2 text-xs py-1">
  <span className={cn('size-1.5 rounded-full shrink-0',
    e.level === 'warn' || e.level === 'error' ? 'bg-amber-500' : 'bg-emerald-500')} />
  <span className="text-muted-foreground font-mono text-[10px] shrink-0">P{e.phase}</span>
  <span className="font-mono text-[10px] shrink-0 text-muted-foreground">{e.agentId}</span>
  <span className="font-mono text-[11px] truncate">{e.event}</span>
  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
    {new Date(e.ts).toLocaleTimeString('it-IT')}
  </span>
</div>
```

Feed style densissimo, log-like: dot piccoli, mono font, 10–11px text. Color coding minimale: amber per warn/error, emerald per info/ok. Max height 192px con vertical scroll.

### 15.4 DAG Visualizers

`src/components/agentic/dag-visualizers.tsx` — Tre visualizzatori React Flow:
1. `DynAMODagVisualizer` (Phase 2 plans)
2. `ObjectiveTreeVisualizer` (Phase 12)
3. `LeanWorkflowVisualizer` (Phase 8)

**Libreria:** `reactflow` con `Background`, `Controls`, `MiniMap`.

#### DynAMO node

```tsx
<div className="rounded-md border-2 bg-card p-2 shadow-sm min-w-[160px]">
  {/* Header: status dot + taskId mono + agent color dot */}
  {/* Body: 2-line clamped description + status badge */}
</div>
```

Border color = `STATUS_COLOR[status]`: done `#10b981`, running `#0ea5e9`, failed `#ef4444`, pending `#a3a3a3`, ready `#f59e0b`.

Agent color dot da `AGENT_COLOR`: orchestrator green, curator sky, controller violet, verifier amber, reflective pink.

Handle top (target) e bottom (source) — flow top-down.

#### Objective node

`min-w-[180px] max-w-[240px]`. Header badge `L{depth}`, tier badge colorato (`TIER_NODE_COLOR`: strategic sky, methodological violet, implementation emerald), `w={weight.toFixed(3)}` mono. Border = tierColor quando pending, else statusColor (pass emerald, fail red, skipped zinc, pending indigo).

#### Lean node

`min-w-[140px]`, border = verified emerald else red. Mostra `pre: N · post: M`. Handle side (`Position.Left`/`Position.Right`) — flow orizzontale.

#### Edge styling

- Default stroke `#94a3b8` (slate-400), `strokeWidth: 1.5`
- `animated: true` quando:
  - DynAMO: target task è `running`
  - Lean: contract `verified === false`
- Lean edges color-match verification state (green o red)

#### Interactive features

- `fitView` auto-zoom su mount
- `Controls showInteractive={false}` — zoom/pan ma no interactive-node toggle
- `MiniMap` con custom `nodeColor` callback per DynAMO
- `Background variant={BackgroundVariant.Dots} gap={12} size={1}` — grid dotted
- `proOptions={{ hideAttribution: true }}` — nasconde watermark React Flow
- Pan/zoom/drag-node abilitati di default

#### Layout algorithm (custom, no dagre)

**DynAMO:** manuale da batch index:
```tsx
const x = b * 220           // 220px colonna per batch
const y = (cursor - total / 2) * 120  // centra verticalmente nel batch
```

**Objective tree:** gerarchico left-to-right:
```tsx
const x = n.depth * 240
const y = (cursor - total / 2) * 100
```

**Lean:** topological sort via DFS visit, poi linear orizzontale:
```tsx
const x = idx * 200  // idx da topo order
const y = 0
```

#### Empty state

Tutti e 3 i renderer restituiscono placeholder centrato italico:
```tsx
<div className="text-xs text-muted-foreground italic p-8 text-center border rounded-md">
  Nessun task da visualizzare. Genera un piano DynAMO.
</div>
```

### 15.5 PhaseHeader

`src/components/agentic/phase-header.tsx` — Header riutilizzabile usato in cima a ogni `phaseN.tsx`.

```tsx
<div className="flex items-center justify-between gap-4 pb-5">
  <div className="flex items-center gap-3">
    <Icon className={cn('size-5', CATEGORY_COLORS[meta.category] || 'text-primary')} />
    <div>
      <h1 className="text-lg font-semibold tracking-tight leading-tight">{meta.name}</h1>
      <p className="text-xs text-muted-foreground mt-0.5">{meta.subtitle}</p>
    </div>
  </div>
  {action}
</div>
```

Esporta anche `PhaseKpi` e `PhaseKpiGrid` helpers (attualmente non usati — ogni fase definisce la propria `StatCard` locale).

### 15.6 RelatedPhases

`src/components/agentic/related-phases.tsx` — Card riutilizzabile in fondo a ogni phase page che mostra fasi correlate come button outline, abilitando navigazione end-to-end con state transfer opzionale via `sessionStorage`.

```tsx
<Card className="border-dashed">
  <CardTitle><Link2 /> Fasi collegate</CardTitle>
  <CardDescription>Naviga nel flusso end-to-end dell'architettura</CardDescription>
  <CardContent>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      {links.map(link => (
        <Button variant="outline" size="sm" onClick={() => navigate(link)}>
          <Icon className="size-4 shrink-0 mt-0.5 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium flex items-center gap-1">
              {link.label} <ArrowRight className="size-3 text-muted-foreground" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{link.reason}</div>
          </div>
        </Button>
      ))}
    </div>
  </CardContent>
</Card>
```

**State transfer mechanism:**
- Click → `sessionStorage.setItem('phase_transfer_<phase>', JSON.stringify({...transferState, _ts: Date.now()}))`
- Fase target legge via `consumeTransferState(phase)` che auto-rimuove la key ed expire dopo 60s

**Flussi architetturali** (`ARCHITECTURE_FLOWS`, esportato, usato da `ArchitectureMap`):
- Plan → Verify → Deploy (emerald)
- Cognitive Cycle (violet)
- Open Objective (amber)
- Trust Enforcement (red)
- Swarm Consensus (cyan)
- Failure Recovery (pink)

### 15.7 Branding Showcase

`src/components/agentic/branding-showcase.tsx` — Card singola che mostra il brand identity kit SOTA.

Sezioni:
1. **Logo showcase grid** — 4 tile aspect-square (`logo-transparent`, `og-image 1200×630`, `favicon.ico`, "color tokens" gradient)
2. **Palette colori** — 5-col grid con swatch `h-12 rounded-md border` e hex mono: `#0a0a2e`, `#3a1e6a`, `#00d4ff`, `#ffffff`, `#c0c0c0`
3. **Asset list** — grid 2-col/3-col con ~20 filename mono (`logo-primary-1024.png`, `logo-vector.svg`, etc.)
4. **Footer button** — link a `/download/branding/logo-vector.svg` (SVG Vector) e `/download/branding/color-palette.json` (Palette JSON), entrambi `target="_blank" rel="noopener noreferrer"`

---

## 16. Hook Condivisi

### 16.1 useSensoriumLive

`src/components/agentic/use-sensorium-live.ts` — Custom hook che mantiene una singola connessione socket.io al event bus ed espone snapshot Sensorium real-time, agent events, e state diffs.

```ts
type LiveState = {
  connected: boolean
  sensorium: SensoriumLive | null
  events: AgentEventLive[]      // newest first, max 50
  diffs: StateDiffLive[]        // newest first, max 30
}
```

**Connection setup:**
```ts
const socket = io('/?XTransformPort=3003', {
  transports: ['websocket', 'polling'],
  forceNew: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1500,
  timeout: 10000,
})
```

- Namespace: `/` con query param `XTransformPort=3003`
- Transports: WebSocket first, fallback polling
- Auto-reconnect 10 volte con 1.5s delay, 10s connect timeout
- `forceNew: true` → ogni mount ha un socket fresco

**Subscriptions:**
```ts
socket.emit('subscribe', ['sensorium', 'agent_event', 'state_diff'])
```

**Event handlers:**
- `sensorium` → rimpiazza `state.sensorium` con l'ultimo snapshot (cycleId, xml, queueDepth, activeThreads, systemLoad, ts)
- `agent_event` → **prepend** in `state.events`, capped at `MAX_EVENTS = 50`
- `state_diff` → **prepend** in `state.diffs`, capped at `MAX_DIFFS = 30`
- `disconnect` → `connected: false` (preserva eventi buffered)

**Consumatori:**
- `agent-console.tsx` → `events` (solo `[0]` durante executing) per live log
- `cockpit.tsx` → `sensorium` per il widget persistente
- `sovereign-modal.tsx` → `events` per detect `action_blocked` e trigger polling immediato

### 16.2 useDashboard

`src/components/agentic/use-dashboard.ts` — Hook polling che fetcha statistiche aggregate su tutte le 14 fasi ogni 5 secondi.

```tsx
export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const r = await fetch('/api/dashboard')
      const d = await r.json()
      setData(d)
    } catch (e) {
      console.error('dashboard fetch failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])

  return { data, loading, refresh }
}
```

**Data shape (`DashboardData`):** Singolo oggetto "fat" con blocchi stat per-phase:
- `phase1`: episodic, semantic, logical memory + patches + accepted/rejected
- `phase2`: plans, planTasks, compiledArtifacts, deployedArtifacts
- `phase3`: steeringEvents
- `phase4`: verificationEvents, verifRejects, verifWarns, taintRecords, blockedTaints
- `phase5`: heuristics, reflections, redLineFlags
- `phase6`: activeCalls, evictedCalls, summaries, totalTokensSaved
- `phase7`: traces, ptas, validations, avgCoverage, acceptRate
- `phase8`: contracts, verifiedContracts, verifiedWorkflows, deployedWorkflows, evolveEvents, successfulEvolve
- `phase9`: activeDelegations, totalDelegations, pendingGates, resolvedGates, approvedGates, rejectedGates, auditEntries, normativeResolutions, blockedResolutions
- `phase10`: sessions, executed, sandboxBlocked, policies
- `phase11`: samples, agents, interventions, avgDesperation, avgFrustration
- `phase12`: trees, nodes, completedTrees, passNodes, failNodes
- `phase13`: beliefs, syncEvents, conflicts, quorumDecisions, acceptedQuorum, rejectedQuorum
- `phase14`: decisions, ensemble, critic, primary, topModel, topModelPct
- `recentLogs`: array di `{ id, agentId, phase, event, level, timestamp }`
- `agentLogsTotal`, `memoryStats: { episodic, semantic, logical, avgDecay }`

**Error handling:** `try/catch` logga in console ma non propaga all'UI. Su errore, `data` mantiene il valore precedente (o resta null); `loading` flips a false in `finally`. No retry/backoff.

### 16.3 useI18n

`src/lib/use-i18n.ts` — Client hook per i18n custom.

```ts
export function useI18n(): {
  lang: Lang,                        // 'it' | 'en'
  setLang: (l: Lang) => void,        // persiste in localStorage
  t: (key: string) => string         // re-bound quando lang cambia
}
```

- **Initial state:** `'it'` (server-render default — evita hydration mismatch)
- **Hydration effect:** legge `localStorage['sota_lang']`; se assente, controlla `navigator.language` e switcha a `'en'` se browser inizia con `en`
- **Persistence:** `setLang` scrive `sota_lang` in localStorage
- **No provider/context** — ogni componente chiama `useI18n()` indipendentemente

### 16.4 useToast

`src/hooks/use-toast.ts` — State machine toast singleton (no React context).

- `TOAST_LIMIT = 1` (un toast alla volta)
- `TOAST_REMOVE_DELAY = 1000000` ms (~16 min, mai auto-rimossi)
- Module-level state: `memoryState`, `listeners[]`, `dispatch()`
- Actions: `ADD_TOAST`, `UPDATE_TOAST`, `DISMISS_TOAST`, `REMOVE_TOAST`
- Exports: `useToast()` hook + standalone `toast()` function

### 16.5 useIsMobile

`src/hooks/use-mobile.ts` — Mobile detection hook.

```ts
const MOBILE_BREAKPOINT = 768
export function useIsMobile(): boolean
```

- SSR-safe: initial state `undefined` → returns `false` via `!!isMobile`
- Usa `window.matchMedia('(max-width: 767px)')` + resize listener
- Allineato con Tailwind `md` breakpoint

---

## 17. Pattern UX Trasversali

### 17.1 Struttura uniforme delle pagine fase

Tutti i 14 moduli di fase seguono lo stesso scheletro:
1. `<PhaseHeader phaseId="phaseN" action={<RefreshButton />} />`
2. KPI strip (2–5 StatCard in grid responsive)
3. `<Tabs>` con `grid grid-cols-N w-full` TabsList
4. Tab content con card/form/liste
5. `<RelatedPhases links={[...]} />` in fondo

Questo dà una forte coerenza visiva nonostante la diversità funzionale.

### 17.2 StatCard pattern

Mini-card con icona + valore mono + label uppercase:

```tsx
function StatCard({ icon: Icon, label, value, highlight, warn }) {
  return (
    <div className="bg-card border rounded-md p-3">
      <Icon className="size-4 text-muted-foreground mb-1" />
      <div className={cn('text-2xl font-bold font-mono',
        highlight && 'text-emerald-600 dark:text-emerald-400',
        warn && value > 0 && 'text-amber-600 dark:text-amber-400')}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}
```

**NOTA:** Esiste un componente `PhaseKpi`/`PhaseKpiGrid` condiviso in `phase-header.tsx` ma non è usato — ogni fase definisce la propria `StatCard` locale (~5 linee di variazione).

### 17.3 Empty state

Ogni lista/tabella ha un empty state italico muted:
- "Nessun episodio. Inizializza il sistema o registrane uno."
- "Nessuna regola."
- "Nessuna traccia."
- "Nessun belief."
- "Nessuna sessione. Esegui una chiamata incapsulata."

Pattern CSS: `text-xs text-muted-foreground italic`.

Il Cockpit Safety tab ha un empty state "positivo" distintivo:
```
✓ (CheckCircle2 emerald)
"Nessuna azione bloccata. Il sistema è in salute."
```

### 17.4 Color semantics

Sistema colore coerente across tutta l'app:

| Colore | Significato | Esempi |
|---|---|---|
| emerald | success / pass / accept / approved / deployed / synced | task done, LTL accept, gate approved |
| sky | info / running / PLAN strategy / strategic tier | task running, default info |
| amber | warn / pending / partial / blocked | LTL warn, pending gate, sandbox blocked |
| red | error / failed / reject / blocked / irreversible | task failed, LTL reject, RED LINE |
| violet | reflect / ensemble / dominators / methodological tier | REFLECT strategy, ensemble route |
| zinc | neutral / disabled | log severity info, default badges |
| pink | governance / HITL | Human Retainer category |
| cyan | infrastructure / brand accent | Model Router category, login accent |

### 17.5 Monospace usage

`font-mono` viene applicato consistentemente a:
- Tutti gli ID (taskId, agentId, cycleId, planId, workflowId)
- Formule LTL e codice
- JSON payload (in `<pre>` o `<code>`)
- Token count, versioni, signature
- Timestamp quando compatti (10–11px)
- Hex colori branding

Questo dà all'app l'estetica devtool/IDE desiderata.

### 17.6 Refresh pattern

- **Manuale**: ogni phase ha un button "Aggiorna" (`<RefreshCw>` icon, `variant="outline" size="sm"`) nello `PhaseHeader` action slot
- **Polling**: solo useDashboard (5s) e AffectGauge cockpit (5s) e SovereignModal pending check (5s)
- **Re-fetch su change**: phase 6 (agentId), phase 7 (workflowId), phase 11 (agentId), phase 13 (agentId)
- **WebSocket push**: solo useSensoriumLive per Console live log, Cockpit sensorium widget, SovereignModal blocked action

### 17.7 Toast feedback

Tutte le mutazioni restituiscono feedback via toast:
- `toast.success('Azione completata')`
- `toast.error(d.error || 'Errore')`
- `toast.info('HALT: budget esaurito')`
- `toast.warning('Red Line: <reason>')`

### 17.8 Form patterns

- Tutti i form usano shadcn/ui `Input`, `Textarea`, `Label`, `Select`, `Switch`
- Layout tipico: `grid md:grid-cols-2 gap-3` per form compatti, `space-y-3` per form verticali
- Validazione client-side minimale: campi required check, JSON.parse per textareas JSON
- Submit button sempre in fondo al form, full-width su mobile

### 17.9 List patterns

- Liste lunghe: `<ScrollArea className="h-72|h-80|h-96">` con height fissa
- Liste corte: `<ul className="space-y-2">`
- Ogni list item è tipicamente un `<li className="text-xs border rounded-md p-2.5">` con:
  - Badge row (status, IDs)
  - Description text
  - Timestamp + meta info

---

## 18. Accessibilità

### 18.1 Feature implementate

| Feature | Dove |
|---|---|
| **Focus-visible rings** | Button (3px ring), Badge, DialogClose (`focus:ring-2 focus:ring-offset-2`), SidebarMenuButton, ToastClose |
| **`aria-invalid` styling** | Button + Badge (`aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive`) |
| **Screen-reader labels** | Dialog close (`<span className="sr-only">Close</span>`), SidebarTrigger (`sr-only "Toggle Sidebar"`), SidebarRail (`aria-label="Toggle Sidebar"`), mobile sidebar Sheet header sr-only |
| **Keyboard shortcuts** | Cmd/Ctrl+B toggle sidebar |
| **`data-state` attributes** | `open/closed` su dialogs/toasts/sheets, `active` su tabs/menu buttons, `selected` su table rows, `expanded/collapsed` su sidebar |
| **`data-slot` attributes** | Tutti i Card e Sidebar subcomponents → abilita `has-data-[slot=...]` parent-state styling |
| **Skip / sr-only headers** | Mobile sidebar Sheet ha `<SheetHeader className="sr-only">` |
| **Tooltips** | Auto-shown solo in collapsed-icon sidebar mode; `delayDuration={0}` per feedback istantaneo |
| **Drawer/Sheet** | Mobile sidebar usa Radix Sheet con title/description (sr-only) per a11y |
| **Tablist semantics** | `[role="tab"]` selector con explicit `data-state="active"` transition |
| **`disabled` / `aria-disabled`** | Button e sidebar menu buttons rispettano entrambi: `disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50` |

### 18.2 Gap di accessibilità da indirizzare

1. **`<html lang>` hardcoded a `"it"`** — dovrebbe aggiornarsi dinamicamente quando l'utente switcha a EN (per screen reader)
2. **No `prefers-reduced-motion` handling** — `fadeIn` e dialog zoom animations girano sempre; considerare `motion-reduce:` variants
3. **Sonner Toaster inutilizzato** — se adottato, sostituire la shadcn `<Toaster/>` per evitare regioni aria-live duplicate
4. **Sidebar `outline` variant** reference `hsl(var(--sidebar-border))` che non risolve sotto OKLCH tokens — puramente cosmetico ma da fixare
5. **Sovereign Modal** blocca ESC/dismiss via `onOpenChange={() => {}}` — considerare di confermare l'intento o fornire un'azione "Defer"
6. **Console Agentica** non ha tasti rapidi per azioni comuni (es. focus sulla textarea, clear conversation)

---

## 19. Internazionalizzazione

### 19.1 Implementazione

Sistema custom zero-dependency (no `next-intl`, no `react-i18next`, no ICU).

**Lingue supportate:** `it` (default, primaria), `en` (secondaria)

**File:** `src/lib/i18n.ts` (registry) + `src/lib/use-i18n.ts` (hook client)

**API:**
```ts
export type Lang = 'it' | 'en'
export const translations: Record<Lang, Record<string, string>>
export function t(key: string, lang: Lang = 'it'): string
```

**Fallback chain:** `translations[lang][key]` → `translations.en[key]` → `key` itself

### 19.2 Namespaces (flat dot-notation)

| Prefisso | Coverage |
|---|---|
| `sidebar.*` | Kernel status |
| `topbar.*` | Cycle / Load / Queue / Threads / Logout |
| `overview.*` | Title, description, refresh, seed, empty state, architecture map, quick actions, audit log |
| `qa.*` | Plan task / Validate trace / Request approval / Route prompt (label + desc pairs) |
| `cat.*` | 7 phase categories: foundation, orchestration, cognitive, trust, learning, governance, infrastructure |
| `login.*` | Auth screen |
| `common.*` | refresh, save, cancel, delete, install, create, execute, validate, pending, no_data, related_phases, related_desc |

### 19.3 Behavior

- **Initial state:** `'it'` (server-render default — evita hydration mismatch)
- **Hydration effect:** legge `localStorage['sota_lang']`; se assente, controlla `navigator.language` e switcha a `'en'` se browser inizia con `en`
- **Persistence:** `setLang` scrive `sota_lang` in localStorage
- **No provider/context** — ogni componente chiama `useI18n()` indipendentemente

### 19.4 Coverage

⚠️ **Gap importante:** mentre il registry i18n è definito, la maggior parte dei componenti agentic usa stringhe italiane hardcoded. Il toggle EN/IT nel topbar funziona a livello di storage ma non tutti i componenti reagiscono al cambio lingua.

In particolare:
- ✅ Login page: usa `t('login.*')` keys
- ✅ Topbar: usa `t('topbar.*')` per i label
- ❌ Tutte le 14 fasi: stringhe italiane hardcoded (es. "Aggiorna", "Nessun episodio.")
- ❌ Console Agentica: stringhe hardcoded
- ❌ Cockpit: stringhe hardcoded

### 19.5 Brand invariant

Il product label "SOTA Agentic OS" è invariant across languages. Lo `<html lang>` è hardcoded a `"it"` e non si aggiorna dinamicamente.

---

## 20. Osservazioni e Raccomandazioni

### 20.1 Punti di forza

1. **Coerenza visiva eccellente** — Tutte le 14 fasi condividono lo stesso scheletro PhaseHeader → KPI strip → Tabs → RelatedPhases, dando una sensazione unificata nonostante la diversità funzionale.

2. **Color coding semantico rigoroso** — Il sistema emerald/sky/amber/red/violet/zinc è applicato consistentemente across tutti i moduli, rendendo il riconoscimento degli stati istantaneo.

3. **Empty states uniformi e presenti** — Ogni lista ha un empty state italico muted; il Safety tab del Cockpit ha anche un empty state "positivo" distintivo (✓ "sistema in salute").

4. **Dark mode first-class** — next-themes con class strategy, tutte le classi colore hanno variante `dark:`, no flash di tema grazie a `disableTransitionOnChange` + `suppressHydrationWarning`.

5. **Branding cinematografico** — La login page con pannello split navy/ciano + grid CSS decorativa è distintiva e memorabile.

6. **Real-time ben bilanciato** — WebSocket push per eventi critici (Console live log, Cockpit sensorium, SovereignModal blocked actions), HTTP polling 5s per statistiche aggregate, refresh manuale per il resto. Nessun sovraccarico di polling non necessario.

7. **Console Agentica ben disegnata** — UI conversazionale ChatGPT-style con avatar brand, live execution con log terminal-style, ResultCard espandibile con DAG, errori strutturati con suggerimenti, gestione robusta di network failure.

### 20.2 Aree di miglioramento

#### Architettura tecnica

1. **Tailwind v3/v4 split** — `tailwind.config.ts` è vestigiale (manca `./src` nel content, hsl wrappers confliggono con OKLCH). Migrare completamente a v4 o rimuovere il config JS.

2. **Doppia implementazione toast** — shadcn Radix Toast attivo + Sonner definito ma non montato. Sceglierne uno (consigliato Sonner per API più ricca) e rimuovere l'altro.

3. **`StatCard` duplicato 14 volte** — Ogni fase definisce la propria `StatCard` locale invece di usare `PhaseKpi`/`PhaseKpiGrid` già esistenti in `phase-header.tsx`. Unificare.

4. **`useDashboard` race condition** — Nessun AbortController; se una fetch è lenta, multiple request possono race e l'ultima vince. Aggiungere abort su unmount/overlap.

#### UX

5. **Cockpit filtri mancanti** — Il Log tab description promette "filtri per fase/agente/livello" ma non esiste UI filtri. Implementare Select-based filters.

6. **Loading states inconsistenti** — Cockpit tabs e Tool Manager non hanno loading spinner. Aggiungere Skeleton placeholders per perceived performance.

7. **Console Agentica DAG deps** — La ResultCard passa `dependencies: []` a `DynAMODagVisualizer`, perdendo i veri edge di dipendenza. Includere i dati reali per renderizzare il DAG correttamente.

8. **Phase 9 Audit Ledger denso** — È la schermata più densa (540 linee di codice). Benefirebbe di filtri/search controls per trovare entry specifiche.

9. **Phase 3 layout break pattern** — È l'unica fase senza Tabs wrapper; il suo layout 3-col rompe il rhythm visivo. Considerare se mantenerla eccezione o rifattorizzare.

10. **No error boundaries** — Non c'è un error boundary globale visibile. Un crash in un componente fase può rompere l'intera app.

#### Accessibilità

11. **`<html lang>` dinamico** — Should update quando l'utente switcha a EN. Attualmente hardcoded `"it"`.

12. **`prefers-reduced-motion`** — `fadeIn` e dialog zoom animations girano sempre. Aggiungere fallback `motion-reduce:`.

13. **Sovereign Modal escape block** — `onOpenChange={() => {}}` blocca ESC/dismiss. Considerare conferma intento o azione "Defer".

#### i18n

14. **i18n coverage parziale** — Solo login e topbar usano realmente `t()`. Le 14 fasi, la Console e il Cockpit hanno stringhe italiane hardcoded. Per supportare EN realmente, è necessario estrarre tutte le stringhe.

15. **No pluralization** — Il sistema custom non gestisce plurali (es. "1 task" vs "3 task"). Per ora si usano workaround come "N task".

#### Branding

16. **Colori branding non allineati** — La login usa navy `#0a0a2e` + ciano `#00d4ff`, ma l'app autenticata usa viola indaco `oklch(0.45 0.18 270)`. Questa inconsistenza è voluta (cinematic vs functional) ma potrebbe confondere. Considerare un ponte visivo (es. mantenere il ciano come accent anche nell'app).

17. **Branding Showcase isolato** — Il componente `branding-showcase.tsx` esiste ma non è referenziato in nessuna route visibile. Considerare se esporlo in una pagina "About" o nel profilo utente.

### 20.3 Roadmap suggerita

| Priorità | Item | Sforzo |
|---|---|---|
| Alta | Unificare `StatCard` usando `PhaseKpi`/`PhaseKpiGrid` esistenti | Basso |
| Alta | Risolvere Tailwind v3/v4 split | Medio |
| Alta | Aggiungere filtri Cockpit (fase/agente/livello) | Medio |
| Alta | Scegliere un toast system (Sonner) e rimuovere l'altro | Basso |
| Media | Aggiungere loading skeleton nei Cockpit tabs e Tool Manager | Medio |
| Media | Passare `dependencies` reali al DAG visualizer della Console | Basso |
| Media | Aggiornare `<html lang>` dinamicamente | Basso |
| Media | Aggiungere `prefers-reduced-motion` fallback | Basso |
| Media | Error boundary globale | Medio |
| Bassa | Estendere i18n a tutte le 14 fasi | Alto |
| Bassa | Filtri/search nel Phase 9 Audit Ledger | Medio |
| Bassa | Rifattorizzare Phase 3 per allinearla al pattern Tabs | Medio |
| Bassa | Esplorare ponte visivo tra login branding e app branding | Basso |

---

## Appendice A: File Map

### Componenti principali (`src/components/agentic/`)

| File | Ruolo |
|---|---|
| `sidebar.tsx` | Sidebar desktop + MobileNav |
| `topbar.tsx` | Topbar con theme/lang/user toggle |
| `overview.tsx` | Dashboard home (orchestra ArchitectureMap + CategoryKpis + LiveFeed) |
| `agent-console.tsx` | Console conversazionale ChatGPT-style |
| `cockpit.tsx` | Cockpit operazioni real-time (5 tabs) |
| `tool-manager.tsx` | Admin tool firmati ECDSA |
| `sovereign-modal.tsx` | Dialog globale HITL blocked actions |
| `ltl-normative-editor.tsx` | Editor regole LTL + assiomi normative |
| `architecture-map.tsx` | Mappa 7-col navigabile delle fasi |
| `category-kpis.tsx` | Grid 7-col KPI categorie |
| `live-feed.tsx` | Stream real-time eventi Sensorium |
| `dag-visualizers.tsx` | 3 visualizzatori React Flow (DynAMO, Objective, Lean) |
| `phase-header.tsx` | Header riutilizzabile per le fasi |
| `related-phases.tsx` | Card link a fasi correlate |
| `branding-showcase.tsx` | Card brand identity kit |
| `phase1.tsx` ... `phase14.tsx` | 14 moduli di fase |
| `use-sensorium-live.ts` | Hook WebSocket Sensorium |
| `use-dashboard.ts` | Hook polling dashboard 5s |

### UI primitives (`src/components/ui/`)

41 componenti shadcn/ui installati: `accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip`.

### Lib (`src/lib/`)

| File | Ruolo |
|---|---|
| `store.ts` | Zustand store con `activePhase`, `setActivePhase`, `PHASES`, `CATEGORY_LABELS`, `CATEGORY_COLORS` |
| `i18n.ts` | Registry traduzioni IT/EN |
| `use-i18n.ts` | Client hook per i18n |
| `phase-icons.ts` | Map phase ID → lucide icon |
| `utils.ts` | `cn()` + `generateTimeSortableId()` |
| `db.ts` | Prisma client |
| `embeddings.ts` | Embedding vector per RAG |
| `ws-publish.ts` | Helper pubblicazione WS |
| `auth/session.ts` | Session cookie auth |
| `auth/rbac.ts` | Role-based access control |
| `kernel/*.ts` | 24 moduli kernel (erl, ltl-monitor, scheduler, curator, acts, etc.) |

### Hooks (`src/hooks/`)

| File | Ruolo |
|---|---|
| `use-toast.ts` | Toast state machine singleton |
| `use-mobile.ts` | Mobile detection (768px breakpoint) |

---

## Appendice B: API Routes (32 totali)

| Route | Metodo | Scopo |
|---|---|---|
| `/api/auth` | GET/POST | Status + login/logout |
| `/api/dashboard` | GET | Aggregate stats tutte le fasi |
| `/api/console` | POST | Esegui task conversazionale |
| `/api/cockpit` | GET | Cockpit data (narrative, log, scheduler, cycles, safety) |
| `/api/plan` | GET/POST | DynAMO plan generation |
| `/api/verify` | POST | LTL preview FSM, normative evaluation |
| `/api/steering` | POST | Cognitive steering step |
| `/api/reflect` | POST | ERL reflection |
| `/api/context` | GET/POST | Context manager (ring buffer) |
| `/api/retainer` | GET/POST | HITL gates, delegations, audit |
| `/api/tools` | GET/POST | Tool manager (install, revoke, set_permission) |
| `/api/sensorium` | GET | Sensorium snapshot |
| `/api/affect` | GET | Affect metrics stats |
| `/api/router` | GET/POST | Model router decisions + features |
| `/api/objective` | POST | Objective tree BFS |
| `/api/compiled` | POST | Compiled AI generation |
| `/api/lean` | POST | Lean4 verification + LeanEvolve |
| `/api/dominator` | GET/POST | PTA + dominators |
| `/api/traces` | GET/POST | Trace capture + validation |
| `/api/grounded` | GET | Grounded inference stats |
| `/api/patchboard` | GET/POST | JSON Patch transactions |
| `/api/memory` | GET/POST | NS-Mem episodes + entities |
| `/api/embeddings` | POST | Embedding generation |
| `/api/esr` | GET/POST | ESR belief sync + quorum |
| `/api/errors` | GET | Error logs |
| `/api/metrics` | GET | System metrics |
| `/api/publishers` | GET | WS publishers status |
| `/api/backup` | GET/POST | DB backup |
| `/api/blocked-actions` | GET/POST | HITL blocked actions queue |
| `/api/seed` | POST | System initialization |
| `/api/jobs` | GET | Background jobs |
| `/api/scalability` | GET | Scalability stats |

---

*Documentazione generata il 21 giugno 2026 da analisi completa del codebase `/home/z/my-project`. Tutti i file UI/UX sono stati letti integralmente. Nessuna modifica al codice è stata effettuata durante la produzione di questo documento.*
