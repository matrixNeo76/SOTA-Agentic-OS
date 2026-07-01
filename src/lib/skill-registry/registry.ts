/**
 * Skill Registry — Fase 2.5
 *
 * Catalogo strutturato di skill (solo registro, NO synthesis → Fase 3).
 *
 * Schema skill (allineato a ROADMAP):
 *   name / description / tools / memory / constraints / examples / tests
 *
 * Una skill è un prompt template riutilizzabile con:
 *   - Dichiarazione dei tool richiesti (con permessi)
 *   - Vincoli di esecuzione (LTL, red lines, budget)
 *   - Esempi few-shot
 *   - Test di accettazione (golden paths)
 *
 * Le skill sono entità di prima classe nel Context Graph (tipo 'Skill').
 * Le relazioni:
 *   (:Skill)-[:USES_TOOL]->(:Tool)
 *   (:Agent)-[:USES_SKILL]->(:Skill)
 *   (:Skill)-[:GENERATED_BY]->(:Agent)  [per Fase 3 synthesis]
 *
 * In Fase 2 SOLO catalogo: registrazione, ricerca, versioning.
 * La generazione autonoma arriva in Fase 3 (Skill Synthesis).
 */

import { db } from '@/lib/db'
import { createNode, createEdge, getNode } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'

// === Tipi ============================================================

