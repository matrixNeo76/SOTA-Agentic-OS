# PIANO UI/UX — Verso una interfaccia SOTA

> Obiettivo: bellezza grafica, modernità, intuitività, innovazione e — soprattutto —
> una UI/UX che permetta di **usare davvero tutte** le funzionalità, incluse quelle
> in arrivo col piano runtime (`PLAN.md`).
>
> Analisi fatta leggendo i componenti reali, non i doc.

## Diagnosi dello stato attuale (onesta)

**Cosa è già buono (da preservare):**
- Design system maturo in `globals.css`: spazio colore OKLCH, token semantici
  (`surface-base/elevated/overlay`, `brand`, `status-*`, `cat-*`), scala radius,
  dark mode completa.
- Accessibilità seria: skip-link, `focus-visible`, `prefers-reduced-motion`,
  `prefers-contrast`, `sr-only`, scrollbar custom. Font Geist.
- Layout "workbench": Sidebar + Topbar + workspace resizable + context panel,
  MobileNav, Command Palette (Cmd+K), onboarding tour, Sovereign modal, toaster.
- 47 primitive shadcn in `components/ui`, grafi via reactflow (`canvas`,
  `dag-visualizers`).

**I 3 problemi strutturali (non è una questione di "colori brutti"):**

1. **Information Architecture per "Fasi" di sviluppo, non per obiettivi utente.**
   La sidebar (`src/lib/store.ts` → `PHASES`) elenca `phase1`…`phase14` con nomi
   da sviluppatore ("NS-Mem · PatchBoard", "PTA · Dominators", "ACTS Controller",
   "LeanEvolve"). **Si sovrappone** ai 4 "Domini" (es. `domain-memory` copre
   phase1+phase6; `domain-plan` copre phase2+7+12): l'utente vede la stessa
   funzione due volte, una per dominio e una per fase. Risultato: 21 voci di
   navigazione ridondanti e criptiche.

2. **Copertura funzionale parziale.** Moduli con logica completa ma **senza UI
   nel workbench**: `agent-mesh`, `world-model`, `digital-twin`, `autonomous-org`,
   `skill-registry`, `skill-synthesis`, `conflict-resolution`, `cognitive-gc`,
   `evaluation`, `code-intelligence`, `knowledge-extraction`, `agent-lifecycle`,
   `cognitive-router`. Esistono solo nella pagina **`/autonomous` staccata** dal
   workbench principale, o solo via API → gran parte della potenza è invisibile.

3. **Mancano due superfici chiave:**
   - **Esecuzione (Runs)**: nessuna vista per i workflow in esecuzione, ispezione
     per-step, trace dei tool-call, controlli checkpoint/resume/rollback, HITL
     (pausa/intervieni) — esattamente ciò che il piano runtime sta abilitando.
   - **Admin/Settings**: esiste solo `tool-manager`; niente configurazione, utenti,
     chiavi, worker, governance da UI.

## Principi guida (target SOTA)

- **Jobs-to-be-done, non architettura interna.** L'utente naviga per ciò che
  vuole fare ("Esegui un workflow", "Esplora la memoria", "Rivedi le decisioni"),
  non per il nome del modulo che lo implementa.
- **Una sola IA unificata.** Eliminare il doppione fasi/domini e fondere
  `/autonomous` nel workbench.
- **Execution-first & AI-native.** La console/run è il centro; streaming,
  tool-call visibili, intervento umano in tempo reale.
- **Progressive disclosure.** Semplice in superficie (3-5 aree), profondità a
  richiesta (il dettaglio "fase" resta come vista avanzata/debug, non primaria).
- **Bellezza = chiarezza + movimento misurato + gerarchia.** Non decorazione:
  motion con significato, profondità, data-viz di qualità.

---

## Workstream UI/UX

### UX-1 — Ridisegno Information Architecture (priorità n.1)
- Sostituire le 21 voci con **5-6 aree per obiettivo**, proposta:
  1. **Dashboard** (overview + KPI + activity)
  2. **Run / Console** (crea ed esegui workflow — vedi UX-3)
  3. **Memory & Knowledge** (Context Graph, memoria, knowledge extraction)
  4. **Agents & Org** (mesh multi-agente, lifecycle, autonomous-org, skill)
  5. **Trust & Governance** (LTL/verify, conflict, sovereign/HITL, audit)
  6. **Insights** (world-model, digital-twin, evaluation, cost, observability)
- Le "fasi" 1-14 diventano una vista **"Advanced / Internals"** (debug/dev),
  non navigazione primaria. Niente più gergo in prima fila.
- **Comando-first**: potenziare la Command Palette come navigazione primaria
  (azioni, non solo viste).
- *Accettazione:* un nuovo utente trova qualsiasi funzione in ≤2 click senza
  conoscere i nomi interni dei moduli.

### UX-2 — Copertura totale delle funzionalità
- Per ogni modulo oggi senza UI, una superficie dedicata dentro l'area giusta
  (UX-1): mesh topology (grafo reactflow), world-model (predizioni/rischi),
  digital-twin (what-if con confronto scenari), autonomous-org (proposte +
  approvazione), skill registry/synthesis (catalogo + gap detection),
  conflict-resolution (lista + risoluzione), cognitive-gc (consolidamento
  memoria), evaluation (benchmark + trend).
