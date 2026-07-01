/**
 * Code Intelligence Layer — Fase 2.4
 *
 * Strategia: parser AST semplificato (regex-based) per TypeScript/JavaScript/Python.
 * Tree-sitter richiede build native che falliscono in ambienti constrained,
 * quindi implementiamo un parser robusto che gestisce i costrutti comuni:
 *   - function/method declarations
 *   - import/export
 *   - class declarations
 *   - call expressions
 *   - dependency references
 *
 * Output:
 *   - AST semplificato (Function[], Class[], Import[], Call[])
 *   - Call Graph (who calls whom)
 *   - Dependency Graph (file → imported files)
 *
 * Entrambi i grafi sono scritti nel Context Graph (Fase 1.2) come nodi
 * e relazioni: (:Function)-[:CALLS]->(:Function), (:File)-[:IMPORTS]->(:File).
 *
 * Integrazione Git (Fase 2.4 — Incremental Git Sync):
 *   - Webhook GitHub → diff analyzer → update incrementale del grafo
 *   - Relazioni: (:Commit)-[:MUTATED]->(:Function), (:Issue)-[:RESOLVED_BY]->(:Commit)
 */

import { createNode, createEdge } from '@/lib/graph-age'
import { createProvenance, type Provenance } from '@/lib/governance'
import { publishCodeChanged } from '@/lib/event-mesh/publishers'

// === Tipi ============================================================

export interface FunctionNode {
  name: string
  qualifiedName: string // include namespace/class
  signature: string
  params: string[]
  returnType?: string
  startLine: number
  endLine: number
  exported: boolean
  async: boolean
}

export interface ClassNode {
  name: string
  qualifiedName: string
  methods: string[]
  properties: string[]
  startLine: number
  endLine: number
  exported: boolean
}

export interface ImportNode {
  source: string // path o module name
  imports: string[] // named imports
  defaultImport?: string
  namespaceImport?: string
  isLocal: boolean // true se path relativo
  line: number
}

export interface CallEdge {
  caller: string // qualifiedName
  callee: string // name (potrebbe non essere risolto a qualifiedName)
  line: number
  resolved: boolean // true se callee matcha una Function nel file
}

export interface FileAST {
  filePath: string
  language: 'typescript' | 'javascript' | 'python'
  functions: FunctionNode[]
  classes: ClassNode[]
  imports: ImportNode[]
  calls: CallEdge[]
  lines: number
  parsedAt: string
}

export interface CodeGraphDelta {
  file: FileAST
  newFunctions: number
  newClasses: number
  newEdges: number
  graphNodesCreated: number
  graphEdgesCreated: number
}

// === Language detection ==============================================

export function detectLanguage(filePath: string): 'typescript' | 'javascript' | 'python' | null {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript'
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript'
  if (filePath.endsWith('.py')) return 'python'
  return null
}

// === TypeScript/JavaScript parser ====================================

