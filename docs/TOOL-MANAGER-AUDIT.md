# Tool Manager — Audit & Hardening (Fase 2)

**Data**: 2026-09-02
**Modulo**: `Tool Manager` — Phase 3/18 (F3/F18)
**Scope**: `src/lib/kernel/tool-registry.ts` · `src/lib/runtime/builtin-tools.ts` · `src/lib/runtime/tool-dispatcher.ts` · `src/app/api/tools/route.ts` · `src/app/api/admin/tools/route.ts` · `src/components/agentic/tool-manager.tsx`

---

## 1. Mappatura

### File coinvolti

| File | LOC | Ruolo |
|------|-----|-------|
| `src/lib/kernel/tool-registry.ts` | 245 | Core: `installTool` + `revokeTool` + `setPermission` + `checkPermission` + `listTools` + `getToolStats` |
| `src/lib/runtime/builtin-tools.ts` | 474 | 7 builtin tools (filesystem.read/write/list, http.fetch, memory.search, graph.query, web.search) + SSRF protection (`assertSafeUrl`) + path-safety (`isPathAllowed`) |
| `src/lib/runtime/tool-dispatcher.ts` | 373 | `dispatchTool` (scope enforcement, taint checkSink, timeout, audit trail) + `callExternalTool` (HTTP/MCP transport) + `getDefaultScopes` |
| `src/app/api/tools/route.ts` | 148 | API REST: GET tools/stats/builtin + POST install/revoke/set_permission/check_permission |
| `src/app/api/admin/tools/route.ts` | 143 | Admin API: GET builtin/registered/mcp + POST test/register/grant-scope |
| `src/components/agentic/tool-manager.tsx` | 444 | UI: installati/installa/predefiniti + permission toggles + stat card |

### Schema Prisma (DB)

```prisma
model Tool {
  id           String   @id @default(cuid())
  toolId       String   @unique
  name         String
  version      String
  signature    String   // hash crittografico (simulato)
  description  String?
  publisher    String?
  active       Boolean  @default(true)
  installedAt  DateTime @default(now())
  installedBy  String?
  revokedAt    DateTime?
  revokeReason String?
  transport    String?  // "http" | "mcp" | null
  endpoint     String?
  apiKey       String?  // ⚠️ B2: plaintext, tech debt
  inputSchema  String?
}

model ToolPermission {
  id           String   @id @default(cuid())
  toolId       String   // ⚠️ No @relation to Tool.id, no @@unique(toolId, scope)
  scope        String
  granted      Boolean  @default(false)
  grantedBy    String?
  grantedAt    DateTime @default(now())
  constraint   String?
}
```

### Stato pre-audit (Fase 1 completata)

Il modulo è stato auditato nel ciclo `docs/PHASE3-TOOLMANAGER-FASE1-AUDIT.md` con fix già applicati:
- ✅ C1: `ToolPermission.toolId` standardizzato su `tool.id` (cuid interno, non `tool.toolId`)
- ✅ C2: scope check per-scope (non existence-based), `transport`/`endpoint`/`apiKey` per tool esterni
- ✅ C3: POST `/api/tools` richiede `requireAdmin` per mutative, `requireAuth` per `check_permission`
- ✅ C4: SSRF protection (`assertSafeUrl` + `isPrivateIP`) su `http.fetch`
- ✅ B1: `isPathAllowed` path-separator-aware (no bypass `/tmp` → `/tmp-evil`)
- ✅ B4: `/api/admin/tools` try/catch su tutte le POST
- ✅ B5: `tool-manager.tsx` tutte le action functions hanno try/catch + toast.error
- ✅ B8: `installTool` batch `createMany` per default permissions (no N+1)
- ✅ G1: 3 test file (1224 LOC total): `tool-registry.test.ts` + `phase3-toolmanager-core.test.ts` + `phase3-toolmanager-fase2.test.ts`
- ✅ G2: a11y parziale (aria-label su button/switch)
- ✅ G4: dynamic `import()` invece di `require()` in builtin-tools
- ⚠️ B2: `apiKey` plaintext — documentato come tech debt (richiede Vault/KMS)
- ⚠️ B7: `installedBy` defaulta a `'admin'` in `installTool()` (API routes passano `auth.email`)