- **Fondere `/autonomous`** (autonomous-dashboard) nel workbench: un solo
  ambiente, niente pagine orfane.
- Pattern riusabile: ogni modulo = header + stat cards + tabella/lista +
  pannello dettaglio + azioni. Standardizzare in un layout "module page".
- *Accettazione:* ogni endpoint/modulo è raggiungibile e usabile da UI.

### UX-3 — Superficie di Esecuzione (Runs) + HITL live
Allineata al piano runtime (`PLAN.md` WS1):
- **Runs list**: workflow passati/in corso con stato, durata, costo.
- **Run detail**: timeline dei batch/step (usa i `topologicalBatches`),
  per ogni step il loop ReAct (pensiero → tool-call → osservazione), output,
  trace, costo, verdetti LTL.
- **Controlli durabilità**: pausa/riprendi, lista checkpoint con resume/rollback,
  badge "ripreso dopo interruzione".
- **HITL in tempo reale**: approvazione inline (collega Sovereign), correzione di
  un passo, stop. Stream via gli eventi WS già esistenti (`publishAgentEvent`).
- *Accettazione:* l'utente lancia un workflow, lo vede eseguire step-by-step,
  interviene, e dopo un crash lo vede riprendere.

### UX-4 — Admin & Settings (collegato a WS2 di PLAN.md)
- Sezione `/admin` role-gated: Settings (DB, provider LLM/modello, chiavi,
  event-mesh backend, Langfuse), Tool & Permessi (evoluzione `tool-manager`),
  Runtime/Workers (stato worker, coda job, recovery), Governance
  (RedLine/Normative/ApprovalGate), Utenti/Tenant.
- *Accettazione:* configurazione completa senza toccare file.

### UX-5 — Elevazione del linguaggio visivo (la "bellezza SOTA")
- **Profondità e materia**: gerarchia di superfici più ricca, ombre soft,
  eventuale vetro/blur misurato per overlay; bordi e contrasti calibrati.
- **Motion con significato**: transizioni di vista, entrata liste/card,
  micro-interazioni su hover/focus, skeleton coerenti (già presenti, da
  estendere). Sempre nel rispetto di `prefers-reduced-motion`.
- **Data-viz di qualità**: standardizzare grafici (recharts già in deps) per
  costi, latenza, token, trend evaluation; grafi (reactflow) per mesh e DAG con
  layout automatico, mini-mappa, focus/zoom.
- **Tipografia e densità**: scala tipografica chiara, modalità "comfortable/
  compact", tabular numbers per metriche.
- *Accettazione:* screenshot delle schermate principali "demo-ready" e coerenti.

### UX-6 — UX AI-native, onboarding ed empty states
- **Empty states** istruttivi (cosa fare quando non c'è ancora nulla) per ogni
  nuova superficie.
- **Onboarding** rivisto sulle 5-6 aree (non sulle fasi).
- **Suggerimenti/azioni AI** contestuali (es. "esegui questo piano", "spiega
  questa decisione", "risolvi questo conflitto") come primitive UI ricorrenti.
- *Accettazione:* prima sessione comprensibile senza leggere documentazione.

### UX-7 — Responsive, performance, accessibilità
- Verificare ogni nuova superficie su mobile (sheet/FAB già presenti).
- Virtualizzazione liste lunghe (run/log/memoria), lazy-load (già usato per i
  domini), streaming progressivo.
- Portare a11y verso AA pieno: focus order, ARIA su grafi/tabelle, contrasti.
- *Accettazione:* Lighthouse/axe puliti sulle pagine chiave; uso fluido su mobile.

### UX-8 — Governance del design system
- Centralizzare i token (esiste già `src/lib/design-tokens.ts`) e documentare i
  pattern ricorrenti ("module page", "stat card", "entity inspector", "run step").
- Catalogo componenti (storybook-like o pagina interna `/design`) per coerenza.
- *Accettazione:* nuovi moduli si costruiscono per composizione, senza reinventare
  stili.

---

## Sequenza consigliata
1. **UX-1** (IA unificata) → sblocca tutto il resto; senza questa, aggiungere
   superfici peggiora il caos.
2. **UX-2 + UX-8** → coprire i moduli mancanti con pattern standard.
3. **UX-3** → superficie Runs, in parallelo all'avanzamento di `PLAN.md` WS1.
4. **UX-4** → Admin/Settings, in parallelo a `PLAN.md` WS2.
5. **UX-5 + UX-6 + UX-7** → polish, bellezza, onboarding, performance/a11y.

## Dipendenze incrociate con PLAN.md (runtime)
- UX-3 consuma l'executor durevole (WS1): mostrare step/checkpoint/resume.
- UX-4 è il front-end del WS2 (admin/settings) e del worker (WS1.5).
- Conviene costruire le superfici UI **dietro feature-flag** finché le rispettive
  API runtime non sono pronte, così UI e backend procedono in parallelo.

## Note
- Non serve cambiare stack: shadcn + Tailwind v4 + reactflow + recharts +
  framer-motion (già in `package.json`) bastano per il target SOTA.
- Il lavoro è soprattutto di **architettura dell'informazione e copertura**,
  poi di **raffinamento visivo** — in quest'ordine.
</content>
