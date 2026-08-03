# SOTA Agentic OS — Stub Audit Report

> **Data:** 2026-06-22
> **Versione:** 0.9.0 (pre-Track 0)
> **Moduli analizzati:** 25
> **Metodo:** Analisi statica del codice in `src/lib/kernel/` + pattern matching + knowledge base manuale

---

## Riepilogo

| Status | Count | % |
|--------|-------|---|
| ✅ Reale | 17 | 68% |
| 🟡 Parziale | 6 | 24% |
| 🔴 Stub | 2 | 8% |
| **Totale** | 25 | 100% |

---

## Tabella Dettagliata

| Modulo | Status | Confidence | Righe | Export | Note |
|--------|--------|------------|-------|--------|------|
| ✅ `acts.ts` | real | 90% | 126 | 5 | Controller rule-based deterministico BY DESIGN (O(1) decision, no LLM richiesto) |
| ✅ `affect-subsystem.ts` | real | 90% | 210 | 6 | Telemetria affettiva con Meta-Observer deterministico BY DESIGN |
| 🟡 `agent-objective.ts` | partial | 90% | 241 | 6 | Genera sotto-obiettivo testuale con stub deterministico — dovrebbe usare LLM |
| ✅ `artificial-retainer.ts` | real | 90% | 424 | 16 | Delegation/HITL/Normative deterministici BY DESIGN (calcolo O(1)) |
| ✅ `compiled-ai.ts` | real | 100% | 163 | 7 | Implementazione completa |
| 🟡 `context-engineering.ts` | partial | 90% | 300 | 6 | summarizer deterministico (no LLM) — riassunti low-quality |
| ✅ `cost-ledger.ts` | real | 100% | 133 | 5 | Implementazione completa |
| ✅ `crypto-trust.ts` | real | 100% | 275 | 8 | Implementazione completa |
| ✅ `curator.ts` | real | 90% | 106 | 4 | Compilatore XML deterministico BY DESIGN (parsing strutturato, no LLM) |
| 🟡 `dominator-tree.ts` | partial | 90% | 403 | 11 | semanticMatch() ritorna false (stub) — dovrebbe usare LLM per matching semantico |
| ✅ `erl.ts` | real | 100% | 224 | 7 | Implementazione completa |
| ✅ `esr-quorum.ts` | real | 100% | 289 | 11 | Implementazione completa |
| 🔴 `grounded-inference.ts` | stub | 90% | 236 | 6 | simulateLLMOutput() deterministico, no LLM reale — dovrebbe usare ZAI SDK |
| 🟡 `lean4-agent.ts` | partial | 90% | 381 | 9 | Verifica simbolica emulata, no runtime Lean4 reale |
| 🟡 `ltl-monitor.ts` | partial | 90% | 784 | 11 | 7 pattern FSM, no NFA per pattern composti (G(F(p)), weak-until) |
| ✅ `normative.ts` | real | 90% | 115 | 7 | Cancello normativo deterministico BY DESIGN (gerarchia assiomatica O(1)) |
| ✅ `ns-mem.ts` | real | 100% | 168 | 7 | Implementazione completa |
| ✅ `observability.ts` | real | 100% | 475 | 20 | Implementazione completa |
| ✅ `patchboard.ts` | real | 90% | 205 | 5 | Kernel transazionale JSON Patch deterministico BY DESIGN |
| ✅ `scalability.ts` | real | 100% | 482 | 22 | Implementazione completa |
| ✅ `scheduler.ts` | real | 100% | 165 | 5 | Implementazione completa |
| 🟡 `sovereign-translator.ts` | partial | 90% | 167 | 9 | generateExplanation() template-based — dovrebbe usare LLM per spiegazioni in lin |
| ✅ `taint.ts` | real | 100% | 111 | 5 | Implementazione completa |
| 🔴 `time-router.ts` | stub | 90% | 279 | 9 | scoreModels() rule-based + simulateModelOutput() stub — dovrebbe usare LLM per s |
| ✅ `tool-registry.ts` | real | 100% | 244 | 10 | Implementazione completa |

---

## 🔴 Moduli Stub (implementazione deterministica, no LLM)

