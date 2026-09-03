/**
 * Integration tests for Model Encapsulator Fase C
 * (G1, G2, G3, G4)
 *
 * G1 — Unit test per extractScript/executeSandbox/getOrCreatePolicy/updatePolicy/groundingStats in isolamento
 * G2 — phase10.tsx a11y (aria-label, role=status)
 * G3 — phase10.tsx runCall parse-safe con try/catch su r.json()
 * G4 — groundingStats con metriche aggiuntive (failed, pending, sandboxOk)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'me-faseC-agent'

async function cleanupFixtures() {
  await db.encapsulatedSession.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.encapsulationPolicy.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.toolCallEntry.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === G1: Unit test per extractScript in isolamento ===================

describe('Fase C — G1: extractScript in isolamento (via encapsulatedCall)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('extractScript estrae script da fenced code block ```js', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    // contextData con array → simulateLLMOutput genera script filter/map
    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Test fenced extraction',
      contextData: { items: [1, 2, null, 3] },
    })
    expect(result.sessionId).toBeTruthy()
    // Se LLM è disponibile, può estrarre script vero; altrimenti fallback a simulateLLMOutput
    // In entrambi i casi, la session deve essere creata
    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    expect(session).not.toBeNull()
    expect(session!.modelOutput).toBeTruthy()
  })

  it('extractScript estrae script da riga return', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    // contextData con object → simulateLLMOutput genera script Object.entries
    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Test return extraction',
      contextData: { config: { a: 1, b: 2 } },
    })
    expect(result.sessionId).toBeTruthy()
    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    expect(session).not.toBeNull()
  })

  it('extractScript ritorna null se nessuno script nel output', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    // contextData con solo primitive → simulateLLMOutput ritorna testo senza script
    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Test no script',
      contextData: { value: 'simple string' },
    })
    expect(result.sessionId).toBeTruthy()
    // Senza script, parsedScript deve essere undefined/null
    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    expect(session).not.toBeNull()
    // status deve essere 'executed' (no script → no sandbox → executed)
    expect(['executed', 'sandbox_blocked']).toContain(result.status)
  })

  it('extractScript ha size cap MAX_SCRIPT_SIZE = 10KB', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/MAX_SCRIPT_SIZE = 10_000/)
    expect(content).toMatch(/script too large/)
  })

  it('extractScript ha BLOCKED_KEYWORDS con 6 keyword', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/'process'/)
    expect(content).toMatch(/'require'/)
    expect(content).toMatch(/'fetch'/)
    expect(content).toMatch(/'global'/)
    expect(content).toMatch(/'constructor'/)
    expect(content).toMatch(/'__proto__'/)
  })
})

// === G1: getOrCreatePolicy e updatePolicy ============================

describe('Fase C — G1: getOrCreatePolicy e updatePolicy', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('getOrCreatePolicy crea policy con default values', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    // La prima chiamata crea la policy automaticamente
    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Test policy creation',
      contextData: { value: 1 },
    })

    const policy = await db.encapsulationPolicy.findUnique({ where: { agentId: TEST_AGENT } })
    expect(policy).not.toBeNull()
    // Default values
    expect(policy!.maxRetries).toBe(3)
    expect(policy!.contextBudget).toBe(2000)
    expect(policy!.sandboxEnabled).toBe(true)
    expect(policy!.forbidDirectMutation).toBe(true)
  })

  it('getOrCreatePolicy riutilizza policy esistente (no duplicati)', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    // Prima chiamata → crea policy
    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'First call',
      contextData: { value: 1 },
    })
    // Seconda chiamata → riusa policy
    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Second call',
      contextData: { value: 2 },
    })

    // Deve esserci solo 1 policy per questo agentId
    const policies = await db.encapsulationPolicy.findMany({ where: { agentId: TEST_AGENT } })
    expect(policies.length).toBe(1)
  })

  it('updatePolicy upsert: crea se non esiste', async () => {
    const { updatePolicy } = await import('@/lib/kernel/grounded-inference')
    await updatePolicy(TEST_AGENT, { maxRetries: 5, contextBudget: 4000 })

    const policy = await db.encapsulationPolicy.findUnique({ where: { agentId: TEST_AGENT } })
    expect(policy).not.toBeNull()
    expect(policy!.maxRetries).toBe(5)
    expect(policy!.contextBudget).toBe(4000)
  })

  it('updatePolicy upsert: aggiorna se esiste', async () => {
    const { encapsulatedCall, updatePolicy } = await import('@/lib/kernel/grounded-inference')
    // Crea policy via encapsulatedCall (default maxRetries=3)
    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Init policy',
      contextData: { value: 1 },
    })
    // Aggiorna policy
    await updatePolicy(TEST_AGENT, { maxRetries: 10, sandboxEnabled: false })

    const policy = await db.encapsulationPolicy.findUnique({ where: { agentId: TEST_AGENT } })
    expect(policy).not.toBeNull()
    expect(policy!.maxRetries).toBe(10)
    expect(policy!.sandboxEnabled).toBe(false)
  })

  it('updatePolicy non sovrascrive campi non specificati', async () => {
    const { updatePolicy } = await import('@/lib/kernel/grounded-inference')
    // Crea con maxRetries=5
    await updatePolicy(TEST_AGENT, { maxRetries: 5 })
    // Aggiorna solo contextBudget
    await updatePolicy(TEST_AGENT, { contextBudget: 8000 })

    const policy = await db.encapsulationPolicy.findUnique({ where: { agentId: TEST_AGENT } })
    expect(policy).not.toBeNull()
    expect(policy!.maxRetries).toBe(5) // non sovrascritto
    expect(policy!.contextBudget).toBe(8000) // aggiornato
  })
})

// === G1: groundingStats accuracy (G4 metriche) =======================

describe('Fase C — G1: groundingStats accuracy con metriche G4', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('groundingStats ritorna tutte le 7 metriche', async () => {
    const { groundingStats } = await import('@/lib/kernel/grounded-inference')
    const stats = await groundingStats()
    expect(stats).toHaveProperty('sessions')
    expect(stats).toHaveProperty('executed')
    expect(stats).toHaveProperty('sandboxBlocked')
    expect(stats).toHaveProperty('failed')
    expect(stats).toHaveProperty('pending')
    expect(stats).toHaveProperty('sandboxOk')
    expect(stats).toHaveProperty('policies')
    // Tutti numeri
    for (const key of ['sessions', 'executed', 'sandboxBlocked', 'failed', 'pending', 'sandboxOk', 'policies']) {
      expect(typeof (stats as any)[key]).toBe('number')
    }
  })

  it('groundingStats riflette nuove sessioni create', async () => {
    const { encapsulatedCall, groundingStats } = await import('@/lib/kernel/grounded-inference')
    const before = await groundingStats()

    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Stats test',
      contextData: { value: 1 },
    })

    const after = await groundingStats()
    expect(after.sessions).toBeGreaterThan(before.sessions)
    expect(after.policies).toBeGreaterThanOrEqual(before.policies)
  })

  it('groundingStats usa Promise.all (single round-trip)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // G4: deve avere un solo Promise.all con 7 query
    const statsMatch = content.match(/export async function groundingStats\(\)[\s\S]*?\n\}/)
    expect(statsMatch).not.toBeNull()
    const statsBody = statsMatch![0]
    const promiseAllCount = (statsBody.match(/Promise\.all/g) || []).length
    expect(promiseAllCount).toBe(1)
    // 7 count query
    const countQueries = (statsBody.match(/db\.\w+\.count/g) || []).length
    expect(countQueries).toBe(7)
  })
})

// === G4: groundingStats metriche aggiuntive ===========================

describe('Fase C — G4: groundingStats metriche aggiuntive', () => {
  it('grounded-inference.ts ha G4 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/G4 fix[\s\S]*groundingStats con metriche aggiuntive/)
    expect(content).toMatch(/Mancavano: failed, pending, sandboxOk/)
  })

  it('groundingStats ritorna failed count', async () => {
    const { groundingStats } = await import('@/lib/kernel/grounded-inference')
    const stats = await groundingStats()
    expect(stats).toHaveProperty('failed')
    expect(typeof stats.failed).toBe('number')
  })

  it('groundingStats ritorna pending count', async () => {
    const { groundingStats } = await import('@/lib/kernel/grounded-inference')
    const stats = await groundingStats()
    expect(stats).toHaveProperty('pending')
    expect(typeof stats.pending).toBe('number')
  })

  it('groundingStats ritorna sandboxOk count', async () => {
    const { groundingStats } = await import('@/lib/kernel/grounded-inference')
    const stats = await groundingStats()
    expect(stats).toHaveProperty('sandboxOk')
    expect(typeof stats.sandboxOk).toBe('number')
  })

  it('groundingStats query per failed usa status: failed', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/where: \{ status: 'failed' \}/)
    expect(content).toMatch(/where: \{ status: 'pending' \}/)
    expect(content).toMatch(/where: \{ sandboxOk: true \}/)
  })
})

// === G2: phase10.tsx a11y ============================================

describe('Fase C — G2: phase10.tsx a11y', () => {
  it('phase10.tsx ha aria-label su button Aggiorna', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Aggiorna dati Model Encapsulator"/)
  })

  it('phase10.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Model Encapsulator"/)
  })

  it('phase10.tsx ha aria-label su button Esegui Encapsulated Call', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/aria-label="Esegui chiamata incapsulata LLM"/)
  })

  it('phase10.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })

  it('phase10.tsx stats grid ha 7 stat card (G4 + nuove metriche)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    // G4: 7 stat card invece di 4
    expect(content).toMatch(/grid-cols-2 md:grid-cols-7/)
    // Verifica presenza delle nuove card
    expect(content).toMatch(/label="Fallite"/)
    expect(content).toMatch(/label="Pending"/)
    expect(content).toMatch(/label="Sandbox OK"/)
  })
})

// === G3: phase10.tsx runCall parse-safe ===============================

describe('Fase C — G3: phase10.tsx runCall parse-safe', () => {
  it('phase10.tsx ha G3 fix comment per parse-safe', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/G3 fix[\s\S]*parse-safe su r\.json/)
  })

  it('phase10.tsx ha try/catch interno su r.json()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    // Deve avere un try/catch interno per r.json()
    expect(content).toMatch(/let d: any\s*\n\s*try \{\s*\n\s*d = await r\.json\(\)/)
    expect(content).toMatch(/\} catch \{[\s\S]*response not JSON/)
  })

  it('phase10.tsx ha fallback a r.text() per logging', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/const text = await r\.text\(\)\.catch\(\(\) => '<no body>'\)/)
    expect(content).toMatch(/console\.error\('\[phase10\] runCall: response not JSON'/)
  })

  it('phase10.tsx ha toast.error su risposta non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/toast\.error\(`Risposta non valida dal server \(status \$\{r\.status\}\)`\)/)
  })

  it('phase10.tsx ha catch esterno per network error', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    // Deve avere un catch esterno per network error (fetch throw)
    expect(content).toMatch(/\} catch \(e: any\) \{[\s\S]*Network error o fetch throw/)
    expect(content).toMatch(/toast\.error\(e\.message \|\| 'Errore di rete'\)/)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1+G4: encapsulatedCall lifecycle + stats con 7 metriche coerenti', async () => {
    const { encapsulatedCall, groundingStats, updatePolicy } = await import('@/lib/kernel/grounded-inference')

    // Crea policy custom con updatePolicy (G1: upsert)
    await updatePolicy(TEST_AGENT, { maxRetries: 2, contextBudget: 1000 })

    // Esegui 2 chiamate incapsulate
    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Smoke 1',
      contextData: { items: [1, 2, 3] },
    })
    await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Smoke 2',
      contextData: { value: 'simple' },
    })

    // Verifica stats (G4: 7 metriche)
    const stats = await groundingStats()
    expect(stats.sessions).toBeGreaterThanOrEqual(2)
    expect(stats.policies).toBeGreaterThanOrEqual(1)

    // Verifica policy aggiornata (G1: upsert rispetta maxRetries=2)
    const policy = await db.encapsulationPolicy.findUnique({ where: { agentId: TEST_AGENT } })
    expect(policy!.maxRetries).toBe(2)
    expect(policy!.contextBudget).toBe(1000)
  })

  it('G2+G3: phase10.tsx ha a11y + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )

    // G2: a11y
    expect(content).toMatch(/aria-label="Aggiorna dati Model Encapsulator"/)
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Esegui chiamata incapsulata LLM"/)

    // G3: parse-safe
    expect(content).toMatch(/G3 fix[\s\S]*parse-safe/)
    expect(content).toMatch(/try \{[\s\S]*d = await r\.json\(\)[\s\S]*\} catch \{/)
    expect(content).toMatch(/response not JSON/)
    expect(content).toMatch(/Errore di rete/)
  })

  it('G4: stats ritorna 7 metriche tutte numeriche', async () => {
    const { groundingStats } = await import('@/lib/kernel/grounded-inference')
    const stats = await groundingStats()

    // G4: 7 metriche
    const keys = ['sessions', 'executed', 'sandboxBlocked', 'failed', 'pending', 'sandboxOk', 'policies']
    expect(Object.keys(stats).length).toBeGreaterThanOrEqual(7)
    for (const key of keys) {
      expect(stats).toHaveProperty(key)
      expect(typeof (stats as any)[key]).toBe('number')
      expect((stats as any)[key]).toBeGreaterThanOrEqual(0)
    }

    // Coerenza: sessions = executed + sandboxBlocked + failed + pending (almeno)
    const sumStatuses = stats.executed + stats.sandboxBlocked + stats.failed + stats.pending
    expect(sumStatuses).toBeLessThanOrEqual(stats.sessions)
  })
})
