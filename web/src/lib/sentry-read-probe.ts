import 'server-only'

import { z } from 'zod'
import { workSignal } from '@/lib/work-deadline'

const eventSchema = z.object({
  eventID: z.string(), projectID: z.string(), dateCreated: z.string(),
  environment: z.string().optional(),
  release: z.union([z.string(), z.object({ version: z.string() })]),
  tags: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
}).passthrough()

export function verifySentryProbeEvent(raw: unknown, expected: { eventId: string; projectId: string; target: string; release: string }, now = new Date()) {
  const parsed = eventSchema.safeParse(raw)
  if (!parsed.success) throw new Error('sentry.invalid_evidence')
  const event = parsed.data
  const tags = Object.fromEntries(event.tags.map(({ key, value }) => [key, value]))
  const release = typeof event.release === 'string' ? event.release : event.release.version
  if (event.eventID !== expected.eventId || event.projectID !== expected.projectId || release !== expected.release || (event.environment ?? tags.environment) !== expected.target) throw new Error('sentry.identity_mismatch')
  const createdAt = new Date(event.dateCreated).getTime()
  if (!Number.isFinite(createdAt) || createdAt > now.getTime() + 60_000 || createdAt < now.getTime() - 24 * 3_600_000) throw new Error('sentry.stale_evidence')
  const serialized = JSON.stringify(raw)
  if (!tags.ads_by_yodev_drill?.startsWith('ads-by-yodev-sentry-drill-') || !serialized.includes('[REDACTED_API_KEY]') || serialized.includes('sentry-drill-person@example.invalid') || serialized.includes('ya_live_syntheticredactionmarker')) throw new Error('sentry.redaction_not_verified')
  return { eventId: event.eventID, evidenceCreatedAt: event.dateCreated, redactionVerified: true }
}

/** Retrieve existing evidence; never emit a new synthetic event in this probe. */
export async function runSentryReadProbe(env: Record<string, string | undefined> = process.env, now = new Date()) {
  const eventId = env.SENTRY_VERIFICATION_EVENT_ID
  const token = env.SENTRY_EVENT_READ_AUTH_TOKEN
  const org = env.SENTRY_ORG
  const project = env.SENTRY_PROJECT
  const target = env.RELEASE_TARGET
  const release = env.VERCEL_GIT_COMMIT_SHA ?? env.NEXT_PUBLIC_RELEASE_SHA
  if (!eventId || !/^[a-f0-9]{32}$/i.test(eventId) || !token || !org || !project || !target || !release || env.SENTRY_API_BASE_URL !== 'https://de.sentry.io') throw new Error('sentry.probe_configuration_missing')
  let projectId: string
  try { projectId = new URL(env.SENTRY_DSN ?? '').pathname.split('/').filter(Boolean).at(-1)! } catch { throw new Error('sentry.probe_configuration_missing') }
  if (!/^\d+$/.test(projectId ?? '')) throw new Error('sentry.probe_configuration_missing')
  // Sentry's project event API exposes eventID, projectID, dateCreated and
  // release.version: https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/
  const response = await fetch(`https://de.sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/events/${eventId}/`, {
    headers: { authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store', signal: workSignal(10_000),
  })
  if (!response.ok) throw new Error('sentry.evidence_unavailable')
  const evidence = verifySentryProbeEvent(await response.json(), { eventId, projectId, target, release }, now)
  return { verified: true, mode: 'read_only', ...evidence }
}
