/**
 * Fase 18: Tool Ecosystem — Package manager agentico
 *
 * I tool non vengono scelti dall'agente per similarità semantica (che porta
 * ad attacchi di Hallucination Squatting), ma sono risolti tramite
 * identificatori crittografici (signature).
 *
 * I permessi a grana fine alimentano direttamente le pre/post-conditions
 * della Fase 8 (Lean4 Formal Verifier).
 */
import { db } from '@/lib/db'
import { createHash } from 'crypto'

export type ToolSpec = {
  toolId: string
  name: string
  version: string
  description?: string
  publisher?: string
}

export type ToolPermissionScope = {
  scope: string  // es. "filesystem:read", "network:post", "tool:exec", "db:write"
  granted: boolean
  constraint?: Record<string, unknown>
}

// Scopes predefiniti disponibili
export const AVAILABLE_SCOPES = [
  'filesystem:read',
  'filesystem:write',
  'network:get',
  'network:post',
  'tool:exec',
  'db:read',
  'db:write',
  'process:spawn',
  'env:read',
  'secret:access',
] as const

/**
 * Calcola una signature crittografica (simulata) per un tool.
 * In produzione: signing reale con chiave privata del publisher.
 */
function computeSignature(spec: ToolSpec): string {
  const content = `${spec.toolId}:${spec.name}:${spec.version}:${spec.publisher || 'anonymous'}`
  return 'sha256:' + createHash('sha256').update(content).digest('hex').slice(0, 32)
}

/**
 * Installa un nuovo tool con permessi di default (tutti negati).
 */
export async function installTool(spec: ToolSpec, installedBy = 'admin'): Promise<{
  toolId: string
  signature: string
  permissionsCreated: number
}> {
  const signature = computeSignature(spec)

  const tool = await db.tool.create({
    data: {
      toolId: spec.toolId,
      name: spec.name,
      version: spec.version,
      signature,
      description: spec.description || null,
      publisher: spec.publisher || null,
      installedBy,
      active: true,
    },
  })

  // B8 — Batch insert di tutti i permessi default in una singola query
  // (PRIMA: N+1 con 10 setPermission calls × 3 round-trips = 30 query).
  // createMany è atomico e O(1) round-trip.
  const perms = AVAILABLE_SCOPES.map((scope) => ({
    toolId: tool.id,
    scope,
    granted: false,
    grantedBy: null,
  }))
  await db.toolPermission.createMany({ data: perms })

  return {
    toolId: tool.toolId,
    signature,
    permissionsCreated: perms.length,
  }
}

/**
 * Revoca un tool (disattiva, non elimina per audit).
 */
export async function revokeTool(toolId: string, reason: string): Promise<void> {
  const tool = await db.tool.findUnique({ where: { toolId } })
  if (!tool) throw new Error(`Tool ${toolId} non trovato`)
  await db.tool.update({
    where: { id: tool.id },
    data: {
      active: false,
      revokedAt: new Date(),
      revokeReason: reason,
    },
  })
  // Revoca tutti i permessi
  await db.toolPermission.updateMany({
    where: { toolId: tool.id },
    data: { granted: false },
  })
}

/**
 * Modifica un permesso di un tool.
 *
 * C2 fix (Tool Manager audit Fase A): upsert invece di findFirst+create.
 * PRIMA: findFirst + create/update separati → race condition: 2 admin concorrenti
 * potevano entrambi leggere existing=null e entrambi creare → duplicato.
 * ORA: upsert con where unique (toolId, scope) — atomic, no race condition.
 * Richiede @@unique([toolId, scope]) nel schema Prisma (C3 fix).
 */
export async function setPermission(
  toolId: string,
  scope: string,
  granted: boolean,
  grantedBy = 'admin',
  constraint?: Record<string, unknown>
): Promise<void> {
  const tool = await db.tool.findUnique({ where: { toolId } })
  if (!tool) throw new Error(`Tool ${toolId} non trovato`)

  // C2 — upsert atomico (no race condition)
  await db.toolPermission.upsert({
    where: {
      toolId_scope: { toolId: tool.id, scope },
    },
    update: {
      granted,
      grantedBy: granted ? grantedBy : undefined,
      constraint: constraint ? JSON.stringify(constraint) : undefined,
    },
    create: {
      toolId: tool.id,
      scope,
      granted,
      grantedBy: granted ? grantedBy : null,
      constraint: constraint ? JSON.stringify(constraint) : null,
    },
  })
}