export interface Skill {
  uri: string
  name: string
  description: string
  version: string
  promptTemplate: string
  tools: string[] // toolId referenziati
  memory: {
    requiredLayers: string[] // es. ['semantic', 'procedural']
    contextBudget: number // token max iniettabili
  }
  constraints: {
    ltlRules?: string[] // ruleId LTL da enforced
    redLines?: string[] // red line descriptions
    tokenBudget?: number
    timeout?: number // ms
  }
  examples: SkillExample[]
  tests: SkillTest[]
  tags: string[]
  lifecycleState: 'draft' | 'active' | 'deprecated' | 'archived'
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface SkillExample {
  input: string
  output: string
  explanation?: string
}

export interface SkillTest {
  name: string
  input: string
  expectedOutput?: string
  expectedContains?: string[]
  assertFn?: string // JS expression string (eval in sandbox)
}

export interface SkillSearchResult {
  uri: string
  name: string
  description: string
  version: string
  score: number
  matchedOn: string[]
}

// === Registry ========================================================

/**
 * Registra una nuova skill nel catalogo.
 *
 * Validazione:
 *   - name, description, promptTemplate obbligatori
 *   - tools devono essere toolId esistenti nel Tool Ecosystem
 *   - tests devono avere almeno un expectedOutput o expectedContains
 *
 * Crea:
 *   - Nodo Skill nel Context Graph
 *   - Edge Skill -[USES_TOOL]-> Tool per ogni tool referenziato
 */
export async function registerSkill(params: {
  name: string
  description: string
  promptTemplate: string
  version?: string
  tools?: string[]
  memory?: Skill['memory']
  constraints?: Skill['constraints']
  examples?: SkillExample[]
  tests?: SkillTest[]
  tags?: string[]
  provenance: Provenance
}): Promise<{ uri: string; skill: Skill }> {
  // Validazione base
  if (!params.name || params.name.length < 3) {
    throw new Error('Skill name must be at least 3 characters')
  }
  if (!params.description || params.description.length < 10) {
    throw new Error('Skill description must be at least 10 characters')
  }
  if (!params.promptTemplate || params.promptTemplate.length < 20) {
    throw new Error('Prompt template must be at least 20 characters')
  }

  // Validazione provenance
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  // Validazione tests
  const tests = params.tests || []
  for (const test of tests) {
    if (!test.expectedOutput && !test.expectedContains?.length && !test.assertFn) {
      throw new Error(`Test "${test.name}" must have expectedOutput, expectedContains, or assertFn`)
    }
  }

  // Verifica tools esistenti (se referenziati)
  const tools = params.tools || []
  if (tools.length > 0) {
    const existingTools = await db.tool.findMany({
      where: { toolId: { in: tools }, active: true },
      select: { toolId: true },
    })
    const existingIds = new Set(existingTools.map((t) => t.toolId))
    const missing = tools.filter((t) => !existingIds.has(t))
    if (missing.length > 0) {
      throw new Error(`Tools not found or inactive: ${missing.join(', ')}`)
    }
  }

  // Crea nodo Skill nel Context Graph.
  // Identifier include la versione per evitare collisioni tra versioni diverse.
  const version = params.version || '1.0.0'
  const baseName = params.name.toLowerCase().replace(/\s+/g, '-')
  const identifier = `${baseName}@${version}`
  const { uri } = await createNode({
    type: 'Skill',
    identifier,
    attributes: {
      name: params.name,
      description: params.description,
      promptTemplate: params.promptTemplate,
      tools,
      memory: params.memory || { requiredLayers: ['semantic'], contextBudget: 2000 },
      constraints: params.constraints || {},
      examples: params.examples || [],
      tests,
      tags: params.tags || [],
      version: params.version || '1.0.0',
    },
    provenance: params.provenance,
    lifecycleState: 'draft',
  })

  // Crea edge Skill -[USES_TOOL]-> Tool per ogni tool
  for (const toolId of tools) {
    try {
      await createEdge({
        fromUri: uri,
        toUri: `tool://${toolId}`,
        relationType: 'USES_TOOL',
        createdByAgent: params.provenance.createdByAgent,
      })
    } catch {
      // Tool node potrebbe non esistere nel grafo (solo nel Tool Ecosystem DB)
    }
  }

  const skill: Skill = {
    uri,
    name: params.name,
    description: params.description,
    version: params.version || '1.0.0',
    promptTemplate: params.promptTemplate,
    tools,
    memory: params.memory || { requiredLayers: ['semantic'], contextBudget: 2000 },
    constraints: params.constraints || {},
    examples: params.examples || [],
    tests,
    tags: params.tags || [],
    lifecycleState: 'draft',
    createdBy: params.provenance.createdByAgent,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  return { uri, skill }
}

/**
 * Recupera una skill per URI.
 */
export async function getSkill(uri: string): Promise<Skill | null> {
  const node = await getNode(uri)
  if (!node || node.entityType !== 'Skill') return null

  const attrs = node.attributes as Record<string, unknown>
  return {
    uri: node.uri,
    name: attrs.name as string,
    description: attrs.description as string,
    version: (attrs.version as string) || '1.0.0',
    promptTemplate: attrs.promptTemplate as string,
    tools: (attrs.tools as string[]) || [],
    memory: (attrs.memory as Skill['memory']) || { requiredLayers: ['semantic'], contextBudget: 2000 },
    constraints: (attrs.constraints as Skill['constraints']) || {},
    examples: (attrs.examples as SkillExample[]) || [],
    tests: (attrs.tests as SkillTest[]) || [],
    tags: (attrs.tags as string[]) || [],
    lifecycleState: node.lifecycleState as Skill['lifecycleState'],
    createdBy: node.provenance.createdByAgent,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  }
}

/**
 * Cerca skill per testo libero (match su name, description, tags).
 * In produzione integrato con GraphRAG (Fase 1.4) per semantic search.
 */
export async function searchSkills(query: string, options?: {
  tags?: string[]
  limit?: number
  activeOnly?: boolean
}): Promise<SkillSearchResult[]> {
  const q = query.toLowerCase()
  const queryTerms = q.split(/\s+/).filter(Boolean)

  const nodes = await db.graphNode.findMany({
    where: {
      entityType: 'Skill',
      ...(options?.activeOnly && { lifecycleState: 'active' }),
    },
    take: 200,
  })

  const results: SkillSearchResult[] = []
  for (const node of nodes) {
    const attrs = JSON.parse(node.attributes) as Record<string, unknown>
    const name = (attrs.name as string) || ''
    const description = (attrs.description as string) || ''
    const tags = (attrs.tags as string[]) || []
    const version = (attrs.version as string) || '1.0.0'

    const matchedOn: string[] = []
    let score = 0

    // Match su name (peso 3)
    const nameLower = name.toLowerCase()
    for (const term of queryTerms) {
      if (nameLower.includes(term)) {
        score += 3
        if (!matchedOn.includes('name')) matchedOn.push('name')
      }
    }

    // Match su description (peso 2)
    const descLower = description.toLowerCase()
    for (const term of queryTerms) {
      if (descLower.includes(term)) {
        score += 2
        if (!matchedOn.includes('description')) matchedOn.push('description')
      }
    }

    // Match su tags (peso 2)
    const tagsLower = tags.map((t) => t.toLowerCase())
    for (const term of queryTerms) {
      if (tagsLower.some((t) => t.includes(term))) {
        score += 2
        if (!matchedOn.includes('tags')) matchedOn.push('tags')
      }
    }

    // Filtro per tag espliciti
    if (options?.tags && options.tags.length > 0) {
      const hasAllTags = options.tags.every((t) => tagsLower.includes(t.toLowerCase()))
      if (!hasAllTags) continue
    }

    if (score > 0) {
      results.push({
        uri: node.uri,
        name,
        description,
        version,
        score,
        matchedOn,
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, options?.limit || 20)
}

/**
 * Aggiorna lifecycle state di una skill (draft → active → deprecated → archived).
 */
export async function updateSkillLifecycle(
  uri: string,
  newState: Skill['lifecycleState'],
  actor: string,
  reason?: string,
): Promise<void> {
  const { updateNodeLifecycle } = await import('@/lib/graph-age')
  await updateNodeLifecycle(uri, newState, actor, reason)
}

/**
 * Versiona una skill: crea una nuova versione a partire da una esistente.
 */
export async function versionSkill(params: {
  sourceUri: string
  newVersion: string
  updates: Partial<Pick<Skill, 'promptTemplate' | 'description' | 'tools' | 'constraints' | 'examples' | 'tests'>>
  provenance: Provenance
}): Promise<{ uri: string; skill: Skill }> {
  const source = await getSkill(params.sourceUri)
  if (!source) throw new Error(`Source skill not found: ${params.sourceUri}`)

  // Deprecate la vecchia versione (se possibile dal suo stato attuale)
  // Lifecycle transitions: draft→active→deprecated è l'unico path valido.
  // Se la source è draft, attiviamola prima; se è già active, deprechiamo.
  if (source.lifecycleState === 'draft') {
    try {
      await updateSkillLifecycle(params.sourceUri, 'active', params.provenance.createdByAgent, `Activating before deprecation by v${params.newVersion}`)
      await updateSkillLifecycle(params.sourceUri, 'deprecated', params.provenance.createdByAgent, `Superseded by v${params.newVersion}`)
    } catch (err) {
      console.warn(`[skill-registry] Cannot deprecate source ${params.sourceUri}:`, err)
    }
  } else if (source.lifecycleState === 'active') {
    try {
      await updateSkillLifecycle(params.sourceUri, 'deprecated', params.provenance.createdByAgent, `Superseded by v${params.newVersion}`)
    } catch (err) {
      console.warn(`[skill-registry] Cannot deprecate source ${params.sourceUri}:`, err)
    }
  }
  // Se la source è suspended/deprecated/archived/deleted, lasciala così com'è

  // Registra la nuova versione
  return registerSkill({
    name: source.name,
    description: params.updates.description || source.description,
    promptTemplate: params.updates.promptTemplate || source.promptTemplate,
    version: params.newVersion,
    tools: params.updates.tools || source.tools,
    memory: source.memory,
    constraints: params.updates.constraints || source.constraints,
    examples: params.updates.examples || source.examples,
    tests: params.updates.tests || source.tests,
    tags: source.tags,
    provenance: params.provenance,
  })
}

/**
 * Lista tutte le skill, opzionalmente filtrate per state.
 */
export async function listSkills(options?: {
  lifecycleState?: Skill['lifecycleState']
  limit?: number
}): Promise<Skill[]> {
  const nodes = await db.graphNode.findMany({
    where: {
      entityType: 'Skill',
      ...(options?.lifecycleState && { lifecycleState: options.lifecycleState }),
    },
    take: options?.limit || 100,
    orderBy: { createdAt: 'desc' },
  })

  const skills: Skill[] = []
  for (const node of nodes) {
    const skill = await getSkill(node.uri)
    if (skill) skills.push(skill)
  }
  return skills
}

/**
 * Statistiche del registry.
 */
export async function skillRegistryStats() {
  const [total, byState, byTag] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Skill' } }),
    db.graphNode.groupBy({
      by: ['lifecycleState'],
      where: { entityType: 'Skill' },
      _count: true,
    }),
    db.graphNode.findMany({
      where: { entityType: 'Skill' },
      select: { attributes: true },
    }),
  ])

  const tagCounts: Record<string, number> = {}
  for (const node of byTag) {
    try {
      const attrs = JSON.parse(node.attributes) as Record<string, unknown>
      const tags = (attrs.tags as string[]) || []
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1
      }
    } catch {}
  }

  return {
    total,
    byLifecycleState: byState.reduce((acc, s) => ({ ...acc, [s.lifecycleState]: s._count }), {} as Record<string, number>),
    topTags: Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
  }
}

// === Default skills (catalogo iniziale) ==============================

export function codeAnalysisProvenanceSkill(agentUri: string = 'agent://skill-registry'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'system-event',
    confidence: 1.0,
  })
}

