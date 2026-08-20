import { describe, expect, it } from 'vitest'
import { lifecycleEmail, trialLifecycleDue } from '@/lib/lifecycle-email-model'

describe('lifecycleEmail', () => {
  it('renders localized lifecycle content', () => {
    expect(lifecycleEmail({
      kind: 'trial_day_12',
      locale: 'en',
      workspaceName: 'Studio',
      appUrl: 'https://ads.example.test/billing',
    }).subject).toBe('Your trial ends soon')
  })

  it('escapes tenant content and URLs', () => {
    const email = lifecycleEmail({
      kind: 'welcome',
      locale: 'fr',
      workspaceName: '<img src=x onerror=alert(1)>',
      appUrl: 'https://example.test/?a=1&b=2',
    })
    expect(email.html).not.toContain('<img')
    expect(email.html).toContain('&lt;img')
    expect(email.html).toContain('a=1&amp;b=2')
  })

  it.each([
    ['fr', 'Date concernée', 'Europe/Paris'],
    ['en', 'Relevant date', 'UTC'],
  ])('renders an effective date in %s', (locale, label, timezone) => {
    const email = lifecycleEmail({
      kind: 'cancellation_scheduled',
      locale,
      workspaceName: 'Agency & Co',
      appUrl: 'https://ads.example.test/billing',
      effectiveAt: new Date('2026-09-16T12:00:00.000Z'),
      timezone,
    })
    expect(email.html).toContain(label)
    expect(email.html).toContain('Agency &amp; Co')
  })
})

describe('trialLifecycleDue', () => {
  const started = new Date('2026-08-01T10:00:00.000Z')
  const ends = new Date('2026-08-15T10:00:00.000Z')

  it('returns cumulative idempotent reminders at day 12', () => {
    expect(trialLifecycleDue({
      accessState: 'trial',
      trialStartedAt: started,
      trialEndsAt: ends,
      now: new Date('2026-08-13T10:00:00.000Z'),
    })).toEqual(['welcome', 'trial_day_7', 'trial_day_12'])
  })

  it('returns only expiration after the trial boundary', () => {
    expect(trialLifecycleDue({
      accessState: 'trial',
      trialStartedAt: started,
      trialEndsAt: ends,
      now: ends,
    })).toEqual(['trial_expired'])
  })

  it('does not send onboarding reminders to a suspended repeated trial', () => {
    expect(trialLifecycleDue({
      accessState: 'suspended',
      trialStartedAt: started,
      trialEndsAt: ends,
      now: new Date('2026-08-08T10:00:00.000Z'),
    })).toEqual([])
  })

  it.each([
    ['2026-08-01T10:00:00.000Z', ['welcome']],
    ['2026-08-08T10:00:00.000Z', ['welcome', 'trial_day_7']],
    ['2026-08-12T23:59:59.000Z', ['welcome', 'trial_day_7']],
  ])('returns the cumulative reminders due at %s', (date, expected) => {
    expect(trialLifecycleDue({ accessState: 'trial', trialStartedAt: started, trialEndsAt: ends, now: new Date(date) }))
      .toEqual(expected)
  })
})