Questo audit (Fase 2) si concentra su **bug residui e gap non coperti** dal Fase 1.

---

## 2. Criticità (Critical)

### 🔴 C1 — `listTools()` ha N+1 query (performance bottleneck)

**File**: `src/lib/kernel/tool-registry.ts:184-204`

```ts
export async function listTools() {
  const tools = await db.tool.findMany({ ... })
  // C1: N+1 — per ogni tool, query separata per permissions
  for (const t of tools) {
    const permissions = await db.toolPermission.findMany({
      where: { toolId: t.id },
    })
    // ...
  }
}
```

Come B8 del Fase 1 (che fixò `installTool`), `listTools()` ha lo stesso pattern N+1: 1 query per i tool + N query per le permissions. Con 50 tool installati, sono 51 round-trip DB. Fix: `include: { permissions: true }` (richiede relation nel schema) oppure batch query con `groupBy`.

### 🔴 C2 — `setPermission` race condition (no unique constraint)

**File**: `src/lib/kernel/tool-registry.ts:90-120`

```ts
export async function setPermission(toolId: string, scope: string, granted: boolean, actor: string) {
  const existing = await db.toolPermission.findFirst({
    where: { toolId, scope },
  })
  if (existing) {
    return db.toolPermission.update({ ... })
  }
  return db.toolPermission.create({ ... })
}
```

Read-then-write pattern: 2 admin concorrenti che concedono la stessa scope allo stesso tool possono entrambi leggere `existing = null` e entrambi fare `create` → **duplicato** `ToolPermission` con stessa `(toolId, scope)`. Fix: `@@unique([toolId, scope])` nel schema Prisma + `upsert` invece di findFirst+create.

### 🔴 C3 — `ToolPermission.toolId` non ha foreign key (orphan permissions risk)

**File**: `prisma/schema.prisma`

```prisma
model ToolPermission {
  toolId String   // ⚠️ No @relation to Tool.id
  scope  String
  // ...
}
```

Senza `@relation(fields: [toolId], references: [id])` e `onDelete: Cascade`, se un tool viene cancellato (non revoked, ma fisicamente cancellato dal DB), le sue `ToolPermission` rimangono orfane. Inoltre, `checkPermission` può trovare permissions per `toolId` non più esistenti → security bypass potenziale. Fix: aggiungere relation + `onDelete: Cascade` nel schema.

---

## 3. Bug (Medium)

### 🟠 B1 — `tool-manager.tsx` `refresh()` senza try/catch

**File**: `src/components/agentic/tool-manager.tsx:51-74`

```ts
const refresh = async () => {
  const [toolsR, statsR] = await Promise.all([
    fetch('/api/tools').then((r) => r.json()),
    fetch('/api/tools?action=stats').then((r) => r.json()),
  ])
  setTools(toolsR.tools || [])
  setStats(statsR)
}
```

B5 del Fase 1 fixò le action functions (`install`, `revoke`, `togglePermission`, `installBuiltin`) con try/catch, ma `refresh()` no. Un fetch fallito rompe il polling e lascia la UI stale. Come B1 degli altri moduli.

### 🟠 B2 — `dispatchTool` non ha retry su tool execution failure

**File**: `src/lib/runtime/tool-dispatcher.ts:240-340`

Se un builtin tool o un external tool fallisce (timeout, network error), `dispatchTool` ritorna immediatamente `status: 'error'`. Nessun retry. Come B4 degli altri moduli (Model Encapsulator, Model Router).

### 🟠 B3 — `tool-manager.tsx` action functions non hanno parse-safe su `r.json()`

**File**: `src/components/agentic/tool-manager.tsx`

Le action functions (`install`, `revoke`, `togglePermission`, `installBuiltin`) hanno try/catch esterno (B5 fix), ma `r.json()` può throware su risposta non JSON. Come G3 degli altri moduli.

