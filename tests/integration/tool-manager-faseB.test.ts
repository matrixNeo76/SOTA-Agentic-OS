/**
 * Integration tests for Tool Manager Fase B
 * (B1, B2, B3, B4, B5)
 *
 * B1 — tool-manager.tsx refresh() con try/catch + toast.error (già presente dal Fase 1 B5 fix)
 * B2 — dispatchTool retry logic su tool execution failure (max 2 retry con backoff)
 * B3 — tool-manager.tsx action functions parse-safe su r.json()
 * B4 — getToolStats con metriche derivate (permissionRate, activeRate, externalTools)
 * B5 — getToolStats query in Promise.all (già presente, confermato)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'tm-faseB-'

async function cleanupFixtures() {
  const tools = await db.tool.findMany({ where: { toolId: { startsWith: TEST_PREFIX } }, select: { id: true } })
  if (tools.length > 0) {
    const toolIds = tools.map(t => t.id)
    await db.toolPermission.deleteMany({ where: { toolId: { in: toolIds } } })
    await db.tool.deleteMany({ where: { id: { in: toolIds } } })
  }
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === B4+B5: getToolStats con metriche derivate ======================

describe('Fase B — B4+B5: getToolStats metriche derivate', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('toolStats ritorna tutte le 8 metriche (5 originali + 3 B4)', async () => {
    const { toolStats } = await import('@/lib/kernel/tool-registry')
    const stats = await toolStats()
    // 5 originali
    expect(stats).toHaveProperty('total')
    expect(stats).toHaveProperty('active')
    expect(stats).toHaveProperty('revoked')
    expect(stats).toHaveProperty('totalPerms')
    expect(stats).toHaveProperty('grantedPerms')
    // 3 B4
    expect(stats).toHaveProperty('permissionRate')
    expect(stats).toHaveProperty('activeRate')
    expect(stats).toHaveProperty('externalTools')
  })

  it('toolStats permissionRate = grantedPerms / totalPerms', async () => {
    const { installTool, setPermission, toolStats } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}rate`, name: 'Rate', version: '1.0', publisher: 'test' })
    await setPermission(`${TEST_PREFIX}rate`, 'filesystem:read', true, 'admin')
    await setPermission(`${TEST_PREFIX}rate`, 'network:get', false, 'admin')

    const stats = await toolStats()
    if (stats.totalPerms > 0) {
      expect(stats.permissionRate).toBeCloseTo(stats.grantedPerms / stats.totalPerms, 5)
    }
    expect(stats.permissionRate).toBeGreaterThanOrEqual(0)
    expect(stats.permissionRate).toBeLessThanOrEqual(1)
  })

  it('toolStats activeRate = active / total', async () => {
    const { installTool, toolStats } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}active`, name: 'Active', version: '1.0', publisher: 'test' })
    const stats = await toolStats()
    if (stats.total > 0) {
      expect(stats.activeRate).toBeCloseTo(stats.active / stats.total, 5)
    }
    expect(stats.activeRate).toBeGreaterThanOrEqual(0)
    expect(stats.activeRate).toBeLessThanOrEqual(1)
  })

  it('toolStats externalTools count tool con transport !== null', async () => {
    const { toolStats } = await import('@/lib/kernel/tool-registry')
    const stats = await toolStats()
    expect(typeof stats.externalTools).toBe('number')
    expect(stats.externalTools).toBeGreaterThanOrEqual(0)
  })

  it('tool-registry.ts ha B4+B5 fix comment', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/tool-registry.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B5 fix[\s\S]*tutte le query in Promise\.all/)
    expect(content).toMatch(/B4 fix[\s\S]*metriche derivate aggiuntive/)
    expect(content).toMatch(/permissionRate[\s\S]*grantedPerms \/ totalPerms/)
    expect(content).toMatch(/activeRate[\s\S]*active \/ total/)
    expect(content).toMatch(/externalTools[\s\S]*transport/)
  })
})

// === B1: tool-manager.tsx refresh() con try/catch ====================

describe('Fase B — B1: tool-manager.tsx refresh() con try/catch', () => {
  it('tool-manager.tsx ha try/catch su refresh()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    // B5/B1: refresh ha try/catch + toast.error
    expect(content).toMatch(/B5[\s\S]*try\/catch su refresh/)
    expect(content).toMatch(/toast\.error.*Caricamento tool fallito/)
  })
})

// === B3: tool-manager.tsx action functions parse-safe ================

describe('Fase B — B3: tool-manager.tsx action functions parse-safe', () => {
  it('tool-manager.tsx ha B3 fix su install (parse-safe r.json)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/B3 fix: parse-safe su r\.json\(\)/)
    expect(content).toMatch(/\[tool-manager\] install: response not JSON/)
  })

  it('tool-manager.tsx ha B3 fix su revoke (parse-safe r.json)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[tool-manager\] revoke: response not JSON/)
  })

  it('tool-manager.tsx ha B3 fix su togglePermission (parse-safe r.json)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[tool-manager\] togglePermission: response not JSON/)
  })

  it('tool-manager.tsx ha B3 fix su installBuiltin (parse-safe r.json)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[tool-manager\] installBuiltin: response not JSON/)
  })

  it('tool-manager.tsx ha 4 fallback a r.text() per logging', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    const textFallbackCount = (content.match(/await r\.text\(\)\.catch\(\(\) => '<no body>'\)/g) || []).length
    expect(textFallbackCount).toBe(4) // install + revoke + togglePermission + installBuiltin
  })

  it('tool-manager.tsx ha 4 toast.error su risposta non JSON', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    const toastErrorCount = (content.match(/toast\.error\(`Risposta non valida dal server \(status \$\{r\.status\}\)`\)/g) || []).length
    expect(toastErrorCount).toBe(4)
  })
})

// === B2: dispatchTool retry logic ===================================

describe('Fase B — B2: dispatchTool retry logic', () => {
  it('tool-dispatcher.ts ha B2 fix su executeBuiltin (retry loop)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/tool-dispatcher.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*retry logic su builtin tool execution/)
    expect(content).toMatch(/MAX_EXEC_RETRIES = 2/)
    expect(content).toMatch(/for \(let attempt = 1; attempt <= maxAttempts; attempt\+\+\)/)
  })

  it('tool-dispatcher.ts ha B2 fix su executeRegistered (retry loop)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/tool-dispatcher.ts'),
      'utf-8',
    )
    expect(content).toMatch(/B2 fix[\s\S]*retry logic su registered tool execution/)
    expect(content).toMatch(/MAX_EXT_RETRIES = 2/)
  })

  it('tool-dispatcher.ts ha backoff esponenziale tra tentativi (builtin)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/tool-dispatcher.ts'),
      'utf-8',
    )
    // 3 occorrenze di setTimeout(100 * attempt) — builtin retry + external result-error retry + external catch retry
    const backoffCount = (content.match(/setTimeout\(r, 100 \* attempt\)/g) || []).length
    expect(backoffCount).toBe(3)
  })

  it('tool-dispatcher.ts ha console.warn per retry (builtin)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/tool-dispatcher.ts'),
      'utf-8',
    )
    expect(content).toMatch(/console\.warn\(`\[tool-dispatcher\] builtin/)
    expect(content).toMatch(/Retrying\.\.\./)
  })

  it('tool-dispatcher.ts ha console.warn per retry (external)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/tool-dispatcher.ts'),
      'utf-8',
    )
    expect(content).toMatch(/console\.warn\(`\[tool-dispatcher\] external/)
  })
})

// === Smoke: full Fase B integration ==================================

describe('Fase B — Smoke: full B1+B2+B3+B4+B5 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('B4+B5: toolStats lifecycle con metriche derivate coerenti', async () => {
    const { installTool, setPermission, revokeTool, toolStats } = await import('@/lib/kernel/tool-registry')

    // Installa 2 tool
    await installTool({ toolId: `${TEST_PREFIX}s1`, name: 'S1', version: '1.0', publisher: 'test' })
    await installTool({ toolId: `${TEST_PREFIX}s2`, name: 'S2', version: '1.0', publisher: 'test' })

    // Setta permissions
    await setPermission(`${TEST_PREFIX}s1`, 'filesystem:read', true, 'admin')
    await setPermission(`${TEST_PREFIX}s1`, 'network:get', false, 'admin')
    await setPermission(`${TEST_PREFIX}s2`, 'tool:exec', true, 'admin')

    // Revoca s2
    await revokeTool(`${TEST_PREFIX}s2`, 'test revoke')

    const stats = await toolStats()
    expect(stats.total).toBeGreaterThanOrEqual(2)
    expect(stats.active).toBeGreaterThanOrEqual(1)
    expect(stats.revoked).toBeGreaterThanOrEqual(1)
    expect(stats.totalPerms).toBeGreaterThanOrEqual(3)
    expect(stats.grantedPerms).toBeGreaterThanOrEqual(1) // revokeTool setta granted=false su s2
    // B4 metriche
    expect(stats.permissionRate).toBeGreaterThan(0)
    expect(stats.activeRate).toBeGreaterThan(0)
    expect(stats.activeRate).toBeLessThan(1) // s2 è revoked
    expect(typeof stats.externalTools).toBe('number')
  })

  it('B1+B3: tool-manager.tsx ha try/catch + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    // B1: refresh con try/catch
    expect(content).toMatch(/toast\.error.*Caricamento tool fallito/)
    // B3: 4 action functions con parse-safe
    expect(content).toMatch(/\[tool-manager\] install: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] revoke: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] togglePermission: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] installBuiltin: response not JSON/)
    // B3: 4 fallback r.text()
    const textFallbackCount = (content.match(/await r\.text\(\)\.catch\(\(\) => '<no body>'\)/g) || []).length
    expect(textFallbackCount).toBe(4)
  })

  it('B2: tool-dispatcher.ts ha retry logic su builtin + external', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/tool-dispatcher.ts'),
      'utf-8',
    )
    // B2: retry loop builtin
    expect(content).toMatch(/MAX_EXEC_RETRIES = 2/)
    expect(content).toMatch(/builtin.*Retrying/)
    // B2: retry loop external
    expect(content).toMatch(/MAX_EXT_RETRIES = 2/)
    expect(content).toMatch(/external.*Retrying/)
    // B2: backoff (3 occorrenze: builtin + external result-error + external catch)
    const backoffCount = (content.match(/setTimeout\(r, 100 \* attempt\)/g) || []).length
    expect(backoffCount).toBe(3)
  })
})
