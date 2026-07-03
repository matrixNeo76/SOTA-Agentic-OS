# Fase 1 — Audit & Gap Analysis: Phase 3 (ACTS) + Tool Manager

**Data**: 2026-07-03
**Moduli**: `phase3` (ACTS Controller) + `tools` (Tool Manager)
**Scope**: Phase 3 (Cognitive Steering) · Phase 18 (Tool Ecosystem + Permissions + Builtin Tools)

---

## 1. Mappatura

### Phase 3 (ACTS Controller)

| File | LOC | Ruolo |
|------|-----|-------|
| `phase3.tsx` | 273 | UI: controller state + steering phrase + event history |
| `/api/steering/route.ts` | 60 | GET vocab/events/strategies + POST steer |
| `acts.ts` | 125 | decideStrategy (deterministic FSM) + steer + history |

### Tool Manager

| File | LOC | Ruolo |
|------|-----|-------|
| `tool-manager.tsx` | 390 | UI: installati/installa/predefiniti + permission toggles |
| `/api/tools/route.ts` | 104 | GET stats/builtin/list + POST install/revoke/set_permission |
| `/api/admin/tools/route.ts` | 107 | Admin: GET builtin/registered/mcp + POST test/register/grant-scope |
| `tool-registry.ts` | 244 | installTool + revokeTool + setPermission + checkPermission |
| `builtin-tools.ts` | 356 | 7 builtin tools: filesystem.read/write/list, http.fetch, memory.search, graph.query, web.search |

---

## 2. Criticità (Critical)

### 🔴 C1 — `ToolPermission.toolId` key confusion (registered tools non eseguibili)

**File**: `tool-registry.ts`, `admin/tools/route.ts`, `tool-dispatcher.ts`

Tre path diversi memorizzano `ToolPermission.toolId` con valori diversi:
- `installTool()` → `tool.id` (cuid interno)
- `admin/tools grant-scope` → `body.toolId` (string user-facing)
- `tool-dispatcher executeRegistered` → query per `tool.toolId` (string user-facing)

**Effetto**: i tool installati via UI hanno permessi sotto cuid, ma il dispatcher cerca per string user-facing → 0 permessi trovati → tool sempre bloccato. I permessi granted via admin API sono invisibili al checkPermission.

### 🔴 C2 — `executeRegistered` scope check è existence-based, non scope-based

**File**: `tool-dispatcher.ts:140-152`

```ts
const permissions = await db.toolPermission.findMany({
  where: { toolId: tool.toolId, granted: true },
})
if (permissions.length === 0) { return error }
```

Controlla "ha ALMENO un permesso granted?" invece di "ha il permesso SPECIFICO richiesto?". Anche fixando C1, qualsiasi singolo permesso granted sblocca l'intero tool. I builtin tools sono correttamente checkati scope-per-scope in `executeBuiltin`.

### 🔴 C3 — `/api/tools` POST usa `requireAuth` invece di `requireAdmin`

**File**: `/api/tools/route.ts:38`

`install`, `revoke`, `set_permission` sono operazioni mutative che permettono a qualsiasi viewer di installare tool e grants `secret:access` o `process:spawn`. Il companion `/api/admin/tools` usa correttamente `requireAdmin`.

### 🔴 C4 — SSRF: `http.fetch` non filtra localhost/IP privati

**File**: `builtin-tools.ts` http.fetch tool

Il commento dice "no localhost in prod" ma l'implementazione controlla solo lo scheme (`http(s)://`). Un LLM può passare `http://169.254.169.254/latest/meta-data/` (AWS metadata) o `http://127.0.0.1:3000/api/admin/users`.

---

## 3. Bug (Medium)

### 🟠 B1 — `isPathAllowed` usa prefix match string-based

**File**: `builtin-tools.ts:330`

```ts
if (filePath.startsWith(resolved)) return true
```

`allowed = '/tmp/foo'` → `/tmp/foobar` è permesso. Dovrebbe essere `filePath === resolved || filePath.startsWith(resolved + sep)`.

### 🟠 B2 — `Tool.apiKey` stored come plaintext

**File**: `admin/tools/route.ts:83`

