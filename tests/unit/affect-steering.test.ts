/**
 * Test: Affect→Steering loop (Fase 2)
 * Verifica che desperation/frustrazione influenzino la strategia ACTS
 */
import { describe, it, expect } from 'vitest'
import { decideStrategy, type Strategy } from '@/lib/kernel/acts'

describe('Affect→Steering Loop', () => {
  const baseState = {
    step: 2,
    lastStrategy: 'EXECUTE' as Strategy,
    lastCheckPassed: null,
    budgetRemaining: 500,
    errorsConsecutive: 0,
  }

  it('should return CHECK when frustration is moderate (0.4-0.7)', () => {
    const result = decideStrategy({ ...baseState, frustration: 0.5 })
    expect(result).toBe('CHECK')
  })

  it('should return HALT when frustration is high (≥0.7)', () => {
    const result = decideStrategy({ ...baseState, frustration: 0.8 })
    expect(result).toBe('HALT')
  })

  it('should return REFLECT when desperation is high (≥0.7) and not already reflecting', () => {
    const result = decideStrategy({ ...baseState, desperation: 0.8 })
    expect(result).toBe('REFLECT')
  })

  it('should not return REFLECT again if already reflecting', () => {
    const result = decideStrategy({
      ...baseState,
      desperation: 0.8,
      lastStrategy: 'REFLECT',
    })
    // After REFLECT, should go to PLAN (normal flow)
    expect(result).toBe('PLAN')
  })

  it('should follow normal ACTS flow when affect is low', () => {
    const result = decideStrategy({ ...baseState, desperation: 0.1, frustration: 0.1 })
    // EXECUTE → CHECK (normal flow)
    expect(result).toBe('CHECK')
  })

  it('should prioritize HALT from frustration over REFLECT from desperation', () => {
    const result = decideStrategy({
      ...baseState,
      desperation: 0.9,
      frustration: 0.9,
    })
    expect(result).toBe('HALT') // frustration HALT takes priority
  })

  it('should still HALT on low budget regardless of affect', () => {
    const result = decideStrategy({
      ...baseState,
      budgetRemaining: 30,
      desperation: 0,
      frustration: 0,
    })
    expect(result).toBe('HALT')
  })

  it('should still CHECK on 3+ consecutive errors regardless of affect', () => {
    const result = decideStrategy({
      ...baseState,
      errorsConsecutive: 3,
      desperation: 0,
      frustration: 0,
    })
    expect(result).toBe('CHECK')
  })
})
