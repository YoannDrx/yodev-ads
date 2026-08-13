import type { CampaignPerformance } from '@/lib/google-ads'

export type ClientReportModel = {
  generatedAt: Date
  periodDays: number
  locale: 'fr' | 'en'
  brandName: string
  poweredByYodev: boolean
  clientName: string
  currencyCode: string
  editorialComment: string | null
  actionPlan: string | null
  totals: {
    costMicros: number
    impressions: number
    clicks: number
    conversions: number
    conversionValueMicros: number
    ctr: number | null
    cpaMicros: number | null
    roas: number | null
  }
  campaigns: CampaignPerformance[]
}

export function buildClientReportModel(input: {
  generatedAt?: Date
  periodDays?: number
  locale?: string
  brandName: string
  poweredByYodev?: boolean
  clientName: string
  currencyCode: string
  editorialComment?: string | null
  actionPlan?: string | null
  campaigns: CampaignPerformance[]
}): ClientReportModel {
  const periodDays = input.periodDays ?? 30
  if (![30].includes(periodDays)) throw new Error('La période de rapport n’est pas prise en charge par la collecte actuelle.')
  const totals = input.campaigns.reduce((sum, campaign) => ({
    costMicros: sum.costMicros + Number(campaign.costMicros),
    impressions: sum.impressions + Number(campaign.impressions),
    clicks: sum.clicks + Number(campaign.clicks),
    conversions: sum.conversions + campaign.conversions,
    conversionValueMicros: sum.conversionValueMicros + Number(campaign.conversionValueMicros),
  }), { costMicros: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueMicros: 0 })
  return {
    generatedAt: input.generatedAt ?? new Date(),
    periodDays,
    locale: input.locale === 'en' ? 'en' : 'fr',
    brandName: input.brandName,
    poweredByYodev: Boolean(input.poweredByYodev),
    clientName: input.clientName,
    currencyCode: input.currencyCode,
    editorialComment: input.editorialComment?.trim() || null,
    actionPlan: input.actionPlan?.trim() || null,
    totals: {
      ...totals,
      ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
      cpaMicros: totals.conversions > 0 ? totals.costMicros / totals.conversions : null,
      roas: totals.costMicros > 0 ? totals.conversionValueMicros / totals.costMicros : null,
    },
    campaigns: [...input.campaigns],
  }
}

function csvCell(value: string | number | null) {
  const text = value === null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function clientReportCsv(model: ClientReportModel) {
  const rows: Array<Array<string | number | null>> = [
    ['report_generated_at', model.generatedAt.toISOString()],
    ['period_days', model.periodDays],
    ['client', model.clientName],
    ['currency', model.currencyCode],
    ['editorial_comment', model.editorialComment],
    ['action_plan', model.actionPlan],
    [],
    ['campaign_id', 'campaign_name', 'channel', 'status', 'impressions', 'clicks', 'cost_micros', 'conversions', 'conversion_value_micros'],
    ...model.campaigns.map((campaign) => [
      campaign.id,
      campaign.name,
      campaign.channelType,
      campaign.status,
      campaign.impressions,
      campaign.clicks,
      campaign.costMicros,
      campaign.conversions,
      campaign.conversionValueMicros,
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
