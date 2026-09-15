import { describe, expect, it, vi } from 'vitest'
import { buildClientReportModel, clientReportCsv } from '@/lib/client-report-model'
import { createClientReportPdf } from '@/lib/client-report-pdf'
import { workspaceAccessAllowsPath, workspaceLifecycleAllowsPermission } from '@/lib/workspace-access'

const jobMocks = vi.hoisted(() => ({ claim: vi.fn(), complete: vi.fn(), monitor: vi.fn() }))
vi.mock('@/lib/jobs', async (original) => ({
  ...await original<typeof import('@/lib/jobs')>(),
  claimNextJob: jobMocks.claim, completeJob: jobMocks.complete,
}))
vi.mock('@/lib/run-monitoring', () => ({ runWorkspaceMonitoring: jobMocks.monitor }))
import { runAvailableJobs } from '@/lib/job-runner'

const base = { brandName: 'Audit', clientName: 'Client', currencyCode: 'EUR', campaigns: [] }

describe('Temporary audit reproductions: assertions document existing defects, not desired behavior', () => {
  it.each([7, 90])('rejects the %i-day period accepted by the report form and action', (periodDays) => {
    expect(() => buildClientReportModel({ ...base, periodDays })).toThrow('période')
  })
  it('allows a grace history route but denies the permission required by that page', () => {
    expect(workspaceAccessAllowsPath('grace', '/history')).toBe(true)
    expect(workspaceLifecycleAllowsPermission('grace', 'portfolio:read')).toBe(false)
  })
  it('rejects a legitimate campaign/client name containing an emoji when exporting PDF', async () => {
    await expect(createClientReportPdf(buildClientReportModel({ ...base, clientName: 'Client 🚀' }))).rejects.toThrow(/WinAnsi cannot encode/)
  })
  it('preserves a spreadsheet formula in a user-controlled CSV text field', () => {
    const csv = clientReportCsv(buildClientReportModel({ ...base, editorialComment: '=1+1' }))
    expect(csv).toContain('"editorial_comment","=1+1"')
  })
  it('ignores English locale in PDF labels', async () => {
    const { PDFPage } = await import('pdf-lib')
    const draw = vi.spyOn(PDFPage.prototype, 'drawText')
    try {
      await createClientReportPdf(buildClientReportModel({ ...base, locale: 'en' }))
      expect(draw.mock.calls.map(([text]) => text)).toContain('Investissement')
      expect(draw.mock.calls.map(([text]) => text)).toContain('Detail des campagnes')
    } finally { draw.mockRestore() }
  })
  it('allows one provider job to run beyond both the worker budget and the 60s route ceiling', async () => {
    vi.useFakeTimers()
    vi.stubEnv('GOOGLE_READS_ENABLED', '1')
    vi.stubEnv('NOTIFICATIONS_ENABLED', '1')
    try {
      jobMocks.claim.mockResolvedValueOnce({
        id: 'audit-job', type: 'monitoring.scan', payload: { workspaceId: '00000000-0000-4000-8000-000000000001' },
      }).mockResolvedValue(null)
      jobMocks.complete.mockResolvedValue(true)
      jobMocks.monitor.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({}), 70_000)))
      const resultPromise = runAvailableJobs({ workerId: 'audit', maximumRuntimeMs: 45_000 })
      await vi.advanceTimersByTimeAsync(70_000)
      const result = await resultPromise
      expect(result.durationMs).toBe(70_000)
      expect(result.results[0].status).toBe('completed')
    } finally { vi.useRealTimers(); vi.unstubAllEnvs() }
  })
})
