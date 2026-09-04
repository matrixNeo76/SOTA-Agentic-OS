/**
 * Integration tests for Tool Manager Fase A
 * (C1, C2, C3)
 *
 * C1 — listTools() usa include permissions (no N+1)
 * C2 — setPermission() usa upsert (no race condition, @@unique(toolId, scope))
 * C3 — ToolPermission.toolId ha @relation to Tool.id + onDelete Cascade + @@unique
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db'

const TEST_PREFIX = 'tm-faseA-'

async function cleanupFixtures() {
  // Delete ToolPermission first (FK constraint)
  const tools = await db.tool.findMany({ where: { toolId: { startsWith: TEST_PREFIX } }, select: { id: true } })
  if (tools.length > 0) {
    const toolIds = tools.map(t => t.id)
    await db.toolPermission.deleteMany({ where: { toolId: { in: toolIds } } })
    await db.tool.deleteMany({ where: { id: { in: toolIds } } })
  }
  await db.agentLog.deleteMany({ where: { agentId: 'tool-registry' } })
}

vi.mock('@/lib/ws-publish', () => ({
  publishAgentEvent: vi.fn().mockResolvedValue(undefined),
}))

// === C3: Schema Prisma relation + unique constraint ===============

describe('Fase A — C3: ToolPermission relation + @@unique + onDelete Cascade', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('schema.prisma ha @relation ToolPermission→Tool con onDelete Cascade', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'prisma/schema.prisma'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix[\s\S]*foreign key to Tool\.id \+ onDelete Cascade/)
    expect(content).toMatch(/tool\s+Tool\s+@relation\(fields: \[toolId\], references: \[id\], onDelete: Cascade\)/)
  })

  it('schema.prisma ha @@unique([toolId, scope]) su ToolPermission', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'prisma/schema.prisma'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*unique constraint per prevenire duplicati/)
    expect(content).toMatch(/@@unique\(\[toolId, scope\]\)/)
  })

  it('schema.prisma ha permissions ToolPermission[] su Tool model', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'prisma/schema.prisma'),
      'utf-8',
    )
    expect(content).toMatch(/C3 fix[\s\S]*relation to ToolPermission for cascade delete/)
    expect(content).toMatch(/permissions\s+ToolPermission\[\]/)
  })

  it('onDelete Cascade: tool delete rimuove le sue permissions', async () => {
    const { installTool, setPermission } = await import('@/lib/kernel/tool-registry')
    // Installa tool + setta permission
    const result = await installTool({
      toolId: `${TEST_PREFIX}cascade`,
      name: 'Cascade Test',
      version: '1.0.0',
      publisher: 'test',
    })
    await setPermission(`${TEST_PREFIX}cascade`, 'filesystem:read', true, 'admin')

    // Verifica permission esiste
    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}cascade` } })
    const permsBefore = await db.toolPermission.count({ where: { toolId: tool!.id } })
    expect(permsBefore).toBeGreaterThan(0)

    // C3: delete tool → permissions devono essere rimosse dal cascade
    await db.tool.delete({ where: { id: tool!.id } })

    const permsAfter = await db.toolPermission.count({ where: { toolId: tool!.id } })
    expect(permsAfter).toBe(0)  // cascade delete
  })
})

// === C2: setPermission upsert (no race condition) =================

describe('Fase A — C2: setPermission upsert (no race condition)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('tool-registry.ts ha C2 fix comment (upsert)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/tool-registry.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C2 fix[\s\S]*upsert invece di findFirst\+create/)
    expect(content).toMatch(/upsert atomico \(no race condition\)/)
  })

  it('setPermission usa upsert (non findFirst+create)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/tool-registry.ts'),
      'utf-8',
    )
    expect(content).toMatch(/db\.toolPermission\.upsert\(/)
    expect(content).toMatch(/toolId_scope:/)
    // Non deve più usare findFirst per setPermission
    const setPermMatch = content.match(/export async function setPermission[\s\S]*?\n\}/)
    expect(setPermMatch).not.toBeNull()
    expect(setPermMatch![0]).not.toMatch(/findFirst/)
  })

  it('setPermission crea permission se non esistente', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}create`,
      name: 'Create Test',
      version: '1.0.0',
      publisher: 'test',
    })
    await setPermission(`${TEST_PREFIX}create`, 'filesystem:read', true, 'admin')
    const check = await checkToolPermission(`${TEST_PREFIX}create`, 'filesystem:read')
    expect(check.authorized).toBe(true)
  })

  it('setPermission aggiorna permission esistente (upsert)', async () => {
    const { installTool, setPermission, checkToolPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}update`,
      name: 'Update Test',
      version: '1.0.0',
      publisher: 'test',
    })
    // Prima: granted=true
    await setPermission(`${TEST_PREFIX}update`, 'filesystem:read', true, 'admin')
    let check = await checkToolPermission(`${TEST_PREFIX}update`, 'filesystem:read')
    expect(check.authorized).toBe(true)

    // Poi: granted=false (update, non create)
    await setPermission(`${TEST_PREFIX}update`, 'filesystem:read', false, 'admin')
    check = await checkToolPermission(`${TEST_PREFIX}update`, 'filesystem:read')
    expect(check.authorized).toBe(false)
  })

  it('setPermission con stessa scope non crea duplicato (unique constraint)', async () => {
    const { installTool, setPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}nodup`,
      name: 'NoDup Test',
      version: '1.0.0',
      publisher: 'test',
    })
    // Chiamata 1: crea
    await setPermission(`${TEST_PREFIX}nodup`, 'network:get', true, 'admin')
    // Chiamata 2: upsert (aggiorna, non crea duplicato)
    await setPermission(`${TEST_PREFIX}nodup`, 'network:get', false, 'admin')

    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}nodup` } })
    const perms = await db.toolPermission.findMany({
      where: { toolId: tool!.id, scope: 'network:get' },
    })
    expect(perms.length).toBe(1)  // no duplicato
    expect(perms[0]!.granted).toBe(false)  // aggiornato
  })
})

// === C1: listTools include permissions (no N+1) ===================

describe('Fase A — C1: listTools include permissions (no N+1)', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('tool-registry.ts ha C1 fix comment (include)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/tool-registry.ts'),
      'utf-8',
    )
    expect(content).toMatch(/C1 fix[\s\S]*include permissions \(no N\+1\)/)
    expect(content).toMatch(/include: \{ permissions: true \}/)
  })

  it('listTools non ha più loop con findMany dentro for', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/kernel/tool-registry.ts'),
      'utf-8',
    )
    // Estrai il corpo di listTools
    const listMatch = content.match(/export async function listTools[\s\S]*?\n\}/)
    expect(listMatch).not.toBeNull()
    const listBody = listMatch![0]
    // Non deve contenere un loop for con db.toolPermission.findMany dentro
    expect(listBody).not.toMatch(/for \(const t of tools\)/)
    expect(listBody).not.toMatch(/await db\.toolPermission\.findMany/)
    // Deve usare include
    expect(listBody).toMatch(/include: \{ permissions: true \}/)
  })

  it('listTools ritorna tool con permissions annesse', async () => {
    const { installTool, setPermission, listTools } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}list`,
      name: 'List Test',
      version: '1.0.0',
      publisher: 'test',
    })
    await setPermission(`${TEST_PREFIX}list`, 'filesystem:read', true, 'admin')
    await setPermission(`${TEST_PREFIX}list`, 'network:get', false, 'admin')

    const tools = await listTools()
    const myTool = tools.find((t: any) => t.toolId === `${TEST_PREFIX}list`)
    expect(myTool).toBeDefined()
    expect(myTool!.permissions).toBeDefined()
    expect(myTool!.permissions.length).toBeGreaterThanOrEqual(2)
    expect(myTool!.grantedCount).toBeGreaterThanOrEqual(1)  // filesystem:read granted
    expect(myTool!.totalCount).toBeGreaterThanOrEqual(2)
  })

  it('listTools includeRevoked=false filtra tool revocati', async () => {
    const { installTool, revokeTool, listTools } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}revoked`,
      name: 'Revoked Test',
      version: '1.0.0',
      publisher: 'test',
    })
    await revokeTool(`${TEST_PREFIX}revoked`, 'test revoke')

    const activeTools = await listTools(false)
    const revokedTool = activeTools.find((t: any) => t.toolId === `${TEST_PREFIX}revoked`)
    expect(revokedTool).toBeUndefined()  // filtrato

    const allTools = await listTools(true)
    const revokedInAll = allTools.find((t: any) => t.toolId === `${TEST_PREFIX}revoked`)
    expect(revokedInAll).toBeDefined()  // incluso con includeRevoked=true
  })
})

// === Smoke: full Fase A integration ================================

describe('Fase A — Smoke: full C1+C2+C3 integration', () => {
  beforeEach(async () => { await cleanupFixtures() })
  afterEach(async () => { await cleanupFixtures() })

  it('installTool → setPermission (upsert) → listTools (include) → checkPermission lifecycle', async () => {
    const { installTool, setPermission, listTools, checkToolPermission } = await import('@/lib/kernel/tool-registry')

    // Installa tool
    const result = await installTool({
      toolId: `${TEST_PREFIX}smoke`,
      name: 'Smoke Test',
      version: '1.0.0',
      publisher: 'test',
    })
    expect(result.toolId).toBe(`${TEST_PREFIX}smoke`)

    // Setta 2 permissions (C2: upsert)
    await setPermission(`${TEST_PREFIX}smoke`, 'filesystem:read', true, 'admin')
    await setPermission(`${TEST_PREFIX}smoke`, 'network:get', true, 'admin')

    // Verifica checkPermission
    const check1 = await checkToolPermission(`${TEST_PREFIX}smoke`, 'filesystem:read')
    expect(check1.authorized).toBe(true)
    const check2 = await checkToolPermission(`${TEST_PREFIX}smoke`, 'network:get')
    expect(check2.authorized).toBe(true)

    // listTools con include (C1: no N+1)
    const tools = await listTools()
    const myTool = tools.find((t: any) => t.toolId === `${TEST_PREFIX}smoke`)
    expect(myTool).toBeDefined()
    expect(myTool!.permissions.length).toBeGreaterThanOrEqual(2)
    expect(myTool!.grantedCount).toBeGreaterThanOrEqual(2)

    // C2: upsert update (non duplicato)
    await setPermission(`${TEST_PREFIX}smoke`, 'filesystem:read', false, 'admin')
    const check3 = await checkToolPermission(`${TEST_PREFIX}smoke`, 'filesystem:read')
    expect(check3.authorized).toBe(false)  // aggiornato a false

    // Verifica no duplicato
    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}smoke` } })
    const perms = await db.toolPermission.findMany({ where: { toolId: tool!.id, scope: 'filesystem:read' } })
    expect(perms.length).toBe(1)
  })

  it('C3 smoke: cascade delete rimuove permissions', async () => {
    const { installTool, setPermission } = await import('@/lib/kernel/tool-registry')
    await installTool({
      toolId: `${TEST_PREFIX}cascade-smoke`,
      name: 'Cascade Smoke',
      version: '1.0.0',
      publisher: 'test',
    })
    await setPermission(`${TEST_PREFIX}cascade-smoke`, 'filesystem:read', true, 'admin')
    await setPermission(`${TEST_PREFIX}cascade-smoke`, 'network:get', true, 'admin')

    const tool = await db.tool.findUnique({ where: { toolId: `${TEST_PREFIX}cascade-smoke` } })
    const permsBefore = await db.toolPermission.count({ where: { toolId: tool!.id } })
    expect(permsBefore).toBeGreaterThanOrEqual(2)

    // C3: delete tool → cascade delete permissions
    await db.tool.delete({ where: { id: tool!.id } })
    const permsAfter = await db.toolPermission.count({ where: { toolId: tool!.id } })
    expect(permsAfter).toBe(0)
  })
})
