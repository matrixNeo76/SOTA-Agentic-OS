/**
 * Skills Export/Import — IO-3
 *
 * Export: ogni skill del skill-registry pubblicabile come SKILL.md (Claude Agent Skill format)
 * Import: caricare skill esterne nel registry (con validazione + provenance)
 * Discovery: endpoint di catalogo consultabile dagli agenti
 */

import { getSkill, registerSkill, listSkills, type Skill } from '@/lib/skill-registry/registry'
import { createProvenance, type Provenance } from '@/lib/governance'

// === Export ==========================================================

export interface SkilledManifest {
  name: string
  description: string
  version: string
  promptTemplate: string
  tools: string[]
  tags: string[]
  constraints: Record<string, unknown>
  examples: Array<{ input: string; output: string }>
  tests: Array<{ name: string; input: string; expectedContains?: string[] }>
  // Metadata SOTA-specific
  sota: {
    skillUri: string
    lifecycleState: string
    createdBy: string
    createdAt: string
  }
}

/**
 * Esporta una skill come SKILL.md (formato Claude Agent Skill).
 * Include un frontmatter YAML + il prompt template.
 */
export function exportSkillAsSkillMd(skill: Skill): string {
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `version: ${skill.version}`,
    ...(skill.tags.length > 0 ? [`tags: [${skill.tags.map((t) => `"${t}"`).join(', ')}]`] : []),
    ...(skill.tools.length > 0 ? [`tools: [${skill.tools.map((t) => `"${t}"`).join(', ')}]`] : []),
    `sota_uri: ${skill.uri}`,
    `sota_created_by: ${skill.createdBy}`,
    '---',
  ].join('\n')

  const body = [
    `# ${skill.name}`,
    '',
    skill.description,
    '',
    '## Prompt Template',
    '',
    '```',
    skill.promptTemplate,
    '```',
    '',
    ...(skill.examples.length > 0 ? [
      '## Examples',
      '',
      ...skill.examples.flatMap((ex) => [
        `### Input: ${ex.input}`,
        `**Output:** ${ex.output}`,
        ...(ex.explanation ? [`*${ex.explanation}*`] : []),
        '',
      ]),
    ] : []),
    ...(skill.tests.length > 0 ? [
      '## Tests',
      '',
      ...skill.tests.map((t) =>
        `- **${t.name}**: input="${t.input}"${t.expectedContains ? `, expectedContains=[${t.expectedContains.map((c) => `"${c}"`).join(', ')}]` : ''}`
      ),
      '',
    ] : []),
    ...(skill.constraints.ltlRules ? [
      '## Constraints',
      '',
      `LTL Rules: ${JSON.stringify(skill.constraints.ltlRules)}`,
      ...(skill.constraints.redLines ? `Red Lines: ${JSON.stringify(skill.constraints.redLines)}` : ''),
      '',
    ] : []),
  ].join('\n')

  return `${frontmatter}\n\n${body}`
}

/**
 * Esporta una skill come JSON manifest (per import programmatico).
 */
export function exportSkillAsManifest(skill: Skill): SkilledManifest {
  return {
    name: skill.name,
    description: skill.description,
    version: skill.version,
    promptTemplate: skill.promptTemplate,
    tools: skill.tools,
    tags: skill.tags,
    constraints: skill.constraints,
    examples: skill.examples,
    tests: skill.tests,
    sota: {
      skillUri: skill.uri,
      lifecycleState: skill.lifecycleState,
      createdBy: skill.createdBy,
      createdAt: skill.createdAt,
    },
  }
}

// === Import ==========================================================

/**
 * Importa una skill esterna nel registry.
 * Valida il formato, applica provenance, registra con status draft.
 */
export async function importSkill(params: {
  manifest: SkilledManifest | string // JSON manifest o SKILL.md content
  provenance: Provenance
}): Promise<{ uri: string; skill: Skill }> {
  let manifest: SkilledManifest

  if (typeof params.manifest === 'string') {
    // Parse SKILL.md
    manifest = parseSkillMd(params.manifest)
  } else {
    manifest = params.manifest
  }

  // Validazione base
  if (!manifest.name || manifest.name.length < 3) {
    throw new Error('Skill name must be at least 3 characters')
  }
  if (!manifest.description || manifest.description.length < 10) {
    throw new Error('Skill description must be at least 10 characters')
  }
  if (!manifest.promptTemplate || manifest.promptTemplate.length < 20) {
    throw new Error('Prompt template must be at least 20 characters')
  }

  return registerSkill({
    name: manifest.name,
    description: manifest.description,
    promptTemplate: manifest.promptTemplate,
    version: manifest.version || '1.0.0',
    tools: manifest.tools || [],
    constraints: manifest.constraints || {},
    examples: manifest.examples || [],
    tests: manifest.tests || [],
    tags: [...(manifest.tags || []), 'imported'],
    provenance: params.provenance,
  })
}

/**
 * Parse SKILL.md content → SkilledManifest.
 */
function parseSkillMd(content: string): SkilledManifest {
  // Estrai frontmatter YAML
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) throw new Error('Invalid SKILL.md: missing frontmatter')

  const frontmatter = fmMatch[1]!
  const body = content.slice(fmMatch[0]!.length).trim()

  // Parse YAML semplice (key: value)
  const fm: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/)
    if (match) fm[match[1]!] = match[2]!
  }

  // Estrai prompt template dal body
  const promptMatch = body.match(/```\n([\s\S]*?)\n```/)
  const promptTemplate = promptMatch?.[1] || body

  return {
    name: fm.name || 'imported-skill',
    description: fm.description || 'Imported skill',
    version: fm.version || '1.0.0',
    promptTemplate,
    tools: fm.tools ? JSON.parse(fm.tools.replace(/"/g, '"')) : [],
    tags: fm.tags ? JSON.parse(fm.tags.replace(/"/g, '"')) : ['imported'],
    constraints: {},
    examples: [],
    tests: [],
    sota: {
      skillUri: fm.sota_uri || '',
      lifecycleState: 'draft',
      createdBy: fm.sota_created_by || 'external',
      createdAt: new Date().toISOString(),
    },
  }
}

// === Discovery =======================================================

/**
 * Catalogo pubblico delle skill per discovery da agenti esterni.
 * Ritorna solo skill active, senza prompt template completo (solo metadata).
 */
export async function discoverSkills(query?: string): Promise<Array<{
  name: string
  description: string
  version: string
  tags: string[]
  lifecycleState: string
  uri: string
}>> {
  const skills = await listSkills({ lifecycleState: 'active', limit: 50 })
  const filtered = query
    ? skills.filter((s) =>
        s.name.includes(query) ||
        s.description.includes(query) ||
        s.tags.some((t) => t.includes(query))
      )
    : skills

  return filtered.map((s) => ({
    name: s.name,
    description: s.description,
    version: s.version,
    tags: s.tags,
    lifecycleState: s.lifecycleState,
    uri: s.uri,
  }))
}
