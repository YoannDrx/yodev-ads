import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { ClientReportModel } from '@/lib/client-report-model'
import { contrastText, reportAccent } from '@/lib/report-branding'
import { reportCampaignStatus, reportDecimal, reportInteger, reportMoney } from '@/lib/report-format'

const width = 595, height = 842, margin = 40, usable = width - margin * 2
const ink = rgb(0.06, 0.10, 0.14), muted = rgb(0.32, 0.38, 0.42), pale = rgb(0.95, 0.97, 0.97), white = rgb(1, 1, 1)
let fontBytes: Promise<Buffer[]> | undefined
function fonts() {
  fontBytes ??= Promise.all(['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'].map((name) => readFile(join(process.cwd(), 'src/assets/fonts', name))))
  return fontBytes
}
function hexColor(value: string) {
  const hex = reportAccent(value).slice(1)
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
}

/** No silent character loss. Unsupported glyphs have an explicit Unicode identifier. */
export function printableReportText(text: string, supported: ReadonlySet<number>) {
  return [...text.normalize('NFC').replace(/[\u2010-\u2015]/g, '-').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')].map((character) => {
    const point = character.codePointAt(0)!
    if (character === '\n' || (point >= 32 && supported.has(point))) return character
    return `[U+${point.toString(16).toUpperCase().padStart(4, '0')}]`
  }).join('')
}

export function wrapReportLines(text: string, measure: (text: string) => number, available: number) {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    const words = paragraph.split(/\s+/).filter(Boolean)
    for (const word of words) {
      if (measure(line ? `${line} ${word}` : word) <= available) { line = line ? `${line} ${word}` : word; continue }
      if (line) { lines.push(line); line = '' }
      const characters = [...word]
      let offset = 0
      while (offset < characters.length) {
        // Find the longest fitting prefix without shaping the font once per character.
        let low = 1, high = 1
        const remaining = characters.length - offset
        while (high < remaining && measure(characters.slice(offset, offset + high).join('')) <= available) {
          low = high
          high = Math.min(remaining, high * 2)
        }
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (measure(characters.slice(offset, offset + middle).join('')) <= available) low = middle
          else high = middle - 1
        }
        line = characters.slice(offset, offset + low).join('')
        offset += low
        if (offset < characters.length) { lines.push(line); line = '' }
      }
    }
    lines.push(line)
  }
  return lines
}

