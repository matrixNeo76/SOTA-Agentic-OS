# SOTA Agentic OS — Piano di Redesign Visivo Premium

> **Versione:** 1.0 · **Data:** 2026-06-23 · **Stato:** Pronto per implementazione
> **Ambito:** Trasformazione estetica sistemica di tutta l'UI, schermata per schermata
> **Prerequisiti:** 6 sprint di ristrutturazione architetturale completati (207 test verdi, build OK)

---

## Indice

1. [Diagnosi dello stato attuale](#1-diagnosi-dello-stato-attuale)
2. [Direzione estetica: "Operative Intelligence"](#2-direzione-estetica-operative-intelligence)
3. [Sistema di design premium](#3-sistema-di-design-premium)
4. [Piano di redesign — 7 sprint](#4-piano-di-redesign--7-sprint)
5. [Sprint R1 — Foundation: token, palette, tipografia](#sprint-r1--foundation-token-palette-tipografia)
6. [Sprint R2 — Componenti core: depth, layering, micro-interazioni](#sprint-r2--componenti-core-depth-layering-micro-interazioni)
7. [Sprint R3 — Layout shell: sidebar, topbar, navigazione](#sprint-r3--layout-shell-sidebar-topbar-navigazione)
8. [Sprint R4 — Dashboard & Architecture Map](#sprint-r4--dashboard--architecture-map)
9. [Sprint R5 — Console: chat experience premium](#sprint-r5--console-chat-experience-premium)
10. [Sprint R6 — Cockpit, Canvas, domini Inspect](#sprint-r6--cockpit-canvas-domini-inspect)
11. [Sprint R7 — Modali, forms, stati finali](#sprint-r7--modali-forms-stati-finali)
12. [Criteri di accettazione complessivi](#5-criteri-di-accettazione-complessivi)
13. [Metriche di successo](#6-metriche-di-successo)

---

## 1. Diagnosi dello stato attuale

L'analisi approfondita (50+ file, ~25.000 LOC UI) ha evidenziato un'app **funzionalmente solida ma visivamente mediocre**. Le fondamenta tecniche ci sono (design-tokens.ts, OKLCH, dark mode, accessibility WCAG AA, 8 componenti shared, 4 domini Inspect), ma l'esecuzione visiva è carente.

### 1.1 Punti di forza da preservare
- **Login page branding panel**: split-screen dark con grid ciano + gradient layered + tag mono (LTL/Lean4/ERL/ESR/ACTS/ECDSA)
- **StatusBar compact pills**: dot + icon + label + value tabular-nums con tone colors coerenti
- **Cockpit AffectGauge**: bar con fill color emerald→amber→red dinamico (`transition-all duration-500`)
- **Cockpit SensoriumWidget**: 4-stat mini grid con icon + label + value mono bold
- **MessageBubble ResultCard**: espandibile con header status + step rows + LTL violations + DAG + reflection
- **Command palette**: backdrop blur + zoom-in-95 + slide-in-from-top + footer shortcuts
- **SovereignModal axiom trail**: `border-l-2 border-primary/40` con step badge mono
- **Skeletons dedicati**: 7 skeleton component-specific
- **Accessibility layer**: focus-visible outline, skip-link, prefers-reduced-motion, high-contrast mode
- **ConsoleWelcome capability cards**: 3 cards + 4 suggestion chips con hover

### 1.2 Punti deboli da trasformare
1. **Card troppo piatte**: `shadow-sm` invisibile, niente depth, niente layering, niente border accent
2. **Primary color generico**: viola shadcn-default `oklch(0.45 0.18 270)` = identico a 1000+ progetti, niente identità di marca
3. **Background piatto**: oklch flat senza gradient, texture, o noise
4. **Border radius misti**: 5+ valori non sistematici (Card=xl, Button=md, Dialog=lg, Console=2xl)
5. **Shadow quasi assente**: solo nei modali, app principale piatta
6. **Liste monotonous**: tutti i tab cockpit (Narrative/Log/Scheduler/Cycles) sono `<ul><li>` identici
7. **Form grezzi**: phase1/phase4/phase8 sono Card + Label + Input + Button anonimi
8. **ArchitectureMap come menu**: 7 colonne di bottoni identici, non rappresenta flussi/gerarchia
9. **CategoryKpis senza container**: HTML grezzo senza card
10. **Sidebar attiva debole**: solo `bg-primary/10`, no left-border accent o indicator
11. **PhaseHeader troppo minimal**: icon + title + subtitle, no signature
12. **Console user bubble generica**: `bg-primary text-primary-foreground` = default chat
13. **7 colori categoria arcobaleno**: sky/emerald/violet/red/amber/pink/cyan senza gerarchia visiva
14. **Font-mono saturato**: ogni badge mono → noise
15. **Avatar PNG file**: non vettoriali
16. **Tailwind config dead code**: dichiara HSL ma globals.css usa OKLCH
17. **Token designed but not enforced**: `CATEGORY_COLORS` definiti ma ridefiniti inline in 4+ file
18. **Empty state doppio**: shared `EmptyState` + pattern inline `text-xs italic`
19. **bg-zinc-950 hardcoded** in 8+ componenti per `<pre>` blocks
20. **DynamicIcon helper triplicato** (sidebar, topbar, phase-header)
21. **Shock visivo login → app**: login premium dark, app interna flat

### 1.3 Inconsistenze strutturali
- **Tailwind config morto**: `tailwind.config.ts` dichiara HSL ma `globals.css` usa OKLCH via `@theme inline`
- **FONT_SIZE token mismatch**: `design-tokens.ts` dice `xs: 'text-[10px]'` ma Tailwind `text-xs` = 12px
- **Category colors 4 fonti**: `design-tokens.ts` + `architecture-map.tsx` + `category-kpis.tsx` + `phase-header.tsx`
- **Scrollbar doppia**: custom CSS 6px + Radix ScrollArea w-2.5
- **STATO_TONES duplicati**: `STATUS_TONES` in design-tokens + `SEVERITY_STYLE` inline in phase4

---

## 2. Direzione estetica: "Operative Intelligence"

### 2.1 Concept

> **"Operative Intelligence"** — un'interfaccia che comunica precisione tecnica, profondità operativa e intelligenza calma. Non un prodotto SaaS generico, ma uno **strumento di comando** che ispira fiducia через eleganza sobria e dettagli intenzionali.

L'estetica target si ispira a:
- **Linear** (depth attraverso layering sottile, typography raffinata, dark mode calibrata)
- **Vercel Dashboard** (gerarchia visiva forte, spacing generoso, feedback immediato)
- **Raycast** (command-first, keyboard-native, micro-interazioni curate)
- **Arc Browser** (color accent mirati, animazioni fluid ma non invadenti)
- **Notion AI** (chat experience pulita, empty states accoglienti)

**NON vogliamo**: Material Design flat, Bootstrap generico, Tailwind UI default, shadcn-default purple, gradienti vivaci, glassmorphism eccessivo.

### 2.2 Identità visiva

**Tono**: sofisticato, calmo, tecnico. Come un cockpit di un satellite o un terminale di trading di lusso — denso di informazioni ma mai caotico.

**Firma visiva**:
1. **Depth through layering**, non through shadow pesanti
2. **Accent color mirato** (un solo colore brand, non 7 arcobaleno)
3. **Typography come gerarchia** (scale sistematica, weights intenzionali)
4. **Micro-interazioni ovunque** (hover, focus, active, loading — ogni stato curato)
5. **Negative space generoso** (respiro tra sezioni, non compressione)
6. **Data density elegante** (tanto contenuto, ma organizzato con chiarezza)

### 2.3 Palette direction

**Abbandoniamo**: viola shadcn-default + 7 colori categoria arcobaleno

**Adottiamo**:
- **Primary brand**: blu elettrico profondo `oklch(0.55 0.20 245)` — ispirato al ciano del login `#00d4ff` ma più sofisticato, con chroma più alto per presenza
- **Surface system**: 3 livelli di profondità (base/elevated/overlay) con differenze percettibili
- **Category accent muted**: i 7 colori categoria diventano **tinte desaturate** dello stessohue family, non più saturi a pari intensità
- **Status semantic**: ok/warn/danger/info mantengono semantica ma con chroma ridotto per non competere con il primary
- **Neutral warm**: shift leggero verso warm gray (hue 30-50) invece di cool gray (260) per calore umano

### 2.4 Typography direction

**Mantieni**: Geist Sans + Geist Mono (ottima scelta già fatta)

**Trasformiamo**:
- **Scale sistematica**: 8 step definiti (2xs/xs/sm/base/lg/xl/2xl/3xl) con ratio 1.2
- **Weight intenzionali**: regular per body, medium per UI, semibold per headings, bold per stats/numbers
- **Font-mono mirato**: solo per ID/codici/numeri tabulari, NON per ogni badge
- **Letter-spacing**: tracking-tight per headings larghi, tracking-normal per body, tracking-wide per micro-labels

### 2.5 Principi di esecuzione

1. **Ogni superficie ha depth**: base < elevated < overlay, differenziate da background + border + shadow sottile
2. **Ogni interazione ha feedback**: hover (color shift), focus (ring), active (scale 0.98), loading (skeleton), success (toast), error (shake + toast)
3. **Ogni contenitore ha signature**: non Card anonime, ma contenitori con header accent + content + footer strutturati
4. **Ogni lista ha ritmo**: non `<ul>` uniformi, ma liste con headers, dividers, expand/collapse, empty states dedicati
5. **Ogni form ha carattere**: non Label+Input+Button, ma form con helper text, validation, inline feedback, submit states
6. **Ogni dato ha contesto**: non numeri nudi, ma numeri con trend, comparison, delta, sparkline opzionali
7. **Ogni stato vuoto ha CTA**: non "Nessun elemento", ma "Nessun elemento + perché + cosa fare ora"

---

## 3. Sistema di design premium

### 3.1 Token system unificato

```css
/* === SURFACE SYSTEM (3 livelli depth) === */
--surface-base:     oklch(0.99 0.002 250)     /* app background */
--surface-elevated: oklch(1.00 0.000 250)     /* cards, panels */
--surface-overlay:  oklch(1.00 0.003 250)     /* modals, popovers */

/* Dark mode */
--surface-base:     oklch(0.13 0.012 260)
--surface-elevated: oklch(0.16 0.015 260)
--surface-overlay:  oklch(0.19 0.018 260)

/* === BRAND PRIMARY === */
--brand:        oklch(0.55 0.20 245)    /* electric blue, chroma alto */
--brand-hover:  oklch(0.50 0.22 245)
--brand-active: oklch(0.45 0.24 245)
--brand-soft:   oklch(0.55 0.20 245 / 0.10)   /* bg-brand/10 */

/* === CATEGORY ACCENTS (desaturati, gerarchia visiva) === */
--cat-foundation:     oklch(0.60 0.10 230)   /* sky desaturato */
--cat-orchestration:  oklch(0.60 0.12 160)   /* emerald desaturato */
--cat-cognitive:      oklch(0.60 0.10 290)   /* violet desaturato */
--cat-trust:          oklch(0.60 0.14 25)    /* red-orange desaturato */
--cat-learning:       oklch(0.60 0.10 85)    /* amber desaturato */
--cat-governance:     oklch(0.60 0.10 350)   /* pink desaturato */
--cat-infrastructure: oklch(0.60 0.08 195)   /* cyan desaturato */

/* === STATUS (chroma ridotto, non competono con brand) === */
--status-ok:      oklch(0.60 0.12 160)
--status-warn:    oklch(0.65 0.13 75)
--status-danger:  oklch(0.55 0.18 25)
--status-info:    oklch(0.60 0.12 230)

/* === SHADOW SYSTEM (3 livelli depth) === */
--shadow-sm:  0 1px 2px 0 oklch(0 0 0 / 0.04)
--shadow-md:  0 2px 4px -1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.04)
--shadow-lg:  0 8px 16px -4px oklch(0 0 0 / 0.08), 0 2px 4px -2px oklch(0 0 0 / 0.04)
--shadow-xl:  0 16px 32px -8px oklch(0 0 0 / 0.12), 0 4px 8px -4px oklch(0 0 0 / 0.06)

/* === RADIUS SYSTEM (escalation sistematica) === */
--radius-xs: 4px    /* badges, chips, kbd */
--radius-sm: 6px    /* inputs, buttons */
--radius-md: 8px    /* small cards, list items */
--radius-lg: 12px   /* cards, panels */
--radius-xl: 16px   /* modals, hero cards */
--radius-2xl: 20px  /* command palette, onboarding */
--radius-full: 9999px

/* === TYPOGRAPHY SCALE (ratio 1.2) === */
--text-2xs: 11px   /* micro labels, timestamps */
--text-xs:  12px   /* hints, badges */
--text-sm:  14px   /* body default, UI */
--text-base:16px   /* emphasis body */
--text-lg:  18px   /* section titles */
--text-xl:  20px   /* page titles */
--text-2xl: 24px   /* hero subtitles */
--text-3xl: 32px   /* hero titles */
```

### 3.2 Component primitives — stile target

| Component | Stato attuale | Stato target |
|-----------|---------------|--------------|
| **Card** | `bg-card rounded-xl border shadow-sm` piatta | `bg-elevated rounded-lg border shadow-md hover:shadow-lg transition-shadow` con optional header accent stripe |
| **Button** | `rounded-md shadow-xs` piatta | `rounded-sm shadow-sm hover:shadow-md active:scale-[0.98] transition-all` con varianti brand/outline/ghost/destructive |
| **Input** | `h-9 rounded-md border shadow-xs` | `h-10 rounded-sm border bg-elevated shadow-sm focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all` |
| **Badge** | `rounded-md border px-2 py-0.5` generico | `rounded-xs px-2 py-0.5 font-medium` con 7 varianti semantico-brand |
| **Tabs** | `bg-muted rounded-lg p-0.5` | `bg-base border rounded-md p-1` con active `bg-elevated shadow-sm` + underline accent opzionale |
| **Dialog** | `rounded-lg p-6 shadow-lg` | `rounded-xl p-6 shadow-xl border bg-overlay` con backdrop blur |
| **ScrollArea** | Radix w-2.5 | Custom 8px thumb `bg-border/60 hover:bg-border rounded-full` |

### 3.3 Micro-interazioni standard

```css
/* Hover universale */
.hover-lift {
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
.hover-lift:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

/* Active press */
.press {
  transition: transform 100ms ease;
}
.press:active {
  transform: scale(0.98);
}

/* Focus ring brand */
.focus-brand:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--surface-base), 0 0 0 4px var(--brand);
}

/* Shimmer loading (sostituisce pulse grezzo) */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.shimmer {
  background: linear-gradient(90deg, transparent, oklch(0 0 0 / 0.04), transparent);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

---

## 4. Piano di redesign — 7 sprint

**Durata totale stimata: 21 giorni** (~3 settimane con buffer)

| Sprint | Durata | Focus | Output principale |
|--------|--------|-------|-------------------|
| R1 | 3gg | Foundation: token, palette, tipografia | globals.css + design-tokens.ts riscritti, brand identity applicata |
| R2 | 3gg | Componenti core: Card, Button, Input, Badge, Tabs | Depth system, shadow, micro-interazioni |
| R3 | 3gg | Layout shell: sidebar, topbar, breadcrumb | Navigazione premium con accent indicators |
| R4 | 3gg | Dashboard & Architecture Map | Overview trasformata in "control center" |
| R5 | 3gg | Console: chat experience | Message bubbles, ResultCard, input bar premium |
| R6 | 3gg | Cockpit, Canvas, domini Inspect | Widget elevati, canvas nodes, forms curati |
| R7 | 3gg | Modali, forms, stati finali | Command palette, Sovereign modal, empty/loading/error uniformi |

---

## Sprint R1 — Foundation: token, palette, tipografia

### Obiettivo
Riscrivere il sistema di design foundation per stabilire brand identity, depth system, e scala tipografica sistematica. Tutti i componenti erediteranno automaticamente.

### R1.1 — Riscrittura globals.css (giorno 1)

**Azione**:
- Sostituire palette OKLCH con `surface-base/elevated/overlay` (3 livelli depth)
- Sostituire `--primary` viola con `--brand` blu elettrico `oklch(0.55 0.20 245)` + varianti hover/active/soft
- Aggiungere `--cat-*` desaturati (7 colori categoria con chroma 0.08-0.14 invece di 0.18+)
- Aggiungere `--status-*` con chroma ridotto (0.12-0.18)
- Aggiungere `--shadow-sm/md/lg/xl` system (4 livelli)
- Aggiungere `--radius-xs/sm/md/lg/xl/2xl` (6 livelli escalation)
- Aggiungere `--text-2xs/xs/sm/base/lg/xl/2xl/3xl` (8 step ratio 1.2)
- Shift neutral verso warm gray (hue 30-50 invece di 260)
- Background texture: aggiungere subtle noise SVG (opacità 0.02) per depth non-piatto

**Verifica**: grep `oklch(0.45 0.18 270)` deve restituire 0 risultati (vecchio primary eliminato)

### R1.2 — Aggiornamento design-tokens.ts (giorno 1)

**Azione**:
- Allineare `CATEGORY_COLORS` con nuovi `--cat-*` desaturati
- Aggiungere `SURFACE_COLORS` (base/elevated/overlay)
- Aggiungere `BRAND_COLORS` (brand/hover/active/soft)
- Aggiungere `SHADOW_CLASSES` (sm/md/lg/xl)
- Aggiungere `RADIUS_CLASSES` sistematici
- Correggere `FONT_SIZE` mismatch (xs = text-xs = 12px, non 10px)
- Aggiungere helper `surfaceColor(level)`, `brandColor(variant)`, `shadowClass(level)`

### R1.3 — Eliminazione dead code (giorno 2)

**Azione**:
- Eliminare `tailwind.config.ts` (Tailwind v4 usa `@theme inline`, il config è ignorato)
- Verificare che `@theme inline` in globals.css copra tutti i token necessari
- Eliminare `bg-zinc-950` hardcoded in 8+ componenti → sostituire con `bg-base` o nuova `--surface-code` variable
- Eliminare `#0a0a2e` e `#00d4ff` hardcoded in login page → migrare a `--surface-login` e `--brand` variants
- Eliminare `DynamicIcon` helper triplicato → creare `src/components/shared/dynamic-icon.tsx` unico

### R1.4 — Applicazione brand identity (giorno 2-3)

**Azione**:
- Aggiornare `layout.tsx` metadata con nuovo brand
- Aggiornare favicon/og-image se necessario (mantenere asset esistenti se coerenti)
- Aggiornare login page per usare `--brand` invece di `#00d4ff` hardcoded
- Aggiornare footer "v0.10.0" con nuovo brand tagline
- Verificare che dark mode mantenga coerenza (tutti i token OKLCH hanno variant `.dark`)

### R1.5 — Texture e depth di sfondo (giorno 3)

**Azione**:
- Aggiungere subtle noise texture SVG in `globals.css` (data URI, opacità 0.02-0.03)
- Aggiungere gradient sottile su `--surface-base` (radial gradient molto leggero dal top)
- Verificare che texture non impatti performance (SVG inline, no HTTP request)
- Test su light/dark mode

### Criteri di accettazione R1
- [ ] `globals.css` riscritto con 3-livelli surface, brand blue, 7 cat desaturati, shadow/radius/text scale
- [ ] `design-tokens.ts` allineato, 0 mismatch con Tailwind
- [ ] `tailwind.config.ts` eliminato
- [ ] 0 occorrenze `bg-zinc-950`, `#0a0a2e`, `#00d4ff` hardcoded
- [ ] `DynamicIcon` unified in `shared/dynamic-icon.tsx`
- [ ] Build + 207 test verdi

---

## Sprint R2 — Componenti core: depth, layering, micro-interazioni

### Obiettivo
Trasformare i componenti shadcn base (Card, Button, Input, Badge, Tabs, Dialog) da flat a premium con depth system, shadow, e micro-interazioni curate.

### R2.1 — Card premium (giorno 1)

**Problema**: `bg-card rounded-xl border shadow-sm` invisibile, niente depth.

**Azione**:
- Aggiornare `ui/card.tsx`:
  - Base: `bg-elevated rounded-lg border shadow-sm hover:shadow-md transition-shadow duration-200`
  - Aggiungere `CardAccent` variant: striscia colorata 3px in alto (category color)
  - CardHeader: `border-b bg-muted/20 px-5 py-3` (header separato dal content)
  - CardContent: `px-5 py-4` (padding ridotto per densità)
  - CardTitle: `text-sm font-semibold tracking-tight`
  - CardDescription: `text-xs text-muted-foreground`
- Aggiungere prop `accent?: CategoryColor` per striscia colorata opzionale
- Test hover: card deve "alzarsi" leggermente (shadow-md) su hover

**Verifica**: Card si distingue dal background, ha depth percepibile, header strutturato.

### R2.2 — Button premium (giorno 1)

**Problema**: `rounded-md shadow-xs` piatta, no feedback.

**Azione**:
- Aggiornare `ui/button.tsx`:
  - Base: `rounded-sm font-medium transition-all duration-150 active:scale-[0.98]`
  - Variants:
    - `default`: `bg-brand text-white shadow-sm hover:bg-brand-hover hover:shadow-md`
    - `outline`: `border bg-elevated shadow-sm hover:bg-muted/50`
    - `ghost`: `hover:bg-muted/50` (no shadow)
    - `destructive`: `bg-status-danger text-white shadow-sm hover:opacity-90`
    - `secondary`: `bg-muted text-foreground hover:bg-muted/70`
  - Sizes: `sm h-8`, `default h-9`, `lg h-10`, `icon size-9`
  - Focus: `focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-1`
- Aggiungere prop `loading?: boolean` che mostra spinner inline

**Verifica**: Button ha depth, feedback tattile (scale on active), focus ring brand.

### R2.3 — Input premium (giorno 2)

**Problema**: `h-9 rounded-md border shadow-xs` grezzo.

**Azione**:
- Aggiornare `ui/input.tsx`:
  - Base: `h-10 rounded-sm border bg-elevated shadow-sm px-3 text-sm transition-all`
  - Focus: `focus:border-brand focus:ring-2 focus:ring-brand/15 focus:shadow-md`
  - Placeholder: `placeholder:text-muted-foreground/60`
  - Disabled: `disabled:opacity-50 disabled:cursor-not-allowed`
  - Error state: `aria-[invalid=true]:border-status-danger aria-[invalid=true]:ring-status-danger/15`
- Creare `ui/input-with-icon.tsx` per input con icona (login pattern: Mail/Lock icon a sinistra)
- Creare `ui/input-group.tsx` per input + button (search pattern)

**Verifica**: Input ha altezza confortevole (40px), focus state visibile e brand-coerente.

### R2.4 — Badge e Tag premium (giorno 2)

**Problema**: Badge generico, sempre overridden con `text-[9px] py-0`.

**Azione**:
- Aggiornare `ui/badge.tsx`:
  - Base: `rounded-xs px-2 py-0.5 text-xs font-medium gap-1 inline-flex items-center`
  - Varianti semantico-brand:
    - `default`: `bg-brand/10 text-brand border-brand/20`
    - `success`: `bg-status-ok/10 text-status-ok border-status-ok/20`
    - `warning`: `bg-status-warn/10 text-status-warn border-status-warn/20`
    - `danger`: `bg-status-danger/10 text-status-danger border-status-danger/20`
    - `info`: `bg-status-info/10 text-status-info border-status-info/20`
    - `neutral`: `bg-muted text-muted-foreground border-border`
  - Size: `sm` (default text-xs) + `xs` (text-2xs py-0 per micro)
- Aggiornare `shared/tag-badge.tsx` per usare nuove varianti

**Verifica**: Badge ha 6 varianti coerenti, niente più override `text-[9px] py-0` sparsi.

### R2.5 — Tabs premium (giorno 3)

**Problema**: `bg-muted rounded-lg p-0.5` generico.

**Azione**:
- Aggiornare `ui/tabs.tsx`:
  - TabsList: `bg-muted/40 border rounded-md p-1 inline-flex`
  - TabsTrigger: `rounded-sm text-sm font-medium px-3 py-1.5 transition-all`
  - Active: `bg-elevated shadow-sm text-foreground`
  - Inactive: `text-muted-foreground hover:text-foreground`
  - Icon: `mr-1.5 size-3.5`
- Aggiungere `TabsUnderline` variant: list senza bg, trigger con `border-b-2 border-transparent data-[active]:border-brand data-[active]:text-foreground`

**Verifica**: Tabs hanno 2 varianti (pill e underline), active state chiaro.

### R2.6 — Dialog premium (giorno 3)

**Problema**: `rounded-lg p-6 shadow-lg` inconsistente con Card.

**Azione**:
- Aggiornare `ui/dialog.tsx`:
  - Overlay: `bg-black/40 backdrop-blur-sm`
  - Content: `bg-overlay rounded-xl border shadow-xl p-6 max-w-lg`
  - Animation: `animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200`
  - DialogTitle: `text-lg font-semibold tracking-tight`
  - DialogDescription: `text-sm text-muted-foreground`
  - Close: `size-7 rounded-sm hover:bg-muted absolute top-4 right-4`
- Uniformare radius: Dialog=xl, Card=lg, Button=sm, Input=sm, Badge=xs

**Verifica**: Radius sistematici, Dialog ha depth overlay, animation fluida.

### Criteri di accettazione R2
- [ ] Card: 3 varianti (default/accent/flat), hover lift, header strutturato
- [ ] Button: 5 varianti brand-coerenti, active scale, focus ring, loading state
- [ ] Input: h-10, focus brand ring, error state, input-with-icon + input-group
- [ ] Badge: 6 varianti semantico-brand, niente più override sparsi
- [ ] Tabs: 2 varianti (pill + underline), active chiaro
- [ ] Dialog: radius-xl, shadow-xl, backdrop blur, animation fluida
- [ ] Build + 207 test verdi

---

## Sprint R3 — Layout shell: sidebar, topbar, navigazione

### Obiettivo
Trasformare sidebar e topbar da funzionali a premium, con accent indicators, breadcrumb strutturato, e navigazione che comunica gerarchia.

### R3.1 — Sidebar premium (giorno 1)

**Problema**: Active state debole (`bg-primary/10`), section headers troppo piccoli (9px), no descrizione, logo bar anonima.

**Azione**:
- Aggiornare `sidebar.tsx`:
  - Logo bar: `h-16 px-4` (più alto) + logo `size-9` in container `rounded-lg bg-brand/10 p-1.5` + "SOTA OS" `text-sm font-semibold tracking-tight` + "Agentic OS" `text-[10px] text-muted-foreground tracking-wider uppercase`
  - Section header: `text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 px-3 py-2` (più leggibile)
  - Item button:
    - Base: `rounded-md px-3 py-2 gap-2.5 text-sm transition-all relative`
    - Active: `bg-brand/8 text-brand font-medium` + **left accent bar** `absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-brand`
    - Hover: `hover:bg-muted/60 hover:text-foreground`
    - Icon: `size-4 shrink-0` (color follows text)
  - Live badge: `size-1.5 rounded-full` dot + count `text-2xs font-mono font-bold` in `bg-{status}/15 text-{status}` pill
  - Collapse: icon-only mode con tooltip al hover
  - Bottom: user mini-card (avatar + name + role) sopra collapse button

**Verifica**: Active item ha accent bar visibile, section headers leggibili, logo bar ha character.

### R3.2 — Topbar premium (giorno 2)

**Problema**: Troppo compressa, Cmd+K pill invisibile, user dropdown anonimo.

**Azione**:
- Aggiornare `topbar.tsx`:
  - Height: `h-16` (64px, più respiro)
  - Breadcrumb: `text-2xs uppercase tracking-wider text-muted-foreground/60` + ChevronRight + phase icon `size-4 text-brand` + title `text-sm font-semibold`
  - Cmd+K pill: `h-8 px-3 rounded-md border bg-elevated shadow-sm hover:shadow-md hover:border-brand/30 transition-all` con Command icon `size-3.5` + "Search" text-xs muted + kbd `text-2xs font-mono bg-muted px-1.5 py-0.5 rounded`
  - Theme toggle: `size-9 rounded-md hover:bg-muted` con Sun/Moon `size-4`
  - User dropdown: trigger `h-9 px-2 rounded-md hover:bg-muted flex items-center gap-2` + avatar `size-7 rounded-full ring-2 ring-border` + name `text-sm font-medium` + ChevronDown
  - Dropdown menu: `w-56 rounded-lg border shadow-lg bg-overlay p-1` con items `rounded-sm px-2 py-1.5 text-sm hover:bg-muted`
  - StatusBar: mantenere compatto ma con `gap-1` più airy

**Verifica**: Topbar ha respiro, Cmd+K è discoverable, user menu ha character.

### R3.3 — Breadcrumb strutturato (giorno 2)

**Azione**:
- Creare `src/components/shared/breadcrumb.tsx`:
  - Props: `items: { label, icon?, href? }[]`
  - Render: flex con ChevronRight separatori, ultimo item senza link
  - Styling: `text-xs text-muted-foreground` per non-attivi, `text-sm font-medium text-foreground` per attivo
  - Icone: `size-3.5` per categoria, `size-3` per separatori
- Integrare in topbar sostituendo breadcrumb inline attuale

### R3.4 — Status bar premium (giorno 3)

**Problema**: Pills compatte ma cheap, scrollbar doppia.

**Azione**:
- Aggiornare `status-bar.tsx`:
  - Pill: `h-7 px-2 rounded-md gap-1.5 hover:bg-muted/60 transition-colors` con dot `size-1.5 rounded-full` + icon `size-3` + label `text-2xs text-muted-foreground` + value `text-xs font-mono font-semibold tabular-nums`
  - Tone colors: usare `--status-*` invece di `emerald-500` hardcoded
  - Separatore: `h-4 w-px bg-border/60 mx-0.5`
  - Cost pill: `bg-status-warn/5 hover:bg-status-warn/10` se warn, `bg-status-danger/5 hover:bg-status-danger/10` se danger
- Uniformare scrollbar: eliminare custom CSS 6px, usare solo Radix ScrollArea con `w-2` thumb `bg-border/60 hover:bg-border rounded-full`

**Verifica**: Status bar ha tono premium, scrollbar uniforme.

### R3.5 — Mobile nav premium (giorno 3)

**Azione**:
- Aggiornare MobileNav in sidebar.tsx:
  - Trigger: `h-14 px-4 border-b flex items-center gap-2` + phase icon + logo + title + ChevronDown
  - Dropdown: `bg-overlay border-b shadow-lg rounded-b-lg` con sezioni strutturate come desktop
  - Animazione: `animate-in slide-in-from-top-2 duration-200`

### Criteri di accettazione R3
- [ ] Sidebar: logo bar premium, section headers leggibili, active con accent bar + left indicator
- [ ] Topbar: h-16, breadcrumb strutturato, Cmd+K discoverable, user menu caratterizzato
- [ ] StatusBar: pills premium con status-* tokens, scrollbar uniforme
- [ ] MobileNav: dropdown premium con animazione
- [ ] Build + 207 test verdi

---

## Sprint R4 — Dashboard & Architecture Map

### Obiettivo
Trasformare Overview da "menu 7-colonne + HTML grezzo" a "control center" con visual hierarchy, KPI cards, e architecture map che rappresenta flussi reali.

### R4.1 — Overview layout premium (giorno 1)

**Problema**: Header minimal, ArchitectureMap = menu, CategoryKpis = HTML grezzo.

**Azione**:
- Aggiornare `overview.tsx`:
  - Container: `p-6 lg:p-8 max-w-7xl mx-auto space-y-6`
  - Header: `flex items-center justify-between mb-6`
    - Left: `h1 text-xl font-semibold tracking-tight` "Dashboard" + `p text-sm text-muted-foreground` "{n} eventi registrati"
    - Right: 2 buttons `RefreshButton` + `Button variant=outline` "Inizializza"
  - KPI summary row: `grid grid-cols-2 md:grid-cols-4 gap-3` con 4 StatCard prominenti (Total Plans, Tasks Completed, LTL Verifications, Active Agents)
  - Architecture map: `grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3`
  - Live feed: Card dedicata con header + scrollable list

### R4.2 — KPI cards premium (giorno 1-2)

**Azione**:
- Aggiornare `shared/stat-card.tsx`:
  - Layout: `bg-elevated rounded-lg border shadow-sm hover:shadow-md transition-shadow p-4`
  - Header: `flex items-center justify-between mb-2` + label `text-2xs uppercase tracking-wider text-muted-foreground` + icon `size-4 text-brand`
  - Value: `text-2xl font-bold tabular-nums tracking-tight`
  - Optional: trend indicator `text-xs font-mono` con ArrowUp/ArrowDown + delta %
  - Optional: sparkline mini (SVG inline, 40x12px)
- Creare `shared/kpi-card.tsx` per KPI più complessi con trend + sparkline

**Verifica**: KPI cards hanno depth, trend visivo, gerarchia chiara.

### R4.3 — Architecture Map trasformata (giorno 2)

**Problema**: 7 colonne di bottoni identici = menu, non mappa.

**Azione**:
- Aggiornare `architecture-map.tsx`:
  - Ogni categoria: Card `bg-elevated rounded-lg border shadow-sm hover:shadow-md transition-shadow p-3`
  - Card header: `flex items-center gap-2 mb-2` + category dot `size-2 rounded-full bg-cat-{cat}` + label `text-2xs font-semibold uppercase tracking-wider text-cat-{cat}`
  - Card body: lista fasi `space-y-0.5` con item `rounded-sm px-2 py-1 hover:bg-muted/50 text-xs flex items-center gap-1.5` + icon `size-3` + name
  - Active phase: `bg-brand/10 text-brand`
  - Card footer opzionale: count `text-2xs text-muted-foreground` "{n} fasi"
- Sostituire `category-kpis.tsx` con KPI summary integrato nelle category cards
- Aggiungere `ARCHITECTURE_FLOWS` visualization: linea tratteggiata sottile tra card correlate (CSS, non ReactFlow per semplicità)

**Verifica**: Architecture Map sembra una "mappa" di capability, non un menu.

### R4.4 — Live feed premium (giorno 3)

**Problema**: Lista grezza senza container.

**Azione**:
- Creare `src/components/shared/live-feed.tsx`:
  - Card con header: `flex items-center gap-2` + Radio icon `size-4 text-brand animate-pulse` + "Live Events" `text-sm font-semibold` + count badge + "Disconnesso/Connesso" status `text-2xs`
  - Body: `ScrollArea h-48` con eventi
  - Event row: `flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0` + dot `size-1.5 rounded-full` (color by level) + P{phase} badge + agentId mono + event truncate + timestamp `text-2xs text-muted-foreground ml-auto`
  - Empty state: `EmptyState` con icon Radio + "Nessun evento live" + "Gli eventi appariranno qui quando il sistema è attivo"

**Verifica**: Live feed ha container dedicato, eventi strutturati, empty state.

### R4.5 — PhaseHeader premium (giorno 3)

**Problema**: Troppo minimal, no signature.

**Azione**:
- Aggiornare `phase-header.tsx`:
  - Layout: `flex items-center justify-between gap-4 pb-4 border-b`
  - Left: `flex items-center gap-3`
    - Icon container: `size-10 rounded-lg bg-cat-{cat}/10 flex items-center justify-center` con icon `size-5 text-cat-{cat}`
    - Text: h1 `text-lg font-semibold tracking-tight` + p `text-xs text-muted-foreground`
  - Right: action slot (RefreshButton di default)
- Aggiungere prop `badge?: { label, variant }` per mostrare badge contestuale (es. "3 pending")

**Verifica**: PhaseHeader ha signature visiva, icon container colorato, border separator.

### Criteri di accettazione R4
- [ ] Overview: header strutturato, 4 KPI summary cards, architecture map come "mappa"
- [ ] StatCard: depth, trend opzionale, sparkline
- [ ] ArchitectureMap: category cards con dot + label + fasi + active state
- [ ] LiveFeed: Card dedicata con header + scrollable + empty state
- [ ] PhaseHeader: icon container colorato, border separator, badge opzionale
- [ ] Build + 207 test verdi

---

## Sprint R5 — Console: chat experience premium

### Obiettivo
Trasformare Console da "chat generica" a "agentic command center" con message bubbles premium, ResultCard strutturata, e input bar sofisticata.

### R5.1 — MessageBubble premium (giorno 1)

**Problema**: User bubble `bg-primary` generica, assistant avatar PNG.

**Azione**:
- Aggiornare `message-bubble.tsx`:
  - User bubble: `max-w-[80%] rounded-2xl rounded-tr-sm bg-brand text-white px-4 py-2.5 shadow-sm` + timestamp `text-2xs text-white/60 mt-1`
  - Assistant: avatar `size-8 rounded-full bg-gradient-to-br from-brand to-brand-active ring-2 ring-border flex items-center justify-center` con "S" initials `text-sm font-bold text-white` (sostituisce PNG)
  - Assistant content: `flex-1 space-y-2` + name "SOTA" `text-sm font-semibold` + timestamp `text-2xs text-muted-foreground` + StreamingText `text-sm leading-relaxed`
  - Attachment preview: integrato nel bubble con `rounded-md bg-white/10 px-2 py-1 mt-1.5`
  - InlineActions: `opacity-0 group-hover:opacity-100 transition-opacity` + button `size-7 rounded-md bg-elevated border shadow-sm hover:shadow-md`

**Verifica**: User bubble brand-coerente, assistant avatar vettoriale, hover actions.

### R5.2 — ResultCard premium (giorno 1-2)

**Problema**: Già strutturata ma piatta.

**Azione**:
- Aggiornare ResultCard in `message-bubble.tsx`:
  - Container: `rounded-lg border bg-elevated shadow-sm overflow-hidden`
  - Header: `flex items-center gap-3 px-4 py-3 border-b bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer`
    - Status circle: `size-8 rounded-full flex items-center justify-center` con bg-emerald/amber/red /10 + icon size-4
    - Goal: `text-sm font-medium truncate flex-1`
    - Summary: `text-xs text-muted-foreground` con completed/total + duration
    - Chevron: `size-4 text-muted-foreground transition-transform` (rotate-180 se expanded)
  - Body expanded: `p-4 space-y-3`
    - Step rows: `flex items-center gap-2 py-1 hover:bg-muted/30 rounded-sm px-1` con icon status + taskId mono + description truncate + strategy badge + duration mono + LTL badge
    - Errors: `rounded-md border border-status-danger/30 bg-status-danger/5 p-2.5` con XCircle + phase label + message + suggestion
    - LTL violations: `rounded-md border border-status-warn/30 bg-status-warn/5 p-2.5` con Shield + violations list
    - DAG toggle: `text-xs text-brand hover:underline` + DAG container `h-48 rounded-md border bg-base`
    - Reflection: `flex items-start gap-2.5 pt-3 border-t` con Sparkles in circle + heuristic text

**Verifica**: ResultCard ha depth, header interattivo, sezioni differentiate.

### R5.3 — ConsoleInput premium (giorno 2-3)

**Problema**: Input bar funzionale ma non premium.

**Azione**:
- Aggiornare `console-input.tsx`:
  - Container: `border-t bg-base/95 backdrop-blur`
  - Input wrapper: `max-w-3xl mx-auto p-3`
  - Input bar: `rounded-xl border bg-elevated shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/10 transition-all`
    - Skill picker: `size-9 rounded-lg hover:bg-muted text-muted-foreground hover:text-brand transition-colors` con Sparkles `size-4`
    - Textarea: `flex-1 resize-none bg-transparent text-sm py-2 px-1 placeholder:text-muted-foreground/60 focus:outline-none`
    - Send button: `size-9 rounded-lg bg-brand text-white shadow-sm hover:bg-brand-hover hover:shadow-md active:scale-95 transition-all` con ArrowUp `size-4` (o Square se executing, bg-status-danger)
  - Skill picker popover: `mt-2 rounded-lg border bg-overlay shadow-xl p-3 max-h-80 overflow-y-auto` con search input + lista `space-y-0.5` + item `rounded-sm px-2 py-1.5 hover:bg-muted text-left`
  - Footer: `flex items-center justify-between mt-2 px-1` + hint `text-2xs text-muted-foreground` + "Solo piano" `text-2xs text-muted-foreground hover:text-brand`

**Verifica**: Input bar ha depth, focus state brand, popover premium.

### R5.4 — ConsoleWelcome premium (giorno 3)

**Problema**: Welcome cards troppo simili a suggestions.

**Azione**:
- Aggiornare `console-welcome.tsx`:
  - Hero: `text-center space-y-3 py-8`
    - Logo: `size-14 mx-auto rounded-2xl bg-brand/10 flex items-center justify-center` con logo SVG o "S" initials `text-2xl font-bold text-brand`
    - h2: `text-2xl font-semibold tracking-tight` "Ciao, sono SOTA"
    - p: `text-sm text-muted-foreground max-w-md mx-auto` "Posso pianificare, eseguire, verificare e imparare."
  - Capability cards: `grid grid-cols-1 md:grid-cols-3 gap-3 mt-6`
    - Card: `rounded-lg border bg-elevated shadow-sm hover:shadow-md hover:border-brand/30 transition-all p-4 text-left group cursor-pointer`
    - Icon: `size-9 rounded-lg bg-brand/8 group-hover:bg-brand/12 flex items-center justify-center mb-2 transition-colors` con icon `size-4 text-brand`
    - Title: `text-sm font-semibold`
    - Desc: `text-xs text-muted-foreground mt-0.5 line-clamp-2`
  - Suggestion chips: `grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4` con card più piccole `p-2.5 rounded-md border hover:border-brand/30 hover:bg-muted/30`

**Verifica**: Welcome ha hero center, capability cards differenziate da suggestions.

### R5.5 — Live execution indicator premium (giorno 3)

**Azione**:
- Aggiornare live indicator in `message-list.tsx`:
  - Avatar: `size-8 rounded-full bg-gradient-to-br from-brand to-brand-active ring-2 ring-border flex items-center justify-center relative`
  - Spinner: `absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-base border-2 border-base flex items-center justify-center` con Loader2 `size-2 animate-spin text-brand`
  - Log box: `rounded-md bg-base border p-2.5 font-mono text-2xs space-y-0.5 max-h-32 overflow-y-auto` con line `text-muted-foreground`

**Verifica**: Live indicator ha depth, log box temizzato (non zinc-950).

### Criteri di accettazione R5
- [ ] MessageBubble: user brand-coerente, assistant avatar vettoriale (initials), hover actions
- [ ] ResultCard: depth, header interattivo, sezioni errors/LTL/DAG/reflection differenziate
- [ ] ConsoleInput: focus state brand, popover premium, send button con feedback
- [ ] ConsoleWelcome: hero center, capability cards differenziate, suggestions più piccole
- [ ] Live indicator: avatar vettoriale, log box temizzato
- [ ] Build + 207 test verdi

---

## Sprint R6 — Cockpit, Canvas, domini Inspect

### Obiettivo
Elevare Cockpit (widget + tab), Canvas (nodi), e domini Inspect (forms phase1/4/8) da funzionali a premium.

### R6.1 — Cockpit widget premium (giorno 1)

**Problema**: SensoriumWidget e AffectGauge già buoni ma Card piatta.

**Azione**:
- Aggiornare `cockpit/widgets.tsx`:
  - SensoriumWidget Card: `bg-elevated rounded-lg border shadow-sm hover:shadow-md transition-shadow` + header strutturato + body `grid grid-cols-4 gap-2`
  - Widget mini-stat: `bg-muted/30 rounded-md p-2.5 text-center hover:bg-muted/50 transition-colors` + icon `size-4 mx-auto mb-1 text-muted-foreground` + label `text-2xs uppercase tracking-wider text-muted-foreground` + value `text-base font-bold font-mono tabular-nums`
  - AffectGauge Card: aggiungere `border-status-danger/40 shadow-md` se critical, `shadow-sm` altrimenti
  - Gauge bar: `h-2 bg-muted rounded-full overflow-hidden` + fill `h-full rounded-full transition-all duration-500 shadow-sm`
  - Gauge label: `flex items-center justify-between text-xs mb-1` + icon + label + value mono

### R6.2 — Cockpit tabs premium (giorno 1-2)

**Problema**: Liste monotone (Narrative/Log/Scheduler identici).

**Azione**:
- Aggiornare `cockpit/tabs.tsx`:
  - NarrativeTab: items `rounded-md border-l-2 border-{level} bg-elevated shadow-sm p-3 hover:shadow-md transition-shadow` con header (agentId badge + phase badge + cycle + timestamp) + narrative text
  - LogTab: items `flex items-center gap-2 py-1 px-2 hover:bg-muted/40 rounded-sm transition-colors` con phase badge colorato + agentId mono + event truncate + timestamp
  - SchedulerTab: items `rounded-md border bg-elevated shadow-sm p-3 hover:shadow-md transition-shadow` con header (taskId + status badge + agentId) + description + plan goal
  - CyclesTab: 2 grid items con Card `bg-elevated rounded-lg border shadow-sm p-3` + header badge + stats
  - SafetyTab: mantenere empty state premium + items `rounded-md border border-status-warn/30 bg-status-warn/5 p-3 hover:shadow-md transition-shadow`

**Verifica**: Ogni tab ha visual identity distinta, niente più liste identiche.

### R6.3 — Canvas nodi premium (giorno 2)

**Problema**: Nodi `border-2 flat` senza depth.

**Azione**:
- Aggiornare `dag-visualizers.tsx`:
  - Nodo: `rounded-lg border-2 bg-elevated shadow-sm hover:shadow-md hover:border-{status} transition-all p-3 min-w-[180px]`
  - Status border: done=emerald, running=sky, failed=red, pending=gray, ready=amber
  - Running nodo: aggiungere `animate-pulse` sottile sul border
  - Nodo header: `flex items-center gap-2 mb-1` + status dot + taskId mono + agentId badge
  - Nodo body: description `text-xs text-muted-foreground`
  - Edge: curved bezier con `stroke-{status}` color, animated dashed se running
  - Background: dots `bg-muted/30` con dots size 1px spacing 20px
  - MiniMap: `rounded-md border bg-elevated shadow-sm` con node colors status-coerenti
  - Controls: `rounded-md border bg-elevated shadow-sm` con button `size-7 hover:bg-muted`

### R6.4 — Domini Inspect forms premium (giorno 2-3)

**Problema**: phase1/phase4/phase8 form grezzi.

**Azione**:
- Per ogni dominio (memory-context, plan-execute, verify-trust, learn-route):
  - DomainHeader: già premium (R3.5), mantenere
  - Tab content: Card `bg-elevated rounded-lg border shadow-sm` con CardHeader `border-b bg-muted/20 px-5 py-3` + CardContent `px-5 py-4 space-y-3`
  - Form fields: usare `shared/form-field.tsx` (da creare) con Label `text-xs font-medium` + Input h-10 + helper text `text-2xs text-muted-foreground` + error `text-2xs text-status-danger`
  - Submit button: `Button` con loading state
  - Liste: usare `shared/entity-list.tsx` con search + empty state dedicato
- Creare `shared/form-field.tsx`:
  - Props: label, htmlFor, required, helperText, error, children
  - Layout: `space-y-1` + Label `text-xs font-medium flex items-center gap-1` + children + helper/error

### R6.5 — SovereignView premium (giorno 3)

**Problema**: Cards troppo simili, manca visual differentiation per source.

**Azione**:
- Aggiornare `sovereign-view.tsx`:
  - Stats row: `grid grid-cols-3 md:grid-cols-6 gap-2` con StatCard `bg-elevated rounded-md border shadow-sm p-3` + icon + label + value
  - Filter toggles: `inline-flex rounded-md border bg-muted/40 p-1` con button `rounded-sm px-2.5 py-1 text-xs` + active `bg-elevated shadow-sm text-foreground`
  - BlockedActionCard: `rounded-lg border bg-elevated shadow-sm hover:shadow-md transition-shadow p-3` con
    - Source accent: `border-l-4 border-l-{source-color}` (ltl=red, taint=amber, normative=violet, hitl=pink)
    - Header: source badge + status badge + timestamp
    - Body: action `text-sm font-medium` + explanation `text-xs text-muted-foreground` in `<pre class="bg-muted/30 rounded-md p-2">`
    - Expand: axiom trail + resolution form

### R6.6 — TimelineView premium (giorno 3)

**Problema**: Lista grezza senza struttura.

**Azione**:
- Aggiornare `timeline-view.tsx`:
  - Container: `p-4 sm:p-6 space-y-4`
  - Header: PhaseHeader + filter bar `flex flex-wrap items-center gap-2` con phase select + agent select + level filter + refresh
  - Timeline: `relative space-y-1` con
    - Vertical line: `absolute left-3 top-0 bottom-0 w-px bg-border`
    - Event: `relative flex items-start gap-3 pl-6 py-1.5 hover:bg-muted/30 rounded-sm transition-colors`
    - Dot: `absolute left-2 top-2.5 size-2 rounded-full bg-{level}` + ring `ring-4 ring-{level}/15`
    - Content: phase badge + agentId mono + event truncate + payload preview + timestamp

### Criteri di accettazione R6
- [ ] Cockpit widgets: Card premium con hover shadow
- [ ] Cockpit tabs: 5 tab con visual identity distinta
- [ ] Canvas: nodi con depth + hover + status border + animated running
- [ ] Domini Inspect: form con FormField shared, liste con EntityList
- [ ] SovereignView: cards con source accent border-l-4
- [ ] TimelineView: vertical line + dots + ring
- [ ] Build + 207 test verdi

---

## Sprint R7 — Modali, forms, stati finali

### Obiettivo
Completare il redesign con modali premium (Command palette, Sovereign modal, Cost modal), forms uniformi, e empty/loading/error states coerenti.

### R7.1 — Command palette premium (giorno 1)

**Problema**: Già premium, ma allineare con nuovo brand.

**Azione**:
- Aggiornare `command-palette.tsx`:
  - Backdrop: `bg-black/50 backdrop-blur-md`
  - Container: `max-w-2xl bg-overlay rounded-2xl border shadow-2xl overflow-hidden`
  - Animation: `animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200`
  - Search: `h-14 border-b px-4 flex items-center gap-3` + Search icon `size-4 text-muted-foreground` + input `flex-1 text-sm placeholder:text-muted-foreground/60` + esc kbd `text-2xs font-mono bg-muted px-1.5 py-0.5 rounded`
  - Results: `max-h-96 overflow-y-auto p-2` con group header `text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60 px-2 py-1.5` + row `px-3 py-2 rounded-md flex items-center gap-3 data-[selected=true]:bg-brand/10 data-[selected=true]:text-brand`
  - Row: icon `size-4` + label `text-sm font-medium flex-1` + description `text-xs text-muted-foreground` + badge + shortcut `text-2xs font-mono bg-muted px-1.5 py-0.5 rounded`
  - Footer: `border-t bg-muted/20 px-4 py-2 flex items-center justify-between text-2xs text-muted-foreground` con shortcuts help

### R7.2 — Sovereign modal premium (giorno 1-2)

**Problema**: Troppo testo-pesante, manca visual hierarchy.

**Azione**:
- Aggiornare `sovereign-modal.tsx`:
  - Dialog: `max-w-2xl bg-overlay rounded-xl border shadow-xl`
  - Snooze header: `flex items-center justify-between border-b px-4 py-2 bg-muted/20` con "Approvazione richiesta" `text-2xs text-muted-foreground` + 3 snooze buttons `text-2xs px-2 py-1 rounded-sm hover:bg-muted`
  - DialogHeader: `px-6 pt-4` con icon container `size-10 rounded-lg bg-{source}/10 flex items-center justify-center mb-3` + title `text-lg font-semibold`
  - Body: `px-6 py-4 space-y-4`
    - Action attempted: `rounded-lg border bg-muted/20 p-3` con source badge + agentId + timestamp + action `text-sm font-medium`
    - Explanation: `rounded-md bg-base border p-3 text-xs font-mono whitespace-pre-wrap max-h-32 overflow-y-auto`
    - Axiom trail: `space-y-1.5` con step `border-l-2 border-brand/40 pl-3 py-1` + badge mono + rule + result
    - Resolution note: `FormField` con Textarea
  - Footer: `border-t bg-muted/20 px-6 py-4 flex flex-wrap gap-2 justify-end` con 4 buttons colorati

### R7.3 — Cost modal premium (giorno 2)

**Azione**:
- Aggiornare `cost-breakdown-modal.tsx`:
  - Dialog: `max-w-3xl bg-overlay rounded-xl border shadow-xl`
  - Header: costo totale prominent `text-3xl font-bold tabular-nums` + delta odierno
  - Tabs: 5 tab (Overview/By Agent/By Model/By Phase/Budget) con KPI cards + charts
  - Charts: usare chart colors coerenti, bar/line semplici con depth

### R7.4 — Form system uniforme (giorno 2-3)

**Azione**:
- Creare `shared/form-field.tsx`:
  - Props: label, htmlFor, required, helperText, error, children
  - Layout: `space-y-1.5` + Label `text-xs font-medium flex items-center gap-1` (con * rosso se required) + children + helper `text-2xs text-muted-foreground` / error `text-2xs text-status-danger flex items-center gap-1`
- Creare `shared/form-section.tsx`:
  - Props: title, description, icon, children
  - Layout: Card con header `border-b bg-muted/20 px-5 py-3` (icon + title + desc) + content `px-5 py-4 space-y-3`
- Aggiornare phase1/phase4/phase8 per usare FormField + FormSection
- Aggiornare login form per usare FormField

### R7.5 — Empty states uniformi (giorno 3)

**Problema**: Doppio sistema (shared EmptyState + inline).

**Azione**:
- Eliminare tutti i pattern `<p className="text-xs text-muted-foreground italic">Nessun…</p>` inline
- Sostituire con `EmptyState` shared
- Per ogni empty state, aggiungere:
  - Icon appropriata (non Inbox generico)
  - Title descrittivo
  - Description con contesto
  - CTA opzionale (es. "Genera un piano" → naviga a Console)
- Esempi:
  - NarrativeTab: `EmptyState icon={MessageSquare} title="Nessuna narrativa" description="Le azioni dell'agente appariranno qui." `
  - SchedulerTab: `EmptyState icon={ListChecks} title="Nessun task" description="Genera un piano nella Console per vedere i task qui." actionLabel="Vai alla Console" onAction={() => setActivePhase('console')}`
  - Phase1 episodi: `EmptyState icon={Database} title="Nessun episodio" description="Inizializza il sistema o registra un evento."`

### R7.6 — Loading states uniformi (giorno 3)

**Azione**:
- Sostituire `animate-pulse` grezzo con `shimmer` class (definita in R1)
- Uniformare skeleton: tutti usano `bg-muted/40 rounded-md shimmer`
- Route loading `app/loading.tsx`: spinner brand `border-2 border-brand/30 border-t-brand`
- Inline loading: `Loader2 className="size-4 animate-spin text-brand"`

### R7.7 — Error states uniformi (giorno 3)

**Azione**:
- `app/error.tsx`: già creato, allineare con brand (AlertTriangle in `bg-status-danger/10` container)
- `app/not-found.tsx`: già creato, allineare con brand
- Inline error states: ogni fetch con try/catch mostra `ErrorState` con retry
- Creare `shared/error-state.tsx`:
  - Props: title, message, onRetry
  - Layout: `flex flex-col items-center py-8` + AlertTriangle `size-10 text-status-danger` + title `text-sm font-medium` + message `text-xs text-muted-foreground` + Button "Riprova"

### Criteri di accettazione R7
- [ ] Command palette: brand-coerente, shadow-2xl, animation fluida
- [ ] Sovereign modal: visual hierarchy, source accent, axiom trail premium
- [ ] Cost modal: total prominent, 5 tab con KPI + charts
- [ ] FormField + FormSection shared, usati in phase1/4/8 + login
- [ ] 0 empty state inline, tutti usano EmptyState shared con CTA
- [ ] Loading: shimmer uniforme, spinner brand
- [ ] Error: ErrorState shared in tutte le fetch
- [ ] Build + 207 test verdi

---

## 5. Criteri di accettazione complessivi

Il redesign è considerato completo quando:

### 5.1 Sistema di design
- [ ] `globals.css` riscritto con 3-livelli surface, brand blue, 7 cat desaturati, shadow/radius/text scale sistematici
- [ ] `design-tokens.ts` allineato, 0 mismatch con Tailwind
- [ ] `tailwind.config.ts` eliminato (dead code)
- [ ] 0 occorrenze hardcoded: `bg-zinc-950`, `#0a0a2e`, `#00d4ff`, `oklch(0.45 0.18 270)`
- [ ] `DynamicIcon` unified in `shared/dynamic-icon.tsx`
- [ ] Texture/noise sottile su background base

### 5.2 Componenti
- [ ] Card: 3 varianti (default/accent/flat), hover lift, header strutturato
- [ ] Button: 5 varianti brand-coerenti, active scale, focus ring, loading state
- [ ] Input: h-10, focus brand ring, error state, input-with-icon + input-group
- [ ] Badge: 6 varianti semantico-brand, 0 override `text-[9px] py-0` sparsi
- [ ] Tabs: 2 varianti (pill + underline)
- [ ] Dialog: radius-xl, shadow-xl, backdrop blur, animation fluida
- [ ] FormField + FormSection shared

### 5.3 Layout
- [ ] Sidebar: logo bar premium, section headers leggibili, active con accent bar + left indicator
- [ ] Topbar: h-16, breadcrumb strutturato, Cmd+K discoverable, user menu caratterizzato
- [ ] StatusBar: pills premium con status-* tokens, scrollbar uniforme

### 5.4 Viste
- [ ] Overview: header strutturato, 4 KPI summary cards, architecture map come "mappa"
- [ ] Console: user bubble brand, assistant avatar vettoriale, ResultCard premium, input bar premium, welcome premium
- [ ] Cockpit: widget premium, 5 tab con visual identity distinta
- [ ] Canvas: nodi con depth + hover + status border + animated running
- [ ] Domini Inspect: form con FormField, liste con EntityList
- [ ] SovereignView: cards con source accent border-l-4
- [ ] TimelineView: vertical line + dots + ring

### 5.5 Modali & states
- [ ] Command palette: brand-coerente, shadow-2xl
- [ ] Sovereign modal: visual hierarchy, source accent
- [ ] Cost modal: total prominent, 5 tab
- [ ] 0 empty state inline, tutti EmptyState shared con CTA
- [ ] Loading: shimmer uniforme, spinner brand
- [ ] Error: ErrorState shared in tutte le fetch

### 5.6 Quality
- [ ] `bun run test` ≥207 test verdi
- [ ] `bun run lint` 0 errori
- [ ] `bun run build` passa
- [ ] TypeScript strict mode 0 errori
- [ ] Dark mode coerente su tutte le viste
- [ ] Mobile responsive mantenuto

---

## 6. Metriche di successo

### 6.1 Metriche quantitative

| Metrica | Prima | Target | Misura |
|---------|-------|--------|--------|
| Primary color generico | viola shadcn | brand blue elettrico | grep OKLCH |
| Surface levels | 1 (flat) | 3 (base/elevated/overlay) | CSS vars |
| Shadow levels | 2 (sm/lg) | 4 (sm/md/lg/xl) | CSS vars |
| Radius values | 5+ non sistematici | 6 sistematici (xs→2xl) | grep rounded-* |
| Hardcoded colors | 8+ (zinc-950, #0a0a2e, #00d4ff) | 0 | grep |
| Empty state inline | ~14 | 0 (tutti shared) | grep `text-muted-foreground italic` |
| DynamicIcon duplicati | 3 | 1 (shared) | grep |
| Tailwind config dead code | 1 file | 0 | file eliminato |
| Componenti con depth (hover shadow) | ~5 | ~30+ | grep `hover:shadow` |
| Avatar PNG | 2 (avatar.png, logo) | 0 (SVG/initials) | grep `.png` |

### 6.2 Metriche qualitative

- **Identità visiva**: l'app deve essere riconoscibile come "SOTA Agentic OS", non come "un altro shadcn dashboard"
- **Depth percepito**: le card devono sembrare "sopra" il background, non piatte
- **Gerarchia visiva**: l'occhio deve sapere dove guardare per primo (KPI > actions > lists)
- **Feedback universale**: ogni interazione (hover, focus, click, loading, success, error) ha feedback visivo
- **Coerenza**: stessa azione = stesso stile in tutta l'app (es. tutti i refresh button uguali)
- **Shock login → app eliminato**: il branding panel del login si ritrova nell'app (stesso brand blue, stessa cura)

### 6.3 Valutazione finale

Il redesign è considerato successo se:
1. Uno screenshot dell'app potrebbe essere su **Awwwards** o **Land-book** (non è un generic SaaS)
2. Un utente nuovo capisce **in 3 secondi** cosa fa l'app e come iniziare
3. Un utente esperto trova **tutto più veloce** (depth signals, feedback immediato, gerarchia chiara)
4. Dark mode e light mode sono **entrambe premium** (non una è l'afterthought dell'altra)
5. Mobile non è "desktop comprimibile" ma **ridisegnato per touch**

---

> **Nota finale**: Questo piano trasforma l'app da "funzionalmente solida ma visivamente mediocre" a "premium operative intelligence tool". Ogni scelta (brand blue, 3-livelli surface, depth through shadow, 7 cat desaturati, typography sistematica) è intenzionale e mira a comunicare **precisione tecnica + eleganza sobria + intelligenza calma**. Il redesign mantiene tutte le funzionalità esistenti (207 test, 4 domini, 8 componenti shared) e ne eleva solo l'esecuzione visiva.
