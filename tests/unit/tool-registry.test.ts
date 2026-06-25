import { describe, it, expect } from 'vitest'
import { BUILTIN_TOOLS } from '@/lib/kernel/tool-registry'

describe('Tool Registry', () => {
  it('BUILTIN_TOOLS ha almeno 3 tool', () => {
    expect(BUILTIN_TOOLS.length).toBeGreaterThanOrEqual(3)
  })

  it('ogni builtin tool ha toolId, name, version', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.toolId).toBeTruthy()
      expect(tool.name).toBeTruthy()
      expect(tool.version).toBeTruthy()
    }
  })

  it('builtin tool IDs sono univoci', () => {
    const ids = BUILTIN_TOOLS.map(t => t.toolId)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})
