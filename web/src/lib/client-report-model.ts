import type { ReportBranding } from '@/lib/report-branding'
import type { CampaignPerformance } from '@/lib/google-ads'
import { calendarDates, type CalendarWindow } from '@/lib/calendar-window'
import { reportPeriodSchema } from '@/lib/report-period'
import { spreadsheetText } from '@/lib/csv'

export type ClientReportModel = {
  generatedAt: Date
  periodDays: number
  window: (CalendarWindow & { timezone: string }) | null
  sourceVersion: string | null
  locale: 'fr' | 'en'
  brandName: string
  branding?: ReportBranding
  poweredByYodev: boolean
  clientName: string
  currencyCode: string
  editorialComment: string | null
  actionPlan: string | null
  totals: {
    costMicros: string
    impressions: string
    clicks: string
    conversions: number
    conversionValueMicros: string
    ctr: number | null
    cpaMicros: number | null
    roas: number | null
  }
  campaigns: CampaignPerformance[]
}

export type SerializedClientReportModel = Omit<ClientReportModel, 'generatedAt'> & { generatedAt: string }

export function serializeClientReport(model: ClientReportModel): SerializedClientReportModel {
  return { ...model, generatedAt: model.generatedAt.toISOString() }
}

export function deserializeClientReport(model: SerializedClientReportModel): ClientReportModel {
  const generatedAt = new Date(model.generatedAt)
  if (!Number.isFinite(generatedAt.getTime()) || !model.window || calendarDates(model.window).length !== model.periodDays || !model.sourceVersion) throw new Error('Invalid report edition')
  return { ...model, generatedAt }
}

export function buildClientReportModel(input: {
  generatedAt?: Date
  periodDays?: number
  window?: CalendarWindow & { timezone: string }
  sourceVersion?: string
  accountTotals?: { costMicros: string; impressions: string; clicks: string; conversions: number; conversionValueMicros: string }
  locale?: string
  brandName: string
  branding?: ReportBranding
  poweredByYodev?: boolean
  clientName: string
  currencyCode: string
  editorialComment?: string | null
  actionPlan?: string | null
  campaigns: CampaignPerformance[]
}): ClientReportModel {
  const periodDays = input.window ? calendarDates(input.window).length : reportPeriodSchema.parse(input.periodDays ?? 30)
  const sum = input.campaigns.reduce((total, campaign) => ({
    costMicros: total.costMicros + BigInt(campaign.costMicros),
    impressions: total.impressions + BigInt(campaign.impressions),
    clicks: total.clicks + BigInt(campaign.clicks),
    conversions: total.conversions + campaign.conversions,
    conversionValueMicros: total.conversionValueMicros + BigInt(campaign.conversionValueMicros),
  }), { costMicros: BigInt(0), impressions: BigInt(0), clicks: BigInt(0), conversions: 0, conversionValueMicros: BigInt(0) })
  const totals = input.accountTotals ?? { costMicros: String(sum.costMicros), impressions: String(sum.impressions), clicks: String(sum.clicks), conversions: sum.conversions, conversionValueMicros: String(sum.conversionValueMicros) }
  for (const field of ['costMicros', 'impressions', 'clicks', 'conversionValueMicros'] as const) {
    if (!/^-?\d+$/.test(totals[field])) throw new Error('Invalid report metric')
  }
  if (!Number.isFinite(totals.conversions)) throw new Error('Invalid report conversions')
  return {
    generatedAt: input.generatedAt ?? new Date(),
    periodDays,
    window: input.window ? { ...input.window } : null,
    sourceVersion: input.sourceVersion ?? null,
    locale: input.locale === 'en' ? 'en' : 'fr',
    brandName: input.brandName,
    poweredByYodev: Boolean(input.poweredByYodev),
    ...(input.branding ? { branding: input.branding } : {}),
    clientName: input.clientName,
    currencyCode: input.currencyCode,
    editorialComment: input.editorialComment?.trim() || null,
    actionPlan: input.actionPlan?.trim() || null,
    totals: {
      ...totals,
      ctr: Number(totals.impressions) > 0 ? Number(totals.clicks) / Number(totals.impressions) : null,
      cpaMicros: totals.conversions > 0 ? Number(totals.costMicros) / totals.conversions : null,
      roas: Number(totals.costMicros) > 0 ? Number(totals.conversionValueMicros) / Number(totals.costMicros) : null,
    },
    campaigns: [...input.campaigns],
  }
}

type CsvValue = string | number | null | { numeric: string }
function numeric(value: string): CsvValue {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid report CSV metric')
  return { numeric: value }
}
function csvCell(value: CsvValue) {
  if (value !== null && typeof value === 'object') return `"${value.numeric}"`
  const text = typeof value === 'string' ? spreadsheetText(value) : value === null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function clientReportCsv(model: ClientReportModel) {
  const rows: CsvValue[][] = [
    ['report_generated_at', model.generatedAt.toISOString()],
    ['period_days', model.periodDays],
    ['period_from', model.window?.from ?? null],
    ['period_through', model.window?.through ?? null],
    ['timezone', model.window?.timezone ?? null],
    ['source_version', model.sourceVersion],
    ['client', model.clientName],
    ['brand_name', model.brandName],
    ['brand_accent', model.branding?.accentColor ?? null],
    ['brand_logo_sha256', model.branding?.logo?.sha256 ?? null],
    ['currency', model.currencyCode],
    ['editorial_comment', model.editorialComment],
    ['action_plan', model.actionPlan],
    ['account_cost_micros', numeric(model.totals.costMicros)],
    ['account_impressions', numeric(model.totals.impressions)],
    ['account_clicks', numeric(model.totals.clicks)],
    ['account_conversions', model.totals.conversions],
    ['account_conversion_value_micros', numeric(model.totals.conversionValueMicros)],
    [],
    ['campaign_id', 'campaign_name', 'channel', 'status', 'impressions', 'clicks', 'cost_micros', 'conversions', 'conversion_value_micros'],
    ...model.campaigns.map((campaign) => [
      campaign.id,
      campaign.name,
      campaign.channelType,
      campaign.status,
      numeric(campaign.impressions),
      numeric(campaign.clicks),
      numeric(campaign.costMicros),
      campaign.conversions,
      numeric(campaign.conversionValueMicros),
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
