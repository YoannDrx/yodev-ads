import type {
  AccountAnalysisData,
  KeywordPerformance,
  ResponsiveSearchAdPerformance,
  SearchTermPerformance,
} from '@/lib/google-ads'

export type AnalysisCategory = 'search_terms' | 'keywords' | 'ads' | 'tracking'
export type AnalysisPriority = 'critical' | 'high' | 'medium'

export type AnalysisFinding = {
  id: string
  category: AnalysisCategory
  priority: AnalysisPriority
  title: string
  description: string
  recommendation: string
  campaignId?: string
  campaignName?: string
  adGroupId?: string
  adGroupName?: string
  criterionId?: string
  adId?: string
  suggestedWorkflow?: 'keyword_create_negative' | 'keyword_create_positive' | 'keyword_status' | 'ad_status'
  entityLabel: string
  value: number
  valueKind: 'money' | 'score' | 'count'
}

export type AnalysisResult = {
  score: number
  findings: AnalysisFinding[]
  summary: {
    wastedSpendMicros: number
    weakKeywords: number
    weakAds: number
    trackingIssues: number
  }
}

const money = (micros: string) => Number(micros) / 1_000_000
const stableId = (...parts: Array<string | number>) => parts.join(':').toLowerCase().replace(/[^a-z0-9:_-]/g, '-')

export function analyzeSearchTerms(searchTerms: SearchTermPerformance[], minimumWaste = 20, locale: 'fr' | 'en' = 'fr'): AnalysisFinding[] {
  const english = locale === 'en'
  return searchTerms.flatMap<AnalysisFinding>((term) => {
    const cost = money(term.costMicros)
    if (term.targetingStatus === 'ADDED' || term.targetingStatus === 'EXCLUDED' || term.targetingStatus === 'ADDED_EXCLUDED') return []
    if (term.conversions > 0) {
      return [{
        id: stableId('converting-search-term', term.campaignId, term.adGroupId, term.searchTerm),
        category: 'search_terms' as const,
        priority: term.conversions >= 3 ? ('high' as const) : ('medium' as const),
        title: english ? 'Converting search term to isolate' : 'Requête convertissante à isoler',
        description: english ? `“${term.searchTerm}” generated ${term.conversions.toLocaleString('en-GB')} conversion(s) over 30 days without being added as a keyword.` : `« ${term.searchTerm} » a généré ${term.conversions.toLocaleString('fr-FR')} conversion(s) sur 30 jours sans être ajoutée comme mot-clé.`,
        recommendation: english ? 'Check relevance and promote it with an explicit match type to better control bids and ads.' : 'Vérifier la pertinence et la promouvoir avec un type de correspondance explicite pour mieux contrôler les enchères et les annonces.',
        campaignId: term.campaignId,
        campaignName: term.campaignName,
        adGroupId: term.adGroupId,
        adGroupName: term.adGroupName,
        suggestedWorkflow: 'keyword_create_positive' as const,
        entityLabel: term.searchTerm,
        value: term.conversions,
        valueKind: 'count' as const,
      }]
    }
    if (cost < minimumWaste) return []
    return [
      {
        id: stableId('search-term', term.campaignId, term.adGroupId, term.searchTerm),
        category: 'search_terms' as const,
        priority: cost >= minimumWaste * 3 ? ('high' as const) : ('medium' as const),
        title: english ? 'Expensive search term without conversions' : 'Terme de recherche coûteux sans conversion',
        description: english ? `“${term.searchTerm}” spent ${cost.toFixed(2)} without a conversion over 30 days.` : `« ${term.searchTerm} » a consommé ${cost.toFixed(2)} sans conversion sur 30 jours.`,
        recommendation: english ? 'Check intent, then add it as a negative keyword if it does not match the offer.' : 'Vérifier l’intention puis l’ajouter comme mot-clé négatif si elle ne correspond pas à l’offre.',
        campaignId: term.campaignId,
        campaignName: term.campaignName,
        adGroupId: term.adGroupId,
        adGroupName: term.adGroupName,
        suggestedWorkflow: 'keyword_create_negative' as const,
        entityLabel: term.searchTerm,
        value: cost,
        valueKind: 'money' as const,
      },
    ]
  })
}

