import { describe, it, expect } from 'vitest'

/**
 * Test di Fase 4 — MCP Client
 *
 * Testa la logica pura di formazione JSON-RPC, parsing risposte e
 * estrazione suffix connessione. Le funzioni che toccano il DB
 * (registerConnection, handshake, executeExternalTool) richiedono
 * integration test con DB attivo.
 */

// === Helper functions (replichiamo la logica del modulo per testarla isolata) ===

function buildJsonRpcRequest(method: string, params: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: `sota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method,
    params,
  })
}

function parseJsonRpcResponse(text: string): { result?: unknown; error?: { code: number; message: string } } {
  try {
    const data = JSON.parse(text)
    return data
  } catch (e: any) {
    return { error: { code: -32700, message: `Parse error: ${e.message}` } }
  }
}

function extractConnectionSuffix(toolName: string): { ok: boolean; suffix?: string; toolName?: string } {
  const match = toolName.match(/^ext_([a-z0-9]{6})_(.+)$/)
  if (!match) return { ok: false }
  return { ok: true, suffix: match[1], toolName: match[2] }
}

function buildAuthHeaders(authType: string, authToken: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authType === 'bearer' && authToken) {
    headers.Authorization = `Bearer ${authToken}`
  } else if (authType === 'basic' && authToken) {
    headers.Authorization = `Basic ${Buffer.from(authToken).toString('base64')}`
  } else if (authType === 'ecdsa' && authToken) {
    headers['X-Publisher-Id'] = authToken
  }
  return headers
}

function computeAvgLatency(prevAvg: number, prevCount: number, newDuration: number): number {
  return (prevAvg * prevCount + newDuration) / (prevCount + 1)
}

// === Tests ===

describe('MCP Client — JSON-RPC Request building', () => {
  it('genera un JSON-RPC 2.0 request valido per initialize', () => {
    const req = JSON.parse(buildJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'sota-agentic-os', version: '0.10.0' },
    }))
    expect(req.jsonrpc).toBe('2.0')
    expect(req.method).toBe('initialize')
    expect(req.id).toMatch(/^sota-\d+-[a-z0-9]+$/)
    expect(req.params.protocolVersion).toBe('2024-11-05')
  })

  it('genera id univoci per richieste multiple', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const req = JSON.parse(buildJsonRpcRequest('ping', {}))
      ids.add(req.id as string)
    }
    expect(ids.size).toBe(100)
  })

  it('preserva i parametri annidati', () => {
    const req = JSON.parse(buildJsonRpcRequest('tools/call', {
      name: 'sota_health',
      arguments: { foo: { bar: [1, 2, 3] } },
    }))
    expect(req.params.name).toBe('sota_health')
    expect(req.params.arguments.foo.bar).toEqual([1, 2, 3])
  })
})

describe('MCP Client — Response parsing', () => {
  it('parsa risposta con result', () => {
    const text = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    const parsed = parseJsonRpcResponse(text)
    expect(parsed.error).toBeUndefined()
    expect(parsed.result).toEqual({ ok: true })
  })

  it('parsa risposta con error', () => {
    const text = JSON.stringify({
      jsonrpc: '2.0', id: 1,
      error: { code: -32601, message: 'Method not found' },
    })
    const parsed = parseJsonRpcResponse(text)
    expect(parsed.result).toBeUndefined()
    expect(parsed.error?.code).toBe(-32601)
    expect(parsed.error?.message).toBe('Method not found')
  })

  it('restituisce error -32700 per JSON non valido', () => {
    const parsed = parseJsonRpcResponse('not json')
    expect(parsed.error?.code).toBe(-32700)
    expect(parsed.error?.message).toContain('Parse error')
  })
})

describe('MCP Client — External tool name parsing', () => {
  it('estrae suffix e toolName da nome esterno valido', () => {
    const result = extractConnectionSuffix('ext_abc123_fs.read')
    expect(result.ok).toBe(true)
    expect(result.suffix).toBe('abc123')
    expect(result.toolName).toBe('fs.read')
  })

  it('gestisce nomi con punti e underscore multipli', () => {
    const result = extractConnectionSuffix('ext_xyz789_db_query_user')
    expect(result.ok).toBe(true)
    expect(result.toolName).toBe('db_query_user')
  })

  it('restituisce ok=false per nomi non esterni', () => {
    expect(extractConnectionSuffix('sota_health').ok).toBe(false)
    expect(extractConnectionSuffix('plain_name').ok).toBe(false)
    expect(extractConnectionSuffix('').ok).toBe(false)
  })

  it('restituisce ok=false per suffix troppo corto', () => {
    expect(extractConnectionSuffix('ext_abc_tool').ok).toBe(false)
  })

  it('restituisce ok=false per suffix troppo lungo', () => {
    expect(extractConnectionSuffix('ext_abcdefg_tool').ok).toBe(false)
  })
})

describe('MCP Client — Auth headers', () => {
  it('nessun header auth per authType=none', () => {
    const headers = buildAuthHeaders('none', null)
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Publisher-Id']).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('header Bearer per authType=bearer', () => {
    const headers = buildAuthHeaders('bearer', 'mytoken123')
    expect(headers.Authorization).toBe('Bearer mytoken123')
  })

  it('header Basic (base64) per authType=basic', () => {
    const headers = buildAuthHeaders('basic', 'user:pass')
    const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`
    expect(headers.Authorization).toBe(expected)
  })

  it('header X-Publisher-Id per authType=ecdsa', () => {
    const headers = buildAuthHeaders('ecdsa', 'publisher-abc')
    expect(headers['X-Publisher-Id']).toBe('publisher-abc')
    expect(headers.Authorization).toBeUndefined()
  })

  it('nessun header auth se token mancante', () => {
    const headers = buildAuthHeaders('bearer', null)
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('MCP Client — Average latency computation', () => {
  it('prima chiamata: avg = duration', () => {
    expect(computeAvgLatency(0, 0, 100)).toBe(100)
  })

  it('seconda chiamata: media tra 0 e 200 = 100', () => {
    expect(computeAvgLatency(0, 1, 200)).toBe(100)
  })

  it('terza chiamata: media mobile corretta', () => {
    // prev: avg=100, count=2; new=300 → (100*2 + 300) / 3 = 166.67
    const result = computeAvgLatency(100, 2, 300)
    expect(result).toBeCloseTo(166.67, 1)
  })

  it('la media converge al valore stabile dopo molte chiamate', () => {
    let avg = 0
    let count = 0
    for (let i = 0; i < 100; i++) {
      avg = computeAvgLatency(avg, count, 1000)
      count++
    }
    expect(avg).toBeCloseTo(1000, 0)
  })
})
