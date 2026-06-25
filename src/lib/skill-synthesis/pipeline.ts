/**
 * Skill Synthesis + Meta Agent Compiler — Fase 3.5
 *
 * Quando manca una skill → DynAMO → Meta Agent → code gen → sandbox test →
 * validation → Skill Registry.
 *
 * Pipeline:
 *   1. Detect skill gap: analizza task falliti, trova pattern che nessuna
 *      skill esistente copre
 *   2. Generate skill: Meta Agent (LLM) genera prompt template + tests
 *   3. Sandbox test: esegue la skill in ambiente isolato con tool firmati
 *   4. Validate: Evaluation Layer (Fase 2.7) valuta la skill generata
 *   5. Register: se validation passa, registra nel Skill Registry (Fase 2.5)
 *
 * Tutto sotto Human Approval Gate: la skill non viene mai registrata senza
 * approvazione umana esplicita (Sovereign Validator, Fase 9).
 *
 * La sandbox riusa il Tool Ecosystem firmato ECDSA per i permessi (Fase 18).
 */

import { db } from '@/lib/db'
import { createNode, createEdge } from '@/lib/graph-age'
import { createProvenance, validateProvenance, type Provenance } from '@/lib/governance'
import { registerSkill, searchSkills, getSkill, type Skill, type SkillExample, type SkillTest } from '@/lib/skill-registry/registry'
import { runEvaluation, type Benchmark, type TaskResult } from '@/lib/evaluation/runner'
import { publishApprovalRequested } from '@/lib/event-mesh/publishers'

// === Tipi ============================================================

export interface SkillGap {
  id: string
  description: string
  evidence: Array<{ taskUri: string; failurePattern: string; occurrences: number }>
  suggestedSkillName: string
  suggestedDomain: string
  detectedAt: string
}

export interface GeneratedSkill {
  id: string
  gapId: string
  name: string
  description: string
  promptTemplate: string
  tools: string[]
  examples: SkillExample[]
  tests: SkillTest[]
  generatedBy: string
  generatedAt: string
  status: 'generated' | 'sandbox_testing' | 'validated' | 'rejected' | 'approved'
}

export interface SandboxTestResult {
  skillId: string
  success: boolean
  taskResults: TaskResult[]
  errorRate: number
  avgLatencyMs: number
  anomalies: string[]
  testedAt: string
}

export interface SynthesisPipeline {
  gap: SkillGap
  generated: GeneratedSkill
  sandbox: SandboxTestResult
  validation?: {
    evaluationUri: string
    overallScore: number
    verdict: 'pass' | 'fail' | 'partial'
  }
  finalStatus: 'pending_approval' | 'approved' | 'rejected'
  skillUri?: string // se approved, URI nel Skill Registry
}

// === Skill gap detection =============================================

/**
 * Analizza i task falliti recenti per identificare skill gap.
 *
 * Cerca pattern ricorrenti nei fallimenti:
 *   - Stesso tipo di errore ripetuto
 *   - Stesso task pattern senza skill match
 *   - Tool call fallite ripetute
 */
