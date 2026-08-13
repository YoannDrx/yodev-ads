import 'dotenv/config'

import type Stripe from 'stripe'
import { and, eq, inArray } from 'drizzle-orm'
import {
  approvalRequests,
  approvalVotes,
  clients,
  deletionRequests,
  jobAttempts,
  jobs,
  notificationChannels,
  stripeWebhookEvents,
  workspaceDeletionTombstones,
  workspaces,
} from '../src/db/schema'
import { withPurgeTransaction, withSystemTransaction } from '../src/db/transactions'
import { entitlementContext } from '../src/lib/entitlements'
import { voteAndClaimGoogleApproval } from '../src/lib/google-approval-management'
import { claimNextJob, completeJob, enqueueJob } from '../src/lib/jobs'
import { processStripeWebhookEvent } from '../src/lib/stripe-webhook-service'
import { createWorkspaceNotificationChannel } from '../src/lib/workspace-security-resources'

const workspaceId = '40000000-0000-4000-8000-000000000010'
const approvalClientId = '40000000-0000-4000-8000-000000000011'
const quotaWorkspaceId = '60000000-0000-4000-8000-000000000001'
const approvalId = '40000000-0000-4000-8000-000000000001'
const purgeWorkspaceId = '50000000-0000-4000-8000-000000000001'
const purgeClientId = '50000000-0000-4000-8000-000000000002'
const purgeRequestId = '50000000-0000-4000-8000-000000000003'
const jobKey = 'integration:concurrency:job-lease'
const stripeEventId = 'evt_integration_concurrency'
const channelLabels = ['Integration quota A', 'Integration quota B']
const tombstoneHash = 'integration-concurrency-tombstone'

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function cleanup() {
  await withSystemTransaction(async (db) => {
    await db.delete(workspaces).where(eq(workspaces.id, quotaWorkspaceId))
    await db.delete(approvalRequests).where(eq(approvalRequests.id, approvalId))
    const oldJobs = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.deduplicationKey, jobKey))
    if (oldJobs.length > 0) await db.delete(jobs).where(inArray(jobs.id, oldJobs.map((job) => job.id)))
    await db.delete(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, stripeEventId))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, purgeWorkspaceId))
  })
  await withPurgeTransaction((db) => db.delete(workspaceDeletionTombstones).where(
    eq(workspaceDeletionTombstones.workspaceHash, tombstoneHash),
  ))
}

async function seedConcurrencyFixture() {
  await withSystemTransaction(async (db) => {
    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: 'integration-concurrency-owner',
      name: 'Integration concurrency',
      slug: 'integration-concurrency',
      plan: 'solo',
      accessState: 'active',
    })
    await db.insert(clients).values({
      id: approvalClientId,
      workspaceId,
      googleCustomerId: '4000000010',
      name: 'Concurrency client',
    })
  })
}

async function verifyConcurrentQuota() {
  await withSystemTransaction((db) => db.insert(workspaces).values({
    id: quotaWorkspaceId,
    ownerUserId: 'integration-quota-owner',
    name: 'Integration quota',
    slug: 'integration-quota',
    plan: 'solo',
    accessState: 'active',
  }))
  const requests = channelLabels.map((label, index) => createWorkspaceNotificationChannel({
    workspaceId: quotaWorkspaceId,
    actorUserId: `integration-quota-${index + 1}`,
    kind: 'email',
    label,
    destination: `quota-${index + 1}@example.test`,
    minimumSeverity: 'warning',
    entitlements: entitlementContext('active', 'solo'),
  }))
  const results = await Promise.allSettled(requests)
  const fulfilled = results.filter((result) => result.status === 'fulfilled').length
  const quotaRejected = results.filter((result) => result.status === 'rejected' && /Quota exceeded/.test(String(result.reason))).length
  const otherRejected = results.length - fulfilled - quotaRejected
  invariant(
    fulfilled === 1,
    `Concurrent quota allowed more or fewer than one channel (fulfilled=${fulfilled}, quotaRejected=${quotaRejected}, otherRejected=${otherRejected})`,
  )
  invariant(
    quotaRejected === 1,
    `Concurrent quota did not fail closed (fulfilled=${fulfilled}, quotaRejected=${quotaRejected}, otherRejected=${otherRejected})`,
  )
  const rows = await withSystemTransaction((db) => db.select({ id: notificationChannels.id }).from(notificationChannels).where(
    and(eq(notificationChannels.workspaceId, quotaWorkspaceId), inArray(notificationChannels.label, channelLabels)),
  ))
  invariant(rows.length === 1, 'Concurrent quota persistence count is not one')
}

async function verifyApprovalClaim() {
  await withSystemTransaction((db) => db.insert(approvalRequests).values({
    id: approvalId,
    workspaceId,
    clientId: approvalClientId,
    requestedBy: 'integration-requester',
    kind: 'campaign_status',
    title: 'Concurrency approval',
    payload: {},
    expectedState: { status: 'ENABLED' },
    proposedState: { status: 'PAUSED' },
    expectedStateHash: 'integration-state-hash',
    requiredApprovals: 1,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  }))
  const vote = (actorUserId: string) => voteAndClaimGoogleApproval({
    workspaceId,
    actorUserId,
    approvalId,
    allowSelfApproval: true,
    assertKindAllowed: (kind) => invariant(kind === 'campaign_status', 'Unexpected approval kind'),
  })
  const results = await Promise.allSettled([vote('integration-approver-a'), vote('integration-approver-b')])
  invariant(results.filter((result) => result.status === 'fulfilled' && result.value.outcome === 'claimed').length === 1, 'Approval was not claimed exactly once')
  invariant(results.filter((result) => result.status === 'rejected' && /déjà été traitée/.test(String(result.reason))).length === 1, 'Competing approver was not rejected')
  const { approval, votes } = await withSystemTransaction(async (db) => ({
    approval: await db.query.approvalRequests.findFirst({ where: eq(approvalRequests.id, approvalId) }),
    votes: await db.select().from(approvalVotes).where(eq(approvalVotes.approvalId, approvalId)),
  }))
  invariant(approval?.status === 'executing' && approval.executionState === 'claimed', 'Approval claim state is inconsistent')
  invariant(votes.length === 1, 'Approval persisted more than one winning vote')
}

