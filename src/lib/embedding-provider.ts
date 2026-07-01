/**
 * Embedding Provider — C3
 *
 * Provider selezionabile via env: EMBEDDING_PROVIDER
 *   - local (default): TF-IDF 256-dim, zero-config, l'implementazione esistente
 *   - ollama: bge-m3 / nomic-embed via Ollama API (locale, gratuito)
 *   - openai: text-embedding-3-small via OpenAI API (richiede API key)
 *
 * Pattern "reale con fallback":
 *   - Provider reale quando configurato e disponibile
 *   - Fallback a local TF-IDF quando non disponibile
 *   - Dimensioni variabili gestite dinamicamente
 *
 * Usage:
 *   import { getEmbeddingProvider } from '@/lib/embedding-provider'
 *   const provider = getEmbeddingProvider()
 *   const vec = await provider.embed("testo")
 *   const dim = provider.dimensions
 */

// === Tipi ============================================================

export interface EmbeddingProvider {
  name: string
  dimensions: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  isAvailable(): Promise<boolean>
}

// === Config ==========================================================

export type ProviderType = 'local' | 'ollama' | 'openai'

export function getProviderType(): ProviderType {
  const env = process.env.EMBEDDING_PROVIDER || 'local'
  if (env === 'ollama' || env === 'openai') return env
  return 'local'
}

// === Local Provider (TF-IDF, zero-config) ============================

import { embed as localEmbed, EMBED_DIM } from '@/lib/embeddings'

class LocalProvider implements EmbeddingProvider {
  name = 'local-tfidf'
  dimensions = EMBED_DIM

  async embed(text: string): Promise<number[]> {
    return localEmbed(text)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => localEmbed(t))
  }

  async isAvailable(): Promise<boolean> {
    return true
  }
}

// === Ollama Provider (bge-m3 / nomic-embed, locale) ==================

class OllamaProvider implements EmbeddingProvider {
  name = 'ollama'
  dimensions = 1024 // bge-m3 default; nomic-embed = 768

  private model: string
  private url: string

  constructor() {
    this.model = process.env.OLLAMA_EMBED_MODEL || 'bge-m3'
    this.url = process.env.OLLAMA_URL || 'http://localhost:11434'
    // Adjust dimensions based on model
    if (this.model.includes('nomic')) this.dimensions = 768
    else if (this.model.includes('minilm')) this.dimensions = 384
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) throw new Error(`Ollama responded ${response.status}`)

    const data = await response.json() as { embedding: number[] }
    return data.embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama non ha batch API nativa; sequenziale con parallelismo limitato
    const results: number[][] = []
    const batchSize = 5
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const embeddings = await Promise.all(batch.map((t) => this.embed(t)))
      results.push(...embeddings)
    }
    return results
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }
}

// === OpenAI Provider (text-embedding-3-small) =======================

class OpenAIProvider implements EmbeddingProvider {
  name = 'openai'
  dimensions = 1536 // text-embedding-3-small default

  private apiKey: string
  private model: string

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || ''
    this.model = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small'
    if (this.model.includes('large')) this.dimensions = 3072
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) throw new Error(`OpenAI responded ${response.status}`)

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0]!.embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) throw new Error(`OpenAI responded ${response.status}`)

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    return data.data.map((d) => d.embedding)
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey)
  }
}

// === Provider Registry ===============================================

let _provider: EmbeddingProvider | null = null
let _resolvedType: ProviderType | null = null

/**
 * Ritorna il provider attivo.
 * Se il provider configurato non è disponibile, fallback a local.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (_provider && _resolvedType === getProviderType()) return _provider

  const type = getProviderType()
  let provider: EmbeddingProvider

  switch (type) {
    case 'ollama':
      provider = new OllamaProvider()
      if (!(await provider.isAvailable())) {
        console.warn('[embedding-provider] Ollama not available, falling back to local TF-IDF')
        provider = new LocalProvider()
      }
      break

    case 'openai':
      provider = new OpenAIProvider()
      if (!(await provider.isAvailable())) {
        console.warn('[embedding-provider] OpenAI API key not configured, falling back to local TF-IDF')
        provider = new LocalProvider()
      }
      break

    default:
      provider = new LocalProvider()
  }

  _provider = provider
  _resolvedType = type
  console.log(`[embedding-provider] Active: ${provider.name} (${provider.dimensions}d)`)
  return provider
}

/**
 * Versione sincrona che ritorna il provider cached (o local se non ancora risolto).
 * Da usare nei moduli che non possono essere async (es. kernel sync).
 */
export function getCachedProvider(): EmbeddingProvider {
  if (_provider) return _provider
  // Fallback: local (zero-config, sempre disponibile)
  return new LocalProvider()
}

/**
 * Reset per test.
 */
export function _resetProviderForTests(): void {
  _provider = null
  _resolvedType = null
}

// === Helpers =========================================================

/**
 * Embed sincrono per compatibilità con il codice esistente (kernel sync modules).
 * Usa il provider cached; se il provider è async (ollama/openai), usa local.
 */
export function embedSync(text: string): number[] {
  const provider = getCachedProvider()
  if (provider.name === 'local-tfidf') {
    return localEmbed(text)
  }
  // Per provider async, non possiamo chiamarli sync → fallback a local
  return localEmbed(text)
}

/**
 * Embed async — usa il provider reale se disponibile.
 * Da preferire nei moduli async (runtime, api routes, etc.).
 */
export async function embedAsync(text: string): Promise<number[]> {
  const provider = await getEmbeddingProvider()
  return provider.embed(text)
}

/**
 * Batch embed async.
 */
export async function embedBatchAsync(texts: string[]): Promise<number[][]> {
  const provider = await getEmbeddingProvider()
  return provider.embedBatch(texts)
}

/**
 * Dimensioni correnti del provider attivo.
 */
export function getEmbeddingDimensions(): number {
  return getCachedProvider().dimensions
}

/**
 * Info sul provider attivo per admin/settings.
 */
export async function getProviderInfo(): Promise<{
  configured: ProviderType
  active: string
  dimensions: number
  available: boolean
}> {
  const type = getProviderType()
  const provider = await getEmbeddingProvider()
  return {
    configured: type,
    active: provider.name,
    dimensions: provider.dimensions,
    available: await provider.isAvailable(),
  }
}
