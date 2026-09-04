/**
 * Integration tests for Model Router Fase A
 * (C1, C2, C3)
 *
 * C1 — route() result applicato al react-loop (model: routedModel.modelId)
 * C2 — Size cap su finalOutput/inputFeatures/ensembleModels (DB bloat prevention)
 * C3 — updateConfig valida range (0..1 per thresholds, boolean per enables)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'mr-faseA-'

async function cleanupFixtures() {
  await db.routingDecision.deleteMany({ where: { agentId: { startsWith: 'mr-faseA-' } } })
  await db.routerConfig.deleteMany({})
  await db.agentLog.deleteMany({ where: { agentId: 'router' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C2: Size cap su payload persistito ===============================

describe('Fase A — C2: size cap su finalOutput/inputFeatures/ensembleModels', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('time-router.ts ha costanti di size cap C2', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*size cap su payload/)
    expect(content).toMatch(/MAX_FINAL_OUTPUT_SIZE = 50_000/)
    expect(content).toMatch(/MAX_INPUT_FEATURES_SIZE = 10_000/)
    expect(content).toMatch(/MAX_ENSEMBLE_MODELS_SIZE = 2_000/)
    expect(content).toMatch(/truncateWithMarker/)
  })

  it('time-router.ts applica truncateWithMarker su finalOutput prima di persistere', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/cappedOutput = truncateWithMarker\(outputForCaller/)
    expect(content).toMatch(/cappedFeatures = truncateWithMarker\(JSON\.stringify\(features\)/)
    expect(content).toMatch(/cappedEnsemble = ensembleModels \? truncateWithMarker/)
  })

  it('route() persiste decision con finalOutput capped', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseA-cap-test', 'simple test prompt for cap')
    expect(result.decisionId).toBeTruthy()

    const decision = await db.routingDecision.findUnique({ where: { id: result.decisionId } })
    expect(decision).not.toBeNull()
    // finalOutput deve essere ≤ 50KB + marker
    expect(decision!.finalOutput!.length).toBeLessThanOrEqual(50_000 + 50)
    // inputFeatures deve essere ≤ 10KB
    expect(decision!.inputFeatures.length).toBeLessThanOrEqual(10_000 + 50)
  })
})

// === C3: updateConfig valida range ===================================

describe('Fase A — C3: updateConfig valida range', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('time-router.ts ha C3 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/time-router.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix[\s\S]*validazione range dei valori/)
    expect(content).toMatch(/marginThreshold must be a number in \[0, 1\]/)
    expect(content).toMatch(/enableEnsemble must be a boolean/)
  })

  it('updateConfig con marginThreshold > 1.0 → throws', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    try {
      await updateConfig({ marginThreshold: 1.5 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/marginThreshold must be a number in \[0, 1\]/)
    }
  })

  it('updateConfig con marginThreshold negativo → throws', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    try {
      await updateConfig({ marginThreshold: -0.1 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/marginThreshold must be a number in \[0, 1\]/)
    }
  })

  it('updateConfig con diversityThreshold > 1.0 → throws', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    try {
      await updateConfig({ diversityThreshold: 2.0 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/diversityThreshold must be a number in \[0, 1\]/)
    }
  })

  it('updateConfig con minConfidence > 1.0 → throws', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    try {
      await updateConfig({ minConfidence: 5.0 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/minConfidence must be a number in \[0, 1\]/)
    }
  })

  it('updateConfig con enableEnsemble stringa → throws', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    try {
      await updateConfig({ enableEnsemble: 'yes' as any })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/enableEnsemble must be a boolean/)
    }
  })

  it('updateConfig con enableCritic numerico → throws', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    try {
      await updateConfig({ enableCritic: 1 as any })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/enableCritic must be a boolean/)
    }
  })

  it('updateConfig con valori validi → ok (no throw)', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    const config = await updateConfig({
      marginThreshold: 0.3,
      diversityThreshold: 0.4,
      minConfidence: 0.7,
      enableEnsemble: true,
      enableCritic: false,
    })
    expect(config).toBeDefined()
    expect(config.marginThreshold).toBe(0.3)
    expect(config.enableEnsemble).toBe(true)
    expect(config.enableCritic).toBe(false)
  })

  it('updateConfig con valori ai boundary (0 e 1) → ok', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    const config = await updateConfig({
      marginThreshold: 0,
      diversityThreshold: 1,
      minConfidence: 0,
    })
    expect(config.marginThreshold).toBe(0)
    expect(config.diversityThreshold).toBe(1)
    expect(config.minConfidence).toBe(0)
  })
})

// === C1: route() result applicato al react-loop =========================

describe('Fase A — C1: route() result applicato al react-loop', () => {
  it('react-loop.ts ha modelId in ReActOptions', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*Model Router audit Fase A[\s\S]*Model ID dal TimeRouter/)
    expect(content).toMatch(/modelId\?: string/)
  })

  it('react-loop.ts usa options.modelId in zai.chat.completions.create', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    // C1: deve esserci almeno 2 occorrenze di options.modelId (ReAct loop + fallback)
    const modelIdUsageCount = (content.match(/options\.modelId/g) || []).length
    expect(modelIdUsageCount).toBeGreaterThanOrEqual(2)
    // Verifica che il model param è passato condizionalmente
    expect(content).toMatch(/\.\.\.\(options\.modelId && \{ model: options\.modelId \}\)/)
  })

  it('executor.ts passa modelId da steeringResult.routedModel al react-loop', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*Model Router audit Fase A[\s\S]*passa modelId dal TimeRouter/)
    expect(content).toMatch(/modelId: steeringResult\.routedModel\?\.modelId/)
  })

  it('acts.ts getRoutedModel ritorna modelId dal route() result', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/acts.ts'),
      'utf-8',
    )
    // getRoutedModel deve ritornare modelId dal route() result
    expect(content).toMatch(/getRoutedModel[\s\S]*route\(agentId, prompt\)[\s\S]*modelId: result\.primaryModel/)
  })

  it('route() ritorna primaryModel nel result', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseA-route-test', 'test prompt for route')
    expect(result.primaryModel).toBeTruthy()
    expect(result.decisionId).toBeTruthy()
    expect(typeof result.primaryModel).toBe('string')
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('C1+C2: route lifecycle con size cap + modelId nel result', async () => {
    const { route } = await import('@/lib/kernel/time-router')
    const result = await route('mr-faseA-smoke', 'Write a function to sort an array')
    expect(result.decisionId).toBeTruthy()
    expect(result.primaryModel).toBeTruthy()
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)

    // C2: finalOutput nel DB deve essere capped
    const decision = await db.routingDecision.findUnique({ where: { id: result.decisionId } })
    expect(decision).not.toBeNull()
    expect(decision!.finalOutput!.length).toBeLessThanOrEqual(50_000 + 50)
    expect(decision!.inputFeatures.length).toBeLessThanOrEqual(10_000 + 50)
  })

  it('C3 smoke: updateConfig rifiuta valori fuori range ma accetta validi', async () => {
    const { updateConfig } = await import('@/lib/kernel/time-router')
    // Valori fuori range → throw
    try {
      await updateConfig({ minConfidence: 2.0 })
      expect.fail('Should throw')
    } catch (e: any) {
      expect(e.message).toMatch(/minConfidence/)
    }

    // Valori validi → ok
    const config = await updateConfig({
      marginThreshold: 0.25,
      diversityThreshold: 0.35,
      minConfidence: 0.65,
      enableEnsemble: true,
      enableCritic: false,
    })
    expect(config.marginThreshold).toBe(0.25)
    expect(config.enableCritic).toBe(false)
  })

  it('C1 smoke: react-loop ed executor hanno modelId integration', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const reactContent = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/react-loop.ts'),
      'utf-8',
    )
    const executorContent = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )

    // C1: react-loop ha modelId in ReActOptions + lo usa in zai.chat.completions.create
    expect(reactContent).toMatch(/modelId\?: string/)
    expect(reactContent).toMatch(/\.\.\.\(options\.modelId && \{ model: options\.modelId \}\)/)

    // C1: executor passa modelId dal steeringResult al react-loop
    expect(executorContent).toMatch(/modelId: steeringResult\.routedModel\?\.modelId/)
  })
})
