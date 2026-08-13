import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTeamsPkce,
  exchangeTeamsAuthorizationCode,
  hasTeamsOAuthConfiguration,
  listJoinedTeams,
  listTeamChannels,
  parseTeamsDestination,
  postTeamsChannelMessage,
  refreshTeamsAccessToken,
  resolveTeamsDestination,
  serializeTeamsDestination,
  teamsAuthorizationUrl,
} from './teams-oauth'

const originalFetch = global.fetch
const previousClientId = process.env.MICROSOFT_CLIENT_ID
const previousClientSecret = process.env.MICROSOFT_CLIENT_SECRET

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Microsoft Teams OAuth and Graph', () => {
  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = 'microsoft-client-id'
    process.env.MICROSOFT_CLIENT_SECRET = 'microsoft-client-secret'
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (previousClientId === undefined) delete process.env.MICROSOFT_CLIENT_ID
    else process.env.MICROSOFT_CLIENT_ID = previousClientId
    if (previousClientSecret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET
    else process.env.MICROSOFT_CLIENT_SECRET = previousClientSecret
    vi.restoreAllMocks()
  })

  it('builds a confidential-client authorization URL with PKCE and least-privilege delegated scopes', () => {
    const pkce = createTeamsPkce()
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const url = new URL(teamsAuthorizationUrl({
      state: 'state-123', redirectUri: 'https://ads.example.test/api/connectors/teams/callback', codeChallenge: pkce.challenge,
    }))
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('scope')).toContain('ChannelMessage.Send')
    expect(url.searchParams.get('scope')).not.toContain('Group.ReadWrite.All')
  })

  it('exchanges and rotates refresh tokens without leaking them in request URLs', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({
        access_token: 'access-token-with-sufficient-length-1', expires_in: 3600,
        refresh_token: 'refresh-token-with-sufficient-length-1', scope: 'ChannelMessage.Send offline_access',
      }))
      .mockResolvedValueOnce(json({
        access_token: 'access-token-with-sufficient-length-2', expires_in: 3600,
        refresh_token: 'refresh-token-with-sufficient-length-2', scope: 'ChannelMessage.Send offline_access',
      }))
    await expect(exchangeTeamsAuthorizationCode({
      code: 'code-1', redirectUri: 'https://ads.example.test/api/connectors/teams/callback', codeVerifier: 'verifier-1',
    })).resolves.toMatchObject({ refreshToken: 'refresh-token-with-sufficient-length-1' })
    await expect(refreshTeamsAccessToken('refresh-token-with-sufficient-length-1')).resolves.toMatchObject({
      refreshToken: 'refresh-token-with-sufficient-length-2',
    })
    const [target, options] = vi.mocked(global.fetch).mock.calls[0]
    expect(String(target)).not.toContain('code-1')
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store' })
  })

  it('fails closed on provider errors and missing refresh tokens', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400))
      .mockResolvedValueOnce(json({ access_token: 'access-token-with-sufficient-length', expires_in: 3600, scope: '' }))
    const input = { code: 'code', redirectUri: 'https://ads.example.test/callback', codeVerifier: 'verifier' }
    await expect(exchangeTeamsAuthorizationCode(input)).rejects.toThrow('invalid_grant')
    await expect(exchangeTeamsAuthorizationCode(input)).rejects.toThrow('refresh token')
  })

  it('paginates only trusted Graph URLs and resolves an accessible team/channel pair', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({
        value: [{ id: 'team-2', displayName: 'Team B' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/joinedTeams?$skiptoken=next',
      }))
      .mockResolvedValueOnce(json({ value: [{ id: 'team-1', displayName: 'Team A' }] }))
    await expect(listJoinedTeams('access-token')).resolves.toEqual([
      { id: 'team-2', displayName: 'Team B' }, { id: 'team-1', displayName: 'Team A' },
    ])

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({ value: [{ id: 'team-1', displayName: 'Team A' }] }))
      .mockResolvedValueOnce(json({ value: [{ id: 'channel-1', displayName: 'Alerts', membershipType: 'standard' }] }))
    await expect(resolveTeamsDestination({ accessToken: 'access-token', teamId: 'team-1', channelId: 'channel-1' })).resolves.toEqual({
      teamId: 'team-1', teamName: 'Team A', channelId: 'channel-1', channelName: 'Alerts',
    })

    vi.mocked(global.fetch).mockResolvedValueOnce(json({
      value: [], '@odata.nextLink': 'https://attacker.example.test/steal',
    }))
    await expect(listJoinedTeams('access-token')).rejects.toThrow('pagination inattendue')
  })

  it('lists channels, posts HTML via Graph and returns provider evidence', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(json({ value: [{ id: 'channel-1', displayName: 'Alerts' }] }))
      .mockResolvedValueOnce(json({ id: 'message-1' }, 201))
    await expect(listTeamChannels('access-token', 'team-1')).resolves.toEqual([{ id: 'channel-1', displayName: 'Alerts' }])
    await expect(postTeamsChannelMessage({
      accessToken: 'access-token', teamId: 'team-1', channelId: 'channel-1', html: '<p>Alert</p>',
    })).resolves.toBe('message-1')
    const [, options] = vi.mocked(global.fetch).mock.calls[1]
    expect(options).toMatchObject({ method: 'POST', body: JSON.stringify({ body: { contentType: 'html', content: '<p>Alert</p>' } }) })
  })

  it('serializes only versioned Teams Graph destinations and detects missing configuration', () => {
    const serialized = serializeTeamsDestination({
      v: 1, provider: 'teams_graph', teamId: 'team-1', teamName: 'Team', channelId: 'channel-1', channelName: 'Alerts',
      refreshToken: 'refresh-token-with-sufficient-length',
    })
    expect(parseTeamsDestination(serialized)).toMatchObject({ success: true, data: { teamId: 'team-1' } })
    expect(parseTeamsDestination('https://legacy-webhook.example.test')).toMatchObject({ success: false })
    delete process.env.MICROSOFT_CLIENT_SECRET
    expect(hasTeamsOAuthConfiguration()).toBe(false)
    expect(() => teamsAuthorizationUrl({ state: 'x', redirectUri: 'https://ads.example.test/callback', codeChallenge: 'x' })).toThrow('incomplète')
  })
})
