import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'
import { createClientReportPdf } from '../src/lib/client-report-pdf'
import { buildClientReportModel } from '../src/lib/client-report-model'

async function main() {
  const directory = join(process.cwd(), 'tmp/pdfs/report-rendering')
  await mkdir(directory, { recursive: true })
  const logoBytes = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#176646' } }).png().toBuffer()
  const commentTokens = Array.from({ length: 160 }, (_, index) => `COMMENT_${String(index).padStart(4, '0')} évaluation`).join(' ')
  const actionTokens = Array.from({ length: 160 }, (_, index) => `ACTION_${String(index).padStart(4, '0')} amélioration`).join(' ')
  const pad = (start: string, end: string, character: string) => `${start}\n${character.repeat(5000 - start.length - end.length - 2)}\n${end}`
  const editorialComment = pad(commentTokens, 'COMMENT_END_5000', 'é')
  const actionPlan = pad(actionTokens, 'ACTION_END_5000', 'x')
  const campaigns = Array.from({ length: 80 }, (_, index) => ({
    id: String(100000 + index), name: `CAMPAIGN_${String(index).padStart(3, '0')} · Été, Ελληνικά, Кириллица, 東京 🚀 ${index % 8 === 0 ? 'W'.repeat(180) : 'Acquisition & fidélisation'}`,
    status: index % 3 === 0 ? 'REMOVED' : index % 3 === 1 ? 'PAUSED' : 'ENABLED', channelType: 'SEARCH',
    budgetResourceName: '', budgetMicros: '0', costMicros: index === 0 ? '-12345000' : '25000000', impressions: '1000', clicks: index === 0 ? '9007199254740993' : '50', conversions: 1.25, conversionValueMicros: '75000000', searchBudgetLostImpressionShare: null, searchRankLostImpressionShare: null,
  }))
  for (const locale of ['fr', 'en'] as const) {
    const model = buildClientReportModel({ generatedAt: new Date('2026-09-07T02:00:00Z'), window: { from: '2026-08-01', through: '2026-08-31', timezone: 'Europe/Paris' }, sourceVersion: 'd'.repeat(64), locale,
      brandName: 'Élan & Co · Ανάλυση', clientName: 'Bilan européen — été 2026', currencyCode: 'EUR', poweredByYodev: locale === 'fr',
      branding: { accentColor: locale === 'fr' ? '#fff050' : '#092a3b', logo: { contentType: 'image/png', base64: logoBytes.toString('base64'), sha256: createHash('sha256').update(logoBytes).digest('hex') } },
      accountTotals: { costMicros: '9007199254740993010000', impressions: '100000', clicks: '10000', conversions: 12.3456, conversionValueMicros: '100000000' }, campaigns, editorialComment, actionPlan,
    })
    await writeFile(join(directory, `report-${locale}.pdf`), await createClientReportPdf(model))
  }
  await writeFile(join(directory, 'expected.json'), JSON.stringify({ commentTokens: 160, actionTokens: 160, campaigns: 80, editorialLength: editorialComment.length, actionPlanLength: actionPlan.length, editorialComment, actionPlan, missing: ['[U+6771]', '[U+4EAC]', '[U+1F680]'] }, null, 2))
  console.log(JSON.stringify({ ok: true, directory, pdfs: ['report-fr.pdf', 'report-en.pdf'], providerCalls: 0 }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
