import 'server-only'

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CampaignPerformance } from '@/lib/google-ads'

type ClientReportInput = {
  brandName: string
  clientName: string
  currencyCode: string
  campaigns: CampaignPerformance[]
  generatedAt?: Date
}

const colors = {
  ink: rgb(0.05, 0.09, 0.13),
  muted: rgb(0.38, 0.44, 0.49),
  accent: rgb(0.18, 0.72, 0.49),
  pale: rgb(0.95, 0.97, 0.97),
  white: rgb(1, 1, 1),
}

function safe(value: string) {
  return value
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
}

function money(micros: string | number, currencyCode: string) {
  return safe(
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(
      Number(micros) / 1_000_000,
    ),
  )
}

function truncate(text: string, font: PDFFont, size: number, width: number) {
  const normalized = safe(text)
  if (font.widthOfTextAtSize(normalized, size) <= width) return normalized
  let result = normalized
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) result = result.slice(0, -1)
  return `${result}...`
}

function header(page: PDFPage, bold: PDFFont, brandName: string, clientName: string, generatedAt: Date) {
  page.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: colors.ink })
  page.drawRectangle({ x: 38, y: 777, width: 34, height: 34, color: colors.accent })
  page.drawText('V', { x: 49, y: 786, size: 16, font: bold, color: colors.ink })
  page.drawText(truncate(brandName, bold, 16, 250), { x: 84, y: 792, size: 16, font: bold, color: colors.white })
  page.drawText('Rapport Google Ads securise', { x: 84, y: 775, size: 8, font: bold, color: rgb(0.65, 0.72, 0.76) })
  page.drawText(truncate(clientName, bold, 11, 180), { x: 377, y: 792, size: 11, font: bold, color: colors.white })
  page.drawText(generatedAt.toLocaleDateString('fr-FR'), { x: 465, y: 775, size: 8, font: bold, color: rgb(0.65, 0.72, 0.76) })
}

function footer(page: PDFPage, font: PDFFont, pageNumber: number, pageCount: number) {
  page.drawLine({ start: { x: 38, y: 36 }, end: { x: 557, y: 36 }, color: rgb(0.86, 0.89, 0.9), thickness: 0.7 })
  page.drawText('Donnees Google Ads - fenetre glissante de 30 jours', { x: 38, y: 20, size: 7, font, color: colors.muted })
  page.drawText(`${pageNumber} / ${pageCount}`, { x: 526, y: 20, size: 7, font, color: colors.muted })
}

export async function createClientReportPdf(input: ClientReportInput) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const generatedAt = input.generatedAt ?? new Date()
  const totals = input.campaigns.reduce(
    (sum, campaign) => ({
      cost: sum.cost + Number(campaign.costMicros),
      impressions: sum.impressions + Number(campaign.impressions),
      clicks: sum.clicks + Number(campaign.clicks),
      conversions: sum.conversions + campaign.conversions,
    }),
    { cost: 0, impressions: 0, clicks: 0, conversions: 0 },
  )
  const chunks: CampaignPerformance[][] = []
  for (let index = 0; index < input.campaigns.length; index += 10) chunks.push(input.campaigns.slice(index, index + 10))
  if (chunks.length === 0) chunks.push([])

  for (const [pageIndex, campaigns] of chunks.entries()) {
    const page = pdf.addPage([595, 842])
    header(page, bold, input.brandName, input.clientName, generatedAt)
    if (pageIndex === 0) {
      const metrics = [
        ['Investissement', money(totals.cost, input.currencyCode)],
        ['Conversions', totals.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 })],
        ['Clics', totals.clicks.toLocaleString('fr-FR')],
        ['CTR', totals.impressions ? `${((totals.clicks / totals.impressions) * 100).toFixed(1)} %` : '-'],
      ]
      metrics.forEach(([label, value], index) => {
        const x = 38 + index * 131
        page.drawRectangle({ x, y: 665, width: 117, height: 57, color: colors.pale })
        page.drawText(label, { x: x + 10, y: 702, size: 7, font: bold, color: colors.muted })
        page.drawText(safe(value), { x: x + 10, y: 679, size: 15, font: bold, color: colors.ink })
      })
    }
    const tableTop = pageIndex === 0 ? 636 : 710
    page.drawText(pageIndex === 0 ? 'Detail des campagnes' : 'Detail des campagnes - suite', { x: 38, y: tableTop, size: 12, font: bold, color: colors.ink })
    const headerY = tableTop - 28
    page.drawRectangle({ x: 38, y: headerY - 4, width: 519, height: 24, color: colors.ink })
    const columns = [
      { x: 48, label: 'Campagne' },
      { x: 306, label: 'Statut' },
      { x: 388, label: 'Cout' },
      { x: 465, label: 'Clics' },
      { x: 515, label: 'Conv.' },
    ]
    for (const column of columns) page.drawText(column.label, { x: column.x, y: headerY + 4, size: 7, font: bold, color: colors.white })
    campaigns.forEach((campaign, index) => {
      const y = headerY - 36 - index * 48
      if (index % 2 === 0) page.drawRectangle({ x: 38, y: y - 10, width: 519, height: 42, color: colors.pale })
      page.drawText(truncate(campaign.name, bold, 9, 245), { x: 48, y: y + 10, size: 9, font: bold, color: colors.ink })
      page.drawText(truncate(`${campaign.channelType} - ${campaign.id}`, regular, 6.5, 245), { x: 48, y: y - 2, size: 6.5, font: regular, color: colors.muted })
      page.drawText(campaign.status === 'ENABLED' ? 'Active' : 'En pause', { x: 306, y: y + 6, size: 8, font: regular, color: colors.muted })
      page.drawText(money(campaign.costMicros, input.currencyCode), { x: 388, y: y + 6, size: 8, font: regular, color: colors.ink })
      page.drawText(safe(Number(campaign.clicks).toLocaleString('fr-FR')), { x: 465, y: y + 6, size: 8, font: regular, color: colors.ink })
      page.drawText(safe(campaign.conversions.toLocaleString('fr-FR', { maximumFractionDigits: 1 })), { x: 515, y: y + 6, size: 8, font: regular, color: colors.ink })
    })
  }
  const pages = pdf.getPages()
  pages.forEach((page, index) => footer(page, regular, index + 1, pages.length))
  pdf.setTitle(`Rapport Google Ads - ${safe(input.clientName)}`)
  pdf.setAuthor(input.brandName)
  pdf.setCreationDate(generatedAt)
  return pdf.save()
}
