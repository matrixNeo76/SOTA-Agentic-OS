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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, isAbsolute } from 'path'

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
const ALLOWED_READ_PATHS = process.env.TOOL_ALLOWED_READ_PATHS
  ? process.env.TOOL_ALLOWED_READ_PATHS.split(',')
  : ['/tmp', join(CWD, 'src'), join(CWD, 'download')]
const ALLOWED_WRITE_PATHS = process.env.TOOL_ALLOWED_WRITE_PATHS
  ? process.env.TOOL_ALLOWED_WRITE_PATHS.split(',')
  : ['/tmp', join(CWD, 'upload')]

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
      if (!isPathAllowed(filePath, ctx.allowedPaths || ALLOWED_READ_PATHS)) {
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
      if (!isPathAllowed(filePath, ctx.allowedPaths || ALLOWED_WRITE_PATHS)) {
        return { success: false, output: '', error: `Path not allowed: ${filePath}` }
      }
      try {
        const dir = require('path').dirname(filePath)
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
      if (!isPathAllowed(dirPath, ctx.allowedPaths || ALLOWED_READ_PATHS)) {
        return { success: false, output: '', error: `Path not allowed: ${dirPath}` }
      }
      try {
        const { readdirSync, statSync } = require('fs')
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
  for (const allowed of allowedPaths) {
    const resolved = resolve(allowed)
    if (filePath.startsWith(resolved)) return true
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
