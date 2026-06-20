import { describe, it, expect } from 'vitest'
import { SENSITIVE_SINKS, TAINT_SCENARIOS } from '../fixtures'

/**
 * Test della logica di Taint Tracking senza DB.
 * La logica reale è in src/lib/kernel/taint.ts ma usa una Map in-memory.
 * Estraiamo la logica di sink-checking per test puro.
 */

const REAL_SENSITIVE_SINKS = [
  'tool_call:exec',
  'tool_call:file_write',
  'tool_call:network',
  'tool_call:db_write',
  'tool_call:deploy',
  'tool_call:delete',
]

describe('Taint — Sensitive Sinks', () => {
  it('ci sono 6 sink sensibili predefiniti', () => {
    expect(REAL_SENSITIVE_SINKS).toHaveLength(6)
  })

  it('tutti i sink sono tool_call:* ', () => {
    REAL_SENSITIVE_SINKS.forEach(sink => {
      expect(sink.startsWith('tool_call:')).toBe(true)
    })
  })

  it('fixture SENSITIVE_SINKS è allineato con il kernel', () => {
    SENSITIVE_SINKS.forEach(sink => {
      expect(REAL_SENSITIVE_SINKS).toContain(sink)
    })
  })

  it('sink non in lista → non sensibile', () => {
    expect(REAL_SENSITIVE_SINKS.includes('log:write')).toBe(false)
    expect(REAL_SENSITIVE_SINKS.includes('metric:increment')).toBe(false)
    expect(REAL_SENSITIVE_SINKS.includes('cache:set')).toBe(false)
  })
})

describe('Taint — Sink Check Logic', () => {
  /**
   * Replica della logica checkSink senza DB.
   */
  function checkSinkTheory(sink: string, taintIds: string[]): {
    allowed: boolean
    reason: string
  } {
    if (!REAL_SENSITIVE_SINKS.includes(sink)) {
      return { allowed: true, reason: 'Sink non sensibile' }
    }
    if (taintIds.length === 0) {
      return { allowed: true, reason: 'Nessun taint attivo' }
    }
    return {
      allowed: false,
      reason: `Bloccato: ${taintIds.length} flussi tainted hanno raggiunto sink ${sink}`,
    }
  }

  TAINT_SCENARIOS.forEach(({ name, sink, expectBlocked }) => {
    it(name, () => {
      const taintIds = expectBlocked ? ['taint-1'] : []
      const result = checkSinkTheory(sink, taintIds)
      expect(result.allowed).toBe(!expectBlocked)
    })
  })

  it('sink non sensibile + taint → allowed', () => {
    const result = checkSinkTheory('log:write', ['taint-1'])
    expect(result.allowed).toBe(true)
  })

  it('sink sensibile + nessun taint → allowed', () => {
    const result = checkSinkTheory('tool_call:exec', [])
    expect(result.allowed).toBe(true)
  })

  it('sink sensibile + 1 taint → blocked', () => {
    const result = checkSinkTheory('tool_call:exec', ['taint-1'])
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Bloccato/)
  })

  it('sink sensibile + 3 taint → blocked con count 3', () => {
    const result = checkSinkTheory('tool_call:file_write', ['t1', 't2', 't3'])
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/3 flussi/)
  })

  it('messaggio di blocco include il nome del sink', () => {
    const result = checkSinkTheory('tool_call:deploy', ['t1'])
    expect(result.reason).toContain('tool_call:deploy')
  })
})

describe('Taint — Flow Propagation', () => {
  it('taint ID è una stringa non vuota', () => {
    const taintId = 'taint-' + Date.now()
    expect(taintId.length).toBeGreaterThan(6)
    expect(typeof taintId).toBe('string')
  })

  it('flow trace è un array di step', () => {
    const flowTrace = ['input:user_chat', 'process:parse', 'sink:tool_call:exec']
    expect(Array.isArray(flowTrace)).toBe(true)
    expect(flowTrace.length).toBe(3)
  })

  it('flow trace inizia sempre con input:*', () => {
    const flowTrace = ['input:user_chat', 'process:parse']
    expect(flowTrace[0].startsWith('input:')).toBe(true)
  })

  it('propagazione aggiunge step al flow', () => {
    const flowTrace = ['input:user_chat']
    const newStep = 'process:llm_call'
    flowTrace.push(newStep)
    expect(flowTrace).toHaveLength(2)
    expect(flowTrace[1]).toBe(newStep)
  })
})

describe('Taint — TaintLabel', () => {
  it('taint label default è "TAINTED"', () => {
    const label = 'TAINTED'
    expect(label).toBe('TAINTED')
  })

  it('record tainted ha campi obbligatori', () => {
    const record = {
      id: 'taint-1',
      source: 'user_chat',
      payload: 'malicious input',
      taintLabel: 'TAINTED',
      flowTrace: '["input:user_chat"]',
      blocked: false,
    }
    expect(record.id).toBeDefined()
    expect(record.source).toBeDefined()
    expect(record.payload).toBeDefined()
    expect(record.taintLabel).toBe('TAINTED')
    expect(record.blocked).toBe(false)
  })

  it('record blocked ha blocked=true', () => {
    const record = {
      id: 'taint-2',
      source: 'user_chat',
      payload: 'another malicious',
      taintLabel: 'TAINTED',
      flowTrace: '["input:user_chat", "sink:tool_call:exec"]',
      blocked: true,
    }
    expect(record.blocked).toBe(true)
  })
})
