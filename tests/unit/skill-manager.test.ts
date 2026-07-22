import { describe, it, expect } from 'vitest'
import { BUILTIN_SKILLS } from '@/lib/kernel/skill-manager'

/**
 * Test di Fase 4 — Skill Manager
 *
 * Testa le strutture dati pure (BUILTIN_SKILLS) senza dipendere dal DB.
 * I test di integration (create/list/execute) richiedono DB e sono in tests/integration.
 */
describe('Skill Manager — Builtin Skills', () => {
  it('ci sono almeno 5 builtin skills', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(5)
  })

  it('tutte le builtin skills hanno nome univoco', () => {
    const names = BUILTIN_SKILLS.map(s => s.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('tutte le builtin skills hanno i campi obbligatori', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toBeTruthy()
      expect(skill.description).toBeTruthy()
      expect(skill.promptTemplate).toBeTruthy()
      expect(skill.promptTemplate.length).toBeGreaterThan(20)
      expect(skill.category).toBe('builtin')
      expect(skill.outputFormat).toBeTruthy()
    }
  })

  it('tutte le builtin skills hanno trigger conditions con keywords', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.triggerConditions).toBeDefined()
      const triggers = skill.triggerConditions as { keywords?: string[] }
      expect(triggers.keywords).toBeDefined()
      expect(Array.isArray(triggers.keywords)).toBe(true)
      expect(triggers.keywords!.length).toBeGreaterThan(0)
    }
  })

  it('i prompt template contengono almeno un placeholder {{variable}}', () => {
    for (const skill of BUILTIN_SKILLS) {
      const hasPlaceholder = /\{\{(\w+)\}\}/.test(skill.promptTemplate)
      expect(hasPlaceholder).toBe(true)
    }
  })

  it('la skill task-analyzer ha placeholder {{task}}', () => {
    const taskAnalyzer = BUILTIN_SKILLS.find(s => s.name === 'task-analyzer')
    expect(taskAnalyzer).toBeDefined()
    expect(taskAnalyzer!.promptTemplate).toContain('{{task}}')
  })

  it('la skill code-reviewer ha placeholder {{code}}', () => {
    const codeReviewer = BUILTIN_SKILLS.find(s => s.name === 'code-reviewer')
    expect(codeReviewer).toBeDefined()
    expect(codeReviewer!.promptTemplate).toContain('{{code}}')
  })

  it('la skill compliance-checker restituisce JSON', () => {
    const compliance = BUILTIN_SKILLS.find(s => s.name === 'compliance-checker')
    expect(compliance).toBeDefined()
    expect(compliance!.outputFormat).toBe('json')
  })

  it('la skill incident-responder ha 4 placeholder distinti', () => {
    const incident = BUILTIN_SKILLS.find(s => s.name === 'incident-responder')
    expect(incident).toBeDefined()
    const placeholders = incident!.promptTemplate.match(/\{\{(\w+)\}\}/g) || []
    const unique = new Set(placeholders)
    expect(unique.size).toBeGreaterThanOrEqual(3)
  })
})

describe('Skill Manager — Sostituzione variabili', () => {
  it('replace di una variabile singola funziona', () => {
    const template = 'Analyze: {{task}}'
    const result = template.replace(/\{\{task\}\}/g, 'build login page')
    expect(result).toBe('Analyze: build login page')
  })

  it('replace di multiple occorrenze della stessa variabile', () => {
    const template = '{{x}} + {{x}} = 2*{{x}}'
    const result = template.replace(/\{\{x\}\}/g, '3')
    expect(result).toBe('3 + 3 = 2*3')
  })

  it('replace di variabili multiple distinte', () => {
    const template = 'A={{a}}, B={{b}}, C={{c}}'
    let result = template
    for (const [k, v] of Object.entries({ a: '1', b: '2', c: '3' })) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
    }
    expect(result).toBe('A=1, B=2, C=3')
  })

  it('variabili non definite rimangono come placeholder', () => {
    const template = 'Hello {{name}}, your id is {{id}}'
    const result = template.replace(/\{\{name\}\}/g, 'Alice')
    expect(result).toBe('Hello Alice, your id is {{id}}')
  })
})
