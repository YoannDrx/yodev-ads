import type { GoogleAdsGateway } from '@/lib/google-ads'
import { accountCalendarDate, calendarDates, shiftCalendarDate } from '@/lib/calendar-window'

export const ANALYTICAL_CONTRACT_VERSION = 1
export const ANALYTICAL_FAMILIES = {
  campaigns: { method: 'campaignPerformance', fr: 'Campagnes', en: 'Campaigns' },
  searchTerms: { method: 'searchTermPerformance', fr: 'Requêtes', en: 'Search terms' },
  keywords: { method: 'keywordPerformance', fr: 'Mots-clés', en: 'Keywords' },
  ads: { method: 'responsiveSearchAdPerformance', fr: 'Annonces', en: 'Ads' },
  tracking: { method: 'conversionTrackingStatus', fr: 'Mesure des conversions', en: 'Conversion tracking' },
  devices: { method: 'devicePerformance', fr: 'Appareils', en: 'Devices' },
  schedules: { method: 'schedulePerformance', fr: 'Jours et heures', en: 'Days and hours' },
  geographies: { method: 'geographicPerformance', fr: 'Géographies', en: 'Geographies' },
  auctions: { method: 'auctionInsights', fr: 'Enchères', en: 'Auctions' },
  placements: { method: 'performanceMaxPlacements', fr: 'Placements PMax', en: 'PMax placements' },
  assetGroups: { method: 'assetGroupPerformance', fr: 'Groupes de composants', en: 'Asset groups' },
  assets: { method: 'assetPerformance', fr: 'Composants', en: 'Assets' },
  products: { method: 'shoppingProductPerformance', fr: 'Produits', en: 'Products' },
  productDiagnostics: { method: 'shoppingProductDiagnostics', fr: 'Éligibilité des produits', en: 'Product eligibility' },
  audiences: { method: 'campaignAudiencePerformance', fr: 'Audiences par campagne', en: 'Campaign audiences' },
  adGroupAudiences: { method: 'adGroupAudiencePerformance', fr: 'Audiences par groupe', en: 'Ad group audiences' },
  groupPlacements: { method: 'groupPlacementPerformance', fr: 'Placements Display/YouTube', en: 'Display/YouTube placements' },
} as const
export type AnalyticalFamily = keyof typeof ANALYTICAL_FAMILIES
export const analyticalFamilies = Object.keys(ANALYTICAL_FAMILIES) as AnalyticalFamily[]
export type AnalyticalData<K extends AnalyticalFamily> = Awaited<ReturnType<GoogleAdsGateway[typeof ANALYTICAL_FAMILIES[K]['method']]>>

export type AnalyticalSnapshot = {
  family: string; contractVersion: number; periodFrom: string; periodThrough: string; timezone: string; currencyCode: string;
  sourceVersion: string; observedAt: Date; collectedAt: Date; payload: unknown;
}
export type AnalyticalAttempt = { family: string; status: string; createdAt: Date; startedAt: Date | null; availableAt: Date; updatedAt: Date }

export function analyticalSnapshotData<K extends AnalyticalFamily>(rows: AnalyticalSnapshot[], family: K, client: { timezone: string; currencyCode: string }): AnalyticalData<K> | undefined {
  const row = rows.find((item) => item.family === family && item.contractVersion === ANALYTICAL_CONTRACT_VERSION && item.timezone === client.timezone && item.currencyCode === client.currencyCode)
  if (!row) return undefined
  if (analyticalSnapshotState(row, client) === 'unavailable') return undefined
  if (family === 'tracking' ? !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) : !Array.isArray(row.payload)) return undefined
  // Only the versioned worker can write this table; app credentials are SELECT-only.
  return row.payload as AnalyticalData<K>
}

export function analyticalSnapshotState(row: AnalyticalSnapshot | undefined, client: { timezone: string; currencyCode: string }, now = new Date()) {
  if (!row || row.contractVersion !== ANALYTICAL_CONTRACT_VERSION || row.timezone !== client.timezone || row.currencyCode !== client.currencyCode) return 'unavailable' as const
  try {
    if (calendarDates({ from: row.periodFrom, through: row.periodThrough }, 30).length !== 30) return 'unavailable' as const
  } catch { return 'unavailable' as const }
  const age = now.getTime() - row.observedAt.getTime()
  const yesterday = shiftCalendarDate(accountCalendarDate(now, client.timezone), -1)
  if (row.periodThrough > yesterday) return 'unavailable' as const
  if (!Number.isFinite(age) || age < -60_000) return 'unavailable' as const
  return age > 26 * 60 * 60_000 || row.periodThrough !== yesterday ? 'stale' as const : 'available' as const
}
