/**
 * Test: Sector Presets
 * Track 2.4 — Verifica che i 5 preset siano definiti correttamente
 */
import { describe, it, expect } from 'vitest'
import { PRESET_DEFINITIONS } from '@/lib/kernel/sector-presets'

describe('Sector Presets', () => {
  it('should have 5 preset definitions', () => {
    expect(PRESET_DEFINITIONS).toHaveLength(5)
  })

  it('should have all required preset names', () => {
    const names = PRESET_DEFINITIONS.map(p => p.name)
    expect(names).toContain('fintech')
    expect(names).toContain('healthcare')
    expect(names).toContain('dev-tools')
    expect(names).toContain('research')
    expect(names).toContain('generic')
  })

  it('each preset should have required fields', () => {
    for (const preset of PRESET_DEFINITIONS) {
      expect(preset.name).toBeTruthy()
      expect(preset.displayName).toBeTruthy()
      expect(preset.description).toBeTruthy()
      expect(preset.complianceRules).toBeInstanceOf(Array)
      expect(preset.complianceRules.length).toBeGreaterThan(0)
      expect(preset.ltlRules).toBeInstanceOf(Array)
      expect(preset.defaultTools).toBeInstanceOf(Array)
      expect(preset.heuristics).toBeInstanceOf(Array)
      expect(preset.uiConfig).toBeInstanceOf(Object)
    }
  })

  it('fintech preset should have PCI-DSS compliance', () => {
    const fintech = PRESET_DEFINITIONS.find(p => p.name === 'fintech')!
    expect(fintech.complianceRules).toContain('PCI-DSS')
    expect(fintech.complianceRules).toContain('MiFID II')
  })

  it('healthcare preset should have HIPAA compliance', () => {
    const healthcare = PRESET_DEFINITIONS.find(p => p.name === 'healthcare')!
    expect(healthcare.complianceRules).toContain('HIPAA')
  })

  it('each preset should have at least 1 LTL rule', () => {
    for (const preset of PRESET_DEFINITIONS) {
      expect(preset.ltlRules.length).toBeGreaterThanOrEqual(1)
      for (const rule of preset.ltlRules) {
        expect(rule.ruleId).toBeTruthy()
        expect(rule.formula).toBeTruthy()
        expect(rule.severity).toMatch(/^(block|warn|log)$/)
      }
    }
  })

  it('dev-tools preset should have github-integration tool', () => {
    const devTools = PRESET_DEFINITIONS.find(p => p.name === 'dev-tools')!
    const toolNames = devTools.defaultTools.map(t => t.toolId)
    expect(toolNames).toContain('github-integration')
  })

  it('each preset should have workflow steps in uiConfig', () => {
    for (const preset of PRESET_DEFINITIONS) {
      expect(preset.uiConfig.workflowSteps).toBeInstanceOf(Array)
      expect(preset.uiConfig.workflowSteps!.length).toBeGreaterThan(0)
    }
  })
})