### 🟠 B4 — `getToolStats` manca metriche derivate (permissionRate, activeTools)

**File**: `src/lib/kernel/tool-registry.ts:206-244`

```ts
export async function getToolStats() {
  const [total, active, revoked, permissions] = await Promise.all([...])
  const granted = await db.toolPermission.count({ where: { granted: true } })
  return { total, active, revoked, permissions, granted }
}
```

Mancano:
- `permissionRate` (granted / permissions, % scopes concesse)
- `activeRate` (active / total, % tool attivi)
- `revokedRate` (revoked / total, % tool revocati)
- `externalTools` (count tool con `transport !== null`)

Come G4 degli altri moduli.

### 🟠 B5 — `getToolStats` ha query sequenziale dopo Promise.all

**File**: `src/lib/kernel/tool-registry.ts:206-244`

Come B3 degli altri moduli: 4 query in Promise.all + 1 sequenziale (`granted`) = 2 round-trip DB invece di 1.

### 🟠 B6 — `getDefaultScopes` è hardcoded (no AgentPolicy integration)

**File**: `src/lib/runtime/tool-dispatcher.ts:357-372`

```ts
export function getDefaultScopes(agentId: string): string[] {
  // B6: hardcoded — in produzione dovrebbe leggere da AgentPolicy (Fase 3.3)
  return ['tool:exec', 'filesystem:read', 'network:get']
}
```

Il commento riconosce il problema. Ogni agente ha gli stessi scope di default, indipendentemente dal ruolo o dal task. Fix: leggere da `AgentPolicy` (se esiste nel DB) con fallback agli hardcoded.

---

## 4. Gap funzionali

### 🟡 G1 — `tool-registry.test.ts` è solo 22 LOC (stub)

**File**: `tests/unit/tool-registry.test.ts`

Il file esiste ma è quasi vuoto (22 LOC). I test sostanziali sono in `phase3-toolmanager-core.test.ts` (579 LOC) e `phase3-toolmanager-fase2.test.ts` (623 LOC), ma questi testano il modulo end-to-end, non `tool-registry.ts` in isolamento. Mancano unit test focalizzati per:
- `installTool` (crea Tool + batch permissions + audit log)
- `revokeTool` (marca active=false + revokedAt + revokeReason)
- `setPermission` (upsert granted/grantedBy)
- `checkPermission` (per-scope check, fallback tool:exec)
- `listTools` (N+1 da verificare dopo fix C1)
- `getToolStats` (accuracy metriche)

### 🟡 G2 — `tool-manager.tsx` a11y parziale (manca role=status su stats grid)

**File**: `src/components/agentic/tool-manager.tsx`

G2 del Fase 1 fixò aria-label su button/switch, ma la stats grid non ha `role=status` + `aria-live=polite`. Come G2 degli altri moduli.

### 🟡 G3 — `tool-manager.tsx` action functions non hanno parse-safe (assorbito in B3)

Vedi B3 sopra. Le action functions hanno try/catch esterno ma `r.json()` non è parse-safe.

### 🟡 G4 — `tool-registry.test.ts` non ha test per SSRF protection (`assertSafeUrl`)

**File**: `tests/unit/tool-registry.test.ts`

La SSRF protection (`assertSafeUrl` + `isPrivateIP` in `builtin-tools.ts`) è una feature di sicurezza critica (C4 Fase 1 fix), ma non ha unit test dedicati che testano:
- `assertSafeUrl` con URL localhost → blocks
- `assertSafeUrl` con URL private IP (192.168.x.x, 10.x.x.x) → blocks
- `assertSafeUrl` con URL pubblico → allows
- `isPrivateIP` con IPv6 loopback (::1) → blocks
- `isPrivateIP` con IPv4-mapped IPv6 (::ffff:127.0.0.1) → blocks

---

## 5. Piano di intervento (3 fasi)

### Fase A — Sicurezza & effettività (C1, C2, C3)

