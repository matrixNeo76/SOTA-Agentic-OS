#!/usr/bin/env node
/**
 * MCP stdio Bridge — C5
 *
 * Bridge che permette di usare SOTA Agentic OS MCP server via stdio,
 * per configurazioni locali di Claude Code/Desktop/Cursor.
 *
 * Il bridge legge JSON-RPC da stdin, lo forwarda al server HTTP,
 * e scrive la risposta su stdout. Mantiene una sessione MCP.
 *
 * Configurazione in Claude Code (~/.claude/mcp_servers.json):
 * {
 *   "mcpServers": {
 *     "sota-os": {
 *       "command": "node",
 *       "args": ["/path/to/SOTA-Agentic-OS/scripts/mcp-stdio.ts"],
 *       "env": {
 *         "SOTA_MCP_URL": "http://localhost:3000/api/mcp",
 *         "SOTA_API_KEY": "sak_<keyId>_<secret>"
 *       }
 *     }
 *   }
 * }
 *
 * Oppure con bun:
 *   "command": "bun",
 *   "args": ["run", "/path/to/scripts/mcp-stdio.ts"],
 *
 * Usage:
 *   SOTA_MCP_URL=http://localhost:3000/api/mcp \
 *   SOTA_API_KEY=sak_... \
 *   node scripts/mcp-stdio.ts
 */

const SOTA_URL = process.env.SOTA_MCP_URL || 'http://localhost:3000/api/mcp'
const SOTA_KEY = process.env.SOTA_API_KEY || ''

let sessionId: string | null = null

// Read line by line from stdin
const readline = require('readline')
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

rl.on('line', async (line: string) => {
  line = line.trim()
  if (!line) return

  try {
    // Parse JSON-RPC request
    const request = JSON.parse(line)

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (SOTA_KEY) headers['Authorization'] = `Bearer ${SOTA_KEY}`
    if (sessionId) headers['Mcp-Session-Id'] = sessionId

    // Forward to HTTP server
    const response = await fetch(SOTA_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })

    // Capture session ID from initialize response
    const newSessionId = response.headers.get('mcp-session-id')
    if (newSessionId) {
      sessionId = newSessionId
    }

    // Parse and forward response
    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('text/event-stream')) {
      // SSE response — parse events and forward as JSON
      const text = await response.text()
      const lines = text.split('\n')
      for (const l of lines) {
        if (l.startsWith('data: ')) {
          const data = l.slice(6)
          try {
            const parsed = JSON.parse(data)
            process.stdout.write(JSON.stringify(parsed) + '\n')
          } catch {}
        }
      }
    } else {
      // Plain JSON response
      const data = await response.json()
      process.stdout.write(JSON.stringify(data) + '\n')
    }
  } catch (err: any) {
    // Send JSON-RPC error response
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: err.message || 'Internal error in stdio bridge',
      },
    }
    process.stdout.write(JSON.stringify(errorResponse) + '\n')
  }
})

rl.on('close', () => {
  // End session if active
  if (sessionId) {
    fetch(SOTA_URL, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SOTA_KEY}`,
        'Mcp-Session-Id': sessionId,
      },
    }).catch(() => {})
  }
  process.exit(0)
})

// Log to stderr (stdout is for JSON-RPC only)
console.error(`[mcp-stdio] Bridge started: ${SOTA_URL}`)
console.error(`[mcp-stdio] Auth: ${SOTA_KEY ? 'API key configured' : 'no API key (will use session cookie if available)'}`)
console.error(`[mcp-stdio] Waiting for JSON-RPC on stdin...`)
