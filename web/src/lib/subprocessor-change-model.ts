export const SUBPROCESSOR_CHANGE_TYPES = ['addition', 'replacement', 'removal'] as const
export type SubprocessorChangeType = (typeof SUBPROCESSOR_CHANGE_TYPES)[number]

export const SUBPROCESSOR_NOTICE_MINIMUM_DAYS = 15

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function minimumSubprocessorNoticeDate(now: Date) {
  return new Date(now.getTime() + SUBPROCESSOR_NOTICE_MINIMUM_DAYS * 24 * 60 * 60_000)
}

export function assertSubprocessorNoticePeriod(effectiveAt: Date, now: Date) {
  if (Number.isNaN(effectiveAt.getTime())) throw new Error('La date d’effet du changement est invalide.')
  if (effectiveAt < minimumSubprocessorNoticeDate(now)) {
    throw new Error(`Un préavis d’au moins ${SUBPROCESSOR_NOTICE_MINIMUM_DAYS} jours est obligatoire.`)
  }
}

export function subprocessorChangeEmail(input: {
  locale: string
  workspaceName: string
  vendorName: string
  changeType: SubprocessorChangeType
  summaryFr: string
  summaryEn: string
  effectiveAt: Date
  url: string
  timezone?: string
}) {
  const english = input.locale === 'en'
  const typeCopy = english
    ? { addition: 'Addition', replacement: 'Replacement', removal: 'Removal' }
    : { addition: 'Ajout', replacement: 'Remplacement', removal: 'Retrait' }
  const summary = english ? input.summaryEn : input.summaryFr
  const date = new Intl.DateTimeFormat(english ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: input.timezone ?? 'Europe/Paris',
  }).format(input.effectiveAt)
  const subject = english
    ? `Subprocessor change notice · ${input.vendorName}`
    : `Notification de changement de sous-traitant · ${input.vendorName}`
  const objection = english
    ? 'If this change raises a documented data-protection concern, you can contact hello@yodev.fr before the effective date.'
    : 'Si ce changement soulève une objection documentée liée à la protection des données, vous pouvez contacter hello@yodev.fr avant sa date d’effet.'
  const cta = english ? 'Review the subprocessor list' : 'Consulter la liste des sous-traitants'
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0d1722"><p style="color:#168977;font-weight:700">Ads by Yodev</p><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p><strong>${english ? 'Workspace' : 'Espace'}:</strong> ${escapeHtml(input.workspaceName)}</p><p><strong>${english ? 'Change' : 'Changement'}:</strong> ${escapeHtml(typeCopy[input.changeType])} · ${escapeHtml(input.vendorName)}</p><p><strong>${english ? 'Effective date' : 'Date d’effet'}:</strong> ${escapeHtml(date)}</p><div style="margin:18px 0;padding:14px 16px;border-left:3px solid #19A58F;background:#f3f7f6;white-space:pre-wrap">${escapeHtml(summary)}</div><p style="line-height:1.6">${escapeHtml(objection)}</p><p style="margin-top:28px"><a href="${escapeHtml(input.url)}" style="background:#0d1722;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(cta)}</a></p></div>`,
  }
}