export async function createClientReportPdf(input: ClientReportModel) {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setCreationDate(input.generatedAt); pdf.setModificationDate(input.generatedAt)
  const [regularBytes, boldBytes] = await fonts()
  const regular = await pdf.embedFont(regularBytes, { subset: true, features: { liga: false } })
  const bold = await pdf.embedFont(boldBytes, { subset: true, features: { liga: false } })
  const boldPoints = new Set(bold.getCharacterSet())
  const supported = new Set(regular.getCharacterSet().filter((point) => boldPoints.has(point)))
  const printable = (text: string) => printableReportText(text, supported)
  const measurements = new Map<string, number>()
  const lines = (text: string, font: PDFFont, size: number, maxWidth = usable) => wrapReportLines(printable(text), (line) => {
    const key = `${font.name}/${size}/${line}`
    let measured = measurements.get(key)
    if (measured === undefined) {
      measured = font.widthOfTextAtSize(line, size)
      measurements.set(key, measured)
    }
    return measured
  }, maxWidth)
  const english = input.locale === 'en', locale = english ? 'en-GB' : 'fr-FR'
  const accentHex = reportAccent(input.branding?.accentColor), accent = hexColor(accentHex), accentText = hexColor(contrastText(accentHex))
  let logo: PDFImage | undefined
  const logoData = input.branding?.logo
  if (logoData && logoData.contentType === 'image/png' && logoData.base64.length <= 3_000_000) {
    try {
      const bytes = Buffer.from(logoData.base64, 'base64')
      if (createHash('sha256').update(bytes).digest('hex') === logoData.sha256) logo = await pdf.embedPng(bytes)
    } catch { /* Missing or corrupt decorative asset must not hide the financial report. */ }
  }
  const generated = input.generatedAt.toLocaleString(locale, { timeZone: input.window?.timezone ?? 'UTC' })
  let page!: PDFPage
  let y = 0
  function draw(text: string, x: number, baseline: number, size = 9, font = regular, color = ink) {
    page.drawText(printable(text), { x, y: baseline, size, font, color })
  }
  function newPage() {
    page = pdf.addPage([width, height])
    const brandLines = lines(input.brandName, bold, 13, usable - 72)
    const bandHeight = Math.max(82, brandLines.length * 18 + 32)
    page.drawRectangle({ x: 0, y: height - bandHeight, width, height: bandHeight, color: accent })
    if (logo) {
      const dimensions = logo.scaleToFit(52, 52)
      page.drawRectangle({ x: margin, y: height - 65, width: 56, height: 56, color: white })
      page.drawImage(logo, { x: margin + (56 - dimensions.width) / 2, y: height - 65 + (56 - dimensions.height) / 2, ...dimensions })
    } else draw(input.brandName.slice(0, 1).toUpperCase(), margin + 12, height - 44, 24, bold, accentText)
    brandLines.forEach((line, index) => draw(line, margin + 72, height - 29 - index * 18, 13, bold, accentText))
    y = height - bandHeight - 30
    for (const line of lines(input.clientName, bold, 18)) { draw(line, margin, y, 18, bold); y -= 24 }
    draw(english ? 'Google Ads performance report' : 'Bilan de performance Google Ads', margin, y, 10, regular, muted); y -= 18
    for (const line of lines(`${english ? 'Published' : 'Publié'} : ${generated}`, regular, 8)) { draw(line, margin, y, 8, regular, muted); y -= 13 }
    y -= 12
  }
  function ensure(space: number) { if (y - space < 72) newPage() }
  function paragraph(text: string, size = 9, font = regular, color = muted) {
    for (const line of lines(text, font, size)) { ensure(size + 8); draw(line, margin, y, size, font, color); y -= size + 6 }
  }
  function heading(text: string) { ensure(50); draw(text, margin, y, 12, bold); y -= 24 }
  newPage()
  const metrics = [
    [english ? 'Spend' : 'Investissement', reportMoney(input.totals.costMicros, input.currencyCode, input.locale)],
    ['Conversions', reportDecimal(input.totals.conversions, input.locale)],
    [english ? 'Clicks' : 'Clics', reportInteger(input.totals.clicks, input.locale)],
    ['CTR', input.totals.ctr === null ? '-' : `${reportDecimal(input.totals.ctr * 100, input.locale, 1)} %`],
  ]
  for (let index = 0; index < metrics.length; index += 2) {
    const entries = metrics.slice(index, index + 2), cellWidth = (usable - 12) / 2
    const content = entries.map(([, value]) => lines(value, bold, 17, cellWidth - 24))
    const cellHeight = Math.max(...content.map((entry) => entry.length)) * 22 + 34
    ensure(cellHeight + 12)
    for (const [column, [label]] of entries.entries()) {
      const x = margin + column * (cellWidth + 12)
      page.drawRectangle({ x, y: y - cellHeight, width: cellWidth, height: cellHeight, color: pale })
      draw(label, x + 12, y - 16, 8, regular, muted)
      content[column].forEach((line, row) => draw(line, x + 12, y - 40 - row * 22, 17, bold))
    }
    y -= cellHeight + 12
  }
  y -= 10
  const title = english ? 'Campaign details' : 'Détail des campagnes'
  const columnWidths = [234, 68, 100, 53, 60]
  const columnTitles = [english ? 'Campaign' : 'Campagne', english ? 'Status' : 'Statut', english ? 'Cost' : 'Coût', english ? 'Clicks' : 'Clics', 'Conv.']
  function tableHeader() {
    heading(title)
    page.drawRectangle({ x: margin, y: y - 12, width: usable, height: 25, color: accent })
    let x = margin
    columnTitles.forEach((title, index) => { draw(title, x + 8, y - 3, 8, bold, accentText); x += columnWidths[index] })
    y -= 30
  }
  ensure(85); tableHeader()
  for (const [index, campaign] of input.campaigns.entries()) {
    const values = [`${campaign.name}\n${campaign.channelType} · ${campaign.id}`, reportCampaignStatus(campaign.status, input.locale), reportMoney(campaign.costMicros, input.currencyCode, input.locale), reportInteger(campaign.clicks, input.locale), reportDecimal(campaign.conversions, input.locale)]
    const wrapped = values.map((value, column) => lines(value, column === 0 ? bold : regular, 8, columnWidths[column] - 16))
    const count = Math.max(...wrapped.map((entry) => entry.length))
    let start = 0
    while (start < count) {
      if (y < 110) { newPage(); tableHeader() }
      const take = Math.min(count - start, Math.max(1, Math.floor((y - 80) / 12)))
      const rowHeight = take * 12 + 12
      if (index % 2 === 0) page.drawRectangle({ x: margin, y: y - rowHeight + 7, width: usable, height: rowHeight, color: pale })
      let x = margin
      wrapped.forEach((column, columnIndex) => {
        column.slice(start, start + take).forEach((line, row) => draw(line, x + 8, y - row * 12 - 4, 8, columnIndex === 0 ? bold : regular))
        x += columnWidths[columnIndex]
      })
      y -= rowHeight; start += take
      if (start < count) { newPage(); tableHeader() }
    }
  }
  if (input.campaigns.length === 0) paragraph(english ? 'No campaign detail in the collected period.' : 'Aucun détail de campagne sur la période collectée.')
  y -= 18
  paragraph(english ? 'Account totals are authoritative. Campaign detail may cover a different scope.' : 'Les totaux du compte font référence. Le détail des campagnes peut couvrir un périmètre différent.', 8)
  for (const [label, content] of [[english ? 'Editorial review' : 'Commentaire de la période', input.editorialComment], [english ? 'Action plan' : 'Plan d’action', input.actionPlan]] as const) {
    if (!content) continue
    y -= 20; heading(label); paragraph(content)
  }
  const textValues = [input.brandName, input.clientName, input.editorialComment ?? '', input.actionPlan ?? '', ...input.campaigns.map((campaign) => campaign.name)]
  if (textValues.some((text) => printable(text).includes('[U+'))) {
    y -= 15; heading(english ? 'Character rendering' : 'Rendu des caractères')
    paragraph(english ? 'Characters outside the embedded font are shown as [U+XXXX]. The original text remains available in the HTML and CSV report.' : 'Les caractères absents de la police embarquée sont indiqués par [U+XXXX]. Le texte original reste disponible dans le rapport HTML et CSV.', 8)
  }
  const pages = pdf.getPages()
  for (const [index, current] of pages.entries()) {
    page = current
    page.drawLine({ start: { x: margin, y: 54 }, end: { x: width - margin, y: 54 }, color: pale, thickness: 1 })
    const period = input.window ? `${input.window.from} - ${input.window.through} · ${input.window.timezone}` : `${input.periodDays} ${english ? 'days' : 'jours'}`
    draw(period, margin, 40, 7, regular, muted)
    draw(`${index + 1} / ${pages.length}`, width - margin - 30, 40, 7, regular, muted)
    if (input.sourceVersion) draw(`Version ${input.sourceVersion.slice(0, 12)}`, margin, 26, 7, regular, muted)
    if (input.poweredByYodev) draw('Powered by Ads by Yodev', width - margin - 120, 26, 7, regular, muted)
  }
  pdf.setTitle(`${english ? 'Google Ads report' : 'Rapport Google Ads'} - ${input.clientName}`)
  pdf.setAuthor(input.brandName)
  pdf.setLanguage(input.locale)
  return pdf.save()
}
