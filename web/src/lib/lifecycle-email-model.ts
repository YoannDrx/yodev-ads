export const LIFECYCLE_EMAIL_KINDS = [
  'welcome',
  'trial_day_7',
  'trial_day_12',
  'trial_expired',
  'payment_succeeded',
  'payment_failed',
  'refund_processed',
  'cancellation_scheduled',
  'deletion_scheduled',
  'deletion_cancelled',
] as const

export type LifecycleEmailKind = (typeof LIFECYCLE_EMAIL_KINDS)[number]

export function trialLifecycleDue(input: {
  accessState: string
  trialStartedAt: Date
  trialEndsAt: Date
  now: Date
}) {
  if (input.now >= input.trialEndsAt) return ['trial_expired'] as const
  if (input.accessState !== 'trial') return []
  const elapsed = input.now.getTime() - input.trialStartedAt.getTime()
  const due: Array<'welcome' | 'trial_day_7' | 'trial_day_12'> = ['welcome']
  if (elapsed >= 7 * 24 * 60 * 60_000) due.push('trial_day_7')
  if (elapsed >= 12 * 24 * 60 * 60_000) due.push('trial_day_12')
  return due
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formattedDate(value: Date | null | undefined, locale: 'fr' | 'en', timezone: string) {
  if (!value) return locale === 'fr' ? 'la date prévue' : 'the scheduled date'
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(value)
}

const copy = {
  fr: {
    welcome: ['Bienvenue sur Ads by Yodev', 'Votre essai de 14 jours est ouvert. Connectez Google Ads, synchronisez un compte puis lancez votre première analyse.', 'Démarrer'],
    trial_day_7: ['Votre essai avance', 'Il vous reste 7 jours pour tester les analyses, vigies et rapports en lecture seule.', 'Continuer la configuration'],
    trial_day_12: ['Votre essai se termine bientôt', 'Votre essai se termine dans 2 jours. Choisissez une offre pour conserver l’accès après cette date.', 'Voir les offres'],
    trial_expired: ['Votre essai est terminé', 'Votre espace est désormais suspendu. Vos données stockées restent accessibles selon les règles du produit depuis la page de facturation.', 'Choisir une offre'],
    payment_succeeded: ['Paiement confirmé', 'Votre abonnement Ads by Yodev est actif. Merci pour votre confiance.', 'Ouvrir Ads by Yodev'],
    payment_failed: ['Paiement à régulariser', 'Le paiement de votre abonnement a échoué. Une période de grâce de 7 jours est ouverte ; mettez à jour votre moyen de paiement.', 'Gérer la facturation'],
    refund_processed: ['Remboursement confirmé', 'Votre remboursement a été enregistré par Stripe. Il ne modifie pas automatiquement la date de fin de votre abonnement.', 'Consulter la facturation'],
    cancellation_scheduled: ['Résiliation programmée', 'Votre abonnement restera actif jusqu’à la fin de la période en cours. Vous pouvez annuler cette résiliation depuis votre compte.', 'Gérer l’abonnement'],
    deletion_scheduled: ['Suppression programmée', 'Les accès et secrets ont été révoqués. La purge opérationnelle est programmée et peut encore être annulée avant son échéance.', 'Consulter la demande'],
    deletion_cancelled: ['Suppression annulée', 'La purge de votre espace a été annulée. Google Ads doit être reconnecté et les anciennes clés API restent révoquées.', 'Reconnecter les services'],
  },
  en: {
    welcome: ['Welcome to Ads by Yodev', 'Your 14-day trial is ready. Connect Google Ads, sync an account, then run your first analysis.', 'Get started'],
    trial_day_7: ['Your trial is underway', 'You have 7 days left to test read-only analyses, monitors and reports.', 'Continue setup'],
    trial_day_12: ['Your trial ends soon', 'Your trial ends in 2 days. Choose a plan to keep access after that date.', 'View plans'],
    trial_expired: ['Your trial has ended', 'Your workspace is now suspended. Access to stored data follows the product rules available from billing.', 'Choose a plan'],
    payment_succeeded: ['Payment confirmed', 'Your Ads by Yodev subscription is active. Thank you for your trust.', 'Open Ads by Yodev'],
    payment_failed: ['Payment needs attention', 'Your subscription payment failed. A 7-day grace period has started; please update your payment method.', 'Manage billing'],
    refund_processed: ['Refund confirmed', 'Stripe has recorded your refund. It does not automatically change your subscription end date.', 'Review billing'],
    cancellation_scheduled: ['Cancellation scheduled', 'Your subscription remains active until the end of the current period. You can revoke the cancellation from your account.', 'Manage subscription'],
    deletion_scheduled: ['Deletion scheduled', 'Access and secrets have been revoked. Operational deletion is scheduled and can still be cancelled before its due date.', 'Review request'],
    deletion_cancelled: ['Deletion cancelled', 'Workspace deletion has been cancelled. Google Ads must be reconnected and previous API keys remain revoked.', 'Reconnect services'],
  },
} satisfies Record<'fr' | 'en', Record<LifecycleEmailKind, readonly [string, string, string]>>

export function lifecycleEmail(input: {
  kind: LifecycleEmailKind
  locale: string
  workspaceName: string
  appUrl: string
  effectiveAt?: Date | null
  timezone?: string
}) {
  const locale = input.locale === 'en' ? 'en' : 'fr'
  const [subject, body, cta] = copy[locale][input.kind]
  const dateNote = input.effectiveAt
    ? `<p style="margin:12px 0;color:#5e6971">${locale === 'fr' ? 'Date concernée' : 'Relevant date'} : <strong>${escapeHtml(formattedDate(input.effectiveAt, locale, input.timezone ?? 'Europe/Paris'))}</strong></p>`
    : ''
  const safeUrl = escapeHtml(input.appUrl)
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0d1722"><p style="color:#168977;font-weight:700">Ads by Yodev</p><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p style="line-height:1.6">${escapeHtml(body)}</p>${dateNote}<p style="color:#5e6971">${locale === 'fr' ? 'Espace' : 'Workspace'} : ${escapeHtml(input.workspaceName)}</p><p style="margin-top:28px"><a href="${safeUrl}" style="background:#0d1722;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(cta)}</a></p></div>`,
  }
}