/**
 * Verifica se un tool ha un permesso specifico.
 * Da chiamare a runtime prima di eseguire il tool.
 */
export async function checkToolPermission(toolId: string, scope: string): Promise<{
  authorized: boolean
  reason: string
  constraint?: Record<string, unknown>
}> {
  const tool = await db.tool.findUnique({ where: { toolId } })
  if (!tool) {
    return { authorized: false, reason: `Tool ${toolId} non installato` }
  }
  if (!tool.active) {
    return { authorized: false, reason: `Tool ${toolId} revocato: ${tool.revokeReason}` }
  }
  const perm = await db.toolPermission.findFirst({
    where: { toolId: tool.id, scope },
  })
  if (!perm || !perm.granted) {
    return { authorized: false, reason: `Permesso ${scope} non concesso al tool ${toolId}` }
  }
  return {
    authorized: true,
    reason: 'Autorizzato',
    constraint: perm.constraint ? JSON.parse(perm.constraint) : undefined,
  }
}

/**
 * Lista tutti i tool installati con i relativi permessi.
 *
 * C1 fix (Tool Manager audit Fase A): include permissions (no N+1).
 * PRIMA: 1 query per i tool + N query per le permissions di ogni tool → N+1 round-trip.
 * Con 50 tool installati: 51 round-trip DB.
 * ORA: 1 query con include: { permissions: true } → 1 round-trip DB (O(1)).
 * Richiede @relation ToolPermission→Tool nel schema Prisma (C3 fix).
 */
export async function listTools(includeRevoked = false) {
  const tools = await db.tool.findMany({
    where: includeRevoked ? {} : { active: true },
    orderBy: { installedAt: 'desc' },
    include: { permissions: true },  // C1: batch load (no N+1)
  })
  return tools.map((t) => ({
    ...t,
    permissions: t.permissions.map((p) => ({
      scope: p.scope,
      granted: p.granted,
      constraint: p.constraint ? JSON.parse(p.constraint) : null,
    })),
    grantedCount: t.permissions.filter((p) => p.granted).length,
    totalCount: t.permissions.length,
  }))
}

/**
 * Statistiche per dashboard.
 *
 * B5 fix (Tool Manager audit Fase B): tutte le query in Promise.all (già fatto, confermato).
 * B4 fix (Tool Manager audit Fase B): metriche derivate aggiuntive.
 * PRIMA: solo 5 metriche raw (total, active, revoked, totalPerms, grantedPerms).
 * ORA: aggiunte 3 metriche derivate:
 *  - permissionRate: grantedPerms / totalPerms (% scopes concesse)
 *  - activeRate: active / total (% tool attivi)
 *  - externalTools: count tool con transport !== null (HTTP/MCP tools)
 */
export async function toolStats() {
  const [total, active, revoked, totalPerms, grantedPerms, externalTools] = await Promise.all([
    db.tool.count(),
    db.tool.count({ where: { active: true } }),
    db.tool.count({ where: { active: false } }),
    db.toolPermission.count(),
    db.toolPermission.count({ where: { granted: true } }),
    // B4 — external tools (transport !== null = HTTP or MCP)
    db.tool.count({ where: { NOT: { transport: null } } }),
  ])

  // B4 — metriche derivate
  const permissionRate = totalPerms > 0 ? grantedPerms / totalPerms : 0
  const activeRate = total > 0 ? active / total : 0

  return {
    total,
    active,
    revoked,
    totalPerms,
    grantedPerms,
    // B4 — metriche derivate
    permissionRate,
    activeRate,
    externalTools,
  }
}

/**
 * Builtin tools per il seed iniziale.
 */
export const BUILTIN_TOOLS: ToolSpec[] = [
  {
    toolId: 'github-integration',
    name: 'GitHub Integration',
    version: '1.2.0',
    description: 'Read repos, open issues, create PRs',
    publisher: 'sota-os-official',
  },
  {
    toolId: 'filesystem-browser',
    name: 'Filesystem Browser',
    version: '0.9.1',
    description: 'Navigate and read local files',
    publisher: 'sota-os-official',
  },
  {
    toolId: 'web-search',
    name: 'Web Search',
    version: '2.0.0',
    description: 'Search the web and retrieve results',
    publisher: 'sota-os-official',
  },
]
