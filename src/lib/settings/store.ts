/**
 * Settings Store — C6
 *
 * Runtime-writable system settings with in-memory cache + invalidation.
 *
 * Merge priority (highest wins): DB > env > default
 *
 * Writable at runtime (hot-swap, no restart):
 *   - llm.default_model            default LLM model id (e.g. 'zai-glm', 'glm-4.6')
 *   - llm.fallback_enabled         use deterministic fallback when LLM unavailable
 *   - llm.max_tokens               default max tokens for LLM responses
 *   - tool.allowed_read_paths      CSV whitelist for filesystem.read
 *   - tool.allowed_write_paths     CSV whitelist for filesystem.write
 *   - mesh.backend                 'memory' | 'nats' | 'redis'
 *   - observability.langfuse_enabled
 *   - embedding.provider           'local' | 'ollama' | 'openai'
 *   - embedding.ollama_model       Ollama embedding model name
 *   - mcp.external_servers         CSV list of MCP server URLs
 *
 * Read-only (require restart):
 *   - database.url                 DATABASE_URL
 *   - server.port                  server port
 *
 * Cache invalidation:
 *   - setSetting() / deleteSetting() update the cache eagerly after DB write.
 *   - reloadCache() re-reads everything from DB (use after manual DB edits).
 *   - Tests can call __resetCacheForTests() to start from a clean state.
 */

import { db } from '@/lib/db'

// === Types ===========================================================

export type SettingSource = 'db' | 'env' | 'default'

export interface SettingDef {
  key: string
  category: string
  defaultValue: string
  readOnly: boolean
  description: string
  /**
   * C6.2 — Sensitive settings (API keys, secrets). When true:
   *   - GET /api/admin/settings returns a masked value (****<last4>) instead of the real value
   *   - UI renders a password input with show/hide toggle
   *   - POST with an empty string or '****' is a no-op (keeps the existing value)
   *   - POST with a new value overwrites the stored value
   * This prevents accidental leakage of secrets in the UI while still allowing
   * admins to rotate keys at runtime.
   */
  sensitive?: boolean
}

export interface SettingValue {
  key: string
  value: string
  category: string
  readOnly: boolean
  description: string
  source: SettingSource
  sensitive: boolean
  updatedAt?: Date
  updatedBy?: string | null
}

export interface SetResult {
  set: boolean
  reason?: string
  previousValue?: string
  newValue?: string
  source?: SettingSource
}

// === Setting definitions =============================================
//
// Single source of truth for the schema of writable settings.
// Adding a new setting = add a row here + (optionally) an env mapping below.

