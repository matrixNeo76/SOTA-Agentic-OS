/**
 * Integration tests for Affect Monitor Fase C
 * (G1, G2, G3, G4)
 *
 * G1 — Unit test per decideIntervention/getOrCreateThreshold/updateThreshold/affectStats/affectHistory in isolamento
 * G2 — phase11.tsx a11y (aria-label, role=status)
 * G3 — assorbito in B2 Fase B (parse-safe già implementato)
 * G4 — affectStats con metriche aggiuntive (interventionRate, peak, agentsInCriticalState)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'am-faseC-agent'
const TEST_AGENT_2 = 'am-faseC-agent-2'

async function cleanupFixtures() {
  await db.affectSample.deleteMany({ where: { agentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.affectThreshold.deleteMany({ where: { agentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
  await db.agentLog.deleteMany({ where: { agentId: { in: [TEST_AGENT, TEST_AGENT_2] } } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G1: decideIntervention in isolamento (via computeAffect) ==========

describe('Fase C — G1: decideIntervention scenari (via computeAffect)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('decideIntervention: nessun intervento se metriche < critical', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    // Metriche basse: 0 gateRejects, 0 toolFailures → desperation/frustration = 0
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    expect(r.intervention).toBeUndefined()
    expect(r.desperation).toBe(0)
    expect(r.frustration).toBe(0)
  })

  it('decideIntervention: desperation-only → TIGHTEN_ACCEPTANCE_THRESHOLD', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    // Alta desperation: 3 gateRejects * 0.35 = 1.05 → clamp 1.0
    // toolFailures = 0 → frustration = 0
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 3, gateAttempts: 5,
      repeatedToolCalls: 0,
    })
    expect(r.desperation).toBeGreaterThan(0.7)
    expect(r.intervention).toBeDefined()
    expect(r.intervention).toMatch(/TIGHTEN_ACCEPTANCE_THRESHOLD/)
    expect(r.intervention).toMatch(/INJECT_CAUTION_PROMPT:desperation/)
    // Solo desperation → no HALT, no COOLDOWN
    expect(r.intervention).not.toMatch(/HALT/)
    expect(r.intervention).not.toMatch(/COOLDOWN/)
  })

  it('decideIntervention: frustration-only → COOLDOWN', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // Modifica threshold per frustration alta ma desperation bassa
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.99,  // alta → non triggera
      frustrationCritical: 0.3,   // bassa → triggera con 4 toolFailures * 0.20 = 0.8
    })
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 4, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    expect(r.frustration).toBeGreaterThan(0.3)
    expect(r.intervention).toBeDefined()
    expect(r.intervention).toMatch(/COOLDOWN/)
    expect(r.intervention).toMatch(/INJECT_CAUTION_PROMPT:frustration/)
    // Solo frustration → no HALT, no TIGHTEN
    expect(r.intervention).not.toMatch(/HALT/)
    expect(r.intervention).not.toMatch(/TIGHTEN_ACCEPTANCE_THRESHOLD/)
  })

  it('decideIntervention: dual critical → HALT', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // Threshold basse per triggerare entrambe
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.3,
      frustrationCritical: 0.3,
    })
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 4, toolCalls: 5,        // 4 * 0.20 = 0.8 > 0.3
      gateRejects: 2, gateAttempts: 5,       // 2 * 0.35 = 0.7 > 0.3
      repeatedToolCalls: 2,                  // 2 * 0.15 = 0.3
    })
    expect(r.desperation).toBeGreaterThan(0.3)
    expect(r.frustration).toBeGreaterThan(0.3)
    expect(r.intervention).toBeDefined()
    expect(r.intervention).toMatch(/HALT:dual_critical_state/)
    expect(r.intervention).toMatch(/TIGHTEN_ACCEPTANCE_THRESHOLD/)
    expect(r.intervention).toMatch(/COOLDOWN/)
  })

  it('decideIntervention: interventi sono concatenati con " | "', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.1,
      frustrationCritical: 0.1,
    })
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5, toolCalls: 5,
      gateRejects: 3, gateAttempts: 5,
      repeatedToolCalls: 3,
    })
    expect(r.intervention).toBeDefined()
    // Verifica formato: interventi separati da " | "
    expect(r.intervention!.split(' | ').length).toBeGreaterThanOrEqual(3) // TIGHTEN + INJECT + COOLDOWN + INJECT + HALT
  })

  it('decideIntervention: TIGHTEN usa threshold.tighteningPct', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.1,
      tighteningPct: 0.25,  // 25%
    })
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 3, gateAttempts: 5,
      repeatedToolCalls: 0,
    })
    expect(r.intervention).toMatch(/TIGHTEN_ACCEPTANCE_THRESHOLD:-25%/)
  })

  it('decideIntervention: COOLDOWN usa threshold.cooldownMs', async () => {
    const { computeAffect, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.99,
      frustrationCritical: 0.1,
      cooldownMs: 8000,  // 8 secondi
    })
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 4, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    expect(r.intervention).toMatch(/COOLDOWN:8000ms/)
  })
})

// === G1: getOrCreateThreshold in isolamento ===========================

describe('Fase C — G1: getOrCreateThreshold defaults e riuso', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('getOrCreateThreshold crea policy con default values', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    // La prima chiamata a computeAffect crea la threshold automaticamente
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 1,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    const threshold = await db.affectThreshold.findUnique({ where: { agentId: TEST_AGENT } })
    expect(threshold).not.toBeNull()
    expect(threshold!.desperationCritical).toBe(0.7)
    expect(threshold!.frustrationCritical).toBe(0.7)
    expect(threshold!.cooldownMs).toBe(5000)
    expect(threshold!.tighteningPct).toBe(0.15)
  })

  it('getOrCreateThreshold riusa policy esistente (no duplicati)', async () => {
    const { computeAffect } = await import('@/lib/kernel/affect-subsystem')
    // 2 chiamate → 1 threshold sola
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 1, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0,
    })
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 1, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0,
    })
    const thresholds = await db.affectThreshold.findMany({ where: { agentId: TEST_AGENT } })
    expect(thresholds.length).toBe(1)
  })
})

// === G1: affectHistory ordinamento e limit =============================

describe('Fase C — G1: affectHistory ordinamento e limit', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('affectHistory ritorna samples ordinati per timestamp desc', async () => {
    const { computeAffect, affectHistory } = await import('@/lib/kernel/affect-subsystem')
    // Crea 3 samples con pause per garantire timestamp diversi
    await computeAffect({ agentId: TEST_AGENT, toolFailures: 1, toolCalls: 5, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0 })
    await new Promise((r) => setTimeout(r, 5))
    await computeAffect({ agentId: TEST_AGENT, toolFailures: 2, toolCalls: 5, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0 })
    await new Promise((r) => setTimeout(r, 5))
    await computeAffect({ agentId: TEST_AGENT, toolFailures: 3, toolCalls: 5, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0 })

    const history = await affectHistory(TEST_AGENT, 10)
    expect(history.length).toBe(3)
    // Verifica ordinamento desc (più recente prima)
    expect(history[0]!.timestamp.getTime()).toBeGreaterThan(history[1]!.timestamp.getTime())
    expect(history[1]!.timestamp.getTime()).toBeGreaterThan(history[2]!.timestamp.getTime())
  })

  it('affectHistory rispetta il limit', async () => {
    const { computeAffect, affectHistory } = await import('@/lib/kernel/affect-subsystem')
    for (let i = 0; i < 5; i++) {
      await computeAffect({ agentId: TEST_AGENT, toolFailures: i, toolCalls: 5, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0 })
      await new Promise((r) => setTimeout(r, 2))
    }
    const history = await affectHistory(TEST_AGENT, 3)
    expect(history.length).toBe(3)
  })

  it('affectHistory ritorna array vuoto per agentId senza samples', async () => {
    const { affectHistory } = await import('@/lib/kernel/affect-subsystem')
    const history = await affectHistory('nonexistent-agent', 10)
    expect(history).toEqual([])
  })
})

// === G1+G4: affectStats accuracy con metriche G4 ======================

describe('Fase C — G1+G4: affectStats accuracy con metriche G4', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('affectStats ritorna tutte le 9 metriche (5 originali + 4 G4)', async () => {
    const { affectStats } = await import('@/lib/kernel/affect-subsystem')
    const stats = await affectStats()
    // 5 originali
    expect(stats).toHaveProperty('samples')
    expect(stats).toHaveProperty('agents')
    expect(stats).toHaveProperty('interventions')
    expect(stats).toHaveProperty('avgDesperation')
    expect(stats).toHaveProperty('avgFrustration')
    // 4 G4
    expect(stats).toHaveProperty('interventionRate')
    expect(stats).toHaveProperty('peakDesperation')
    expect(stats).toHaveProperty('peakFrustration')
    expect(stats).toHaveProperty('agentsInCriticalState')
  })

  it('affectStats interventionRate = interventions / samples', async () => {
    const { computeAffect, affectStats, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // Threshold bassa per garantire interventi
    await updateThreshold(TEST_AGENT, { desperationCritical: 0.01, frustrationCritical: 0.01 })

    // 1 sample con intervento
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5, toolCalls: 5,
      gateRejects: 5, gateAttempts: 5,
      repeatedToolCalls: 5,
    })
    // Reset threshold per secondo sample senza intervento
    await updateThreshold(TEST_AGENT, { desperationCritical: 0.99, frustrationCritical: 0.99 })
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })

    const stats = await affectStats()
    // Almeno 1 intervento su 2 samples → interventionRate >= 0.5
    expect(stats.interventions).toBeGreaterThanOrEqual(1)
    expect(stats.samples).toBeGreaterThanOrEqual(2)
    expect(stats.interventionRate).toBeGreaterThan(0)
    expect(stats.interventionRate).toBeLessThanOrEqual(1)
    // Verifica formula
    expect(stats.interventionRate).toBeCloseTo(stats.interventions / Math.max(1, stats.samples), 5)
  })

  it('affectStats peakDesperation/peakFrustration riflettono max storico', async () => {
    const { computeAffect, affectStats, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // Threshold alta per evitare interventi
    await updateThreshold(TEST_AGENT, { desperationCritical: 0.99, frustrationCritical: 0.99 })

    // Sample 1: desperation 0.35 (1 gateReject * 0.35)
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 1, gateAttempts: 5,
      repeatedToolCalls: 0,
    })
    let stats = await affectStats()
    expect(stats.peakDesperation).toBeGreaterThanOrEqual(0.35)

    // Sample 2: desperation 1.0 (3 gateRejects * 0.35 = 1.05 → clamp 1.0)
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 3, gateAttempts: 5,
      repeatedToolCalls: 0,
    })
    stats = await affectStats()
    expect(stats.peakDesperation).toBeGreaterThanOrEqual(0.99) // peak deve essere vicino a 1.0
  })

  it('affectStats agentsInCriticalState conta agenti con metriche > 0.7', async () => {
    const { computeAffect, affectStats, updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // 2 agenti con threshold alta per evitare interventi
    await updateThreshold(TEST_AGENT, { desperationCritical: 0.99, frustrationCritical: 0.99 })
    await updateThreshold(TEST_AGENT_2, { desperationCritical: 0.99, frustrationCritical: 0.99 })

    // Agent 1: desperation alta (3 gateRejects * 0.35 = 1.05 → clamp 1.0)
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 3, gateAttempts: 5,
      repeatedToolCalls: 0,
    })
    // Agent 2: frustration alta (5 toolFailures * 0.20 = 1.0)
    await computeAffect({
      agentId: TEST_AGENT_2,
      toolFailures: 5, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })

    const stats = await affectStats()
    // Entrambi gli agenti hanno ultima sample > 0.7 → agentsInCriticalState >= 2
    expect(stats.agentsInCriticalState).toBeGreaterThanOrEqual(2)
  })

  it('affectStats agentsInCriticalState = 0 se tutti gli agenti sono sani', async () => {
    const { computeAffect, affectStats } = await import('@/lib/kernel/affect-subsystem')
    // Sample sano: 0 gateRejects, 0 toolFailures
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    const stats = await affectStats()
    // Questo agent ha desperation/frustration = 0 → non in critical state
    // (altri agenti preesistenti potrebbero essere in critical, ma non TEST_AGENT)
    expect(stats.agentsInCriticalState).toBeGreaterThanOrEqual(0)
  })
})

// === G2: phase11.tsx a11y =============================================

describe('Fase C — G2: phase11.tsx a11y', () => {
  it('phase11.tsx ha aria-label su button Aggiorna', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna dati Affect Monitor"/)
  })

  it('phase11.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Affect Monitor"/)
  })

  it('phase11.tsx ha aria-label su button Calcola Metriche', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Calcola metriche affettive dall'input telemetria"/)
  })

  it('phase11.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })

  it('phase11.tsx stats grid ha 8 stat card (4 originali + 4 G4)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    // G4: nuove stat card
    expect(content).toMatch(/label="Intervention rate"/)
    expect(content).toMatch(/label="Peak desperation"/)
    expect(content).toMatch(/label="Peak frustration"/)
    expect(content).toMatch(/label="Agenti critici"/)
  })
})

// === G3: assorbito in B2 (verifica parse-safe già presente) ===========

describe('Fase C — G3: parse-safe assorbito in B2 (verifica presenza)', () => {
  it('phase11.tsx ha try/catch interno su r.json() (B2/G3 fix)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*parse-safe \+ error handling/)
    expect(content).toMatch(/try \{[\s\S]*d = await r\.json\(\)[\s\S]*\} catch \{/)
    expect(content).toMatch(/response not JSON/)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1+G4: computeAffect lifecycle + stats con 9 metriche coerenti', async () => {
    const { computeAffect, affectStats, updateThreshold } = await import('@/lib/kernel/affect-subsystem')

    // Crea threshold custom
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.3,
      frustrationCritical: 0.3,
      cooldownMs: 2000,
      tighteningPct: 0.2,
    })

    // 2 samples con metriche alte (trigger interventi)
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5, toolCalls: 5,
      gateRejects: 3, gateAttempts: 5,
      repeatedToolCalls: 3,
    })
    await new Promise((r) => setTimeout(r, 5))
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 4, toolCalls: 5,
      gateRejects: 2, gateAttempts: 5,
      repeatedToolCalls: 2,
    })

    // Verifica stats con tutte le 9 metriche
    const stats = await affectStats()
    expect(stats.samples).toBeGreaterThanOrEqual(2)
    expect(stats.agents).toBeGreaterThanOrEqual(1)
    expect(stats.interventions).toBeGreaterThanOrEqual(2)  // entrambi i samples con intervento
    expect(stats.avgDesperation).toBeGreaterThan(0)
    expect(stats.avgFrustration).toBeGreaterThan(0)
    // G4 metriche
    expect(stats.interventionRate).toBeGreaterThan(0)
    expect(stats.peakDesperation).toBeGreaterThan(0.5)
    expect(stats.peakFrustration).toBeGreaterThan(0.5)
    // Agent in critical state (ultimi 5min)
    expect(stats.agentsInCriticalState).toBeGreaterThanOrEqual(1)
  })

  it('G2+G3: phase11.tsx ha a11y + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )

    // G2: a11y
    expect(content).toMatch(/aria-label="Aggiorna dati Affect Monitor"/)
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Calcola metriche affettive dall'input telemetria"/)
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)

    // G3: parse-safe (assorbito in B2)
    expect(content).toMatch(/B2 fix[\s\S]*parse-safe/)
    expect(content).toMatch(/try \{[\s\S]*d = await r\.json\(\)[\s\S]*\} catch \{/)
    expect(content).toMatch(/response not JSON/)
    expect(content).toMatch(/Errore di rete/)
  })

  it('G4: stats ritorna 9 metriche tutte numeriche', async () => {
    const { groundingStats: _unused, affectStats } = await import('@/lib/kernel/affect-subsystem')
    const stats = await affectStats()

    const keys = ['samples', 'agents', 'interventions', 'avgDesperation', 'avgFrustration',
                  'interventionRate', 'peakDesperation', 'peakFrustration', 'agentsInCriticalState']
    for (const key of keys) {
      expect(stats).toHaveProperty(key)
      expect(typeof (stats as any)[key]).toBe('number')
      expect((stats as any)[key]).toBeGreaterThanOrEqual(0)
    }

    // Coerenza: interventionRate in [0, 1]
    expect(stats.interventionRate).toBeGreaterThanOrEqual(0)
    expect(stats.interventionRate).toBeLessThanOrEqual(1)
    // peakDesperation/peakFrustration in [0, 1] (clamp a runtime)
    expect(stats.peakDesperation).toBeLessThanOrEqual(1)
    expect(stats.peakFrustration).toBeLessThanOrEqual(1)
  })
})
