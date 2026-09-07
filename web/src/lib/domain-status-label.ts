const labels: Record<string, [string, string]> = {
  pending: ['En attente de preuve TXT', 'Awaiting TXT proof'],
  dns_verified: ['Preuve TXT confirmée', 'TXT proof confirmed'],
  active: ['Actif', 'Active'],
  revoked: ['Révoqué', 'Revoked'],
  not_submitted: ['À valider', 'Awaiting validation'],
  ownership_pending: ['Propriété à valider', 'Ownership verification pending'],
  configuration_pending: ['DNS à configurer', 'DNS configuration pending'],
  removed: ['Retiré', 'Removed'],
}
export function domainStatusLabel(status: string, locale: 'fr' | 'en') {
  return labels[status]?.[locale === 'en' ? 1 : 0] ?? (locale === 'en' ? 'Status to check' : 'État à vérifier')
}
