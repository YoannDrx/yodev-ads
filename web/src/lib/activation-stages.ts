/** Persisted evidence keys, shared by recording and aggregate display. */
export const ACTIVATION_STAGES = [
  { milestone: 'google_connected', field: 'googleConnected', label: 'Google connecté' },
  { milestone: 'accounts_synced', field: 'accountsSynced', label: 'Inventaire synchronisé' },
  { milestone: 'accounts_selected', field: 'accountsSelected', label: 'Compte géré sélectionné' },
  { milestone: 'first_qualified_analysis', field: 'firstAnalysis', label: 'Première analyse qualifiée' },
  { milestone: 'first_monitor', field: 'firstMonitor', label: 'Première vigie' },
  { milestone: 'first_report_published', field: 'firstReport', label: 'Premier rapport publié' },
  { milestone: 'legal_accepted', field: 'legalAccepted', label: 'Cadre légal accepté' },
  { milestone: 'paid_conversion', field: 'paid', label: 'Conversion payante' },
] as const

export type ActivationStageField = (typeof ACTIVATION_STAGES)[number]['field']
