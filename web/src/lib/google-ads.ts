import 'server-only'

import { OAuth2Client } from 'google-auth-library'
import { decryptSecret } from '@/lib/crypto'
import { getServerEnv } from '@/lib/env'
import { normalizeCustomerId } from '@/lib/ids'
import { creativeFatigueSignal, type CreativePeriodMetrics } from '@/lib/creative-fatigue'
import { requireFeature } from '@/lib/feature-flags'

export const GOOGLE_ADS_API_VERSION = 'v25'
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'

export function campaignNegativeKeywordInventoryGaql(campaignId: string) {
  const normalizedCampaignId = BigInt(campaignId).toString()
  return `SELECT campaign.id, campaign.resource_name
       FROM campaign
       WHERE campaign.id = ${normalizedCampaignId}
         AND campaign.status != 'REMOVED'
       LIMIT 1`
}

export function campaignNegativeKeywordCriteriaGaql(campaignId: string) {
  const normalizedCampaignId = BigInt(campaignId).toString()
  return `SELECT campaign.id,
              campaign.resource_name,
              campaign_criterion.status,
              campaign_criterion.negative,
              campaign_criterion.keyword.text,
              campaign_criterion.keyword.match_type
       FROM campaign_criterion
       WHERE campaign.id = ${normalizedCampaignId}
         AND campaign_criterion.type = 'KEYWORD'
         AND campaign_criterion.status != 'REMOVED'
       LIMIT 10000`
}

export const ACCOUNT_NEGATIVE_KEYWORD_CAMPAIGNS_GAQL = `SELECT campaign.id
       FROM campaign
       WHERE campaign.status != 'REMOVED'
       ORDER BY campaign.id
       LIMIT 501`

export const ACCOUNT_NEGATIVE_KEYWORD_SHARED_SET_GAQL = `SELECT shared_set.resource_name,
              shared_set.status,
              shared_set.type
       FROM shared_set
       WHERE shared_set.type = 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS'
         AND shared_set.status = 'ENABLED'
       LIMIT 2`

export const ACCOUNT_NEGATIVE_KEYWORD_ATTACHMENT_GAQL = `SELECT customer_negative_criterion.resource_name,
              customer_negative_criterion.negative_keyword_list.shared_set
       FROM customer_negative_criterion
       WHERE customer_negative_criterion.type = 'NEGATIVE_KEYWORD_LIST'
       LIMIT 2`

export const ACCOUNT_NEGATIVE_KEYWORD_CRITERIA_GAQL = `SELECT shared_set.resource_name,
              shared_criterion.keyword.text,
              shared_criterion.keyword.match_type
       FROM shared_criterion
       WHERE shared_set.type = 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS'
         AND shared_set.status = 'ENABLED'
         AND shared_criterion.type = 'KEYWORD'
       LIMIT 10000`

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
  conversionValueMicros: string
  searchBudgetLostImpressionShare: number | null
  searchRankLostImpressionShare: number | null
}

export const CAMPAIGN_INVENTORY_GAQL = `SELECT campaign.id,
              campaign.name,
              campaign.status,
              campaign.advertising_channel_type,
              campaign.campaign_budget,
              campaign_budget.amount_micros
       FROM campaign
       WHERE campaign.status != 'REMOVED'
       ORDER BY campaign.name`

export const CAMPAIGN_METRICS_30D_GAQL = `SELECT campaign.id,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value,
              metrics.search_budget_lost_impression_share,
              metrics.search_rank_lost_impression_share
       FROM campaign
       WHERE campaign.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC`

export const CONVERSION_ACTIONS_GAQL = `SELECT conversion_action.resource_name,
              conversion_action.name,
              conversion_action.status,
              conversion_action.category,
              conversion_action.origin,
              conversion_action.type,
              conversion_action.primary_for_goal,
              conversion_action.include_in_conversions_metric,
              metrics.conversion_last_conversion_date,
              metrics.conversion_last_received_request_date_time
       FROM conversion_action
       WHERE conversion_action.status != 'REMOVED'
       ORDER BY conversion_action.name`

export const OFFLINE_CONVERSION_DIAGNOSTICS_GAQL = `SELECT customer.id,
              offline_conversion_upload_client_summary.client,
              offline_conversion_upload_client_summary.status,
              offline_conversion_upload_client_summary.last_upload_date_time,
              offline_conversion_upload_client_summary.total_event_count,
              offline_conversion_upload_client_summary.successful_event_count,
              offline_conversion_upload_client_summary.pending_event_count,
              offline_conversion_upload_client_summary.success_rate,
              offline_conversion_upload_client_summary.alerts
       FROM offline_conversion_upload_client_summary`

export const DEVICE_PERFORMANCE_GAQL = `SELECT segments.device,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM campaign
       WHERE campaign.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC`

export const SCHEDULE_PERFORMANCE_GAQL = `SELECT segments.day_of_week,
              segments.hour,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM campaign
       WHERE campaign.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC`

export const GEOGRAPHIC_PERFORMANCE_GAQL = `SELECT geographic_view.country_criterion_id,
              geographic_view.location_type,
              campaign.id,
              campaign.name,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM geographic_view
       WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`

export const AUCTION_INSIGHTS_GAQL = `SELECT segments.auction_insight_domain,
              campaign.id,
              campaign.name,
              metrics.auction_insight_search_impression_share,
              metrics.auction_insight_search_overlap_rate,
              metrics.auction_insight_search_position_above_rate,
              metrics.auction_insight_search_outranking_share,
              metrics.auction_insight_search_top_impression_percentage,
              metrics.auction_insight_search_absolute_top_impression_percentage
       FROM campaign
       WHERE campaign.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.auction_insight_search_impression_share DESC
       LIMIT 500`

export const PMAX_PLACEMENTS_GAQL = `SELECT campaign.id,
              campaign.name,
              performance_max_placement_view.display_name,
              performance_max_placement_view.placement,
              performance_max_placement_view.placement_type,
              performance_max_placement_view.target_url,
              metrics.impressions
       FROM performance_max_placement_view
       WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.impressions DESC
       LIMIT 500`

export const ASSET_GROUP_PERFORMANCE_GAQL = `SELECT campaign.id,
              campaign.name,
              asset_group.id,
              asset_group.name,
              asset_group.status,
              asset_group.ad_strength,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM asset_group
       WHERE asset_group.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`

export const ASSET_PERFORMANCE_GAQL = `SELECT campaign.id,
              campaign.name,
              asset_group.id,
              asset_group.name,
              asset_group_asset.asset,
              asset_group_asset.field_type,
              asset_group_asset.status,
              asset_group_asset.primary_status,
              asset_group_asset.performance_label,
              segments.date,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM asset_group_asset
       WHERE asset_group_asset.status != 'REMOVED'
         AND segments.date DURING LAST_30_DAYS
       ORDER BY metrics.impressions DESC
       LIMIT 10000`

export const SHOPPING_PRODUCT_PERFORMANCE_GAQL = `SELECT campaign.id,
              campaign.name,
              segments.product_item_id,
              segments.product_title,
              segments.product_brand,
              segments.product_merchant_id,
              segments.product_country,
              segments.product_channel,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM shopping_performance_view
       WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`

export const SHOPPING_PRODUCT_STATUS_GAQL = `SELECT shopping_product.resource_name,
              shopping_product.merchant_center_id,
              shopping_product.channel,
              shopping_product.language_code,
              shopping_product.feed_label,
              shopping_product.item_id,
              shopping_product.title,
              shopping_product.status,
              shopping_product.issues
       FROM shopping_product
       WHERE shopping_product.status != 'ELIGIBLE'
       LIMIT 500`

export const CAMPAIGN_AUDIENCE_PERFORMANCE_GAQL = `SELECT campaign.id,
              campaign.name,
              campaign_criterion.criterion_id,
              campaign_criterion.bid_modifier,
              user_list.name,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM campaign_audience_view
       WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`

export const AD_GROUP_AUDIENCE_PERFORMANCE_GAQL = `SELECT campaign.id,
              campaign.name,
              ad_group.id,
              ad_group.name,
              ad_group_criterion.criterion_id,
              ad_group_criterion.bid_modifier,
              user_list.name,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM ad_group_audience_view
       WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`

export const GROUP_PLACEMENT_PERFORMANCE_GAQL = `SELECT campaign.id,
              campaign.name,
              ad_group.id,
              ad_group.name,
              group_placement_view.display_name,
              group_placement_view.placement,
              group_placement_view.placement_type,
              group_placement_view.target_url,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.view_through_conversions
       FROM group_placement_view
       WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC
       LIMIT 500`