const TS_FUNCTION_DECL = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+?))?\s*\{/g
const TS_ARROW_FUNCTION = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+?)?\s*=>\s*/g
const TS_CLASS_DECL = /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+?))?\s*\{/g
const TS_METHOD_DECL = /(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+?))?\s*\{/g
const TS_IMPORT = /import\s+(?:(\w+)|(\*\s+as\s+\w+)|\{([^}]+)\})\s*(?:,\s*(?:(\w+)|\{([^}]+)\}))?\s*from\s+['"]([^'"]+)['"]/g
const TS_CALL = /(\w+)\s*\(/g

export function parseTypeScript(filePath: string, content: string): FileAST {
  const lines = content.split('\n')
  const functions: FunctionNode[] = []
  const classes: ClassNode[] = []
  const imports: ImportNode[] = []
  const calls: CallEdge[] = []

  // === Imports ===
  let match: RegExpExecArray | null
  while ((match = TS_IMPORT.exec(content)) !== null) {
    const defaultImport = match[1] || match[4]
    const namespaceImport = match[2]?.replace(/^\*\s+as\s+/, '')
    const namedImports1 = match[3]?.split(',').map((s) => s.trim()).filter(Boolean) || []
    const namedImports2 = match[5]?.split(',').map((s) => s.trim()).filter(Boolean) || []
    const source = match[6]!
    const line = content.slice(0, match.index).split('\n').length

    imports.push({
      source,
      imports: [...namedImports1, ...namedImports2],
      defaultImport,
      namespaceImport,
      isLocal: source.startsWith('.') || source.startsWith('/'),
      line,
    })
  }

  // === Functions ===
  while ((match = TS_FUNCTION_DECL.exec(content)) !== null) {
    const name = match[1]!
    const params = match[2]!.split(',').map((p) => p.trim()).filter(Boolean)
    const returnType = match[3]?.trim()
    const startLine = content.slice(0, match.index).split('\n').length
    const exported = /export\s/.test(match[0])
    const async = /async\s/.test(match[0])
    const endLine = findBlockEnd(lines, startLine - 1)

    functions.push({
      name,
      qualifiedName: name,
      signature: match[0].trim(),
      params,
      returnType,
      startLine,
      endLine,
      exported,
      async,
    })
  }

  // === Arrow functions ===
  while ((match = TS_ARROW_FUNCTION.exec(content)) !== null) {
    const name = match[1]!
    const params = match[2]!.split(',').map((p) => p.trim()).filter(Boolean)
    const startLine = content.slice(0, match.index).split('\n').length
    const exported = /export\s/.test(match[0])
    const async = /async\s/.test(match[0])

    functions.push({
      name,
      qualifiedName: name,
      signature: match[0].trim(),
      params,
      startLine,
      endLine: startLine, // arrow functions sono spesso one-liner
      exported,
      async,
    })
  }

  // === Classes + methods ===
  while ((match = TS_CLASS_DECL.exec(content)) !== null) {
    const className = match[1]!
    const startLine = content.slice(0, match.index).split('\n').length
    const endLine = findBlockEnd(lines, startLine - 1)
    const exported = /export\s/.test(match[0])

    // Estrai metodi all'interno della classe (range di righe)
    const classBlock = lines.slice(startLine - 1, endLine).join('\n')
    const methods: string[] = []
    const properties: string[] = []
    let m: RegExpExecArray | null
    const methodRegex = /(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+?)?\s*\{/g
    while ((m = methodRegex.exec(classBlock)) !== null) {
      const methodName = m[1]!
      if (['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(methodName)) {
        if (methodName === 'constructor') methods.push(methodName)
        continue
      }
      methods.push(methodName)
    }
    const propRegex = /(?:public|private|protected|static|readonly|\s)+(\w+)\s*(?::\s*[^=;]+?)?\s*[=;]/g
    while ((m = propRegex.exec(classBlock)) !== null) {
      properties.push(m[1]!)
    }

    classes.push({
      name: className,
      qualifiedName: className,
      methods: [...new Set(methods)],
      properties: [...new Set(properties)],
      startLine,
      endLine,
      exported,
    })
  }

  // === Call edges (per ogni function) ===
  const allFunctionNames = new Set(functions.map((f) => f.name))
  for (const fn of functions) {
    const body = lines.slice(fn.startLine - 1, fn.endLine).join('\n')
    let c: RegExpExecArray | null
    const callRegex = /(\w+)\s*\(/g
    while ((c = callRegex.exec(body)) !== null) {
      const callee = c[1]!
      // Skip keywords
      if (['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'class', 'new', 'typeof', 'await', 'async'].includes(callee)) continue
      // Skip if it's the function name itself (recursive call is OK though)
      const resolved = allFunctionNames.has(callee)
      const line = fn.startLine + body.slice(0, c.index).split('\n').length - 1
      calls.push({
        caller: fn.qualifiedName,
        callee,
        line,
        resolved,
      })
    }
  }

  return {
    filePath,
    language: filePath.endsWith('.tsx') || filePath.endsWith('.ts') ? 'typescript' : 'javascript',
    functions,
    classes,
    imports,
    calls,
    lines: lines.length,
    parsedAt: new Date().toISOString(),
  }
}

// === Python parser ===================================================

const PY_FUNCTION = /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+?))?\s*:/g
const PY_CLASS = /class\s+(\w+)\s*(?:\(([^)]+)\))?\s*:/g
const PY_IMPORT = /from\s+(\S+)\s+import\s+(.+)|import\s+(\S+)/g

export function parsePython(filePath: string, content: string): FileAST {
  const lines = content.split('\n')
  const functions: FunctionNode[] = []
  const classes: ClassNode[] = []
  const imports: ImportNode[] = []
  const calls: CallEdge[] = []

  let match: RegExpExecArray | null

  // Imports
  while ((match = PY_IMPORT.exec(content)) !== null) {
    const source = match[1] || match[3]
    if (!source) continue
    const importList = match[2]?.split(',').map((s) => s.trim()).filter(Boolean) || []
    const line = content.slice(0, match.index).split('\n').length

    imports.push({
      source,
      imports: importList,
      isLocal: source.startsWith('.'),
      line,
    })
  }

  // Functions
  while ((match = PY_FUNCTION.exec(content)) !== null) {
    const name = match[1]!
    const params = match[2]!.split(',').map((p) => p.trim()).filter(Boolean)
    const returnType = match[3]?.trim()
    const startLine = content.slice(0, match.index).split('\n').length
    const endLine = findPythonBlockEnd(lines, startLine - 1)
    const async = /async\s/.test(match[0])

    functions.push({
      name,
      qualifiedName: name,
      signature: match[0].trim(),
      params,
      returnType,
      startLine,
      endLine,
      exported: false, // Python non ha export espliciti
      async,
    })
  }

  // Classes
  while ((match = PY_CLASS.exec(content)) !== null) {
    const className = match[1]!
    const startLine = content.slice(0, match.index).split('\n').length
    const endLine = findPythonBlockEnd(lines, startLine - 1)

    // Trova metodi (def all'interno del blocco indentato)
    const classBlock = lines.slice(startLine, endLine).join('\n')
    const methods: string[] = []
    let m: RegExpExecArray | null
    const methodRegex = /def\s+(\w+)\s*\(/g
    while ((m = methodRegex.exec(classBlock)) !== null) {
      methods.push(m[1]!)
    }

    classes.push({
      name: className,
      qualifiedName: className,
      methods: [...new Set(methods)],
      properties: [],
      startLine,
      endLine,
      exported: false,
    })
  }

  // Calls
  const allFunctionNames = new Set(functions.map((f) => f.name))
  for (const fn of functions) {
    const body = lines.slice(fn.startLine - 1, fn.endLine).join('\n')
    let c: RegExpExecArray | null
    const callRegex = /(\w+)\s*\(/g
    while ((c = callRegex.exec(body)) !== null) {
      const callee = c[1]!
      if (['if', 'for', 'while', 'def', 'class', 'return', 'print', 'assert'].includes(callee)) continue
      const resolved = allFunctionNames.has(callee)
      const line = fn.startLine + body.slice(0, c.index).split('\n').length - 1
      calls.push({ caller: fn.qualifiedName, callee, line, resolved })
    }
  }

  return {
    filePath,
    language: 'python',
    functions,
    classes,
    imports,
    calls,
    lines: lines.length,
    parsedAt: new Date().toISOString(),
  }
}

// === Parser dispatcher ===============================================

export function parseFile(filePath: string, content: string): FileAST | null {
  const lang = detectLanguage(filePath)
  if (!lang) return null
  if (lang === 'python') return parsePython(filePath, content)
  return parseTypeScript(filePath, content)
}

// === Helpers per block-end detection =================================

function findBlockEnd(lines: string[], startLine: number): number {
  // Per TS/JS: trova la riga con `}` allo stesso livello di indentazione
  let depth = 0
  let started = false
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!
    for (const ch of line) {
      if (ch === '{') { depth++; started = true }
      if (ch === '}') { depth-- }
    }
    if (started && depth === 0) return i + 1
  }
  return lines.length
}

function findPythonBlockEnd(lines: string[], startLine: number): number {
  // Per Python: trova la prima riga con indentazione <= quella del def/class
  const defIndent = lines[startLine]?.match(/^(\s*)/)?.[1].length || 0
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const indent = line.match(/^(\s*)/)?.[1].length || 0
    if (indent <= defIndent && line.trim().length > 0) return i
  }
  return lines.length
}

// === Graph sync (Fase 2.4 incremental) ===============================

/**
 * Sincronizza il FileAST con il Context Graph.
 * Crea nodi per ogni function/class e edge per calls/imports.
 *
 * Idempotente: se i nodi esistono già, li aggiorna.
 */
export async function syncToGraph(
  ast: FileAST,
  provenance: Provenance,
  repo: string = 'local',
): Promise<CodeGraphDelta> {
  let graphNodesCreated = 0
  let graphEdgesCreated = 0
  const newFunctions = ast.functions.length
  const newClasses = ast.classes.length

  // File node
  const fileUri = `document://${repo}/${ast.filePath}`
  try {
    await createNode({
      type: 'Document',
      identifier: `${repo}/${ast.filePath}`,
      attributes: {
        title: ast.filePath,
        source: 'code-analysis',
        mimeType: `text/x-${ast.language}`,
        language: ast.language,
        repo,
        lines: ast.lines,
      },
      provenance,
    })
    graphNodesCreated++
  } catch {}

  // Function nodes + call edges
  // Nota: usiamo tipo Document con identifier `${repo}/${filePath}:${name}` → URI `document://...`
  const functionUris = new Map<string, string>()
  for (const fn of ast.functions) {
    const fnUri = `document://${repo}/${ast.filePath}:${fn.qualifiedName}`
    functionUris.set(fn.qualifiedName, fnUri)
    try {
      await createNode({
        type: 'Document',
        identifier: `${repo}/${ast.filePath}:${fn.qualifiedName}`,
        attributes: {
          title: fn.qualifiedName,
          source: 'code-analysis',
          mimeType: 'text/x-function',
          language: ast.language,
          qualifiedName: fn.qualifiedName,
          params: fn.params,
          returnType: fn.returnType,
          startLine: fn.startLine,
          endLine: fn.endLine,
          exported: fn.exported,
          async: fn.async,
          filePath: ast.filePath,
        },
        provenance,
      })
      graphNodesCreated++
    } catch {}

    // File CONTAINS Function
    try {
      await createEdge({
        fromUri: fileUri,
        toUri: fnUri,
        relationType: 'CONTAINS',
        createdByAgent: provenance.createdByAgent,
      })
      graphEdgesCreated++
    } catch {}
  }

  // Call edges: Function -[CALLS]-> Function
  for (const call of ast.calls) {
    if (!call.resolved) continue // salta chiamate non risolte
    const fromUri = functionUris.get(call.caller)
    const toUri = functionUris.get(call.callee)
    if (!fromUri || !toUri) continue
    try {
      await createEdge({
        fromUri,
        toUri,
        relationType: 'CALLS',
        createdByAgent: provenance.createdByAgent,
        properties: { line: call.line },
      })
      graphEdgesCreated++
    } catch {}
  }

  // Import edges: File -[IMPORTS]-> File
  for (const imp of ast.imports) {
    if (!imp.isLocal) continue // solo import relativi
    const targetUri = `document://${repo}/${resolveImportPath(ast.filePath, imp.source)}`
    try {
      await createEdge({
        fromUri: fileUri,
        toUri: targetUri,
        relationType: 'IMPORTS',
        createdByAgent: provenance.createdByAgent,
        properties: { imports: imp.imports, line: imp.line },
      })
      graphEdgesCreated++
    } catch {}
  }

  return {
    file: ast,
    newFunctions,
    newClasses,
    newEdges: ast.calls.filter((c) => c.resolved).length + ast.imports.filter((i) => i.isLocal).length,
    graphNodesCreated,
    graphEdgesCreated,
  }
}

function resolveImportPath(importerPath: string, importSource: string): string {
  // Risolve path relativi rispetto al file importatore
  const dir = importerPath.split('/').slice(0, -1).join('/')
  const resolved = importSource.replace(/^\.\//, '')
  if (resolved.startsWith('../')) {
    const up = (resolved.match(/\.\.\//g) || []).length
    const dirParts = dir.split('/')
    return [...dirParts.slice(0, -up || undefined), resolved.replace(/\.\.\//g, '')].join('/')
  }
  return dir ? `${dir}/${resolved}` : resolved
}

// === Git diff analyzer (Fase 2.4 incremental sync) ===================

export interface GitDiffAnalysis {
  repo: string
  commitSha: string
  filesAdded: string[]
  filesModified: string[]
  filesDeleted: string[]
  functionsAdded: number
  functionsModified: number
  functionsDeleted: number
  graphDeltas: CodeGraphDelta[]
}

/**
 * Analizza un git diff e aggiorna il grafo incrementalmente.
 *
 * Input: output di `git diff <old>..<new> --name-status` + contenuti file.
 */
export async function analyzeGitDiff(params: {
  repo: string
  commitSha: string
  files: Array<{ path: string; status: 'A' | 'M' | 'D'; content?: string }>
  provenance: Provenance
}): Promise<GitDiffAnalysis> {
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  const deltas: CodeGraphDelta[] = []
  let functionsAdded = 0
  let functionsModified = 0
  let functionsDeleted = 0

  for (const file of params.files) {
    if (file.status === 'D') {
      deleted.push(file.path)
      // In produzione: mark File node as deleted (lifecycleState)
      continue
    }
    if (!file.content) continue

    const ast = parseFile(file.path, file.content)
    if (!ast) continue

    const delta = await syncToGraph(ast, params.provenance, params.repo)
    deltas.push(delta)

    if (file.status === 'A') {
      added.push(file.path)
      functionsAdded += ast.functions.length
    } else {
      modified.push(file.path)
      functionsModified += ast.functions.length
    }
  }

  // Pubblica evento CodeChanged (Fase 2.1)
  await publishCodeChanged(
    params.repo,
    params.commitSha,
    [...added, ...modified],
    params.provenance,
  )

  return {
    repo: params.repo,
    commitSha: params.commitSha,
    filesAdded: added,
    filesModified: modified,
    filesDeleted: deleted,
    functionsAdded,
    functionsModified,
    functionsDeleted,
    graphDeltas: deltas,
  }
}

// === Provenance helper ===============================================

export function codeAnalysisProvenance(agentUri: string = 'agent://code-intelligence'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'code-analysis',
    confidence: 1.0, // parsing deterministico
  })
}
