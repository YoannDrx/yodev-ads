import { describe, expect, it } from 'vitest'
import { diagnoseConversionActions, diagnoseOfflineConversionImports, isOfflineConversionAction } from './tracking-diagnostics'

const base = {
  status: 'ENABLED', category: 'PURCHASE', origin: 'WEBSITE', actionType: 'WEBPAGE',
  primaryForGoal: true, includeInConversionsMetric: true, lastConversionAt: null, lastReceivedAt: null,
}

describe('conversion tracking diagnostics', () => {
  it('distinguishes API evidence from an on-site certification', () => {
    const findings = diagnoseConversionActions([{ ...base, resourceName: 'a', name: 'Purchase' }], new Date('2026-08-12T00:00:00Z'))
    expect(findings[0]).toMatchObject({ severity: 'critical', confidence: 'high' })
    expect(findings[0].description).toContain('ne certifie pas')
  })

  it('only labels duplicates as probable and medium confidence', () => {
    const actions = [
      { ...base, resourceName: 'a', name: 'Achat', lastReceivedAt: new Date('2026-08-11') },
      { ...base, resourceName: 'b', name: 'Àchat!', lastReceivedAt: new Date('2026-08-11') },
    ]
    expect(diagnoseConversionActions(actions).find((finding) => finding.id.startsWith('duplicate:'))).toMatchObject({
      confidence: 'medium', title: expect.stringContaining('probable'),
    })
  })

  it('recognizes offline actions but never treats a missing summary as proof of failure', () => {
    const offline = { ...base, resourceName: 'offline', name: 'CRM lead', actionType: 'UPLOAD_CLICKS', origin: 'UPLOAD' }
    expect(isOfflineConversionAction(offline)).toBe(true)
    expect(diagnoseOfflineConversionImports([offline], [])[0]).toMatchObject({ confidence: 'medium', title: 'Diagnostic offline indisponible' })
    expect(diagnoseOfflineConversionImports([offline], [])[0].description).toContain('pas une preuve')
  })

  it('surfaces Google offline upload health without offering an upload', () => {
    const offline = { ...base, resourceName: 'offline', name: 'CRM lead', actionType: 'UPLOAD_CLICKS', origin: 'UPLOAD' }
    const findings = diagnoseOfflineConversionImports([offline], [{
      uploadClient: 'GOOGLE_ADS_API', status: 'NEEDS_ATTENTION', lastUploadAt: new Date('2026-08-11'),
      totalEventCount: '100', successfulEventCount: '85', pendingEventCount: '5', successRate: '0.85',
      alerts: [{ error: 'DUPLICATE_ORDER_ID' }],
    }], new Date('2026-08-12'))
    expect(findings[0]).toMatchObject({ severity: 'critical', confidence: 'high', title: expect.stringContaining('à corriger') })
    expect(findings[0].description).toContain('n’upload aucun événement')
  })

  it('classifies disabled, stale and mismatched conversion configuration by role', () => {
    const now = new Date('2026-08-12T00:00:00Z')
    const findings = diagnoseConversionActions([
      { ...base, resourceName: 'disabled-primary', name: 'Primary', status: 'PAUSED' },
      { ...base, resourceName: 'disabled-secondary', name: 'Secondary', status: 'REMOVED', primaryForGoal: false },
      { ...base, resourceName: 'stale-primary', name: 'Stale primary', lastReceivedAt: new Date('2026-01-01') },
      { ...base, resourceName: 'stale-secondary', name: 'Stale secondary', primaryForGoal: false, includeInConversionsMetric: true, lastConversionAt: new Date('2026-01-01') },
      { ...base, resourceName: 'healthy', name: 'Healthy', lastReceivedAt: new Date('2026-08-11') },
    ], now)
    expect(findings.find((item) => item.id === 'status:disabled-primary')).toMatchObject({ severity: 'critical' })
    expect(findings.find((item) => item.id === 'status:disabled-secondary')).toMatchObject({ severity: 'warning' })
    expect(findings.find((item) => item.id === 'stale:stale-primary')).toMatchObject({ severity: 'critical' })
    expect(findings.find((item) => item.id === 'stale:stale-secondary')).toMatchObject({ severity: 'warning' })
    expect(findings.find((item) => item.id === 'goal-mismatch:stale-secondary')).toMatchObject({ severity: 'info' })
    expect(findings.some((item) => item.resourceNames.includes('healthy'))).toBe(false)
  })

  it('recognizes every offline action marker and ignores online-only actions', () => {
    expect(isOfflineConversionAction({ ...base, resourceName: 'a', name: 'a', actionType: 'STORE_SALES', origin: null })).toBe(true)
    expect(isOfflineConversionAction({ ...base, resourceName: 'b', name: 'b', actionType: null, origin: 'UPLOAD' })).toBe(true)
    expect(isOfflineConversionAction({ ...base, resourceName: 'c', name: 'c', actionType: null, origin: null })).toBe(false)
    expect(diagnoseOfflineConversionImports([{ ...base, resourceName: 'online', name: 'Online' }], [])).toEqual([])
  })

  it('classifies no-recent, stale, pending and healthy offline summaries independently', () => {
    const offline = { ...base, resourceName: 'offline', name: 'CRM lead', actionType: 'UPLOAD_CLICKS', origin: 'UPLOAD' }
    const summary = { uploadClient: 'API', status: 'ACTIVE', lastUploadAt: new Date('2026-08-11'), totalEventCount: '100', successfulEventCount: '90', pendingEventCount: '0', successRate: '0.9', alerts: [] }
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, status: 'NO_RECENT_UPLOADS' }], new Date('2026-08-12'))[0]).toMatchObject({ id: 'offline:no-recent:API' })
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, lastUploadAt: new Date('2026-08-01') }], new Date('2026-08-12'))[0]).toMatchObject({ id: 'offline:stale:API' })
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, pendingEventCount: '3' }], new Date('2026-08-12'))[0]).toMatchObject({ id: 'offline:pending:API', severity: 'info' })
    expect(diagnoseOfflineConversionImports([offline], [summary], new Date('2026-08-12'))).toEqual([])
  })

  it('localizes conversion and offline evidence in English', () => {
    const now = new Date('2026-08-12T00:00:00Z')
    const actions = [
      { ...base, resourceName: 'disabled', name: 'Primary', status: 'PAUSED' },
      { ...base, resourceName: 'stale', name: 'Stale', lastReceivedAt: new Date('2026-01-01') },
      { ...base, resourceName: 'mismatch', name: 'Mismatch', primaryForGoal: false, lastReceivedAt: new Date('2026-08-11') },
      { ...base, resourceName: 'duplicate-a', name: 'Lead', lastReceivedAt: new Date('2026-08-11') },
      { ...base, resourceName: 'duplicate-b', name: 'Léad!', lastReceivedAt: new Date('2026-08-11') },
    ]
    const findings = diagnoseConversionActions(actions, now, 'en')
    expect(findings.map((finding) => finding.title)).toEqual(expect.arrayContaining([
      expect.stringContaining('paused action'),
      expect.stringContaining('Stale activity'),
      expect.stringContaining('Bidding role and metric differ'),
      expect.stringContaining('Probable duplicate'),
    ]))

    const offline = { ...base, resourceName: 'offline', name: 'CRM lead', actionType: 'UPLOAD_CLICKS', origin: 'UPLOAD' }
    const summary = { uploadClient: 'API', status: 'ACTIVE', lastUploadAt: new Date('2026-08-11'), totalEventCount: '100', successfulEventCount: '90', pendingEventCount: '0', successRate: '0.9', alerts: [] }
    expect(diagnoseOfflineConversionImports([offline], [], now, 'en')[0].title).toBe('Offline diagnostics unavailable')
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, status: 'NEEDS_ATTENTION', alerts: [{}] }], now, 'en')[0].description).toContain('Google reports 1 error group')
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, status: 'NO_RECENT_UPLOADS' }], now, 'en')[0].title).toContain('No recent offline import')
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, lastUploadAt: new Date('2026-08-01') }], now, 'en')[0].title).toContain('Last offline import is stale')
    expect(diagnoseOfflineConversionImports([offline], [{ ...summary, pendingEventCount: '3' }], now, 'en')[0].description).toContain('still pending')
  })
})
