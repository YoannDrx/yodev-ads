import { beforeEach, describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS, legalRequestFingerprint, requireCommercialLegalReadiness } from './legal'

describe('legal evidence', () => {
  beforeEach(() => {
    process.env.LEGAL_FINGERPRINT_KEY = 'legal-test-key'
    delete process.env.LEGAL_DOCUMENTS_APPROVED
    delete process.env.CONSUMER_MEDIATOR_NAME
    delete process.env.CONSUMER_MEDIATOR_URL
  })

  it('versions every acceptance-controlled document', () => {
    expect(Object.values(LEGAL_VERSIONS)).toEqual(['2026-08-12', '2026-08-12', '2026-08-12', '2026-08-12'])
  })

  it('pseudonymizes request context without storing raw IP or user-agent', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1', 'user-agent': 'Browser' })
    const fingerprint = legalRequestFingerprint(headers)
    expect(fingerprint).toHaveLength(64)
    expect(fingerprint).not.toContain('203.0.113.10')
    expect(legalRequestFingerprint(headers)).toBe(fingerprint)
  })

  it('blocks commercial checkout until the documents are professionally approved', () => {
    expect(() => requireCommercialLegalReadiness('business')).toThrow('documents commerciaux')
    process.env.LEGAL_DOCUMENTS_APPROVED = '1'
    expect(() => requireCommercialLegalReadiness('business')).not.toThrow()
  })

  it('also requires a configured consumer mediator before B2C checkout', () => {
    process.env.LEGAL_DOCUMENTS_APPROVED = '1'
    expect(() => requireCommercialLegalReadiness('individual')).toThrow('médiateur')
    process.env.CONSUMER_MEDIATOR_NAME = 'Test mediator'
    process.env.CONSUMER_MEDIATOR_URL = 'https://mediator.example'
    expect(() => requireCommercialLegalReadiness('individual')).not.toThrow()
  })
})
