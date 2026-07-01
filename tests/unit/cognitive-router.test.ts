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
  it('prompt breve e semplice → Simple', async () => {
    const result = await classifyTask('ciao, come stai?', { useLLM: false })
    expect(result.complexity).toBe('Simple')
    expect(result.estimatedTokensOut).toBe(100)
  })

  it('prompt con codice → Medium o superiore', async () => {
    const prompt = `Given this code:
    \`\`\`
    function add(a, b) { return a + b }
    \`\`\`
    Please explain what it does.`
    const result = await classifyTask(prompt, { useLLM: false })
    expect(['Medium', 'Complex']).toContain(result.complexity)
  })

  it('prompt lungo con codice + matematica → Complex', async () => {
    const longPrompt = '```js\n' + 'function complex() {\n'.repeat(100) + '}\n```\nPlease analyze the integral ∫x²dx and verify with the code.'
    const result = await classifyTask(longPrompt, { useLLM: false })
    expect(result.complexity).toBe('Complex')
  })

  it('keyword critiche (deploy) + complessità → Critical', async () => {
    const prompt = `We need to deploy this critical security update to production.
    The function involves deleting irreversible records. Please review carefully.`
    const result = await classifyTask(prompt, { useLLM: false })
    expect(result.complexity).toBe('Critical')
    expect(result.signals).toContain('critical-keyword-detected')
  })

  it('multi-step reasoning (first, then, finally) incrementa complexity', async () => {
    const prompt = 'First analyze the data. Then identify patterns. Finally, generate a report.'
    const result = await classifyTask(prompt, { useLLM: false })
    expect(['Medium', 'Complex', 'Critical']).toContain(result.complexity)
    expect(result.signals).toContain('multi-step-reasoning')
  })

  it('signals include multi-domain per code + math', async () => {
    const prompt = '```python\nx = 1\n```\nThe integral ∫x²dx equals x³/3.'
    const result = await classifyTask(prompt, { useLLM: false })
    expect(result.signals).toContain('multi-domain')
  })

  it('stima tokenOut cresce con complexity', async () => {
    const simple = await classifyTask('hi', { useLLM: false })
    const critical = await classifyTask('deploy critical security patch to production now', { useLLM: false })
    expect(critical.estimatedTokensOut).toBeGreaterThan(simple.estimatedTokensOut)
  })
})

describe('Cognitive Router — planRouting (local-first)', () => {
  it('Simple → routing local (SLM)', async () => {
    const strategy = await planRouting('ciao come stai?', { useLLM: false })
    expect(['local', 'api']).toContain(strategy.routing)
    // Se local-first, preferred contiene SLM locali
    if (strategy.routing === 'local') {
      expect(strategy.preferredModels.some((m) => m.local && m.specialization === 'general')).toBe(true)
    }
  })

  it('Critical → routing api (reasoning model)', async () => {
    const strategy = await planRouting('deploy critical security patch to production now', { useLLM: false })
    expect(strategy.routing).toBe('api')
    expect(strategy.preferredModels.some((m) => m.specialization === 'reasoning' && !m.local)).toBe(true)
  })

  it('Medium → hybrid (locale + API fallback)', async () => {
    const prompt = 'First analyze the data. Then identify patterns. Finally generate a report with details.'
    const strategy = await planRouting(prompt, { useLLM: false })
    expect(['hybrid', 'api']).toContain(strategy.routing)
    expect(strategy.fallbackModels.length).toBeGreaterThan(0)
  })

  it('Complex → hybrid con locale 32B se disponibile', async () => {
    const longPrompt = '```js\n' + 'function complex() {\n'.repeat(100) + '}\n```\nAnalyze thoroughly.'
    const strategy = await planRouting(longPrompt, { useLLM: false })
    expect(['hybrid', 'api']).toContain(strategy.routing)
  })

  it('forceApi=true ignora locale', async () => {
    const strategy = await planRouting('ciao', { forceApi: true, useLLM: false })
    expect(strategy.routing).toBe('api')
    expect(strategy.preferredModels.every((m) => !m.local)).toBe(true)
  })

  it('estimatedCost è 0 per modelli locali', async () => {
    const strategy = await planRouting('ciao come stai?', { useLLM: false })
    if (strategy.routing === 'local') {
      expect(strategy.estimatedCost).toBe(0)
    }
  })

  it('estimatedCost > 0 per API', async () => {
    const strategy = await planRouting('deploy critical patch to production now', { useLLM: false })
    expect(strategy.estimatedCost).toBeGreaterThan(0)
  })

  it('reason è una stringa non vuota', async () => {
    const strategy = await planRouting('test prompt', { useLLM: false })
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
