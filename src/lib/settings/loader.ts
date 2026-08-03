/**
 * Settings Loader — C6
 *
 * Merge priority: DB-override > env > default
 *
 * Settings scrivibili a runtime (non richiedono restart):
 *   - llm.default_model: modello LLM default (es. 'zai-glm', 'glm-4.6')
 *   - llm.fallback_enabled: se true, usa fallback deterministico quando LLM non disponibile
 *   - llm.max_tokens: default max tokens per LLM responses
 *   - tool.allowed_read_paths: path whitelist per filesystem.read
 *   - tool.allowed_write_paths: path whitelist per filesystem.write
 *   - mesh.backend: 'memory' | 'nats' | 'redis'
 *   - observability.langfuse_enabled: true/false
 *   - embedding.provider: 'local' | 'ollama' | 'openai'
 *   - embedding.ollama_model: modello Ollama per embeddings
 *
 * Settings read-only (richiedono restart):
 *   - database.url: DATABASE_URL
 *   - server.port: porta del server
 */

import { db } from '@/lib/db'

// === Tipi ============================================================

export interface SettingDef {
  key: string
  category: string
  defaultValue: string
  readOnly: boolean
  description: string
}

export interface SettingValue {
  key: string
  value: string
  category: string
  readOnly: boolean
  description: string
  source: 'db' | 'env' | 'default'
}

// === Setting definitions =============================================

export const SETTING_DEFS: SettingDef[] = [
  // LLM
  { key: 'llm.default_model', category: 'llm', defaultValue: 'zai-glm', readOnly: false, description: 'Default LLM model for completions' },
  { key: 'llm.fallback_enabled', category: 'llm', defaultValue: 'true', readOnly: false, description: 'Use deterministic fallback when LLM unavailable' },
  { key: 'llm.max_tokens', category: 'llm', defaultValue: '500', readOnly: false, description: 'Default max tokens for LLM responses' },
  // Tools
  { key: 'tool.allowed_read_paths', category: 'tools', defaultValue: '/tmp', readOnly: false, description: 'Comma-separated allowed read paths for filesystem tools' },
  { key: 'tool.allowed_write_paths', category: 'tools', defaultValue: '/tmp', readOnly: false, description: 'Comma-separated allowed write paths for filesystem tools' },
  // Mesh
  { key: 'mesh.backend', category: 'mesh', defaultValue: 'memory', readOnly: false, description: 'Event mesh backend: memory | nats | redis' },
  // Observability
  { key: 'observability.langfuse_enabled', category: 'observability', defaultValue: 'false', readOnly: false, description: 'Enable Langfuse trace export' },
  // Embedding
  { key: 'embedding.provider', category: 'embedding', defaultValue: 'local', readOnly: false, description: 'Embedding provider: local | ollama | openai' },
  { key: 'embedding.ollama_model', category: 'embedding', defaultValue: 'bge-m3', readOnly: false, description: 'Ollama embedding model name' },
  // Read-only (require restart)
  { key: 'database.url', category: 'database', defaultValue: '(from DATABASE_URL env)', readOnly: true, description: 'Database connection URL — requires restart' },
  { key: 'server.port', category: 'server', defaultValue: '3000', readOnly: true, description: 'Server port — requires restart' },
]

// === Cache ===========================================================

const _cache = new Map<string, { value: string; source: 'db' | 'env' | 'default' }>()
let _cacheLoaded = false

// === Public API ======================================================

export async function getSetting(key: string): Promise<SettingValue | null> {
  const def = SETTING_DEFS.find((s) => s.key === key)
  if (!def) return null

  if (!_cacheLoaded) await loadCache()

  const cached = _cache.get(key)
  if (!cached) return null

  return {
    key,
    value: cached.value,
    category: def.category,
    readOnly: def.readOnly,
    description: def.description,
    source: cached.source,
  }
}

