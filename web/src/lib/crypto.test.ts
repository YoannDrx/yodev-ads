import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

describe('secret envelope encryption', () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
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
})
