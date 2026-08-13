import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto'

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createShareToken() {
  return `ya_share_${randomBytes(24).toString('base64url')}`
}

export function createApiToken() {
  return `ya_live_${randomBytes(28).toString('base64url')}`
}

export function createOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashOtp(recipientId: string, otp: string) {
  const key = process.env.OTP_HASH_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key) throw new Error('OTP_HASH_KEY is not configured')
  return createHmac('sha256', key).update(`${recipientId}:${otp}`).digest('hex')
}

export function createReportFeedbackSessionToken() {
  return `ya_feedback_${randomBytes(24).toString('base64url')}`
}

export function createDomainVerificationToken() {
  return `ya_domain_${randomBytes(24).toString('base64url')}`
}
