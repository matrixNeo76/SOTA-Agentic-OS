/**
 * Skill Manager — Fase 4 Track 4.3
 *
 * Gestione del ciclo di vita delle skills (prompt templates riutilizzabili).
 *
 * Una Skill è un prompt template strutturato che può:
 * - Essere eseguito con input variabili (sostituzione {{var}})
 * - Dipendere da tool specifici
 * - Avere condizioni di trigger (keywords, fasi, agenti)
 * - Essere importato/exportato come JSON
 * - Essere condiviso nel marketplace (isPublic)
 *
 * Le skills sono esposte via MCP come "prompts" (prompts/list, prompts/get).
 */
import { db } from '@/lib/db'

// Simple audit log helper (placeholder — replace with real audit module when available)
async function recordAudit(entry: {
  action: string
  actorId: string
  targetType: string
  targetId: string
  description: string
}) {
  console.log(`[audit] ${entry.action} by ${entry.actorId} on ${entry.targetType}:${entry.targetId} — ${entry.description}`)
}

export type SkillInput = {
  name: string
  description: string
  category?: string
  promptTemplate: string
  toolDependencies?: string[]
  triggerConditions?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  outputFormat?: string
  isPublic?: boolean
}

export type SkillExecutionResult = {
  ok: boolean
  output: string
  skillId: string
  skillName: string
  durationMs: number
}

// === Create ===
export async function createSkill(input: SkillInput, tenantId: string, userId: string) {
  const existing = await db.skill.findFirst({
    where: { name: input.name, tenantId },
  })
  if (existing) {
    throw new Error(`Skill '${input.name}' already exists in this tenant`)
  }

  const skill = await db.skill.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category || 'custom',
      promptTemplate: input.promptTemplate,
      toolDependencies: JSON.stringify(input.toolDependencies || []),
      triggerConditions: JSON.stringify(input.triggerConditions || {}),
      inputSchema: JSON.stringify(input.inputSchema || {}),
      outputFormat: input.outputFormat || 'text',
      isPublic: input.isPublic || false,
      createdBy: userId,
      tenantId,
    },
  })

  await recordAudit({
    action: 'skill_create',
    actorId: userId,
    targetType: 'skill',
    targetId: skill.id,
    description: `Skill '${input.name}' created`,
  })

  return skill
}

// === Import from JSON ===
export async function importSkill(json: string, tenantId: string, userId: string) {
  const data = JSON.parse(json)
  if (!data.name || !data.promptTemplate) {
    throw new Error('Invalid skill JSON: name and promptTemplate are required')
  }
  return createSkill({
    name: data.name,
    description: data.description || 'Imported skill',
    category: 'imported',
    promptTemplate: data.promptTemplate,
    toolDependencies: data.toolDependencies || [],
    triggerConditions: data.triggerConditions || {},
    inputSchema: data.inputSchema || {},
    outputFormat: data.outputFormat || 'text',
    isPublic: false,
  }, tenantId, userId)
}

// === Export to JSON ===
export async function exportSkill(skillId: string) {
  const skill = await db.skill.findUnique({ where: { id: skillId } })
  if (!skill) throw new Error('Skill not found')

  return JSON.stringify({
    name: skill.name,
    description: skill.description,
    category: skill.category,
    promptTemplate: skill.promptTemplate,
    toolDependencies: JSON.parse(skill.toolDependencies),
    triggerConditions: JSON.parse(skill.triggerConditions),
    inputSchema: JSON.parse(skill.inputSchema),
    outputFormat: skill.outputFormat,
    version: skill.version,
  }, null, 2)
}

