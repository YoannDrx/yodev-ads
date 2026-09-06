import { describe, expect, it } from 'vitest'
import { notificationDeliveryKey, notificationEmailBusinessKey } from './notification-delivery-model'

describe('notification transport identity', () => {
  it('keeps retries stable and separates channels for the same incident occurrence', () => {
    const first = notificationDeliveryKey('incident:opened', 'email-channel-1')
    expect(first).toBe(notificationDeliveryKey('incident:opened', 'email-channel-1'))
    expect(first).not.toBe(notificationDeliveryKey('incident:opened', 'email-channel-2'))
    expect(first).not.toBe(notificationDeliveryKey('incident:reopened', 'email-channel-1'))
    expect(first.length).toBeLessThanOrEqual(128)
    expect(notificationEmailBusinessKey('incident:opened', first)).toBe(first)
  })
  it('preserves historical provider identities instead of resending old ambiguous deliveries under new keys', () => {
    expect(notificationEmailBusinessKey('legacy-event')).toBe('legacy-event')
    expect(notificationEmailBusinessKey('x'.repeat(180))).toMatch(/^yda:[a-f0-9]{64}$/)
  })
})
