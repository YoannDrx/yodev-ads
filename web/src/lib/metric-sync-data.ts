import { calendarDates, type CalendarWindow } from '@/lib/calendar-window'
import type { DailyAccountMetric, DailyCampaignMetric } from '@/lib/google-ads'

function validateMetrics(metric: DailyAccountMetric) {
  for (const value of [metric.costMicros, metric.impressions, metric.clicks]) {
    if (typeof value !== 'string' || !/^-?\d{1,22}$/.test(value)) throw new Error('Invalid integer metric in Google response')
  }
  if (!Number.isFinite(metric.conversions) || !Number.isFinite(metric.conversionValue) || !Number.isSafeInteger(Math.round(metric.conversionValue * 1_000_000))) {
    throw new Error('Invalid or unsafe conversion metric in Google response')
  }
}

/** Missing segmented rows mean zero only after both complete responses succeed. */
export function normalizeMetricSyncData(input: { window: CalendarWindow; today: string; complete: boolean; accounts: DailyAccountMetric[]; campaigns: DailyCampaignMetric[] }) {
  if (!input.complete) throw new Error('Incomplete metric response cannot replace history')
  const dates = calendarDates(input.window, 7)
  if (input.window.through > input.today) throw new Error('Future metric dates are unavailable')
  const accounts = new Map<string, DailyAccountMetric>()
  const campaigns = new Map<string, DailyCampaignMetric>()
  for (const metric of input.accounts) {
    if (!dates.includes(metric.date) || accounts.has(metric.date)) throw new Error('Unexpected or duplicate account metric date')
    validateMetrics(metric)
    accounts.set(metric.date, metric)
  }
  for (const metric of input.campaigns) {
    if (!dates.includes(metric.date) || !/^\d{1,32}$/.test(metric.campaignId)) throw new Error('Unexpected campaign metric identity')
    validateMetrics(metric)
    const key = `${metric.campaignId}:${metric.date}`
    if (campaigns.has(key)) throw new Error('Duplicate campaign metric date')
    campaigns.set(key, metric)
  }
  return { accounts: dates.map((date) => ({
    ...(accounts.get(date) ?? { date, costMicros: '0', impressions: '0', clicks: '0', conversions: 0, conversionValue: 0 }),
    coverageStatus: date === input.today ? 'partial' as const : 'complete' as const,
    accountRows: accounts.has(date) ? 1 : 0,
    campaignRows: input.campaigns.filter((metric) => metric.date === date).length,
  })), campaigns: [...campaigns.values()] }
}
