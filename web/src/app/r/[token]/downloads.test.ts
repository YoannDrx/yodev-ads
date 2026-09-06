import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ share: vi.fn(), campaigns: vi.fn() }))
vi.mock('@/lib/data', () => ({ getPublicShare: mocks.share }))
vi.mock('@/lib/rate-limit', () => ({ consumePublicReportRateLimits: async () => ({ allowed: true }), requestIp: () => '127.0.0.1' }))
vi.mock('@/lib/google-ads', () => ({ GoogleAdsGateway: class { campaignPerformance = mocks.campaigns } }))
vi.mock('@/lib/client-report-pdf', () => ({ createClientReportPdf: async () => new Uint8Array([37, 80, 68, 70]) }))

import { GET as csv } from './csv/route'
import { GET as pdf } from './pdf/route'

beforeEach(() => vi.clearAllMocks())

function context(periodDays: number) {
  return {
    share: { workspaceId: 'workspace', periodDays, locale: 'en' }, connection: {},
    client: { googleCustomerId: '123', name: '=1+1', currencyCode: 'EUR' },
    workspace: { plan: 'solo', brandName: 'Test' },
  }
}
const request = new Request('https://example.test/r/secret/csv')
const params = { params: Promise.resolve({ token: 'secret' }) }

describe('public report downloads', () => {
  it.each([7, 90])('returns an explicit conflict for a legacy %s-day report without calling Google', async (days) => {
    mocks.share.mockResolvedValue(context(days))
    for (const download of [csv, pdf]) {
      const response = await download(request, params)
      expect(response.status).toBe(409)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await response.text()).toContain('not available yet')
    }
    expect(mocks.campaigns).not.toHaveBeenCalled()
  })
  it('exports the valid period and neutralizes client supplied spreadsheet formulas', async () => {
    mocks.share.mockResolvedValue(context(30))
    mocks.campaigns.mockResolvedValue([])
    const response = await csv(request, params)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('"\'=1+1"')
  })
  it('does not reveal a revoked or unknown report', async () => {
    mocks.share.mockResolvedValue(undefined)
    expect((await csv(request, params)).status).toBe(404)
    expect((await pdf(request, params)).status).toBe(404)
    expect(mocks.campaigns).not.toHaveBeenCalled()
  })
})
