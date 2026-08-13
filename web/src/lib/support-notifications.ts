import 'server-only'

import { and, eq } from 'drizzle-orm'
import { auditEvents, supportMessages, supportTickets, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { NonRetryableJobError } from '@/lib/jobs'
import { supportEmail, type SupportEmailKind } from '@/lib/support-email-model'
import { verifiedAuthUserEmail } from '@/lib/auth-identities'
import { sendTransactionalEmail } from '@/lib/transactional-email'

async function customerEmail(ownerUserId: string, billingEmail: string | null) {
  if (billingEmail) return billingEmail.trim().toLowerCase()
  return verifiedAuthUserEmail(ownerUserId)
}

export async function deliverSupportEmail(input: {
  ticketId: string
  kind: SupportEmailKind
  referenceKey: string
  messageId?: string | null
}) {
  const context = await withSystemTransaction(async (db) => {
    const ticket = await db.query.supportTickets.findFirst({ where: eq(supportTickets.id, input.ticketId) })
    if (!ticket) throw new NonRetryableJobError('Ticket support introuvable.')
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, ticket.workspaceId) })
    const supportMessage = input.messageId
      ? await db.query.supportMessages.findFirst({ where: and(eq(supportMessages.id, input.messageId), eq(supportMessages.ticketId, ticket.id)) })
      : undefined
    if (!workspace || workspace.accessState === 'deleted') throw new NonRetryableJobError('Workspace support introuvable.')
    return { ticket, workspace, supportMessage }
  })
  const forSupport = input.kind === 'new_ticket' || input.kind === 'customer_reply'
  const recipient = forSupport
    ? process.env.SUPPORT_EMAIL?.trim().toLowerCase() ?? null
    : await customerEmail(context.workspace.ownerUserId, context.workspace.billingEmail)
  if (!recipient) throw new NonRetryableJobError(forSupport ? 'SUPPORT_EMAIL absent.' : 'Aucun email client vérifié.')
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
  const email = supportEmail({
    kind: input.kind,
    locale: forSupport ? 'fr' : context.workspace.locale,
    subject: context.ticket.subject,
    workspaceName: context.workspace.name,
    message: context.supportMessage?.body,
    status: context.ticket.status,
    url: `${origin}${forSupport ? '/operations' : '/support'}`,
  })
  const idempotencyKey = `support:${context.ticket.id}:${input.kind}:${input.referenceKey}`
  const result = await sendTransactionalEmail({
    from: process.env.SUPPORT_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: recipient,
    subject: email.subject,
    html: email.html,
    idempotencyKey,
    tag: `support_${input.kind}`,
  })
  await withSystemTransaction((db) => db.insert(auditEvents).values({
    workspaceId: context.workspace.id,
    actorUserId: 'system:support-email',
    action: `support.email.${input.kind}`,
    entityType: 'support_ticket',
    entityId: context.ticket.id,
    metadata: { referenceKey: input.referenceKey, providerMessageId: result.providerMessageId },
  }))
  return { delivered: true, providerMessageId: result.providerMessageId }
}
