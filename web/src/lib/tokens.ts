import { createHash, randomBytes } from 'node:crypto'

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createShareToken() {
  return `ya_share_${randomBytes(24).toString('base64url')}`
}

export function createApiToken() {
  return `ya_live_${randomBytes(28).toString('base64url')}`
}