1. **C1**: `listTools()` — sostituire N+1 loop con `include: { permissions: true }` (richiede relation nel schema, vedi C3) oppure batch query con `groupBy`
2. **C2**: `setPermission` — aggiungere `@@unique([toolId, scope])` nel schema Prisma + usare `upsert` invece di findFirst+create
3. **C3**: `ToolPermission.toolId` — aggiungere `@relation(fields: [toolId], references: [id], onDelete: Cascade)` nel schema

**Nota**: C2 + C3 richiedono una Prisma migration. La migration è sicura (additive: unique constraint + relation), ma deve essere testata su DB esistente con dati.

### Fase B — Robustezza (B1, B2, B3, B4, B5)

1. **B1**: `tool-manager.tsx` `refresh()` con try/catch + toast.error + preserva stato
2. **B2**: `dispatchTool` retry logic su tool execution failure (max 2 retry con backoff)
3. **B3**: `tool-manager.tsx` action functions parse-safe su `r.json()` (try/catch interno + fallback `r.text()`)
4. **B4**: `getToolStats` con 4 metriche derivate (permissionRate, activeRate, revokedRate, externalTools)
5. **B5**: `getToolStats` — `granted` query in `Promise.all` con le altre 4 (1 round-trip DB)

### Fase C — UX & completamento (G1, G2, G3, G4)

1. **G1**: Unit test focalizzati per `tool-registry.ts` (installTool, revokeTool, setPermission, checkPermission, listTools, getToolStats)
2. **G2**: `tool-manager.tsx` a11y completa (role=status + aria-live su stats grid, StatCard role=group)
3. **G3**: parse-safe verification (assorbito in B3)
4. **G4**: Unit test per SSRF protection (`assertSafeUrl`, `isPrivateIP` con IPv4/IPv6 edge cases)

---

## 6. Metriche

| Metrica | Valore |
|---------|--------|
| File analizzati | 6 (1 core registry + 1 builtin + 1 dispatcher + 2 API + 1 UI) |
| LOC totali | ~1825 |
| Bug critici (C) | 3 |
| Bug medi (B) | 6 |
| Gap funzionali (G) | 4 |
| Test esistenti | 3 file (1224 LOC): tool-registry.test.ts (22 LOC stub) + phase3-toolmanager-core (579) + phase3-toolmanager-fase2 (623) |
| Consumer runtime | `executor.ts` (dispatchTool), `react-loop.ts` (tool dispatch), `taint.ts` (checkSink), `mcp-client/client.ts` (callExternalTool) |
| Fix preesistenti Fase 1 | C1, C2, C3, C4, B1, B4, B5, B8, G1 (parziale), G2 (parziale), G4 |
| Fix preesistenti altri audit | G2 LTL (taint checkSink in dispatcher) |
| Stima Fase A | 1 giornata (include Prisma migration) |
| Stima Fase B | 0.5 giornate |
| Stima Fase C | 1 giornata |
| **Totale** | **2.5 giornate** |

---

## 7. Priorità raccomandata

1. **Fase A** (C1+C2+C3) — sicurezza & data integrity. **Critica**.
   - C1: listTools N+1 → O(1) round-trip (performance)
   - C2: unique constraint → no race condition su setPermission (data integrity)
   - C3: foreign key + cascade → no orphan permissions (referential integrity)
2. **Fase B** (B1+B2+B3+B4+B5) — robustezza. **Alta**.
3. **Fase C** (G1+G2+G3+G4) — UX & completamento. **Media**.

---

## Prossimo passo

Confermare quale fase avviare. Suggerisco **Fase A** perché risolve i 3 bug critici:
- C1: listTools N+1 → O(1) (performance bottleneck su 50+ tool)
- C2: unique constraint → no duplicati su setPermission (race condition)
- C3: foreign key → no orphan permissions (referential integrity)

**Nota speciale**: C2+C3 richiedono una Prisma migration. La migration è sicura (additive: unique constraint + relation + onDelete cascade), ma deve essere testata su DB esistente con dati. Se la migration non è desiderata in questo momento, C2 può essere mitigata con `upsert` (app-level, no schema change) e C3 con cleanup script per orphan permissions.

Tempo stimato: 1 giornata.