API key per tool esterni HTTP/MCP scritti direttamente in DB senza encryption.

### 🟠 B3 — `phase3.tsx` dynamic Tailwind class (JIT purged)

**File**: `phase3.tsx:192`

```tsx
border-${lastStrategy.toLowerCase()}-500/30
```

Tailwind JIT non vede classi dinamiche → il bordo non renderizza. Le classi `border-plan-500` etc. non esistono comunque.

### 🟠 B4 — `/api/steering` e `/api/admin/tools` senza try/catch

Entrambe le route non hanno error handling strutturato → 500 con stack trace.

### 🟠 B5 — `tool-manager.tsx` zero error handling

Nessun try/catch su `install`, `revoke`, `togglePermission`, `installBuiltin`, `refresh`. Silent failures.

### 🟠 B6 — `acts.ts` dead code: `cycleCounter` mai letto

```ts
let cycleCounter = 0 // incrementato ma mai usato
```

### 🟠 B7 — `installedBy` default a `'admin'` invece di `auth.email`

**File**: `/api/tools/route.ts:49`

Audit trail non traccia chi ha realmente installato il tool.

### 🟠 B8 — `defaultPermissions` install loop è sequential (N+1)

10 `setPermission` calls × 3 DB round-trips ciascuno = 30 query. Dovrebbe usare `createMany`.

---

## 4. Gap funzionali

### 🟡 G1 — Zero test per `acts.ts` e `tool-registry.ts` (critico)

`decideStrategy` è pura e banalmente testabile. `installTool`/`revokeTool`/`checkToolPermission` non hanno test. `builtin-tools.ts` non ha test per path traversal o SSRF.

### 🟡 G2 — a11y zero in entrambi i componenti

Nessun `aria-*` o `role` in `phase3.tsx` (273 LOC) o `tool-manager.tsx` (390 LOC).

### 🟡 G3 — `phase3.tsx` `refresh()` senza try/catch

Unhandled promise rejection su network error.

### 🟡 G4 — `require()` inline in `builtin-tools.ts`

Linee 139 e 171 usano `require('path')` e `require('fs')` inline nonostante gli import top-level. Dead duplicates.

---

## 5. Piano di intervento (Fasi 2-3)

### Fase 2 — Sicurezza & data integrity (C1-C4, B1-B2, B4)

1. **C1**: Standardizzare `ToolPermission.toolId` su `tool.id` (cuid) ovunque
2. **C2**: Fix `executeRegistered` per checkare scope specifico richiesto
3. **C3**: `requireAdmin` su POST `/api/tools` mutative actions
4. **C4**: Implementare SSRF protection in `http.fetch` (block localhost/loopback/private/metadata)
5. **B1**: Fix `isPathAllowed` con path-separator-aware comparison
6. **B2**: Documentare come known issue (encryption richiede secret manager)
7. **B4**: try/catch su `/api/steering` e `/api/admin/tools`
8. **Test**: integration test per C1 (key consistency), C3 (auth), C4 (SSRF block)

### Fase 3 — Bug fix & UX (B3, B5-B8, G1-G4)

1. **B3**: Sostituire dynamic Tailwind class con lookup map
2. **B5**: try/catch + toast.error in `tool-manager.tsx`
3. **B6**: Rimuovere dead `cycleCounter`
4. **B7**: Usare `auth.email` per `installedBy`
5. **B8**: Batch `defaultPermissions` con `createMany`
6. **G1**: Unit test per `decideStrategy`, `installTool`, `checkToolPermission`, `isPathAllowed`
7. **G3**: try/catch su `refresh()` in `phase3.tsx`
8. **G4**: Rimuovere `require()` inline

---

## 6. Metriche

- **File analizzati**: 10 (2 componenti, 3 API, 4 lib, schema)
- **LOC totali**: ~1.685
- **Bug critici (C)**: 4
- **Bug medi (B)**: 8
- **Gap funzionali (G)**: 4
- **Test esistenti**: 23 LOC (solo BUILTIN_TOOLS trivial checks)
- **Stima implementazione Fasi 2-3**: 2-3 giornate

---

## Prossimo passo

Procedere con **Fase 2 — Sicurezza & data integrity** (C1-C4, B1, B4).