async function verifyJobLease() {
  const { job } = await enqueueJob({
    workspaceId,
    type: 'retention.run',
    payload: {},
    priority: 1,
    deduplicationKey: jobKey,
  })
  const results = await Promise.all([
    claimNextJob('integration-worker-a', new Date(), 5 * 60_000),
    claimNextJob('integration-worker-b', new Date(), 5 * 60_000),
  ])
  const claimed = results.filter((candidate): candidate is NonNullable<typeof candidate> => candidate?.id === job.id)
  invariant(claimed.length === 1, 'A durable job was not leased exactly once')
  invariant(await completeJob(claimed[0], claimed[0].leaseOwner!), 'The winning worker could not complete its lease')
  const attempts = await withSystemTransaction((db) => db.select().from(jobAttempts).where(eq(jobAttempts.jobId, job.id)))
  invariant(attempts.length === 1 && attempts[0].state === 'completed', 'Job attempt evidence is inconsistent')
}

async function verifyStripeIdempotence() {
  const event = {
    id: stripeEventId,
    type: 'account.updated',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  } as Stripe.Event
  const results = await Promise.all([processStripeWebhookEvent(event), processStripeWebhookEvent(event)])
  invariant(results.filter((result) => result.duplicate === true).length === 1, 'Stripe replay was not deduplicated exactly once')
  const events = await withSystemTransaction((db) => db.select().from(stripeWebhookEvents).where(
    eq(stripeWebhookEvents.eventId, stripeEventId),
  ))
  invariant(events.length === 1 && events[0].status === 'processed', 'Stripe idempotency row is inconsistent')
}

async function verifyPurgeClaimAndCascade() {
  const now = new Date()
  await withSystemTransaction(async (db) => {
    await db.insert(workspaces).values({
      id: purgeWorkspaceId,
      ownerUserId: 'integration-owner',
      name: 'Integration purge',
      slug: 'integration-purge',
      plan: 'solo',
      accessState: 'deletion_pending',
      deletionRequestedAt: now,
      purgeAt: new Date(now.getTime() - 60_000),
    })
    await db.insert(clients).values({
      id: purgeClientId,
      workspaceId: purgeWorkspaceId,
      googleCustomerId: '5000000001',
      name: 'Cascade client',
    })
    await db.insert(deletionRequests).values({
      id: purgeRequestId,
      workspaceId: purgeWorkspaceId,
      requestedBy: 'integration-owner',
      previousAccessState: 'active',
      status: 'pending',
      requestedAt: now,
      purgeAt: new Date(now.getTime() - 60_000),
    })
  })
  const claim = () => withPurgeTransaction((db) => db.update(deletionRequests).set({ status: 'purging' }).where(and(
    eq(deletionRequests.workspaceId, purgeWorkspaceId),
    eq(deletionRequests.status, 'pending'),
  )).returning({ id: deletionRequests.id }))
  const claims = await Promise.all([claim(), claim()])
  invariant(claims.filter((rows) => rows.length === 1).length === 1, 'Deletion request was not claimed exactly once')
  await withPurgeTransaction(async (db) => {
    await db.insert(workspaceDeletionTombstones).values({
      workspaceHash: tombstoneHash,
      deletionRequestedAt: now,
      retainUntil: new Date(now.getTime() + 365 * 24 * 60 * 60_000),
    })
    await db.delete(workspaces).where(eq(workspaces.id, purgeWorkspaceId))
  })
  const evidence = await withSystemTransaction(async (db) => ({
    workspace: await db.query.workspaces.findFirst({ where: eq(workspaces.id, purgeWorkspaceId) }),
    client: await db.query.clients.findFirst({ where: eq(clients.id, purgeClientId) }),
    request: await db.query.deletionRequests.findFirst({ where: eq(deletionRequests.id, purgeRequestId) }),
  }))
  const tombstone = await withPurgeTransaction((db) => db.query.workspaceDeletionTombstones.findFirst({
    where: eq(workspaceDeletionTombstones.workspaceHash, tombstoneHash),
  }))
  invariant(!evidence.workspace && !evidence.client && !evidence.request, 'Workspace purge did not cascade operational data')
  invariant(tombstone, 'Workspace purge did not preserve its deletion tombstone')
}

async function main() {
  // The verifier owns and removes all encrypted fixture rows. Always use its
  // deterministic test key so a Vercel Sensitive placeholder cannot be
  // mistaken for a usable production encryption key after `vercel env pull`.
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
  await cleanup()
  try {
    await seedConcurrencyFixture()
    await verifyConcurrentQuota()
    await verifyApprovalClaim()
    await verifyJobLease()
    await verifyStripeIdempotence()
    await verifyPurgeClaimAndCascade()
    console.log(JSON.stringify({
      ok: true,
      verified: ['concurrent_quota', 'approval_claim', 'job_lease', 'stripe_idempotence', 'purge_claim_and_cascade'],
    }))
  } finally {
    await cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
