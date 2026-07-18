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

export function analyzeSearchTerms(searchTerms: SearchTermPerformance[], minimumWaste = 20): AnalysisFinding[] {
  return searchTerms.flatMap((term) => {
    const cost = money(term.costMicros)
    if (term.conversions > 0 || cost < minimumWaste || term.targetingStatus === 'ADDED_EXCLUDED') return []
    return [
      {
        id: stableId('search-term', term.campaignId, term.adGroupId, term.searchTerm),
        category: 'search_terms' as const,
        priority: cost >= minimumWaste * 3 ? ('high' as const) : ('medium' as const),
        title: 'Terme de recherche coûteux sans conversion',
        description: `« ${term.searchTerm} » a consommé ${cost.toFixed(2)} sans conversion sur 30 jours.`,
        recommendation: 'Vérifier l’intention puis l’ajouter comme mot-clé négatif si elle ne correspond pas à l’offre.',
        campaignId: term.campaignId,
        campaignName: term.campaignName,
        entityLabel: term.searchTerm,
        value: cost,
        valueKind: 'money' as const,
      },
    ]
  })
}

export function analyzeKeywords(keywords: KeywordPerformance[], maximumQualityScore = 5): AnalysisFinding[] {
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
      keyword.expectedCtr === 'BELOW_AVERAGE' ? 'CTR attendu' : null,
      keyword.adRelevance === 'BELOW_AVERAGE' ? 'pertinence de l’annonce' : null,
      keyword.landingPageExperience === 'BELOW_AVERAGE' ? 'expérience de page' : null,
    ].filter(Boolean)
    return [
      {
        id: stableId('keyword', keyword.criterionId),
        category: 'keywords' as const,
        priority: keyword.qualityScore <= 3 ? ('high' as const) : ('medium' as const),
        title: `Quality Score faible (${keyword.qualityScore}/10)`,
        description: `« ${keyword.text} » est pénalisé${weakSignals.length ? ` sur : ${weakSignals.join(', ')}` : ''}.`,
        recommendation:
          'Resserrer le groupe d’annonces, reprendre le mot-clé dans les titres et aligner la promesse avec la page de destination.',
        campaignId: keyword.campaignId,
        campaignName: keyword.campaignName,
        entityLabel: keyword.text,
        value: keyword.qualityScore,
        valueKind: 'score' as const,
      },
    ]
  })
}

export function analyzeAds(ads: ResponsiveSearchAdPerformance[]): AnalysisFinding[] {
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
        title: disapproved ? 'Annonce refusée par Google' : `Force de l’annonce : ${ad.adStrength.toLowerCase()}`,
        description: disapproved
          ? `L’annonce du groupe « ${ad.adGroupName} » ne peut pas être diffusée.`
          : `${ad.headlines.length} titres et ${ad.descriptions.length} descriptions disponibles${missingAssets ? `, ${missingAssets} ressource(s) utile(s) à ajouter` : ''}.`,
        recommendation: disapproved
          ? 'Ouvrir le détail des règles Google, corriger les éléments concernés puis soumettre l’annonce à un nouvel examen.'
          : 'Diversifier les angles, bénéfices et preuves sans répéter les mêmes formulations entre les titres.',
        campaignId: ad.campaignId,
        campaignName: ad.campaignName,
        entityLabel: ad.adGroupName,
        value: missingAssets,
        valueKind: 'count' as const,
      },
    ]
  })
}

export function analyzeAccount(data: AccountAnalysisData): AnalysisResult {
  const searchTermFindings = analyzeSearchTerms(data.searchTerms)
  const keywordFindings = analyzeKeywords(data.keywords)
  const adFindings = analyzeAds(data.ads)
  const totalCost = data.campaigns.reduce((sum, campaign) => sum + money(campaign.costMicros), 0)
  const totalConversions = data.campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const trackingActive = data.conversionTracking.status.includes('MANAGED_BY_')
  const trackingFindings: AnalysisFinding[] = []

  if (!trackingActive) {
    trackingFindings.push({
      id: 'tracking:inactive',
      category: 'tracking',
      priority: 'critical',
      title: 'Suivi des conversions inactif',
      description: `Google Ads indique l’état « ${data.conversionTracking.status} » pour ce compte.`,
      recommendation: 'Configurer une action de conversion principale et vérifier le déclenchement de la balise avant d’optimiser les enchères.',
      entityLabel: 'Compte Google Ads',
      value: 1,
      valueKind: 'count',
    })
  } else if (totalCost >= 50 && totalConversions === 0) {
    trackingFindings.push({
      id: 'tracking:no-conversions',
      category: 'tracking',
      priority: 'high',
      title: 'Aucune conversion malgré la dépense',
      description: `${totalCost.toFixed(2)} ont été dépensés sur 30 jours sans conversion remontée.`,
      recommendation: 'Tester la conversion de bout en bout avec Tag Assistant et confirmer qu’elle est incluse dans la colonne Conversions.',
      entityLabel: 'Compte Google Ads',
      value: totalCost,
      valueKind: 'money',
    })
  }

  if (!data.conversionTracking.enhancedConversionsForLeadsEnabled && totalConversions > 0) {
    trackingFindings.push({
      id: 'tracking:enhanced-conversions',
      category: 'tracking',
      priority: 'medium',
      title: 'Conversions avancées non activées',
      description: 'Les conversions sont mesurées, mais les conversions avancées pour les prospects ne sont pas actives.',
      recommendation: 'Évaluer l’activation avec des données first-party hachées pour améliorer l’attribution et la modélisation.',
      entityLabel: 'Mesure des conversions',
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
      wastedSpendMicros: Math.round(searchTermFindings.reduce((sum, finding) => sum + finding.value, 0) * 1_000_000),
      weakKeywords: keywordFindings.length,
      weakAds: adFindings.length,
      trackingIssues: trackingFindings.length,
    },
  }
}
