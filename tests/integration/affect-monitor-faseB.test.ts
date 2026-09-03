/**
 * Integration tests for Affect Monitor Fase B
 * (B1, B2, B3, B5, B6)
 *
 * B1 — phase11.tsx refresh() con try/catch (no unhandled rejection)
 * B2 — phase11.tsx compute() con parse-safe + toast.error su !d.ok
 * B3 — affectStats: tutte le query in Promise.all (1 round-trip DB)
 * B5 — updateThreshold valida range (0..1 per critical/pct, > 0 per cooldownMs)
 * B6 — affectStats aggregation documentato come best-effort
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'am-faseB-agent'

async function cleanupFixtures() {
  await db.affectSample.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.affectThreshold.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B1: phase11.tsx refresh() con try/catch ==========================

describe('Fase B — B1: phase11.tsx refresh() con try/catch', () => {
  it('phase11.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B1 fix[\s\S]*try\/catch[\s\S]*refresh/)
    // Il corpo di refresh deve essere dentro try { ... } catch (err) { ... }
    expect(content).toMatch(/try \{[\s\S]*Promise\.all[\s\S]*\} catch \(err\)/)
    expect(content).toMatch(/toast\.error\('Caricamento Affect Monitor fallito'\)/)
    expect(content).toMatch(/console\.error\('\[phase11\] refresh failed:'/)
  })

  it('phase11.tsx refresh non cancella stato su errore', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    // Estrai il catch block e verifica che non azzera lo stato
    const catchIdx = content.indexOf("} catch (err) {")
    expect(catchIdx).toBeGreaterThan(0)
    const catchSnippet = content.slice(catchIdx, catchIdx + 400)
    expect(catchSnippet).toMatch(/toast\.error\('Caricamento Affect Monitor fallito'\)/)
    // Il catch block NON deve azzerare lo stato (preserva dati già caricati)
    expect(catchSnippet).not.toMatch(/setHistory\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setStats\(null\)/)
  })
})

// === B2: phase11.tsx compute() con parse-safe + error handling =========

describe('Fase B — B2: phase11.tsx compute() parse-safe + error handling', () => {
  it('phase11.tsx ha B2 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*parse-safe \+ error handling/)
  })

  it('phase11.tsx ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    // Deve avere un try/catch interno per r.json()
    expect(content).toMatch(/let d: any\s*\n\s*try \{\s*\n\s*d = await r\.json\(\)/)
    expect(content).toMatch(/\} catch \{[\s\S]*response not JSON/)
  })

  it('phase11.tsx ha fallback a r.text() per logging', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/const text = await r\.text\(\)\.catch\(\(\) => '<no body>'\)/)
    expect(content).toMatch(/console\.error\('\[phase11\] compute: response not JSON'/)
  })

  it('phase11.tsx ha toast.error su risposta non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/toast\.error\(`Risposta non valida dal server \(status \$\{r\.status\}\)`\)/)
  })

  it('phase11.tsx ha toast.error esplicito su !d.ok', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    // B2: prima era silente, ora toast.error su !d.ok
    expect(content).toMatch(/\} else \{[\s\S]*toast\.error\(d\.error \|\| 'Errore calcolo metriche affettive'\)/)
  })

  it('phase11.tsx ha catch esterno per network error', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )
    // Deve avere un catch esterno per network error (fetch throw)
    expect(content).toMatch(/\} catch \(e: any\) \{[\s\S]*Network error o fetch throw/)
    expect(content).toMatch(/toast\.error\(e\.message \|\| 'Errore di rete'\)/)
  })
})

// === B3: affectStats tutte le query in Promise.all ===================

describe('Fase B — B3: affectStats con tutte le query in Promise.all', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('affectStats ritorna tutte le 5 metriche', async () => {
    const { affectStats } = await import('@/lib/kernel/affect-subsystem')
    const stats = await affectStats()
    expect(stats).toHaveProperty('samples')
    expect(stats).toHaveProperty('agents')
    expect(stats).toHaveProperty('interventions')
    expect(stats).toHaveProperty('avgDesperation')
    expect(stats).toHaveProperty('avgFrustration')
    // Tutti numeri
    for (const key of ['samples', 'agents', 'interventions', 'avgDesperation', 'avgFrustration']) {
      expect(typeof (stats as any)[key]).toBe('number')
    }
  })

  it('affect-subsystem.ts ha B3 fix (single Promise.all)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B3 fix[\s\S]*tutte le query in un unico Promise\.all/)
  })

  it('affectStats non ha più query sequenziali dopo il Promise.all', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    // Estrai il corpo di affectStats
    const statsMatch = content.match(/export async function affectStats\(\)[\s\S]*?\n\}/)
    expect(statsMatch).not.toBeNull()
    const statsBody = statsMatch![0]
    // Verifica: deve esserci un solo Promise.all e nessun await db.* dopo
    const promiseAllCount = (statsBody.match(/Promise\.all/g) || []).length
    expect(promiseAllCount).toBe(1)
    // Dopo la chiusura del Promise.all (]), non devono esserci altri await db.*
    const afterPromiseAll = statsBody.split(']')[1] || ''
    // reduce/length sono operazioni in-memory, non db query
    expect(afterPromiseAll).not.toMatch(/await db\.\w+\.(findMany|count|groupBy|aggregate)/)
  })

  it('affectStats riflette nuovi samples', async () => {
    const { computeAffect, affectStats } = await import('@/lib/kernel/affect-subsystem')
    const before = await affectStats()

    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 1,
      toolCalls: 5,
      gateRejects: 0,
      gateAttempts: 1,
      repeatedToolCalls: 0,
    })

    const after = await affectStats()
    expect(after.samples).toBeGreaterThan(before.samples)
  })
})

// === B5: updateThreshold valida range =================================

describe('Fase B — B5: updateThreshold valida range', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('updateThreshold con desperationCritical > 1.0 → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { desperationCritical: 1.5 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/desperationCritical must be a number in \[0, 1\]/)
    }
  })

  it('updateThreshold con desperationCritical negativo → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { desperationCritical: -0.1 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/desperationCritical must be a number in \[0, 1\]/)
    }
  })

  it('updateThreshold con frustrationCritical > 1.0 → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { frustrationCritical: 2.0 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/frustrationCritical must be a number in \[0, 1\]/)
    }
  })

  it('updateThreshold con cooldownMs <= 0 → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { cooldownMs: 0 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/cooldownMs must be a positive finite number/)
    }
  })

  it('updateThreshold con cooldownMs negativo → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { cooldownMs: -100 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/cooldownMs must be a positive finite number/)
    }
  })

  it('updateThreshold con cooldownMs Infinity → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { cooldownMs: Infinity })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/cooldownMs must be a positive finite number/)
    }
  })

  it('updateThreshold con tighteningPct > 1.0 → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { tighteningPct: 1.5 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/tighteningPct must be a number in \[0, 1\]/)
    }
  })

  it('updateThreshold con tighteningPct negativo → throws', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    try {
      await updateThreshold(TEST_AGENT, { tighteningPct: -0.1 })
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/tighteningPct must be a number in \[0, 1\]/)
    }
  })

  it('updateThreshold con valori validi → ok (no throw)', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    const threshold = await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.8,
      frustrationCritical: 0.6,
      cooldownMs: 3000,
      tighteningPct: 0.2,
    })
    expect(threshold).toBeDefined()
    expect(threshold.desperationCritical).toBe(0.8)
    expect(threshold.frustrationCritical).toBe(0.6)
    expect(threshold.cooldownMs).toBe(3000)
    expect(threshold.tighteningPct).toBe(0.2)
  })

  it('updateThreshold con valori ai boundary (0 e 1) → ok', async () => {
    const { updateThreshold } = await import('@/lib/kernel/affect-subsystem')
    // Boundary values: 0 e 1 sono ammessi (>= e <=)
    const threshold = await updateThreshold(TEST_AGENT, {
      desperationCritical: 0,    // minimo
      frustrationCritical: 1,   // massimo
      cooldownMs: 1,             // minimo positivo
      tighteningPct: 0,          // minimo
    })
    expect(threshold.desperationCritical).toBe(0)
    expect(threshold.frustrationCritical).toBe(1)
    expect(threshold.cooldownMs).toBe(1)
    expect(threshold.tighteningPct).toBe(0)
  })

  it('affect-subsystem.ts ha B5 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B5 fix[\s\S]*validazione range dei valori/)
    expect(content).toMatch(/desperationCritical must be a number in \[0, 1\]/)
    expect(content).toMatch(/cooldownMs must be a positive finite number/)
  })
})

// === B6: affectStats aggregation documentato ==========================

describe('Fase B — B6: affectStats aggregation documentato best-effort', () => {
  it('affect-subsystem.ts ha B6 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B6 fix[\s\S]*aggregation documentato come best-effort/)
    expect(content).toMatch(/best-effort avg/)
  })

  it('affectStats usa take: 100 per best-effort avg', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/affect-subsystem.ts'),
      'utf-8',
    )
    // Verifica che il pattern mantiene take: 100 (best-effort)
    expect(content).toMatch(/take: 100/)
    expect(content).toMatch(/best-effort avg: carica ultimi 100 samples/)
  })

  it('affectStats avgDesperation/avgFrustration sono coerenti', async () => {
    const { computeAffect, affectStats } = await import('@/lib/kernel/affect-subsystem')
    // Crea 2 samples con desperation 0.5 e 1.0
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5,
      gateRejects: 0, gateAttempts: 1,
      repeatedToolCalls: 0,
    })
    await new Promise((r) => setTimeout(r, 5))
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5, toolCalls: 5,
      gateRejects: 5, gateAttempts: 5,
      repeatedToolCalls: 5,
    })

    const stats = await affectStats()
    // avgDesperation deve essere > 0 (almeno 1 sample con desperation > 0)
    expect(stats.avgDesperation).toBeGreaterThan(0)
    // avgFrustration deve essere > 0
    expect(stats.avgFrustration).toBeGreaterThan(0)
    // Entrambi devono essere ≤ 1 (clamp)
    expect(stats.avgDesperation).toBeLessThanOrEqual(1)
    expect(stats.avgFrustration).toBeLessThanOrEqual(1)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B5+B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('B3+B6: affectStats con 4 query in Promise.all + best-effort avg coerente', async () => {
    const { computeAffect, affectStats } = await import('@/lib/kernel/affect-subsystem')

    // Crea 3 samples
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 0, toolCalls: 5, gateRejects: 0, gateAttempts: 1, repeatedToolCalls: 0,
    })
    await new Promise((r) => setTimeout(r, 2))
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 2, toolCalls: 5, gateRejects: 2, gateAttempts: 3, repeatedToolCalls: 1,
    })
    await new Promise((r) => setTimeout(r, 2))
    await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 5, toolCalls: 5, gateRejects: 8, gateAttempts: 10, repeatedToolCalls: 3,
    })

    const stats = await affectStats()
    expect(stats.samples).toBeGreaterThanOrEqual(3)
    expect(stats.agents).toBeGreaterThanOrEqual(1)
    // avgDesperation e avgFrustration devono essere > 0 (almeno 1 sample con metriche > 0)
    expect(stats.avgDesperation).toBeGreaterThan(0)
    expect(stats.avgFrustration).toBeGreaterThan(0)
  })

  it('B5 smoke: updateThreshold rifiuta valori fuori range ma accetta validi', async () => {
    const { updateThreshold, computeAffect } = await import('@/lib/kernel/affect-subsystem')

    // Valori fuori range → throw
    try {
      await updateThreshold(TEST_AGENT, { desperationCritical: 1.5 })
      expect.fail('Should throw')
    } catch (e: any) {
      expect(e.message).toMatch(/desperationCritical/)
    }

    // Valori validi → ok
    await updateThreshold(TEST_AGENT, {
      desperationCritical: 0.5,
      frustrationCritical: 0.6,
      cooldownMs: 2000,
      tighteningPct: 0.1,
    })

    // computeAffect con threshold custom → funziona
    const r = await computeAffect({
      agentId: TEST_AGENT,
      toolFailures: 3,
      toolCalls: 5,
      gateRejects: 3,
      gateAttempts: 5,
      repeatedToolCalls: 2,
    })
    expect(r).toBeDefined()
    // Con desperationCritical=0.5 e 3 gateRejects * 0.35 = 1.05 → clamp 1.0 → intervention sicura
    if (r.desperation >= 0.5) {
      expect(r.intervention).toBeDefined()
    }
  })

  it('B1+B2 smoke: phase11.tsx ha try/catch su refresh e compute', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase11.tsx'),
      'utf-8',
    )

    // B1: refresh con try/catch
    expect(content).toMatch(/B1 fix[\s\S]*try\/catch[\s\S]*refresh/)
    expect(content).toMatch(/toast\.error\('Caricamento Affect Monitor fallito'\)/)

    // B2: compute con parse-safe + error handling
    expect(content).toMatch(/B2 fix[\s\S]*parse-safe \+ error handling/)
    expect(content).toMatch(/try \{[\s\S]*d = await r\.json\(\)[\s\S]*\} catch \{/)
    expect(content).toMatch(/toast\.error\(d\.error \|\| 'Errore calcolo metriche affettive'\)/)
    expect(content).toMatch(/Network error o fetch throw/)
  })
})
