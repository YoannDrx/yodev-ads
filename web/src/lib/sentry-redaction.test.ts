import { describe, expect, it } from 'vitest'
import { redactSentryEvent, redactSensitiveData } from './sentry-redaction'

describe('Sentry redaction', () => {
  it('removes secret-bearing fields and URL tokens recursively', () => {
    const output = redactSensitiveData({
      authorization: 'Bearer abc',
      nested: { refreshToken: 'oauth-secret', url: 'https://ads.yodev.fr/r/report_token_12345678901234567890?email=a@b.fr' },
      message: 'failed with ya_live_supersecret',
    })
    expect(output).toEqual({
      authorization: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', url: 'https://ads.yodev.fr/r/[REDACTED]?email=%5BREDACTED%5D' },
      message: 'failed with [REDACTED_API_KEY]',
    })
  })

  it('drops user identity from events', () => {
    expect(redactSentryEvent({ user: { email: 'person@example.com' }, message: 'safe' })).toEqual({ message: 'safe' })
  })
})
