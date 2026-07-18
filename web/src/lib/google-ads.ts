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

export type SearchTermPerformance = {
  searchTerm: string
  targetingStatus: string
  campaignId: string
  campaignName: string
  adGroupId: string
  adGroupName: string
  impressions: string
  clicks: string
  costMicros: string
  conversions: number
}

export type KeywordPerformance = {
  criterionId: string
  text: string
  matchType: string
  status: string
  qualityScore: number | null
  expectedCtr: string
  adRelevance: string
  landingPageExperience: string
  campaignId: string
  campaignName: string
  adGroupId: string
  adGroupName: string
  impressions: string
  clicks: string
  costMicros: string
  conversions: number
}

export type ResponsiveSearchAdPerformance = {
  id: string
  status: string
  adStrength: string
  approvalStatus: string
  campaignId: string
  campaignName: string
  adGroupId: string
  adGroupName: string
  headlines: string[]
  descriptions: string[]
  impressions: string
  clicks: string
  costMicros: string
  conversions: number
}

export type ConversionTrackingStatus = {
  status: string
  managerCustomer: string | null
  acceptedCustomerDataTerms: boolean
  enhancedConversionsForLeadsEnabled: boolean
}

export type AccountAnalysisData = {
  campaigns: CampaignPerformance[]
  searchTerms: SearchTermPerformance[]
  keywords: KeywordPerformance[]
  ads: ResponsiveSearchAdPerformance[]
  conversionTracking: ConversionTrackingStatus
}

type ApiResult<T> = {
  data: T
  requestId: string | null
}

type GoogleAdsFailurePayload = {
  error?: {
    message?: string
    status?: string
    details?: Array<{
      errors?: Array<{
        errorCode?: Record<string, string>
        message?: string
        location?: {
          fieldPathElements?: Array<{ fieldName?: string; index?: number }>
        }
      }>
      requestId?: string
    }>
  }
}

function formatFieldPath(elements: Array<{ fieldName?: string; index?: number }> | undefined) {
  return elements
    ?.map((element) => `${element.fieldName ?? '?'}${element.index === undefined ? '' : `[${element.index}]`}`)
    .join('.')
}

