import { describe, expect, it } from 'vitest'
import { gettingStartedSteps, type GettingStartedAccess } from './getting-started-model'
import type { GettingStartedEvidence } from './getting-started-data'

const empty: GettingStartedEvidence = { connected: false, hasAdvertiser: false, selectedClientId: null, hasGoal: false, monitorEnabled: false, hasAnalysis: false, hasPublishedReport: false, legalAccepted: false }
const allowed = { allowed: true } as const
const access: GettingStartedAccess = { settings: allowed, google: allowed, accounts: allowed, goal: allowed, monitor: allowed, report: allowed, legal: allowed }

describe('guided setup', () => {
  it.each([false, true])('distinguishes inventory from selection and keeps commercial setup outside product progress (English=%s)', (english) => {
    const steps = gettingStartedSteps({ ...empty, hasAdvertiser: true }, access, english, false)
    expect(steps.find((step) => step.key === 'inventory')?.complete).toBe(true)
    expect(steps.find((step) => step.key === 'selection')?.complete).toBe(false)
    expect(steps.find((step) => step.key === 'analysis')?.href).toBe('/accounts')
    expect(steps.find((step) => step.key === 'report')?.complete).toBe(false)
    expect(steps.find((step) => step.key === 'legal')?.required).toBe(false)
    expect(steps.filter((step) => step.required)).toHaveLength(8)
    expect(steps.every((step) => !step.href || step.href.startsWith('/'))).toBe(true)
  })

  it('describes missing evidence as an action rather than an existing connection or publication', () => {
    const steps = gettingStartedSteps(empty, access, true, false)
    expect(steps.find((step) => step.key === 'google')?.description).toBe('Connect Google Ads with an authorized account to start collecting data.')
    expect(steps.find((step) => step.key === 'analysis')?.description).toMatch(/^Open an analysis/)
    expect(steps.find((step) => step.key === 'report')?.description).toMatch(/^Publish a report edition/)
    expect(steps.find((step) => step.key === 'legal')?.description).toMatch(/must be accepted/)
  })

  it.each(['role', 'lifecycle', 'plan', 'disabled'] as const)('provides a recovery explanation without a prohibited target for %s', (reason) => {
    const denied = Object.fromEntries(Object.keys(access).map((key) => [key, { allowed: false, reason }])) as GettingStartedAccess
    const steps = gettingStartedSteps(empty, denied, true, false)
    for (const key of ['google', 'inventory', 'selection', 'goal', 'monitor', 'report', 'legal']) {
      const step = steps.find((item) => item.key === key)!
      expect(step.href).toBeNull()
      expect(step.help).toMatch(/authorized member|temporarily unavailable|current access/)
    }
  })

  it('retains qualified historical achievements while describing current availability separately', () => {
    const steps = gettingStartedSteps({ ...empty, selectedClientId: 'chosen', hasAnalysis: true, hasPublishedReport: true, monitorEnabled: true }, access, true, false)
    expect(steps.find((step) => step.key === 'analysis')).toMatchObject({ complete: true, href: '/analysis?client=chosen' })
    expect(steps.find((step) => step.key === 'report')?.description).toMatch(/historical milestone/)
    expect(steps.find((step) => step.key === 'monitor')?.help).toMatch(/execution requires an active connection/)
    expect(steps.find((step) => step.key === 'google')?.complete).toBe(false)
  })
})
