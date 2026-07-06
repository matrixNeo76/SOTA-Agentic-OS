/**
 * Builtin Tools — WS1.4c
 *
 * Implementazione reale dei tool built-in che l'executor può invocare.
 * Ogni tool ha:
 *   - name: identificatore univoco
 *   - description: per l'LLM (tool-calling schema)
 *   - parameters: JSON schema per i parametri
 *   - execute: funzione che esegue il tool
 *
 * Sicurezza:
 *   - filesystem:read/write limitato a path consentiti (whitelist)
 *   - network:get limitato a URL http/https (no localhost in prod)
 *   - shell: disabilitato di default, abilitabile solo in dev
 *   - Tutti i tool rispettano timeout (10s default)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve, isAbsolute, dirname, sep } from 'path'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { getCachedArray, isCacheLoaded } from '@/lib/settings'

// === Tipi ============================================================

export interface BuiltinTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  requiredScopes: string[]
  execute: (params: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>
}

export interface ToolExecutionContext {
  agentId: string
  planId: string
  taskId: string
  timeout: number
  allowedPaths?: string[] // for filesystem tools
  sandboxEnabled: boolean
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  metadata?: Record<string, unknown>
}

// === Config ==========================================================

const DEFAULT_TIMEOUT = 10_000 // 10s
// C0 — Derive allowed paths from cwd instead of hardcoded /home/z/my-project.
const CWD = process.cwd()

// C6 — Fallback defaults used when neither the settings cache nor the env
// var has been populated. Keeping these as functions (not consts) ensures
// we always see the latest value from the settings store, so admin updates
// via /api/admin/settings take effect on the next tool call without restart.
const FALLBACK_READ_PATHS = ['/tmp', join(CWD, 'src'), join(CWD, 'download')]
const FALLBACK_WRITE_PATHS = ['/tmp', join(CWD, 'upload')]

function getAllowedReadPaths(): string[] {
  // Settings cache wins (DB > env > default), then env var, then fallback.
  if (isCacheLoaded()) {
    const fromCache = getCachedArray('tool.allowed_read_paths')
    if (fromCache.length > 0) return fromCache
  }
  return process.env.TOOL_ALLOWED_READ_PATHS
    ? process.env.TOOL_ALLOWED_READ_PATHS.split(',').map((s) => s.trim()).filter(Boolean)
    : FALLBACK_READ_PATHS
}

function getAllowedWritePaths(): string[] {
  if (isCacheLoaded()) {
    const fromCache = getCachedArray('tool.allowed_write_paths')
    if (fromCache.length > 0) return fromCache
  }
  return process.env.TOOL_ALLOWED_WRITE_PATHS
    ? process.env.TOOL_ALLOWED_WRITE_PATHS.split(',').map((s) => s.trim()).filter(Boolean)
    : FALLBACK_WRITE_PATHS
}

// === Builtin tools ===================================================

export const BUILTIN_TOOLS: BuiltinTool[] = [
  // === filesystem.read ===
  {
    name: 'filesystem.read',
    description: 'Read the content of a file from the filesystem. Only allowed paths can be read.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
      },
      required: ['path'],
    },
    requiredScopes: ['filesystem:read'],
    async execute(params, ctx) {
      const filePath = resolvePath(params.path as string, ctx)
      if (!isPathAllowed(filePath, ctx.allowedPaths || getAllowedReadPaths())) {
        return { success: false, output: '', error: `Path not allowed: ${filePath}` }
      }
      if (!existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${filePath}` }
      }
      try {
        const content = readFileSync(filePath, 'utf-8')
        // Truncate if too large
        const truncated = content.length > 50000
        return {
          success: true,
          output: truncated ? content.slice(0, 50000) + '\n...[truncated]' : content,
          metadata: { size: content.length, truncated },
        }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },

  // === filesystem.write ===
  {
    name: 'filesystem.write',
    description: 'Write content to a file on the filesystem. Only allowed paths can be written.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write to' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    requiredScopes: ['filesystem:write'],
    async execute(params, ctx) {
      const filePath = resolvePath(params.path as string, ctx)
      if (!isPathAllowed(filePath, ctx.allowedPaths || getAllowedWritePaths())) {
        return { success: false, output: '', error: `Path not allowed: ${filePath}` }
      }
      try {
        const dir = dirname(filePath)
        mkdirSync(dir, { recursive: true })
        writeFileSync(filePath, params.content as string, 'utf-8')
        return {
          success: true,
          output: `File written: ${filePath} (${(params.content as string).length} bytes)`,
          metadata: { path: filePath, size: (params.content as string).length },
        }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },

  // === filesystem.list ===
  {
    name: 'filesystem.list',
    description: 'List files in a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
      },
      required: ['path'],
    },
    requiredScopes: ['filesystem:read'],
    async execute(params, ctx) {
      const dirPath = resolvePath(params.path as string, ctx)
      if (!isPathAllowed(dirPath, ctx.allowedPaths || getAllowedReadPaths())) {
        return { success: false, output: '', error: `Path not allowed: ${dirPath}` }
      }
      try {
        const entries = readdirSync(dirPath)
        const result = entries.map((name: string) => {
          const stat = statSync(join(dirPath, name))
          return { name, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size }
        })
        return { success: true, output: JSON.stringify(result, null, 2) }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },

  // === http.fetch ===
  {
    name: 'http.fetch',
    description: 'Fetch content from an HTTP/HTTPS URL. Returns the response body as text.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL to fetch' },
        method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' },
        body: { type: 'string', description: 'Request body (for POST)' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
    requiredScopes: ['network:get'],
    async execute(params, _ctx) {
      const url = params.url as string
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, output: '', error: 'Only http/https URLs allowed' }
      }
      // C4 — SSRF protection: block localhost, loopback, private, link-local,
      // cloud metadata IPs (169.254.169.254) and IPv6 ULA/link-local.
      const ssrfCheck = await assertSafeUrl(url)
      if (!ssrfCheck.ok) {
        return { success: false, output: '', error: ssrfCheck.reason }
      }
      try {
        const response = await fetch(url, {
          method: (params.method as string) || 'GET',
          headers: params.headers as Record<string, string>,
          body: params.body as string,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        })
        const text = await response.text()
        const truncated = text.length > 50000
        return {
          success: response.ok,
          output: truncated ? text.slice(0, 50000) + '\n...[truncated]' : text,
          metadata: { status: response.status, size: text.length, truncated },
          error: response.ok ? undefined : `HTTP ${response.status}`,
        }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },

  // === memory.search ===
  {
    name: 'memory.search',
    description: 'Search the memory fabric (episodic, semantic, procedural, reasoning layers) for relevant memories.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        agentUri: { type: 'string', description: 'Filter by agent URI' },
        topK: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    requiredScopes: ['db:read'],
    async execute(params, _ctx) {
      try {
        const { semanticMemorySearch } = await import('@/lib/memory-fabric/fabric')
        const results = await semanticMemorySearch(
          params.query as string,
          params.agentUri as string | undefined,
          (params.topK as number) || 5,
        )
        return {
          success: true,
          output: JSON.stringify(results, null, 2),
          metadata: { count: results.length },
        }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },

  // === graph.query ===
  {
    name: 'graph.query',
    description: 'Query the Context Graph for nodes by entity type or URI.',
    parameters: {
      type: 'object',
      properties: {
        entityType: { type: 'string', description: 'Entity type to filter (Agent, Task, Skill, etc.)' },
        limit: { type: 'number', default: 10 },
      },
    },
    requiredScopes: ['db:read'],
    async execute(params, _ctx) {
      try {
        const { queryNodes } = await import('@/lib/graph-age')
        const nodes = await queryNodes({
          entityType: params.entityType as string | undefined,
          limit: (params.limit as number) || 10,
        })
        return {
          success: true,
          output: JSON.stringify(nodes, null, 2),
          metadata: { count: nodes.length },
        }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },

  // === web.search (uses ZAI web search if available) ===
  {
    name: 'web.search',
    description: 'Search the web for information. Returns search results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    requiredScopes: ['network:get'],
    async execute(params, _ctx) {
      try {
        const ZAI = (await import('z-ai-web-dev-sdk')).default
        const zai = await ZAI.create()
        // Use type assertion — web_search may not be in the type definitions
        // but is available at runtime
        const results = await (zai.functions as any).web_search(params.query as string, {
          count: (params.maxResults as number) || 5,
        })
        return {
          success: true,
          output: JSON.stringify(results, null, 2),
          metadata: { query: params.query },
        }
      } catch (err: any) {
        return { success: false, output: '', error: err.message }
      }
    },
  },
]

// === Helpers =========================================================

function resolvePath(p: string, ctx: ToolExecutionContext): string {
  if (isAbsolute(p)) return resolve(p)
  // Relative paths resolved against cwd
  return resolve(process.cwd(), p)
}

function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  // B1 — Path-separator-aware comparison (non string prefix match).
  // PRIMA: `filePath.startsWith(resolved)` → '/tmp/foo' consentiva '/tmp/foobar'
  // ORA:   `filePath === resolved || filePath.startsWith(resolved + sep)`
  //        assicura che solo path dentro la directory consentita siano ammessi.
  for (const allowed of allowedPaths) {
    const resolved = resolve(allowed)
    if (filePath === resolved) return true
    if (filePath.startsWith(resolved + sep)) return true
  }
  return false
}

// === SSRF Protection (C4) ============================================

/**
 * Verifica che un URL non punti a host privati/loopback/metadata.
 * Blocca:
 *   - hostname string: 'localhost', '*.localhost', '*.local'
 *   - IPv4 loopback: 127.0.0.0/8
 *   - IPv4 private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - IPv4 link-local: 169.254.0.0/16 (include AWS/GCP metadata 169.254.169.254)
 *   - IPv4 unspecified: 0.0.0.0/8
 *   - IPv6 loopback: ::1
 *   - IPv6 unspecified: ::
 *   - IPv6 ULA: fc00::/7 (unique local addresses)
 *   - IPv6 link-local: fe80::/10
 *
 * Risolve il hostname via DNS per verificare l'IP effettivo (TOCTOU: la risoluzione
 * avviene prima della fetch; in caso di DNS rebinding la fetch potrebbe comunque
 * raggiungere un IP diverso. Mitigazione completa richiede custom DNS resolver
 * + IP pinning, fuori scope per ora).
 */
