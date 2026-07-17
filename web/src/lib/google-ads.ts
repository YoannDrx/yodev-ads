import 'server-only'

import { OAuth2Client } from 'google-auth-library'
import { decryptSecret } from '@/lib/crypto'
import { getServerEnv } from '@/lib/env'
import { normalizeCustomerId } from '@/lib/ids'

export const GOOGLE_ADS_API_VERSION = 'v24'
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'

export type GoogleAdsConnectionCredentials = {
  encryptedRefreshToken: string
  managerCustomerId: string
}

export type ManagedCustomer = {
  customerId: string
  name: string
  currencyCode: string
  timezone: string
  isManager: boolean
}

export type CampaignPerformance = {
  id: string
  name: string
  status: string
  channelType: string
  budgetResourceName: string
  budgetMicros: string
  impressions: string
  clicks: string
  costMicros: string
  conversions: number
}

type ApiResult<T> = {
  data: T
  requestId: string | null
}

export function createOAuthClient(redirectUri?: string) {
  const env = getServerEnv()
  return new OAuth2Client({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: redirectUri ?? env.GOOGLE_OAUTH_REDIRECT_URI,
  })
}

export function googleAuthorizationUrl(state: string, redirectUri: string) {
  return createOAuthClient(redirectUri).generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent select_account',
    scope: [GOOGLE_ADS_SCOPE, 'openid', 'email'],
    state,
  })
}

export async function exchangeAuthorizationCode(code: string, redirectUri: string) {
  const client = createOAuthClient(redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) throw new Error('Google n’a pas renvoyé de jeton de renouvellement. Reconnectez le compte.')

  let email: string | null = null
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: getServerEnv().GOOGLE_OAUTH_CLIENT_ID,
    })
    email = ticket.getPayload()?.email ?? null
  }

  return { refreshToken: tokens.refresh_token, scopes: tokens.scope?.split(' ') ?? [], email }
}

export class GoogleAdsGateway {
  private readonly managerCustomerId: string
  private readonly oauthClient: OAuth2Client

  constructor(credentials: GoogleAdsConnectionCredentials) {
    this.managerCustomerId = normalizeCustomerId(credentials.managerCustomerId)
    this.oauthClient = createOAuthClient()
    this.oauthClient.setCredentials({ refresh_token: decryptSecret(credentials.encryptedRefreshToken) })
  }

  private async accessToken() {
    const response = await this.oauthClient.getAccessToken()
    if (!response.token) throw new Error('Impossible de renouveler l’accès Google Ads.')
    return response.token
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const env = getServerEnv()
    const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': this.managerCustomerId,
        ...init.headers,
      },
    })
    const requestId = response.headers.get('request-id')
    const data = (await response.json()) as T & { error?: { message?: string; status?: string } }
    if (!response.ok) {
      const message = data.error?.message ?? `Google Ads a répondu avec le statut ${response.status}`
      throw new GoogleAdsError(message, response.status, requestId)
    }
    return { data, requestId }
  }

  private async search<T>(customerId: string, query: string): Promise<T[]> {
    const normalized = normalizeCustomerId(customerId)
    const { data } = await this.request<Array<{ results?: T[] }>>(
      `/customers/${normalized}/googleAds:searchStream`,
      { method: 'POST', body: JSON.stringify({ query }) },
    )
    return data.flatMap((batch) => batch.results ?? [])
  }

  async listManagedCustomers(): Promise<ManagedCustomer[]> {
    type Row = {
      customerClient?: {
        clientCustomer?: string
        descriptiveName?: string
        currencyCode?: string
        timeZone?: string
        manager?: boolean
        level?: string | number
        status?: string
      }
    }
    const rows = await this.search<Row>(
      this.managerCustomerId,
      `SELECT customer_client.client_customer,
              customer_client.descriptive_name,
              customer_client.currency_code,
              customer_client.time_zone,
              customer_client.manager,
              customer_client.level,
              customer_client.status
       FROM customer_client
       WHERE customer_client.status = 'ENABLED'
       ORDER BY customer_client.level, customer_client.descriptive_name`,
    )
    return rows.flatMap(({ customerClient }) => {
      const customerId = customerClient?.clientCustomer?.split('/').at(-1)
      if (!customerId) return []
      return [
        {
          customerId,
          name: customerClient?.descriptiveName || `Compte ${customerId}`,
          currencyCode: customerClient?.currencyCode || 'EUR',
          timezone: customerClient?.timeZone || 'Europe/Paris',
          isManager: Boolean(customerClient?.manager),
        },
      ]
    })
  }

  async campaignPerformance(customerId: string): Promise<CampaignPerformance[]> {
    type Row = {
      campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string; campaignBudget?: string }
      campaignBudget?: { amountMicros?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number }
    }
    const rows = await this.search<Row>(
      customerId,
      `SELECT campaign.id,
              campaign.name,
              campaign.status,
              campaign.advertising_channel_type,
              campaign.campaign_budget,
              campaign_budget.amount_micros,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions
       FROM campaign
       WHERE campaign.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC`,
    )
    return rows.map(({ campaign, campaignBudget, metrics }) => ({
      id: campaign?.id ?? '',
      name: campaign?.name ?? 'Campagne sans nom',
      status: campaign?.status ?? 'UNKNOWN',
      channelType: campaign?.advertisingChannelType ?? 'UNKNOWN',
      budgetResourceName: campaign?.campaignBudget ?? '',
      budgetMicros: campaignBudget?.amountMicros ?? '0',
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
    }))
  }

  async validateCampaignStatus(customerId: string, campaignId: string, status: 'ENABLED' | 'PAUSED') {
    return this.mutateCampaignStatus(customerId, campaignId, status, true)
  }

  async mutateCampaignStatus(
    customerId: string,
    campaignId: string,
    status: 'ENABLED' | 'PAUSED',
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    return this.request<Record<string, unknown>>(`/customers/${normalized}/campaigns:mutate`, {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          {
            update: { resourceName: `customers/${normalized}/campaigns/${campaignId}`, status },
            updateMask: 'status',
          },
        ],
        validateOnly,
      }),
    })
  }

  async validateBudget(customerId: string, budgetResourceName: string, amountMicros: string) {
    return this.mutateBudget(customerId, budgetResourceName, amountMicros, true)
  }

  async mutateBudget(
    customerId: string,
    budgetResourceName: string,
    amountMicros: string,
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    if (!budgetResourceName.startsWith(`customers/${normalized}/campaignBudgets/`)) {
      throw new Error('La ressource budget ne correspond pas au compte client.')
    }
    return this.request<Record<string, unknown>>(`/customers/${normalized}/campaignBudgets:mutate`, {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          {
            update: { resourceName: budgetResourceName, amountMicros },
            updateMask: 'amount_micros',
          },
        ],
        validateOnly,
      }),
    })
  }
}

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message)
    this.name = 'GoogleAdsError'
  }
}
