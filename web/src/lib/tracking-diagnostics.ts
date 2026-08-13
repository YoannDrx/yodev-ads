export type ConversionDiagnosticInput = {
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
}

export type TrackingDiagnostic = {
  id: string
  severity: 'info' | 'warning' | 'critical'
  confidence: 'high' | 'medium'
  title: string
  description: string
  resourceNames: string[]
}

export type OfflineDiagnosticInput = {
  uploadClient: string
  status: string
  lastUploadAt: Date | null
  totalEventCount: string
  successfulEventCount: string
  pendingEventCount: string
  successRate: string | null
  alerts: Array<Record<string, unknown>>
}

function normalizedName(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function diagnoseConversionActions(actions: ConversionDiagnosticInput[], now = new Date(), locale: 'fr' | 'en' = 'fr'): TrackingDiagnostic[] {
  const english = locale === 'en'
  const findings: TrackingDiagnostic[] = []
  const staleBefore = now.getTime() - 30 * 24 * 60 * 60_000
  for (const action of actions) {
    if (action.status !== 'ENABLED') {
      findings.push({
        id: `status:${action.resourceName}`,
        severity: action.primaryForGoal ? 'critical' : 'warning',
        confidence: 'high',
        title: english ? `${action.status.toLowerCase()} action: ${action.name}` : `Action ${action.status.toLowerCase()} : ${action.name}`,
        description: english ? 'State read from the Google Ads configuration. Check whether this action should still participate in measurement or bidding.' : 'État lu dans la configuration Google Ads. Vérifiez si cette action doit encore participer à la mesure ou aux enchères.',
        resourceNames: [action.resourceName],
      })
    }
    const latestActivity = [action.lastReceivedAt, action.lastConversionAt]
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0]
    if (action.status === 'ENABLED' && !latestActivity) {
      findings.push({
        id: `no-activity:${action.resourceName}`,
        severity: action.primaryForGoal ? 'critical' : 'warning',
        confidence: 'high',
        title: english ? `No visible API activity: ${action.name}` : `Aucune activité API visible : ${action.name}`,
        description: english ? 'Google Ads returns neither a last conversion nor a last tag receipt. This alone does not prove that the site tag never fires.' : 'Google Ads ne renvoie ni dernière conversion ni dernière réception de balise. Cela ne certifie pas à lui seul que la balise du site ne se déclenche jamais.',
        resourceNames: [action.resourceName],
      })
    } else if (action.status === 'ENABLED' && latestActivity && latestActivity.getTime() < staleBefore) {
      findings.push({
        id: `stale:${action.resourceName}`,
        severity: action.primaryForGoal ? 'critical' : 'warning',
        confidence: 'high',
        title: english ? `Stale activity: ${action.name}` : `Activité ancienne : ${action.name}`,
        description: english ? `The latest API-visible activity is from ${latestActivity.toLocaleDateString('en-GB')}. Confirm actual firing with Tag Assistant and a test conversion.` : `La dernière activité visible par l’API date du ${latestActivity.toLocaleDateString('fr-FR')}. Confirmez le déclenchement réel avec Tag Assistant et un test de conversion.`,
        resourceNames: [action.resourceName],
      })
    }
    if (action.primaryForGoal !== action.includeInConversionsMetric) {
      findings.push({
        id: `goal-mismatch:${action.resourceName}`,
        severity: 'info',
        confidence: 'high',
        title: english ? `Bidding role and metric differ: ${action.name}` : `Rôle d’enchère et métrique différents : ${action.name}`,
        description: english ? 'Google recommends using primary_for_goal for the bidding role. The legacy include_in_conversions_metric indicator differs here; verify the configuration intent.' : 'Google recommande de raisonner avec primary_for_goal pour le rôle d’enchère. L’ancien indicateur include_in_conversions_metric diffère ici ; contrôlez l’intention de configuration.',
        resourceNames: [action.resourceName],
      })
    }
  }

  const groups = new Map<string, ConversionDiagnosticInput[]>()
  for (const action of actions) {
    const key = `${normalizedName(action.name)}:${action.actionType ?? ''}:${action.origin ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), action])
  }
  for (const duplicates of groups.values()) {
    if (duplicates.length < 2) continue
    findings.push({
      id: `duplicate:${duplicates.map((action) => action.resourceName).sort().join(':')}`,
      severity: 'warning',
      confidence: 'medium',
      title: english ? `Probable duplicate: ${duplicates[0].name}` : `Doublon probable : ${duplicates[0].name}`,
      description: english ? `${duplicates.length} actions share the same normalized name, type and origin. Compare their tags and imports before making any change.` : `${duplicates.length} actions partagent le même nom normalisé, le même type et la même origine. Comparez leurs balises et imports avant toute modification.`,
      resourceNames: duplicates.map((action) => action.resourceName),
    })
  }
  return findings.sort((left, right) => ({ critical: 0, warning: 1, info: 2 })[left.severity] - ({ critical: 0, warning: 1, info: 2 })[right.severity])
}

export function isOfflineConversionAction(action: ConversionDiagnosticInput) {
  const type = action.actionType ?? ''
  const origin = action.origin ?? ''
  return type.includes('UPLOAD') || type.includes('STORE_SALES') || origin === 'UPLOAD'
}

export function diagnoseOfflineConversionImports(
  actions: ConversionDiagnosticInput[],
  summaries: OfflineDiagnosticInput[],
  now = new Date(),
  locale: 'fr' | 'en' = 'fr',
): TrackingDiagnostic[] {
  const english = locale === 'en'
  const offlineActions = actions.filter(isOfflineConversionAction)
  if (offlineActions.length === 0) return []
  if (summaries.length === 0) {
    return [{
      id: 'offline:no-summary',
      severity: 'warning',
      confidence: 'medium',
      title: english ? 'Offline diagnostics unavailable' : 'Diagnostic offline indisponible',
      description: english ? 'Offline actions exist, but Google returns no summary for this customer. This may indicate no recent import or a different upload context; it is not proof of failure.' : 'Des actions offline existent, mais Google ne renvoie aucun résumé pour ce customer. Cela peut indiquer une absence d’import récent ou un contexte d’upload différent ; ce n’est pas une preuve d’échec.',
      resourceNames: offlineActions.map((action) => action.resourceName),
    }]
  }
  return summaries.flatMap<TrackingDiagnostic>((summary) => {
    const context = `${summary.uploadClient} · ${Number(summary.successfulEventCount).toLocaleString(english ? 'en-GB' : 'fr-FR')}/${Number(summary.totalEventCount).toLocaleString(english ? 'en-GB' : 'fr-FR')} ${english ? 'successful events' : 'événements réussis'}`
    if (summary.status === 'NEEDS_ATTENTION') {
      return [{
        id: `offline:attention:${summary.uploadClient}`,
        severity: 'critical',
        confidence: 'high',
        title: english ? `Offline imports to fix · ${summary.uploadClient}` : `Imports offline à corriger · ${summary.uploadClient}`,
        description: english ? `${context}. Google reports ${summary.alerts.length} error group(s). Review import diagnostics before any new integration; Ads by Yodev uploads no events.` : `${context}. Google signale ${summary.alerts.length} groupe(s) d’erreurs. Consultez les diagnostics d’import avant toute nouvelle intégration ; Ads by Yodev n’upload aucun événement.`,
        resourceNames: offlineActions.map((action) => action.resourceName),
      }]
    }
    if (summary.status === 'NO_RECENT_UPLOADS') {
      return [{
        id: `offline:no-recent:${summary.uploadClient}`,
        severity: 'warning',
        confidence: 'high',
        title: english ? `No recent offline import · ${summary.uploadClient}` : `Aucun import offline récent · ${summary.uploadClient}`,
        description: english ? `${context}. Check the source pipeline, customer and click IDs; the analysis remains strictly read-only.` : `${context}. Vérifiez le pipeline source, le customer utilisé et les identifiants de clic ; l’analyse reste strictement en lecture seule.`,
        resourceNames: offlineActions.map((action) => action.resourceName),
      }]
    }
    if (summary.lastUploadAt && summary.lastUploadAt.getTime() < now.getTime() - 7 * 24 * 60 * 60_000) {
      return [{
        id: `offline:stale:${summary.uploadClient}`,
        severity: 'warning',
        confidence: 'high',
        title: english ? `Last offline import is stale · ${summary.uploadClient}` : `Dernier import offline ancien · ${summary.uploadClient}`,
        description: english ? `Last visible upload on ${summary.lastUploadAt.toLocaleDateString('en-GB')}. ${context}. Confirm the expected frequency in the CRM or Data Manager.` : `Dernier upload visible le ${summary.lastUploadAt.toLocaleDateString('fr-FR')}. ${context}. Confirmez la fréquence attendue côté CRM ou Data Manager.`,
        resourceNames: offlineActions.map((action) => action.resourceName),
      }]
    }
    if (Number(summary.pendingEventCount) > 0) {
      return [{
        id: `offline:pending:${summary.uploadClient}`,
        severity: 'info',
        confidence: 'high',
        title: english ? `Offline imports processing · ${summary.uploadClient}` : `Imports offline en traitement · ${summary.uploadClient}`,
        description: english ? `${Number(summary.pendingEventCount).toLocaleString('en-GB')} event(s) are still pending at Google. Do not conclude they are lost before processing.` : `${Number(summary.pendingEventCount).toLocaleString('fr-FR')} événement(s) sont encore en attente chez Google. Ne concluez pas à une perte avant leur traitement.`,
        resourceNames: offlineActions.map((action) => action.resourceName),
      }]
    }
    return []
  })
}