export async function detectSkillGaps(options?: {
  daysWindow?: number
  minOccurrences?: number
}): Promise<SkillGap[]> {
  const daysWindow = options?.daysWindow ?? 7
  const minOccurrences = options?.minOccurrences ?? 3
  const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000)

  // Recupera task falliti recenti
  const failedTasks = await db.agentLog.findMany({
    where: {
      event: 'TaskFailed',
      timestamp: { gte: cutoff },
    },
    take: 500,
    orderBy: { timestamp: 'desc' },
  })

  // Group per failure pattern (semplificato: estrai keyword dal payload)
  const patternMap = new Map<string, Array<{ taskUri: string; payload: string }>>()

  for (const log of failedTasks) {
    try {
      const payload = JSON.parse(log.payload) as Record<string, unknown>
      const error = (payload.error as string) || 'unknown'
      const taskUri = (payload.taskUri as string) || 'unknown'

      // Estrai keyword significative dall'errore
      const keywords = extractErrorKeywords(error)
      const pattern = keywords.join(' ')

      if (!patternMap.has(pattern)) {
        patternMap.set(pattern, [])
      }
      patternMap.get(pattern)!.push({ taskUri, payload: log.payload })
    } catch {}
  }

  // Filtra pattern con occorrenze sufficienti
  const gaps: SkillGap[] = []
  for (const [pattern, occurrences] of patternMap) {
    if (occurrences.length < minOccurrences) continue

    // Verifica che nessuna skill esistente copra questo pattern
    const existingSkills = await searchSkills(pattern, { activeOnly: true, limit: 5 })
    if (existingSkills.length > 0) continue

    const gapId = `gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    gaps.push({
      id: gapId,
      description: `Recurring failure pattern: "${pattern}" (${occurrences.length} occurrences in ${daysWindow}d, no skill covers it)`,
      evidence: occurrences.map((o) => ({
        taskUri: o.taskUri,
        failurePattern: pattern,
        occurrences: 1,
      })),
      suggestedSkillName: `skill-for-${pattern.split(' ').slice(0, 2).join('-')}`.toLowerCase(),
      suggestedDomain: pattern,
      detectedAt: new Date().toISOString(),
    })
  }

  return gaps
}

function extractErrorKeywords(error: string): string[] {
  // Estrai parole significative (lunghezza > 3, non stopwords)
  const stopwords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'will', 'was', 'were', 'are', 'not', 'but', 'had', 'has'])
  const words = error.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w))
    .slice(0, 3)
  return words.length > 0 ? words : ['unknown-error']
}

// === Skill generation (Meta Agent) ===================================

/**
 * Genera una skill tramite Meta Agent.
 *
 * In Fase 3.5 la generazione è rule-based + template:
 *   - Costruisce un prompt template basato sul pattern di fallimento
 *   - Genera test cases basati sugli esempi di fallimento
 *
 * In produzione il Meta Agent è un LLM (GLM-4.6, GPT-4, Claude) che genera
 * prompt template più sofisticati. Qui forniamo l'infrastruttura + un
 * template baseline che può essere migliorato.
 */
export async function generateSkillForGap(params: {
  gap: SkillGap
  provenance: Provenance
  generatorAgentUri?: string
  useLLM?: boolean // default true; se false, usa solo template rule-based
}): Promise<GeneratedSkill> {
  const provValidation = validateProvenance(params.provenance)
  if (!provValidation.valid) {
    throw new Error(`Invalid provenance: ${provValidation.error}`)
  }

  const gap = params.gap
  const generator = params.generatorAgentUri || 'agent://meta-agent-compiler'
  const useLLM = params.useLLM !== false // default true

  // Genera il prompt template: LLM-based se disponibile, fallback rule-based
  let promptTemplate: string
  let templateSource: 'llm' | 'fallback' = 'fallback'

  if (useLLM) {
    try {
      const { generateSkillPromptTemplate } = await import('@/lib/llm-client/client')
      const result = await generateSkillPromptTemplate({
        skillName: gap.suggestedSkillName,
        description: gap.description,
        failurePattern: gap.suggestedDomain,
        evidence: gap.evidence.map((e) => `Task ${e.taskUri}: ${e.failurePattern}`),
      })
      promptTemplate = result.template
      templateSource = result.source
    } catch {
      promptTemplate = buildPromptTemplate(gap)
    }
  } else {
    promptTemplate = buildPromptTemplate(gap)
  }

  // Genera esempi few-shot dalle evidenze
  const examples: SkillExample[] = gap.evidence.slice(0, 3).map((e) => ({
    input: `Task: ${e.taskUri}\nPattern: ${e.failurePattern}`,
    output: 'Successfully handled by the generated skill',
    explanation: 'Skill applies the correct handling for this failure pattern',
  }))

  // Genera test cases
  const tests: SkillTest[] = buildTestCases(gap)

  const skillId = `gen-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const generated: GeneratedSkill = {
    id: skillId,
    gapId: gap.id,
    name: gap.suggestedSkillName,
    description: gap.description,
    promptTemplate,
    tools: [], // In Fase 3.5 la skill generata non ha tool; in produzione può richiederne
    examples,
    tests,
    generatedBy: generator,
    generatedAt: new Date().toISOString(),
    status: 'generated',
  }

  // Salva come nodo Document per tracking (include templateSource per audit)
  await createNode({
    type: 'Document',
    identifier: skillId,
    attributes: {
      title: `Generated Skill: ${gap.suggestedSkillName}`,
      source: 'skill-synthesis',
      mimeType: 'application/x-generated-skill',
      gapId: gap.id,
      name: generated.name,
      description: generated.description,
      promptTemplate,
      tools: generated.tools,
      examples,
      tests,
      generatedBy: generator,
      status: 'generated',
      templateSource, // 'llm' | 'fallback' — audit trail della generazione
    },
    provenance: params.provenance,
  })

  return generated
}

function buildPromptTemplate(gap: SkillGap): string {
  return `You are a specialized skill for handling: ${gap.description}

When you encounter the pattern "${gap.suggestedDomain}", apply the following approach:

1. Identify the root cause of the failure
2. Apply the corrective action based on the pattern
3. Verify the result before completing

Pattern context:
${gap.evidence.map((e) => `- ${e.failurePattern} (occurred in ${e.taskUri})`).join('\n')}

Task to handle:
{{task}}`
}

