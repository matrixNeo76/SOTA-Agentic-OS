# SOTA Agentic OS — Project Stats (Reconciled)

> **Data:** 2026-06-22
> **Versione:** 0.9.0
> **Metodo:** Conteggio automatico da `scripts/count-stats.ts`

---

## Numeri Ufficiali (fonte di verità)

| Metrica | Valore | Fonte |
|---------|--------|-------|
| Modelli Prisma | 62 | `prisma/schema.prisma` |
| API routes | 36 | `src/app/api/**/route.ts` |
| Moduli kernel | 25 | `src/lib/kernel/*.ts` |
| Componenti workbench | 19 (~5481 righe) | `src/components/workbench/*.{ts,tsx}` |
| Componenti UI shadcn | 48 | `src/components/ui/*.tsx` |
| File di test | 6 | `tests/**/*.test.{ts,tsx}` |

---

## Modelli Prisma (62)

```
EpisodicMemory
SemanticEntity
LogicalRule
PatchTransaction
GlobalState
SensoriumSnapshot
AgentPlan
PlanTask
CompiledArtifact
CompiledTemplate
SteeringEvent
SteeringStrategy
LTLRule
VerificationEvent
TaintRecord
NormativeRule
Heuristic
RedLine
ReflectionLog
AgentLog
ToolCallEntry
ContextSummary
PruningPolicy
ExecutionTrace
PrefixTreeAutomaton
TraceValidation
FormalContract
LeanEvolveEvent
VerifiedWorkflow
DelegationContract
ApprovalGate
NormativeResolution
AuditLedgerEntry
EncapsulatedSession
EncapsulationPolicy
AffectSample
AffectThreshold
ObjectiveTree
ObjectiveNode
Belief
ESRSyncEvent
QuorumVote
QuorumDecision
FoundationModel
RoutingDecision
RouterConfig
CockpitNarrative
BlockedAction
Tool
ToolPermission
User
Session
PublisherKey
ErrorRecord
TraceSpan
BackupRecord
JobRecord
FSMSnapshot
TaintFlow
CostEntry
ConversationBranch
SharedConversation
```

---

## API Routes (36)

```
/api/affect
/api/auth
/api/backup
/api/blocked-actions
/api/cockpit
/api/compiled
/api/console
/api/console/stream
/api/context
/api/conversation/branch
/api/conversation/share
/api/cost
/api/dashboard
/api/dominator
/api/embeddings
/api/errors
/api/esr
/api/grounded
/api/jobs
/api/lean
/api/memory
/api/metrics
/api/objective
/api/patchboard
/api/plan
/api/publishers
/api/reflect
/api/retainer
/api/router
/api/scalability
/api/seed
/api/sensorium
/api/steering
/api/tools
/api/traces
/api/verify
```

---

## Moduli Kernel (25)

```
acts.ts
affect-subsystem.ts
agent-objective.ts
artificial-retainer.ts
compiled-ai.ts
context-engineering.ts
cost-ledger.ts
crypto-trust.ts
curator.ts
dominator-tree.ts
erl.ts
esr-quorum.ts
grounded-inference.ts
lean4-agent.ts
ltl-monitor.ts
normative.ts
ns-mem.ts
observability.ts
patchboard.ts
scalability.ts
scheduler.ts
sovereign-translator.ts
taint.ts
time-router.ts
tool-registry.ts
```

---

## Componenti Workbench (19, ~5481 righe)

```
attachment-preview.tsx
blocked-inspector.tsx
canvas-view.tsx
command-palette.tsx
command-registry.ts
context-panel.tsx
cost-breakdown-modal.tsx
inline-actions.tsx
log-inspector.tsx
node-inspector.tsx
quick-stats.tsx
skeletons.tsx
sovereign-view.tsx
status-bar.tsx
streaming-text.tsx
timeline-view.tsx
use-command-palette.ts
view-transition.tsx
workspace-views.tsx
```

---

## Componenti UI shadcn (48)

```
accordion.tsx
alert-dialog.tsx
alert.tsx
aspect-ratio.tsx
avatar.tsx
badge.tsx
breadcrumb.tsx
button.tsx
calendar.tsx
card.tsx
carousel.tsx
chart.tsx
checkbox.tsx
collapsible.tsx
command.tsx
context-menu.tsx
dialog.tsx
drawer.tsx
dropdown-menu.tsx
form.tsx
hover-card.tsx
input-otp.tsx
input.tsx
label.tsx
menubar.tsx
navigation-menu.tsx
pagination.tsx
popover.tsx
progress.tsx
radio-group.tsx
resizable.tsx
scroll-area.tsx
select.tsx
separator.tsx
sheet.tsx
sidebar.tsx
skeleton.tsx
slider.tsx
sonner.tsx
switch.tsx
table.tsx
tabs.tsx
textarea.tsx
toast.tsx
toaster.tsx
toggle-group.tsx
toggle.tsx
tooltip.tsx
```

---

## File di Test (6)

```
embeddings.test.ts
erl.test.ts
ltl-monitor.test.ts
normative.test.ts
patchboard.test.ts
taint.test.ts
```

---

*Statistiche generate il 2026-06-22 da `scripts/count-stats.ts`*