export function analyzeKeywords(keywords: KeywordPerformance[], maximumQualityScore = 5, locale: 'fr' | 'en' = 'fr'): AnalysisFinding[] {
  const english = locale === 'en'
  return keywords.flatMap((keyword) => {
    if (
      keyword.status !== 'ENABLED' ||
      keyword.qualityScore === null ||
      keyword.qualityScore > maximumQualityScore ||
      Number(keyword.impressions) === 0
    ) {
      return []
    }
    const weakSignals = [
      keyword.expectedCtr === 'BELOW_AVERAGE' ? (english ? 'expected CTR' : 'CTR attendu') : null,
      keyword.adRelevance === 'BELOW_AVERAGE' ? (english ? 'ad relevance' : 'pertinence de l’annonce') : null,
      keyword.landingPageExperience === 'BELOW_AVERAGE' ? (english ? 'landing-page experience' : 'expérience de page') : null,
    ].filter(Boolean)
    return [
      {
        id: stableId('keyword', keyword.criterionId),
        category: 'keywords' as const,
        priority: keyword.qualityScore <= 3 ? ('high' as const) : ('medium' as const),
        title: english ? `Low Quality Score (${keyword.qualityScore}/10)` : `Quality Score faible (${keyword.qualityScore}/10)`,
        description: english ? `“${keyword.text}” is penalized${weakSignals.length ? ` on: ${weakSignals.join(', ')}` : ''}.` : `« ${keyword.text} » est pénalisé${weakSignals.length ? ` sur : ${weakSignals.join(', ')}` : ''}.`,
        recommendation:
          english ? 'Tighten the ad group, include the keyword in headlines and align the promise with the landing page.' : 'Resserrer le groupe d’annonces, reprendre le mot-clé dans les titres et aligner la promesse avec la page de destination.',
        campaignId: keyword.campaignId,
        campaignName: keyword.campaignName,
        adGroupId: keyword.adGroupId,
        adGroupName: keyword.adGroupName,
        criterionId: keyword.criterionId,
        suggestedWorkflow: 'keyword_status' as const,
        entityLabel: keyword.text,
        value: keyword.qualityScore,
        valueKind: 'score' as const,
      },
    ]
  })
}

export function analyzeAds(ads: ResponsiveSearchAdPerformance[], locale: 'fr' | 'en' = 'fr'): AnalysisFinding[] {
  const english = locale === 'en'
  return ads.flatMap((ad) => {
    if (ad.status !== 'ENABLED') return []
    if (!['DISAPPROVED', 'POOR', 'AVERAGE'].includes(ad.approvalStatus) && !['POOR', 'AVERAGE'].includes(ad.adStrength)) {
      return []
    }
    const disapproved = ad.approvalStatus === 'DISAPPROVED'
    const missingAssets = Math.max(0, 8 - ad.headlines.length) + Math.max(0, 3 - ad.descriptions.length)
    return [
      {
        id: stableId('ad', ad.id),
        category: 'ads' as const,
        priority: disapproved || ad.adStrength === 'POOR' ? ('high' as const) : ('medium' as const),
        title: disapproved ? (english ? 'Ad disapproved by Google' : 'Annonce refusée par Google') : `${english ? 'Ad strength' : 'Force de l’annonce'} : ${ad.adStrength.toLowerCase()}`,
        description: disapproved
          ? (english ? `The ad in “${ad.adGroupName}” cannot serve.` : `L’annonce du groupe « ${ad.adGroupName} » ne peut pas être diffusée.`)
          : (english ? `${ad.headlines.length} headlines and ${ad.descriptions.length} descriptions available${missingAssets ? `, ${missingAssets} useful asset(s) to add` : ''}.` : `${ad.headlines.length} titres et ${ad.descriptions.length} descriptions disponibles${missingAssets ? `, ${missingAssets} ressource(s) utile(s) à ajouter` : ''}.`),
        recommendation: disapproved
          ? (english ? 'Open Google policy details, fix the affected elements, then submit the ad for another review.' : 'Ouvrir le détail des règles Google, corriger les éléments concernés puis soumettre l’annonce à un nouvel examen.')
          : (english ? 'Diversify angles, benefits and proof without repeating the same wording across headlines.' : 'Diversifier les angles, bénéfices et preuves sans répéter les mêmes formulations entre les titres.'),
        campaignId: ad.campaignId,
        campaignName: ad.campaignName,
        adGroupId: ad.adGroupId,
        adGroupName: ad.adGroupName,
        adId: ad.id,
        suggestedWorkflow: 'ad_status' as const,
        entityLabel: ad.adGroupName,
        value: missingAssets,
        valueKind: 'count' as const,
      },
    ]
  })
}