### grounded-inference.ts

- **Status:** 🔴 STUB (confidence 90%)
- **Righe:** 236
- **Export:** EncapsulatedCall, EncapsulatedResult, encapsulatedCall, updatePolicy, listSessions, groundingStats
- **Ragione nota:** simulateLLMOutput() deterministico, no LLM reale — dovrebbe usare ZAI SDK

**Evidenza codice:**

- Line 10 [medium] Deterministico/rule-based dichiarato: `*  - Anti-mutazione diretta: l'LLM sintetizza script di parsing deterministici`
- Line 38 [medium] Deterministico/rule-based dichiarato: `* 3) Costruisce un prompt deterministico con contesto minimale`
- Line 39 [medium] Commento STUB/TODO: `* 4) Chiama l'LLM (stub deterministico in questa implementazione)`
- Line 39 [medium] Deterministico/rule-based dichiarato: `* 4) Chiama l'LLM (stub deterministico in questa implementazione)`
- Line 52 [medium] Deterministico/rule-based dichiarato: `// 2) Costruisci prompt deterministico con reset esplicito della sessione`
- Line 66 [medium] Commento STUB/TODO: `// 3) Chiama l'LLM (stub: in produzione usare ZAI.create())`
- Line 68 [high] Funzione simulate*: `const modelOutput = simulateLLMOutput(call.taskGoal, call.contextData)`
- Line 160 [high] Funzione simulate*: `function simulateLLMOutput(taskGoal: string, context: Record<string, unknown>): string {`

### time-router.ts

- **Status:** 🔴 STUB (confidence 90%)
- **Righe:** 279
- **Export:** FoundationModelSpec, DEFAULT_MODELS, InputFeatures, RoutingResult, extractFeatures, route, updateConfig, listRoutingDecisions, routerStats
- **Ragione nota:** scoreModels() rule-based + simulateModelOutput() stub — dovrebbe usare LLM per scoring

**Evidenza codice:**

- Line 175 [high] Funzione simulate*: `const finalOutput = simulateModelOutput(primary.modelId, prompt)`
- Line 206 [medium] Commento STUB/TODO: `* Simula output del modello (stub).`
- Line 209 [high] Funzione simulate*: `function simulateModelOutput(modelId: string, prompt: string): string {`


---

## 🟡 Moduli Parziali (reale ma con limitazioni)

### agent-objective.ts

- **Status:** 🟡 PARTIALE (confidence 90%)
- **Righe:** 241
- **Export:** ObjectiveNodeSpec, createObjectiveTree, getObjectiveTree, evaluateNode, objectiveStats, listTrees
- **Ragione nota:** Genera sotto-obiettivo testuale con stub deterministico — dovrebbe usare LLM

**Evidenza codice:**

- Line 136 [medium] Commento STUB/TODO: `* Genera un sotto-obiettivo testuale (stub deterministico).`
- Line 136 [medium] Deterministico/rule-based dichiarato: `* Genera un sotto-obiettivo testuale (stub deterministico).`

### context-engineering.ts

- **Status:** 🟡 PARTIALE (confidence 90%)
- **Righe:** 300
- **Export:** recordToolCall, assembleWorkingContext, summarizeAndEvict, updatePolicy, contextStats, searchContextHistory
- **Ragione nota:** summarizer deterministico (no LLM) — riassunti low-quality

**Evidenza codice:**

- Line 127 [medium] Deterministico/rule-based dichiarato: `* In questa implementazione il summarizer è deterministico (no LLM):`

### dominator-tree.ts

- **Status:** 🟡 PARTIALE (confidence 90%)
- **Righe:** 403
- **Export:** DiscreteState, Trace, PTANode, PTAGraph, captureTrace, buildPTA, validateTrace, semanticMatch, dominatorStats, getPTA, listTraces
- **Ragione nota:** semanticMatch() ritorna false (stub) — dovrebbe usare LLM per matching semantico

**Evidenza codice:**

