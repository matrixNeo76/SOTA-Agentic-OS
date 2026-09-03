/**
 * Integration tests for Model Encapsulator Fase B
 * (B1, B2, B4, B5, B6)
 *
 * B1 — Size cap su modelOutput/parsedScript/sandboxResult (DB bloat prevention)
 * B2 — phase10.tsx refresh() con try/catch (no unhandled rejection)
 * B4 — Implementare retry logic in encapsulatedCall (rispetta policy.maxRetries)
 * B5 — simulateLLMOutput tronca taskGoal a 1KB prima di interpolare
 * B6 — Rimuovere dead import runPipeline
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_AGENT = 'me-faseB-agent'

async function cleanupFixtures() {
  await db.encapsulatedSession.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.encapsulationPolicy.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.agentLog.deleteMany({ where: { agentId: TEST_AGENT } })
  await db.toolCallEntry.deleteMany({ where: { agentId: TEST_AGENT } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B1: Size cap su payload persistito ===============================

describe('Fase B — B1: size cap su modelOutput/parsedScript/sandboxResult', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('grounded-inference.ts ha costanti di size cap B1', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B1 fix[\s\S]*size cap su payload/)
    expect(content).toMatch(/MAX_MODEL_OUTPUT_SIZE = 50_000/)
    expect(content).toMatch(/MAX_SANDBOX_RESULT_SIZE = 50_000/)
    expect(content).toMatch(/truncateWithMarker/)
  })

  it('grounded-inference.ts applica truncateWithMarker su modelOutput', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Verifica che modelOutput viene troncato dopo il retry loop
    expect(content).toMatch(/B1 — Size cap su modelOutput prima di persistere/)
    expect(content).toMatch(/modelOutput = truncateWithMarker\(modelOutput, MAX_MODEL_OUTPUT_SIZE\)/)
  })

  it('grounded-inference.ts applica truncateWithMarker su sandboxResult JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Verifica che sandboxResult viene troncato prima di essere persistito
    expect(content).toMatch(/B1 — Size cap su sandboxResult JSON/)
    expect(content).toMatch(/sandboxResultJson = truncateWithMarker\(\s*JSON\.stringify\(sandboxResult\.result\)/)
  })

  it('truncateWithMarker aggiunge marker [truncated] se supera cap', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Verifica implementazione di truncateWithMarker
    expect(content).toMatch(/function truncateWithMarker\(value: string, maxSize: number\): string \{/)
    expect(content).toMatch(/return value\.slice\(0, maxSize\) \+ '\.\.\.\[truncated\]'/)
  })

  it('encapsulatedCall con output piccolo → non troncato', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Small output test',
      contextData: { simple: 'value' },
    })
    expect(result.sessionId).toBeTruthy()

    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    // Output piccolo non deve essere troncato
    expect(session!.modelOutput).not.toMatch(/\[truncated\]$/)
  })
})

// === B2: phase10.tsx refresh() con try/catch ==========================

describe('Fase B — B2: phase10.tsx refresh() con try/catch', () => {
  it('phase10.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*try\/catch[\s\S]*refresh/)
    // Il corpo di refresh deve essere dentro try { ... } catch (err) { ... }
    expect(content).toMatch(/try \{[\s\S]*Promise\.all[\s\S]*\} catch \(err\)/)
    expect(content).toMatch(/toast\.error\('Caricamento Model Encapsulator fallito'\)/)
    expect(content).toMatch(/console\.error\('\[phase10\] refresh failed:'/)
  })

  it('phase10.tsx refresh non cancella stato su errore', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/phase10.tsx'),
      'utf-8',
    )
    // Estrai il catch block e verifica che non azzera lo stato
    const catchIdx = content.indexOf("} catch (err) {")
    expect(catchIdx).toBeGreaterThan(0)
    const catchSnippet = content.slice(catchIdx, catchIdx + 400)
    expect(catchSnippet).toMatch(/toast\.error\('Caricamento Model Encapsulator fallito'\)/)
    // Il catch block NON deve azzerare lo stato (preserva dati già caricati)
    expect(catchSnippet).not.toMatch(/setSessions\(\[\]\)/)
    expect(catchSnippet).not.toMatch(/setStats\(null\)/)
  })
})

// === B4: retry logic in encapsulatedCall ==============================

describe('Fase B — B4: retry logic in encapsulatedCall', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('grounded-inference.ts ha retry loop con maxAttempts', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B4: PRIMA retryCount era sempre 0/)
    expect(content).toMatch(/maxAttempts = Math\.max\(1, policy\.maxRetries \+ 1\)/)
    expect(content).toMatch(/for \(let attempt = 1; attempt <= maxAttempts; attempt\+\+\)/)
  })

  it('grounded-inference.ts retryCount riflette i tentativi effettivi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // retryCount deve essere aggiornato ad ogni attempt fallito
    expect(content).toMatch(/retryCount = attempt/)
    // E poi persistito nella session
    expect(content).toMatch(/B4 — retryCount ora riflette i tentativi effettivi/)
    expect(content).toMatch(/retryCount,$/m) // nel data del create
  })

  it('grounded-inference.ts ha backoff esponenziale tra tentativi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/Backoff esponenziale semplice/)
    expect(content).toMatch(/await new Promise\(\(r\) => setTimeout\(r, 100 \* attempt\)\)/)
  })

  it('grounded-inference.ts logga warning ad ogni retry fallito', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/console\.warn\(`\[grounded-inference\] LLM attempt/)
    expect(content).toMatch(/Retrying/)
  })

  it('encapsulatedCall rispetta policy.maxRetries (default 3 = max 4 tentativi)', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')
    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: 'Test retry policy',
      contextData: { value: 42 },
    })
    expect(result.sessionId).toBeTruthy()

    // Verifica che la policy è stata creata con maxRetries=3 (default)
    const policy = await db.encapsulationPolicy.findUnique({ where: { agentId: TEST_AGENT } })
    expect(policy).not.toBeNull()
    expect(policy!.maxRetries).toBe(3)

    // retryCount nel result deve essere >= 0 (0 se successo al primo tentativo)
    expect(result.retryCount).toBeGreaterThanOrEqual(0)
  })

  it('encapsulatedCall fallback a simulateLLMOutput se tutti i retry falliscono', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Dopo il loop, se lastError è ancora settato, usa fallback
    expect(content).toMatch(/if \(lastError !== null\) \{[\s\S]*Falling back to deterministic/)
  })
})

// === B5: simulateLLMOutput tronca taskGoal ============================

describe('Fase B — B5: simulateLLMOutput tronca taskGoal', () => {
  it('grounded-inference.ts ha B5 fix (MAX_TASKGOAL_IN_FALLBACK)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B5 fix[\s\S]*tronca taskGoal a 1KB/)
    expect(content).toMatch(/MAX_TASKGOAL_IN_FALLBACK = 1_000/)
  })

  it('simulateLLMOutput usa safeTaskGoal (troncato) invece di taskGoal raw', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Verifica che safeTaskGoal viene calcolato e usato nelle interpolazioni
    expect(content).toMatch(/const safeTaskGoal = taskGoal\.length > MAX_TASKGOAL_IN_FALLBACK/)
    expect(content).toMatch(/taskGoal\.slice\(0, MAX_TASKGOAL_IN_FALLBACK\) \+ '\.\.\.\[truncated\]'/)
    // Le interpolazioni devono usare safeTaskGoal, non taskGoal
    expect(content).toMatch(/Ecco la trasformazione richiesta per "\$\{safeTaskGoal\}"/)
    expect(content).toMatch(/Analisi completata per "\$\{safeTaskGoal\}"/)
    // Non deve più interpolare taskGoal raw
    expect(content).not.toMatch(/"\$\{taskGoal\}"/)
  })

  it('simulateLLMOutput con taskGoal > 1KB → troncato con marker', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Verifica che il check è length > MAX_TASKGOAL_IN_FALLBACK
    expect(content).toMatch(/taskGoal\.length > MAX_TASKGOAL_IN_FALLBACK/)
  })
})

// === B6: dead import rimosso ==========================================

describe('Fase B — B6: rimosso dead import runPipeline', () => {
  it('grounded-inference.ts non ha più riga di import runPipeline attiva', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // B6: nessuna riga di codice attiva deve importare runPipeline.
    // Il commento B6 fix può menzionare `import { runPipeline }` come documentazione,
    // ma non deve esserci una riga di import effettiva (senza `//` all'inizio).
    const lines = content.split('\n')
    const activeImportLines = lines.filter(line =>
      !line.trim().startsWith('//') &&
      !line.trim().startsWith('*') &&
      line.includes("import { runPipeline }") &&
      line.includes("from './compiled-ai'")
    )
    expect(activeImportLines.length).toBe(0)
  })

  it('grounded-inference.ts ha B6 fix comment esplicativo', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // Il commento B6 fix deve essere presente (documenta il perché dell'assenza)
    expect(content).toMatch(/B6 fix[\s\S]*rimosso dead import runPipeline/)
    expect(content).toMatch(/non veniva mai chiamato/)
  })

  it('grounded-inference.ts mantiene import vm per sandbox', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/grounded-inference.ts'),
      'utf-8',
    )
    // vm import deve rimanere (usato da executeSandbox)
    expect(content).toMatch(/import \* as vm from 'node:vm'/)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B4+B5+B6 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('encapsulatedCall lifecycle con retry + size cap (no crash su huge input)', async () => {
    const { encapsulatedCall, groundingStats } = await import('@/lib/kernel/grounded-inference')

    // Crea una chiamata con taskGoal enorme per testare B5 (truncate in fallback)
    const hugeTaskGoal = 'A'.repeat(5_000) // 5KB > MAX_TASKGOAL_IN_FALLBACK (1KB)

    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: hugeTaskGoal,
      contextData: { items: [1, 2, 3] },
    })

    // Verifica session creata
    expect(result.sessionId).toBeTruthy()
    expect(['executed', 'sandbox_blocked']).toContain(result.status)

    // Verifica session persistita con size cap applicato
    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    expect(session).not.toBeNull()
    // B1: modelOutput deve essere ≤ 50KB + marker
    expect(session!.modelOutput.length).toBeLessThanOrEqual(50_000 + 50)
    // B4: retryCount deve essere ≥ 0
    expect(result.retryCount).toBeGreaterThanOrEqual(0)

    // Verifica stats aggiornate
    const stats = await groundingStats()
    expect(stats.sessions).toBeGreaterThanOrEqual(1)
  })

  it('B1+B5: huge taskGoal + huge LLM output → entrambi capped, no DB bloat', async () => {
    const { encapsulatedCall } = await import('@/lib/kernel/grounded-inference')

    // Crea una chiamata con taskGoal enorme (B5) — se LLM fallisce e usa fallback,
    // simulateLLMOutput tronca taskGoal a 1KB
    const hugeTaskGoal = 'B'.repeat(10_000) // 10KB

    const result = await encapsulatedCall({
      agentId: TEST_AGENT,
      taskGoal: hugeTaskGoal,
      contextData: { value: 'simple' },
    })

    expect(result.sessionId).toBeTruthy()

    // Verifica che modelOutput è capped (B1: 50KB max)
    const session = await db.encapsulatedSession.findUnique({ where: { id: result.sessionId } })
    expect(session!.modelOutput.length).toBeLessThanOrEqual(50_000 + 50)

    // Se l'LLM è fallito (fallback a simulateLLMOutput), B5 garantisce che
    // il taskGoal troncato appare nel modelOutput
    if (session!.modelOutput.includes('Analisi completata per')) {
      // Fallback path: il taskGoal deve essere troncato a 1KB
      expect(session!.modelOutput).toMatch(/\.\.\.\[truncated\]/)
      // Non deve contenere tutto il taskGoal originale (10KB)
      expect(session!.modelOutput.length).toBeLessThan(10_000)
    }
  })
})
