import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildClientReportModel } from '@/lib/client-report-model'
const mocks = vi.hoisted(() => ({ share: vi.fn(), edition: vi.fn(), campaigns: vi.fn() }))
vi.mock('@/lib/data', () => ({ getPublicShare: mocks.share }))
vi.mock('@/lib/report-editions', () => ({ getPublicReportEdition: mocks.edition }))
vi.mock('@/lib/rate-limit', () => ({ consumePublicReportRateLimits: async () => ({ allowed: true }), requestIp: () => '127.0.0.1' }))
vi.mock('@/lib/google-ads', () => ({ GoogleAdsGateway: class { campaignPerformance = mocks.campaigns } }))
vi.mock('@/lib/client-report-pdf', () => ({ createClientReportPdf: async () => new Uint8Array([37, 80, 68, 70]) }))
import { GET as csv } from './csv/route'
import { GET as pdf } from './pdf/route'
beforeEach(() => { vi.clearAllMocks(); mocks.edition.mockReset() })
function context(periodDays: number) {
  return { share: { id: 'share', workspaceId: 'workspace', periodDays, locale: 'en' }, client: { googleCustomerId: '123', name: '=1+1', currencyCode: 'EUR' }, workspace: { plan: 'solo', brandName: 'Test' } }
}
const request = new Request('https://example.test/r/secret/csv?edition=edition-1')
const params = { params: Promise.resolve({ token: 'secret' }) }
describe('public report downloads', () => {
  it.each([7, 30, 90])('returns the persisted edition for a %s-day report without Google access', async (days) => {
    mocks.share.mockResolvedValue(context(days))
    const through = '2026-08-31'
    const from = new Date(Date.parse(`${through}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
    mocks.edition.mockResolvedValue({ edition: { id: 'edition-1', sourceVersion: 'version-1', editionNumber: 1 }, model: buildClientReportModel({ brandName: 'Test', clientName: '=1+1', currencyCode: 'EUR', campaigns: [], window: { from, through, timezone: 'Europe/Paris' }, sourceVersion: 'version-1' }) })
    for (const download of [csv, pdf]) {
      const response = await download(request, params)
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Report-Edition')).toBe('edition-1')
      expect(response.headers.get('X-Report-Data-Version')).toBe('version-1')
      if (download === csv) { const body = await response.text(); expect(body).toContain('"\'=1+1"'); expect(body).toContain(`"period_days","${days}"`) }
    }
    expect(mocks.edition).toHaveBeenCalledWith({ workspaceId: 'workspace', shareId: 'share', editionId: 'edition-1' })
    expect(mocks.campaigns).not.toHaveBeenCalled()
  })
  it('reports unavailable coverage without exposing database details', async () => {
    mocks.share.mockResolvedValue(context(90))
    mocks.edition.mockRejectedValue(new Error('private database detail'))
    for (const download of [csv, pdf]) {
      const response = await download(request, params)
      expect(response.status).toBe(409)
      expect(await response.text()).toContain('not fully collected')
    }
  })
  it('does not reveal a revoked or unknown report', async () => {
    mocks.share.mockResolvedValue(undefined)
    expect((await csv(request, params)).status).toBe(404)
    expect((await pdf(request, params)).status).toBe(404)
    expect(mocks.edition).not.toHaveBeenCalled()
    expect(mocks.campaigns).not.toHaveBeenCalled()
  })
})
