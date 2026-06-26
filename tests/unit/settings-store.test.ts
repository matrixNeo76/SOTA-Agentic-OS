/**
 * Unit tests for C6 settings store.
 *
 * Covers:
 *   - Default values when DB + env are absent
 *   - Env override priority (env > default)
 *   - DB override priority (DB > env > default)
 *   - Writable key round-trip (set → get → delete)
 *   - Read-only key rejection
 *   - Unknown key rejection
 *   - Cache invalidation via reloadCache()
 *   - Sync helpers: getCachedSetting / getCachedBool / getCachedNumber / getCachedArray
 *   - Cache loaded flag transitions
 *
 * NOTE on the env layer: env values are read once at module load. To test
 * env-priority deterministically we set process.env BEFORE importing the
 * store, OR we use the fact that loadCache() re-reads env on every reload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// We import dynamically per-test so we can manipulate env + DB state cleanly.
async function importStore() {
  // Bust the module cache so a fresh module instance picks up env changes.
  vi.resetModules()
  return (await import('@/lib/settings/store')) as typeof import('@/lib/settings/store')
}

const WRITABLE_KEYS = [
  'llm.default_model',
  'llm.fallback_enabled',
  'llm.max_tokens',
  'llm.api_key',
  'tool.allowed_read_paths',
  'tool.allowed_write_paths',
  'mesh.backend',
  'mesh.nats_url',
  'mesh.redis_url',
  'observability.langfuse_enabled',
  'observability.langfuse_url',
  'observability.langfuse_public_key',
  'observability.langfuse_secret_key',
  'embedding.provider',
  'embedding.ollama_model',
  'embedding.ollama_url',
  'embedding.openai_api_key',
  'mcp.external_servers',
] as const

const READONLY_KEYS = ['database.url', 'server.port'] as const

const SENSITIVE_KEYS = [
  'llm.api_key',
  'observability.langfuse_public_key',
  'observability.langfuse_secret_key',
  'embedding.openai_api_key',
] as const

// === Helpers =========================================================

async function clearSystemSettingsTable(store: typeof import('@/lib/settings/store')) {
  // Reach into the DB directly via the same db client the store uses.
  const { db } = await import('@/lib/db')
  await db.systemSetting.deleteMany({})
}

// === Tests ===========================================================

describe('C6 Settings Store', () => {
  let store: typeof import('@/lib/settings/store')

  beforeEach(async () => {
    // Clear env vars that the store maps, so default layer is the only source.
    for (const key of [
      'ZAI_MODEL',
      'LLM_DEFAULT_MODEL',
      'LLM_FALLBACK_ENABLED',
      'LLM_MAX_TOKENS',
      'TOOL_ALLOWED_READ_PATHS',
      'TOOL_ALLOWED_WRITE_PATHS',
      'MESH_BACKEND',
      'NATS_URL',
      'REDIS_URL',
      'LANGFUSE_URL',
      'EMBEDDING_PROVIDER',
      'OLLAMA_EMBED_MODEL',
      'MCP_EXTERNAL_SERVERS',
      'DATABASE_URL',
      'PORT',
    ]) {
      delete process.env[key]
    }
    // DATABASE_URL is required by Prisma client init.
    process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db'

    store = await importStore()
    await clearSystemSettingsTable(store)
    await store.__resetCacheForTests()
  })

  afterEach(async () => {
    if (store) {
      await clearSystemSettingsTable(store)
      await store.__resetCacheForTests()
    }
  })

  // --- Schema invariants ----------------------------------------------

  it('SETTING_DEFS exposes every expected key', () => {
    const keys = store.SETTING_DEFS.map((d) => d.key).sort()
    expect(keys).toEqual([...WRITABLE_KEYS, ...READONLY_KEYS].sort())
  })

  it('every writable key is marked readOnly=false', () => {
    for (const key of WRITABLE_KEYS) {
      const def = store.SETTING_DEFS.find((d) => d.key === key)!
      expect(def.readOnly).toBe(false)
    }
  })

  it('every read-only key is marked readOnly=true', () => {
    for (const key of READONLY_KEYS) {
      const def = store.SETTING_DEFS.find((d) => d.key === key)!
      expect(def.readOnly).toBe(true)
    }
  })

  // --- Default layer --------------------------------------------------

  it('getAllSettings returns defaults when no env and no DB', async () => {
    await store.reloadCache()
    const all = await store.getAllSettings()
    expect(all.length).toBe(store.SETTING_DEFS.length)

    const llmModel = all.find((s) => s.key === 'llm.default_model')!
    expect(llmModel.value).toBe('zai-glm')
    expect(llmModel.source).toBe('default')
  })

  it('getSetting returns null for unknown key', async () => {
    await store.reloadCache()
    expect(await store.getSetting('does.not.exist')).toBeNull()
  })

  // --- Env layer ------------------------------------------------------

  it('env value beats default', async () => {
    process.env.ZAI_MODEL = 'env-glm-4.6'
    await store.reloadCache()
    const v = await store.getSetting('llm.default_model')
    expect(v?.value).toBe('env-glm-4.6')
    expect(v?.source).toBe('env')
  })

  it('LANGFUSE_URL presence enables observability.langfuse_enabled via env', async () => {
    process.env.LANGFUSE_URL = 'https://lf.example.com'
    await store.reloadCache()
    const v = await store.getSetting('observability.langfuse_enabled')
    expect(v?.value).toBe('true')
    expect(v?.source).toBe('env')
  })

  it('NATS_URL presence switches mesh.backend to nats via env', async () => {
    process.env.NATS_URL = 'nats://localhost:4222'
    await store.reloadCache()
    const v = await store.getSetting('mesh.backend')
    expect(v?.value).toBe('nats')
    expect(v?.source).toBe('env')
  })

  // --- DB layer -------------------------------------------------------

  it('DB value beats env and default', async () => {
    process.env.ZAI_MODEL = 'env-glm-4.6'
    await store.reloadCache() // load env layer

    // Now write a DB override via the store itself (which uses the same db client)
    const res = await store.setSetting('llm.default_model', 'db-glm-4.5', 'tester')
    expect(res.set).toBe(true)
    expect(res.previousValue).toBe('env-glm-4.6')
    expect(res.newValue).toBe('db-glm-4.5')

    const v = await store.getSetting('llm.default_model')
    expect(v?.value).toBe('db-glm-4.5')
    expect(v?.source).toBe('db')
    expect(v?.updatedBy).toBe('tester')
  })

  it('setSetting rejects unknown keys', async () => {
    await store.reloadCache()
    const res = await store.setSetting('unknown.key', 'x', 'tester')
    expect(res.set).toBe(false)
    expect(res.reason).toMatch(/Unknown setting/)
  })

  it('setSetting rejects read-only keys', async () => {
    await store.reloadCache()
    const res = await store.setSetting('database.url', 'postgres://x', 'tester')
    expect(res.set).toBe(false)
    expect(res.reason).toMatch(/read-only/)
  })

  it('setSetting is idempotent on repeat writes', async () => {
    await store.reloadCache()
    await store.setSetting('mesh.backend', 'redis', 'tester')
    const second = await store.setSetting('mesh.backend', 'redis', 'tester')
    expect(second.set).toBe(true)
    expect(second.previousValue).toBe('redis')
  })

  // --- Delete / revert ------------------------------------------------

  it('deleteSetting reverts to env when env is set', async () => {
    process.env.ZAI_MODEL = 'env-glm-4.6'
    await store.reloadCache()
    await store.setSetting('llm.default_model', 'db-override', 'tester')

    const after = await store.getSetting('llm.default_model')
    expect(after?.source).toBe('db')

    const del = await store.deleteSetting('llm.default_model')
    expect(del.deleted).toBe(true)
    expect(del.source).toBe('env')
    expect(del.revertedTo).toBe('env-glm-4.6')

    const reverted = await store.getSetting('llm.default_model')
    expect(reverted?.source).toBe('env')
    expect(reverted?.value).toBe('env-glm-4.6')
  })

  it('deleteSetting reverts to default when env is not set', async () => {
    await store.reloadCache()
    await store.setSetting('llm.default_model', 'db-override', 'tester')
    await store.deleteSetting('llm.default_model')

    const reverted = await store.getSetting('llm.default_model')
    expect(reverted?.source).toBe('default')
    expect(reverted?.value).toBe('zai-glm')
  })

  it('deleteSetting on unknown key returns deleted=false', async () => {
    await store.reloadCache()
    const res = await store.deleteSetting('unknown.key')
    expect(res.deleted).toBe(false)
  })

  // --- Cache invalidation --------------------------------------------

  it('reloadCache picks up DB rows written by another caller', async () => {
    await store.reloadCache()

    // Simulate another process writing directly to the DB.
    const { db } = await import('@/lib/db')
    await db.systemSetting.upsert({
      where: { key: 'mesh.backend' },
      create: { key: 'mesh.backend', value: 'redis', category: 'mesh', readOnly: false, updatedBy: 'other-process' },
      update: { value: 'redis', updatedBy: 'other-process' },
    })

    // Cache still has the default.
    const before = await store.getSetting('mesh.backend')
    expect(before?.source).toBe('default')

    // After reload, cache reflects the DB write.
    await store.reloadCache()
    const after = await store.getSetting('mesh.backend')
    expect(after?.source).toBe('db')
    expect(after?.value).toBe('redis')
    expect(after?.updatedBy).toBe('other-process')
  })

  it('setSetting updates cache eagerly without needing reloadCache', async () => {
    await store.reloadCache()
    const before = await store.getSetting('llm.max_tokens')
    expect(before?.value).toBe('500')

    await store.setSetting('llm.max_tokens', '1000', 'tester')

    const after = await store.getSetting('llm.max_tokens')
    expect(after?.value).toBe('1000')
    expect(after?.source).toBe('db')
  })

  // --- Sensitive masking (C6.2) --------------------------------------

  it('sensitive settings list is exactly the expected set', () => {
    const sensitive = store.SETTING_DEFS.filter((d) => d.sensitive === true).map((d) => d.key).sort()
    expect(sensitive).toEqual([...SENSITIVE_KEYS].sort())
  })

  it('getSetting masks sensitive values in the response', async () => {
    await store.reloadCache()
    await store.setSetting('llm.api_key', 'sk-secret-key-12345', 'tester')

    const v = await store.getSetting('llm.api_key')
    expect(v?.sensitive).toBe(true)
    expect(v?.value).toBe('****2345') // last 4 chars visible
    expect(v?.value).not.toContain('secret-key')
  })

  it('getAllSettings masks sensitive values', async () => {
    await store.reloadCache()
    await store.setSetting('observability.langfuse_secret_key', 'sk-lf-secret-abcdef', 'tester')

    const all = await store.getAllSettings()
    const secret = all.find((s) => s.key === 'observability.langfuse_secret_key')!
    expect(secret.sensitive).toBe(true)
    expect(secret.value).toBe('****cdef')
    expect(secret.value).not.toContain('lf-secret')
  })

  it('setSetting with mask sentinel is a no-op (keeps existing value)', async () => {
    await store.reloadCache()
    await store.setSetting('llm.api_key', 'sk-original-key-9999', 'tester')

    // Submit the mask sentinel — should NOT overwrite
    const result = await store.setSetting('llm.api_key', '****', 'tester')
    expect(result.set).toBe(true)

    // Verify the actual stored value is unchanged
    const v = await store.getSetting('llm.api_key')
    expect(v?.value).toBe('****9999') // still the original, masked

    // Also verify via DB directly (the raw value should be the original)
    const { db } = await import('@/lib/db')
    const row = await db.systemSetting.findUnique({ where: { key: 'llm.api_key' } })
    expect(row?.value).toBe('sk-original-key-9999')
  })

  it('setSetting with empty string is also a no-op for sensitive', async () => {
    await store.reloadCache()
    await store.setSetting('llm.api_key', 'sk-keep-this-key', 'tester')

    const result = await store.setSetting('llm.api_key', '', 'tester')
    expect(result.set).toBe(true)

    const { db } = await import('@/lib/db')
    const row = await db.systemSetting.findUnique({ where: { key: 'llm.api_key' } })
    expect(row?.value).toBe('sk-keep-this-key')
  })

  it('non-sensitive settings are NOT masked', async () => {
    await store.reloadCache()
    await store.setSetting('mesh.backend', 'redis', 'tester')

    const v = await store.getSetting('mesh.backend')
    expect(v?.sensitive).toBe(false)
    expect(v?.value).toBe('redis') // raw, not masked
  })

  it('maskSensitiveValue returns **** for short values', () => {
    expect(store.maskSensitiveValue('')).toBe('')
    expect(store.maskSensitiveValue('ab')).toBe('****')
    expect(store.maskSensitiveValue('abcd')).toBe('****')
    expect(store.maskSensitiveValue('abcde')).toBe('****bcde')
    expect(store.maskSensitiveValue('sk-secret-key-12345')).toBe('****2345')
  })

  it('isMaskSentinel detects mask and empty strings', () => {
    expect(store.isMaskSentinel('')).toBe(true)
    expect(store.isMaskSentinel('****')).toBe(true)
    expect(store.isMaskSentinel('******')).toBe(true)
    expect(store.isMaskSentinel('****2345')).toBe(false) // has non-* chars
    expect(store.isMaskSentinel('sk-real-key')).toBe(false)
  })

  // --- Sync helpers ---------------------------------------------------

  it('getCachedSetting returns null before cache is loaded', async () => {
    await store.__resetCacheForTests()
    expect(store.getCachedSetting('llm.default_model')).toBeNull()
    expect(store.isCacheLoaded()).toBe(false)
  })

  it('getCachedSetting returns value after reloadCache', async () => {
    await store.reloadCache()
    expect(store.getCachedSetting('llm.default_model')).toBe('zai-glm')
    expect(store.isCacheLoaded()).toBe(true)
  })

  it('getCachedBool parses true-ish values', async () => {
    await store.reloadCache()
    expect(store.getCachedBool('llm.fallback_enabled')).toBe(true)

    await store.setSetting('llm.fallback_enabled', '0', 'tester')
    expect(store.getCachedBool('llm.fallback_enabled')).toBe(false)

    await store.setSetting('llm.fallback_enabled', 'yes', 'tester')
    expect(store.getCachedBool('llm.fallback_enabled')).toBe(true)
  })

  it('getCachedBool returns fallback for unknown cache state', () => {
    expect(store.getCachedBool('unknown.key', true)).toBe(true)
    expect(store.getCachedBool('unknown.key', false)).toBe(false)
  })

  it('getCachedNumber parses numeric values', async () => {
    await store.reloadCache()
    expect(store.getCachedNumber('llm.max_tokens')).toBe(500)

    await store.setSetting('llm.max_tokens', '2048', 'tester')
    expect(store.getCachedNumber('llm.max_tokens')).toBe(2048)

    await store.setSetting('llm.max_tokens', 'not-a-number', 'tester')
    expect(store.getCachedNumber('llm.max_tokens', -1)).toBe(-1)
  })

  it('getCachedArray splits CSV with whitespace', async () => {
    await store.reloadCache()
    await store.setSetting('tool.allowed_read_paths', ' /tmp , /var/data , /home ', 'tester')
    expect(store.getCachedArray('tool.allowed_read_paths')).toEqual([
      '/tmp',
      '/var/data',
      '/home',
    ])
  })

  it('getCachedArray returns [] for empty value', async () => {
    await store.reloadCache()
    await store.setSetting('mcp.external_servers', '', 'tester')
    expect(store.getCachedArray('mcp.external_servers')).toEqual([])
  })
})