export function analyzeAccount(data: AccountAnalysisData, locale: 'fr' | 'en' = 'fr'): AnalysisResult {
  const english = locale === 'en'
  const searchTermFindings = analyzeSearchTerms(data.searchTerms, 20, locale)
  const keywordFindings = analyzeKeywords(data.keywords, 5, locale)
  const adFindings = analyzeAds(data.ads, locale)
  const totalCost = data.campaigns.reduce((sum, campaign) => sum + money(campaign.costMicros), 0)
  const totalConversions = data.campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const trackingActive = data.conversionTracking.status.includes('MANAGED_BY_')
  const trackingFindings: AnalysisFinding[] = []

  if (!trackingActive) {
    trackingFindings.push({
      id: 'tracking:inactive',
      category: 'tracking',
      priority: 'critical',
      title: english ? 'Conversion tracking inactive' : 'Suivi des conversions inactif',
      description: english ? `Google Ads reports “${data.conversionTracking.status}” for this account.` : `Google Ads indique l’état « ${data.conversionTracking.status} » pour ce compte.`,
      recommendation: english ? 'Configure a primary conversion action and verify that the tag fires before optimizing bids.' : 'Configurer une action de conversion principale et vérifier le déclenchement de la balise avant d’optimiser les enchères.',
      entityLabel: english ? 'Google Ads account' : 'Compte Google Ads',
      value: 1,
      valueKind: 'count',
    })
  } else if (totalCost >= 50 && totalConversions === 0) {
    trackingFindings.push({
      id: 'tracking:no-conversions',
      category: 'tracking',
      priority: 'high',
      title: english ? 'No conversions despite spend' : 'Aucune conversion malgré la dépense',
      description: english ? `${totalCost.toFixed(2)} was spent over 30 days without a reported conversion.` : `${totalCost.toFixed(2)} ont été dépensés sur 30 jours sans conversion remontée.`,
      recommendation: english ? 'Test the conversion end to end with Tag Assistant and confirm it is included in the Conversions column.' : 'Tester la conversion de bout en bout avec Tag Assistant et confirmer qu’elle est incluse dans la colonne Conversions.',
      entityLabel: english ? 'Google Ads account' : 'Compte Google Ads',
      value: totalCost,
      valueKind: 'money',
    })
  }

  if (!data.conversionTracking.enhancedConversionsForLeadsEnabled && totalConversions > 0) {
    trackingFindings.push({
      id: 'tracking:enhanced-conversions',
      category: 'tracking',
      priority: 'medium',
      title: english ? 'Enhanced conversions not enabled' : 'Conversions avancées non activées',
      description: english ? 'Conversions are measured, but enhanced conversions for leads are not active.' : 'Les conversions sont mesurées, mais les conversions avancées pour les prospects ne sont pas actives.',
      recommendation: english ? 'Evaluate activation with hashed first-party data to improve attribution and modeling.' : 'Évaluer l’activation avec des données first-party hachées pour améliorer l’attribution et la modélisation.',
      entityLabel: english ? 'Conversion measurement' : 'Mesure des conversions',
      value: 1,
      valueKind: 'count',
    })
  }

  const findings = [...trackingFindings, ...searchTermFindings, ...keywordFindings, ...adFindings].sort(
    (a, b) => ({ critical: 3, high: 2, medium: 1 })[b.priority] - ({ critical: 3, high: 2, medium: 1 })[a.priority],
  )
  const penalty = findings.reduce(
    (sum, finding) => sum + ({ critical: 24, high: 10, medium: 4 })[finding.priority],
    0,
  )

  return {
    score: Math.max(0, 100 - Math.min(100, penalty)),
    findings,
    summary: {
      wastedSpendMicros: Math.round(searchTermFindings
        .filter((finding) => finding.suggestedWorkflow === 'keyword_create_negative')
        .reduce((sum, finding) => sum + finding.value, 0) * 1_000_000),
      weakKeywords: keywordFindings.length,
      weakAds: adFindings.length,
      trackingIssues: trackingFindings.length,
    },
  }
}