export const SETTING_DEFS: SettingDef[] = [
  // LLM
  {
    key: 'llm.default_model',
    category: 'llm',
    defaultValue: 'zai-glm',
    readOnly: false,
    description: 'Default LLM model id used by completions and agent loops',
  },
  {
    key: 'llm.fallback_enabled',
    category: 'llm',
    defaultValue: 'true',
    readOnly: false,
    description: 'Use deterministic fallback when LLM provider is unavailable',
  },
  {
    key: 'llm.max_tokens',
    category: 'llm',
    defaultValue: '500',
    readOnly: false,
    description: 'Default max tokens for LLM responses',
  },
  {
    key: 'llm.api_key',
    category: 'llm',
    defaultValue: '',
    readOnly: false,
    sensitive: true,
    description: 'LLM provider API key (ZAI_API_KEY). Leave empty to use ambient credentials.',
  },
  // Tools
  {
    key: 'tool.allowed_read_paths',
    category: 'tools',
    defaultValue: '/tmp',
    readOnly: false,
    description: 'Comma-separated whitelist of allowed read paths for filesystem.read',
  },
  {
    key: 'tool.allowed_write_paths',
    category: 'tools',
    defaultValue: '/tmp',
    readOnly: false,
    description: 'Comma-separated whitelist of allowed write paths for filesystem.write',
  },
  // Mesh
  {
    key: 'mesh.backend',
    category: 'mesh',
    defaultValue: 'memory',
    readOnly: false,
    description: 'Event mesh backend: memory | nats | redis',
  },
  {
    key: 'mesh.nats_url',
    category: 'mesh',
    defaultValue: '',
    readOnly: false,
    description: 'NATS server URL (required when mesh.backend=nats). e.g. nats://localhost:4222',
  },
  {
    key: 'mesh.redis_url',
    category: 'mesh',
    defaultValue: '',
    readOnly: false,
    description: 'Redis server URL (required when mesh.backend=redis). e.g. redis://localhost:6379',
  },
  // Observability
  {
    key: 'observability.langfuse_enabled',
    category: 'observability',
    defaultValue: 'false',
    readOnly: false,
    description: 'Enable Langfuse trace export',
  },
  {
    key: 'observability.langfuse_url',
    category: 'observability',
    defaultValue: '',
    readOnly: false,
    description: 'Langfuse server URL (e.g. http://localhost:3001)',
  },
  {
    key: 'observability.langfuse_public_key',
    category: 'observability',
    defaultValue: '',
    readOnly: false,
    sensitive: true,
    description: 'Langfuse public key for trace export',
  },
  {
    key: 'observability.langfuse_secret_key',
    category: 'observability',
    defaultValue: '',
    readOnly: false,
    sensitive: true,
    description: 'Langfuse secret key for trace export',
  },
  // Embedding
  {
    key: 'embedding.provider',
    category: 'embedding',
    defaultValue: 'local',
    readOnly: false,
    description: 'Embedding provider: local | ollama | openai',
  },
  {
    key: 'embedding.ollama_model',
    category: 'embedding',
    defaultValue: 'bge-m3',
    readOnly: false,
    description: 'Ollama embedding model name',
  },
  {
    key: 'embedding.ollama_url',
    category: 'embedding',
    defaultValue: '',
    readOnly: false,
    description: 'Ollama base URL (required when embedding.provider=ollama). e.g. http://localhost:11434',
  },
  {
    key: 'embedding.openai_api_key',
    category: 'embedding',
    defaultValue: '',
    readOnly: false,
    sensitive: true,
    description: 'OpenAI API key for embeddings (required when embedding.provider=openai)',
  },
  // MCP
  {
    key: 'mcp.external_servers',
    category: 'mcp',
    defaultValue: '',
    readOnly: false,
    description: 'Comma-separated list of external MCP server URLs',
  },
  // Read-only (require restart)
  {
    key: 'database.url',
    category: 'database',
    defaultValue: '(from DATABASE_URL env)',
    readOnly: true,
    description: 'Database connection URL — requires restart',
  },
  {
    key: 'server.port',
    category: 'server',
    defaultValue: '3000',
    readOnly: true,
    description: 'Server port — requires restart',
  },
]

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]))

// === Cache ===========================================================

interface CacheEntry {
  value: string
  source: SettingSource
  updatedAt?: Date
  updatedBy?: string | null
}

const _cache = new Map<string, CacheEntry>()
let _cacheLoaded = false
let _loadPromise: Promise<void> | null = null

// === Public API ======================================================

/**
 * Get a single setting by key. Triggers a cache load on first call.
 * Returns null if the key is not in SETTING_DEFS.
 */
export async function getSetting(key: string): Promise<SettingValue | null> {
  const def = DEF_BY_KEY.get(key)
  if (!def) return null

  await ensureCacheLoaded()
  const cached = _cache.get(key)
  if (!cached) return null

  const sensitive = def.sensitive ?? false
  return {
    key,
    value: sensitive ? maskSensitiveValue(cached.value) : cached.value,
    category: def.category,
    readOnly: def.readOnly,
    description: def.description,
    source: cached.source,
    sensitive,
    updatedAt: cached.updatedAt,
    updatedBy: cached.updatedBy ?? null,
  }
}

/**
 * Get all known settings (defaults, env-overridden, and DB-overridden).
 * Sensitive values are masked so they never leak to the browser.
 */
export async function getAllSettings(): Promise<SettingValue[]> {
  await ensureCacheLoaded()
  return SETTING_DEFS.map((def) => {
    const cached = _cache.get(def.key)!
    const sensitive = def.sensitive ?? false
    return {
      key: def.key,
      value: sensitive ? maskSensitiveValue(cached.value) : cached.value,
      category: def.category,
      readOnly: def.readOnly,
      description: def.description,
      source: cached.source,
      sensitive,
      updatedAt: cached.updatedAt,
      updatedBy: cached.updatedBy ?? null,
    }
  })
}

