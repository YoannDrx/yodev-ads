import { describe, expect, it } from 'vitest'
import { operationsAlertEmail, operationsAlertJob, operationsAlertJobForDeadLetter } from '@/lib/operations-alert-model'

describe('operationsAlertEmail', () => {
  it('renders an actionable subject', () => {
    expect(operationsAlertEmail({ kind: 'job_dead_letter', sourceId: 'job-1', title: 'metrics.daily_sync', description: 'Five attempts failed.', operationsUrl: 'https://example.test/operations' }).subject).toContain('dead-letter')
  })

  it('escapes operational data before email rendering', () => {
    const email = operationsAlertEmail({ kind: 'stripe_webhook_failed', sourceId: '<id>', title: '<script>', description: '<img>', operationsUrl: 'https://example.test/?a=1&b=2' })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;img&gt;')
    expect(email.html).toContain('a=1&amp;b=2')
  })

  it('builds stable deduplication keys and prevents recursive alerts', () => {
    expect(operationsAlertJob({ kind: 'stripe_webhook_failed', sourceId: 'evt_1', title: 'invoice.failed', description: 'failed' }).deduplicationKey).toBe('operations.alert:stripe_webhook_failed:evt_1')
    expect(operationsAlertJobForDeadLetter({ jobId: 'job-1', jobType: 'metrics.daily_sync', description: 'failed' })?.type).toBe('operations.alert')
    expect(operationsAlertJobForDeadLetter({ jobId: 'job-2', jobType: 'operations.alert', description: 'failed' })).toBeNull()
  })
})
