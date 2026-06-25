/**
 * Cache Layer — Fase 6.5
 *
 * Cache in-memory con TTL per ridurre il carico DB sulle query frequenti.
 *
 * Usa pattern LRU (Least Recently Used) con size limit per evitare memory leak.
 * In produzione può essere esteso con Redis come backend distribuito.
 *
 * Cache invalidation:
 *   - TTL-based (default 30s per stats, 60s per query leggere)
 *   - Manual invalidation via cache.invalidate(key) o cache.invalidatePattern(regex)
 *   - Auto-invalidation su write operations (es. dopo registerSkill, invalidate 'skills:*')
 *
 * Metriche:
 *   - hit rate, miss rate, eviction count
 *   - esposte via cacheStats() per observability
 */

// === Tipi ============================================================

interface CacheEntry<T> {
  value: T
  expiresAt: number
  createdAt: number
  accessCount: number
  lastAccessedAt: number
}

interface CacheStats {
  size: number
  hits: number
  misses: number
  evictions: number
  sets: number
  hitRate: number
  byPrefix: Record<string, number>
}

// === Cache implementation ===========================================

const DEFAULT_TTL = 30_000 // 30 seconds
const MAX_SIZE = 1000 // max entries before LRU eviction

class LRUCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0,
  }

  /**
   * Get value from cache. Returns undefined if miss or expired.
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.stats.misses++
      return undefined
    }

    // Update access stats (LRU)
    entry.accessCount++
    entry.lastAccessedAt = Date.now()

    // Move to end (most recently used) — Map preserves insertion order
    this.cache.delete(key)
    this.cache.set(key, entry)

    this.stats.hits++
    return entry.value as T
  }

  /**
   * Set value in cache with TTL.
   */
  set<T>(key: string, value: T, ttl: number = DEFAULT_TTL): void {
    // Evict if at capacity
    if (this.cache.size >= MAX_SIZE && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
    })
    this.stats.sets++
  }

  /**
   * Get or compute — helper for cache-aside pattern.
   * If key exists and not expired, returns cached value.
   * Otherwise, calls factory(), stores result, returns it.
   */
  async getOrCompute<T>(key: string, factory: () => Promise<T>, ttl: number = DEFAULT_TTL): Promise<T> {
    const cached = this.get<T>(key)
    if (cached !== undefined) {
      return cached
    }
    const value = await factory()
    this.set(key, value, ttl)
    return value
  }

  /**
   * Invalidate a specific key.
   */
  invalidate(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Invalidate all keys matching a pattern (regex).
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * Clear all cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Reset stats counters (for testing).
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 }
  }

  /**
   * Get stats.
   */
  getStats(): CacheStats {
    const byPrefix: Record<string, number> = {}
    for (const key of this.cache.keys()) {
      const prefix = key.split(':')[0]!
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1
    }

    const total = this.stats.hits + this.stats.misses
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      sets: this.stats.sets,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      byPrefix,
    }
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      this.stats.evictions++
    }
  }
}

// === Singleton instance ==============================================

export const cache = new LRUCache()

// === Helpers per chiavi cache =======================================

export const CacheKeys = {
  // World Model
  worldStateLatest: () => 'worldmodel:latest',
  worldModelStats: () => 'worldmodel:stats',

  // Agent Mesh
  meshTopology: () => 'mesh:topology',
  meshStats: () => 'mesh:stats',

  // Skill Registry
  skillsList: (limit: number) => `skills:list:${limit}`,
  skillByUri: (uri: string) => `skills:uri:${uri}`,
  skillSearch: (query: string) => `skills:search:${query}`,

  // Evaluation
  evaluationStats: () => 'evaluation:stats',
  benchmarksList: () => 'evaluation:benchmarks',
  agentEvaluations: (agentUri: string) => `evaluation:agent:${agentUri}`,

  // Conflict Resolution
  pendingConflicts: () => 'conflicts:pending',
  conflictStats: () => 'conflicts:stats',

  // Cognitive GC
  gcStats: () => 'gc:stats',

  // Cognitive Router
  routerStats: () => 'router:stats',

  // Context Graph
  graphStats: () => 'graph:stats',
  graphNodeByUri: (uri: string) => `graph:node:${uri}`,
  graphNeighbors: (uri: string) => `graph:neighbors:${uri}`,

  // LLM Client
  llmHealth: () => 'llm:health',

  // Integration
  integrationStatus: () => 'integration:status',
} as const

// === TTL presets =====================================================

export const TTL = {
  SHORT: 5_000,      // 5s — for frequently changing data (live stats)
  MEDIUM: 30_000,    // 30s — for stats that don't change rapidly
  LONG: 300_000,     // 5min — for slow-changing data (skill list, benchmarks)
  VERY_LONG: 3_600_000, // 1h — for nearly static data (graph node by URI)
} as const

// === Invalidation helpers ===========================================

/**
 * Invalida tutte le cache correlate a un'entità modificata.
 * Da chiamare dopo write operations.
 */
export function invalidateAfterWrite(entityType: string, _entityUri?: string): void {
  switch (entityType) {
    case 'Skill':
      cache.invalidatePattern(/^skills:/)
      break
    case 'Benchmark':
    case 'Evaluation':
      cache.invalidatePattern(/^evaluation:/)
      break
    case 'Conflict':
      cache.invalidatePattern(/^conflicts:/)
      break
    case 'WorldState':
      cache.invalidatePattern(/^worldmodel:/)
      break
    case 'Agent':
      cache.invalidatePattern(/^mesh:/)
      break
    case 'GraphNode':
      cache.invalidatePattern(/^graph:/)
      break
    case 'MemoryEntry':
      cache.invalidatePattern(/^gc:/)
      break
    default:
      // Conservative: invalidate everything
      cache.clear()
  }
}
