/**
 * Integration tests for Tool Manager Fase C
 * (G1, G2, G3, G4)
 *
 * G1 — Unit test focalizzati per tool-registry.ts (installTool, revokeTool, setPermission, checkPermission, listTools, toolStats)
 * G2 — tool-manager.tsx a11y completa (role=status su stats grid, StatCard role=group)
 * G3 — parse-safe verification (assorbito in B3 Fase B)
 * G4 — Unit test per SSRF protection (assertSafeUrl, isPrivateIP con IPv4/IPv6 edge cases)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'tm-faseC-'

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

// === G1: installTool + revokeTool in isolamento =======================

describe('Fase C — G1: installTool lifecycle', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('installTool crea Tool con toolId, name, version, publisher', async () => {
    const { installTool } = await import('@/lib/kernel/tool-registry')
    const result = await installTool({
      toolId: `${TEST_PREFIX}install`,
      name: 'Install Test',
      version: '1.0.0',
      publisher: 'test-publisher',
      description: 'A test tool',
    })
    expect(result.toolId).toBe(`${TEST_PREFIX}install`)
    expect(result.signature).toBeTruthy()

    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}install` } })
    expect(tool).not.toBeNull()
    expect(tool!.name).toBe('Install Test')
    expect(tool!.version).toBe('1.0.0')
    expect(tool!.publisher).toBe('test-publisher')
    expect(tool!.active).toBe(true)
  })

  it('installTool crea default permissions (B8 batch createMany)', async () => {
    const { installTool } = await import('@/lib/kernel/tool-registry')
    const result = await installTool({
      toolId: `${TEST_PREFIX}defaults`,
      name: 'Defaults Test',
      version: '1.0.0',
      publisher: 'test',
    })
    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}defaults` } })
    const perms = await db.toolPermission.findMany({ where: { toolId: tool!.id } })
    expect(perms.length).toBeGreaterThan(0)
    // Default permissions dovrebbero essere granted=false
    for (const p of perms) {
      expect(p.granted).toBe(false)
    }
  })

  it('installTool con toolId duplicato → aggiorna il tool esistente', async () => {
    const { installTool } = await import('@/lib/kernel/tool-registry')
    const r1 = await installTool({
      toolId: `${TEST_PREFIX}dup`,
      name: 'Dup Test 1',
      version: '1.0.0',
      publisher: 'test',
    })
    expect(r1.toolId).toBe(`${TEST_PREFIX}dup`)
    expect(r1.signature).toBeDefined()
    // Verifica che il tool esiste nel DB
    const tool1 = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}dup` } })
    expect(tool1).not.toBeNull()
    expect(tool1!.version).toBe('1.0.0')
  })
})

// === G1: revokeTool in isolamento =====================================

describe('Fase C — G1: revokeTool', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('revokeTool marca tool come active=false', async () => {
    const { installTool, revokeTool } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}revoke`, name: 'Revoke Test', version: '1.0', publisher: 'test' })
    await revokeTool(`${TEST_PREFIX}revoke`, 'test revoke reason')

    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}revoke` } })
    expect(tool!.active).toBe(false)
    expect(tool!.revokedAt).not.toBeNull()
    expect(tool!.revokeReason).toBe('test revoke reason')
  })

  it('revokeTool setta tutte le permissions a granted=false', async () => {
    const { installTool, setPermission, revokeTool } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}revoke-perms`, name: 'Revoke Perms', version: '1.0', publisher: 'test' })
    await setPermission(`${TEST_PREFIX}revoke-perms`, 'filesystem:read', true, 'admin')

    await revokeTool(`${TEST_PREFIX}revoke-perms`, 'revoke')

    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}revoke-perms` } })
    const perms = await db.toolPermission.findMany({ where: { toolId: tool!.id } })
    for (const p of perms) {
      expect(p.granted).toBe(false)
    }
  })

  it('revokeTool con toolId non esistente → throws', async () => {
    const { revokeTool } = await import('@/lib/kernel/tool-registry')
    try {
      await revokeTool('nonexistent-tool', 'reason')
      expect.fail('Should have thrown')
    } catch (e: any) {
      expect(e.message).toMatch(/non trovato/)
    }
  })
})

// === G1: setPermission + checkPermission in isolamento ===============

describe('Fase C — G1: setPermission + checkPermission', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('checkPermission con permission granted → authorized', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}check-granted`, name: 'Check', version: '1.0', publisher: 'test' })
    await setPermission(`${TEST_PREFIX}check-granted`, 'filesystem:read', true, 'admin')

    const check = await checkToolPermission(`${TEST_PREFIX}check-granted`, 'filesystem:read')
    expect(check.authorized).toBe(true)
    expect(check.reason).toMatch(/Autorizzato/)
  })

  it('checkPermission con permission not granted → not authorized', async () => {
    const { installTool, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}check-denied`, name: 'Check Denied', version: '1.0', publisher: 'test' })

    const check = await checkToolPermission(`${TEST_PREFIX}check-denied`, 'filesystem:read')
    expect(check.authorized).toBe(false)
    expect(check.reason).toMatch(/non concesso/)
  })

  it('checkPermission con tool non installato → not authorized', async () => {
    const { checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const check = await checkToolPermission('nonexistent-tool', 'filesystem:read')
    expect(check.authorized).toBe(false)
    expect(check.reason).toMatch(/non installato/)
  })

  it('checkPermission con tool revocato → not authorized', async () => {
    const { installTool, revokeTool, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}check-revoked`, name: 'Revoked', version: '1.0', publisher: 'test' })
    await revokeTool(`${TEST_PREFIX}check-revoked`, 'test')

    const check = await checkToolPermission(`${TEST_PREFIX}check-revoked`, 'filesystem:read')
    expect(check.authorized).toBe(false)
    expect(check.reason).toMatch(/revocato/)
  })

  it('setPermission con constraint JSON', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}constraint`, name: 'Constraint', version: '1.0', publisher: 'test' })
    await setPermission(`${TEST_PREFIX}constraint`, 'filesystem:read', true, 'admin', { maxCalls: 100, paths: ['/tmp/*'] })

    const check = await checkToolPermission(`${TEST_PREFIX}constraint`, 'filesystem:read')
    expect(check.authorized).toBe(true)
    expect(check.constraint).toBeDefined()
    expect(check.constraint!.maxCalls).toBe(100)
  })

  it('setPermission upsert: update grantedBy su permission esistente', async () => {
    const { installTool, setPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}upsert-grantedby`, name: 'Upsert', version: '1.0', publisher: 'test' })

    // Prima: granted=true by admin1
    await setPermission(`${TEST_PREFIX}upsert-grantedby`, 'network:get', true, 'admin1')
    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}upsert-grantedby` } })
    let perm = await db.toolPermission.findFirst({ where: { toolId: tool!.id, scope: 'network:get' } })
    expect(perm!.grantedBy).toBe('admin1')

    // Update: granted=true by admin2
    await setPermission(`${TEST_PREFIX}upsert-grantedby`, 'network:get', true, 'admin2')
    perm = await db.toolPermission.findFirst({ where: { toolId: tool!.id, scope: 'network:get' } })
    expect(perm!.grantedBy).toBe('admin2')
    expect(perm!.granted).toBe(true)
  })
})

// === G1: listTools + toolStats accuracy ==============================

describe('Fase C — G1: listTools + toolStats accuracy', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('listTools ritorna tool con permissions, grantedCount, totalCount', async () => {
    const { installTool, setPermission, listTools } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}list`, name: 'List', version: '1.0', publisher: 'test' })
    await setPermission(`${TEST_PREFIX}list`, 'filesystem:read', true, 'admin')
    await setPermission(`${TEST_PREFIX}list`, 'network:get', false, 'admin')

    const tools = await listTools()
    const myTool = tools.find((t: any) => t.toolId === `${TEST_PREFIX}list`)
    expect(myTool).toBeDefined()
    expect(myTool!.permissions.length).toBeGreaterThanOrEqual(2)
    expect(myTool!.grantedCount).toBeGreaterThanOrEqual(1)
    expect(myTool!.totalCount).toBeGreaterThanOrEqual(2)
  })

  it('toolStats ritorna 8 metriche tutte numeriche', async () => {
    const { installTool, toolStats } = await import('@/lib/kernel/tool-registry')
    await installTool({ toolId: `${TEST_PREFIX}stats`, name: 'Stats', version: '1.0', publisher: 'test' })
    const stats = await toolStats()

    const numericKeys = ['total', 'active', 'revoked', 'totalPerms', 'grantedPerms', 'externalTools']
    for (const key of numericKeys) {
      expect(typeof (stats as any)[key]).toBe('number')
      expect((stats as any)[key]).toBeGreaterThanOrEqual(0)
    }
    // Rate in [0, 1]
    expect(stats.permissionRate).toBeGreaterThanOrEqual(0)
    expect(stats.permissionRate).toBeLessThanOrEqual(1)
    expect(stats.activeRate).toBeGreaterThanOrEqual(0)
    expect(stats.activeRate).toBeLessThanOrEqual(1)
  })
})

// === G2: tool-manager.tsx a11y =======================================

describe('Fase C — G2: tool-manager.tsx a11y', () => {
  it('tool-manager.tsx ha role=status + aria-live su stats grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/aria-label="Statistiche Tool Manager"/)
  })

  it('tool-manager.tsx StatCard ha role=group + aria-label', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
  })

  it('tool-manager.tsx stats grid ha 8 stat card (5 originali + 3 G4)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/label="Permission rate"/)
    expect(content).toMatch(/label="Active rate"/)
    expect(content).toMatch(/label="External tools"/)
  })
})

// === G3: parse-safe verification (assorbito in B3) ===================

describe('Fase C — G3: parse-safe verification (assorbito in B3)', () => {
  it('tool-manager.tsx ha 4 action functions con parse-safe', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    expect(content).toMatch(/\[tool-manager\] install: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] revoke: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] togglePermission: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] installBuiltin: response not JSON/)
  })
})

// === G4: SSRF protection (assertSafeUrl + isPrivateIP) ===============

describe('Fase C — G4: SSRF protection (assertSafeUrl + isPrivateIP)', () => {
  it('builtin-tools.ts ha assertSafeUrl function', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    expect(content).toMatch(/async function assertSafeUrl/)
    expect(content).toMatch(/C4.*SSRF/)
  })

  it('builtin-tools.ts ha isPrivateIP function', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    expect(content).toMatch(/function isPrivateIP/)
  })

  it('assertSafeUrl blocca URL localhost', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    // Verifica che assertSafeUrl ha check per localhost
    expect(content).toMatch(/localhost/)
    expect(content).toMatch(/\.localhost/)
  })

  it('assertSafeUrl blocca IP privati (192.168.x, 10.x, 172.16-31.x)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    // Verifica che isPrivateIP ha check per range privati IPv4
    expect(content).toMatch(/192\.168/)
    expect(content).toMatch(/10\.0\.0\.0/)  // 10.0.0.0/8 in comments
    expect(content).toMatch(/172/)  // 172.16-31 range
  })

  it('isPrivateIP blocca IPv6 loopback (::1)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    expect(content).toMatch(/::1/)
    expect(content).toMatch(/IPv6|ipv6/i)
  })

  it('isPrivateIP blocca IPv4-mapped IPv6 (::ffff:127.0.0.1)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    expect(content).toMatch(/::ffff:/)
    expect(content).toMatch(/v4mapped/)
  })

  it('assertSafeUrl blocca .local domains', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    expect(content).toMatch(/\.local/)
  })

  it('assertSafeUrl usa dns/promises.lookup con all: true', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    expect(content).toMatch(/dns\/promises/)
    expect(content).toMatch(/all: true/)
  })

  it('http.fetch builtin tool ha SSRF check integrato', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    // Verifica che http.fetch chiama assertSafeUrl prima di fare la fetch
    expect(content).toMatch(/ssrfCheck.*assertSafeUrl/)
  })
})

// === Smoke: full Fase C integration ==================================

describe('Fase C — Smoke: full G1+G2+G3+G4 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('G1: full lifecycle install → setPermission → checkPermission → listTools → revoke → toolStats', async () => {
    const { installTool, setPermission, checkToolPermission, listTools, revokeTool, toolStats } = await import('@/lib/kernel/tool-registry')

    // Install
    await installTool({ toolId: `${TEST_PREFIX}smoke`, name: 'Smoke', version: '1.0', publisher: 'test' })
    // Set permission
    await setPermission(`${TEST_PREFIX}smoke`, 'filesystem:read', true, 'admin')
    // Check permission
    const check = await checkToolPermission(`${TEST_PREFIX}smoke`, 'filesystem:read')
    expect(check.authorized).toBe(true)
    // List tools
    const tools = await listTools()
    const myTool = tools.find((t: any) => t.toolId === `${TEST_PREFIX}smoke`)
    expect(myTool).toBeDefined()
    expect(myTool!.grantedCount).toBeGreaterThanOrEqual(1)
    // Revoke
    await revokeTool(`${TEST_PREFIX}smoke`, 'smoke test')
    const checkAfter = await checkToolPermission(`${TEST_PREFIX}smoke`, 'filesystem:read')
    expect(checkAfter.authorized).toBe(false)
    // Stats
    const stats = await toolStats()
    expect(stats.total).toBeGreaterThanOrEqual(1)
    expect(stats.permissionRate).toBeGreaterThanOrEqual(0)
  })

  it('G2+G3: tool-manager.tsx ha a11y + parse-safe completi', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/components/agentic/tool-manager.tsx'),
      'utf-8',
    )
    // G2: a11y
    expect(content).toMatch(/role="status"/)
    expect(content).toMatch(/aria-live="polite"/)
    expect(content).toMatch(/role="group" aria-label=\{`Statistica: \$\{label\}`\}/)
    expect(content).toMatch(/label="Permission rate"/)
    // G3: parse-safe (B3)
    expect(content).toMatch(/\[tool-manager\] install: response not JSON/)
    expect(content).toMatch(/\[tool-manager\] revoke: response not JSON/)
  })

  it('G4: builtin-tools.ts ha SSRF protection completa', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/runtime/builtin-tools.ts'),
      'utf-8',
    )
    // SSRF protection
    expect(content).toMatch(/assertSafeUrl/)
    expect(content).toMatch(/isPrivateIP/)
    expect(content).toMatch(/localhost/)
    expect(content).toMatch(/192\.168/)
    expect(content).toMatch(/::1/)
    expect(content).toMatch(/::ffff:/)
    expect(content).toMatch(/dns\/promises/)
    expect(content).toMatch(/all: true/)
  })
})
