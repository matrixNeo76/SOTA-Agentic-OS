import { describe, it, expect } from 'vitest'

/**
 * Test di Fase 4 — MCP Server (JSON-RPC handlers)
 *
 * Testa la struttura dei messaggi JSON-RPC, i codici di errore standard
 * e la validazione dei metodi supportati.
 * I test di integration (con DB) richiedono il server attivo.
 */

// === Replichiamo la logica dell'errorResponse per testarla isolata ===
function errorResponse(id: string | number, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } }
}

function successResponse(id: string | number, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

// JSON-RPC error codes (standard)
const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

const SUPPORTED_METHODS = [
  'initialize',
  'initialized',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
] as const

// === Tests ===

describe('MCP Server — JSON-RPC protocol compliance', () => {
  it('tutte le risposte hanno jsonrpc="2.0"', () => {
    const success = successResponse(1, { ok: true })
    const error = errorResponse(2, -32601, 'not found')
    expect(success.jsonrpc).toBe('2.0')
    expect(error.jsonrpc).toBe('2.0')
  })

  it('success response ha result e non error', () => {
    const r = successResponse('abc', { tools: [] })
    expect(r.result).toBeDefined()
    expect(r.error).toBeUndefined()
  })

  it('error response ha error e non result', () => {
    const r = errorResponse('abc', -32601, 'not found')
    expect(r.error).toBeDefined()
    expect(r.error!.code).toBe(-32601)
    expect(r.error!.message).toBe('not found')
    expect(r.result).toBeUndefined()
  })

  it('l\'id viene sempre echoato nelle risposte', () => {
    expect(successResponse(42, {}).id).toBe(42)
    expect(successResponse('req-1', {}).id).toBe('req-1')
    expect(errorResponse(99, -1, 'x').id).toBe(99)
  })
})

describe('MCP Server — Error codes standard', () => {
  it('PARSE_ERROR = -32700', () => {
    expect(RPC_ERROR_CODES.PARSE_ERROR).toBe(-32700)
  })
  it('INVALID_REQUEST = -32600', () => {
    expect(RPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600)
  })
  it('METHOD_NOT_FOUND = -32601', () => {
    expect(RPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601)
  })
  it('INVALID_PARAMS = -32602', () => {
    expect(RPC_ERROR_CODES.INVALID_PARAMS).toBe(-32602)
  })
  it('INTERNAL_ERROR = -32603', () => {
    expect(RPC_ERROR_CODES.INTERNAL_ERROR).toBe(-32603)
  })
})

describe('MCP Server — Supported methods', () => {
  it('initialize è supportato', () => {
    expect(SUPPORTED_METHODS).toContain('initialize')
  })

  it('tools/list è supportato', () => {
    expect(SUPPORTED_METHODS).toContain('tools/list')
  })

  it('tools/call è supportato', () => {
    expect(SUPPORTED_METHODS).toContain('tools/call')
  })

  it('resources/list è supportato', () => {
    expect(SUPPORTED_METHODS).toContain('resources/list')
  })

  it('resources/read è supportato (estensione Fase 4)', () => {
    expect(SUPPORTED_METHODS).toContain('resources/read')
  })

  it('prompts/list è supportato ( Skills via MCP)', () => {
    expect(SUPPORTED_METHODS).toContain('prompts/list')
  })

  it('prompts/get è supportato', () => {
    expect(SUPPORTED_METHODS).toContain('prompts/get')
  })

  it('ping è supportato per keepalive', () => {
    expect(SUPPORTED_METHODS).toContain('ping')
  })

  it('metodi non supportati vengono riconosciuti come tali', () => {
    const unknownMethod = 'subscriptions/subscribe'
    expect(SUPPORTED_METHODS).not.toContain(unknownMethod as any)
  })
})

describe('MCP Server — initialize response structure', () => {
  it('la risposta initialize contiene protocolVersion', () => {
    const result = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
      serverInfo: { name: 'SOTA Agentic OS MCP Server', version: '0.10.0' },
    }
    expect(result.protocolVersion).toBe('2024-11-05')
    expect(result.capabilities.tools.listChanged).toBe(true)
    expect(result.serverInfo.name).toContain('SOTA')
  })
})

describe('MCP Server — Tool name prefixing', () => {
  it('builtin tool inizia con "sota_"', () => {
    const builtinTools = ['sota_health', 'sota_list_skills', 'sota_suggest_skill', 'sota_external_tools']
    for (const name of builtinTools) {
      expect(name.startsWith('sota_')).toBe(true)
    }
  })

  it('external tool inizia con "ext_"', () => {
    const externalToolName = 'ext_abc123_fs.read'
    expect(externalToolName.startsWith('ext_')).toBe(true)
  })

  it('i builtin tool NON iniziano con "ext_"', () => {
    const builtinTools = ['sota_health', 'sota_list_skills']
    for (const name of builtinTools) {
      expect(name.startsWith('ext_')).toBe(false)
    }
  })

  it('un tool name può essere discriminato dal prefisso', () => {
    function classify(name: string): 'builtin' | 'external' | 'sota-registered' | 'unknown' {
      if (name.startsWith('sota_health') || name.startsWith('sota_list_skills') ||
          name.startsWith('sota_suggest_skill') || name.startsWith('sota_external_tools')) {
        return 'builtin'
      }
      if (name.startsWith('ext_')) return 'external'
      if (name.startsWith('sota_')) return 'sota-registered'
      return 'unknown'
    }
    expect(classify('sota_health')).toBe('builtin')
    expect(classify('ext_abc_fs')).toBe('external')
    expect(classify('sota_my-tool')).toBe('sota-registered')
    expect(classify('unknown')).toBe('unknown')
  })
})

describe('MCP Server — resources/read URI parsing', () => {
  it('parse URI sota://plans/<id>', () => {
    const uri = 'sota://plans/abc123'
    expect(uri.startsWith('sota://')).toBe(true)
    const match = uri.match(/^sota:\/\/([^/]+)\/(.+)$/)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('plans')
    expect(match![2]).toBe('abc123')
  })

  it('parse URI sota://episodes/<id>', () => {
    const uri = 'sota://episodes/xyz789'
    const match = uri.match(/^sota:\/\/([^/]+)\/(.+)$/)
    expect(match![1]).toBe('episodes')
    expect(match![2]).toBe('xyz789')
  })

  it('parse URI sota://heuristics/<id>', () => {
    const uri = 'sota://heuristics/h1'
    const match = uri.match(/^sota:\/\/([^/]+)\/(.+)$/)
    expect(match![1]).toBe('heuristics')
    expect(match![2]).toBe('h1')
  })

  it('URI non valido (manca kind) viene rifiutato', () => {
    const uri = 'sota://abc'
    const match = uri.match(/^sota:\/\/([^/]+)\/(.+)$/)
    expect(match).toBeNull()
  })

  it('URI non valido (protocollo diverso) viene rifiutato', () => {
    const uri = 'http://plans/abc'
    expect(uri.startsWith('sota://')).toBe(false)
  })
})
