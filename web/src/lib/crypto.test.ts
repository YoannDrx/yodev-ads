import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentEncryptionKeyId, decryptSecret, encryptSecret, rewrapSecret, secretEnvelopeKeyId } from '@/lib/crypto'

describe('secret envelope encryption', () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
    delete process.env.APP_ENCRYPTION_KEYS
    delete process.env.APP_ENCRYPTION_CURRENT_KID
  })

  afterEach(() => {
    if (originalKey) process.env.APP_ENCRYPTION_KEY = originalKey
    else delete process.env.APP_ENCRYPTION_KEY
  })

  it('round trips a refresh token without exposing it in the envelope', () => {
    const token = '1//sensitive-refresh-token'
    const encrypted = encryptSecret(token)
    expect(encrypted).not.toContain(token)
    expect(decryptSecret(encrypted)).toBe(token)
  })

  it('uses a fresh nonce for each encryption', () => {
    expect(encryptSecret('same-value')).not.toBe(encryptSecret('same-value'))
  })

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('secret')
    const envelope = JSON.parse(Buffer.from(encrypted, 'base64url').toString('utf8'))
    envelope.data = `${envelope.data.slice(0, -2)}aa`
    const tampered = Buffer.from(JSON.stringify(envelope)).toString('base64url')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('single-writes v2 with kid and dual-reads legacy/v2 keys', () => {
    const legacy = encryptSecret('legacy')
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ current: Buffer.alloc(32, 9).toString('base64url') })
    process.env.APP_ENCRYPTION_CURRENT_KID = 'current'
    const current = encryptSecret('current')
    const envelope = JSON.parse(Buffer.from(current, 'base64url').toString('utf8'))
    expect(envelope).toMatchObject({ v: 2, kid: 'current' })
    expect(decryptSecret(legacy)).toBe('legacy')
    expect(decryptSecret(current)).toBe('current')
  })

  it('fails closed when the envelope key id is unavailable', () => {
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ old: Buffer.alloc(32, 8).toString('base64url') })
    process.env.APP_ENCRYPTION_CURRENT_KID = 'old'
    const encrypted = encryptSecret('secret')
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ next: Buffer.alloc(32, 9).toString('base64url') })
    process.env.APP_ENCRYPTION_CURRENT_KID = 'next'
    expect(() => decryptSecret(encrypted)).toThrow('old')
  })

  it('rewraps legacy and old envelopes with the current key without changing plaintext', () => {
    const legacy = encryptSecret('legacy-secret')
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({
      old: Buffer.alloc(32, 8).toString('base64url'),
      current: Buffer.alloc(32, 9).toString('base64url'),
    })
    process.env.APP_ENCRYPTION_CURRENT_KID = 'old'
    const old = encryptSecret('old-secret')
    process.env.APP_ENCRYPTION_CURRENT_KID = 'current'

    expect(currentEncryptionKeyId()).toBe('current')
    expect(secretEnvelopeKeyId(legacy)).toBeNull()
    expect(secretEnvelopeKeyId(old)).toBe('old')
    const rewrappedLegacy = rewrapSecret(legacy)
    const rewrappedOld = rewrapSecret(old)
    expect(secretEnvelopeKeyId(rewrappedLegacy)).toBe('current')
    expect(secretEnvelopeKeyId(rewrappedOld)).toBe('current')
    expect(decryptSecret(rewrappedLegacy)).toBe('legacy-secret')
    expect(decryptSecret(rewrappedOld)).toBe('old-secret')
    expect(rewrapSecret(rewrappedOld)).toBe(rewrappedOld)
  })

  it('refuses rotation when no versioned current key is selected', () => {
    const legacy = encryptSecret('secret')
    expect(() => rewrapSecret(legacy)).toThrow('APP_ENCRYPTION_CURRENT_KID')
  })
})
