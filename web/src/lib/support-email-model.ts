export const SUPPORT_EMAIL_KINDS = ['new_ticket', 'customer_reply', 'support_reply', 'status_changed'] as const
export type SupportEmailKind = (typeof SUPPORT_EMAIL_KINDS)[number]

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function supportEmail(input: {
  kind: SupportEmailKind
  locale: string
  subject: string
  workspaceName: string
  message?: string | null
  status: string
  url: string
}) {
  const english = input.locale === 'en'
  const title = input.kind === 'new_ticket'
    ? (english ? 'New support request' : 'Nouvelle demande de support')
    : input.kind === 'customer_reply'
      ? (english ? 'Customer replied to a support request' : 'Réponse client sur une demande de support')
      : input.kind === 'support_reply'
        ? (english ? 'Ads by Yodev support replied' : 'Le support Ads by Yodev a répondu')
        : (english ? 'Support request status changed' : 'Statut de la demande de support modifié')
  const safeMessage = input.message
    ? `<blockquote style="margin:18px 0;padding:12px 16px;border-left:3px solid #19A58F;background:#f3f7f6;white-space:pre-wrap">${escapeHtml(input.message)}</blockquote>`
    : ''
  return {
    subject: `${title} · ${input.subject}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0d1722"><p style="color:#168977;font-weight:700">Ads by Yodev</p><h1 style="font-size:24px">${escapeHtml(title)}</h1><p><strong>${escapeHtml(input.subject)}</strong></p><p>${english ? 'Workspace' : 'Espace'} : ${escapeHtml(input.workspaceName)} · ${english ? 'Status' : 'Statut'} : ${escapeHtml(input.status)}</p>${safeMessage}<p style="margin-top:28px"><a href="${escapeHtml(input.url)}" style="background:#0d1722;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">${english ? 'Open support' : 'Ouvrir le support'}</a></p></div>`,
  }
}
