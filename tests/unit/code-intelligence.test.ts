/**
 * Tests for Code Intelligence Layer (Fase 2.4)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  parseFile, parseTypeScript, parsePython, syncToGraph, analyzeGitDiff,
  detectLanguage, codeAnalysisProvenance,
} from '@/lib/code-intelligence/parser'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const TS_SAMPLE = `import { foo } from './foo'
import { bar, baz } from 'lodash'

export function add(a: number, b: number): number {
  return a + b
}

export function double(x: number): number {
  return multiply(x, 2)
}

async function fetchData(url: string): Promise<Response> {
  return fetch(url)
}

export class Calculator {
  private result: number = 0

  add(x: number): number {
    this.result = add(this.result, x)
    return this.result
  }

  reset(): void {
    this.result = 0
  }
}

const multiply = (a: number, b: number) => a * b
`

const PY_SAMPLE = `import os
from typing import List

def greet(name: str) -> str:
    return f"Hello, {name}"

async def fetch_data(url: str):
    return await httpx.get(url)

class Calculator:
    def add(self, x, y):
        return x + y

    def reset(self):
        self.result = 0
`

describe('Code Intelligence — detectLanguage', () => {
  it('riconosce .ts/.tsx come typescript', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript')
    expect(detectLanguage('bar.tsx')).toBe('typescript')
  })

  it('riconosce .js/.jsx come javascript', () => {
    expect(detectLanguage('foo.js')).toBe('javascript')
    expect(detectLanguage('bar.jsx')).toBe('javascript')
  })

  it('riconosce .py come python', () => {
    expect(detectLanguage('foo.py')).toBe('python')
  })

  it('ritorna null per estensioni non supportate', () => {
    expect(detectLanguage('foo.txt')).toBeNull()
    expect(detectLanguage('foo.md')).toBeNull()
    expect(detectLanguage('foo')).toBeNull()
  })
})

describe('Code Intelligence — parseTypeScript', () => {
  it('estrae function declarations', () => {
    const ast = parseTypeScript('test.ts', TS_SAMPLE)
    const names = ast.functions.map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['add', 'fetchData', 'multiply']))
  })

  it('rileva exported functions', () => {
    const ast = parseTypeScript('test.ts', TS_SAMPLE)
    const add = ast.functions.find((f) => f.name === 'add')
    expect(add!.exported).toBe(true)
    const fetchData = ast.functions.find((f) => f.name === 'fetchData')
    expect(fetchData!.exported).toBe(false)
    expect(fetchData!.async).toBe(true)
  })

  it('estrae params e returnType', () => {
    const ast = parseTypeScript('test.ts', TS_SAMPLE)
    const add = ast.functions.find((f) => f.name === 'add')
    expect(add!.params).toEqual(['a: number', 'b: number'])
    expect(add!.returnType).toBe('number')
  })

  it('estrae class declarations con methods', () => {
    const ast = parseTypeScript('test.ts', TS_SAMPLE)
    expect(ast.classes.length).toBeGreaterThan(0)
    const calc = ast.classes.find((c) => c.name === 'Calculator')
    expect(calc).toBeDefined()
    expect(calc!.methods).toEqual(expect.arrayContaining(['add', 'reset']))
  })

  it('estrae imports (locali + module)', () => {
    const ast = parseTypeScript('test.ts', TS_SAMPLE)
    expect(ast.imports.length).toBeGreaterThanOrEqual(2)
    const local = ast.imports.find((i) => i.source === './foo')
    expect(local).toBeDefined()
    expect(local!.isLocal).toBe(true)
    expect(local!.imports).toEqual(['foo'])

    const lodash = ast.imports.find((i) => i.source === 'lodash')
    expect(lodash).toBeDefined()
    expect(lodash!.isLocal).toBe(false)
  })

  it('estrae call edges tra function', () => {
    const ast = parseTypeScript('test.ts', TS_SAMPLE)
    // double chiama multiply
    const callsToMultiply = ast.calls.filter((c) => c.callee === 'multiply')
    expect(callsToMultiply.length).toBeGreaterThan(0)
    expect(callsToMultiply.some((c) => c.resolved)).toBe(true)
  })
})

describe('Code Intelligence — parsePython', () => {
  it('estrae def functions', () => {
    const ast = parsePython('test.py', PY_SAMPLE)
    const names = ast.functions.map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['greet', 'fetch_data']))
  })

  it('rileva async def', () => {
    const ast = parsePython('test.py', PY_SAMPLE)
    const fetchData = ast.functions.find((f) => f.name === 'fetch_data')
    expect(fetchData!.async).toBe(true)
  })

  it('estrae class con methods', () => {
    const ast = parsePython('test.py', PY_SAMPLE)
    const calc = ast.classes.find((c) => c.name === 'Calculator')
    expect(calc).toBeDefined()
    expect(calc!.methods).toEqual(expect.arrayContaining(['add', 'reset']))
  })

  it('estrae imports (from X import Y + plain import)', () => {
    const ast = parsePython('test.py', PY_SAMPLE)
    expect(ast.imports.length).toBeGreaterThanOrEqual(2)
    const osImport = ast.imports.find((i) => i.source === 'os')
    expect(osImport).toBeDefined()
  })
})

describe('Code Intelligence — parseFile dispatcher', () => {
  it('dispatcha al parser corretto in base all\'estensione', () => {
    const ts = parseFile('test.ts', TS_SAMPLE)
    expect(ts!.language).toBe('typescript')
    const py = parseFile('test.py', PY_SAMPLE)
    expect(py!.language).toBe('python')
  })

  it('ritorna null per file non supportato', () => {
    expect(parseFile('test.txt', 'content')).toBeNull()
  })
})

describe('Code Intelligence — syncToGraph', () => {
  beforeAll(async () => {
    await db.graphEdge.deleteMany({})
    await db.graphNode.deleteMany({})
    _resetEventMeshForTests()
  })

  it('crea nodi Document per File e Functions', async () => {
    const ast = parseTypeScript('src/calc.ts', TS_SAMPLE)
    const delta = await syncToGraph(ast, codeAnalysisProvenance(), 'test-repo')

    expect(delta.graphNodesCreated).toBeGreaterThan(0)
    expect(delta.newFunctions).toBe(ast.functions.length)

    // Verifica nodi nel grafo
    const docs = await db.graphNode.findMany({
      where: { entityType: 'Document', attributes: { contains: 'calc.ts' } },
    })
    expect(docs.length).toBeGreaterThan(0)
  })

  it('crea edges CALLS tra function nodes', async () => {
    const ast = parseTypeScript('src/calc2.ts', TS_SAMPLE)
    await syncToGraph(ast, codeAnalysisProvenance(), 'test-repo')

    const callEdges = await db.graphEdge.findMany({
      where: { relationType: 'CALLS' },
    })
    expect(callEdges.length).toBeGreaterThan(0)
  })
})

describe('Code Intelligence — analyzeGitDiff', () => {
  it('analizza un diff con file added/modified/deleted', async () => {
    const result = await analyzeGitDiff({
      repo: 'test-repo',
      commitSha: 'abc123',
      files: [
        { path: 'src/new.ts', status: 'A', content: TS_SAMPLE },
        { path: 'src/mod.ts', status: 'M', content: TS_SAMPLE },
        { path: 'src/old.ts', status: 'D' },
      ],
      provenance: codeAnalysisProvenance(),
    })

    expect(result.filesAdded).toEqual(['src/new.ts'])
    expect(result.filesModified).toEqual(['src/mod.ts'])
    expect(result.filesDeleted).toEqual(['src/old.ts'])
    expect(result.functionsAdded).toBeGreaterThan(0)
    expect(result.graphDeltas.length).toBe(2) // A e M, D non ha content
  })

  it('salta file non supportati', async () => {
    const result = await analyzeGitDiff({
      repo: 'test-repo',
      commitSha: 'def',
      files: [
        { path: 'README.md', status: 'A', content: '# readme' },
        { path: 'script.sh', status: 'A', content: '#!/bin/bash' },
      ],
      provenance: codeAnalysisProvenance(),
    })

    expect(result.filesAdded).toEqual([])
    expect(result.functionsAdded).toBe(0)
  })
})
