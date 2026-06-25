/**
 * MCP Client — WS1.4d
 *
 * Permette all'executor di orchestrare tool MCP esterni.
 *
 * Oggi il sistema è solo MCP *server* (espone tool su /api/mcp).
 * Questo modulo aggiunge la capacità di essere MCP *client*:
 * connettersi a server MCP esterni (Claude Desktop, Cursor, ecc.)
 * e invocare i loro tool.
 *
 * Supporta:
 *   - HTTP transport (POST JSON-RPC 2.0)
 *   - Discovery: tools/list, resources/list, prompts/list
 *   - Execution: tools/call
 *   - Caching: tool list cached per 5 minuti
 *
 * Configurazione: MCP_EXTERNAL_SERVERS env var (JSON array di URL)
 *   [{"name":"external1","url":"http://localhost:3002/api/mcp"}]
 */

import { db } from '@/lib/db'

// === Tipi ============================================================

export interface McpServerConfig {
  name: string
  url: string
  apiKey?: string
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverName: string // quale server MCP espone questo tool
}

export interface McpToolCallResult {
  success: boolean
  output: string
  error?: string
}

// === State ===========================================================

const _discoveredTools = new Map<string, McpTool[]>() // serverUrl → tools
const _lastDiscovery = new Map<string, number>() // serverUrl → timestamp
const DISCOVERY_TTL = 5 * 60 * 1000 // 5 minuti

// === Config loading ==================================================

function loadServerConfigs(): McpServerConfig[] {
  const env = process.env.MCP_EXTERNAL_SERVERS
  if (!env) return []

  try {
    return JSON.parse(env) as McpServerConfig[]
  } catch {
    console.warn('[mcp-client] Invalid MCP_EXTERNAL_SERVERS env var')
    return []
  }
}

// === Discovery =======================================================

/**
 * Esegue tools/list su un server MCP esterno.
 * Ritorna la lista dei tool disponibili.
 */
export async function discoverTools(server: McpServerConfig): Promise<McpTool[]> {
  // Check cache
  const cached = _discoveredTools.get(server.url)
  const lastTime = _lastDiscovery.get(server.url) || 0
  if (cached && Date.now() - lastTime < DISCOVERY_TTL) {
    return cached
  }

  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(server.apiKey && { 'Authorization': `Bearer ${server.apiKey}` }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      console.warn(`[mcp-client] Discovery failed for ${server.name}: HTTP ${response.status}`)
      return []
    }

    const data = await response.json()
    const tools: McpTool[] = (data.result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
      serverName: server.name,
    }))

    // Cache
    _discoveredTools.set(server.url, tools)
    _lastDiscovery.set(server.url, Date.now())

    return tools
  } catch (err) {
    console.warn(`[mcp-client] Discovery failed for ${server.name}:`, err)
    return []
  }
}

/**
 * Esegue discovery su tutti i server MCP esterni configurati.
 */
export async function discoverAllExternalTools(): Promise<McpTool[]> {
  const servers = loadServerConfigs()
  const allTools = await Promise.all(servers.map((s) => discoverTools(s)))
  return allTools.flat()
}

// === Execution =======================================================

/**
 * Esegue un tool su un server MCP esterno.
 *
 * @param serverUrl URL del server MCP
 * @param toolName Nome del tool
 * @param args Argomenti del tool
 * @param apiKey API key opzionale
 */
export async function callExternalTool(params: {
  serverUrl: string
  toolName: string
  args: Record<string, unknown>
  apiKey?: string
}): Promise<McpToolCallResult> {
  try {
    const response = await fetch(params.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.apiKey && { 'Authorization': `Bearer ${params.apiKey}` }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: params.toolName,
          arguments: params.args,
        },
      }),
      signal: AbortSignal.timeout(30_000), // 30s timeout per tool execution
    })

    if (!response.ok) {
      return { success: false, output: '', error: `HTTP ${response.status}` }
    }

    const data = await response.json()

    if (data.error) {
      return { success: false, output: '', error: data.error.message }
    }

    // MCP ritorna content array
    const content = data.result?.content || []
    const text = content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')

    return { success: true, output: text }
  } catch (err: any) {
    return { success: false, output: '', error: err.message }
  }
}

// === Integration con tool-dispatcher =================================

/**
 * Cerca un tool tra tutti i server MCP esterni e lo esegue se trovato.
 *
 * Usato dal tool-dispatcher quando un tool non è builtin né registrato localmente.
 */
export async function tryExternalMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult | null> {
  const tools = await discoverAllExternalTools()
  const tool = tools.find((t) => t.name === toolName)

  if (!tool) return null

  const servers = loadServerConfigs()
  const server = servers.find((s) => s.name === tool.serverName)
  if (!server) return null

  return callExternalTool({
    serverUrl: server.url,
    toolName,
    args,
    apiKey: server.apiKey,
  })
}

// === Stats ===========================================================

export async function mcpClientStats() {
  const servers = loadServerConfigs()
  const tools = await discoverAllExternalTools()

  return {
    configuredServers: servers.length,
    serverNames: servers.map((s) => s.name),
    discoveredTools: tools.length,
    toolNames: tools.map((t) => t.name),
  }
}
