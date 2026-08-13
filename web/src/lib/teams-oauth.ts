import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com'
const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com'
export const TEAMS_OAUTH_SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/ChannelMessage.Send',
  'https://graph.microsoft.com/Team.ReadBasic.All',
  'https://graph.microsoft.com/Channel.ReadBasic.All',
] as const

const tokenResponseSchema = z.object({
  access_token: z.string().min(20),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(20).optional(),
  scope: z.string().default(''),
})

const graphTeamSchema = z.object({ id: z.string().min(1).max(128), displayName: z.string().min(1).max(220) })
const graphChannelSchema = z.object({
  id: z.string().min(1).max(256),
  displayName: z.string().min(1).max(220),
  membershipType: z.string().max(40).optional(),
})

const teamsDestinationSchema = z.object({
  v: z.literal(1),
  provider: z.literal('teams_graph'),
  teamId: z.string().min(1).max(128),
  teamName: z.string().min(1).max(220),
  channelId: z.string().min(1).max(256),
  channelName: z.string().min(1).max(220),
  refreshToken: z.string().min(20),
})

export type TeamsDestination = z.infer<typeof teamsDestinationSchema>

export function hasTeamsOAuthConfiguration() {
  return Boolean(process.env.MICROSOFT_CLIENT_ID?.trim() && process.env.MICROSOFT_CLIENT_SECRET?.trim())
}

function teamsConfiguration() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim()
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('La configuration OAuth Microsoft Teams est incomplète.')
  return { clientId, clientSecret }
}

export function createTeamsPkce() {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function teamsAuthorizationUrl(input: { state: string; redirectUri: string; codeChallenge: string }) {
  const { clientId } = teamsConfiguration()
  const url = new URL('/organizations/oauth2/v2.0/authorize', MICROSOFT_LOGIN_ORIGIN)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', TEAMS_OAUTH_SCOPES.join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

async function tokenRequest(body: URLSearchParams) {
  const { clientId, clientSecret } = teamsConfiguration()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  const response = await fetch(`${MICROSOFT_LOGIN_ORIGIN}/organizations/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  const raw: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const providerError = z.object({ error: z.string().optional() }).safeParse(raw)
    throw new Error(`Microsoft OAuth HTTP ${response.status}${providerError.success && providerError.data.error ? ` : ${providerError.data.error}` : ''}`)
  }
  return tokenResponseSchema.parse(raw)
}

export async function exchangeTeamsAuthorizationCode(input: { code: string; redirectUri: string; codeVerifier: string }) {
  const result = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    scope: TEAMS_OAUTH_SCOPES.join(' '),
  }))
  if (!result.refresh_token) throw new Error('Microsoft n’a pas renvoyé le refresh token requis.')
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresIn: result.expires_in,
    scopes: result.scope.split(' ').filter(Boolean),
  }
}

export async function refreshTeamsAccessToken(refreshToken: string) {
  const result = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: TEAMS_OAUTH_SCOPES.join(' '),
  }))
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? refreshToken,
    expiresIn: result.expires_in,
    scopes: result.scope.split(' ').filter(Boolean),
  }
}

async function graphError(response: Response) {
  const raw: unknown = await response.json().catch(() => null)
  const parsed = z.object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional() }).safeParse(raw)
  const detail = parsed.success ? parsed.data.error?.code : undefined
  return new Error(`Microsoft Graph HTTP ${response.status}${detail ? ` : ${detail}` : ''}`)
}

async function graphCollection<T>(path: string, accessToken: string, schema: z.ZodType<T>) {
  const records: T[] = []
  let next: string | null = new URL(path, `${MICROSOFT_GRAPH_ORIGIN}/v1.0/`).toString()
  for (let page = 0; next && page < 10; page += 1) {
    const target = new URL(next)
    if (target.origin !== MICROSOFT_GRAPH_ORIGIN || !target.pathname.startsWith('/v1.0/')) {
      throw new Error('Microsoft Graph a renvoyé une pagination inattendue.')
    }
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw await graphError(response)
    const raw: unknown = await response.json()
    const parsed = z.object({
      value: z.array(schema),
      '@odata.nextLink': z.string().url().optional(),
    }).parse(raw)
    records.push(...parsed.value)
    if (records.length > 500) throw new Error('Microsoft Graph a renvoyé trop de destinations Teams.')
    next = parsed['@odata.nextLink'] ?? null
  }
  if (next) throw new Error('La pagination Microsoft Graph dépasse la limite de sécurité.')
  return records
}

export function listJoinedTeams(accessToken: string) {
  return graphCollection('me/joinedTeams?$select=id,displayName', accessToken, graphTeamSchema)
}

export function listTeamChannels(accessToken: string, teamId: string) {
  return graphCollection(`teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,membershipType`, accessToken, graphChannelSchema)
}

export async function resolveTeamsDestination(input: { accessToken: string; teamId: string; channelId: string }) {
  const teams = await listJoinedTeams(input.accessToken)
  const team = teams.find((candidate) => candidate.id === input.teamId)
  if (!team) throw new Error('Équipe Microsoft Teams introuvable ou inaccessible.')
  const channels = await listTeamChannels(input.accessToken, team.id)
  const channel = channels.find((candidate) => candidate.id === input.channelId)
  if (!channel) throw new Error('Canal Microsoft Teams introuvable ou inaccessible.')
  return { teamId: team.id, teamName: team.displayName, channelId: channel.id, channelName: channel.displayName }
}

export function serializeTeamsDestination(destination: TeamsDestination) {
  return JSON.stringify(teamsDestinationSchema.parse(destination))
}

export function parseTeamsDestination(value: string) {
  try {
    return teamsDestinationSchema.safeParse(JSON.parse(value))
  } catch {
    return { success: false as const, error: new Error('Invalid Teams destination') }
  }
}

export async function postTeamsChannelMessage(input: {
  accessToken: string
  teamId: string
  channelId: string
  html: string
}) {
  const response = await fetch(
    `${MICROSOFT_GRAPH_ORIGIN}/v1.0/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { contentType: 'html', content: input.html } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    },
  )
  if (!response.ok) throw await graphError(response)
  const raw: unknown = await response.json().catch(() => ({}))
  return z.object({ id: z.string().optional() }).parse(raw).id
}
