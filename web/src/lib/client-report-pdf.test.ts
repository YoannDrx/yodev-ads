import { PDFDocument } from 'pdf-lib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClientReportPdf } from '@/lib/client-report-pdf'

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
    }))
    const bytes = await createClientReportPdf({
      brandName: 'Ads by Yodev',
      clientName: 'Mail Certificate',
      currencyCode: 'EUR',
      campaigns,
      generatedAt: new Date('2026-07-21T12:00:00Z'),
    })
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(2)
    expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595, height: 842 })
    if (process.env.WRITE_PDF_FIXTURE === '1') {
      const directory = resolve(process.cwd(), 'tmp/pdfs')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, 'yodev-ads-report-fixture.pdf'), bytes)
    }
  })
})
