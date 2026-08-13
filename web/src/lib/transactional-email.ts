import 'server-only'

import { Resend } from 'resend'

export type TransactionalEmailInput = {
  from: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  idempotencyKey?: string
  tag?: string
  resendIdempotency?: boolean
}

export function hasTransactionalEmailTransport() {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN || process.env.RESEND_API_KEY)
}

export function plainTextFromHtml(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizedRecipients(recipients: string | string[]) {
  const values = (Array.isArray(recipients) ? recipients : [recipients])
    .map((recipient) => recipient.trim().toLowerCase())
    .filter(Boolean)
  if (values.length === 0) throw new Error('Email recipient is required')
  return values
}

function postmarkTag(value?: string) {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 100)
  return normalized || undefined
}

export async function sendTransactionalEmail(input: TransactionalEmailInput) {
  const recipients = normalizedRecipients(input.to)
  if (process.env.POSTMARK_SERVER_TOKEN) {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': process.env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: input.from,
        To: recipients.join(','),
        Subject: input.subject,
        HtmlBody: input.html,
        TextBody: input.text ?? plainTextFromHtml(input.html),
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound',
        TrackOpens: false,
        TrackLinks: 'None',
        Tag: postmarkTag(input.tag),
        Metadata: input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => ({})) as {
      ErrorCode?: number
      MessageID?: string
      Message?: string
    }
    if (!response.ok || payload.ErrorCode !== 0) {
      throw new Error(payload.Message || 'Postmark rejected the transactional email')
    }
    return { provider: 'postmark' as const, providerMessageId: payload.MessageID ?? null }
  }

  if (!process.env.RESEND_API_KEY) throw new Error('POSTMARK_SERVER_TOKEN or RESEND_API_KEY absent')
  const payload = {
    from: input.from,
    to: Array.isArray(input.to) ? recipients : recipients[0],
    subject: input.subject,
    html: input.html,
    headers: input.idempotencyKey ? { 'X-Entity-Ref-ID': input.idempotencyKey } : undefined,
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  const options = input.idempotencyKey && input.resendIdempotency !== false
    ? { idempotencyKey: input.idempotencyKey }
    : undefined
  const { data, error } = options
    ? await resend.emails.send(payload, options)
    : await resend.emails.send(payload)
  if (error) throw new Error(error.message)
  return { provider: 'resend' as const, providerMessageId: data?.id ?? null }
}