/**
 * Seed di skill di default utili in qualsiasi deployment.
 */
export const DEFAULT_SKILLS: Array<Omit<Skill, 'uri' | 'lifecycleState' | 'createdAt' | 'updatedAt'> & { provenance: Provenance }> = [
  {
    name: 'code-review',
    description: 'Review di codice: rileva bug, suggerisce miglioramenti, verifica best practices.',
    version: '1.0.0',
    promptTemplate: `You are a senior code reviewer. Analyze the following code for:
- Bugs and potential issues
- Security vulnerabilities
- Performance improvements
- Best practices violations
- Readability improvements

Provide actionable feedback with code examples where appropriate.

CODE:
{{code}}`,
    tools: [],
    memory: { requiredLayers: ['semantic', 'procedural'], contextBudget: 4000 },
    constraints: { tokenBudget: 2000, timeout: 30000 },
    examples: [
      {
        input: 'function add(a, b) { return a + b }',
        output: 'Simple function. Consider adding type annotations and a docstring.',
        explanation: 'TypeScript best practice',
      },
    ],
    tests: [
      {
        name: 'detects missing types',
        input: 'function add(a, b) { return a + b }',
        expectedContains: ['type', 'annotation'],
      },
    ],
    tags: ['code', 'review', 'quality'],
    createdBy: 'agent://skill-registry',
    provenance: codeAnalysisProvenanceSkill(),
  },
  {
    name: 'task-planner',
    description: 'Decompose un obiettivo macro in task atomici eseguibili con dipendenze.',
    version: '1.0.0',
    promptTemplate: `You are a task planner. Decompose the following goal into atomic, executable tasks.

For each task provide:
- id (unique identifier)
- description
- estimated_duration
- dependencies (list of task ids that must complete first)
- required_tools

GOAL: {{goal}}

Output as JSON.`,
    tools: [],
    memory: { requiredLayers: ['reasoning', 'episodic'], contextBudget: 6000 },
    constraints: { tokenBudget: 3000, timeout: 60000 },
    examples: [],
    tests: [
      {
        name: 'produces valid JSON',
        input: 'Build a REST API for a todo app',
        expectedContains: ['{', 'tasks', 'dependencies'],
      },
    ],
    tags: ['planning', 'decomposition', 'dynamo'],
    createdBy: 'agent://skill-registry',
    provenance: codeAnalysisProvenanceSkill(),
  },
  {
    name: 'incident-responder',
    description: 'Analizza un incident report, identifica root cause, suggerisce mitigazioni.',
    version: '1.0.0',
    promptTemplate: `You are an incident responder. Analyze the following incident:

INCIDENT:
{{incident}}

Provide:
1. Severity assessment (P0/P1/P2/P3)
2. Probable root causes (ranked by likelihood)
3. Immediate mitigation steps
4. Long-term prevention recommendations
5. Postmortem action items

Be concise and actionable.`,
    tools: [],
    memory: { requiredLayers: ['episodic', 'procedural'], contextBudget: 8000 },
    constraints: {
      tokenBudget: 2500,
      timeout: 45000,
      redLines: ['Non mai raccomandare bypass dei cancelli di sicurezza'],
    },
    examples: [],
    tests: [
      {
        name: 'includes severity',
        input: 'API returning 500 errors for 10% of requests',
        expectedContains: ['P0', 'P1', 'P2', 'P3', 'severity'],
      },
    ],
    tags: ['incident', 'sre', 'incident-response', 'critical'],
    createdBy: 'agent://skill-registry',
    provenance: codeAnalysisProvenanceSkill(),
  },
]

/**
 * Inizializza il registry con le skill di default (idempotente).
 */
export async function seedDefaultSkills(): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  for (const skill of DEFAULT_SKILLS) {
    try {
      // Verifica se esiste già
      const identifier = skill.name.toLowerCase().replace(/\s+/g, '-')
      const existing = await db.graphNode.findUnique({
        where: { uri: `skill://${identifier}` },
      })
      if (existing) {
        skipped++
        continue
      }

      await registerSkill({
        name: skill.name,
        description: skill.description,
        promptTemplate: skill.promptTemplate,
        version: skill.version,
        tools: skill.tools,
        memory: skill.memory,
        constraints: skill.constraints,
        examples: skill.examples,
        tests: skill.tests,
        tags: skill.tags,
        provenance: skill.provenance,
      })
      created++
    } catch (err) {
      console.warn(`[skill-registry] Skip "${skill.name}":`, err)
      skipped++
    }
  }

  return { created, skipped }
}