- Line 339 [medium] Commento STUB/TODO: `* In questa implementazione è stub: ritorna false.`
- Line 346 [medium] Commento STUB/TODO: `// Stub: matching esatto per ora`
- Line 350 [medium] Commento STUB/TODO: `return { equivalent: false, confidence: 0.0, reason: 'Match semantico non ancora implementato (stub)' }`

### lean4-agent.ts

- **Status:** 🟡 PARTIALE (confidence 90%)
- **Righe:** 381
- **Export:** FormalContractSpec, VerificationResult, attachContracts, autoGenerateContracts, verifyWorkflow, leanEvolve, leanStats, listVerifiedWorkflows, listEvolveEvents
- **Ragione nota:** Verifica simbolica emulata, no runtime Lean4 reale

**Evidenza codice:**

- Line 276 [medium] Commento STUB/TODO: `*  3) Genera nuova istruzione via LLM (stub: deterministica per ora)`
- Line 276 [medium] Deterministico/rule-based dichiarato: `*  3) Genera nuova istruzione via LLM (stub: deterministica per ora)`
- Line 304 [medium] Deterministico/rule-based dichiarato: `// Qui: rewrite deterministico (aggiunge "verifica precondizioni" all'istruzione)`

### ltl-monitor.ts

- **Status:** 🟡 PARTIALE (confidence 90%)
- **Righe:** 784
- **Export:** DiscreteState, LTLRuleSpec, DEFAULT_LTL_RULES, initMonitor, reloadMonitor, verifyEvent, addLTLRule, deleteLTLRule, listLTLRules, validateLTLFormula, previewFSM
- **Ragione nota:** 7 pattern FSM, no NFA per pattern composti (G(F(p)), weak-until)

**Evidenza codice:**

- Nessun pattern stub rilevato automaticamente (classificato manualmente)

### sovereign-translator.ts

- **Status:** 🟡 PARTIALE (confidence 90%)
- **Righe:** 167
- **Export:** BlockedActionInput, ResolutionChoice, registerBlockedAction, resolveBlockedAction, listPendingBlocked, listRecentBlocked, blockedStats, recordNarrative, listNarratives
- **Ragione nota:** generateExplanation() template-based — dovrebbe usare LLM per spiegazioni in linguaggio naturale

**Evidenza codice:**

- Line 25 [medium] Template-based: `const readableExplanation = input.readableExplanation || generateExplanation(input)`
- Line 79 [medium] Template-based: `function generateExplanation(input: BlockedActionInput): string {`


---

## ✅ Moduli Reali (implementazione completa)

| Modulo | Righe | Export |
|--------|-------|--------|
| `acts.ts` | 126 | 5 |
| `affect-subsystem.ts` | 210 | 6 |
| `artificial-retainer.ts` | 424 | 16 |
| `compiled-ai.ts` | 163 | 7 |
| `cost-ledger.ts` | 133 | 5 |
| `crypto-trust.ts` | 275 | 8 |
| `curator.ts` | 106 | 4 |
| `erl.ts` | 224 | 7 |
| `esr-quorum.ts` | 289 | 11 |
| `normative.ts` | 115 | 7 |
| `ns-mem.ts` | 168 | 7 |
| `observability.ts` | 475 | 20 |
| `patchboard.ts` | 205 | 5 |
| `scalability.ts` | 482 | 22 |
| `scheduler.ts` | 165 | 5 |
| `taint.ts` | 111 | 5 |
| `tool-registry.ts` | 244 | 10 |

---

## Raccomandazioni per Track 1 — Intelligenza Reale

I seguenti moduli richiedono integrazione LLM reale (Track 1, Settimana 16):

1. **grounded-inference.ts** — sostituire `simulateLLMOutput()` con ZAI SDK
2. **time-router.ts** — sostituire `scoreModels()` rule-based con LLM scoring
3. **sovereign-translator.ts** — sostituire `generateExplanation()` template con LLM

I seguenti moduli richiedono approfondimento (Track 3, opzionale):

1. **lean4-agent.ts** — dichiarare "emulazione simbolica" o integrare runtime Lean4 reale
2. **ltl-monitor.ts** — estendere a NFA per pattern composti (`G(F(p))`, weak-until)

---

*Report generato il 2026-06-22 da `scripts/audit-stubs.ts`*