/**
 * Persist a new value to the DB and update the cache eagerly.
 * Refuses unknown keys and read-only keys.
 * For sensitive keys: if value is empty or the mask sentinel (****), treats
 * it as a no-op and keeps the existing value (so the admin can change other
 * fields in the same form without accidentally wiping the API key).
 */
export async function setSetting(
  key: string,
  value: string,
  updatedBy: string,
): Promise<SetResult> {
  const def = DEF_BY_KEY.get(key)
  if (!def) return { set: false, reason: `Unknown setting: ${key}` }
  if (def.readOnly) {
    return { set: false, reason: `Setting ${key} is read-only (requires restart)` }
  }

  await ensureCacheLoaded()
  const previous = _cache.get(key)

  // Sensitive no-op: user submitted the mask or empty string, meaning
  // "don't change this field". Return success without writing.
  if ((def.sensitive ?? false) && isMaskSentinel(value)) {
    return {
      set: true,
      previousValue: previous?.value ? maskSensitiveValue(previous.value) : '',
      newValue: previous?.value ? maskSensitiveValue(previous.value) : '',
      source: previous?.source ?? 'default',
    }
  }

  await db.systemSetting.upsert({
    where: { key },
    create: { key, value, category: def.category, readOnly: false, updatedBy },
    update: { value, updatedBy },
  })

  _cache.set(key, { value, source: 'db', updatedAt: new Date(), updatedBy })

  return {
    set: true,
    previousValue: def.sensitive ? (previous?.value ? maskSensitiveValue(previous.value) : '') : previous?.value,
    newValue: def.sensitive ? maskSensitiveValue(value) : value,
    source: 'db',
  }
}

/**
 * Delete the DB override for a key. The setting falls back to env or default.
 */
export async function deleteSetting(key: string): Promise<{ deleted: boolean; revertedTo?: string; source?: SettingSource }> {
  const def = DEF_BY_KEY.get(key)
  if (!def) return { deleted: false }

  await db.systemSetting.deleteMany({ where: { key } })

  const envValue = getEnvValue(def.key)
  const revertedValue = envValue || def.defaultValue
  const revertedSource: SettingSource = envValue ? 'env' : 'default'
  _cache.set(key, { value: revertedValue, source: revertedSource })

  return { deleted: true, revertedTo: revertedValue, source: revertedSource }
}

/**
 * Reload everything from the DB. Use after manual DB edits or in tests.
 */
export async function reloadCache(): Promise<void> {
  _cacheLoaded = false
  _loadPromise = null
  await ensureCacheLoaded()
}

// === Synchronous cached readers =====================================
//
// Use these in hot paths where you can't await. They return the last value
// seen by the cache. The cache is populated lazily on first async access;
// call reloadCache() once during boot if you need the very first sync read
// to be correct.

export function getCachedSetting(key: string): string | null {
  const cached = _cache.get(key)
  return cached?.value ?? null
}

export function getCachedBool(key: string, fallback = false): boolean {
  const val = getCachedSetting(key)
  if (val === null || val === undefined) return fallback
  return val === 'true' || val === '1' || val === 'yes' || val === 'on'
}

export function getCachedNumber(key: string, fallback = 0): number {
  const val = getCachedSetting(key)
  if (val === null || val === undefined) return fallback
  const num = Number(val)
  return Number.isNaN(num) ? fallback : num
}

