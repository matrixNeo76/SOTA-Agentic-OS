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

  // Crea tutti i permessi predefiniti come negati (principio minimo privilegio)
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

  // Upsert: cerca permesso esistente, altrimenti crea
  const existing = await db.toolPermission.findFirst({
    where: { toolId: tool.id, scope },
  })
  if (existing) {
    await db.toolPermission.update({
      where: { id: existing.id },
      data: {
        granted,
        grantedBy: granted ? grantedBy : existing.grantedBy,
        constraint: constraint ? JSON.stringify(constraint) : existing.constraint,
      },
    })
  } else {
    await db.toolPermission.create({
      data: {
        toolId: tool.id,
        scope,
        granted,
        grantedBy: granted ? grantedBy : null,
        constraint: constraint ? JSON.stringify(constraint) : null,
      },
    })
  }
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
 */
export async function listTools(includeRevoked = false) {
  const tools = await db.tool.findMany({
    where: includeRevoked ? {} : { active: true },
    orderBy: { installedAt: 'desc' },
  })
  const result = []
  for (const t of tools) {
    const perms = await db.toolPermission.findMany({ where: { toolId: t.id } })
    result.push({
      ...t,
      permissions: perms.map((p) => ({
        scope: p.scope,
        granted: p.granted,
        constraint: p.constraint ? JSON.parse(p.constraint) : null,
      })),
      grantedCount: perms.filter((p) => p.granted).length,
      totalCount: perms.length,
    })
  }
  return result
}

/**
 * Statistiche per dashboard.
 */
export async function toolStats() {
  const [total, active, revoked, totalPerms, grantedPerms] = await Promise.all([
    db.tool.count(),
    db.tool.count({ where: { active: true } }),
    db.tool.count({ where: { active: false } }),
    db.toolPermission.count(),
    db.toolPermission.count({ where: { granted: true } }),
  ])
  return { total, active, revoked, totalPerms, grantedPerms }
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