export function parseGoogleAdsFailure(payload: GoogleAdsFailurePayload) {
  const failures = payload.error?.details?.flatMap((detail) => detail.errors ?? []) ?? []
  const messages = failures.map((failure) => {
    const [family, code] = Object.entries(failure.errorCode ?? {})[0] ?? []
    const identifier = family && code ? `${family}.${code}` : null
    const location = formatFieldPath(failure.location?.fieldPathElements)
    const context = [identifier, location].filter(Boolean).join(' · ')
    return `${context ? `[${context}] ` : ''}${failure.message ?? 'Erreur Google Ads non détaillée'}`
  })

  return {
    message: messages.join(' | ') || payload.error?.message || 'Google Ads a rejeté la requête.',
    requestId: payload.error?.details?.find((detail) => detail.requestId)?.requestId ?? null,
  }
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
    const data = (await response.json()) as T & GoogleAdsFailurePayload
    if (!response.ok) {
      const failure = parseGoogleAdsFailure(data)
      throw new GoogleAdsError(
        failure.message || `Google Ads a répondu avec le statut ${response.status}`,
        response.status,
        requestId ?? failure.requestId,
      )
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

  async searchTermPerformance(customerId: string): Promise<SearchTermPerformance[]> {
    type Row = {
      searchTermView?: { searchTerm?: string; status?: string }
      campaign?: { id?: string; name?: string }
      adGroup?: { id?: string; name?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number }
    }
    const rows = await this.search<Row>(
      customerId,
      `SELECT search_term_view.search_term,
              search_term_view.status,
              campaign.id,
              campaign.name,
              ad_group.id,
              ad_group.name,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions
       FROM search_term_view
       WHERE campaign.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
         AND metrics.impressions > 0
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`,
    )
    return rows.map(({ searchTermView, campaign, adGroup, metrics }) => ({
      searchTerm: searchTermView?.searchTerm ?? 'Terme indisponible',
      targetingStatus: searchTermView?.status ?? 'UNKNOWN',
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      adGroupId: adGroup?.id ?? '',
      adGroupName: adGroup?.name ?? 'Groupe sans nom',
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
    }))
  }

  async keywordPerformance(customerId: string): Promise<KeywordPerformance[]> {
    type Row = {
      adGroupCriterion?: {
        criterionId?: string
        status?: string
        keyword?: { text?: string; matchType?: string }
        qualityInfo?: {
          qualityScore?: number
          searchPredictedCtr?: string
          creativeQualityScore?: string
          postClickQualityScore?: string
        }
      }
      campaign?: { id?: string; name?: string }
      adGroup?: { id?: string; name?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number }
    }
    const rows = await this.search<Row>(
      customerId,
      `SELECT ad_group_criterion.criterion_id,
              ad_group_criterion.status,
              ad_group_criterion.keyword.text,
              ad_group_criterion.keyword.match_type,
              ad_group_criterion.quality_info.quality_score,
              ad_group_criterion.quality_info.search_predicted_ctr,
              ad_group_criterion.quality_info.creative_quality_score,
              ad_group_criterion.quality_info.post_click_quality_score,
              campaign.id,
              campaign.name,
              ad_group.id,
              ad_group.name,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions
       FROM keyword_view
       WHERE campaign.status != 'REMOVED'
         AND ad_group.status != 'REMOVED'
         AND ad_group_criterion.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`,
    )
    return rows.map(({ adGroupCriterion, campaign, adGroup, metrics }) => ({
      criterionId: adGroupCriterion?.criterionId ?? '',
      text: adGroupCriterion?.keyword?.text ?? 'Mot-clé indisponible',
      matchType: adGroupCriterion?.keyword?.matchType ?? 'UNKNOWN',
      status: adGroupCriterion?.status ?? 'UNKNOWN',
      qualityScore: adGroupCriterion?.qualityInfo?.qualityScore ?? null,
      expectedCtr: adGroupCriterion?.qualityInfo?.searchPredictedCtr ?? 'UNSPECIFIED',
      adRelevance: adGroupCriterion?.qualityInfo?.creativeQualityScore ?? 'UNSPECIFIED',
      landingPageExperience: adGroupCriterion?.qualityInfo?.postClickQualityScore ?? 'UNSPECIFIED',
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      adGroupId: adGroup?.id ?? '',
      adGroupName: adGroup?.name ?? 'Groupe sans nom',
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
    }))
  }

  async responsiveSearchAdPerformance(customerId: string): Promise<ResponsiveSearchAdPerformance[]> {
    type TextAsset = { text?: string }
    type Row = {
      adGroupAd?: {
        status?: string
        adStrength?: string
        policySummary?: { approvalStatus?: string }
        ad?: {
          id?: string
          responsiveSearchAd?: { headlines?: TextAsset[]; descriptions?: TextAsset[] }
        }
      }
      campaign?: { id?: string; name?: string }
      adGroup?: { id?: string; name?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number }
    }
    const rows = await this.search<Row>(
      customerId,
      `SELECT ad_group_ad.ad.id,
              ad_group_ad.status,
              ad_group_ad.ad_strength,
              ad_group_ad.policy_summary.approval_status,
              ad_group_ad.ad.responsive_search_ad.headlines,
              ad_group_ad.ad.responsive_search_ad.descriptions,
              campaign.id,
              campaign.name,
              ad_group.id,
              ad_group.name,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions
       FROM ad_group_ad
       WHERE campaign.status != 'REMOVED'
         AND ad_group.status != 'REMOVED'
         AND ad_group_ad.status != 'REMOVED'
         AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`,
    )
    return rows.map(({ adGroupAd, campaign, adGroup, metrics }) => ({
      id: adGroupAd?.ad?.id ?? '',
      status: adGroupAd?.status ?? 'UNKNOWN',
      adStrength: adGroupAd?.adStrength ?? 'UNSPECIFIED',
      approvalStatus: adGroupAd?.policySummary?.approvalStatus ?? 'UNSPECIFIED',
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      adGroupId: adGroup?.id ?? '',
      adGroupName: adGroup?.name ?? 'Groupe sans nom',
      headlines: (adGroupAd?.ad?.responsiveSearchAd?.headlines ?? []).flatMap((asset) =>
        asset.text ? [asset.text] : [],
      ),
      descriptions: (adGroupAd?.ad?.responsiveSearchAd?.descriptions ?? []).flatMap((asset) =>
        asset.text ? [asset.text] : [],
      ),
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
    }))
  }

  async conversionTrackingStatus(customerId: string): Promise<ConversionTrackingStatus> {
    type Row = {
      customer?: {
        conversionTrackingSetting?: {
          conversionTrackingStatus?: string
          googleAdsConversionCustomer?: string
          acceptedCustomerDataTerms?: boolean
          enhancedConversionsForLeadsEnabled?: boolean
        }
      }
    }
    const [row] = await this.search<Row>(
      customerId,
      `SELECT customer.conversion_tracking_setting.conversion_tracking_status,
              customer.conversion_tracking_setting.google_ads_conversion_customer,
              customer.conversion_tracking_setting.accepted_customer_data_terms,
              customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled
       FROM customer
       LIMIT 1`,
    )
    const setting = row?.customer?.conversionTrackingSetting
    return {
      status: setting?.conversionTrackingStatus ?? 'UNSPECIFIED',
      managerCustomer: setting?.googleAdsConversionCustomer?.split('/').at(-1) ?? null,
      acceptedCustomerDataTerms: setting?.acceptedCustomerDataTerms ?? false,
      enhancedConversionsForLeadsEnabled: setting?.enhancedConversionsForLeadsEnabled ?? false,
    }
  }

  async accountAnalysis(customerId: string): Promise<AccountAnalysisData> {
    const [campaigns, searchTerms, keywords, ads, conversionTracking] = await Promise.all([
      this.campaignPerformance(customerId),
      this.searchTermPerformance(customerId),
      this.keywordPerformance(customerId),
      this.responsiveSearchAdPerformance(customerId),
      this.conversionTrackingStatus(customerId),
    ])
    return { campaigns, searchTerms, keywords, ads, conversionTracking }
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