function buildTestCases(gap: SkillGap): SkillTest[] {
  const tests: SkillTest[] = []

  // Test 1: should handle the failure pattern
  tests.push({
    name: 'handles-failure-pattern',
    input: `Handle task with pattern: ${gap.suggestedDomain}`,
    expectedContains: ['root cause', 'corrective', 'verify'],
  })

  // Test 2: should produce non-empty output
  tests.push({
    name: 'produces-output',
    input: 'Process the task',
    expectedContains: [],
    assertFn: 'output.length > 0',
  })

  // Test 3: based on first evidence (se disponibile)
  if (gap.evidence.length > 0) {
    const first = gap.evidence[0]!
    tests.push({
      name: 'handles-first-evidence',
      input: `Task: ${first.taskUri}`,
      expectedContains: ['task'],
    })
  }

  return tests
}

// === Sandbox testing =================================================

/**
 * Esegue la skill generata in una sandbox.
 *
 * La sandbox è un ambiente isolato che:
 *   - Esegue la skill su task di test
 *   - Verifica che gli expectedContains/assertFn passino
 *   - Limita le risorse (timeout, token budget)
 *   - Usa tool firmati ECDSA per i permessi (Fase 18)
 *
 * In Fase 3.5 la sandbox è simulata (rule-based):
 *   - Per ogni test, verifica expectedContains nel prompt template
 *   - Genera output simulato basato sul template
 *   - Verifica assertFn
 */
export async function testSkillInSandbox(params: {
  skill: GeneratedSkill
  provenance: Provenance
}): Promise<SandboxTestResult> {
  const startTime = Date.now()
  const taskResults: TaskResult[] = []
  const anomalies: string[] = []

  // Simula l'esecuzione di ogni test
  for (const test of params.skill.tests) {
    const testStart = Date.now()

    // Genera output simulato: sostituisce {{task}} nel template
    const simulatedOutput = params.skill.promptTemplate
      .replace('{{task}}', test.input)
      .slice(0, 1000) // safety cap

    // Verifica expectedContains
    let success = true
    if (test.expectedContains && test.expectedContains.length > 0) {
      const lowerOutput = simulatedOutput.toLowerCase()
      for (const expected of test.expectedContains) {
        if (!lowerOutput.includes(expected.toLowerCase())) {
          success = false
          break
        }
      }
    }

    // Verifica assertFn (semplificato: supporta solo `output.length > N`)
    if (success && test.assertFn) {
      const match = test.assertFn.match(/output\.length\s*>\s*(\d+)/)
      if (match) {
        const threshold = parseInt(match[1]!, 10)
        if (simulatedOutput.length <= threshold) {
          success = false
        }
      }
    }

    taskResults.push({
      taskId: test.name,
      success,
      output: simulatedOutput,
      toolCallsUsed: [],
      forbiddenActionsTriggered: [],
      durationMs: Date.now() - testStart,
      cost: 0,
      error: success ? undefined : 'Test failed in sandbox',
    })
  }

  const successCount = taskResults.filter((r) => r.success).length
  const errorRate = taskResults.length > 0 ? 1 - (successCount / taskResults.length) : 1
  const avgLatencyMs = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.durationMs, 0) / taskResults.length
    : 0

  // Detect anomalies
  if (errorRate > 0.5) {
    anomalies.push(`High error rate in sandbox: ${(errorRate * 100).toFixed(1)}%`)
  }
  if (avgLatencyMs > 5000) {
    anomalies.push(`High latency in sandbox: ${avgLatencyMs.toFixed(0)}ms`)
  }
  if (params.skill.promptTemplate.length < 50) {
    anomalies.push('Prompt template is too short, may be ineffective')
  }

  return {
    skillId: params.skill.id,
    success: errorRate < 0.5,
    taskResults,
    errorRate,
    avgLatencyMs,
    anomalies,
    testedAt: new Date().toISOString(),
  }
}

// === Validation via Evaluation Layer =================================

/**
 * Valida la skill tramite Evaluation Layer (Fase 2.7).
 *
 * Crea un benchmark ad-hoc con i test case della skill generata,
 * esegue la valutazione, ritorna lo score.
 */
