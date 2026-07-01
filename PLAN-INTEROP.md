# PIANO INTEROP — Usare l'OS da Claude Code, IDE/OS agentici e sistemi esterni

> Obiettivo: rendere SOTA Agentic OS utilizzabile da agenti e tool esterni
> (Claude Code, Cursor, VS Code, Antigravity, altri OS agentici) e da qualsiasi
> sistema via API/MCP/A2A/Skills — in modo sicuro e standard.
>
> Analisi fatta leggendo il codice (`src/app/api/mcp/route.ts`, auth, schema).

## Diagnosi dello stato attuale

- **MCP** (`/api/mcp`): JSON-RPC 2.0 completo (initialize, tools/list, tools/call,
  resources/list+read, prompts/list+get, completion/complete), GET di discovery.
  **Limiti:** solo POST request/response → **niente transport SSE/Streamable-HTTP**
  (i client MCP standard si aspettano stdio o Streamable-HTTP con handshake e
  sessioni); **nessuna auth** sull'endpoint; espone solo ~24 tool di stato/controllo
  (non l'executor/run né le capacità di scrittura governate).
- **REST API** (53 route): protette da **cookie di sessione** (`sota_session`),
  orientate al browser. **Niente API key / token / OAuth** → non agent-friendly.
- **A2A** (Agent2Agent): **assente** (no agent card `/.well-known/agent.json`,
  no task lifecycle).
- **Skills**: `skill-registry` interno + `prompts` MCP, ma **nessun packaging /
  discovery** verso formati esterni (es. Claude Agent Skills / SKILL.md).
- **PublisherKey** (ECDSA P-256): esiste ma serve a firmare l'installazione tool,
  **non** ad autenticare le API.

**Verdetto:** usabile esternamente solo con glue code custom. Non plug-and-play.

## Perché vale la pena (tesi strategica)

Il valore non è "un altro IDE", ma diventare il **backplane di memoria +
governance + esecuzione durevole** per agenti terzi. Claude Code/Cursor/Antigravity
sono stateless tra sessioni e senza governance formale; collegandoli all'OS
ottengono memoria persistente (Context Graph), red-lines/approvazioni (Sovereign)
e workflow che riprendono dopo i crash. Posiziona il progetto come *infrastruttura*.

## Standard di riferimento (a chi parla cosa)
- **MCP** — protocollo primario per IDE/agenti LLM (Claude Code, Cursor, VS Code,
  Windsurf, Antigravity). Tools + Resources + Prompts.
- **A2A** — delega agente↔agente (ecosistema Google/Linux Foundation). Agent card +
  task lifecycle asincrono.
- **Skills** — pacchetti riusabili (Claude Agent Skills / SKILL.md) e import/export
  con lo skill-registry interno.
- **REST + SDK** — accesso programmatico generico (qualsiasi linguaggio/sistema).

---

## Workstream

### IO-0 — Auth machine-to-machine (prerequisito trasversale, priorità n.1)
- **API key** con scopes (read/exec/admin) + **OAuth2/OIDC client-credentials**
  per integrazioni enterprise; rate limiting per chiave; audit di ogni chiamata.
- Accettazione header `Authorization: Bearer` su **tutte** le superfici esterne
  (REST, MCP, A2A), in aggiunta al cookie per il browser.
- *Accettazione:* un agente esterno si autentica senza cookie e con permessi
  limitati allo scope.

### IO-1 — MCP server production-grade
- Aggiungere il transport **Streamable HTTP** (e SSE legacy) con handshake,
  notifiche e session id → connettibile dai client MCP senza glue.
- **Auth** sull'endpoint MCP (IO-0).
- Esporre i **tool giusti**, non solo stato: avvio/osservazione **Run** (executor
  durevole di `PLAN.md`), scrittura in memoria/grafo **governata**, ricerca
  semantica, skill execution — ognuno con permessi e passaggio per il Sovereign
  quando rischioso.
- **Resources** per memoria/grafo/run; **Prompts** = skill del registry.
- Pubblicare anche una variante **stdio** (piccolo bridge) per chi preferisce il
  lancio locale (es. config Claude Code/Desktop).
- *Accettazione:* aggiungo l'OS come server MCP in Claude Code/Cursor con un
  semplice URL+token e uso i suoi tool nativamente.

### IO-2 — A2A (Agent-to-Agent)
- **Agent card** su `/.well-known/agent.json`: identità, capability, skill,
  endpoint, auth.
- **Task lifecycle** asincrono (submit → working → input-required → completed),
  con streaming stato e artefatti; mappare i task A2A sull'executor durevole.
- Delega **bidirezionale**: l'OS può sia ricevere task da agenti esterni, sia
  delegare a essi (registrandoli come agenti della mesh).
- *Accettazione:* un client A2A scopre l'OS, gli delega un obiettivo e ne segue
  l'esecuzione fino al risultato.

### IO-3 — Skills: packaging, export e import
- **Export**: ogni skill del `skill-registry` pubblicabile come pacchetto
  riusabile (formato Claude Agent Skill / SKILL.md + manifest) e come `prompt` MCP.
- **Import**: caricare skill esterne nel registry (con validazione/sandbox e
  provenance già presenti).
- **Discovery**: endpoint di catalogo skill consultabile dagli agenti.
- *Accettazione:* una skill creata nell'OS è installabile in Claude Code, e una
  skill esterna è eseguibile dentro l'OS.

### IO-4 — REST programmatica + SDK + OpenAPI
- **Spec OpenAPI** generata dalle route → documentazione e client autogenerati.
- **SDK** TypeScript e Python (thin client su REST + auth IO-0).
- Webhook/eventi in uscita (riuso Event Mesh) per integrazioni push.
- *Accettazione:* `npm i @sota/sdk` / `pip install sota-sdk` e in 5 righe lancio
  un workflow e ne leggo lo stato.

### IO-5 — "Backplane mode" (il caso d'uso killer)
- Pacchetto di integrazione che dà a un agente esterno (es. Claude Code):
  **memoria persistente** (read/write Context Graph per progetto/sessione),
  **governance** (red-lines + approvazioni prima di azioni rischiose),
  **durabilità** (deleghe come Run ripartibili).
- Esempio guidato: collegare Claude Code all'OS e mostrare memoria che persiste
  tra sessioni + un'azione bloccata dal Sovereign.
- *Accettazione:* demo end-to-end "Claude Code + OS" con memoria e governance.

### IO-6 — Sicurezza & multi-tenant per esposizione esterna
- Isolamento per tenant/chiave, scoping risorse, audit ledger su ogni accesso
  esterno, controllo egress dei tool, quota/limiti.
- *Accettazione:* due tenant non vedono i dati l'uno dell'altro; ogni azione
  esterna è tracciata.

### IO-7 — Documentazione & quickstart per client
- Guide copia-incolla per: Claude Code, Cursor, VS Code, Antigravity, generico
  MCP, generico A2A, SDK REST.
- *Accettazione:* un dev integra l'OS nel suo tool in <15 minuti.

---

## Sequenza consigliata
1. **IO-0** (auth M2M) — sblocca ogni esposizione esterna in sicurezza.
2. **IO-1** (MCP production-grade) — il canale a più alto impatto immediato
   (tutti gli IDE agentici parlano MCP).
3. **IO-5** (backplane demo) — dimostra il valore con Claude Code.
4. **IO-3 + IO-4** (skills + SDK/OpenAPI) — allarga l'accessibilità.
5. **IO-2** (A2A) — delega agente↔agente, ecosistema Google/Antigravity.
6. **IO-6 + IO-7** — hardening multi-tenant e docs.

## Dipendenze con gli altri piani
- IO-1/IO-2 espongono l'**executor durevole** di `PLAN.md` (WS1, già in corso):
  i Run diventano task MCP/A2A.
- IO-0/IO-6 condividono l'auth/governance con `PLAN.md` WS2 (admin) e con le
  superfici UI di `PLAN-UIUX.md` (UX-4 admin, UX-3 runs).
- Conviene esporre ogni capability **prima via executor**, poi via MCP/A2A, così
  governance e durabilità valgono anche per i client esterni.

## Note di verifica
- I dettagli dei transport MCP e dei campi dell'agent card A2A vanno allineati
  alle **versioni correnti** delle rispettive spec al momento dell'implementazione
  (evolvono rapidamente). Le specifiche dei singoli prodotti (es. quale transport
  predilige un dato IDE) vanno confermate sulle loro doc ufficiali.
</content>
