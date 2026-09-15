import type { ReactNode } from 'react'
import { reportMoney, reportInteger } from '@/lib/report-format'
import type { AnalyticalPageItem } from '@/lib/analytical-pages'

const french: Record<string, string> = {
  name: 'Nom', label: 'Libellé', title: 'Titre', text: 'Texte', key: 'Identifiant du segment', id: 'Identifiant', status: 'Statut', type: 'Type',
  impressions: 'Impressions', clicks: 'Clics', costMicros: 'Coût', conversions: 'Conversions', conversionValueMicros: 'Valeur des conversions', budgetMicros: 'Budget quotidien',
  campaignId: 'Identifiant de campagne', campaignName: 'Campagne', adGroupId: 'Identifiant du groupe d’annonces', adGroupName: 'Groupe d’annonces',
  criterionId: 'Identifiant du critère', searchTerm: 'Requête', targetingStatus: 'Ciblage', matchType: 'Correspondance', qualityScore: 'Niveau de qualité',
  expectedCtr: 'CTR attendu', adRelevance: 'Pertinence de l’annonce', landingPageExperience: 'Page de destination', channelType: 'Type de campagne',
  adStrength: 'Efficacité de l’annonce', approvalStatus: 'Validation', headlines: 'Titres', descriptions: 'Descriptions',
  assetGroupId: 'Identifiant du groupe de composants', assetGroupName: 'Groupe de composants', assetResourceName: 'Composant', fieldType: 'Type de composant',
  primaryStatus: 'Statut principal', performanceLabel: 'Évaluation Google', current: 'Période récente', previous: 'Période précédente', fatigue: 'Signal temporel',
  ctr: 'CTR', ctrChange: 'Évolution du CTR', confidence: 'Confiance', reason: 'Motif',
  resourceName: 'Référence Google', budgetResourceName: 'Référence du budget', merchantId: 'Identifiant Merchant Center', itemId: 'Identifiant produit',
  brand: 'Marque', country: 'Pays', channel: 'Canal', languageCode: 'Langue', feedLabel: 'Libellé du flux', issues: 'Problèmes',
  errorCode: 'Code du problème', severity: 'Gravité', description: 'Description', detail: 'Détail', documentation: 'Documentation',
  affectedRegions: 'Régions concernées', attributeName: 'Attribut', locationType: 'Type de zone', domain: 'Domaine', placement: 'Placement', targetUrl: 'URL cible',
  impressionShare: 'Part d’impressions', overlapRate: 'Taux de chevauchement', positionAboveRate: 'Position au-dessus', outrankingShare: 'Taux de surclassement',
  topImpressionPercentage: 'Impressions en haut de page', absoluteTopImpressionPercentage: 'Impressions en première position',
  searchBudgetLostImpressionShare: 'Part d’impressions perdue au budget', searchRankLostImpressionShare: 'Part d’impressions perdue au classement',
  managerCustomer: 'Compte gérant les conversions', acceptedCustomerDataTerms: 'Conditions des données client acceptées', enhancedConversionsForLeadsEnabled: 'Conversions avancées pour prospects',
  userListName: 'Audience', bidModifier: 'Ajustement d’enchère', viewThroughConversions: 'Conversions après affichage',
}
const english: Record<string, string> = { costMicros: 'Cost', conversionValueMicros: 'Conversion value', budgetMicros: 'Daily budget', expectedCtr: 'Expected CTR', ctr: 'CTR', ctrChange: 'CTR change', targetUrl: 'Target URL', id: 'ID' }
function fieldLabel(key: string, locale: 'fr' | 'en') {
  return (locale === 'fr' ? french[key] : english[key]) ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}
function valueView(value: unknown, key: string, currency: string, locale: 'fr' | 'en', depth = 0): ReactNode {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return locale === 'en' ? value ? 'Yes' : 'No' : value ? 'Oui' : 'Non'
  if (typeof value === 'string' || typeof value === 'number') {
    const raw = String(value)
    if (key.endsWith('Micros') && /^-?\d+$/.test(raw)) return reportMoney(raw, currency, locale)
    if (['clicks', 'impressions'].includes(key) && /^\d+$/.test(raw)) return reportInteger(raw, locale)
    if (typeof value === 'number') return value.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 20 })
    return raw || '—'
  }
  if (depth >= 6) return <pre className="whitespace-pre-wrap break-all">{JSON.stringify(value)}</pre>
  if (Array.isArray(value)) return value.length ? <ul className="space-y-2">{value.map((item, index) => <li key={index}>{valueView(item, key, currency, locale, depth + 1)}</li>)}</ul> : '—'
  if (typeof value === 'object') return <dl className="space-y-2">{Object.entries(value).map(([field, item]) => <div key={field}><dt className="text-xs text-muted-foreground">{fieldLabel(field, locale)}</dt><dd className="whitespace-pre-wrap break-words">{valueView(item, field, currency, locale, depth + 1)}</dd></div>)}</dl>
  return '—'
}

export function AnalyticalRecord({ item, currency, locale }: { item: AnalyticalPageItem; currency: string; locale: 'fr' | 'en' }) {
  const record = item.value && typeof item.value === 'object' && !Array.isArray(item.value) ? item.value as Record<string, unknown> : { value: item.value }
  const title = ['label', 'name', 'title', 'searchTerm', 'text', 'domain'].map((key) => record[key]).find((value) => typeof value === 'string' && value.length) as string | undefined
  const metrics = ['impressions', 'clicks', 'costMicros', 'conversions', 'conversionValueMicros'].filter((key) => record[key] !== undefined)
  return <article data-analytical-record className="min-w-0 rounded-md border bg-card p-5">
    <h2 className="break-words font-semibold">{title ?? `${locale === 'en' ? 'Result' : 'Résultat'} ${item.position}`}</h2>
    <p className="mt-1 break-words text-xs text-muted-foreground">#{item.position}{typeof record.campaignName === 'string' ? ` · ${record.campaignName}` : ''}{typeof record.adGroupName === 'string' ? ` · ${record.adGroupName}` : ''}</p>
    {metrics.length > 0 && <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{metrics.map((key) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{fieldLabel(key, locale)}</dt><dd className="mt-1 break-words text-sm font-medium">{valueView(record[key], key, currency, locale)}</dd></div>)}</dl>}
    <details className="mt-4"><summary className="cursor-pointer text-sm underline">{locale === 'en' ? 'All collected details' : 'Tous les détails collectés'}</summary><dl className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">{Object.entries(record).map(([key, value]) => <div key={key} className="min-w-0 rounded-lg bg-muted p-3"><dt className="mb-1 text-xs font-medium text-muted-foreground">{fieldLabel(key, locale)}</dt><dd className="whitespace-pre-wrap break-words text-sm">{valueView(value, key, currency, locale)}</dd></div>)}</dl></details>
  </article>
}
