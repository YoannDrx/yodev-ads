import { beforeEach, describe, expect, it } from 'vitest'
import { createApiToken, createOtp, createReportFeedbackSessionToken, createShareToken, hashOtp, hashToken } from './tokens'

describe('tokens', () => {
  beforeEach(() => { process.env.OTP_HASH_KEY = 'test-otp-key-that-is-long-enough' })

  it('creates scoped high-entropy token prefixes', () => {
    expect(createApiToken()).toMatch(/^ya_live_[A-Za-z0-9_-]{37,}$/)
    expect(createShareToken()).toMatch(/^ya_share_[A-Za-z0-9_-]{32}$/)
    expect(createReportFeedbackSessionToken()).toMatch(/^ya_feedback_[A-Za-z0-9_-]{32}$/)
  })

  it('hashes bearer tokens and binds OTP hashes to their recipient', () => {
    expect(hashToken('secret')).toHaveLength(64)
    expect(hashOtp('recipient-a', '123456')).toHaveLength(64)
    expect(hashOtp('recipient-a', '123456')).not.toBe(hashOtp('recipient-b', '123456'))
  })

  it('creates a six-digit OTP including leading zeros', () => {
    expect(createOtp()).toMatch(/^\d{6}$/)
  })

  it('fails closed when no OTP hashing key exists', () => {
    delete process.env.OTP_HASH_KEY
    const previous = process.env.APP_ENCRYPTION_KEY
    delete process.env.APP_ENCRYPTION_KEY
    expect(() => hashOtp('recipient', '123456')).toThrow('OTP_HASH_KEY')
    if (previous) process.env.APP_ENCRYPTION_KEY = previous
  })
})
