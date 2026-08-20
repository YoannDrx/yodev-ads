import 'server-only'

import { eq } from 'drizzle-orm'
import { auditEvents, workspaces } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { NonRetryableJobError } from '@/lib/jobs'
import { lifecycleEmail, type LifecycleEmailKind } from '@/lib/lifecycle-email-model'
import { verifiedAuthUserEmail } from '@/lib/auth-identities'
import { sendTransactionalEmail } from '@/lib/transactional-email'

async function verifiedOwnerEmail(ownerUserId: string) {
  return verifiedAuthUserEmail(ownerUserId)
}

export async function deliverLifecycleEmail(input: {
  workspaceId: string
  kind: LifecycleEmailKind
  referenceKey: string
  effectiveAt?: Date | null
}) {
  const workspace = await withSystemTransaction((db) => db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  }))
  if (!workspace || workspace.accessState === 'deleted') throw new NonRetryableJobError('Workspace lifecycle introuvable.')
  const recipient = workspace.billingEmail?.trim().toLowerCase() || await verifiedOwnerEmail(workspace.ownerUserId)
  if (!recipient) throw new NonRetryableJobError('Aucun email propriétaire vérifié pour cet espace.')

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ads.yodev.fr'
  const billingKinds: LifecycleEmailKind[] = [
    'trial_day_12',
    'trial_expired',
    'payment_failed',
    'refund_processed',
    'cancellation_scheduled',
    'deletion_scheduled',
    'deletion_cancelled',
  ]
  const email = lifecycleEmail({
    kind: input.kind,
    locale: workspace.locale,
    workspaceName: workspace.name,
    appUrl: `${origin}${billingKinds.includes(input.kind) ? '/billing' : '/getting-started'}`,
    effectiveAt: input.effectiveAt,
    timezone: workspace.timezone,
  })
  const idempotencyKey = `lifecycle:${workspace.id}:${input.kind}:${input.referenceKey}`
  const result = await sendTransactionalEmail({
    from: process.env.LIFECYCLE_FROM_EMAIL ?? process.env.NOTIFICATION_FROM_EMAIL ?? 'Ads by Yodev <ads@yodev.fr>',
    to: recipient,
    subject: email.subject,
    html: email.html,
    idempotencyKey,
    category: `lifecycle_${input.kind}`,
    workspaceId: workspace.id,
    referenceId: input.referenceKey,
  })

  await withSystemTransaction((db) => db.insert(auditEvents).values({
    workspaceId: workspace.id,
    actorUserId: 'system:lifecycle-email',
    action: `lifecycle.email.${input.kind}`,
    entityType: 'workspace',
    entityId: workspace.id,
    metadata: { referenceKey: input.referenceKey, providerMessageId: result.providerMessageId },
  }))
  return { delivered: true, providerMessageId: result.providerMessageId }
}
