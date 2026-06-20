import { describe, it, expect } from 'vitest'
import {
  embed, tokenize, cosine, serialize, deserialize,
  EMBED_DIM,
} from '@/lib/embeddings'
import { EMBEDDING_TEST_PAIRS } from '../fixtures'

describe('Embeddings — Dimension', () => {
  it('dimensione è 256', () => {
    expect(EMBED_DIM).toBe(256)
  })

  it('embed() ritorna vettore di 256 dimensioni', () => {
    const v = embed('test')
    expect(v).toHaveLength(256)
  })
})

describe('Embeddings — Normalization', () => {
  it('vettore è normalizzato L2 (norma = 1)', () => {
    const v = embed('test di normalizzazione')
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    expect(norm).toBeCloseTo(1.0, 3)
  })

  it('vettore vuoto → norma 0 o 1 (fallback)', () => {
    const v = embed('')
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    // Per stringa vuota, la norma è 0 o 1 a seconda dell'implementazione
    expect(norm).toBeGreaterThanOrEqual(0)
    expect(norm).toBeLessThanOrEqual(1)
  })
})

describe('Embeddings — Cosine Similarity', () => {
  it('stesso testo → similarity = 1.0', () => {
    const v = embed('memoria persistente')
    expect(cosine(v, v)).toBeCloseTo(1.0, 5)
  })

  it('testo identico ma ripetuto → similarity alta', () => {
    const v1 = embed('memoria')
    const v2 = embed('memoria memoria')
    expect(cosine(v1, v2)).toBeGreaterThan(0.5)
  })

  EMBEDDING_TEST_PAIRS.forEach(({ name, a, b, minSimilarity, maxSimilarity }) => {
    it(name, () => {
      const sim = cosine(embed(a), embed(b))
      if (minSimilarity !== undefined) {
        expect(sim).toBeGreaterThanOrEqual(minSimilarity)
      }
      if (maxSimilarity !== undefined) {
        expect(sim).toBeLessThanOrEqual(maxSimilarity)
      }
    })
  })
})

describe('Embeddings — Tokenization', () => {
  it('tokenizza testo semplice', () => {
    const tokens = tokenize('memoria persistente')
    expect(tokens.length).toBeGreaterThan(0)
  })

  it('rimuove stopwords italiane', () => {
    const tokens = tokenize('il sistema di memoria')
    // "il", "di" sono stopwords → rimosse
    expect(tokens).not.toContain('il')
    expect(tokens).not.toContain('di')
  })

  it('rimuove stopwords inglesi', () => {
    const tokens = tokenize('the memory of the system')
    expect(tokens).not.toContain('the')
    expect(tokens).not.toContain('of')
  })

  it('applica alias mapping (memoria → memory)', () => {
    const tokens = tokenize('memoria')
    expect(tokens).toContain('memory')
  })

  it('applica alias mapping (agente → agent)', () => {
    const tokens = tokenize('agente')
    expect(tokens).toContain('agent')
  })

  it('lowercase automatico', () => {
    const tokens = tokenize('MEMORY')
    expect(tokens).toContain('memory')
  })

  it('gestisce camelCase', () => {
    const tokens = tokenize('patchBoard kernel')
    // camelCase splittato
    expect(tokens.length).toBeGreaterThan(1)
  })

  it('token vuoto per stringa vuota', () => {
    const tokens = tokenize('')
    expect(tokens).toHaveLength(0)
  })
})

describe('Embeddings — Serialization', () => {
  it('serialize → deserialize round-trip', () => {
    const v = embed('test di serializzazione')
    const s = serialize(v)
    const v2 = deserialize(s)
    expect(v2).toHaveLength(v.length)
    for (let i = 0; i < v.length; i++) {
      expect(v2[i]).toBeCloseTo(v[i], 5)
    }
  })

  it('deserialize di stringa invalida → vettore zero', () => {
    const v = deserialize('invalid json')
    expect(v).toHaveLength(EMBED_DIM)
    expect(v.every(x => x === 0)).toBe(true)
  })

  it('serialize produce JSON string', () => {
    const v = embed('test')
    const s = serialize(v)
    expect(typeof s).toBe('string')
    expect(() => JSON.parse(s)).not.toThrow()
  })
})

describe('Embeddings — Semantic Coherence', () => {
  it('concetti simili hanno similarità > concetti non correlati', () => {
    const memIt = embed('memoria')
    const memEn = embed('memory')
    const network = embed('network')
    const simRelated = cosine(memIt, memEn)
    const simUnrelated = cosine(memIt, network)
    expect(simRelated).toBeGreaterThan(simUnrelated)
  })

  it('entità concettualmente vicine hanno similarità > 0.1', () => {
    const e1 = embed('Sistema Operativo Agentico')
    const e2 = embed('Agentic OS memory kernel')
    // TF-IDF locale: similarità moderata per concetti correlati
    // (la traduzione IT/EN riduce la similarità rispetto a testo identico)
    expect(cosine(e1, e2)).toBeGreaterThan(0.1)
  })

  it('testo con più token → vettore più denso (meno zeri)', () => {
    const short = embed('a')
    const long = embed('questo è un testo molto lungo con molti token per testare la densità del vettore')
    const zerosShort = short.filter(x => x === 0).length
    const zerosLong = long.filter(x => x === 0).length
    expect(zerosLong).toBeLessThan(zerosShort)
  })
})
