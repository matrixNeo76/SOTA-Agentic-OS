import { describe, it, expect } from 'vitest'
import { calculateCost } from '@/lib/kernel/cost-ledger'

describe('Cost Ledger', () => {
  it('calculateCost ritorna costo positivo per token > 0', () => {
    const cost = calculateCost('zai-glm', 1000, 500)
    expect(cost).toBeGreaterThan(0)
  })

  it('calculateCost ritorna 0 per 0 token', () => {
    const cost = calculateCost('zai-glm', 0, 0)
    expect(cost).toBe(0)
  })

  it('calculateCost è proporzionale ai token', () => {
    const c1 = calculateCost('zai-glm', 1000, 0)
    const c2 = calculateCost('zai-glm', 2000, 0)
    expect(c2).toBeGreaterThan(c1)
  })

  it('calculateCost usa fallback per modello sconosciuto', () => {
    const cost = calculateCost('unknown-model', 1000, 0)
    expect(cost).toBeGreaterThan(0)
  })
})