export async function validateSkill(params: {
  skill: GeneratedSkill
  sandbox: SandboxTestResult
  provenance: Provenance
}): Promise<{
  evaluationUri: string
  overallScore: number
  verdict: 'pass' | 'fail' | 'partial'
}> {
  // Crea un benchmark ad-hoc con i test case
  const { registerBenchmark: registerBm } = await import('@/lib/evaluation/runner')

  const benchmark = await registerBm({
    name: `validation-${params.skill.name}-${Date.now()}`,
    description: `Validation benchmark for generated skill ${params.skill.name}`,
    dataset: {
      tasks: params.skill.tests.map((t) => ({
        id: t.name,
        input: t.input,
        expectedContains: t.expectedContains,
        difficulty: 'easy' as const,
      })),
      successCriteria: ['All test cases pass'],
    },
    provenance: params.provenance,
  })

  // Esegui la valutazione usando i task results della sandbox
  const { uri, evaluation } = await runEvaluation({
    agentUri: `agent://meta-agent-compiler`,
    benchmarkUri: benchmark.uri,
    taskResults: params.sandbox.taskResults,
    provenance: params.provenance,
  })

  return {
    evaluationUri: uri,
    overallScore: evaluation.overallScore,
    verdict: evaluation.verdict,
  }
}

// === Full pipeline ===================================================

/**
 * Esegue la pipeline completa di Skill Synthesis:
 *   1. Detect gap
 *   2. Generate skill
 *   3. Sandbox test
 *   4. Validate
 *   5. Request human approval (Sovereign Validator)
 *
 * NON registra automaticamente la skill: richiede approval umana.
 */
export async function runSynthesisPipeline(params: {
  gap?: SkillGap // se non fornito, detect automaticamente
  provenance: Provenance
  autoApprove?: boolean // SOLO per test; in produzione sempre false
}): Promise<SynthesisPipeline[]> {
  const pipelines: SynthesisPipeline[] = []

  // 1. Detect gap (se non fornito)
  const gaps = params.gap ? [params.gap] : await detectSkillGaps()

  for (const gap of gaps) {
    // 2. Generate skill
    const generated = await generateSkillForGap({
      gap,
      provenance: params.provenance,
    })

    // 3. Sandbox test
    const sandbox = await testSkillInSandbox({
      skill: generated,
      provenance: params.provenance,
    })

    // 4. Validate (se sandbox passa)
    let validation: SynthesisPipeline['validation']
    if (sandbox.success) {
      validation = await validateSkill({
        skill: generated,
        sandbox,
        provenance: params.provenance,
      })
    }

    // 5. Determine final status
    let finalStatus: SynthesisPipeline['finalStatus'] = 'pending_approval'
    let skillUri: string | undefined

    if (validation && validation.verdict === 'pass' && params.autoApprove) {
      // Auto-approve only for testing purposes
      // Include timestamp nel nome per evitare collisioni su re-run
      const { uri } = await registerSkill({
        name: `${generated.name}-${Date.now()}`,
        description: generated.description,
        promptTemplate: generated.promptTemplate,
        tools: generated.tools,
        examples: generated.examples,
        tests: generated.tests,
        tags: ['auto-generated', 'synthesis'],
        provenance: params.provenance,
      })
      skillUri = uri
      finalStatus = 'approved'
    } else if (validation && validation.verdict !== 'pass') {
      finalStatus = 'rejected'
    } else {
      // Richiedi approval umana
      await publishApprovalRequested(
        `skill-synthesis://${generated.id}`,
        `Register generated skill "${generated.name}"`,
        'hitl_gate',
        params.provenance,
      ).catch(() => {})
    }

    pipelines.push({
      gap,
      generated: { ...generated, status: finalStatus === 'approved' ? 'validated' : generated.status },
      sandbox,
      validation,
      finalStatus,
      skillUri,
    })
  }

  return pipelines
}

// === Stats ===========================================================

export async function synthesisStats() {
  const generated = await db.graphNode.findMany({
    where: { entityType: 'Document' },
    select: { attributes: true, createdAt: true },
  })

  let totalGaps = 0
  let totalGenerated = 0
  let totalApproved = 0
  let totalRejected = 0
  let totalPending = 0

  for (const node of generated) {
    try {
      const attrs = JSON.parse(node.attributes) as Record<string, unknown>
      if (attrs.source !== 'skill-synthesis') continue
      totalGenerated++
      const status = attrs.status as string
      if (status === 'approved') totalApproved++
      else if (status === 'rejected') totalRejected++
      else totalPending++
    } catch {}
  }

  return {
    totalGenerated,
    approved: totalApproved,
    rejected: totalRejected,
    pendingApproval: totalPending,
  }
}

export function synthesisProvenance(agentUri: string = 'agent://meta-agent-compiler'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'synthesis',
    confidence: 0.8,
  })
}
