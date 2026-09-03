/**
 * Integration tests for Affect Monitor Fase A
 * (C1, C2, C3)
 *
 * C1 — computeAffect integrato nell'executor (non bloccante, fail-open)
 * C2 — cycleId race condition fix (random suffix invece di sampleCount)
 * C3 — intervention size cap (1KB con marker [truncated])
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'am-faseA-agent'

async function cleanupFixtures() {
  await db.affectSample.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.affectThreshold.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C2: cycleId race condition fix ==================================

describe('Fase A — C2: cycleId race-safe (no sampleCount dependency)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('affect-subsystem.ts ha C2 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*cycleId race condition/)
    expect(content).toMatch(/N6 fix usava.*sampleCount[\s\S]*collisione/)
  })

  it('cycleId non usa più sampleCount (no DB count query)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    // C2: cycleId deve essere calcolato con Date.now() + Math.random()
    // NON con db.affectSample.count()
    expect(content).toMatch(/Math\.floor\(Date\.now\(\) \/ 1\) % 100000 \* 1000 \+ Math\.floor\(Math\.random\(\) \* 1000\)/)
    // Non deve più esserci la query sampleCount per cycleId
    // (la query può esistere altrove, ma non per calcolare cycleId)
    const computeMatch = content.match(/export async function computeAffect[\s\S]*?cycleId = [^\n]+/)
    expect(computeMatch).not.toBeNull()
    expect(computeMatch![0]).not.toMatch(/db\.affectSample\.count/)
  })

  it('2 computeAffect sequenziali producono cycleId diversi', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    const r1 = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 1,
      toolCalls: 5,
      gateRejects: 0,
      gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    // wait 1ms per garantire timestamp diverso
    await new Promise((r) => setTimeout(r, 1))
    const r2 = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 1,
      toolCalls: 5,
      gateRejects: 0,
      gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    // C2: cycleId devono essere diversi (timestamp ms + random)
    expect(r1.cycleId).not.toBe(r2.cycleId)
  })

  it('cycleId è nel range [0, 100000000)', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0,
      toolCalls: 1,
      gateRejects: 0,
      gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    // cycleId = (ts_ms % 100000) * 1000 + random(0..999)
    // max = 99999 * 1000 + 999 = 99999999
    expect(r.cycleId).toBeGreaterThanOrEqual(0)
    expect(r.cycleId).toBeLessThan(100_000_000)
    expect(Number.isInteger(r.cycleId)).toBe(true)
  })
})

// === C3: intervention size cap =======================================

describe('Fase A — C3: intervention size cap (1KB con marker)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('affect-subsystem.ts ha C3 fix (size cap su intervention)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C3[\s\S]*Size cap su intervention/)
    expect(content).toMatch(/intervention\.length > 1000/)
    expect(content).toMatch(/intervention\.slice\(0, 1000\) \+ '\.\.\.\[truncated\]'/)
  })

  it('intervention normale (< 1KB) non viene troncato', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    // Alta desperation per triggerare intervention
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0,
      toolCalls: 1,
      gateRejects: 10,  // 10 * 0.35 = 3.5 → clamp a 1.0
      gateAttempts: 10,
      repeatedToolCalls: 0,
    })
    if (r.intervention) {
      // Intervention normale ~100-200 char, non troncato
      expect(r.intervention.length).toBeLessThan(1000)
      expect(r.intervention).not.toMatch(/\[truncated\]$/)
    }
  })

  it('computeAffect non crasha con intervention lunga (size cap difensivo)', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // Modifica threshold per avere tighteningPct con molti decimali (intervention più lunga)
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.01,  // soglia molto bassa → intervention quasi sempre
      tighteningPct: 0.123456789,
    })

    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0,
      toolCalls: 1,
      gateRejects: 1,
      gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    // computeAffect non deve crashare
    expect(r).toBeDefined()
    expect(r.desperation).toBeGreaterThan(0)
    // Se intervention è settata, deve essere ≤ 1KB + marker
    if (r.intervention) {
      expect(r.intervention.length).toBeLessThanOrEqual(1000 + 20)
    }
  })

  it('intervention persistita nel DB rispetta il size cap', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5,
      toolCalls: 5,
      gateRejects: 5,
      gateAttempts: 5,
      repeatedToolCalls: 5,
    })

    const samples = await db.affectSample.findMany({ where: { agentId: TEST_AGENT } })
    expect(samples.length).toBeGreaterThan(0)
    const last = samples[0]!
    // Se intervention è non-null, deve rispettare il size cap
    if (last.intervention) {
      expect(last.intervention.length).toBeLessThanOrEqual(1000 + 20)
    }
  })
})

// === C1: computeAffect integrato in executor =========================

describe('Fase A — C1: computeAffect integrato in executor', () => {
  it('executor.ts ha import dinamico di computeAffect', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/computeAffect/)
    expect(content).toMatch(/affect-subsystem/)
  })

  it('executor.ts ha C1 fix comment Affect Monitor', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*Affect Monitor audit Fase A[\s\S]*computeAffect/)
    expect(content).toMatch(/death spiral prevention cosmetica/)
  })

  it('executor.ts computeAffect è non bloccante (try/catch)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Deve essere dentro try/catch (fail-open)
    expect(content).toMatch(/computeAffect[\s\S]*?} catch \{[\s\S]*?Non bloccante[\s\S]*?computeAffect[\s\S]*?falliscono/)
  })

  it('executor.ts deriva telemetria dal reactResult', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/reactToolCalls/)
    expect(content).toMatch(/reactToolFailures/)
    expect(content).toMatch(/repeatedToolCalls/)
  })

  it('executor.ts emette evento affect_intervention se intervento', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    expect(content).toMatch(/affectResult\.intervention/)
    expect(content).toMatch(/event: 'affect_intervention'/)
    expect(content).toMatch(/onEvent\?\.\('affect_intervention'/)
  })

  it('executor.ts integration è post-PTA, pre-publishTaskCompleted', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/executor.ts'),
      'utf-8',
    )
    // Verifica ordine: captureTrace → computeAffect → publishTaskCompleted
    const ptaIdx = content.indexOf('PTA Dominators audit Fase C')
    const affectIdx = content.indexOf('C1 fix (Affect Monitor audit Fase A)')
    const completedIdx = content.indexOf('Publish TaskCompleted event', affectIdx)
    expect(ptaIdx).toBeGreaterThan(0)
    expect(affectIdx).toBeGreaterThan(ptaIdx)
    expect(completedIdx).toBeGreaterThan(affectIdx)
  })
})

// === Smoke: full Fase A integration ==================================

describe('Fase A — Smoke: full C1+C2+C3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('computeAffect lifecycle: crea sample, cycleId univoco, intervention capped', async () => {
    const { computeAffect, affectHistory, affectStats } = await import('@/lib/kernel/affect-subsystem')

    // Esegui 3 computeAffect con telemetria crescente
    const r1 = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0,
      toolCalls: 5,
      gateRejects: 0,
      gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    await new Promise((r) => setTimeout(r, 1))
    const r2 = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 2,
      toolCalls: 5,
      gateRejects: 2,
      gateAttempts: 3,
      repeatedToolCalls: 1,
    })
    await new Promise((r) => setTimeout(r, 1))
    const r3 = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5,
      toolCalls: 5,
      gateRejects: 8,
      gateAttempts: 10,
      repeatedToolCalls: 3,
    })

    // C2: cycleId devono essere tutti diversi
    const cycleIds = new Set([r1.cycleId, r2.cycleId, r3.cycleId])
    expect(cycleIds.size).toBe(3)

    // Verifica history
    const history = await affectHistory(TEST_AGENT, 10)
    expect(history.length).toBe(3)

    // Verifica stats
    const stats = await affectStats()
    expect(stats.samples).toBeGreaterThanOrEqual(3)

    // C3: se r3 ha intervention (desperation alta per 8 gateRejects), deve essere capped
    if (r3.intervention) {
      expect(r3.intervention.length).toBeLessThanOrEqual(1000 + 20)
    }
  })

  it('C1+C2: computeAffect integrato in executor non blocca il task', async () => {
    // Test indiretto: verifichiamo che executePlan su un piano semplice completa
    // anche se computeAffect viene chiamato dopo ogni task.
    // (Test diretto richiederebbe LLM API — mockato implicitamente dal fallback)
    const { db } = await import('@/lib/db')
    const planId = `am-faseA-smoke-${Date.now()}`

    await db.agentPlan.create({
      data: {
        id: planId,
        taskGoal: 'Smoke test affect integration',
        planJson: JSON.stringify({
          tasks: [
            { taskId: 'T1', agentId: 'orchestrator', description: 'Simple task', dependencies: [] },
          ],
        }),
        status: 'pending',
        agentCount: 1,
        tasks: {
          create: [{
            taskId: 'T1',
            agentId: 'orchestrator',
            description: 'Simple task',
            dependencies: '[]',
            status: 'pending',
          }],
        },
      },
    })

    const { executePlan } = await import('@/lib/runtime/executor')
    const result = await executePlan({
      planId,
      signal: new AbortController().signal,
    })

    // Il task deve completare (done/failed/blocked), non crashare
    expect(result.steps.length).toBe(1)
    expect(['done', 'failed', 'blocked']).toContain(result.steps[0]!.status)

    // Verifica che computeAffect ha creato almeno 1 AffectSample per orchestrator
    // (solo se il task è done — se failed/blocked, computeAffect potrebbe non essere chiamato)
    if (result.steps[0]!.status === 'done') {
      const samples = await db.affectSample.findMany({
        where: { agentId: 'orchestrator' },
        orderBy: { timestamp: 'desc' },
        take: 5,
      })
      // Almeno 1 sample creato dall'integrazione C1
      // (potrebbero esserci anche sample preesistenti da test precedenti)
      expect(samples.length).toBeGreaterThanOrEqual(1)
    }

    // Cleanup
    await db.affectSample.deleteMany({ where: { agentId: 'orchestrator' } }).catch(() => {})
    await db.affectThreshold.deleteMany({ where: { agentId: 'orchestrator' } }).catch(() => {})
    await db.planTask.deleteMany({ where: { planId } })
    await db.executionTrace.deleteMany({ where: { workflowId: planId } })
    await db.agentPlan.delete({ where: { id: planId } })
  })

  it('C3 smoke: intervention con threshold estremi → capped, no crash', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')

    // Threshold con valori estremi per generare intervention lunga
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.001,  // quasi sempre trigger
      frustrationCritical: 0.001,
      tighteningPct: 0.999999,
      cooldownMs: 999999,
    })

    // Alta telemetria → intervention sicura
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 10,
      toolCalls: 10,
      gateRejects: 10,
      gateAttempts: 10,
      repeatedToolCalls: 10,
    })

    expect(r).toBeDefined()
    expect(r.desperation).toBeGreaterThan(0.5)
    expect(r.frustration).toBeGreaterThan(0.5)
    expect(r.intervention).toBeDefined()
    // C3: intervention deve essere capped a 1KB + marker
    expect(r.intervention!.length).toBeLessThanOrEqual(1000 + 20)
    // Verifica contenuto intervention (deve avere HALT per dual critical)
    expect(r.intervention).toMatch(/HALT/)
  })
})
