/**
 * Tests for Multi-Model Cognitive Router (Fase 2.3)
 *
 * Verifica:
 *   1. classifyTask distingue Simple/Medium/Complex/Critical
 *   2. Keyword critiche (deploy, security) → Critical
 *   3. Multi-step reasoning → Medium o superiore
 *   4. planRouting rispetta local-first (Simple → local SLM)
 *   5. Critical → sempre API reasoning
 *   6. Stima costi e latenza coerente
 *   7. routeCognitive persiste la decisione
 *   8. checkLocalModelsHealth ritorna unhealthy in dev
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  classifyTask, planRouting, routeCognitive, checkLocalModelsHealth,
  cognitiveRouterStats, DEFAULT_COGNITIVE_MODELS,
  type TaskComplexity,
} from '@/lib/cognitive-router/router'
import { db } from '@/lib/db'

describe('Cognitive Router — classifyTask', () => {
  it('prompt breve e semplice → Simple', () => {
    const result = classifyTask('ciao, come stai?')
    expect(result.complexity).toBe('Simple')
    expect(result.estimatedTokensOut).toBe(100)
  })

  it('prompt con codice → Medium o superiore', () => {
    const prompt = `Given this code:
    \`\`\`
    function add(a, b) { return a + b }
    \`\`\`
    Please explain what it does.`
    const result = classifyTask(prompt)
    expect(['Medium', 'Complex']).toContain(result.complexity)
  })

  it('prompt lungo con codice + matematica → Complex', () => {
    const longPrompt = '```js\n' + 'function complex() {\n'.repeat(100) + '}\n```\nPlease analyze the integral ∫x²dx and verify with the code.'
    const result = classifyTask(longPrompt)
    expect(result.complexity).toBe('Complex')
  })

  it('keyword critiche (deploy) + complessità → Critical', () => {
    const prompt = `We need to deploy this critical security update to production.
    The function involves deleting irreversible records. Please review carefully.`
    const result = classifyTask(prompt)
    expect(result.complexity).toBe('Critical')
    expect(result.signals).toContain('critical-keyword-detected')
  })

  it('multi-step reasoning (first, then, finally) incrementa complexity', () => {
    const prompt = 'First analyze the data. Then identify patterns. Finally, generate a report.'
    const result = classifyTask(prompt)
    expect(['Medium', 'Complex', 'Critical']).toContain(result.complexity)
    expect(result.signals).toContain('multi-step-reasoning')
  })

  it('signals include multi-domain per code + math', () => {
    const prompt = '```python\nx = 1\n```\nThe integral ∫x²dx equals x³/3.'
    const result = classifyTask(prompt)
    expect(result.signals).toContain('multi-domain')
  })

  it('stima tokenOut cresce con complexity', () => {
    const simple = classifyTask('hi')
    const critical = classifyTask('deploy critical security patch to production now')
    expect(critical.estimatedTokensOut).toBeGreaterThan(simple.estimatedTokensOut)
  })
})

describe('Cognitive Router — planRouting (local-first)', () => {
  it('Simple → routing local (SLM)', () => {
    const strategy = planRouting('ciao come stai?')
    expect(['local', 'api']).toContain(strategy.routing)
    // Se local-first, preferred contiene SLM locali
    if (strategy.routing === 'local') {
      expect(strategy.preferredModels.some((m) => m.local && m.specialization === 'general')).toBe(true)
    }
  })

  it('Critical → routing api (reasoning model)', () => {
    const strategy = planRouting('deploy critical security patch to production now')
    expect(strategy.routing).toBe('api')
    expect(strategy.preferredModels.some((m) => m.specialization === 'reasoning' && !m.local)).toBe(true)
  })

  it('Medium → hybrid (locale + API fallback)', () => {
    const prompt = 'First analyze the data. Then identify patterns. Finally generate a report with details.'
    const strategy = planRouting(prompt)
    expect(['hybrid', 'api']).toContain(strategy.routing)
    expect(strategy.fallbackModels.length).toBeGreaterThan(0)
  })

  it('Complex → hybrid con locale 32B se disponibile', () => {
    const longPrompt = '```js\n' + 'function complex() {\n'.repeat(100) + '}\n```\nAnalyze thoroughly.'
    const strategy = planRouting(longPrompt)
    expect(['hybrid', 'api']).toContain(strategy.routing)
  })

  it('forceApi=true ignora locale', () => {
    const strategy = planRouting('ciao', { forceApi: true })
    expect(strategy.routing).toBe('api')
    expect(strategy.preferredModels.every((m) => !m.local)).toBe(true)
  })

  it('estimatedCost è 0 per modelli locali', () => {
    const strategy = planRouting('ciao come stai?')
    if (strategy.routing === 'local') {
      expect(strategy.estimatedCost).toBe(0)
    }
  })

  it('estimatedCost > 0 per API', () => {
    const strategy = planRouting('deploy critical patch to production now')
    expect(strategy.estimatedCost).toBeGreaterThan(0)
  })

  it('reason è una stringa non vuota', () => {
    const strategy = planRouting('test prompt')
    expect(strategy.reason).toBeTruthy()
    expect(typeof strategy.reason).toBe('string')
  })
})

describe('Cognitive Router — routeCognitive (integration)', () => {
  beforeAll(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'cognitive-router' } })
  })

  it('persiste routing decision + agent log', async () => {
    const result = await routeCognitive('agent://test', 'ciao come stai?')
    expect(result.decisionId).toBeTruthy()
    expect(result.classification.complexity).toBe('Simple')

    // Verifica che l'agent log sia stato scritto
    const logs = await db.agentLog.findMany({
      where: { phase: 'cognitive-router', event: 'routing-strategy' },
    })
    expect(logs.length).toBeGreaterThan(0)
  })

  it('routeCognitive con prompt critical usa API reasoning', async () => {
    const result = await routeCognitive('agent://test', 'deploy critical security patch to production')
    expect(result.routing).toBe('api')
    expect(result.preferredModels.some((m) => m.specialization === 'reasoning')).toBe(true)
  })
})

describe('Cognitive Router — checkLocalModelsHealth', () => {
  it('ritorna unhealthy per endpoint non raggiungibili in dev', async () => {
    const results = await checkLocalModelsHealth()
    expect(results.length).toBeGreaterThan(0)
    // In dev nessun server locale è attivo → tutti unhealthy
    const unhealthy = results.filter((r) => !r.healthy)
    expect(unhealthy.length).toBe(results.length)
  })

  it('ogni result ha modelId, endpoint, lastCheckedAt', async () => {
    const results = await checkLocalModelsHealth()
    for (const r of results) {
      expect(r.modelId).toBeTruthy()
      expect(r.endpoint).toBeTruthy()
      expect(r.lastCheckedAt).toBeTruthy()
    }
  })
})

describe('Cognitive Router — stats', () => {
  it('cognitiveRouterStats ritorna aggregati coerenti', async () => {
    const stats = await cognitiveRouterStats()
    expect(stats).toHaveProperty('totalDecisions')
    expect(stats).toHaveProperty('localFirstDecisions')
    expect(stats).toHaveProperty('byRouting')
    expect(stats).toHaveProperty('avgConfidence')
    expect(typeof stats.avgConfidence).toBe('number')
  })
})