async function assertSafeUrl(urlStr: string): Promise<{ ok: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return { ok: false, reason: `Invalid URL: ${urlStr}` }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets

  // 1. String-based hostname checks
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: `SSRF blocked: localhost not allowed (${hostname})` }
  }
  if (hostname.endsWith('.local')) {
    return { ok: false, reason: `SSRF blocked: .local hostnames not allowed (${hostname})` }
  }
  if (hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]') {
    return { ok: false, reason: `SSRF blocked: unspecified address (${hostname})` }
  }

  // 2. If hostname is already an IP literal, check it directly
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      return { ok: false, reason: `SSRF blocked: private/loopback IP (${hostname})` }
    }
    return { ok: true }
  }

  // 3. DNS lookup — resolve hostname and check ALL resolved IPs
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true })
  } catch (err: any) {
    // DNS resolution failed; let fetch handle the error
    return { ok: true }
  }

  if (addresses.length === 0) {
    return { ok: true }
  }

  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      return { ok: false, reason: `SSRF blocked: ${hostname} resolves to private IP ${address}` }
    }
  }

  return { ok: true }
}

/**
 * Verifica se un IP (IPv4 o IPv6) è privato/loopback/link-local.
 */
function isPrivateIP(ip: string): boolean {
  // IPv4
  if (isIP(ip) === 4) {
    if (/^127\./.test(ip)) return true // loopback
    if (/^10\./.test(ip)) return true // private
    if (/^192\.168\./.test(ip)) return true // private
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true // private
    if (/^169\.254\./.test(ip)) return true // link-local + cloud metadata
    if (/^0\./.test(ip)) return true // unspecified
    if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip)) return true // CGNAT
    if (/^192\.0\.[01]\./.test(ip)) return true // IETF protocol assignments
    if (/^198\.(1[89])\./.test(ip)) return true // benchmarking
    return false
  }

  // IPv6
  if (isIP(ip) === 6) {
    if (ip === '::1') return true // loopback
    if (ip === '::') return true // unspecified
    if (/^fe[89ab]/i.test(ip)) return true // link-local fe80::/10
    if (/^f[cd]/i.test(ip)) return true // ULA fc00::/7
    if (/^64:ff9b:/i.test(ip)) return true // NAT64
    if (/^100::/i.test(ip)) return true // discard prefix
    // IPv4-mapped IPv6: ::ffff:a.b.c.d
    const v4mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
    if (v4mapped && isPrivateIP(v4mapped[1])) return true
    return false
  }

  return false
}

// === Registry ========================================================

const toolMap = new Map<string, BuiltinTool>()
for (const tool of BUILTIN_TOOLS) {
  toolMap.set(tool.name, tool)
}

export function getBuiltinTool(name: string): BuiltinTool | undefined {
  return toolMap.get(name)
}

export function listBuiltinTools(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return BUILTIN_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}
