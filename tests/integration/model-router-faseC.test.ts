/**
 * Integration tests for Model Router Fase C
 * (G1, G2, G3, G4)
 *
 * G1 — Unit test per scoreModels/route lifecycle/getOrCreateConfig/updateConfig/simulateModelOutput
 * G2 — phase14.tsx a11y (aria-label, role=status)
 * G3 — parse-safe verification (assorbito in B2 Fase B)
 * G4 — routerStats con metriche derivate (ensembleRate, avgConfidence, avgMargin)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'mr-faseC-'

async function cleanupFixtures() {
  await db.routingDecision.deleteMany({ where: { agentId: { startsWith: 'mr-faseC-' } } })
  await db.routerConfig.deleteMany({})
  await db.agentLog.deleteMany({ where: { agentId: 'router' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G1: route lifecycle + scoreModels + getOrCreateConfig ============

describe('Fase C — G1: route lifecycle (scoreModels + dedup + llmError)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('route con prompt code → domain code, primaryModel con specialization code', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-code', '```js\nfunction test() { return 42; }\n```')
    expect(result.decisionId).toBeTruthy()
    expect(result.primaryModel).toBeTruthy()
    // Verifica che la decisione ha domain 'code' nelle features
    const decision = await db.routingDecision.findUnique({ where: { id: result.decisionId } })
    expect(decision).not.toBeNull()
    const features = JSON.parse(decision!.inputFeatures)
    expect(features.domain).toBe('code')
    expect(features.hasCode).toBe(true)
  })

  it('route con prompt math → domain math', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-math', 'Solve the integral ∫ x dx and prove the theorem')
    const decision = await db.routingDecision.findUnique({ where: { id: result.decisionId } })
    const features = JSON.parse(decision!.inputFeatures)
    expect(features.hasMath).toBe(true)
    expect(features.domain).toBe('math')
  })

  it('route con prompt logic → domain logic', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-logic', 'If forall x exists y such that x implies y, then...')
    const decision = await db.routingDecision.findUnique({ where: { id: result.decisionId } })
    const features = JSON.parse(decision!.inputFeatures)
    expect(features.hasLogic).toBe(true)
    expect(features.domain).toBe('logic')
  })

  it('route N5 dedup: stesso prompt → cached result', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const prompt = 'SC-FASEC dedup test prompt unique-12345'
    const r1 = await route('mr-faseC-dedup', prompt)
    const r2 = await route('mr-faseC-dedup', prompt)
    // N5: secondo route deve ritornare cached decision (stesso decisionId)
    expect(r2.cached).toBe(true)
    expect(r2.decisionId).toBe(r1.decisionId)
  })

  it('route N4: llmError null se successo, fallback se fallito', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-llm', 'simple test prompt')
    // llmError deve essere null (success) o string (failure)
    expect(result.llmError === null || typeof result.llmError === 'string').toBe(true)
    // finalOutput deve avere contenuto (LLM o fallback)
    expect(result.finalOutput).toBeTruthy()
    expect(result.finalOutput!.length).toBeGreaterThan(0)
  })

  it('route ritorna confidence e margin in [0, 1]', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-range', 'test prompt for range check')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.margin).toBeGreaterThanOrEqual(0)
    expect(result.margin).toBeLessThanOrEqual(1)
  })

  it('route ritorna diversity in [0, 1]', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-div', 'test prompt for diversity')
    expect(result.diversity).toBeGreaterThanOrEqual(0)
    expect(result.diversity).toBeLessThanOrEqual(1)
  })

  it('route routedTo è uno di primary/ensemble/critic', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-routed', 'test prompt for routing')
    expect(['primary', 'ensemble', 'critic']).toContain(result.routedTo)
  })
})

// === G1: getOrCreateConfig + updateConfig ============================

describe('Fase C — G1: getOrCreateConfig defaults + updateConfig upsert', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('getOrCreateConfig crea config con default values', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    // La prima route crea la config automaticamente
    await route('mr-faseC-config', 'test for config creation')
    const config = await db.routerConfig.findFirst()
    expect(config).not.toBeNull()
    expect(config!.marginThreshold).toBe(0.2)
    expect(config!.diversityThreshold).toBe(0.3)
    expect(config!.minConfidence).toBe(0.6)
    expect(config!.enableEnsemble).toBe(true)
    expect(config!.enableCritic).toBe(true)
  })

  it('updateConfig upsert: aggiorna config esistente', async () => {
    const { updateConfig, route } = await import('@/lib/kernel/time-router')
    // Crea config via route
    await route('mr-faseC-upsert', 'test for upsert')
    // Aggiorna
    const config = await updateConfig({ marginThreshold: 0.35, minConfidence: 0.75 })
    expect(config.marginThreshold).toBe(0.35)
    expect(config.minConfidence).toBe(0.75)
    // Verifica che è un update, non un nuovo record
    const allConfigs = await db.routerConfig.findMany()
    expect(allConfigs.length).toBe(1)
  })

  it('updateConfig upsert: crea config se non esiste', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    const config = await updateConfig({ marginThreshold: 0.4 })
    expect(config).not.toBeNull()
    expect(config.marginThreshold).toBe(0.4)
  })

  it('updateConfig non sovrascrive campi non specificati', async () => {
    const { updateConfig, route } = await import('@/lib/kernel/time-router')
    await route('mr-faseC-partial', 'test for partial update')
    await updateConfig({ marginThreshold: 0.5 })
    const config = await db.routerConfig.findFirst()
    expect(config!.marginThreshold).toBe(0.5)  // aggiornato
    expect(config!.diversityThreshold).toBe(0.3)  // non sovrascritto (default)
  })
})

// === G1: simulateModelOutput fallback format ==========================

describe('Fase C — G1: simulateModelOutput fallback format', () => {
  it('time-router.ts ha simulateModelOutput function', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/function simulateModelOutput/)
    expect(content).toMatch(/Output per dominio/)
  })

  it('route con LLM failure produce fallback con modelId e domain', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    // Se LLM fallisce (test env), il fallback contiene [modelId] e dominio
    const result = await route('mr-faseC-fallback', '```js\nfunction test() {}\n```')
    if (result.llmError) {
      // LLM failed → fallback
      expect(result.finalOutput).toMatch(/\[/)  // [modelId] format
      expect(result.finalOutput).toMatch(/dominio/)
    }
  })
})

// === G4: routerStats metriche derivate ================================

describe('Fase C — G4: routerStats metriche derivate', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('routerStats ritorna tutte le 9 metriche (6 originali + 3 G4)', async () => {
    const { routerStats } = await import('@/lib/kernel/time-router')
    const stats = await routerStats()
    // 6 originali
    expect(stats).toHaveProperty('decisions')
    expect(stats).toHaveProperty('ensemble')
    expect(stats).toHaveProperty('critic')
    expect(stats).toHaveProperty('primary')
    expect(stats).toHaveProperty('topModel')
    expect(stats).toHaveProperty('topModelPct')
    // 3 G4
    expect(stats).toHaveProperty('ensembleRate')
    expect(stats).toHaveProperty('avgConfidence')
    expect(stats).toHaveProperty('avgMargin')
  })

  it('routerStats ensembleRate = (ensemble + critic) / decisions', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    await route('mr-faseC-rate', 'test for ensemble rate')
    const stats = await routerStats()
    const nonPrimary = stats.ensemble + stats.critic
    if (stats.decisions > 0) {
      expect(stats.ensembleRate).toBeCloseTo(nonPrimary / stats.decisions, 5)
    }
    expect(stats.ensembleRate).toBeGreaterThanOrEqual(0)
    expect(stats.ensembleRate).toBeLessThanOrEqual(1)
  })

  it('routerStats avgConfidence è numerico in [0, 1]', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    await route('mr-faseC-conf', 'test for avg confidence')
    const stats = await routerStats()
    expect(typeof stats.avgConfidence).toBe('number')
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0)
    expect(stats.avgConfidence).toBeLessThanOrEqual(1)
  })

  it('routerStats avgMargin è numerico in [0, 1]', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    await route('mr-faseC-margin', 'test for avg margin')
    const stats = await routerStats()
    expect(typeof stats.avgMargin).toBe('number')
    expect(stats.avgMargin).toBeGreaterThanOrEqual(0)
    expect(stats.avgMargin).toBeLessThanOrEqual(1)
  })

  it('time-router.ts ha G4 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G4 fix[\s\S]*metriche derivate aggiuntive/)
    expect(content).toMatch(/ensembleRate[\s\S]*ensemble \+ critic/)
    expect(content).toMatch(/avgConfidence: media confidence/)
    expect(content).toMatch(/avgMargin: media margin/)
  })
})

// === G2: phase14.tsx a11y =============================================

describe('Fase C — G2: phase14.tsx a11y', () => {
  it('phase14.tsx ha aria-label su button Aggiorna', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna dati Model Router"/)
  })

  it('phase14.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Model Router"/)
  })

  it('phase14.tsx ha aria-label su button Route', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Route prompt al modello ottimale/)
  })

  it('phase14.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })

  it('phase14.tsx stats grid ha 8 stat card (5 originali + 3 G4)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    // G4: nuove stat card
    expect(content).toMatch(/label="Ensemble rate"/)
    expect(content).toMatch(/label="Avg confidence"/)
    expect(content).toMatch(/label="Avg margin"/)
  })
})

// === G3: parse-safe verification (assorbito in B2) ====================

describe('Fase C — G3: parse-safe verification (assorbito in B2)', () => {
  it('phase14.tsx ha route try/catch interno su r.json() (B2/G3)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase14\] route: response not JSON/)
  })

  it('phase14.tsx ha features try/catch interno su r.json() (B2/G3)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[phase14\] features: response not JSON/)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1+G4: route lifecycle + stats con 9 metriche coerenti', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseC-smoke', '```js\nfunction sort(arr) { return arr.sort(); }\n```')
    expect(result.decisionId).toBeTruthy()
    expect(result.primaryModel).toBeTruthy()
    expect(['primary', 'ensemble', 'critic']).toContain(result.routedTo)

    const stats = await routerStats()
    expect(stats.decisions).toBeGreaterThanOrEqual(1)
    // G4 metriche
    expect(stats.ensembleRate).toBeGreaterThanOrEqual(0)
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0)
    expect(stats.avgMargin).toBeGreaterThanOrEqual(0)
  })

  it('G2+G3: phase14.tsx ha a11y + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase14.tsx'),
      'utf-8',
    )
    // G2: a11y
    expect(content).toMatch(/aria-label="Aggiorna dati Model Router"/)
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Route prompt al modello ottimale/)
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
    // G2: 8 stat card
    expect(content).toMatch(/label="Ensemble rate"/)
    expect(content).toMatch(/label="Avg confidence"/)
    expect(content).toMatch(/label="Avg margin"/)
    // G3: parse-safe (B2)
    expect(content).toMatch(/\[phase14\] route: response not JSON/)
    expect(content).toMatch(/\[phase14\] features: response not JSON/)
  })

  it('G4: stats ritorna 9 metriche tutte numeriche', async () => {
    const { route, routerStats } = await import('@/lib/kernel/time-router')
    await route('mr-faseC-numeric', 'test for numeric metrics')
    const stats = await routerStats()

    const numericKeys = ['decisions', 'ensemble', 'critic', 'primary',
                         'topModelPct', 'ensembleRate', 'avgConfidence', 'avgMargin']
    for (const key of numericKeys) {
      expect(stats).toHaveProperty(key)
      expect(typeof (stats as any)[key]).toBe('number')
      expect((stats as any)[key]).toBeGreaterThanOrEqual(0)
    }
    // topModel è string
    expect(typeof stats.topModel).toBe('string')
    // Coerenza: rate in [0, 1], confidence/margin in [0, 1]
    expect(stats.ensembleRate).toBeLessThanOrEqual(1)
    expect(stats.avgConfidence).toBeLessThanOrEqual(1)
    expect(stats.avgMargin).toBeLessThanOrEqual(1)
  })
})
