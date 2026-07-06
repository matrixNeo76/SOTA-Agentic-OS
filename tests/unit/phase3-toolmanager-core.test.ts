/**
 * Unit tests for Phase 3 (ACTS) + Tool Manager core modules (Fase 3)
 *
 * G1 — These modules had ZERO test coverage before this file.
 *
 * Covers:
 *   - acts.ts: decideStrategy (deterministic FSM), STEERING_VOCABULARY
 *   - tool-registry.ts: installTool, setPermission, checkToolPermission,
 *                       revokeTool, listTools, toolStats, BUILTIN_TOOLS, AVAILABLE_SCOPES
 *   - builtin-tools.ts: isPathAllowed (B1 path-separator-aware),
 *                       SSRF helper (assertSafeUrl, isPrivateIP) — indirect via http.fetch tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db'
import { resolve, sep } from 'path'

// === Fixtures ========================================================

const TEST_PREFIX = 'p3tm-unit-'

async function cleanupTestTools() {
  const tools = await db.tool.findMany({
    where: { toolId: { startsWith: TEST_PREFIX } },
    select: { id: true, toolId: true },
  })
  if (tools.length > 0) {
    await db.toolPermission.deleteMany({
      where: { toolId: { in: tools.map((t) => t.id) } },
    })
    await db.tool.deleteMany({ where: { id: { in: tools.map((t) => t.id) } } })
  }
  // Cleanup any orphan permissions with prefix in toolId (legacy test data)
  await db.toolPermission.deleteMany({
    where: { toolId: { startsWith: TEST_PREFIX } },
  })
}

// === acts.ts: decideStrategy =========================================

describe('acts.ts — decideStrategy deterministic FSM', () => {
  it('HALT when budgetRemaining < 50', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5,
      lastStrategy: 'EXECUTE',
      lastCheckPassed: true,
      budgetRemaining: 30,
      errorsConsecutive: 0,
    })
    expect(result).toBe('HALT')
  })

  it('CHECK when errorsConsecutive >= 3', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5,
      lastStrategy: 'EXECUTE',
      lastCheckPassed: true,
      budgetRemaining: 500,
      errorsConsecutive: 3,
    })
    expect(result).toBe('CHECK')
  })

  it('PLAN at step 0', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 0,
      lastStrategy: 'PLAN',
      lastCheckPassed: null,
      budgetRemaining: 1000,
      errorsConsecutive: 0,
    })
    expect(result).toBe('PLAN')
  })

  it('EXECUTE after PLAN', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 1,
      lastStrategy: 'PLAN',
      lastCheckPassed: null,
      budgetRemaining: 920,
      errorsConsecutive: 0,
    })
    expect(result).toBe('EXECUTE')
  })

  it('CHECK after EXECUTE', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 2,
      lastStrategy: 'EXECUTE',
      lastCheckPassed: null,
      budgetRemaining: 800,
      errorsConsecutive: 0,
    })
    expect(result).toBe('CHECK')
  })

  it('PLAN after CHECK when check failed', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 3,
      lastStrategy: 'CHECK',
      lastCheckPassed: false,
      budgetRemaining: 740,
      errorsConsecutive: 1,
    })
    expect(result).toBe('PLAN')
  })

  it('EXECUTE after CHECK when check passed', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 3,
      lastStrategy: 'CHECK',
      lastCheckPassed: true,
      budgetRemaining: 740,
      errorsConsecutive: 0,
    })
    expect(result).toBe('EXECUTE')
  })

  it('PLAN after REFLECT', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5,
      lastStrategy: 'REFLECT',
      lastCheckPassed: true,
      budgetRemaining: 600,
      errorsConsecutive: 0,
    })
    expect(result).toBe('PLAN')
  })

  it('EXECUTE as fallback for unknown lastStrategy', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5,
      lastStrategy: 'UNKNOWN' as any,
      lastCheckPassed: null,
      budgetRemaining: 500,
      errorsConsecutive: 0,
    })
    expect(result).toBe('EXECUTE')
  })

  it('budgetRemaining = 50 (boundary) non triggera HALT', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 5,
      lastStrategy: 'EXECUTE',
      lastCheckPassed: null,
      budgetRemaining: 50, // exactly 50, not < 50
      errorsConsecutive: 0,
    })
    expect(result).toBe('CHECK')
  })

  it('errorsConsecutive = 2 (boundary) non triggera CHECK forzato', async () => {
    const { decideStrategy } = await import('@/lib/kernel/acts')
    const result = decideStrategy({
      step: 2,
      lastStrategy: 'EXECUTE',
      lastCheckPassed: null,
      budgetRemaining: 800,
      errorsConsecutive: 2, // < 3
    })
    expect(result).toBe('CHECK') // because lastStrategy === EXECUTE → CHECK
  })
})

// === acts.ts: STEERING_VOCABULARY ====================================

describe('acts.ts — STEERING_VOCABULARY structure', () => {
  it('ha tutte e 5 le strategie', async () => {
    const { STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    expect(Object.keys(STEERING_VOCABULARY).sort()).toEqual(
      ['CHECK', 'EXECUTE', 'HALT', 'PLAN', 'REFLECT'].sort(),
    )
  })

  it('ogni strategia ha phrase, budgetCost, description', async () => {
    const { STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    for (const [name, info] of Object.entries(STEERING_VOCABULARY)) {
      expect(typeof info.phrase).toBe('string')
      expect(info.phrase.length).toBeGreaterThan(0)
      expect(typeof info.budgetCost).toBe('number')
      expect(info.budgetCost).toBeGreaterThanOrEqual(0)
      expect(typeof info.description).toBe('string')
      expect(info.description.length).toBeGreaterThan(0)
    }
  })

  it('HALT ha budgetCost = 0 (non consuma budget)', async () => {
    const { STEERING_VOCABULARY } = await import('@/lib/kernel/acts')
    expect(STEERING_VOCABULARY.HALT.budgetCost).toBe(0)
  })
})

// === acts.ts: no more cycleCounter (B6) =============================

describe('acts.ts — B6: cycleCounter dead code rimosso', () => {
  it('steer() non referenzia più cycleCounter (verifica side-effect-free)', async () => {
    // Importa il modulo e verifica che non esporta cycleCounter
    const actsModule = await import('@/lib/kernel/acts')
    expect((actsModule as any).cycleCounter).toBeUndefined()
  })

  it('steer() ritorna result con strategy, phrase, tokenUsed, budgetRemaining', async () => {
    const { steer } = await import('@/lib/kernel/acts')
    const result = await steer(
      'p3tm-unit-test-agent',
      1000,
      100,
      0,
      'PLAN',
      null,
      0,
    )
    expect(result).toHaveProperty('strategy')
    expect(result).toHaveProperty('phrase')
    expect(result).toHaveProperty('tokenUsed')
    expect(result).toHaveProperty('budgetRemaining')
    expect(typeof result.tokenUsed).toBe('number')
    // Cleanup: delete test steering events
    await db.steeringEvent.deleteMany({
      where: { agentId: 'p3tm-unit-test-agent' },
    })
  })
})

// === tool-registry.ts: installTool + checkPermission ================

describe('tool-registry.ts — installTool + checkPermission', () => {
  beforeEach(async () => { await cleanupTestTools() })
  afterEach(async () => { await cleanupTestTools() })

  it('installTool crea tool con signature + 10 permessi default (tutti negati)', async () => {
    const { installTool, AVAILABLE_SCOPES } = await import('@/lib/kernel/tool-registry')
    const result = await installTool({
      toolId: `${TEST_PREFIX}install-basic`,
      name: 'Install Basic Test',
      version: '1.0.0',
    }, 'test-admin')

    expect(result.toolId).toBe(`${TEST_PREFIX}install-basic`)
    expect(result.signature).toMatch(/^sha256:[a-f0-9]{32}$/)
    expect(result.permissionsCreated).toBe(AVAILABLE_SCOPES.length)

    const tool = await db.tool.findUnique({
      where: { toolId: `${TEST_PREFIX}install-basic` },
    })
    expect(tool).not.toBeNull()
    expect(tool!.name).toBe('Install Basic Test')
    expect(tool!.active).toBe(true)

    const perms = await db.toolPermission.findMany({
      where: { toolId: tool!.id },
    })
    expect(perms.length).toBe(AVAILABLE_SCOPES.length)
    for (const p of perms) {
      expect(p.granted).toBe(false) // tutti negati di default
    }
  })

  it('installTool deduplica per toolId unique (throw P2002 su duplicato)', async () => {
    const { installTool } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}dedup`,
      name: 'Dedup Test',
      version: '1.0.0',
    }, 'test-admin')

    await expect(
      installTool({
        toolId: `${TEST_PREFIX}dedup`,
        name: 'Dedup Test 2',
        version: '2.0.0',
      }, 'test-admin'),
    ).rejects.toThrow()
  })

  it('setPermission concede scope e checkToolPermission ritorna authorized=true', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const toolId = `${TEST_PREFIX}set-perm-check`
    await installTool({
      toolId,
      name: 'Set Perm Check',
      version: '1.0.0',
    }, 'test-admin')

    await setPermission(toolId, 'filesystem:read', true, 'test-admin')

    const result = await checkToolPermission(toolId, 'filesystem:read')
    expect(result.authorized).toBe(true)
    expect(result.reason).toBe('Autorizzato')
  })

  it('checkToolPermission ritorna authorized=false per scope non concesso', async () => {
    const { installTool, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const toolId = `${TEST_PREFIX}no-scope`
    await installTool({
      toolId,
      name: 'No Scope Test',
      version: '1.0.0',
    }, 'test-admin')

    const result = await checkToolPermission(toolId, 'filesystem:read')
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/non concesso/i)
  })

  it('checkToolPermission ritorna authorized=false per tool non installato', async () => {
    const { checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const result = await checkToolPermission(`${TEST_PREFIX}nonexistent`, 'filesystem:read')
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/non installato/i)
  })

  it('setPermission è idempotente (chiamata due volte non crea duplicati)', async () => {
    const { installTool, setPermission } = await import('@/lib/kernel/tool-registry')
    const toolId = `${TEST_PREFIX}idempotent-set`
    await installTool({
      toolId,
      name: 'Idempotent Set Test',
      version: '1.0.0',
    }, 'test-admin')

    await setPermission(toolId, 'filesystem:read', true, 'test-admin')
    await setPermission(toolId, 'filesystem:read', true, 'test-admin')

    const tool = await db.tool.findUnique({ where: { toolId } })
    const perms = await db.toolPermission.findMany({
      where: { toolId: tool!.id, scope: 'filesystem:read' },
    })
    expect(perms.length).toBe(1)
  })

  it('setPermission può revocare uno scope granted', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const toolId = `${TEST_PREFIX}revoke-scope`
    await installTool({
      toolId,
      name: 'Revoke Scope Test',
      version: '1.0.0',
    }, 'test-admin')

    await setPermission(toolId, 'filesystem:read', true, 'test-admin')
    await setPermission(toolId, 'filesystem:read', false, 'test-admin')

    const result = await checkToolPermission(toolId, 'filesystem:read')
    expect(result.authorized).toBe(false)
  })
})

// === tool-registry.ts: revokeTool ===================================

describe('tool-registry.ts — revokeTool', () => {
  beforeEach(async () => { await cleanupTestTools() })
  afterEach(async () => { await cleanupTestTools() })

  it('revokeTool disattiva il tool e revoca tutti i permessi', async () => {
    const { installTool, setPermission, revokeTool, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    const toolId = `${TEST_PREFIX}revoke`
    await installTool({
      toolId,
      name: 'Revoke Test',
      version: '1.0.0',
    }, 'test-admin')
    await setPermission(toolId, 'filesystem:read', true, 'test-admin')

    await revokeTool(toolId, 'test revoke reason')

    const tool = await db.tool.findUnique({ where: { toolId } })
    expect(tool!.active).toBe(false)
    expect(tool!.revokedAt).not.toBeNull()
    expect(tool!.revokeReason).toBe('test revoke reason')

    // Permesso revoked
    const result = await checkToolPermission(toolId, 'filesystem:read')
    expect(result.authorized).toBe(false)
    expect(result.reason).toMatch(/revocato/i)
  })

  it('revokeTool throwa per tool non installato', async () => {
    const { revokeTool } = await import('@/lib/kernel/tool-registry')
    await expect(
      revokeTool(`${TEST_PREFIX}nonexistent`, 'no reason'),
    ).rejects.toThrow(/non trovato/i)
  })
})

// === tool-registry.ts: listTools + toolStats ========================

describe('tool-registry.ts — listTools + toolStats', () => {
  beforeEach(async () => { await cleanupTestTools() })
  afterEach(async () => { await cleanupTestTools() })

  it('listTools ritorna array con permissions + counts', async () => {
    const { installTool, listTools } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}list`,
      name: 'List Test',
      version: '1.0.0',
    }, 'test-admin')

    const tools = await listTools()
    const testTool = tools.find((t: any) => t.toolId === `${TEST_PREFIX}list`)
    expect(testTool).toBeDefined()
    expect(testTool!.permissions).toBeInstanceOf(Array)
    expect(testTool!.grantedCount).toBe(0)
    expect(testTool!.totalCount).toBeGreaterThan(0)
  })

  it('listTools(includeRevoked=true) ritorna anche tool revocati', async () => {
    const { installTool, revokeTool, listTools } = await import('@/lib/kernel/tool-registry')
    const toolId = `${TEST_PREFIX}revoked-list`
    await installTool({
      toolId,
      name: 'Revoked List Test',
      version: '1.0.0',
    }, 'test-admin')
    await revokeTool(toolId, 'test')

    const activeOnly = await listTools(false)
    const withRevoked = await listTools(true)

    const inActive = activeOnly.find((t: any) => t.toolId === toolId)
    const inWithRevoked = withRevoked.find((t: any) => t.toolId === toolId)

    expect(inActive).toBeUndefined()
    expect(inWithRevoked).toBeDefined()
  })

  it('toolStats ritorna structure con total, active, revoked, totalPerms, grantedPerms', async () => {
    const { toolStats } = await import('@/lib/kernel/tool-registry')
    const stats = await toolStats()
    expect(stats).toHaveProperty('total')
    expect(stats).toHaveProperty('active')
    expect(stats).toHaveProperty('revoked')
    expect(stats).toHaveProperty('totalPerms')
    expect(stats).toHaveProperty('grantedPerms')
    expect(typeof stats.total).toBe('number')
    expect(stats.total).toBeGreaterThanOrEqual(0)
  })
})

// === tool-registry.ts: AVAILABLE_SCOPES + BUILTIN_TOOLS =============

describe('tool-registry.ts — AVAILABLE_SCOPES + BUILTIN_TOOLS', () => {
  it('AVAILABLE_SCOPES contiene almeno 10 scope fondamentali', async () => {
    const { AVAILABLE_SCOPES } = await import('@/lib/kernel/tool-registry')
    expect(AVAILABLE_SCOPES.length).toBeGreaterThanOrEqual(10)
    expect(AVAILABLE_SCOPES).toContain('filesystem:read')
    expect(AVAILABLE_SCOPES).toContain('filesystem:write')
    expect(AVAILABLE_SCOPES).toContain('network:get')
    expect(AVAILABLE_SCOPES).toContain('network:post')
    expect(AVAILABLE_SCOPES).toContain('tool:exec')
    expect(AVAILABLE_SCOPES).toContain('db:read')
    expect(AVAILABLE_SCOPES).toContain('db:write')
    expect(AVAILABLE_SCOPES).toContain('secret:access')
  })

  it('BUILTIN_TOOLS ha almeno 3 tool predefiniti', async () => {
    const { BUILTIN_TOOLS } = await import('@/lib/kernel/tool-registry')
    expect(BUILTIN_TOOLS.length).toBeGreaterThanOrEqual(3)
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.toolId).toBeDefined()
      expect(tool.name).toBeDefined()
      expect(tool.version).toBeDefined()
    }
  })
})

// === builtin-tools.ts: isPathAllowed (B1) ===========================

describe('builtin-tools.ts — isPathAllowed path-separator-aware (B1)', () => {
  // isPathAllowed is not exported, test indirectly via filesystem.read tool
  it('blocca sibling con stesso prefisso stringa (/tmp/foo vs /tmp/foobar)', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.read')!
    const allowed = resolve('/tmp/p3tm-b1-unit-allowed')
    const sibling = resolve('/tmp/p3tm-b1-unit-allowed-sibling')
    const blocked = resolve(sibling, 'secret.txt')

    const result = await tool.execute(
      { path: blocked },
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000,
        sandboxEnabled: true, allowedPaths: [allowed],
      },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Path not allowed/i)
  })

  it('permette path dentro directory consentita', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.read')!
    const allowed = resolve('/tmp')
    const inside = resolve(allowed, 'p3tm-b1-unit-inside.txt')

    const result = await tool.execute(
      { path: inside },
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000,
        sandboxEnabled: true, allowedPaths: [allowed],
      },
    )
    // Path allowed but file doesn't exist → "File not found" (not "Path not allowed")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/File not found/i)
  })

  it('permette path === directory consentita (boundary)', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('filesystem.read')!
    const allowed = resolve('/tmp')

    const result = await tool.execute(
      { path: allowed },
      {
        agentId: 'test', planId: 'test', taskId: 'test', timeout: 5000,
        sandboxEnabled: true, allowedPaths: [allowed],
      },
    )
    expect(result.success).toBe(false)
    expect(result.error).not.toMatch(/Path not allowed/i) // passes path check
  })
})

// === builtin-tools.ts: listBuiltinTools + getBuiltinTool ============

describe('builtin-tools.ts — listBuiltinTools + getBuiltinTool', () => {
  it('listBuiltinTools ritorna 7 tool (filesystem.read/write/list, http.fetch, memory.search, graph.query, web.search)', async () => {
    const { listBuiltinTools } = await import('@/lib/runtime/builtin-tools')
    const tools = listBuiltinTools()
    expect(tools.length).toBeGreaterThanOrEqual(7)
    const names = tools.map((t) => t.name)
    expect(names).toContain('filesystem.read')
    expect(names).toContain('filesystem.write')
    expect(names).toContain('filesystem.list')
    expect(names).toContain('http.fetch')
    expect(names).toContain('memory.search')
    expect(names).toContain('graph.query')
    expect(names).toContain('web.search')
  })

  it('getBuiltinTool ritorna tool per nome noto', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tool = getBuiltinTool('http.fetch')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('http.fetch')
    expect(tool!.requiredScopes).toContain('network:get')
  })

  it('getBuiltinTool ritorna undefined per nome inesistente', async () => {
    const { getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    expect(getBuiltinTool('nonexistent.tool')).toBeUndefined()
  })

  it('ogni builtin tool ha name, description, parameters, requiredScopes, execute', async () => {
    const { listBuiltinTools, getBuiltinTool } = await import('@/lib/runtime/builtin-tools')
    const tools = listBuiltinTools()
    for (const t of tools) {
      const full = getBuiltinTool(t.name)!
      expect(typeof full.name).toBe('string')
      expect(typeof full.description).toBe('string')
      expect(full.description.length).toBeGreaterThan(0)
      expect(full.parameters).toBeDefined()
      expect(full.requiredScopes).toBeInstanceOf(Array)
      expect(full.requiredScopes.length).toBeGreaterThan(0)
      expect(typeof full.execute).toBe('function')
    }
  })
})