// === Execute ===
export async function executeSkill(
  skillId: string,
  variables: Record<string, string>,
  tenantId: string
): Promise<SkillExecutionResult> {
  const skill = await db.skill.findFirst({
    where: { id: skillId, tenantId, active: true },
  })
  if (!skill) throw new Error('Skill not found or inactive')

  const startedAt = Date.now()

  // Replace {{variables}} in prompt template
  let prompt = skill.promptTemplate
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  // Call LLM via ZAI SDK
  let output = ''
  let ok = true
  try {
    const ZAI_MOD = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI_MOD.create()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a SOTA Agentic OS skill executor. Skill: ${skill.name}. ${skill.description}. Output format: ${skill.outputFormat}.`,
        },
        { role: 'user', content: prompt },
      ],
    })
    output = completion.choices[0]?.message?.content || ''
  } catch (e: any) {
    output = `Error: ${e.message}`
    ok = false
  }

  // Update usage stats
  await db.skill.update({
    where: { id: skillId },
    data: {
      usageCount: { increment: 1 },
      // Aggiorna successRate con media mobile
      successRate: ok
        ? (skill.successRate * skill.usageCount + 1) / (skill.usageCount + 1)
        : (skill.successRate * skill.usageCount) / (skill.usageCount + 1),
    },
  })

  return {
    ok,
    output,
    skillId,
    skillName: skill.name,
    durationMs: Date.now() - startedAt,
  }
}

// === List ===
export async function listSkills(
  tenantId: string,
  options: { category?: string; includePublic?: boolean } = {}
) {
  const where = {
    tenantId,
    active: true,
    ...(options.category && { category: options.category }),
    ...(options.includePublic && {
      OR: [{ tenantId }, { isPublic: true }],
    }),
  }

  return db.skill.findMany({
    where,
    orderBy: { usageCount: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      outputFormat: true,
      usageCount: true,
      successRate: true,
      createdBy: true,
      isPublic: true,
      createdAt: true,
    },
  })
}

// === Get details ===
export async function getSkill(skillId: string, tenantId: string) {
  const skill = await db.skill.findFirst({
    where: { id: skillId, tenantId },
  })
  if (!skill) return null
  return {
    ...skill,
    toolDependencies: JSON.parse(skill.toolDependencies),
    triggerConditions: JSON.parse(skill.triggerConditions),
    inputSchema: JSON.parse(skill.inputSchema),
  }
}

// === Delete (soft) ===
export async function deleteSkill(skillId: string, tenantId: string) {
  return db.skill.updateMany({
    where: { id: skillId, tenantId },
    data: { active: false },
  })
}

// === Suggest skills based on input text ===
export async function suggestSkills(
  input: string,
  tenantId: string,
  topK = 3
) {
  const skills = await db.skill.findMany({
    where: { tenantId, active: true },
    select: {
      id: true,
      name: true,
      description: true,
      triggerConditions: true,
      category: true,
    },
  })

  const inputLower = input.toLowerCase()
  return skills
    .map(s => {
      let score = 0
      try {
        const triggers = JSON.parse(s.triggerConditions || '{}') as { keywords?: string[] }
        const keywords = triggers.keywords || []
        for (const kw of keywords) {
          if (inputLower.includes(kw.toLowerCase())) score += 10
        }
      } catch { /* skip */ }
      if (s.name && inputLower.includes(s.name.toLowerCase())) score += 5
      if (s.description && inputLower.includes(s.description.toLowerCase().split(' ')[0])) score += 2
      return { ...s, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// === Builtin skills ===
export const BUILTIN_SKILLS: SkillInput[] = [
  {
    name: 'task-analyzer',
    description: 'Analizza un task e lo scompone in sotto-task con complessità, tool richiesti e rischi.',
    category: 'builtin',
    promptTemplate: `Analyze the following task and provide:
1. Sub-tasks breakdown (numbered list)
2. Complexity assessment (low/medium/high) with reasoning
3. Required tools and capabilities
4. Potential risks and mitigations
5. Estimated token cost

Task: {{task}}

Format the response as structured markdown.`,
    outputFormat: 'markdown',
    triggerConditions: { keywords: ['analyze', 'break down', 'decompose', 'analizza', 'scomponi'] },
  },
  {
    name: 'code-reviewer',
    description: 'Revisiona codice per vulnerabilità di sicurezza, best practices e problemi di performance.',
    category: 'builtin',
    promptTemplate: `Review the following code for:
1. Security vulnerabilities (critical/high/medium/low)
2. Best practice violations
3. Performance issues
4. Suggested improvements

Code:
\`\`\`
{{code}}
\`\`\`

Format: Markdown with severity badges.`,
    outputFormat: 'markdown',
    triggerConditions: { keywords: ['review', 'audit', 'check code', 'revisiona'] },
    toolDependencies: ['filesystem-browser'],
  },
  {
    name: 'compliance-checker',
    description: 'Verifica che un\'azione o piano sia conforme a regole LTL di safety e policy organizzative.',
    category: 'builtin',
    promptTemplate: `Verify compliance for the following action:

Action: {{action}}
Context: {{context}}

Check against:
1. LTL safety rules (irreversible actions need human approval)
2. Normative hierarchy (SAFETY > OPERATIONAL > AESTHETIC)
3. Data protection (PII handling, encryption requirements)
4. Audit trail requirements

Return JSON: { "compliant": boolean, "violations": string[], "recommendations": string[] }`,
    outputFormat: 'json',
    triggerConditions: { keywords: ['compliance', 'verify', 'check policy', 'conformità'] },
  },
  {
    name: 'report-generator',
    description: 'Genera un report executive strutturato da dati operativi, metriche e log attività.',
    category: 'builtin',
    promptTemplate: `Generate an executive report based on:

Period: {{period}}
Metrics: {{metrics}}
Key events: {{events}}

Include:
1. Executive summary (3 sentences)
2. Key metrics dashboard (table)
3. Notable events and interventions
4. Risk assessment
5. Recommendations for next period

Format: Professional markdown report.`,
    outputFormat: 'markdown',
    triggerConditions: { keywords: ['report', 'summary', 'dashboard', 'rapporto'] },
  },
  {
    name: 'incident-responder',
    description: 'Analizza un incidente di sicurezza, determina la root cause e genera un piano di risposta.',
    category: 'builtin',
    promptTemplate: `Analyze the following security incident and generate a response plan:

Incident: {{incident}}
Affected systems: {{systems}}
Timestamp: {{timestamp}}

Provide:
1. Incident classification (severity 1-5)
2. Root cause analysis
3. Immediate containment actions
4. Eradication steps
5. Recovery procedure
6. Post-incident recommendations

Format: Structured markdown with action items.`,
    outputFormat: 'markdown',
    triggerConditions: { keywords: ['incident', 'security', 'breach', 'alert', 'sicurezza'] },
  },
]

// === Initialize builtin skills ===
export async function initializeBuiltinSkills(tenantId: string): Promise<void> {
  for (const skill of BUILTIN_SKILLS) {
    const existing = await db.skill.findFirst({
      where: { name: skill.name, tenantId },
    })
    if (!existing) {
      await createSkill(skill, tenantId, 'system')
      console.log(`[skills] Created builtin skill: ${skill.name}`)
    }
  }
}
