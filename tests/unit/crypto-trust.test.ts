import { describe, it, expect } from 'vitest'
import { generatePublisherKeyPair, signToolManifest, verifyToolSignature } from '@/lib/kernel/crypto-trust'

describe('Crypto Trust — ECDSA P-256', () => {
  it('generatePublisherKeyPair ritorna keypair con fingerprint', () => {
    const kp = generatePublisherKeyPair()
    expect(kp.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
    expect(kp.privateKeyPem).toMatch(/BEGIN PRIVATE KEY/)
    expect(kp.fingerprint).toHaveLength(64) // SHA-256 hex
  })

  it('signToolManifest produce una signature base64 non vuota', () => {
    const kp = generatePublisherKeyPair()
    const manifest = { toolId: 'test-tool', name: 'Test', version: '1.0.0', publisher: 'test' }
    const sig = signToolManifest(manifest, kp.privateKeyPem)
    expect(sig).toBeTruthy()
    expect(typeof sig).toBe('string')
  })

  it('verifyToolSignature conferma firma valida', () => {
    const kp = generatePublisherKeyPair()
    const manifest = { toolId: 'test-tool', name: 'Test', version: '1.0.0', publisher: 'test' }
    const sig = signToolManifest(manifest, kp.privateKeyPem)
    const valid = verifyToolSignature(manifest, sig, kp.publicKeyPem)
    expect(valid).toBe(true)
  })

  it('verifyToolSignature rifiuta firma con manifest modificato', () => {
    const kp = generatePublisherKeyPair()
    const manifest = { toolId: 'test-tool', name: 'Test', version: '1.0.0', publisher: 'test' }
    const sig = signToolManifest(manifest, kp.privateKeyPem)
    const tampered = { ...manifest, name: 'Tampered' }
    const valid = verifyToolSignature(tampered, sig, kp.publicKeyPem)
    expect(valid).toBe(false)
  })

  it('verifyToolSignature rifiuta firma con chiave sbagliata', () => {
    const kp1 = generatePublisherKeyPair()
    const kp2 = generatePublisherKeyPair()
    const manifest = { toolId: 'test-tool', name: 'Test', version: '1.0.0', publisher: 'test' }
    const sig = signToolManifest(manifest, kp1.privateKeyPem)
    const valid = verifyToolSignature(manifest, sig, kp2.publicKeyPem)
    expect(valid).toBe(false)
  })
})
