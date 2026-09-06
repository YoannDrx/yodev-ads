import { createHash } from 'node:crypto'

export const NOTIFICATION_DELIVERY_LEASE_MS = 2 * 60_000
export const MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS = 5

/** Each channel has its own immutable provider idempotency identity. */
export function notificationDeliveryKey(eventKey: string, channelId: string) {
  return `notification:${createHash('sha256').update(JSON.stringify([eventKey, channelId])).digest('hex')}`
}

/** Compatibility with the single-recipient email transport's historical key limit. */
export function notificationEmailBusinessKey(eventKey: string, deliveryKey?: string) {
  const key = deliveryKey ?? eventKey
  return key.length <= 128 ? key : `yda:${createHash('sha256').update(key).digest('hex')}`
}