export function changeEventsGaql(from: Date, through: Date) {
  const gaqlDateTime = (value: Date) => value.toISOString().replace('T', ' ').replace('Z', '+00:00')
  if (from > through || through.getTime() - from.getTime() > 30 * 24 * 60 * 60_000) {
    throw new Error('Google Ads change-event range must be within 30 days')
  }
  return `SELECT change_event.resource_name,
              change_event.change_date_time,
              change_event.change_resource_name,
              change_event.user_email,
              change_event.client_type,
              change_event.change_resource_type,
              change_event.old_resource,
              change_event.new_resource,
              change_event.resource_change_operation,
              change_event.changed_fields
       FROM change_event
       WHERE change_event.change_date_time >= '${gaqlDateTime(from)}'
         AND change_event.change_date_time <= '${gaqlDateTime(through)}'
       ORDER BY change_event.change_date_time DESC
       LIMIT 10000`
}

export type CampaignMutationState = {
  campaignId: string
  campaignName: string
  campaignResourceName: string
  status: string
  budgetResourceName: string
  budgetMicros: string
  budgetExplicitlyShared: boolean
  budgetReferenceCount: string
}

export type CampaignBudgetBatchChange = {
  budgetResourceName: string
  amountMicros: string
}

export type AtomicGoogleAdsOperation =
  | { kind: 'campaign_status'; campaignId: string; resourceName: string; status: 'ENABLED' | 'PAUSED' }
  | { kind: 'campaign_budget'; campaignId: string; resourceName: string; amountMicros: string }
  | { kind: 'keyword_status'; campaignId: string; resourceName: string; status: 'ENABLED' | 'PAUSED' }
  | { kind: 'ad_status'; campaignId: string; resourceName: string; status: 'ENABLED' | 'PAUSED' }

export type BreakdownPerformance = {
  key: string
  label: string
  impressions: string
  clicks: string
  costMicros: string
  conversions: number
  conversionValueMicros: string
}

export type GeographicPerformance = BreakdownPerformance & {
  campaignId: string
  campaignName: string
  criterionId: string
  locationType: string
}

export type AuctionInsight = {
  campaignId: string
  campaignName: string
  domain: string
  impressionShare: number | null
  overlapRate: number | null
  positionAboveRate: number | null
  outrankingShare: number | null
  topImpressionPercentage: number | null
  absoluteTopImpressionPercentage: number | null
}

export type PlacementInsight = {
  campaignId: string
  campaignName: string
  name: string
  placement: string
  type: string
  targetUrl: string | null
  impressions: string
}

export type AssetGroupPerformance = BreakdownPerformance & {
  campaignId: string
  campaignName: string
  assetGroupId: string
  status: string
  adStrength: string
}

export type AssetPerformance = BreakdownPerformance & {
  campaignId: string
  campaignName: string
  assetGroupId: string
  assetGroupName: string
  assetResourceName: string
  fieldType: string
  status: string
  primaryStatus: string
  performanceLabel: string
  current: CreativePeriodMetrics
  previous: CreativePeriodMetrics
  fatigue: ReturnType<typeof creativeFatigueSignal>
}

export type ShoppingProductPerformance = BreakdownPerformance & {
  campaignId: string
  campaignName: string
  itemId: string
  title: string
  brand: string
  merchantId: string
  country: string
  channel: string
}

export type ShoppingProductDiagnostic = {
  resourceName: string
  merchantId: string
  channel: string
  languageCode: string
  feedLabel: string
  itemId: string
  title: string
  status: string
  issues: Array<{
    errorCode: string
    severity: string
    description: string
    detail: string
    documentation: string | null
    affectedRegions: string[]
    attributeName: string | null
  }>
}

export type CampaignAudiencePerformance = BreakdownPerformance & {
  campaignId: string
  campaignName: string
  criterionId: string
  bidModifier: number | null
}

export type AdGroupAudiencePerformance = CampaignAudiencePerformance & {
  adGroupId: string
  adGroupName: string
}

export type GroupPlacementPerformance = BreakdownPerformance & {
  campaignId: string
  campaignName: string
  adGroupId: string
  adGroupName: string
  placement: string
  placementType: string
  targetUrl: string | null
  viewThroughConversions: number
}

export type KeywordMatchType = 'EXACT' | 'PHRASE' | 'BROAD'
export type NegativeKeywordScope = 'ad_group' | 'campaign' | 'account'

export type NegativeKeywordMatch = {
  text: string
  matchType: string
  negative: boolean
  status: string
}

export type KeywordTextState = {
  campaignId: string
  adGroupId: string
  adGroupResourceName: string
  normalizedText: string
  matches: NegativeKeywordMatch[]
}

export type CampaignNegativeKeywordState = {
  scope: 'campaign'
  campaignId: string
  campaignResourceName: string
  normalizedText: string
  matches: NegativeKeywordMatch[]
}

export type AccountNegativeKeywordState = {
  scope: 'account'
  customerResourceName: string
  sharedSetResourceName: string | null
  attached: boolean
  campaignIds: string[]
  normalizedText: string
  matches: NegativeKeywordMatch[]
}

export type KeywordCriterionState = {
  campaignId: string
  adGroupId: string
  criterionId: string
  resourceName: string
  text: string
  matchType: string
  negative: boolean
  status: string
}

export type AdGroupAdMutationState = {
  campaignId: string
  adGroupId: string
  adId: string
  resourceName: string
  status: string
  adType: string
}

export type RsaDraftState = {
  campaignId: string
  adGroupId: string
  adGroupResourceName: string
  normalizedDraft: {
    headlines: string[]
    descriptions: string[]
    finalUrls: string[]
  }
  matches: Array<{
    headlines: string[]
    descriptions: string[]
    finalUrls: string[]
    status: string
  }>
}

function normalizedAssets(values: string[]) {
  return values.map((value) => value.trim().replace(/\s+/g, ' ')).filter(Boolean).sort()
}

function normalizeKeywordText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('und')
}

export function accountNegativeKeywordApprovalState(state: AccountNegativeKeywordState) {
  return {
    scope: state.scope,
    customerResourceName: state.customerResourceName,
    configured: Boolean(state.sharedSetResourceName && state.attached),
    campaignIds: state.campaignIds,
    normalizedText: state.normalizedText,
    matches: state.matches,
  }
}

function normalizedFinalUrls(values: string[]) {
  return values.map((value) => new URL(value).toString()).sort()
}

