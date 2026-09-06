import 'server-only'

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { alertIncidents, auditEvents, jobs, notificationChannels, notificationDeliveries, transactionalEmailDeliveries } from '@/db/schema'
import { withSystemTransaction } from '@/db/transactions'
import { MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS, notificationEmailBusinessKey } from '@/lib/notification-delivery-model'
import { operationsAlertJob } from '@/lib/operations-alert-model'

const logicalEmailKey = sql`coalesce(${notificationDeliveries.payload}->>'deliveryKey', ${notificationDeliveries.eventKey})`
const storedEmailKey = sql`case when length(${logicalEmailKey}) <= 128 then ${logicalEmailKey} else 'yda:' || encode(sha256(convert_to(${logicalEmailKey}, 'UTF8')), 'hex') end`
const acceptedEmailExists = sql`${notificationDeliveries.payload}->>'deliveryKey' is not null and exists (select 1 from transactional_email_deliveries evidence where evidence.workspace_id = ${notificationDeliveries.workspaceId} and evidence.business_key = ${storedEmailKey} and evidence.status in ('accepted', 'sent', 'delivered') and evidence.provider_message_id is not null)`

/** Bounded recovery; no provider call or implicit replay of a non-idempotent transport. */
export async function recoverNotificationDeliveries(now = new Date(), limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid notification recovery limit')
  return withSystemTransaction(async (db) => {
    const expired = await db.select({ delivery: notificationDeliveries, kind: notificationChannels.kind })
      .from(notificationDeliveries)
      .innerJoin(notificationChannels, and(eq(notificationChannels.id, notificationDeliveries.channelId), eq(notificationChannels.workspaceId, notificationDeliveries.workspaceId)))
      .where(or(and(eq(notificationDeliveries.status, 'sending'), or(lte(notificationDeliveries.leaseExpiresAt, now),
        and(isNull(notificationDeliveries.leaseExpiresAt), lte(notificationDeliveries.createdAt, new Date(now.getTime() - 5 * 60_000))))),
      and(eq(notificationDeliveries.status, 'ambiguous'), eq(notificationChannels.kind, 'email'), acceptedEmailExists)))
      .orderBy(asc(notificationDeliveries.leaseExpiresAt), asc(notificationDeliveries.id)).limit(limit).for('update', { skipLocked: true })
    let reconciled = 0
    let ambiguous = 0
    for (const { delivery, kind } of expired) {
      const deliveryKey = typeof delivery.payload.deliveryKey === 'string' ? delivery.payload.deliveryKey : undefined
      // Legacy event keys were shared between channels, so their receipt alone
      // cannot prove which channel was accepted. Leave that ambiguity for review.
      const email = kind === 'email' && deliveryKey ? await db.query.transactionalEmailDeliveries.findFirst({
        where: and(eq(transactionalEmailDeliveries.workspaceId, delivery.workspaceId),
          eq(transactionalEmailDeliveries.businessKey, notificationEmailBusinessKey(delivery.eventKey, deliveryKey))),
      }) : undefined
      const accepted = email?.providerMessageId && ['accepted', 'sent', 'delivered'].includes(email.status) ? email : null
      const knownUnsent = delivery.leaseExpiresAt !== null && !delivery.dispatchStartedAt
      const status = accepted ? 'accepted' : knownUnsent
        ? delivery.attemptCount < MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS ? 'retrying' : 'dead_letter'
        : 'ambiguous'
      const acceptedAt = accepted?.acceptedAt ?? accepted?.updatedAt ?? now
      await db.update(notificationDeliveries).set({
        status, leaseExpiresAt: null, nextAttemptAt: status === 'retrying' ? now : null,
        terminalAt: status === 'accepted' ? acceptedAt : status === 'dead_letter' ? now : null,
        providerMessageId: accepted?.providerMessageId ?? delivery.providerMessageId,
        errorMessage: status === 'accepted' ? null : 'Notification worker lease expired before completion was recorded.',
      }).where(eq(notificationDeliveries.id, delivery.id))
      if (status === 'accepted') {
        reconciled += 1
        if (delivery.incidentId) await db.update(alertIncidents).set({ lastNotifiedAt: sql`greatest(${alertIncidents.lastNotifiedAt}, ${acceptedAt})`, updatedAt: now })
          .where(and(eq(alertIncidents.id, delivery.incidentId), eq(alertIncidents.workspaceId, delivery.workspaceId)))
        await db.update(notificationChannels).set({
          lastDeliveredAt: sql`greatest(${notificationChannels.lastDeliveredAt}, ${acceptedAt})`,
          lastError: sql`case when ${notificationChannels.updatedAt} <= ${acceptedAt} then null else ${notificationChannels.lastError} end`,
          updatedAt: sql`greatest(${notificationChannels.updatedAt}, ${now})`,
        }).where(and(eq(notificationChannels.id, delivery.channelId), eq(notificationChannels.workspaceId, delivery.workspaceId)))
      }
      if (status === 'ambiguous' || status === 'dead_letter') {
        if (status === 'ambiguous') ambiguous += 1
        await db.insert(jobs).values(operationsAlertJob({ kind: 'notification_delivery_failed', sourceId: delivery.id,
          title: `Notification ${status}`, description: 'An interrupted notification requires transport reconciliation before any resend.',
        })).onConflictDoNothing({ target: jobs.deduplicationKey })
      }
      await db.insert(auditEvents).values({ workspaceId: delivery.workspaceId, actorUserId: 'system:notification-recovery',
        action: 'notification.lease_expired', entityType: 'notification_delivery', entityId: delivery.id,
        metadata: { attempt: delivery.attemptCount, status, kind },
      })
    }
    // Recover deliveries created by older code before a retry job was persisted.
    const orphaned = await db.select().from(notificationDeliveries).where(and(
      inArray(notificationDeliveries.status, ['queued', 'retrying']),
      or(isNull(notificationDeliveries.nextAttemptAt), lte(notificationDeliveries.nextAttemptAt, now)),
      sql`not exists (select 1 from jobs pending where pending.type = 'notification.deliver' and pending.payload->>'deliveryId' = ${notificationDeliveries.id}::text and pending.status in ('queued', 'retrying', 'running'))`,
    )).orderBy(asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id)).limit(limit).for('update', { skipLocked: true })
    for (const delivery of orphaned) await db.insert(jobs).values({
      workspaceId: delivery.workspaceId, type: 'notification.deliver', payload: { deliveryId: delivery.id }, availableAt: now,
      priority: delivery.payload.severity === 'critical' ? 20 : 70,
      deduplicationKey: `notification.recovery:${delivery.id}:${delivery.attemptCount}`,
      maximumAttempts: MAXIMUM_NOTIFICATION_DELIVERY_ATTEMPTS,
    }).onConflictDoNothing({ target: jobs.deduplicationKey })
    return { recovered: expired.length, reconciled, ambiguous, orphaned: orphaned.length }
  })
}
