import 'server-only'

import { hasTransactionalEmailTransport, sendTransactionalEmail } from '@/lib/transactional-email'

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

type ReportOtpEmailInput = { otp: string; clientName: string; locale?: 'fr' | 'en' }

export function reportOtpEmailHtml(input: ReportOtpEmailInput) {
  const english = input.locale === 'en'
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#12202b"><p style="font-size:12px;text-transform:uppercase;color:#19A58F">Ads by Yodev</p><h1 style="font-size:24px">${english ? 'Verify your email address' : 'Vérifiez votre adresse email'}</h1><p>${english ? 'Your code to comment on the report for' : 'Votre code pour commenter le rapport de'} <strong>${escapeHtml(input.clientName)}</strong> :</p><p style="font-size:32px;letter-spacing:.22em;font-weight:700">${input.otp}</p><p style="color:#52626f">${english ? 'This code expires in 10 minutes. Do not share it with anyone.' : 'Ce code expire dans 10 minutes. Ne le transférez à personne.'}</p></div>`
}

export async function sendReportOtpEmail(input: ReportOtpEmailInput & { email: string; workspaceId?: string; referenceId?: string }) {
  const english = input.locale === 'en'
  if (!hasTransactionalEmailTransport()) throw new Error(english ? 'Email code delivery is not configured.' : 'L’envoi de codes email n’est pas configuré.')
  await sendTransactionalEmail({
    from: process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: input.email,
    subject: `${english ? 'Verification code' : 'Code de vérification'} · ${input.clientName}`,
    html: reportOtpEmailHtml(input),
    idempotencyKey: `report-otp:${input.referenceId ?? `${input.email.trim().toLowerCase()}:${input.otp}`}`,
    category: 'report_otp',
    workspaceId: input.workspaceId,
    referenceId: input.referenceId,
  })
}