function safeHttpsUrl(value?: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export type DailyAccountMetric = {
  date: string
  impressions: string
  clicks: string
  costMicros: string
  conversions: number
  conversionValue: number
}

export type DailyCampaignMetric = DailyAccountMetric & {
  campaignId: string
  campaignName: string
  campaignType: string
  status: string
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

export type GoogleChangeEvent = {
  resourceName: string
  changedResourceName: string | null
  changedAt: Date
  changedBy: string | null
  clientType: string
  resourceType: string
  operation: string
  changedFields: string[]
  oldResource: Record<string, unknown> | null
  newResource: Record<string, unknown> | null
}

export type ConversionActionSnapshot = {
  resourceName: string
  name: string
  status: string
  category: string | null
  origin: string | null
  actionType: string | null
  primaryForGoal: boolean
  includeInConversionsMetric: boolean
  lastConversionAt: Date | null
  lastReceivedAt: Date | null
  lastActivityAt: Date | null
}

export type OfflineConversionDiagnostic = {
  uploadClient: string
  status: string
  lastUploadAt: Date | null
  totalEventCount: string
  successfulEventCount: string
  pendingEventCount: string
  successRate: number | null
  alerts: Array<Record<string, unknown>>
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

export function revokeGoogleOAuthToken(refreshToken: string) {
  if (!refreshToken) throw new Error('Google OAuth refresh token is required for revocation')
  return fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
}

function googleOAuthRefreshError(error: unknown) {
  const responseData = error && typeof error === 'object' && 'response' in error
    ? (error.response as { data?: unknown } | undefined)?.data
    : undefined
  const rawCode = responseData && typeof responseData === 'object' && 'error' in responseData
    ? responseData.error
    : undefined
  const code = typeof rawCode === 'string' && ['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(rawCode)
    ? rawCode
    : 'oauth_refresh_unavailable'
  return new GoogleAdsError(
    code === 'invalid_grant'
      ? 'Le jeton Google OAuth est révoqué ou expiré. Reconnectez le compte Google Ads.'
      : `Le renouvellement Google OAuth a échoué (${code}).`,
    code === 'oauth_refresh_unavailable' ? 503 : 401,
    null,
  )
}

export class GoogleAdsGateway {
  private readonly managerCustomerId: string
  private readonly oauthClient: OAuth2Client
  private readonly observedRequestIds: string[] = []

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

  async verifyOAuthAccess() {
    requireFeature('googleReads', 'Les lectures Google Ads sont temporairement désactivées.')
    try {
      await this.accessToken()
      return { valid: true as const }
    } catch (error) {
      throw googleOAuthRefreshError(error)
    }
  }

  collectedRequestIds() {
    return [...this.observedRequestIds]
  }

  private async request<T>(path: string, init: RequestInit = {}, retryable = false): Promise<ApiResult<T>> {
    requireFeature('googleReads', 'Les lectures Google Ads sont temporairement désactivées.')
    const env = getServerEnv()
    const delays = [250, 1_000, 4_000]
    for (let attempt = 0; ; attempt += 1) {
      let accessToken: string
      try {
        accessToken = await this.accessToken()
      } catch (error) {
        throw googleOAuthRefreshError(error)
      }
      let response: Response
      try {
        response = await fetch(`https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}${path}`, {
          ...init,
          cache: 'no-store',
          signal: init.signal ?? AbortSignal.timeout(25_000),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id': this.managerCustomerId,
            ...init.headers,
          },
        })
      } catch (error) {
        if (retryable && attempt < delays.length) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
          continue
        }
        throw new GoogleAdsError(
          error instanceof Error && error.name === 'TimeoutError'
            ? 'La requête Google Ads a expiré.'
            : 'Google Ads est momentanément injoignable.',
          0,
          null,
        )
      }
      const requestId = response.headers.get('request-id')
      if (requestId) this.observedRequestIds.push(requestId)
      const responseText = await response.text()
      let data: (T & GoogleAdsFailurePayload) | null = null
      try {
        const parsed = JSON.parse(responseText) as unknown
        if (parsed !== null && typeof parsed === 'object') data = parsed as T & GoogleAdsFailurePayload
      } catch {
        // Google and intermediary gateways may return an empty or HTML body.
        // Never leak that body to users or logs because it can contain proxy details.
      }

      if (retryable && (response.status === 429 || response.status >= 500) && attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
        continue
      }
      if (response.ok) {
        if (data) return { data, requestId }
        if (retryable && attempt < delays.length) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
          continue
        }
        throw new GoogleAdsError('Google Ads a renvoyé une réponse invalide ou incomplète.', 502, requestId)
      }
      if (!data) {
        throw new GoogleAdsError(`Google Ads a répondu avec le statut ${response.status}.`, response.status, requestId)
      }
      const failure = parseGoogleAdsFailure(data)
      throw new GoogleAdsError(
        failure.message || `Google Ads a répondu avec le statut ${response.status}`,
        response.status,
        requestId ?? failure.requestId,
      )
    }
  }

  private async search<T>(customerId: string, query: string): Promise<T[]> {
    const normalized = normalizeCustomerId(customerId)
    const { data } = await this.request<Array<{ results?: T[] }>>(
      `/customers/${normalized}/googleAds:searchStream`,
      { method: 'POST', body: JSON.stringify({ query }) },
      true,
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
    type InventoryRow = {
      campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string; campaignBudget?: string }
      campaignBudget?: { amountMicros?: string }
    }
    type MetricRow = {
      campaign?: { id?: string }
      metrics?: {
        impressions?: string
        clicks?: string
        costMicros?: string
        conversions?: number
        conversionsValue?: number
        searchBudgetLostImpressionShare?: number
        searchRankLostImpressionShare?: number
      }
    }
    const [inventory, metricRows] = await Promise.all([
      this.search<InventoryRow>(customerId, CAMPAIGN_INVENTORY_GAQL),
      this.search<MetricRow>(customerId, CAMPAIGN_METRICS_30D_GAQL),
    ])
    const metricsByCampaign = new Map(
      metricRows.flatMap(({ campaign, metrics }) => campaign?.id ? [[campaign.id, metrics] as const] : []),
    )
    return inventory
      .map(({ campaign, campaignBudget }) => {
        const metrics = campaign?.id ? metricsByCampaign.get(campaign.id) : undefined
        return {
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
          conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
          searchBudgetLostImpressionShare: metrics?.searchBudgetLostImpressionShare ?? null,
          searchRankLostImpressionShare: metrics?.searchRankLostImpressionShare ?? null,
        }
      })
      .sort((left, right) => Number(right.costMicros) - Number(left.costMicros))
  }

  async devicePerformance(customerId: string): Promise<BreakdownPerformance[]> {
    type Row = {
      segments?: { device?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, DEVICE_PERFORMANCE_GAQL)
    return rows.map(({ segments, metrics }) => ({
      key: segments?.device ?? 'UNKNOWN',
      label: segments?.device ?? 'Appareil inconnu',
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
    }))
  }

  async schedulePerformance(customerId: string): Promise<BreakdownPerformance[]> {
    type Row = {
      segments?: { dayOfWeek?: string; hour?: number }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, SCHEDULE_PERFORMANCE_GAQL)
    return rows.map(({ segments, metrics }) => {
      const day = segments?.dayOfWeek ?? 'UNKNOWN'
      const hour = segments?.hour ?? 0
      return {
        key: `${day}-${hour}`,
        label: `${day} · ${String(hour).padStart(2, '0')}:00`,
        impressions: metrics?.impressions ?? '0',
        clicks: metrics?.clicks ?? '0',
        costMicros: metrics?.costMicros ?? '0',
        conversions: metrics?.conversions ?? 0,
        conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
      }
    })
  }

  async geographicPerformance(customerId: string): Promise<GeographicPerformance[]> {
    type Row = {
      geographicView?: { countryCriterionId?: string; locationType?: string }
      campaign?: { id?: string; name?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, GEOGRAPHIC_PERFORMANCE_GAQL)
    return rows.map(({ geographicView, campaign, metrics }) => {
      const criterionId = geographicView?.countryCriterionId ?? 'UNKNOWN'
      return {
        key: `${campaign?.id ?? 'UNKNOWN'}:${criterionId}:${geographicView?.locationType ?? 'UNKNOWN'}`,
        label: `Pays Google ${criterionId}`,
        campaignId: campaign?.id ?? '',
        campaignName: campaign?.name ?? 'Campagne sans nom',
        criterionId,
        locationType: geographicView?.locationType ?? 'UNKNOWN',
        impressions: metrics?.impressions ?? '0',
        clicks: metrics?.clicks ?? '0',
        costMicros: metrics?.costMicros ?? '0',
        conversions: metrics?.conversions ?? 0,
        conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
      }
    })
  }

  async auctionInsights(customerId: string): Promise<AuctionInsight[]> {
    type Row = {
      segments?: { auctionInsightDomain?: string }
      campaign?: { id?: string; name?: string }
      metrics?: {
        auctionInsightSearchImpressionShare?: number
        auctionInsightSearchOverlapRate?: number
        auctionInsightSearchPositionAboveRate?: number
        auctionInsightSearchOutrankingShare?: number
        auctionInsightSearchTopImpressionPercentage?: number
        auctionInsightSearchAbsoluteTopImpressionPercentage?: number
      }
    }
    const rows = await this.search<Row>(customerId, AUCTION_INSIGHTS_GAQL)
    return rows.flatMap(({ segments, campaign, metrics }) => segments?.auctionInsightDomain ? [{
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      domain: segments.auctionInsightDomain,
      impressionShare: metrics?.auctionInsightSearchImpressionShare ?? null,
      overlapRate: metrics?.auctionInsightSearchOverlapRate ?? null,
      positionAboveRate: metrics?.auctionInsightSearchPositionAboveRate ?? null,
      outrankingShare: metrics?.auctionInsightSearchOutrankingShare ?? null,
      topImpressionPercentage: metrics?.auctionInsightSearchTopImpressionPercentage ?? null,
      absoluteTopImpressionPercentage: metrics?.auctionInsightSearchAbsoluteTopImpressionPercentage ?? null,
    }] : [])
  }

  async performanceMaxPlacements(customerId: string): Promise<PlacementInsight[]> {
    type Row = {
      campaign?: { id?: string; name?: string }
      performanceMaxPlacementView?: { displayName?: string; placement?: string; placementType?: string; targetUrl?: string }
      metrics?: { impressions?: string }
    }
    const rows = await this.search<Row>(customerId, PMAX_PLACEMENTS_GAQL)
    return rows.map(({ campaign, performanceMaxPlacementView: placement, metrics }) => ({
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      name: placement?.displayName ?? placement?.placement ?? 'Placement indisponible',
      placement: placement?.placement ?? '',
      type: placement?.placementType ?? 'UNKNOWN',
      targetUrl: placement?.targetUrl ?? null,
      impressions: metrics?.impressions ?? '0',
    }))
  }

  async assetGroupPerformance(customerId: string): Promise<AssetGroupPerformance[]> {
    type Row = {
      campaign?: { id?: string; name?: string }
      assetGroup?: { id?: string; name?: string; status?: string; adStrength?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, ASSET_GROUP_PERFORMANCE_GAQL)
    return rows.map(({ campaign, assetGroup, metrics }) => ({
      key: `${campaign?.id ?? ''}:${assetGroup?.id ?? ''}`,
      label: assetGroup?.name ?? 'Asset group sans nom',
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      assetGroupId: assetGroup?.id ?? '',
      status: assetGroup?.status ?? 'UNKNOWN',
      adStrength: assetGroup?.adStrength ?? 'UNKNOWN',
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
    }))
  }

  async assetPerformance(customerId: string, referenceDate = new Date().toISOString().slice(0, 10)): Promise<AssetPerformance[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error('Invalid asset performance reference date')
    type Row = {
      campaign?: { id?: string; name?: string }
      assetGroup?: { id?: string; name?: string }
      assetGroupAsset?: { asset?: string; fieldType?: string; status?: string; primaryStatus?: string; performanceLabel?: string }
      segments?: { date?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, ASSET_PERFORMANCE_GAQL)
    const end = new Date(`${referenceDate}T00:00:00Z`)
    const currentFrom = new Date(end.getTime() - 14 * 24 * 60 * 60_000).toISOString().slice(0, 10)
    const previousFrom = new Date(end.getTime() - 29 * 24 * 60 * 60_000).toISOString().slice(0, 10)
    type Aggregate = Omit<AssetPerformance, 'impressions' | 'clicks' | 'costMicros' | 'conversions' | 'conversionValueMicros' | 'fatigue'> & {
      impressionsNumber: number
      clicksNumber: number
      costMicrosNumber: number
      conversionsNumber: number
      conversionValueNumber: number
    }
    const aggregates = new Map<string, Aggregate>()
    const empty = (): CreativePeriodMetrics => ({ impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 })
    for (const row of rows) {
      const assetResourceName = row.assetGroupAsset?.asset ?? ''
      const assetGroupId = row.assetGroup?.id ?? ''
      const fieldType = row.assetGroupAsset?.fieldType ?? 'UNKNOWN'
      const key = `${row.campaign?.id ?? ''}:${assetGroupId}:${assetResourceName}:${fieldType}`
      const aggregate = aggregates.get(key) ?? {
        key,
        label: `${fieldType} · ${assetResourceName.split('/').at(-1) ?? 'asset inconnu'}`,
        campaignId: row.campaign?.id ?? '',
        campaignName: row.campaign?.name ?? 'Campagne sans nom',
        assetGroupId,
        assetGroupName: row.assetGroup?.name ?? 'Asset group sans nom',
        assetResourceName,
        fieldType,
        status: row.assetGroupAsset?.status ?? 'UNKNOWN',
        primaryStatus: row.assetGroupAsset?.primaryStatus ?? 'UNKNOWN',
        performanceLabel: row.assetGroupAsset?.performanceLabel ?? 'UNKNOWN',
        current: empty(),
        previous: empty(),
        impressionsNumber: 0,
        clicksNumber: 0,
        costMicrosNumber: 0,
        conversionsNumber: 0,
        conversionValueNumber: 0,
      }
      const impressions = Number(row.metrics?.impressions ?? 0)
      const clicks = Number(row.metrics?.clicks ?? 0)
      const conversions = row.metrics?.conversions ?? 0
      const conversionValue = row.metrics?.conversionsValue ?? 0
      aggregate.impressionsNumber += impressions
      aggregate.clicksNumber += clicks
      aggregate.costMicrosNumber += Number(row.metrics?.costMicros ?? 0)
      aggregate.conversionsNumber += conversions
      aggregate.conversionValueNumber += conversionValue
      const date = row.segments?.date
      const period = date && date >= currentFrom && date <= referenceDate ? aggregate.current : date && date >= previousFrom && date < currentFrom ? aggregate.previous : null
      if (period) {
        period.impressions += impressions
        period.clicks += clicks
        period.conversions += conversions
        period.conversionValue += conversionValue
      }
      aggregates.set(key, aggregate)
    }
    return [...aggregates.values()].map((aggregate) => ({
      key: aggregate.key,
      label: aggregate.label,
      campaignId: aggregate.campaignId,
      campaignName: aggregate.campaignName,
      assetGroupId: aggregate.assetGroupId,
      assetGroupName: aggregate.assetGroupName,
      assetResourceName: aggregate.assetResourceName,
      fieldType: aggregate.fieldType,
      status: aggregate.status,
      primaryStatus: aggregate.primaryStatus,
      performanceLabel: aggregate.performanceLabel,
      current: aggregate.current,
      previous: aggregate.previous,
      fatigue: creativeFatigueSignal({ current: aggregate.current, previous: aggregate.previous, performanceLabel: aggregate.performanceLabel }),
      impressions: String(aggregate.impressionsNumber),
      clicks: String(aggregate.clicksNumber),
      costMicros: String(Math.round(aggregate.costMicrosNumber)),
      conversions: aggregate.conversionsNumber,
      conversionValueMicros: String(Math.round(aggregate.conversionValueNumber * 1_000_000)),
    })).sort((left, right) => Number(right.impressions) - Number(left.impressions))
  }

  async shoppingProductPerformance(customerId: string): Promise<ShoppingProductPerformance[]> {
    type Row = {
      campaign?: { id?: string; name?: string }
      segments?: {
        productItemId?: string; productTitle?: string; productBrand?: string; productMerchantId?: string
        productCountry?: string; productChannel?: string
      }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, SHOPPING_PRODUCT_PERFORMANCE_GAQL)
    return rows.map(({ campaign, segments, metrics }) => ({
      key: `${campaign?.id ?? ''}:${segments?.productMerchantId ?? ''}:${segments?.productItemId ?? ''}`,
      label: segments?.productTitle ?? segments?.productItemId ?? 'Produit sans titre',
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      itemId: segments?.productItemId ?? '',
      title: segments?.productTitle ?? 'Produit sans titre',
      brand: segments?.productBrand ?? '—',
      merchantId: segments?.productMerchantId ?? '',
      country: segments?.productCountry ?? '—',
      channel: segments?.productChannel ?? 'UNKNOWN',
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
    }))
  }

  async shoppingProductDiagnostics(customerId: string): Promise<ShoppingProductDiagnostic[]> {
    type Row = {
      shoppingProduct?: {
        resourceName?: string
        merchantCenterId?: string
        channel?: string
        languageCode?: string
        feedLabel?: string
        itemId?: string
        title?: string
        status?: string
        issues?: Array<{
          errorCode?: string
          adsSeverity?: string
          description?: string
          detail?: string
          documentation?: string
          affectedRegions?: string[]
          attributeName?: string
        }>
      }
    }
    const rows = await this.search<Row>(customerId, SHOPPING_PRODUCT_STATUS_GAQL)
    return rows.flatMap(({ shoppingProduct: product }) => product?.resourceName ? [{
      resourceName: product.resourceName,
      merchantId: product.merchantCenterId ?? '',
      channel: product.channel ?? 'UNKNOWN',
      languageCode: product.languageCode ?? '—',
      feedLabel: product.feedLabel ?? '—',
      itemId: product.itemId ?? '',
      title: product.title ?? product.itemId ?? 'Produit sans titre',
      status: product.status ?? 'UNKNOWN',
      issues: (product.issues ?? []).map((issue) => ({
        errorCode: issue.errorCode ?? 'UNKNOWN',
        severity: issue.adsSeverity ?? 'UNKNOWN',
        description: issue.description ?? 'Problème produit non détaillé',
        detail: issue.detail ?? '',
        documentation: safeHttpsUrl(issue.documentation),
        affectedRegions: issue.affectedRegions ?? [],
        attributeName: issue.attributeName ?? null,
      })),
    }] : [])
  }

  async campaignAudiencePerformance(customerId: string): Promise<CampaignAudiencePerformance[]> {
    type Row = {
      campaign?: { id?: string; name?: string }
      campaignCriterion?: { criterionId?: string; bidModifier?: number }
      userList?: { name?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, CAMPAIGN_AUDIENCE_PERFORMANCE_GAQL)
    return rows.map(({ campaign, campaignCriterion, userList, metrics }) => ({
      key: `${campaign?.id ?? ''}:${campaignCriterion?.criterionId ?? ''}`,
      label: userList?.name ?? `Audience ${campaignCriterion?.criterionId ?? 'inconnue'}`,
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      criterionId: campaignCriterion?.criterionId ?? '',
      bidModifier: campaignCriterion?.bidModifier ?? null,
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
    }))
  }

  async adGroupAudiencePerformance(customerId: string): Promise<AdGroupAudiencePerformance[]> {
    type Row = {
      campaign?: { id?: string; name?: string }
      adGroup?: { id?: string; name?: string }
      adGroupCriterion?: { criterionId?: string; bidModifier?: number }
      userList?: { name?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, AD_GROUP_AUDIENCE_PERFORMANCE_GAQL)
    return rows.map(({ campaign, adGroup, adGroupCriterion, userList, metrics }) => ({
      key: `${adGroup?.id ?? ''}:${adGroupCriterion?.criterionId ?? ''}`,
      label: `${userList?.name ?? `Audience ${adGroupCriterion?.criterionId ?? 'inconnue'}`} · ${adGroup?.name ?? 'Groupe sans nom'}`,
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      adGroupId: adGroup?.id ?? '',
      adGroupName: adGroup?.name ?? 'Groupe sans nom',
      criterionId: adGroupCriterion?.criterionId ?? '',
      bidModifier: adGroupCriterion?.bidModifier ?? null,
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValueMicros: String(Math.round((metrics?.conversionsValue ?? 0) * 1_000_000)),
    }))
  }

  async groupPlacementPerformance(customerId: string): Promise<GroupPlacementPerformance[]> {
    type Row = {
      campaign?: { id?: string; name?: string }
      adGroup?: { id?: string; name?: string }
      groupPlacementView?: { displayName?: string; placement?: string; placementType?: string; targetUrl?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; viewThroughConversions?: number }
    }
    const rows = await this.search<Row>(customerId, GROUP_PLACEMENT_PERFORMANCE_GAQL)
    return rows.map(({ campaign, adGroup, groupPlacementView: placement, metrics }) => ({
      key: `${adGroup?.id ?? ''}:${placement?.placementType ?? ''}:${placement?.placement ?? ''}`,
      label: placement?.displayName ?? placement?.placement ?? 'Placement indisponible',
      campaignId: campaign?.id ?? '',
      campaignName: campaign?.name ?? 'Campagne sans nom',
      adGroupId: adGroup?.id ?? '',
      adGroupName: adGroup?.name ?? 'Groupe sans nom',
      placement: placement?.placement ?? '',
      placementType: placement?.placementType ?? 'UNKNOWN',
      targetUrl: safeHttpsUrl(placement?.targetUrl),
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValueMicros: '0',
      viewThroughConversions: metrics?.viewThroughConversions ?? 0,
    }))
  }

  async campaignMutationState(customerId: string, campaignId: string): Promise<CampaignMutationState> {
    type Row = {
      campaign?: { id?: string; name?: string; resourceName?: string; status?: string; campaignBudget?: string }
      campaignBudget?: { resourceName?: string; amountMicros?: string; explicitlyShared?: boolean; referenceCount?: string }
    }
    const numericCampaignId = BigInt(campaignId).toString()
    const [row] = await this.search<Row>(
      customerId,
      `SELECT campaign.id,
              campaign.name,
              campaign.resource_name,
              campaign.status,
              campaign.campaign_budget,
              campaign_budget.resource_name,
              campaign_budget.amount_micros,
              campaign_budget.explicitly_shared,
              campaign_budget.reference_count
       FROM campaign
       WHERE campaign.id = ${numericCampaignId}
       LIMIT 1`,
    )
    if (!row?.campaign?.id || !row.campaign.resourceName) throw new Error('Campagne Google Ads introuvable.')
    return {
      campaignId: row.campaign.id,
      campaignName: row.campaign.name ?? `Campagne ${row.campaign.id}`,
      campaignResourceName: row.campaign.resourceName,
      status: row.campaign.status ?? 'UNKNOWN',
      budgetResourceName: row.campaignBudget?.resourceName ?? row.campaign.campaignBudget ?? '',
      budgetMicros: row.campaignBudget?.amountMicros ?? '0',
      budgetExplicitlyShared: row.campaignBudget?.explicitlyShared ?? false,
      budgetReferenceCount: row.campaignBudget?.referenceCount ?? '0',
    }
  }

  async keywordTextState(customerId: string, adGroupId: string, text: string): Promise<KeywordTextState> {
    type Row = {
      campaign?: { id?: string }
      adGroup?: { id?: string; resourceName?: string }
      adGroupCriterion?: {
        status?: string
        negative?: boolean
        keyword?: { text?: string; matchType?: string }
      }
    }
    const normalizedAdGroupId = BigInt(adGroupId).toString()
    const normalizedText = normalizeKeywordText(text)
    const [adGroupRows, rows] = await Promise.all([
      this.search<Row>(customerId, `SELECT campaign.id,
              ad_group.id,
              ad_group.resource_name
       FROM ad_group
       WHERE ad_group.id = ${normalizedAdGroupId}
         AND ad_group.status != 'REMOVED'
       LIMIT 1`),
      this.search<Row>(customerId, `SELECT campaign.id,
              ad_group.id,
              ad_group.resource_name,
              ad_group_criterion.status,
              ad_group_criterion.negative,
              ad_group_criterion.keyword.text,
              ad_group_criterion.keyword.match_type
       FROM ad_group_criterion
       WHERE ad_group.id = ${normalizedAdGroupId}
         AND ad_group_criterion.type = 'KEYWORD'
         AND ad_group_criterion.status != 'REMOVED'
       LIMIT 10000`),
    ])
    const first = adGroupRows[0]
    if (!first?.adGroup?.resourceName) throw new Error('Groupe d’annonces Google Ads introuvable dans ce compte.')
    return {
      campaignId: first?.campaign?.id ?? '',
      adGroupId: first?.adGroup?.id ?? normalizedAdGroupId,
      adGroupResourceName: first?.adGroup?.resourceName ?? `customers/${normalizeCustomerId(customerId)}/adGroups/${normalizedAdGroupId}`,
      normalizedText,
      matches: rows.flatMap(({ adGroupCriterion }) => {
        const keywordText = adGroupCriterion?.keyword?.text
        if (!keywordText || normalizeKeywordText(keywordText) !== normalizedText) return []
        return [{
          text: normalizedText,
          matchType: adGroupCriterion?.keyword?.matchType ?? 'UNSPECIFIED',
          negative: Boolean(adGroupCriterion?.negative),
          status: adGroupCriterion?.status ?? 'UNKNOWN',
        }]
      }).sort((left, right) => `${left.negative}:${left.matchType}`.localeCompare(`${right.negative}:${right.matchType}`)),
    }
  }

  async campaignNegativeKeywordState(
    customerId: string,
    campaignId: string,
    text: string,
  ): Promise<CampaignNegativeKeywordState> {
    type Row = {
      campaign?: { id?: string; resourceName?: string }
      campaignCriterion?: {
        status?: string
        negative?: boolean
        keyword?: { text?: string; matchType?: string }
      }
    }
    const normalizedCampaignId = BigInt(campaignId).toString()
    const normalizedText = normalizeKeywordText(text)
    const [campaignRows, criterionRows] = await Promise.all([
      this.search<Row>(customerId, campaignNegativeKeywordInventoryGaql(normalizedCampaignId)),
      this.search<Row>(customerId, campaignNegativeKeywordCriteriaGaql(normalizedCampaignId)),
    ])
    const campaign = campaignRows[0]?.campaign
    if (!campaign?.resourceName) throw new Error('Campagne Google Ads introuvable dans ce compte.')
    return {
      scope: 'campaign',
      campaignId: campaign.id ?? normalizedCampaignId,
      campaignResourceName: campaign.resourceName,
      normalizedText,
      matches: criterionRows.flatMap(({ campaignCriterion }) => {
        const keywordText = campaignCriterion?.keyword?.text
        if (!keywordText || normalizeKeywordText(keywordText) !== normalizedText) return []
        return [{
          text: normalizedText,
          matchType: campaignCriterion.keyword?.matchType ?? 'UNSPECIFIED',
          negative: Boolean(campaignCriterion.negative),
          status: campaignCriterion.status ?? 'UNKNOWN',
        }]
      }).sort((left, right) => `${left.negative}:${left.matchType}`.localeCompare(`${right.negative}:${right.matchType}`)),
    }
  }

  async accountNegativeKeywordState(customerId: string, text: string): Promise<AccountNegativeKeywordState> {
    type CampaignRow = { campaign?: { id?: string } }
    type SharedSetRow = { sharedSet?: { resourceName?: string; status?: string; type?: string } }
    type AttachmentRow = {
      customerNegativeCriterion?: { resourceName?: string; negativeKeywordList?: { sharedSet?: string } }
    }
    type CriterionRow = {
      sharedCriterion?: {
        keyword?: { text?: string; matchType?: string }
      }
      sharedSet?: { resourceName?: string }
    }
    const normalized = normalizeCustomerId(customerId)
    const normalizedText = normalizeKeywordText(text)
    const [campaignRows, sharedSetRows, attachmentRows] = await Promise.all([
      this.search<CampaignRow>(normalized, ACCOUNT_NEGATIVE_KEYWORD_CAMPAIGNS_GAQL),
      this.search<SharedSetRow>(normalized, ACCOUNT_NEGATIVE_KEYWORD_SHARED_SET_GAQL),
      this.search<AttachmentRow>(normalized, ACCOUNT_NEGATIVE_KEYWORD_ATTACHMENT_GAQL),
    ])
    if (sharedSetRows.length > 1 || attachmentRows.length > 1) {
      throw new Error('La configuration des exclusions compte est ambiguë et doit être corrigée dans Google Ads.')
    }
    const campaignIds = campaignRows.flatMap(({ campaign }) => campaign?.id ? [campaign.id] : [])
      .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0)
    if (campaignIds.length === 0) throw new Error('Aucune campagne observable n’est disponible pour cette exclusion compte.')
    if (campaignIds.length > 500) throw new Error('La portée compte dépasse la limite de sécurité de 500 campagnes observables.')
    const localSharedSet = sharedSetRows[0]?.sharedSet?.resourceName ?? null
    const attachedSharedSet = attachmentRows[0]?.customerNegativeCriterion?.negativeKeywordList?.sharedSet ?? null
    if (attachedSharedSet && !attachedSharedSet.startsWith(`customers/${normalized}/sharedSets/`)) {
      throw new Error('La liste négative du compte appartient à un autre compte et ne peut pas être modifiée en sécurité.')
    }
    if (localSharedSet && attachedSharedSet && localSharedSet !== attachedSharedSet) {
      throw new Error('La liste négative locale ne correspond pas à celle attachée au compte.')
    }
    const sharedSetResourceName = attachedSharedSet ?? localSharedSet
    const criterionRows = sharedSetResourceName
      ? await this.search<CriterionRow>(normalized, ACCOUNT_NEGATIVE_KEYWORD_CRITERIA_GAQL)
      : []
    return {
      scope: 'account',
      customerResourceName: `customers/${normalized}`,
      sharedSetResourceName,
      attached: Boolean(attachedSharedSet),
      campaignIds,
      normalizedText,
      matches: criterionRows.flatMap(({ sharedCriterion, sharedSet }) => {
        const keywordText = sharedCriterion?.keyword?.text
        if (sharedSet?.resourceName !== sharedSetResourceName || !keywordText || normalizeKeywordText(keywordText) !== normalizedText) return []
        return [{
          text: normalizedText,
          matchType: sharedCriterion.keyword?.matchType ?? 'UNSPECIFIED',
          negative: true,
          status: 'ENABLED',
        }]
      }).sort((left, right) => left.matchType.localeCompare(right.matchType)),
    }
  }

  async keywordCriterionState(customerId: string, adGroupId: string, criterionId: string): Promise<KeywordCriterionState> {
    type Row = {
      campaign?: { id?: string }
      adGroup?: { id?: string }
      adGroupCriterion?: {
        criterionId?: string
        resourceName?: string
        status?: string
        negative?: boolean
        keyword?: { text?: string; matchType?: string }
      }
    }
    const normalizedAdGroupId = BigInt(adGroupId).toString()
    const normalizedCriterionId = BigInt(criterionId).toString()
    const [row] = await this.search<Row>(
      customerId,
      `SELECT campaign.id,
              ad_group.id,
              ad_group_criterion.criterion_id,
              ad_group_criterion.resource_name,
              ad_group_criterion.status,
              ad_group_criterion.negative,
              ad_group_criterion.keyword.text,
              ad_group_criterion.keyword.match_type
       FROM ad_group_criterion
       WHERE ad_group.id = ${normalizedAdGroupId}
         AND ad_group_criterion.criterion_id = ${normalizedCriterionId}
         AND ad_group_criterion.type = 'KEYWORD'
         AND ad_group_criterion.status != 'REMOVED'
       LIMIT 1`,
    )
    const criterion = row?.adGroupCriterion
    if (!criterion?.resourceName || !criterion.keyword?.text) throw new Error('Mot-clé Google Ads introuvable dans ce groupe d’annonces.')
    return {
      campaignId: row.campaign?.id ?? '',
      adGroupId: row.adGroup?.id ?? normalizedAdGroupId,
      criterionId: criterion.criterionId ?? normalizedCriterionId,
      resourceName: criterion.resourceName,
      text: criterion.keyword.text,
      matchType: criterion.keyword.matchType ?? 'UNSPECIFIED',
      negative: Boolean(criterion.negative),
      status: criterion.status ?? 'UNKNOWN',
    }
  }

  async adGroupAdMutationState(customerId: string, adGroupId: string, adId: string): Promise<AdGroupAdMutationState> {
    type Row = {
      campaign?: { id?: string }
      adGroup?: { id?: string }
      adGroupAd?: { resourceName?: string; status?: string; ad?: { id?: string; type?: string } }
    }
    const normalizedAdGroupId = BigInt(adGroupId).toString()
    const normalizedAdId = BigInt(adId).toString()
    const [row] = await this.search<Row>(
      customerId,
      `SELECT campaign.id,
              ad_group.id,
              ad_group_ad.resource_name,
              ad_group_ad.status,
              ad_group_ad.ad.id,
              ad_group_ad.ad.type
       FROM ad_group_ad
       WHERE ad_group.id = ${normalizedAdGroupId}
         AND ad_group_ad.ad.id = ${normalizedAdId}
         AND ad_group_ad.status != 'REMOVED'
       LIMIT 1`,
    )
    if (!row?.adGroupAd?.resourceName) throw new Error('Annonce Google Ads introuvable dans ce groupe d’annonces.')
    return {
      campaignId: row.campaign?.id ?? '',
      adGroupId: row.adGroup?.id ?? normalizedAdGroupId,
      adId: row.adGroupAd.ad?.id ?? normalizedAdId,
      resourceName: row.adGroupAd.resourceName,
      status: row.adGroupAd.status ?? 'UNKNOWN',
      adType: row.adGroupAd.ad?.type ?? 'UNKNOWN',
    }
  }

  async rsaDraftState(
    customerId: string,
    adGroupId: string,
    draft: { headlines: string[]; descriptions: string[]; finalUrls: string[] },
  ): Promise<RsaDraftState> {
    type Row = {
      campaign?: { id?: string }
      adGroup?: { id?: string; resourceName?: string }
      adGroupAd?: {
        status?: string
        ad?: {
          finalUrls?: string[]
          responsiveSearchAd?: {
            headlines?: Array<{ text?: string }>
            descriptions?: Array<{ text?: string }>
          }
        }
      }
    }
    const normalizedAdGroupId = BigInt(adGroupId).toString()
    const normalizedDraft = {
      headlines: normalizedAssets(draft.headlines),
      descriptions: normalizedAssets(draft.descriptions),
      finalUrls: normalizedFinalUrls(draft.finalUrls),
    }
    const [adGroupRows, adRows] = await Promise.all([
      this.search<Row>(customerId, `SELECT campaign.id, ad_group.id, ad_group.resource_name
       FROM ad_group
       WHERE ad_group.id = ${normalizedAdGroupId}
         AND ad_group.status != 'REMOVED'
       LIMIT 1`),
      this.search<Row>(customerId, `SELECT campaign.id,
              ad_group.id,
              ad_group.resource_name,
              ad_group_ad.status,
              ad_group_ad.ad.final_urls,
              ad_group_ad.ad.responsive_search_ad.headlines,
              ad_group_ad.ad.responsive_search_ad.descriptions
       FROM ad_group_ad
       WHERE ad_group.id = ${normalizedAdGroupId}
         AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
         AND ad_group_ad.status != 'REMOVED'
       LIMIT 10000`),
    ])
    const first = adGroupRows[0]
    if (!first?.adGroup?.resourceName) throw new Error('Groupe d’annonces Google Ads introuvable dans ce compte.')
    const matches = adRows.flatMap(({ adGroupAd }) => {
      const candidate = {
        headlines: normalizedAssets((adGroupAd?.ad?.responsiveSearchAd?.headlines ?? []).flatMap((asset) => asset.text ? [asset.text] : [])),
        descriptions: normalizedAssets((adGroupAd?.ad?.responsiveSearchAd?.descriptions ?? []).flatMap((asset) => asset.text ? [asset.text] : [])),
        finalUrls: normalizedFinalUrls(adGroupAd?.ad?.finalUrls ?? []),
        status: adGroupAd?.status ?? 'UNKNOWN',
      }
      const same = JSON.stringify({ ...candidate, status: undefined }) === JSON.stringify({ ...normalizedDraft, status: undefined })
      return same ? [candidate] : []
    })
    return {
      campaignId: first.campaign?.id ?? '',
      adGroupId: first.adGroup.id ?? normalizedAdGroupId,
      adGroupResourceName: first.adGroup.resourceName,
      normalizedDraft,
      matches,
    }
  }

  async dailyAccountMetrics(customerId: string, from: string, through: string): Promise<DailyAccountMetric[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || from > through) {
      throw new Error('Invalid Google Ads metric date range')
    }
    type Row = {
      segments?: { date?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, `SELECT segments.date,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM customer
       WHERE segments.date BETWEEN '${from}' AND '${through}'
       ORDER BY segments.date`)
    return rows.flatMap(({ segments, metrics }) => segments?.date ? [{
      date: segments.date,
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValue: metrics?.conversionsValue ?? 0,
    }] : [])
  }

  async dailyCampaignMetrics(customerId: string, from: string, through: string): Promise<DailyCampaignMetric[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || from > through) {
      throw new Error('Invalid Google Ads metric date range')
    }
    type Row = {
      campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string }
      segments?: { date?: string }
      metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number }
    }
    const rows = await this.search<Row>(customerId, `SELECT campaign.id,
              campaign.name,
              campaign.status,
              campaign.advertising_channel_type,
              segments.date,
              metrics.impressions,
              metrics.clicks,
              metrics.cost_micros,
              metrics.conversions,
              metrics.conversions_value
       FROM campaign
       WHERE campaign.status != 'REMOVED'
         AND segments.date BETWEEN '${from}' AND '${through}'
       ORDER BY segments.date, campaign.id`)
    return rows.flatMap(({ campaign, segments, metrics }) => campaign?.id && segments?.date ? [{
      campaignId: campaign.id,
      campaignName: campaign.name ?? 'Campagne sans nom',
      campaignType: campaign.advertisingChannelType ?? 'UNKNOWN',
      status: campaign.status ?? 'UNKNOWN',
      date: segments.date,
      impressions: metrics?.impressions ?? '0',
      clicks: metrics?.clicks ?? '0',
      costMicros: metrics?.costMicros ?? '0',
      conversions: metrics?.conversions ?? 0,
      conversionValue: metrics?.conversionsValue ?? 0,
    }] : [])
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

  async changeEvents(customerId: string, from: Date, through = new Date()): Promise<GoogleChangeEvent[]> {
    type Row = {
      changeEvent?: {
        resourceName?: string
        changeDateTime?: string
        changeResourceName?: string
        userEmail?: string
        clientType?: string
        changeResourceType?: string
        oldResource?: Record<string, unknown>
        newResource?: Record<string, unknown>
        resourceChangeOperation?: string
        changedFields?: string | { paths?: string[] }
      }
    }
    const rows = await this.search<Row>(customerId, changeEventsGaql(from, through))
    return rows.flatMap(({ changeEvent }) => {
      if (!changeEvent?.resourceName || !changeEvent.changeDateTime) return []
      const changedAt = new Date(changeEvent.changeDateTime.replace(' ', 'T'))
      if (Number.isNaN(changedAt.getTime())) return []
      const changedFields = typeof changeEvent.changedFields === 'string'
        ? changeEvent.changedFields.split(',').map((field) => field.trim()).filter(Boolean)
        : changeEvent.changedFields?.paths ?? []
      return [{
        resourceName: changeEvent.resourceName,
        changedResourceName: changeEvent.changeResourceName ?? null,
        changedAt,
        changedBy: changeEvent.userEmail ?? null,
        clientType: changeEvent.clientType ?? 'UNSPECIFIED',
        resourceType: changeEvent.changeResourceType ?? 'UNSPECIFIED',
        operation: changeEvent.resourceChangeOperation ?? 'UNSPECIFIED',
        changedFields,
        oldResource: changeEvent.oldResource ?? null,
        newResource: changeEvent.newResource ?? null,
      }]
    })
  }

  async conversionActions(customerId: string): Promise<ConversionActionSnapshot[]> {
    type Row = {
      conversionAction?: {
        resourceName?: string
        name?: string
        status?: string
        category?: string
        origin?: string
        type?: string
        primaryForGoal?: boolean
        includeInConversionsMetric?: boolean
      }
      metrics?: {
        conversionLastConversionDate?: string
        conversionLastReceivedRequestDateTime?: string
      }
    }
    const parseDate = (value?: string) => {
      if (!value) return null
      const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value.replace(' ', 'T'))
      return Number.isNaN(date.getTime()) ? null : date
    }
    const rows = await this.search<Row>(customerId, CONVERSION_ACTIONS_GAQL)
    return rows.flatMap(({ conversionAction, metrics }) => {
      if (!conversionAction?.resourceName) return []
      const lastConversionAt = parseDate(metrics?.conversionLastConversionDate)
      const lastReceivedAt = parseDate(metrics?.conversionLastReceivedRequestDateTime)
      const activities = [lastConversionAt, lastReceivedAt].filter((date): date is Date => Boolean(date))
      return [{
        resourceName: conversionAction.resourceName,
        name: conversionAction.name ?? 'Action de conversion sans nom',
        status: conversionAction.status ?? 'UNSPECIFIED',
        category: conversionAction.category ?? null,
        origin: conversionAction.origin ?? null,
        actionType: conversionAction.type ?? null,
        primaryForGoal: conversionAction.primaryForGoal ?? false,
        includeInConversionsMetric: conversionAction.includeInConversionsMetric ?? false,
        lastConversionAt,
        lastReceivedAt,
        lastActivityAt: activities.sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      }]
    })
  }

  async offlineConversionDiagnostics(customerId: string): Promise<OfflineConversionDiagnostic[]> {
    type Row = {
      offlineConversionUploadClientSummary?: {
        client?: string
        status?: string
        lastUploadDateTime?: string
        totalEventCount?: string
        successfulEventCount?: string
        pendingEventCount?: string
        successRate?: number
        alerts?: Array<Record<string, unknown>>
      }
    }
    const rows = await this.search<Row>(customerId, OFFLINE_CONVERSION_DIAGNOSTICS_GAQL)
    return rows.flatMap(({ offlineConversionUploadClientSummary: summary }) => {
      if (!summary?.client) return []
      const lastUploadAt = summary.lastUploadDateTime
        ? new Date(summary.lastUploadDateTime.replace(' ', 'T'))
        : null
      return [{
        uploadClient: summary.client,
        status: summary.status ?? 'UNSPECIFIED',
        lastUploadAt: lastUploadAt && !Number.isNaN(lastUploadAt.getTime()) ? lastUploadAt : null,
        totalEventCount: summary.totalEventCount ?? '0',
        successfulEventCount: summary.successfulEventCount ?? '0',
        pendingEventCount: summary.pendingEventCount ?? '0',
        successRate: summary.successRate ?? null,
        alerts: summary.alerts ?? [],
      }]
    })
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

  async mutateBudgetBatch(customerId: string, changes: CampaignBudgetBatchChange[], validateOnly = false) {
    const normalized = normalizeCustomerId(customerId)
    if (changes.length < 2 || changes.length > 50) throw new Error('Un batch budget doit contenir entre 2 et 50 changements.')
    const resourceNames = new Set<string>()
    for (const change of changes) {
      if (!change.budgetResourceName.startsWith(`customers/${normalized}/campaignBudgets/`)) {
        throw new Error('Une ressource budget du batch ne correspond pas au compte client.')
      }
      if (resourceNames.has(change.budgetResourceName)) throw new Error('Un budget ne peut apparaître qu’une fois dans un batch atomique.')
      if (BigInt(change.amountMicros) <= 0) throw new Error('Chaque budget du batch doit être strictement positif.')
      resourceNames.add(change.budgetResourceName)
    }
    return this.request<Record<string, unknown>>(`/customers/${normalized}/googleAds:mutate`, {
      method: 'POST',
      body: JSON.stringify({
        mutateOperations: changes.map((change) => ({
          campaignBudgetOperation: {
            update: { resourceName: change.budgetResourceName, amountMicros: change.amountMicros },
            updateMask: 'amount_micros',
          },
        })),
        partialFailure: false,
        validateOnly,
      }),
    })
  }

  async mutateAtomicBatch(customerId: string, operations: AtomicGoogleAdsOperation[], validateOnly = false) {
    const normalized = normalizeCustomerId(customerId)
    if (operations.length < 2 || operations.length > 20) throw new Error('Un batch atomique doit contenir entre 2 et 20 opérations.')
    const resources = new Set<string>()
    const mutateOperations = operations.map((operation) => {
      if (resources.has(operation.resourceName)) throw new Error('Une ressource ne peut apparaître qu’une fois dans un batch atomique.')
      resources.add(operation.resourceName)
      if (operation.kind === 'campaign_status') {
        if (!operation.resourceName.startsWith(`customers/${normalized}/campaigns/`)) throw new Error('Une campagne du batch ne correspond pas au compte client.')
        return { campaignOperation: { update: { resourceName: operation.resourceName, status: operation.status }, updateMask: 'status' } }
      }
      if (operation.kind === 'campaign_budget') {
        if (!operation.resourceName.startsWith(`customers/${normalized}/campaignBudgets/`)) throw new Error('Un budget du batch ne correspond pas au compte client.')
        if (BigInt(operation.amountMicros) <= 0) throw new Error('Chaque budget du batch doit être strictement positif.')
        return { campaignBudgetOperation: { update: { resourceName: operation.resourceName, amountMicros: operation.amountMicros }, updateMask: 'amount_micros' } }
      }
      if (operation.kind === 'keyword_status') {
        if (!operation.resourceName.startsWith(`customers/${normalized}/adGroupCriteria/`)) throw new Error('Un mot-clé du batch ne correspond pas au compte client.')
        return { adGroupCriterionOperation: { update: { resourceName: operation.resourceName, status: operation.status }, updateMask: 'status' } }
      }
      if (!operation.resourceName.startsWith(`customers/${normalized}/adGroupAds/`)) throw new Error('Une annonce du batch ne correspond pas au compte client.')
      return { adGroupAdOperation: { update: { resourceName: operation.resourceName, status: operation.status }, updateMask: 'status' } }
    })
    return this.request<Record<string, unknown>>(`/customers/${normalized}/googleAds:mutate`, {
      method: 'POST',
      body: JSON.stringify({ mutateOperations, partialFailure: false, validateOnly }),
    })
  }

  async mutateKeywordCreate(
    customerId: string,
    adGroupId: string,
    text: string,
    matchType: KeywordMatchType,
    negative: boolean,
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    const normalizedAdGroupId = BigInt(adGroupId).toString()
    return this.request<Record<string, unknown>>(`/customers/${normalized}/adGroupCriteria:mutate`, {
      method: 'POST',
      body: JSON.stringify({
        operations: [{
          create: {
            adGroup: `customers/${normalized}/adGroups/${normalizedAdGroupId}`,
            status: 'ENABLED',
            negative,
            keyword: { text: text.trim().replace(/\s+/g, ' '), matchType },
          },
        }],
        partialFailure: false,
        validateOnly,
      }),
    })
  }

  async mutateCampaignNegativeKeyword(
    customerId: string,
    campaignId: string,
    text: string,
    matchType: KeywordMatchType,
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    const normalizedCampaignId = BigInt(campaignId).toString()
    return this.request<Record<string, unknown>>(`/customers/${normalized}/campaignCriteria:mutate`, {
      method: 'POST',
      body: JSON.stringify({
        operations: [{
          create: {
            campaign: `customers/${normalized}/campaigns/${normalizedCampaignId}`,
            status: 'ENABLED',
            negative: true,
            keyword: { text: text.trim().replace(/\s+/g, ' '), matchType },
          },
        }],
        partialFailure: false,
        validateOnly,
      }),
    })
  }

  async mutateAccountNegativeKeyword(
    customerId: string,
    state: AccountNegativeKeywordState,
    text: string,
    matchType: KeywordMatchType,
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    if (state.customerResourceName !== `customers/${normalized}`) {
      throw new Error('L’état des exclusions compte ne correspond pas au compte client.')
    }
    if (state.sharedSetResourceName && !state.sharedSetResourceName.startsWith(`customers/${normalized}/sharedSets/`)) {
      throw new Error('La liste négative ne correspond pas au compte client.')
    }
    const sharedSetResourceName = state.sharedSetResourceName ?? `customers/${normalized}/sharedSets/-1`
    const mutateOperations: Array<Record<string, unknown>> = []
    if (!state.sharedSetResourceName) {
      mutateOperations.push({
        sharedSetOperation: {
          create: {
            resourceName: sharedSetResourceName,
            name: 'Ads by Yodev – exclusions compte',
            type: 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS',
          },
        },
      })
    }
    mutateOperations.push({
      sharedCriterionOperation: {
        create: {
          sharedSet: sharedSetResourceName,
          keyword: { text: text.trim().replace(/\s+/g, ' '), matchType },
        },
      },
    })
    if (!state.attached) {
      mutateOperations.push({
        customerNegativeCriterionOperation: {
          create: { negativeKeywordList: { sharedSet: sharedSetResourceName } },
        },
      })
    }
    return this.request<Record<string, unknown>>(`/customers/${normalized}/googleAds:mutate`, {
      method: 'POST',
      body: JSON.stringify({ mutateOperations, partialFailure: false, validateOnly }),
    })
  }

  async mutateKeywordStatus(
    customerId: string,
    resourceName: string,
    status: 'ENABLED' | 'PAUSED',
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    if (!resourceName.startsWith(`customers/${normalized}/adGroupCriteria/`)) throw new Error('La ressource mot-clé ne correspond pas au compte client.')
    return this.request<Record<string, unknown>>(`/customers/${normalized}/adGroupCriteria:mutate`, {
      method: 'POST',
      body: JSON.stringify({ operations: [{ update: { resourceName, status }, updateMask: 'status' }], validateOnly }),
    })
  }

  async mutateAdGroupAdStatus(
    customerId: string,
    resourceName: string,
    status: 'ENABLED' | 'PAUSED',
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    if (!resourceName.startsWith(`customers/${normalized}/adGroupAds/`)) throw new Error('La ressource annonce ne correspond pas au compte client.')
    return this.request<Record<string, unknown>>(`/customers/${normalized}/adGroupAds:mutate`, {
      method: 'POST',
      body: JSON.stringify({ operations: [{ update: { resourceName, status }, updateMask: 'status' }], validateOnly }),
    })
  }


  async mutateRsaDraft(
    customerId: string,
    adGroupId: string,
    draft: { headlines: string[]; descriptions: string[]; finalUrl: string },
    validateOnly = false,
  ) {
    const normalized = normalizeCustomerId(customerId)
    const normalizedAdGroupId = BigInt(adGroupId).toString()
    return this.request<Record<string, unknown>>(`/customers/${normalized}/adGroupAds:mutate`, {
      method: 'POST',
      body: JSON.stringify({
        operations: [{
          create: {
            adGroup: `customers/${normalized}/adGroups/${normalizedAdGroupId}`,
            status: 'PAUSED',
            ad: {
              finalUrls: normalizedFinalUrls([draft.finalUrl]),
              responsiveSearchAd: {
                headlines: draft.headlines.map((text) => ({ text: text.trim().replace(/\s+/g, ' ') })),
                descriptions: draft.descriptions.map((text) => ({ text: text.trim().replace(/\s+/g, ' ') })),
              },
            },
          },
        }],
        partialFailure: false,
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
