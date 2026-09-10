import 'server-only'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { hashToken } from '@/lib/tokens'

export const DOMAIN_PROBE_PATH = '/api/domain-probe'
export const DOMAIN_PROBE_HEADER = 'x-yodev-domain-challenge'
const lifetimeMs = 60_000
const challengeSchema = z.object({
  purpose: z.literal('yodev-domain-route-v1'), hostname: z.string().min(4).max(253),
  nonce: z.string().regex(/^[a-f0-9]{64}$/), scope: z.string().length(64),
  issuedAt: z.number().int(), expiresAt: z.number().int(),
}).strict()

function scope() {
  return hashToken(JSON.stringify(['domain-route-v1', process.env.NEXT_PUBLIC_APP_URL ?? null,
    process.env.VERCEL_PROJECT_ID ?? null, process.env.VERCEL_TEAM_ID ?? null,
    process.env.VERCEL_ENV ?? null, process.env.VERCEL_GIT_COMMIT_SHA ?? null]))
}

function proof(hostname: string, nonce: string) { return hashToken(JSON.stringify(['domain-route-proof-v1', hostname, nonce])) }

export function createDomainProbeChallenge(hostname: string, now = Date.now()) {
  const nonce = randomBytes(32).toString('hex')
  return {
    challenge: encryptSecret(JSON.stringify({ purpose: 'yodev-domain-route-v1', hostname, nonce, scope: scope(), issuedAt: now, expiresAt: now + lifetimeMs })),
    expectedProof: proof(hostname, nonce),
  }
}

export function answerDomainProbeChallenge(challenge: string, hostname: string, now = Date.now()) {
  if (challenge.length > 2048) throw new Error('Invalid domain challenge')
  const payload = challengeSchema.parse(JSON.parse(decryptSecret(challenge)))
  if (payload.hostname !== hostname || payload.scope !== scope() || payload.issuedAt > now
    || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt !== lifetimeMs) throw new Error('Invalid domain challenge')
  return proof(payload.hostname, payload.nonce)
}
