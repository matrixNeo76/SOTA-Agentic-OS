/**
 * Integration tests for Model Router Fase B
 * (B1, B2, B3, B4, B6)
 *
 * B1 — phase14.tsx refresh() con try/catch + toast.error
 * B2 — phase14.tsx route()/features parse-safe su r.json()
 * B3 — routerStats: tutte le query in Promise.all (1 round-trip DB)
 * B4 — route() retry logic su LLM failure (max 2 retry con backoff)
 * B6 — extractFeatures size cap su prompt (100KB max, tronca prima di regex)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'mr-faseB-'

async function cleanupFixtures() {
  await db.routingDecision.deleteMany({ where: { agentId: { startsWith: 'mr-faseB-' } } })
  await db.routerConfig.deleteMany({})
  await db.agentLog.deleteMany({ where: { agentId: 'router' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B3: routerStats con tutte le query in Promise.all ================

describe('Fase B — B3: routerStats con 5 query in Promise.all', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('routerStats ritorna tutte le 6 metriche', async () => {
    const { routerStats } = await import('@/lib/kernel/time-router')
    const stats = await routerStats()
    expect(stats).toHaveProperty('decisions')
    expect(stats).toHaveProperty('ensemble')
    expect(stats).toHaveProperty('critic')
    expect(stats).toHaveProperty('primary')
    expect(stats).toHaveProperty('topModel')
    expect(stats).toHaveProperty('topModelPct')
    for (const key of ['decisions', 'ensemble', 'critic', 'primary']) {
      expect(typeof (stats as any)[key]).toBe('number')
    }
  })

  it('time-router.ts ha B3 fix (single Promise.all)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B3 fix[\s\S]*tutte le query in Promise\.all/)
  })

  it('routerStats non ha più query sequenziali dopo il Promise.all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    const statsMatch = content.match(/export async function routerStats\(\)[\s\S]*?\n\}/)
    expect(statsMatch).not.toBeNull()
    const statsBody = statsMatch![0]
    // Conta solo le chiamate Promise.all attive (non nei commenti)
    const activeLines = statsBody.split('\n').filter(line =>
      !line.trim().startsWith('//') && !line.trim().startsWith('*')
    )
    const activePromiseAll = activeLines.filter(line => line.includes('Promise.all')).length
    expect(activePromiseAll).toBe(1)
    // Dopo il Promise.all (]), non devono esserci altri await db.*
    const afterPromiseAll = statsBody.split(']')[1] || ''
    expect(afterPromiseAll).not.toMatch(/await db\.\w+\.(findMany|count)/)
  })

  it('routerStats riflette nuove decisioni', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    const before = await routerStats()
    await route('mr-faseB-stats', 'test prompt for stats')
    const after = await routerStats()
    expect(after.decisions).toBeGreaterThan(before.decisions)
  })
})

// === B4: route() retry logic =========================================

describe('Fase B — B4: route() retry logic su LLM failure', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('time-router.ts ha B4 fix (retry logic)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B4 fix[\s\S]*retry logic su LLM failure/)
    expect(content).toMatch(/MAX_LLM_RETRIES = 2/)
    expect(content).toMatch(/for \(let attempt = 1; attempt <= maxAttempts; attempt\+\+\)/)
  })

  it('time-router.ts ha backoff esponenziale tra tentativi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/await new Promise\(\(r\) => setTimeout\(r, 100 \* attempt\)\)/)
    expect(content).toMatch(/console\.warn\(`\[time-router\] LLM attempt/)
  })

  it('route() non crasha se LLM fallisce (fallback deterministico)', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    // Anche se LLM fallisce (no API key in test env), il fallback genera output
    const result = await route('mr-faseB-fallback', 'test fallback prompt')
    expect(result.decisionId).toBeTruthy()
    expect(result.finalOutput).toBeTruthy()
    // llmError può essere non-null se LLM fallisce, ma finalOutput deve avere il fallback
    expect(result.finalOutput!.length).toBeGreaterThan(0)
  })

  it('route() ritorna llmError null se LLM successo', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseB-success', 'simple test')
    // Se LLM disponibile, llmError deve essere null
    // Se LLM non disponibile (test env), llmError può essere non-null
    if (result.llmError === null) {
      expect(result.finalOutput).toBeTruthy()
      expect(result.finalOutput).not.toMatch(/^\[.*\] Output per dominio/) // non è fallback
    }
  })
})

// === B6: extractFeatures size cap ===================================

describe('Fase B — B6: extractFeatures size cap su prompt', () => {
  it('time-router.ts ha B6 fix (MAX_PROMPT_SIZE)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B6 fix[\s\S]*size cap su prompt prima di regex/)
    expect(content).toMatch(/MAX_PROMPT_SIZE = 100_000/)
  })

  it('extractFeatures tronca prompt > 100KB prima di regex', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/safePrompt = prompt\.length > MAX_PROMPT_SIZE/)
    expect(content).toMatch(/prompt\.slice\(0, MAX_PROMPT_SIZE\)/)
  })

  it('extractFeatures con prompt piccolo → non troncato', async () => {
    const { extractFeatures } = await import('@/lib/kernel/time-router')
    const features = extractFeatures('small test prompt')
    expect(features.length).toBe(17)  // length originale
    expect(features.tokenEstimate).toBe(5)
  })

  it('extractFeatures con prompt enorme (> 100KB) → non crasha', async () => {
    const { extractFeatures } = await import('@/lib/kernel/time-router')
    const hugePrompt = 'x'.repeat(150_000)  // 150KB > 100KB limit
    const features = extractFeatures(hugePrompt)
    // Non deve crashare (ReDoS prevention)
    expect(features).toBeDefined()
    expect(features.length).toBe(150_000)  // length originale riportata
    expect(features.tokenEstimate).toBe(37_500)
    // complexity deve essere capped a 0.3 (lunghezza max contribution)
    expect(features.complexity).toBeLessThanOrEqual(0.35)  // 0.3 lunghezza + 0.05 tokenEstimate
  })

  it('extractFeatures con prompt enorme con code markers → hasCode rilevato', async () => {
    const { extractFeatures } = await import('@/lib/kernel/time-router')
    // Prompt con code marker nei primi 100KB
    const hugePrompt = '```js\nfunction test() { return 42; }\n```\n' + 'x'.repeat(150_000)
    const features = extractFeatures(hugePrompt)
    expect(features.hasCode).toBe(true)
    expect(features.domain).toBe('code')
  })
})

// === B1: phase14.tsx refresh() con try/catch ========================

describe('Fase B — B1: phase14.tsx refresh() con try/catch', () => {
  it('phase14.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B1 fix[\s\S]*try\/catch[\s\S]*refresh/)
    expect(content).toMatch(/toast\.error\('Caricamento Model Router fallito'\)/)
    expect(content).toMatch(/console\.error\('\[phase14\] refresh failed:'/)
  })

  it('phase14.tsx refresh non cancella stato su errore', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    const catchIdx = content.indexOf("} catch (err) {")
    expect(catchIdx).toBeGreaterThan(0)
    const catchSnippet = content.slice(catchIdx, catchIdx + 400)
    expect(catchSnippet).toMatch(/toast\.error\('Caricamento Model Router fallito'\)/)
    expect(catchSnippet).not.toMatch(/setDecisions\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setStats\(null\)/)
  })
})

// === B2: phase14.tsx route()/features parse-safe =====================

describe('Fase B — B2: phase14.tsx route()/features parse-safe', () => {
  it('phase14.tsx ha B2 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*parse-safe \+ error handling/)
  })

  it('phase14.tsx route ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase14\] route: response not JSON/)
  })

  it('phase14.tsx features ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase14\] features: response not JSON/)
  })

  it('phase14.tsx ha toast.error su risposta non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/toast\.error\(`Risposta non valida dal server \(status \$\{r\.status\}\)`\)/)
  })

  it('phase14.tsx ha toast.error su !d.ok (prima era silente)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/toast\.error\(d\.error \|\| 'Errore routing'\)/)
  })

  it('phase14.tsx ha catch esterno per network error', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/Route failed: \$\{e\.message\}/)
  })

  it('phase14.tsx ha 2 fallback a r.text() (route + features)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    const textFallbackCount = (content.match(/await r\.text\(\)\.catch\(\(\) => '<no body>'\)/g) || []).length
    expect(textFallbackCount).toBe(2)  // route + features
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B4+B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('B3+B4: route lifecycle + stats coerenti (con retry+fallback)', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseB-smoke', 'Write a function to sort an array')
    expect(result.decisionId).toBeTruthy()
    expect(result.primaryModel).toBeTruthy()

    const stats = await routerStats()
    expect(stats.decisions).toBeGreaterThanOrEqual(1)
    // topModel deve essere una stringa (anche se 'none' se no decisions)
    expect(typeof stats.topModel).toBe('string')
  })

  it('B6 smoke: extractFeatures con prompt enorme non crasha', async () => {
    const { extractFeatures } = await import('@/lib/kernel/time-router')
    const hugePrompt = 'x'.repeat(200_000)
    const features = extractFeatures(hugePrompt)
    expect(features).toBeDefined()
    expect(features.length).toBe(200_000)
    expect(features.complexity).toBeLessThanOrEqual(1)
  })

  it('B1+B2 smoke: phase14.tsx ha try/catch su refresh + parse-safe', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    // B1: refresh con try/catch
    expect(content).toMatch(/toast\.error\('Caricamento Model Router fallito'\)/)
    // B2: route + features parse-safe
    expect(content).toMatch(/\[phase14\] route: response not JSON/)
    expect(content).toMatch(/\[phase14\] features: response not JSON/)
    expect(content).toMatch(/toast\.error\(d\.error \|\| 'Errore routing'\)/)
  })
})