export function getCachedArray(key: string): string[] {
  const val = getCachedSetting(key)
  if (!val) return []
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isCacheLoaded(): boolean {
  return _cacheLoaded
}

// === Internal ========================================================

async function ensureCacheLoaded(): Promise<void> {
  if (_cacheLoaded) return
  if (_loadPromise) return _loadPromise
  _loadPromise = loadCache().catch((err) => {
    // Reset promise so the next call retries.
    _loadPromise = null
    // Re-throw: callers should see the failure, but cache stays usable
    // (populated with defaults + env, no DB layer).
    throw err
  })
  return _loadPromise
}

async function loadCache(): Promise<void> {
  // Layer 1: defaults
  for (const def of SETTING_DEFS) {
    _cache.set(def.key, { value: def.defaultValue, source: 'default' })
  }

  // Layer 2: env overrides
  for (const def of SETTING_DEFS) {
    const envValue = getEnvValue(def.key)
    if (envValue) {
      _cache.set(def.key, { value: envValue, source: 'env' })
    }
  }

  // Layer 3: DB overrides
  try {
    const dbSettings = await db.systemSetting.findMany()
    for (const s of dbSettings) {
      const def = DEF_BY_KEY.get(s.key)
      if (!def) continue // unknown key in DB — skip
      _cache.set(s.key, {
        value: s.value,
        source: 'db',
        updatedAt: s.updatedAt,
        updatedBy: s.updatedBy,
      })
    }
  } catch {
    // DB not ready (e.g. during migration). Use defaults + env only.
  }

  _cacheLoaded = true
}

function getEnvValue(key: string): string | null {
  const envMap: Record<string, string> = {
    'llm.default_model': process.env.ZAI_MODEL || process.env.LLM_DEFAULT_MODEL || '',
    'llm.fallback_enabled': process.env.LLM_FALLBACK_ENABLED || '',
    'llm.max_tokens': process.env.LLM_MAX_TOKENS || '',
    'llm.api_key': process.env.ZAI_API_KEY || '',
    'tool.allowed_read_paths': process.env.TOOL_ALLOWED_READ_PATHS || '',
    'tool.allowed_write_paths': process.env.TOOL_ALLOWED_WRITE_PATHS || '',
    'mesh.backend':
      process.env.MESH_BACKEND ||
      (process.env.NATS_URL ? 'nats' : process.env.REDIS_URL ? 'redis' : ''),
    'mesh.nats_url': process.env.NATS_URL || '',
    'mesh.redis_url': process.env.REDIS_URL || '',
    'observability.langfuse_enabled': process.env.LANGFUSE_URL ? 'true' : '',
    'observability.langfuse_url': process.env.LANGFUSE_URL || '',
    'observability.langfuse_public_key': process.env.LANGFUSE_PUBLIC_KEY || '',
    'observability.langfuse_secret_key': process.env.LANGFUSE_SECRET_KEY || '',
    'embedding.provider': process.env.EMBEDDING_PROVIDER || '',
    'embedding.ollama_model': process.env.OLLAMA_EMBED_MODEL || '',
    'embedding.ollama_url': process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || '',
    'embedding.openai_api_key': process.env.OPENAI_API_KEY || '',
    'mcp.external_servers': process.env.MCP_EXTERNAL_SERVERS || '',
    'database.url': process.env.DATABASE_URL || '',
    'server.port': process.env.PORT || '',
  }
  return envMap[key] || null
}

// === Sensitive masking ==============================================
//
// Sensitive settings (API keys, secrets) are masked in GET responses so the
// real value is never sent to the browser. The mask shows the last 4 chars
// so the admin can verify "is this the key I think it is?" without seeing
// the full secret. POST with the mask string (or empty string) is a no-op.

export function maskSensitiveValue(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `****${value.slice(-4)}`
}

/**
 * Returns true if the given value is the mask sentinel or empty — meaning
 * the user didn't actually change the sensitive field. setSetting() uses
 * this to skip the DB write and keep the existing value.
 */
export function isMaskSentinel(value: string): boolean {
  return value === '' || value === '****' || /^(\*+)$/.test(value)
}

// === Test-only helpers ==============================================

/**
 * Reset cache to a pristine state. Intended for unit tests only.
 * In production code use reloadCache() instead.
 */
export async function __resetCacheForTests(): Promise<void> {
  _cache.clear()
  _cacheLoaded = false
  _loadPromise = null
}

// === Boot ============================================================
//
// Kick off the first cache load in the background. Failures are swallowed
// here; the first explicit getSetting() call will surface them via the
// retry path in ensureCacheLoaded().

if (typeof process !== 'undefined' && !process.env.DISABLE_SETTINGS_BOOTLOAD) {
  loadCache().catch(() => {
    /* ignored — getSetting() will retry */
  })
}
