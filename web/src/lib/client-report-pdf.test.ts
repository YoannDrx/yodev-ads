import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClientReportPdf } from '@/lib/client-report-pdf'
import { buildClientReportModel } from '@/lib/client-report-model'

describe('client PDF report', () => {
  it('creates a valid paginated A4 PDF', async () => {
    const campaigns = Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      name: `Campagne ${index + 1}`,
      status: index % 2 ? 'PAUSED' : 'ENABLED',
      channelType: 'SEARCH',
      budgetResourceName: `budget/${index + 1}`,
      budgetMicros: '10000000',
      impressions: '1000',
      clicks: '50',
      costMicros: '25000000',
      conversions: 1.5,
      conversionValueMicros: '75000000',
      searchBudgetLostImpressionShare: index === 0 ? 0.2 : null,
      searchRankLostImpressionShare: index === 0 ? 0.1 : null,
    }))
    const bytes = await createClientReportPdf(buildClientReportModel({
      brandName: 'Ads by Yodev',
      clientName: 'Mail Certificate',
      currencyCode: 'EUR',
      campaigns,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
    }))
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF')
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(pdf.getPageCount()).toBe(2)
    expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595, height: 842 })
    if (process.env.WRITE_PDF_FIXTURE === '1') {
      const directory = resolve(process.cwd(), 'tmp/pdfs')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, 'yodev-ads-report-fixture.pdf'), bytes)
    }
  })
  it.each(['valid', 'missing', 'corrupt'] as const)('paginates both long editorial fields and renders %s branding safely', async (kind) => {
    const logoBytes = kind === 'corrupt' ? Buffer.from('not-png') : await sharp({ create: { width: 20, height: 10, channels: 3, background: '#176646' } }).png().toBuffer()
    const model = buildClientReportModel({ brandName: 'Élan Ανάλυση', clientName: 'Unicode 東京 🚀', currencyCode: 'EUR', locale: 'en', campaigns: [], generatedAt: new Date('2026-09-07T02:00:00Z'),
      window: { from: '2026-08-01', through: '2026-08-31', timezone: 'Europe/Paris' }, sourceVersion: 'a'.repeat(64), poweredByYodev: true,
      branding: { accentColor: '#ffff00', logo: kind === 'missing' ? null : { contentType: 'image/png', base64: logoBytes.toString('base64'), sha256: createHash('sha256').update(logoBytes).digest('hex') } },
      editorialComment: 'é'.repeat(5000), actionPlan: 'LONG_WORD_'.repeat(500),
    })
    const bytes = await createClientReportPdf(model)
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3)
    expect(pdf.getTitle()).toBe('Google Ads report - Unicode 東京 🚀')
    expect(pdf.getCreationDate()).toEqual(model.generatedAt)
    expect(pdf.getModificationDate()).toEqual(model.generatedAt)
    expect(createHash('sha256').update(await createClientReportPdf(model)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

})
