import { describe, expect, it, vi } from 'vitest'
import { reportPeriodSchema, unsupportedReportPeriodMessage } from './report-period'
import { createWorkspaceReportTemplate, updateWorkspaceReportTemplate } from './report-management'
import { createWorkspacePublicReport } from './public-report-workflows'
import { entitlementContext } from './entitlements'

vi.mock('@/db/transactions', () => ({ withTenantTransaction: vi.fn(() => { throw new Error('Unexpected database access') }) }))

describe('report creation period boundary', () => {
  it.each([7, 90, 0, -1, 30.5])('rejects unsupported period %s before persisting anything', (periodDays) => {
    expect(() => reportPeriodSchema.parse(periodDays)).toThrow()
    const input = { workspaceId: 'workspace', actorUserId: 'actor', name: 'Report', locale: 'fr' as const, periodDays }
    expect(() => createWorkspaceReportTemplate(input)).toThrow('pas prise en charge')
    expect(() => updateWorkspaceReportTemplate({ ...input, templateId: 'template', expectedVersion: 1 })).toThrow('pas prise en charge')
    expect(() => createWorkspacePublicReport({ ...input, clientId: 'client', label: 'Report', token: 'token', entitlements: entitlementContext('active', 'solo'), fallbackOrigin: 'https://example.test' })).toThrow('pas prise en charge')
  })
  it('accepts form values and explains legacy failures in both languages', () => {
    expect(reportPeriodSchema.parse('30')).toBe(30)
    expect(unsupportedReportPeriodMessage('en')).toContain('30-day')
    expect(unsupportedReportPeriodMessage('fr')).toContain('30 jours')
  })
})
