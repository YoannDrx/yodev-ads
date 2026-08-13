import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const oauthStateSchema = z.object({
  provider: z.enum(['google_ads', 'slack', 'teams']),
  state: z.string().min(32).max(128),
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
  payload: z.record(z.string(), z.string()).default({}),
})

export type OAuthState = z.infer<typeof oauthStateSchema>

const callbackPaths: Record<OAuthState['provider'], string> = {
  google_ads: '/api/google-ads/callback',
  slack: '/api/connectors/slack/callback',
  teams: '/api/connectors/teams/callback',
}

function stateKey() {
  const key = process.env.OAUTH_STATE_KEY ?? process.env.APP_ENCRYPTION_KEY
  if (!key || key.length < 32) throw new Error('OAUTH_STATE_KEY is not configured')
  return key
}

function signature(encoded: string) {
  return createHmac('sha256', stateKey()).update(encoded).digest('base64url')
}

export function oauthCallbackUrl(provider: OAuthState['provider'], requestUrl: URL) {
  const configured = provider === 'google_ads' && process.env.GOOGLE_OAUTH_REDIRECT_URI
    ? process.env.GOOGLE_OAUTH_REDIRECT_URI
    : process.env.NEXT_PUBLIC_APP_URL
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('L’origine OAuth de production n’est pas configurée.')
  }
  const callback = configured
    ? new URL(provider === 'google_ads' && process.env.GOOGLE_OAUTH_REDIRECT_URI
      ? configured
      : callbackPaths[provider], configured)
    : new URL(callbackPaths[provider], requestUrl.origin)
  if (callback.pathname !== callbackPaths[provider] || callback.username || callback.password || callback.search || callback.hash) {
    throw new Error('L’URL de callback OAuth configurée est invalide.')
  }
  if (process.env.NODE_ENV === 'production' && callback.protocol !== 'https:') {
    throw new Error('L’URL de callback OAuth de production doit utiliser HTTPS.')
  }
  if (requestUrl.origin !== callback.origin) {
    throw new Error('La connexion OAuth doit être lancée depuis le domaine principal Ads by Yodev.')
  }
  return callback.toString()
}

export function sealOAuthState(input: Omit<OAuthState, 'expiresAt' | 'payload'> & {
  expiresAt?: number
  payload?: Record<string, string>
}) {
  const state = oauthStateSchema.parse({
    ...input,
    expiresAt: input.expiresAt ?? Date.now() + 10 * 60_000,
    payload: input.payload ?? {},
  })
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${encoded}.${signature(encoded)}`
}

export function openOAuthState(value: string, expectedProvider: OAuthState['provider'], now = Date.now()) {
  const [encoded, providedSignature, extra] = value.split('.')
  if (!encoded || !providedSignature || extra) throw new Error('La session OAuth est invalide.')
  const expectedSignature = signature(encoded)
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('La session OAuth est invalide.')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('La session OAuth est invalide.')
  }
  const state = oauthStateSchema.parse(decoded)
  if (state.provider !== expectedProvider) throw new Error('Le fournisseur OAuth ne correspond pas à la session.')
  if (state.expiresAt <= now) throw new Error('La session OAuth a expiré. Relancez la connexion.')
  return state
}
