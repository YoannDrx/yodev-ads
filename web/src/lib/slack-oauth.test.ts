import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exchangeSlackAuthorizationCode, hasSlackOAuthConfiguration, slackAuthorizationUrl } from './slack-oauth'

const originalFetch = global.fetch
const previousClientId = process.env.SLACK_CLIENT_ID
const previousClientSecret = process.env.SLACK_CLIENT_SECRET

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Slack OAuth', () => {
  beforeEach(() => {
    process.env.SLACK_CLIENT_ID = 'slack-client-id'
    process.env.SLACK_CLIENT_SECRET = 'slack-client-secret'
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (previousClientId === undefined) delete process.env.SLACK_CLIENT_ID
    else process.env.SLACK_CLIENT_ID = previousClientId
    if (previousClientSecret === undefined) delete process.env.SLACK_CLIENT_SECRET
    else process.env.SLACK_CLIENT_SECRET = previousClientSecret
    vi.restoreAllMocks()
  })

  it('builds the least-privilege OAuth URL with redirect and anti-CSRF state', () => {
    const url = new URL(slackAuthorizationUrl({ state: 'state-123', redirectUri: 'https://ads.example.test/api/connectors/slack/callback' }))
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(url.searchParams.get('client_id')).toBe('slack-client-id')
    expect(url.searchParams.get('scope')).toBe('incoming-webhook')
    expect(url.searchParams.get('state')).toBe('state-123')
  })

  it('exchanges the code and accepts only the scoped official Slack webhook', async () => {
    vi.mocked(global.fetch).mockResolvedValue(response({
      ok: true,
      scope: 'incoming-webhook',
      team: { id: 'T123', name: 'Yodev' },
      incoming_webhook: {
        channel: '#ads-alerts',
        channel_id: 'C123',
        configuration_url: 'https://yodev.slack.com/services/B123',
        url: 'https://hooks.slack.com/services/T123/B123/secret',
      },
    }))
    await expect(exchangeSlackAuthorizationCode({
      code: 'code-123', redirectUri: 'https://ads.example.test/api/connectors/slack/callback',
    })).resolves.toEqual({
      teamId: 'T123', teamName: 'Yodev', channelId: 'C123', channelName: '#ads-alerts',
      configurationUrl: 'https://yodev.slack.com/services/B123',
      webhookUrl: 'https://hooks.slack.com/services/T123/B123/secret',
    })
    expect(global.fetch).toHaveBeenCalledWith('https://slack.com/api/oauth.v2.access', expect.objectContaining({
      method: 'POST', cache: 'no-store',
      headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
    }))
  })

  it('fails closed on HTTP, Slack, scope and webhook-origin errors', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ error: 'upstream' }, 503))
      .mockResolvedValueOnce(response({ ok: false, error: 'invalid_code' }))
      .mockResolvedValueOnce(response({
        ok: true, scope: 'chat:write', team: { id: 'T1', name: 'Team' },
        incoming_webhook: { channel: '#x', channel_id: 'C1', configuration_url: 'https://team.slack.com/services/B1', url: 'https://hooks.slack.com/services/T/B/x' },
      }))
      .mockResolvedValueOnce(response({
        ok: true, scope: 'incoming-webhook', team: { id: 'T1', name: 'Team' },
        incoming_webhook: { channel: '#x', channel_id: 'C1', configuration_url: 'https://team.slack.com/services/B1', url: 'https://attacker.example.test/hook' },
      }))
    const input = { code: 'code', redirectUri: 'https://ads.example.test/callback' }
    await expect(exchangeSlackAuthorizationCode(input)).rejects.toThrow('HTTP 503')
    await expect(exchangeSlackAuthorizationCode(input)).rejects.toThrow('invalid_code')
    await expect(exchangeSlackAuthorizationCode(input)).rejects.toThrow('scope incoming-webhook')
    await expect(exchangeSlackAuthorizationCode(input)).rejects.toThrow('inattendue')
  })

  it('reports missing provider configuration without exposing secrets', () => {
    delete process.env.SLACK_CLIENT_SECRET
    expect(hasSlackOAuthConfiguration()).toBe(false)
    expect(() => slackAuthorizationUrl({ state: 'x', redirectUri: 'https://ads.example.test/callback' })).toThrow('incomplète')
  })
})
