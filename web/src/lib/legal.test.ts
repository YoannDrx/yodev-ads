import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS, legalRequestFingerprint, requireCommercialLegalReadiness } from './legal'

describe('legal evidence', () => {
  beforeEach(() => {
    process.env.LEGAL_FINGERPRINT_KEY = 'legal-test-key'
    delete process.env.LEGAL_DOCUMENTS_APPROVED
  })

  afterEach(() => {
    delete process.env.LEGAL_FINGERPRINT_KEY
    delete process.env.APP_ENCRYPTION_KEY
    delete process.env.LEGAL_DOCUMENTS_APPROVED
  })

  it('versions every acceptance-controlled document', () => {
    expect(Object.values(LEGAL_VERSIONS)).toEqual(['2026-08-16-b2b', '2026-08-16-b2b', '2026-08-16-b2b', '2026-08-16-b2b'])
  })

  it('pseudonymizes request context without storing raw IP or user-agent', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1', 'user-agent': 'Browser' })
    const fingerprint = legalRequestFingerprint(headers)
    expect(fingerprint).toHaveLength(64)
    expect(fingerprint).not.toContain('203.0.113.10')
    expect(legalRequestFingerprint(headers)).toBe(fingerprint)
  })

  it('blocks commercial checkout until the documents are professionally approved', () => {
    expect(() => requireCommercialLegalReadiness()).toThrow('documents commerciaux')
    process.env.LEGAL_DOCUMENTS_APPROVED = '1'
    expect(() => requireCommercialLegalReadiness()).not.toThrow()
  })

  it('falls back to the encryption key and normalizes missing request headers', () => {
    delete process.env.LEGAL_FINGERPRINT_KEY
    process.env.APP_ENCRYPTION_KEY = 'fallback-key'
    expect(legalRequestFingerprint(new Headers())).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails closed when no fingerprint key is available', () => {
    delete process.env.LEGAL_FINGERPRINT_KEY
    delete process.env.APP_ENCRYPTION_KEY
    expect(() => legalRequestFingerprint(new Headers())).toThrow('not configured')
  })

})