export async function getAllSettings(): Promise<SettingValue[]> {
  if (!_cacheLoaded) await loadCache()

  return SETTING_DEFS.map((def) => {
    const cached = _cache.get(def.key)!
    return {
      key: def.key,
      value: cached.value,
      category: def.category,
      readOnly: def.readOnly,
      description: def.description,
      source: cached.source,
    }
  })
}

export async function setSetting(key: string, value: string, updatedBy: string): Promise<{ set: boolean; reason?: string }> {
  const def = SETTING_DEFS.find((s) => s.key === key)
  if (!def) return { set: false, reason: `Unknown setting: ${key}` }
  if (def.readOnly) return { set: false, reason: `Setting ${key} is read-only (requires restart)` }

  await db.systemSetting.upsert({
    where: { key },
    create: { key, value, category: def.category, readOnly: false, updatedBy },
    update: { value, updatedBy },
  })

  _cache.set(key, { value, source: 'db' })

  return { set: true }
}

export async function deleteSetting(key: string): Promise<{ deleted: boolean }> {
  await db.systemSetting.deleteMany({ where: { key } })
  const def = SETTING_DEFS.find((s) => s.key === key)
  if (def) {
    const envValue = getEnvValue(def.key)
    _cache.set(key, { value: envValue || def.defaultValue, source: envValue ? 'env' : 'default' })
  }
  return { deleted: true }
}

export function getCachedSetting(key: string): string | null {
  const cached = _cache.get(key)
  return cached?.value || null
}

export function getCachedBool(key: string, fallback = false): boolean {
  const val = getCachedSetting(key)
  if (val === null) return fallback
  return val === 'true' || val === '1' || val === 'yes'
}

export function getCachedNumber(key: string, fallback = 0): number {
  const val = getCachedSetting(key)
  if (val === null) return fallback
  const num = Number(val)
  return isNaN(num) ? fallback : num
}

export function getCachedArray(key: string): string[] {
  const val = getCachedSetting(key)
  if (!val) return []
  return val.split(',').map((s) => s.trim()).filter(Boolean)
}

export async function reloadCache(): Promise<void> {
  _cacheLoaded = false
  await loadCache()
}

// === Internal ========================================================

async function loadCache(): Promise<void> {
  for (const def of SETTING_DEFS) {
    _cache.set(def.key, { value: def.defaultValue, source: 'default' })
  }

  for (const def of SETTING_DEFS) {
    const envValue = getEnvValue(def.key)
    if (envValue) {
      _cache.set(def.key, { value: envValue, source: 'env' })
    }
  }

  try {
    const dbSettings = await db.systemSetting.findMany()
    for (const setting of dbSettings) {
      _cache.set(setting.key, { value: setting.value, source: 'db' })
    }
  } catch {
    // DB not ready — use defaults + env
  }

  _cacheLoaded = true
}

function getEnvValue(key: string): string | null {
  const envMap: Record<string, string> = {
    'llm.default_model': process.env.ZAI_MODEL || process.env.LLM_DEFAULT_MODEL || '',
    'llm.fallback_enabled': process.env.LLM_FALLBACK_ENABLED || '',
    'llm.max_tokens': process.env.LLM_MAX_TOKENS || '',
    'tool.allowed_read_paths': process.env.TOOL_ALLOWED_READ_PATHS || '',
    'tool.allowed_write_paths': process.env.TOOL_ALLOWED_WRITE_PATHS || '',
    'mesh.backend': process.env.MESH_BACKEND || (process.env.NATS_URL ? 'nats' : process.env.REDIS_URL ? 'redis' : ''),
    'observability.langfuse_enabled': process.env.LANGFUSE_URL ? 'true' : '',
    'embedding.provider': process.env.EMBEDDING_PROVIDER || '',
    'embedding.ollama_model': process.env.OLLAMA_EMBED_MODEL || '',
    'database.url': process.env.DATABASE_URL || '',
    'server.port': process.env.PORT || '',
  }
  return envMap[key] || null
}

// Initialize on module load
loadCache().catch(() => {})
