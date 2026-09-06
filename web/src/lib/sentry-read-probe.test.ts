import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSentryReadProbe, verifySentryProbeEvent } from './sentry-read-probe'

const now = new Date('2026-09-07T00:00:00Z')
const expected = { eventId: 'b'.repeat(32), projectId: '123', target: 'public', release: 'a'.repeat(40) }
const event = { eventID: expected.eventId, projectID: '123', release: { version: expected.release }, dateCreated: now.toISOString(),
  tags: [{ key: 'environment', value: 'public' }, { key: 'ads_by_yodev_drill', value: 'ads-by-yodev-sentry-drill-123' }],
  title: 'Fixture [REDACTED_API_KEY]',
}
describe('Sentry existing-evidence probe', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('verifies project, environment, commit, timestamp and synthetic redaction together', () => {
    expect(verifySentryProbeEvent(event, expected, now)).toMatchObject({ eventId: expected.eventId, redactionVerified: true })
    for (const patch of [
      { projectID: 'other' }, { eventID: 'c'.repeat(32) }, { release: { version: 'old' } },
      { environment: 'staging' }, { dateCreated: '2026-09-01T00:00:00Z' }, { dateCreated: '2026-09-08T00:00:00Z' },
      { title: 'ya_live_syntheticredactionmarker' }, { title: 'sentry-drill-person@example.invalid' }, { title: 'no marker' }, { tags: [] },
    ]) expect(() => verifySentryProbeEvent({ ...event, ...patch }, expected, now)).toThrow()
  })
  it('only performs a GET on the EU project event endpoint, without emitting any event', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(event))
    vi.stubGlobal('fetch', request)
    await expect(runSentryReadProbe({
      SENTRY_VERIFICATION_EVENT_ID: expected.eventId, SENTRY_EVENT_READ_AUTH_TOKEN: 'fixture-token', SENTRY_ORG: 'org', SENTRY_PROJECT: 'ads',
      RELEASE_TARGET: expected.target, VERCEL_GIT_COMMIT_SHA: expected.release, SENTRY_API_BASE_URL: 'https://de.sentry.io', SENTRY_DSN: 'https://public@ingest.example.test/123',
    }, now)).resolves.toMatchObject({ verified: true, mode: 'read_only' })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(`https://de.sentry.io/api/0/projects/org/ads/events/${expected.eventId}/`, expect.objectContaining({ redirect: 'error', cache: 'no-store' }))
    expect(request.mock.calls[0][1].method).toBeUndefined()
  })
  it('refuses incomplete configuration before transmitting credentials', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(runSentryReadProbe({})).rejects.toThrow('configuration_missing')
    expect(request).not.toHaveBeenCalled()
  })
})
