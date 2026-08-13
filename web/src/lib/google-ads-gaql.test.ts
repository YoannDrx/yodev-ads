import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_NEGATIVE_KEYWORD_ATTACHMENT_GAQL,
  ACCOUNT_NEGATIVE_KEYWORD_CAMPAIGNS_GAQL,
  ACCOUNT_NEGATIVE_KEYWORD_CRITERIA_GAQL,
  ACCOUNT_NEGATIVE_KEYWORD_SHARED_SET_GAQL,
  ASSET_GROUP_PERFORMANCE_GAQL,
  ASSET_PERFORMANCE_GAQL,
  AD_GROUP_AUDIENCE_PERFORMANCE_GAQL,
  AUCTION_INSIGHTS_GAQL,
  CAMPAIGN_INVENTORY_GAQL,
  CAMPAIGN_AUDIENCE_PERFORMANCE_GAQL,
  CAMPAIGN_METRICS_30D_GAQL,
  DEVICE_PERFORMANCE_GAQL,
  GEOGRAPHIC_PERFORMANCE_GAQL,
  GROUP_PLACEMENT_PERFORMANCE_GAQL,
  OFFLINE_CONVERSION_DIAGNOSTICS_GAQL,
  PMAX_PLACEMENTS_GAQL,
  SCHEDULE_PERFORMANCE_GAQL,
  SHOPPING_PRODUCT_PERFORMANCE_GAQL,
  SHOPPING_PRODUCT_STATUS_GAQL,
  campaignNegativeKeywordCriteriaGaql,
  campaignNegativeKeywordInventoryGaql,
} from './google-ads'

describe('Google Ads campaign GAQL contracts', () => {
  it('keeps campaign inventory independent from metric availability', () => {
    expect(CAMPAIGN_INVENTORY_GAQL).toContain('FROM campaign')
    expect(CAMPAIGN_INVENTORY_GAQL).not.toContain('segments.date')
    expect(CAMPAIGN_INVENTORY_GAQL).not.toContain('metrics.')
  })

  it('limits campaign metrics to the intended reporting window', () => {
    expect(CAMPAIGN_METRICS_30D_GAQL).toContain('segments.date DURING LAST_30_DAYS')
    expect(CAMPAIGN_METRICS_30D_GAQL).toContain('metrics.impressions')
    expect(CAMPAIGN_METRICS_30D_GAQL).toContain('metrics.conversions_value')
    expect(CAMPAIGN_METRICS_30D_GAQL).toContain('metrics.search_budget_lost_impression_share')
    expect(CAMPAIGN_METRICS_30D_GAQL).toContain('metrics.search_rank_lost_impression_share')
  })

  it('uses the dedicated read-only offline upload summary resource', () => {
    expect(OFFLINE_CONVERSION_DIAGNOSTICS_GAQL).toContain('FROM offline_conversion_upload_client_summary')
    expect(OFFLINE_CONVERSION_DIAGNOSTICS_GAQL).toContain('offline_conversion_upload_client_summary.alerts')
    expect(OFFLINE_CONVERSION_DIAGNOSTICS_GAQL).not.toContain('uploadClickConversions')
  })

  it('keeps campaign and account negative-keyword reads scoped to typed v25 resources', () => {
    const inventory = campaignNegativeKeywordInventoryGaql('00123')
    const criteria = campaignNegativeKeywordCriteriaGaql('00123')
    expect(inventory).toContain('FROM campaign')
    expect(inventory).toContain('campaign.id = 123')
    expect(criteria).toContain('FROM campaign_criterion')
    expect(criteria).toContain("campaign_criterion.type = 'KEYWORD'")
    expect(criteria).not.toContain('red shoes')
    expect(ACCOUNT_NEGATIVE_KEYWORD_CAMPAIGNS_GAQL).toContain('LIMIT 501')
    expect(ACCOUNT_NEGATIVE_KEYWORD_SHARED_SET_GAQL).toContain("shared_set.type = 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS'")
    expect(ACCOUNT_NEGATIVE_KEYWORD_ATTACHMENT_GAQL).toContain('FROM customer_negative_criterion')
    expect(ACCOUNT_NEGATIVE_KEYWORD_ATTACHMENT_GAQL).toContain('negative_keyword_list.shared_set')
    expect(ACCOUNT_NEGATIVE_KEYWORD_CRITERIA_GAQL).toContain('FROM shared_criterion')
    expect(ACCOUNT_NEGATIVE_KEYWORD_CRITERIA_GAQL).toContain('shared_criterion.keyword.match_type')
    expect(ACCOUNT_NEGATIVE_KEYWORD_CRITERIA_GAQL).not.toContain('shared_criterion.negative')
  })

  it('uses resource-specific v25 reports instead of applying Search metrics to every campaign type', () => {
    expect(DEVICE_PERFORMANCE_GAQL).toContain('segments.device')
    expect(SCHEDULE_PERFORMANCE_GAQL).toContain('segments.day_of_week')
    expect(SCHEDULE_PERFORMANCE_GAQL).toContain('segments.hour')
    expect(GEOGRAPHIC_PERFORMANCE_GAQL).toContain('FROM geographic_view')
    expect(AUCTION_INSIGHTS_GAQL).toContain('segments.auction_insight_domain')
    expect(AUCTION_INSIGHTS_GAQL).toContain('metrics.auction_insight_search_overlap_rate')
    expect(PMAX_PLACEMENTS_GAQL).toContain('FROM performance_max_placement_view')
    expect(PMAX_PLACEMENTS_GAQL).not.toContain('metrics.cost_micros')
    expect(ASSET_GROUP_PERFORMANCE_GAQL).toContain('FROM asset_group')
    expect(ASSET_GROUP_PERFORMANCE_GAQL).toContain('asset_group.ad_strength')
    expect(ASSET_PERFORMANCE_GAQL).toContain('FROM asset_group_asset')
    expect(ASSET_PERFORMANCE_GAQL).toContain('asset_group_asset.performance_label')
    expect(ASSET_PERFORMANCE_GAQL).toContain('segments.date DURING LAST_30_DAYS')
    expect(ASSET_PERFORMANCE_GAQL).toContain('metrics.impressions')
    expect(SHOPPING_PRODUCT_PERFORMANCE_GAQL).toContain('FROM shopping_performance_view')
    expect(SHOPPING_PRODUCT_PERFORMANCE_GAQL).toContain('segments.product_item_id')
    expect(SHOPPING_PRODUCT_STATUS_GAQL).toContain('FROM shopping_product')
    expect(SHOPPING_PRODUCT_STATUS_GAQL).toContain('shopping_product.issues')
    expect(SHOPPING_PRODUCT_STATUS_GAQL).not.toContain('segments.date')
    expect(CAMPAIGN_AUDIENCE_PERFORMANCE_GAQL).toContain('FROM campaign_audience_view')
    expect(CAMPAIGN_AUDIENCE_PERFORMANCE_GAQL).toContain('user_list.name')
    expect(AD_GROUP_AUDIENCE_PERFORMANCE_GAQL).toContain('FROM ad_group_audience_view')
    expect(AD_GROUP_AUDIENCE_PERFORMANCE_GAQL).toContain('ad_group_criterion.criterion_id')
    expect(GROUP_PLACEMENT_PERFORMANCE_GAQL).toContain('FROM group_placement_view')
    expect(GROUP_PLACEMENT_PERFORMANCE_GAQL).toContain('metrics.view_through_conversions')
  })
})
