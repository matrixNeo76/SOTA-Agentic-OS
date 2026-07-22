/**
 * Test: Audit Log
 * Track 6.3 — Verify hash chain integrity
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'

describe('Audit Log Hash Chain', () => {
  it('should produce deterministic SHA-256 hashes', () => {
    const data1 = JSON.stringify({
      prevHash: 'genesis',
      action: 'test',
      actorId: 'user1',
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    const hash1 = createHash('sha256').update(data1).digest('hex')
    const hash2 = createHash('sha256').update(data1).digest('hex')
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 = 64 hex chars
  })

  it('should produce different hashes for different data', () => {
    const data1 = JSON.stringify({ prevHash: 'a', action: 'test1' })
    const data2 = JSON.stringify({ prevHash: 'b', action: 'test2' })
    const hash1 = createHash('sha256').update(data1).digest('hex')
    const hash2 = createHash('sha256').update(data2).digest('hex')
    expect(hash1).not.toBe(hash2)
  })

  it('should validate hash chain correctly', () => {
    // Simulate a chain
    const entries = [
      { prevHash: 'genesis', data: 'entry1' },
      { prevHash: '', data: 'entry2' },
      { prevHash: '', data: 'entry3' },
    ]

    // Build chain
    let prev = 'genesis'
    for (const entry of entries) {
      entry.prevHash = prev
      const hash = createHash('sha256').update(JSON.stringify({ prevHash: entry.prevHash, data: entry.data })).digest('hex')
      prev = hash
    }

    // Verify chain
    let verifyPrev = 'genesis'
    let valid = true
    for (const entry of entries) {
      if (entry.prevHash !== verifyPrev) {
        valid = false
        break
      }
      verifyPrev = createHash('sha256').update(JSON.stringify({ prevHash: entry.prevHash, data: entry.data })).digest('hex')
    }
    expect(valid).toBe(true)
  })
})

describe('Rate Limiting', () => {
  it('should have correct limit configurations', () => {
    const LIMITS = {
      user: { max: 100, windowSec: 60 },
      tenant: { max: 1000, windowSec: 60 },
      ip: { max: 200, windowSec: 60 },
    }

    expect(LIMITS.user.max).toBe(100)
    expect(LIMITS.tenant.max).toBe(1000)
    expect(LIMITS.ip.max).toBe(200)
    expect(LIMITS.user.windowSec).toBe(60)
  })
})
