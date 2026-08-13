import 'server-only'

import { z } from 'zod'

const slackOAuthResponseSchema = z.object({
  ok: z.literal(true),
  scope: z.string(),
  team: z.object({ id: z.string().min(1), name: z.string().min(1).max(160) }),
  incoming_webhook: z.object({
    channel: z.string().min(1).max(160),
    channel_id: z.string().min(1).max(80),
    configuration_url: z.string().url(),
    url: z.string().url(),
  }),
})

const slackOAuthErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string().min(1).max(200),
})

export function hasSlackOAuthConfiguration() {
  return Boolean(process.env.SLACK_CLIENT_ID?.trim() && process.env.SLACK_CLIENT_SECRET?.trim())
}

function slackConfiguration() {
  const clientId = process.env.SLACK_CLIENT_ID?.trim()
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('La configuration OAuth Slack est incomplète.')
  return { clientId, clientSecret }
}

export function slackAuthorizationUrl(input: { state: string; redirectUri: string }) {
  const { clientId } = slackConfiguration()
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'incoming-webhook')
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  return url.toString()
}

export async function exchangeSlackAuthorizationCode(input: { code: string; redirectUri: string }) {
  const { clientId, clientSecret } = slackConfiguration()
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  const raw: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Slack OAuth HTTP ${response.status}`)
  const failure = slackOAuthErrorSchema.safeParse(raw)
  if (failure.success) throw new Error(`Slack a refusé l’autorisation : ${failure.data.error}`)
  const result = slackOAuthResponseSchema.parse(raw)
  if (!result.scope.split(',').map((scope) => scope.trim()).includes('incoming-webhook')) {
    throw new Error('Slack n’a pas accordé le scope incoming-webhook requis.')
  }
  const webhook = new URL(result.incoming_webhook.url)
  if (webhook.protocol !== 'https:' || webhook.hostname !== 'hooks.slack.com') {
    throw new Error('Slack a renvoyé une destination webhook inattendue.')
  }
  return {
    teamId: result.team.id,
    teamName: result.team.name,
    channelId: result.incoming_webhook.channel_id,
    channelName: result.incoming_webhook.channel,
    configurationUrl: result.incoming_webhook.configuration_url,
    webhookUrl: webhook.toString(),
  }
}
